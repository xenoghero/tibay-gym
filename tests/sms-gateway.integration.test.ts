import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "./memory-firestore";
import { DEFAULT_SMS_SETTINGS } from "@/lib/sms/contracts";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: () => state.store!.db }));
// Deliberately use the real gateway adapter and worker. Only Firestore and the
// Android gateway are replaced; HTTP requests travel exclusively over loopback.
import { queueSmsTest, runSmsWorker, saveSmsSettings } from "@/lib/server/sms";
import { previewSmsCampaign, dispatchSmsCampaign, smsCampaignProgress } from "@/lib/server/sms-campaigns";
import { scanSmsReminders } from "@/lib/server/sms-reminders";

const START = Date.parse("2026-10-29T09:00:00+08:00"), DAY = 86400000;
let server: Server, now: number, postStatus: number, lookupStatus: number, gatewayState: string, disconnect: boolean;
const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
const data = () => state.store!.data;
const message = (id: string) => data().get(`smsMessages/${id}`)!;
const postCalls = () => calls.filter(c => c.method === "POST");
const queue = () => queueSmsTest("offline-admin", { personId: "offline-1", text: "Tibay Gym: Offline gateway simulation only.", operationId: "offline-sms-operation-01" });
async function enable() {
  await saveSmsSettings("offline-admin", { ...DEFAULT_SMS_SETTINGS, enabled: true, policyConfirmed: true, operationId: "offline-sms-settings-01" });
}
beforeEach(async () => {
  state.store = memoryFirestore(); calls.length = 0; now = START; postStatus = 202; lookupStatus = 200; gatewayState = "Pending"; disconnect = false;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  for (const [id, phone] of [["offline-1", "+639171234567"], ["offline-2", "+639171234568"]]) {
    data().set(`persons/${id}`, { name: "Synthetic offline fixture", phone, type: "member", membershipExpiry: START + 7 * DAY, lastVisitAt: START - 11 * DAY });
    data().set(`smsContacts/${id}`, { phone, permission: true, optedOut: false, revision: 1 });
  }
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    calls.push({ method: request.method!, path: request.url!, body });
    if (disconnect && request.method === "POST") { request.socket.destroy(); return; }
    const status = request.method === "POST" ? postStatus : lookupStatus;
    const id = request.method === "POST" ? body.id : decodeURIComponent(request.url!.slice("/messages/".length));
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id, state: gatewayState }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubEnv("SMS_GATEWAY_URL", base); vi.stubEnv("SMS_GATEWAY_TOKEN", "synthetic-offline-token"); vi.stubEnv("SMS_GATEWAY_DEVICE_ID", "offline-simulated-device");
  // Fail closed if this test accidentally targets any real service.
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${base}/messages`)) throw new Error("Offline SMS test forbids external network access");
    return realFetch(input, init);
  });
});
afterEach(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

it("runs real queue → HTTP adapter → accepted → sent → simulated delivered without a phone", async () => {
  const { id } = await queue(); expect(calls).toHaveLength(0);
  expect(await runSmsWorker()).toEqual({ disabled: true, processed: 0 }); expect(calls).toHaveLength(0);
  await enable(); await runSmsWorker();
  expect(message(id).status).toBe("accepted"); expect(message(id).completedAt).toBeNull();
  expect(postCalls()[0].body).toMatchObject({ id: message(id).providerMessageId, textMessage: { text: "Tibay Gym: Offline gateway simulation only." }, phoneNumbers: ["+639171234567"], withDeliveryReport: true, ttl: 3600, deviceId: "offline-simulated-device" });
  expect(String(postCalls()[0].body.id).length).toBeLessThanOrEqual(36);
  gatewayState = "Sent"; now += 300001; await runSmsWorker(); expect(message(id).status).toBe("sent");
  gatewayState = "Delivered"; now += 300001; await runSmsWorker(); expect(message(id)).toMatchObject({ status: "delivered", attempts: 1, providerState: "Delivered" });
  expect(postCalls()).toHaveLength(1);
  expect(calls.filter(c => c.method === "GET").every(c => c.path === `/messages/${message(id).providerMessageId}`)).toBe(true);
});
it("holds an offline phone/connection loss as uncertain and never blindly sends again", async () => {
  await enable(); const { id } = await queue(); disconnect = true; await runSmsWorker();
  expect(message(id)).toMatchObject({ status: "uncertain", attempts: 1 });
  disconnect = false; lookupStatus = 404;
  for (let i = 0; i < 3; i++) { now += 300001; await runSmsWorker(); }
  expect(message(id).status).toBe("uncertain"); expect(postCalls()).toHaveLength(1);
  gatewayState = "Failed"; lookupStatus = 200; now += 300001; await runSmsWorker();
  expect(message(id)).toMatchObject({ status: "failed", providerState: "Failed", attempts: 1 });
});
it("backs off explicit 429 rejections and stops after the configured three attempts", async () => {
  await enable(); const { id } = await queue(); postStatus = 429; await runSmsWorker();
  expect(message(id)).toMatchObject({ status: "queued", attempts: 1, scheduledAt: START + 120000 });
  await runSmsWorker(); expect(postCalls()).toHaveLength(1);
  now = Number(message(id).scheduledAt); await runSmsWorker();
  expect(message(id)).toMatchObject({ status: "queued", attempts: 2 });
  now = Number(message(id).scheduledAt); await runSmsWorker();
  expect(message(id)).toMatchObject({ status: "failed", attempts: 3 });
  now += DAY; await runSmsWorker(); expect(postCalls()).toHaveLength(3);
});
it.each([401, 403, 422])("marks explicit gateway rejection %s failed instead of claiming delivery", async status => {
  await enable(); const { id } = await queue(); postStatus = status; await runSmsWorker();
  expect(message(id)).toMatchObject({ status: "failed", attempts: 1 });
  expect(message(id).providerState).toBeNull(); now += DAY; await runSmsWorker(); expect(postCalls()).toHaveLength(1);
});
it("checks consent again before sending and skips an opted-out queued recipient", async () => {
  await enable(); const { id } = await queue(); data().get("smsContacts/offline-1")!.optedOut = true;
  await runSmsWorker(); expect(message(id)).toMatchObject({ status: "cancelled", errorCode: "contact-ineligible" }); expect(calls).toHaveLength(0);
});
it("sends only eligible campaign recipients through the real adapter and keeps acceptance separate", async () => {
  await enable(); const preview = await previewSmsCampaign("offline-admin", { personIds: ["offline-1", "offline-2"], text: "Tibay Gym: Simulated announcement.", operationId: "offline-campaign-operation" });
  expect(calls).toHaveLength(0); await dispatchSmsCampaign("offline-admin", { campaignId: preview.id });
  data().get("smsContacts/offline-2")!.optedOut = true;
  await runSmsWorker(); expect((await smsCampaignProgress(preview.id)).totals).toEqual({ accepted: 1, cancelled: 1 }); expect(postCalls()).toHaveLength(1);
});
it("cancels obsolete expiry/inactivity reminders after renewal and a new visit", async () => {
  await enable(); expect((await scanSmsReminders()).queued).toBe(4);
  for (const id of ["offline-1", "offline-2"]) { const person = data().get(`persons/${id}`)!; person.membershipExpiry = START + 30 * DAY; person.lastVisitAt = START; }
  await runSmsWorker(); expect(calls).toHaveLength(0);
  const messages = [...data()].filter(([path]) => path.startsWith("smsMessages/"));
  expect(messages).toHaveLength(4); expect(messages.every(([, row]) => row.status === "cancelled")).toBe(true);
});
