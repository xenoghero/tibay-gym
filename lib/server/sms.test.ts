import { beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
import { DEFAULT_SMS_SETTINGS } from "@/lib/sms/contracts";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null,
  ready: true, send: vi.fn(), lookup: vi.fn() }));
vi.mock("./firebase-admin", () => ({ adminDb: () => state.store!.db }));
vi.mock("./sms-provider", () => ({ smsProviderReady: () => state.ready, sendSms: (...args: unknown[]) => state.send(...args), lookupSms: (...args: unknown[]) => state.lookup(...args) }));
import { getSmsSettings, queueSmsTest, runSmsWorker, saveSmsContact, saveSmsSettings } from "./sms";
const body = { action: "test", personId: "p1", text: "Test requested by customer", operationId: "test-operation-000001" };
const store = () => state.store!.data;
beforeEach(() => {
  state.store = memoryFirestore(); state.ready = true; state.send.mockReset(); state.lookup.mockReset();
  state.send.mockResolvedValue({ outcome: "accepted", code: 202, state: "Pending" });
  state.lookup.mockResolvedValue({ outcome: "accepted", code: 200, state: "Delivered" });
  store().set("persons/p1", { name: "Demo", phone: "09171234567", type: "member" });
  store().set("smsContacts/p1", { phone: "+639171234567", permission: true, optedOut: false, revision: 1 });
});
async function enable() { return saveSmsSettings("admin", { ...DEFAULT_SMS_SETTINGS, enabled: true, policyConfirmed: true, operationId: "settings-operation-001" }); }
it("defaults disabled and does not send unconfigured or disabled messages", async () => {
  expect((await getSmsSettings()).enabled).toBe(false); await queueSmsTest("admin", body);
  expect(await runSmsWorker()).toEqual({ disabled: true, processed: 0 }); expect(state.send).not.toHaveBeenCalled();
  state.ready = false; await expect(enable()).rejects.toMatchObject({ code: "sms-provider-unconfigured" });
});
it("serializes worker claims and records provider acceptance separately from delivery", async () => {
  await enable(); const { id } = await queueSmsTest("admin", body);
  await Promise.all([runSmsWorker(), runSmsWorker()]); expect(state.send).toHaveBeenCalledTimes(1);
  expect(store().get(`smsMessages/${id}`)?.status).toBe("accepted");
  store().get(`smsMessages/${id}`)!.scheduledAt = 0; await runSmsWorker();
  expect(store().get(`smsMessages/${id}`)?.status).toBe("delivered"); expect(state.send).toHaveBeenCalledTimes(1);
});
it("deduplicates lost queue responses and refuses conflicting operation reuse", async () => {
  const first = await queueSmsTest("admin", body); expect(await queueSmsTest("admin", body)).toEqual(first);
  await expect(queueSmsTest("admin", { ...body, text: "Different" })).rejects.toMatchObject({ status: 409 });
});
it.each(["optout", "phone", "deleted"])("rechecks contact eligibility at claim: %s", async kind => {
  await enable(); const { id } = await queueSmsTest("admin", body);
  if (kind === "optout") store().get("smsContacts/p1")!.optedOut = true;
  if (kind === "phone") store().get("persons/p1")!.phone = "09179876543";
  if (kind === "deleted") store().delete("persons/p1");
  await runSmsWorker(); expect(state.send).not.toHaveBeenCalled(); expect(store().get(`smsMessages/${id}`)?.status).toBe("cancelled");
});
it("holds lost responses and expired send leases for reconciliation without resending", async () => {
  await enable(); state.send.mockResolvedValue({ outcome: "uncertain", code: null, state: null });
  state.lookup.mockResolvedValue({ outcome: "missing", code: 404, state: null });
  const { id } = await queueSmsTest("admin", body); await runSmsWorker();
  const row = store().get(`smsMessages/${id}`)!; row.scheduledAt = 0; await runSmsWorker();
  expect(row.status).toBe("uncertain"); expect(state.send).toHaveBeenCalledTimes(1);
  const updated = store().get(`smsMessages/${id}`)!; updated.status = "sending"; updated.leaseUntil = 1; updated.scheduledAt = 0;
  await runSmsWorker(); expect(state.send).toHaveBeenCalledTimes(1); expect(state.lookup).toHaveBeenCalledTimes(2);
});
it("retries explicit 429 rejections with backoff and a fixed attempt limit", async () => {
  await enable(); state.send.mockResolvedValue({ outcome: "rejected", code: 429, state: null });
  const { id } = await queueSmsTest("admin", body);
  for (let i = 0; i < 3; i++) { store().get(`smsMessages/${id}`)!.scheduledAt = 0; await runSmsWorker(); }
  expect(state.send).toHaveBeenCalledTimes(3); expect(store().get(`smsMessages/${id}`)?.status).toBe("failed");
});
it("audits permission and setting changes without contact data or templates", async () => {
  await saveSmsContact("admin", { personId: "p1", permission: false, optedOut: true, revision: 1, operationId: "contact-operation-001" });
  await enable();
  const audit = JSON.stringify([...store()].filter(([key]) => key.startsWith("auditEvents/")));
  expect(audit).toContain("sms-contact"); expect(audit).not.toContain("09171234567"); expect(audit).not.toContain(DEFAULT_SMS_SETTINGS.expiryTemplate);
  await expect(queueSmsTest("admin", body)).rejects.toMatchObject({ status: 409 });
});
it("expires stale queued tests instead of sending a backlog after activation", async () => {
  const { id } = await queueSmsTest("admin", body); store().get(`smsMessages/${id}`)!.createdAt = 0;
  await enable(); await runSmsWorker(); expect(state.send).not.toHaveBeenCalled();
  expect(store().get(`smsMessages/${id}`)?.errorCode).toBe("queue-expired");
});
