import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: vi.fn(async () => "admin") }));
vi.mock("@/lib/server/private-images", () => ({ readPrivateImage: vi.fn() }));
import { readPrivateImage } from "@/lib/server/private-images";
import { POST } from "./route";
import { memoryFirestore } from "@/tests/memory-firestore";
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: () => state.store!.db }));
import { savePaymentSettings } from "@/lib/server/payment-methods";

it.each([20, 640])("accepts a %i pixel image without a quality or detail rejection and saves it", async width => {
  state.store = memoryFirestore();
  const png = await sharp(randomBytes(width * width * 3), { raw: { width, height: width, channels: 3 } }).png().toBuffer();
  if (width === 640) expect(png.length).toBeGreaterThan(120_000);
  vi.mocked(readPrivateImage).mockResolvedValueOnce(png);
  const response = await POST(new Request("https://gym.test/api/finance/payment-methods/qr", { method: "POST" }));
  expect(response.status).toBe(200);
  const { qrImage } = await response.json();
  const saved = await savePaymentSettings("admin", { revision: 0, operationId: "qr-upload-save-operation", accounts: [{
    id: "account_gcash001", kind: "gcash", name: "GCash", accountHolder: "Gym", accountNumber: "09171234567", enabled: true, qrImage,
  }] });
  const metadata = await sharp(Buffer.from(saved.accounts[0].qrImage!.split(",")[1], "base64")).metadata();
  expect(metadata).toMatchObject({ width, height: width, format: "png" });
});
