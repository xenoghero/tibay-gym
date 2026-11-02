import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { adminDb } from "./firebase-admin";
import { supabaseAdmin } from "./supabase";
import { appendAudit } from "./audit";
import { onlyFields, attendanceText } from "./attendance-request";
import { ApiError } from "./rfid/http";
import { readPrivateImage } from "./private-images";
import { MAX_PROMOTIONS, type PromotionSettings } from "@/lib/promotions";

const BUCKET = "checkin-promotions";
const SETTINGS = "gymSettings/promotions";
interface StoredBanner { id: string; title: string; enabled: boolean; digest: string }
interface StoredSettings { revision: number; banners: StoredBanner[] }
const empty = (): StoredSettings => ({ revision: 0, banners: [] });
function view(settings: StoredSettings): PromotionSettings {
  return { revision: settings.revision, banners: settings.banners.map(({ id, title, enabled }) => ({
    id, title, enabled, imageUrl: supabaseAdmin().storage.from(BUCKET).getPublicUrl(`${id}.webp`).data.publicUrl,
  })) };
}
export async function getPromotionSettings() {
  return view((await adminDb().doc(SETTINGS).get()).data() as StoredSettings | undefined ?? empty());
}
function audit(actorId: string, revision: number) {
  return { actorId, action: "promotions-update", entityType: "settings", entityId: "promotions", personId: null,
    operationId: `promotions-${revision}`, after: { revision, changedFields: ["banners"] } };
}
export async function uploadPromotion(actorId: string, request: Request) {
  const id = request.headers.get("x-promotion-id") ?? "";
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ApiError(400, "invalid-promotion-id");
  let title: string;
  try { title = attendanceText(decodeURIComponent(request.headers.get("x-promotion-title") ?? ""), 160); }
  catch { throw new ApiError(400, "promotion-title-required"); }
  const bytes = await readPrivateImage(request);
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 900 || metadata.height < 300 || Math.abs(metadata.width / metadata.height - 3) > .02)
    throw new ApiError(400, "promotion-dimensions-required");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const db = adminDb(), ref = db.doc(SETTINGS), storage = supabaseAdmin().storage;
  // Check before upload as well as in the transaction, avoiding unnecessary objects.
  const current = (await ref.get()).data() as StoredSettings | undefined ?? empty();
  const existing = current.banners.find(banner => banner.id === id);
  if (existing) {
    if (existing.digest !== digest) throw new ApiError(409, "promotion-upload-conflict");
    return view(current);
  }
  if (current.banners.length >= MAX_PROMOTIONS) throw new ApiError(409, "promotion-limit");
  let bucket = await storage.getBucket(BUCKET);
  if (bucket.error) {
    await storage.createBucket(BUCKET, { public: true, allowedMimeTypes: ["image/webp"], fileSizeLimit: 5 * 1024 * 1024 });
    // A concurrent first upload may have created it already.
    bucket = await storage.getBucket(BUCKET);
  }
  if (bucket.error || !bucket.data.public) throw new ApiError(503, "promotion-storage-unavailable");
  const path = `${id}.webp`;
  const uploaded = await storage.from(BUCKET).upload(path, bytes, { contentType: "image/webp", upsert: false });
  if (uploaded.error) {
    // Recover a lost upload response without ever overwriting another image.
    const saved = await storage.from(BUCKET).download(path);
    if (saved.error || createHash("sha256").update(Buffer.from(await saved.data.arrayBuffer())).digest("hex") !== digest)
      throw new ApiError(503, "promotion-upload-failed");
  }
  try {
    const next = await db.runTransaction(async tx => {
      const latest = (await tx.get(ref)).data() as StoredSettings | undefined ?? empty();
      const previous = latest.banners.find(banner => banner.id === id);
      if (previous) {
        if (previous.digest !== digest) throw new ApiError(409, "promotion-upload-conflict");
        return latest;
      }
      if (latest.banners.length >= MAX_PROMOTIONS) throw new ApiError(409, "promotion-limit");
      const next = { revision: latest.revision + 1, banners: [...latest.banners, { id, title, enabled: true, digest }] };
      tx.set(ref, { ...next, updatedBy: actorId, updatedAt: Date.now() });
      appendAudit(tx, db, audit(actorId, next.revision));
      return next;
    });
    return view(next);
  } catch (error) {
    // Only clean up a definitively rejected new upload; an uncertain commit may have published it.
    if (error instanceof ApiError && !uploaded.error && error.code === "promotion-limit")
      await storage.from(BUCKET).remove([path]);
    throw error;
  }
}
export async function savePromotionSettings(actorId: string, body: Record<string, unknown>) {
  onlyFields(body, ["revision", "banners"]);
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0 || !Array.isArray(body.banners) || body.banners.length > MAX_PROMOTIONS)
    throw new ApiError(400, "invalid-body");
  const ids = new Set<string>();
  const edits = body.banners.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ApiError(400, "invalid-body");
    onlyFields(item, ["id", "title", "enabled"]);
    if (typeof item.id !== "string" || ids.has(item.id) || typeof item.enabled !== "boolean") throw new ApiError(400, "invalid-body");
    ids.add(item.id);
    return { id: item.id, title: attendanceText(item.title, 160), enabled: item.enabled };
  });
  const db = adminDb(), ref = db.doc(SETTINGS);
  const next = await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as StoredSettings | undefined ?? empty();
    if (current.revision !== body.revision) throw new ApiError(409, "settings-changed");
    const banners = edits.map(edit => {
      const existing = current.banners.find(banner => banner.id === edit.id);
      if (!existing) throw new ApiError(400, "unknown-promotion");
      return { ...existing, ...edit };
    });
    const next = { revision: current.revision + 1, banners };
    tx.set(ref, { ...next, updatedBy: actorId, updatedAt: Date.now() });
    appendAudit(tx, db, audit(actorId, next.revision));
    return { next, removed: current.banners.filter(banner => !ids.has(banner.id)) };
  });
  // Metadata is authoritative: removed banners stop appearing even if storage cleanup fails.
  if (next.removed.length) {
    try { await supabaseAdmin().storage.from(BUCKET).remove(next.removed.map(banner => `${banner.id}.webp`)); }
    catch { /* Storage cleanup must not turn a confirmed settings save into an error. */ }
  }
  return view(next.next);
}
