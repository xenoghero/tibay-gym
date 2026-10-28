import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
import { DEFAULT_SMS_SETTINGS } from "@/lib/sms/contracts";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null, send: vi.fn() }));
vi.mock("./firebase-admin", () => ({ adminDb: () => state.store!.db }));
vi.mock("./sms-provider", () => ({ smsProviderReady: () => true, sendSms: (...args: unknown[]) => state.send(...args), lookupSms: vi.fn() }));
import { dispatchSmsCampaign, previewSmsCampaign, smsCampaignProgress } from "./sms-campaigns";
import { runSmsWorker } from "./sms";
const data = () => state.store!.data;
const body = { text: "Tibay Gym: Holiday hours 8am–5pm. Ask the admin to stop SMS.", personIds: ["p1", "p2"], operationId: "campaign-operation-0001" };
beforeEach(() => {
  state.store = memoryFirestore(); state.send.mockReset();
  data().set("gymSettings/sms", { ...DEFAULT_SMS_SETTINGS, enabled: true, policyConfirmed: true });
  for (const [id, phone] of [["p1", "+639171234567"], ["p2", "+639171234568"]]) {
    data().set(`persons/${id}`, { phone }); data().set(`smsContacts/${id}`, { phone, permission: true, optedOut: false, revision: 1 });
  }
});
afterEach(() => { vi.restoreAllMocks(); });
it("previews immutable eligible recipients without queueing or sending", async () => {
  data().get("smsContacts/p2")!.optedOut = true;
  const preview = await previewSmsCampaign("admin", body); expect(preview.count).toBe(1); expect(preview.excluded).toBe(1);
  expect([...data().keys()].some(key => key.startsWith("smsMessages/"))).toBe(false); expect(state.send).not.toHaveBeenCalled();
  expect(await previewSmsCampaign("admin", body)).toEqual(preview);
  await expect(previewSmsCampaign("admin", { ...body, text: "Changed" })).rejects.toMatchObject({ status: 409 });
});
it("dispatches once under duplicate/concurrent requests and preserves the preview message", async () => {
  const { id } = await previewSmsCampaign("admin", body);
  await Promise.all([dispatchSmsCampaign("admin", { campaignId: id }), dispatchSmsCampaign("admin", { campaignId: id })]);
  const progress = await smsCampaignProgress(id); expect(progress.totals.queued).toBe(2);
  expect([...data()].filter(([key]) => key.startsWith("smsMessages/")).every(([, message]) => message.text === body.text)).toBe(true);
  expect([...data()].filter(([key, event]) => key.startsWith("auditEvents/") && event.action === "sms-campaign-dispatched")).toHaveLength(1);
});
it.each(["optout", "phone", "consent-revision"])("excludes audience changes after preview: %s", async kind => {
  const { id } = await previewSmsCampaign("admin", body);
  if (kind === "optout") data().get("smsContacts/p2")!.optedOut = true;
  if (kind === "phone") data().get("persons/p2")!.phone = "+639179999999";
  if (kind === "consent-revision") data().get("smsContacts/p2")!.revision = 2;
  await dispatchSmsCampaign("admin", { campaignId: id });
  expect((await smsCampaignProgress(id)).totals).toEqual({ queued: 1, cancelled: 1 });
});
it("does not recreate private messages for deleted profiles", async () => {
  const { id } = await previewSmsCampaign("admin", body); data().delete("persons/p2");
  await dispatchSmsCampaign("admin", { campaignId: id }); expect((await smsCampaignProgress(id)).totals).toEqual({ queued: 1, removed: 1 });
});
it("derives mixed outcomes from actual worker results without marking acceptance delivered", async () => {
  state.send.mockResolvedValueOnce({ outcome: "accepted", code: 202, state: "Pending" }).mockResolvedValueOnce({ outcome: "rejected", code: 400, state: null });
  const { id } = await previewSmsCampaign("admin", body); await dispatchSmsCampaign("admin", { campaignId: id }); await runSmsWorker();
  const progress = await smsCampaignProgress(id); expect(progress.totals).toEqual({ accepted: 1, failed: 1 });
  expect(progress.totals.delivered).toBeUndefined(); expect(state.send).toHaveBeenCalledTimes(2);
});
it("rechecks opt-out again between dispatch and the worker", async () => {
  state.send.mockResolvedValue({ outcome: "accepted", code: 202, state: "Pending" });
  const { id } = await previewSmsCampaign("admin", body); await dispatchSmsCampaign("admin", { campaignId: id });
  data().get("smsContacts/p2")!.optedOut = true; await runSmsWorker(); expect(state.send).toHaveBeenCalledTimes(1);
  expect((await smsCampaignProgress(id)).totals).toEqual({ accepted: 1, cancelled: 1 });
});
it("deduplicates repeated phone numbers and rejects empty/oversized/stale previews", async () => {
  data().get("persons/p2")!.phone = "+639171234567"; data().get("smsContacts/p2")!.phone = "+639171234567";
  const { id, count } = await previewSmsCampaign("admin", body); expect(count).toBe(1);
  await expect(previewSmsCampaign("admin", { ...body, personIds: [] })).rejects.toMatchObject({ status: 400 });
  await expect(previewSmsCampaign("admin", { ...body, personIds: Array(101).fill("p1") })).rejects.toMatchObject({ status: 400 });
  data().get(`smsCampaigns/${id}`)!.createdAt = Date.now() - 30 * 60_000 - 1;
  await expect(dispatchSmsCampaign("admin", { campaignId: id })).rejects.toMatchObject({ code: "campaign-preview-expired" });
});
