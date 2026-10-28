import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null, bucket: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock("./firebase-admin", () => ({ adminDb: () => mocks.store!.db }));
vi.mock("./supabase", () => ({ supabaseAdmin: () => ({ storage: { getBucket: mocks.bucket, from: () => ({ upload: mocks.upload, remove: mocks.remove }) } }) }));
import { readPrivateImage, saveProfileImage, cleanupProfileImages } from "./private-images";
beforeEach(() => { mocks.store = memoryFirestore(); mocks.bucket.mockResolvedValue({ data: { public: false }, error: null }); mocks.upload.mockReset().mockResolvedValue({ error: null }); mocks.store.data.set("unverifiedPersons/p1", { type: "guest" }); });
it("decodes valid photos, strips input format and reencodes privately to WebP", async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const result = await readPrivateImage(new Request("https://test/api", { method: "POST", headers: { "Content-Type": "image/png" }, body: new Uint8Array(png) }));
  expect((await sharp(result).metadata()).format).toBe("webp");
});
it.each([["image/svg+xml", "<svg/>", 415], ["image/png", "not an image", 400]])("rejects unsupported or undecodable photos (%s)", async (mime, body, status) => {
  await expect(readPrivateImage(new Request("https://test/api", { method: "POST", headers: { "Content-Type": mime as string }, body: body as string }))).rejects.toMatchObject({ status });
});
it("rejects oversized bodies before decoding", async () => {
  await expect(readPrivateImage(new Request("https://test/api", { method: "POST", headers: { "Content-Type": "image/png", "Content-Length": "5242881" }, body: "x" }))).rejects.toMatchObject({ status: 413 });
});
it("links photos and audit once, replays retries, and rejects changed payloads", async () => {
  await saveProfileImage("p1", Buffer.from("encoded"), "image-operation-0001", "customer:p1");
  await saveProfileImage("p1", Buffer.from("encoded"), "image-operation-0001", "customer:p1");
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.store!.data.get("unverifiedPersons/p1")?.profileImagePath).toBe("p1/image-operation-0001.webp");
  expect([...mocks.store!.data.keys()].filter(path => path.startsWith("auditEvents/"))).toHaveLength(1);
  await expect(saveProfileImage("p1", Buffer.from("different"), "image-operation-0001", "customer:p1")).rejects.toMatchObject({ status: 409 });
});
it("preserves an interrupted upload job and can retry after failure without undoing registration", async () => {
  mocks.upload.mockResolvedValueOnce({ error: { statusCode: "503" } });
  await expect(saveProfileImage("p1", Buffer.from("encoded"), "image-operation-0002", "customer:p1")).rejects.toMatchObject({ status: 503 });
  expect(mocks.store!.data.get("profileImageUploads/image-operation-0002")?.linked).toBe(false);
  expect(mocks.store!.data.get("unverifiedPersons/p1")?.type).toBe("guest");
  await saveProfileImage("p1", Buffer.from("encoded"), "image-operation-0002", "customer:p1");
  expect(mocks.store!.data.get("profileImageUploads/image-operation-0002")?.linked).toBe(true);
});
it("refuses a public bucket and frozen/deleted customers", async () => {
  mocks.bucket.mockResolvedValueOnce({ data: { public: true } });
  await expect(saveProfileImage("p1", Buffer.from("encoded"), "image-operation-0003", "customer:p1")).rejects.toMatchObject({ status: 503 });
  mocks.store!.data.get("unverifiedPersons/p1")!.deletingAt = true;
  await expect(saveProfileImage("p1", Buffer.from("encoded"), "image-operation-0004", "customer:p1")).rejects.toMatchObject({ status: 409 });
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("cleans expired orphans while preserving referenced photos and revisiting them after deletion", async () => {
  mocks.remove.mockResolvedValue({ error: null });
  mocks.store!.data.set("profileImageUploads/abandoned", { personId: "deleted", path: "deleted/old.webp", expiresAt: Date.now() - 1, linked: false });
  mocks.store!.data.set("profileImageUploads/current", { personId: "p1", path: "p1/current.webp", expiresAt: Date.now() - 1, linked: true });
  mocks.store!.data.get("unverifiedPersons/p1")!.profileImagePath = "p1/current.webp";
  expect(await cleanupProfileImages()).toEqual({ inspected: 2, removed: 1 });
  expect(mocks.remove).toHaveBeenCalledWith(["deleted/old.webp"]);
  expect(mocks.store!.data.has("profileImageUploads/current")).toBe(true);
  mocks.store!.data.delete("unverifiedPersons/p1");
  mocks.store!.data.get("profileImageUploads/current")!.expiresAt = Date.now() - 1;
  await cleanupProfileImages();
  expect(mocks.remove).toHaveBeenCalledWith(["p1/current.webp"]);
});
it("makes replaced photos eligible immediately while keeping the latest photo", async () => {
  mocks.remove.mockResolvedValue({ error: null });
  await saveProfileImage("p1", Buffer.from("first"), "photo-replace-operation-0001", "admin");
  await saveProfileImage("p1", Buffer.from("second"), "photo-replace-operation-0002", "admin");
  expect(await cleanupProfileImages()).toMatchObject({ removed: 1 });
  expect(mocks.remove).toHaveBeenCalledWith(["p1/photo-replace-operation-0001.webp"]);
  expect(mocks.store!.data.get("unverifiedPersons/p1")?.profileImagePath).toBe("p1/photo-replace-operation-0002.webp");
});
it("expires deleted-profile photos on the next cleanup without waiting for the orphan window", async () => {
  mocks.remove.mockResolvedValue({ error: null });
  await saveProfileImage("p1", Buffer.from("first"), "photo-delete-operation-0001", "admin");
  mocks.store!.data.delete("unverifiedPersons/p1"); mocks.store!.data.set("artifactDeletionJobs/p1", { createdAt: Date.now() });
  expect(await cleanupProfileImages()).toMatchObject({ removed: 1 });
  expect(mocks.store!.data.has("artifactDeletionJobs/p1")).toBe(false);
});
