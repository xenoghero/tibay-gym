import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ docs: new Map<string, unknown>(), loseCommit: false, upload: vi.fn(), remove: vi.fn(), bucket: vi.fn(), create: vi.fn(), download: vi.fn(), audit: vi.fn() }));
vi.mock("./firebase-admin", () => ({ adminDb: () => ({
  doc: (path: string) => ({ path, get: async () => ({ data: () => mocks.docs.get(path) }) }),
  runTransaction: async (work: (tx: unknown) => Promise<unknown>) => { const result = await work({
    get: async (ref: { path: string }) => ({ data: () => mocks.docs.get(ref.path) }),
    set: (ref: { path: string }, value: unknown) => mocks.docs.set(ref.path, value),
  }); if (mocks.loseCommit) throw new Error("commit response lost"); return result; },
}) }));
vi.mock("./supabase", () => ({ supabaseAdmin: () => ({ storage: {
  getBucket: mocks.bucket, createBucket: mocks.create,
  from: () => ({ upload: mocks.upload, remove: mocks.remove, download: mocks.download,
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://images.test/${path}` } }) }),
} }) }));
vi.mock("./audit", () => ({ appendAudit: mocks.audit }));
import { getPromotionSettings, savePromotionSettings, uploadPromotion } from "./promotions";
const id = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
async function imageRequest(width = 1500, height = 500, promotionId = id) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: "#ffcc00" } }).png().toBuffer();
  return new Request("https://test/api", { method: "PUT", headers: { "content-type": "image/png", "x-promotion-id": promotionId, "x-promotion-title": "November%20offer" }, body: new Uint8Array(bytes) });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.docs.clear(); mocks.loseCommit = false; mocks.bucket.mockResolvedValue({ data: { public: true }, error: null });
  mocks.upload.mockResolvedValue({ error: null }); mocks.remove.mockResolvedValue({ error: null });
});
it("has no banners until the admin uploads one, then publishes a validated image without private metadata", async () => {
  expect(await getPromotionSettings()).toEqual({ revision: 0, banners: [] });
  const result = await uploadPromotion("admin", await imageRequest());
  expect(result).toEqual({ revision: 1, banners: [{ id, title: "November offer", enabled: true, imageUrl: `https://images.test/${id}.webp` }] });
  expect(mocks.upload).toHaveBeenCalledWith(`${id}.webp`, expect.any(Buffer), { contentType: "image/webp", upsert: false });
  expect(mocks.audit).toHaveBeenCalled();
  await uploadPromotion("admin", await imageRequest());
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect((await getPromotionSettings()).revision).toBe(1);
});
it("rejects square, undersized, malformed and oversized uploads before storage", async () => {
  await expect(uploadPromotion("admin", await imageRequest(600, 600))).rejects.toMatchObject({ code: "promotion-dimensions-required" });
  await expect(uploadPromotion("admin", await imageRequest(600, 200))).rejects.toMatchObject({ code: "promotion-dimensions-required" });
  await expect(uploadPromotion("admin", new Request("https://test", { method: "PUT", headers: { "content-type": "image/png", "x-promotion-id": id, "x-promotion-title": "Offer" }, body: "not an image" }))).rejects.toMatchObject({ code: "invalid-image" });
  const request = await imageRequest(); request.headers.set("content-length", String(6 * 1024 * 1024));
  await expect(uploadPromotion("admin", request)).rejects.toMatchObject({ code: "image-too-large" });
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("supports ordering, visibility, alt descriptions and removal with stale-write protection", async () => {
  await uploadPromotion("admin", await imageRequest()); await uploadPromotion("admin", await imageRequest(1500, 500, second));
  const saved = await savePromotionSettings("admin", { revision: 2, banners: [
    { id: second, title: "Second offer", enabled: true }, { id, title: "First offer", enabled: false },
  ] });
  expect(saved.banners.map(item => [item.id, item.enabled])).toEqual([[second, true], [id, false]]);
  await expect(savePromotionSettings("admin", { revision: 2, banners: [] })).rejects.toMatchObject({ code: "settings-changed" });
  expect((await getPromotionSettings()).banners).toHaveLength(2);
  expect((await savePromotionSettings("admin", { revision: 3, banners: [] })).banners).toEqual([]);
  expect(mocks.remove).toHaveBeenCalledWith([`${second}.webp`, `${id}.webp`]);
});
it("rejects unknown banners, duplicate IDs, arbitrary image URLs and over-limit uploads", async () => {
  await expect(savePromotionSettings("admin", { revision: 0, banners: [{ id, title: "Offer", enabled: true }] })).rejects.toMatchObject({ code: "unknown-promotion" });
  await uploadPromotion("admin", await imageRequest());
  const item = { id, title: "Offer", enabled: true };
  await expect(savePromotionSettings("admin", { revision: 1, banners: [item, item] })).rejects.toMatchObject({ code: "invalid-body" });
  await expect(savePromotionSettings("admin", { revision: 1, banners: [{ ...item, imageUrl: "https://evil.test" }] })).rejects.toMatchObject({ code: "invalid-body" });
  mocks.docs.set("gymSettings/promotions", { revision: 1, banners: Array.from({ length: 8 }, (_, index) => ({ ...item, id: String(index) })) });
  await expect(uploadPromotion("admin", await imageRequest())).rejects.toMatchObject({ code: "promotion-limit" });
});
it("does not delete an image after an uncertain transaction result", async () => {
  mocks.loseCommit = true;
  await expect(uploadPromotion("admin", await imageRequest())).rejects.toThrow();
  expect(mocks.remove).not.toHaveBeenCalled();
  mocks.loseCommit = false;
  expect((await uploadPromotion("admin", await imageRequest())).banners).toHaveLength(1);
  expect(mocks.upload).toHaveBeenCalledTimes(1);
});
