import { beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null }));
vi.mock("./firebase-admin", () => ({ adminDb: () => state.store!.db }));
import { financeReport } from "./finance-report";
import { AT, chargeFixture, paymentFixture } from "@/tests/finance-fixtures";
beforeEach(() => { state.store = memoryFirestore(); });
const query = () => new URLSearchParams({ date: "2026-10-26" });
it("pages source queries without truncating totals and pages ledger without duplicates", async () => {
  for (let i = 0; i < 510; i++) { const c = chargeFixture(`c-${String(i).padStart(4, "0")}`); state.store!.data.set(`charges/${c.id}`, { ...c }); }
  let cursor: string | null = null; const ids: string[] = [];
  do {
    const params = query(); if (cursor) params.set("cursor", cursor);
    const result = await financeReport(params); cursor = result.nextCursor;
    expect(result.totals.expectedMinor).toBe(510 * 6000); ids.push(...result.ledger.map(row => row.id));
  } while (cursor);
  expect(new Set(ids).size).toBe(510); expect(ids).toHaveLength(510);
  expect(state.store!.operations.filter(op => ["set", "update", "delete"].includes(op.kind))).toEqual([]);
});
it("joins old confirmed charges, current rejected heads and all-date open renewals", async () => {
  const old = chargeFixture("old", { chargeDate: "2026-10-24", confirmedPaymentRequestId: "old-pay" });
  const pending = chargeFixture("renew", { kind: "renewal", chargeDate: "2026-10-20", amountMinor: 100000 });
  const rejected = chargeFixture("rejected", { activePaymentRequestId: "reject-pay" });
  for (const c of [old, pending, rejected]) state.store!.data.set(`charges/${c.id}`, { ...c });
  for (const p of [paymentFixture("old-pay", old, { status: "approved", confirmedAt: AT }), paymentFixture("renew-pay", pending), paymentFixture("reject-pay", rejected, { status: "rejected" })]) state.store!.data.set(`paymentRequests/${p.id}`, { ...p });
  const result = await financeReport(query());
  expect(result.totals).toMatchObject({ expectedMinor: 6000, confirmedMinor: 6000 });
  expect(result.outstanding.renewalMinor).toBe(100000);
  expect(result.ledger.find(row => row.id === "rejected")?.status).toBe("rejected");
  const again = await financeReport(query()); expect(again.revision).toBe(result.revision);
  state.store!.data.get("charges/rejected")!.amountMinor = 7000;
  await expect(financeReport(query())).rejects.toMatchObject({ code: "financial-data-conflict" });
});
it("rejects invalid inputs, missing joins and excess volume instead of partial totals", async () => {
  await expect(financeReport(new URLSearchParams("date=invalid"))).rejects.toMatchObject({ code: "invalid-report-range" });
  await expect(financeReport(new URLSearchParams("cursor=invalid"))).rejects.toMatchObject({ code: "invalid-report-cursor" });
  const c = chargeFixture("missing"); state.store!.data.set("paymentRequests/pay", { ...paymentFixture("pay", c) });
  await expect(financeReport(query())).rejects.toMatchObject({ code: "financial-data-conflict" });
  state.store!.data.clear();
  for (let i = 0; i < 5001; i++) { const c = chargeFixture(`c${i}`); state.store!.data.set(`charges/${c.id}`, { ...c }); }
  await expect(financeReport(query())).rejects.toMatchObject({ code: "report-record-limit" });
});
