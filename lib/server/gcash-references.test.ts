import { expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
vi.mock("server-only", () => ({}));
import { prepareReferenceClaim } from "./gcash-references";
import { prepareTransactionNumber } from "./transaction-numbers";
it("deduplicates bank references by destination account, independent of display name", async () => {
  const store = memoryFirestore(), db = store.db as unknown as Firestore;
  const account = { id: "account_bank0001" as const, kind: "bank" as const, name: "BPI", accountHolder: "Tibay Gym", accountNumber: "0012345678" };
  await db.runTransaction(async tx => { const claim = await prepareReferenceClaim(tx, db, "BPI-00ab1234", "p1", "c1", account); claim.commit(); });
  await expect(db.runTransaction(tx => prepareReferenceClaim(tx, db, "BPI00AB1234", "p2", "c2", { ...account, name: "Renamed bank" }))).rejects.toMatchObject({ code: "reference-already-used" });
});
it("claims a normalized reference for one payment under competing approval transactions", async () => {
  const store = memoryFirestore(), db = store.db as unknown as Firestore;
  const claim = (payment: string) => db.runTransaction(async (tx: Transaction) => { const result = await prepareReferenceClaim(tx, db, "0001-2345 67890", payment, "c1"); result.commit(); });
  const results = await Promise.allSettled([claim("r1"), claim("r2")]);
  expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
  await claim("r1"); expect(store.data.size).toBe(1);
});
it("allocates transaction numbers independently of record counts and serializes competing allocations", async () => {
  const store = memoryFirestore(), db = store.db as unknown as Firestore;
  for (let i = 0; i < 10; i++) store.data.set(`charges/legacy-${i}`, {});
  const allocate = () => db.runTransaction(async tx => { const result = await prepareTransactionNumber(tx, db); result.commit(); return result.number; });
  expect(await Promise.all([allocate(), allocate()])).toEqual(["TB-000000000001", "TB-000000000002"]);
});
