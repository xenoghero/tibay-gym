import { beforeEach, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { memoryFirestore } from "@/tests/memory-firestore";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null }));
vi.mock("./firebase-admin", () => ({ adminDb: () => state.store!.db }));
import { customerPaymentAccounts, getPaymentSettings, preparePaymentAccount, savePaymentSettings } from "./payment-methods";
const bank = { id: "account_bank0001", kind: "bank", name: "BPI savings", accountHolder: "Tibay Gym", accountNumber: "0012345678", qrImage: null, enabled: true };
const body = () => ({ revision: 0, accounts: [bank], operationId: "payment-settings-operation-1" });
beforeEach(() => { state.store = memoryFirestore(); });
it("starts with cash only and exposes only enabled accounts", async () => {
  expect(await getPaymentSettings()).toEqual({ revision: 0, accounts: [] });
  await savePaymentSettings("admin", body());
  expect(await customerPaymentAccounts()).toEqual([bank]);
  const db = state.store!.db as unknown as Firestore;
  expect(await db.runTransaction(tx => preparePaymentAccount(tx, db, bank.id, 1))).toMatchObject({ name: bank.name, accountNumber: bank.accountNumber });
  await expect(db.runTransaction(tx => preparePaymentAccount(tx, db, bank.id, 0))).rejects.toMatchObject({ code: "payment-method-unavailable" });
  await savePaymentSettings("admin", { revision: 1, accounts: [{ ...bank, enabled: false }], operationId: "payment-settings-operation-2" });
  expect(await customerPaymentAccounts()).toEqual([]);
  await expect(db.runTransaction(tx => preparePaymentAccount(tx, db, bank.id))).rejects.toMatchObject({ code: "payment-method-unavailable" });
  expect(await db.runTransaction(tx => preparePaymentAccount(tx, db, "cash"))).toBeNull();
});
it("replays saves safely and rejects stale or conflicting changes", async () => {
  const first = await savePaymentSettings("admin", body());
  expect(await savePaymentSettings("admin", body())).toEqual(first);
  await expect(savePaymentSettings("other", body())).rejects.toMatchObject({ code: "operation-conflict" });
  await expect(savePaymentSettings("admin", { ...body(), operationId: "payment-settings-operation-2" })).rejects.toMatchObject({ code: "settings-changed" });
  await expect(savePaymentSettings("admin", { revision: 1, accounts: [], operationId: "payment-settings-operation-3" })).rejects.toMatchObject({ code: "disable-payment-account-instead" });
});
it("rejects duplicate identities, missing details, oversized lists and invalid QR images", async () => {
  for (const accounts of [[bank, bank], [{ ...bank, accountHolder: " " }], Array.from({ length: 7 }, (_, n) => ({ ...bank, id: `account_bank000${n}` })), [{ ...bank, qrImage: "data:image/svg+xml;base64,AAAA" }]]) {
    await expect(savePaymentSettings("admin", { ...body(), accounts })).rejects.toMatchObject({ status: 400 });
  }
  expect(state.store!.data.size).toBe(0);
});
it("decodes and normalizes uploaded QR images before storing customer-visible PNG data", async () => {
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  const qrImage = `data:image/png;base64,${png.toString("base64")}`;
  const result = await savePaymentSettings("admin", { ...body(), accounts: [{ ...bank, qrImage }] });
  expect(result.accounts[0].qrImage).toMatch(/^data:image\/png;base64,/);
  const metadata = await sharp(Buffer.from(result.accounts[0].qrImage!.split(",")[1], "base64")).metadata();
  expect(metadata).toMatchObject({ width: 20, height: 20, format: "png" });
});
