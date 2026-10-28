import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { lookupSms, sendSms, smsProviderReady } from "./sms-provider";
import type { SmsMessage } from "@/lib/sms/contracts";
const message = { providerMessageId: "stable-id", destination: "+639171234567", text: "Hello" } as SmsMessage;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function setup() { vi.stubEnv("SMS_GATEWAY_URL", "http://192.168.1.10:8080"); vi.stubEnv("SMS_GATEWAY_TOKEN", "private-token"); }
it("requires private configuration", () => { vi.stubEnv("SMS_GATEWAY_URL", ""); expect(smsProviderReady()).toBe(false); });
it("sends modern API payload with stable IDs and delivery reports", async () => {
  setup(); const fetch = vi.fn().mockResolvedValue(Response.json({ id: "stable-id", state: "Pending" }, { status: 202 })); vi.stubGlobal("fetch", fetch);
  expect(await sendSms(message)).toEqual({ outcome: "accepted", code: 202, state: "Pending" });
  const [url, request] = fetch.mock.calls[0]; expect(url).toBe("http://192.168.1.10:8080/messages");
  expect(JSON.parse(request.body)).toMatchObject({ id: "stable-id", textMessage: { text: "Hello" }, withDeliveryReport: true, ttl: 3600 });
  expect(request.redirect).toBe("error");
});
it.each([500, 409, 202])("holds ambiguous HTTP response %s", async status => {
  setup(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ unexpected: "body" }, { status })));
  expect((await sendSms(message)).outcome).toBe("uncertain");
});
it("looks up by stable ID and keeps missing sends uncertain", async () => {
  setup(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  expect((await lookupSms(message)).outcome).toBe("missing");
});
