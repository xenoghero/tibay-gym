import "server-only";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { adminDb } from "./firebase-admin";
import { supabaseAdmin } from "./supabase";
import { ApiError } from "./rfid/http";
import { operationId } from "@/lib/finance/rules";
import { appendAudit } from "./audit";
export const PROFILE_BUCKET = "profile-photos";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export async function readPrivateImage(request: Request, lossless = false) {
  const mime = request.headers.get("content-type")?.split(";")[0];
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime ?? "")) throw new ApiError(415, "image-format-required");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new ApiError(413, "image-too-large");
  if (!request.body) throw new ApiError(400, "image-required");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try { while (true) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_IMAGE_BYTES) { await reader.cancel(); throw new ApiError(413, "image-too-large"); }
    chunks.push(value);
  } } finally { reader.releaseLock(); }
  const buffer = Buffer.concat(chunks);
  try {
    const image = sharp(buffer, { limitInputPixels: 16_000_000, animated: false });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages ?? 1) > 1) throw new Error("Unsupported image");
    const resized = image.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true });
    return await (lossless ? resized.png() : resized.webp({ quality: 85 })).toBuffer();
  } catch { throw new ApiError(400, "invalid-image"); }
}
export async function saveProfileImage(personId: string, bytes: Buffer, rawOperationId: unknown, actorId: string) {
  let id: string;
  try { id = operationId(rawOperationId); } catch { throw new ApiError(400, "invalid-operation-id"); }
  const db = adminDb(), storage = supabaseAdmin().storage;
  const bucket = await storage.getBucket(PROFILE_BUCKET);
  if (bucket.error || bucket.data.public) throw new ApiError(503, "private-image-storage-unavailable");
  const path = `${personId}/${id}.webp`, digest = createHash("sha256").update(bytes).digest("hex");
  const job = db.doc(`profileImageUploads/${id}`);
  const readPerson = async () => {
    const official = await db.doc(`persons/${personId}`).get();
    return official.data() ? db.doc(`persons/${personId}`) : db.doc(`unverifiedPersons/${personId}`);
  };
  const initialRef = await readPerson();
  const already = await db.runTransaction(async tx => {
    const person = (await tx.get(initialRef)).data();
    const previous = (await tx.get(job)).data();
    if (!person || person.deletingAt) throw new ApiError(409, "person-unavailable");
    if (previous && (previous.personId !== personId || previous.digest !== digest)) throw new ApiError(409, "operation-conflict");
    if (previous?.linked) return true;
    tx.set(job, { personId, path, digest, linked: false, createdAt: previous?.createdAt ?? Date.now(), expiresAt: Date.now() + 86400000 });
    return false;
  });
  if (already) return;
  const uploaded = await storage.from(PROFILE_BUCKET).upload(path, bytes, { contentType: "image/webp", upsert: false });
  if (uploaded.error && !["409", "Duplicate", "ResourceAlreadyExists"].includes(String(uploaded.error.statusCode ?? uploaded.error.name))) throw new ApiError(503, "image-upload-failed");
  try {
    // Approval may move the profile while the image uploads. Read both namespaces inside the link transaction.
    await db.runTransaction(async tx => {
      const officialRef = db.doc(`persons/${personId}`), pendingRef = db.doc(`unverifiedPersons/${personId}`);
      const official = (await tx.get(officialRef)).data(), pending = (await tx.get(pendingRef)).data();
      const previous = (await tx.get(job)).data();
      const person = official ?? pending;
      const oldPath = person?.profileImagePath;
      const oldJobRef = typeof oldPath === "string" && oldPath !== path
        ? db.doc(`profileImageUploads/${oldPath.split("/").at(-1)!.replace(/\.webp$/, "")}`) : null;
      const oldJob = oldJobRef ? (await tx.get(oldJobRef)).data() : null;
      if (!person || person.deletingAt) throw new ApiError(409, "person-unavailable");
      if (previous?.linked) return;
      if (!previous || previous.expiresAt <= Date.now()) throw new ApiError(409, "image-upload-expired");
      tx.update(official ? officialRef : pendingRef, { profileImagePath: path });
      tx.update(job, { linked: true });
      if (oldJobRef && oldJob?.path === oldPath) tx.update(oldJobRef, { expiresAt: Date.now() });
      appendAudit(tx, db, { actorId, action: "profile-photo-updated", entityType: "person", entityId: personId, personId,
        operationId: id, after: { changedFields: ["profileImage"] } });
    });
  } catch (error) {
    // A lost commit response is ambiguous: never delete an image that may have linked.
    // The durable job allows cleanup to recheck the authoritative profile after its recovery window.
    throw error;
  }
}
export async function cleanupProfileImages() {
  const db = adminDb();
  // Customer deletion jobs now remove photos only. Receipt evidence follows its independent retention/holds.
  const deletions = await db.collection("artifactDeletionJobs").limit(10).get();
  for (const deletion of deletions.docs) {
    const person = (await db.doc(`persons/${deletion.id}`).get()).data() ?? (await db.doc(`unverifiedPersons/${deletion.id}`).get()).data();
    if (person && !person.deletingAt) continue;
    const photos = await db.collection("profileImageUploads").where("personId", "==", deletion.id).limit(100).get();
    for (const photo of photos.docs) await photo.ref.update({ expiresAt: Date.now() });
    if (photos.size < 100) await deletion.ref.delete();
  }
  const jobs = await db.collection("profileImageUploads").where("expiresAt", "<=", Date.now()).limit(100).get();
  let removed = 0;
  for (const job of jobs.docs) {
    const data = job.data();
    const official = (await db.doc(`persons/${data.personId}`).get()).data();
    const pending = (await db.doc(`unverifiedPersons/${data.personId}`).get()).data();
    if ((official ?? pending)?.profileImagePath !== data.path) {
      const result = await supabaseAdmin().storage.from(PROFILE_BUCKET).remove([data.path]);
      if (result.error) continue;
      removed++;
    }
    // Retain linked jobs so later replacement/deletion can still find the old private object.
    if (!(official ?? pending) || (official ?? pending)?.profileImagePath !== data.path) await job.ref.delete();
    else await job.ref.update({ expiresAt: Date.now() + 86400000 });
  }
  return { inspected: jobs.size, removed };
}
