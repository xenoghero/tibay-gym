import "server-only";
import type { SmsMessage } from "@/lib/sms/contracts";

function config() {
  const base = process.env.SMS_GATEWAY_URL?.replace(/\/$/, "");
  const token = process.env.SMS_GATEWAY_TOKEN;
  const username = process.env.SMS_GATEWAY_USERNAME, password = process.env.SMS_GATEWAY_PASSWORD;
  if (!base || (!token && (!username || !password))) throw new Error("sms-provider-unconfigured");
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("sms-provider-invalid");
  // This private environment setting is the only destination; request bodies cannot supply URLs.
  return { base, authorization: token ? `Bearer ${token}` : `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}
export function smsProviderReady(): boolean { try { config(); return true; } catch { return false; } }
export interface GatewayResult { outcome: "accepted" | "rejected" | "uncertain" | "missing"; code: number | null; state: string | null }
const states = new Set(["Pending", "Processed", "Sent", "Delivered", "Failed", "Cancelled", "Cancelling"]);
async function call(method: "GET" | "POST", message: SmsMessage): Promise<GatewayResult> {
  const { base, authorization } = config();
  try {
    const response = await fetch(`${base}/messages${method === "GET" ? `/${encodeURIComponent(message.providerMessageId)}` : ""}`, {
      method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify({ id: message.providerMessageId, textMessage: { text: message.text },
        phoneNumbers: [message.destination], withDeliveryReport: true, ttl: 3600,
        ...(process.env.SMS_GATEWAY_DEVICE_ID ? { deviceId: process.env.SMS_GATEWAY_DEVICE_ID } : {}) }) } : {}),
    });
    if (method === "GET" && response.status === 404) return { outcome: "missing", code: 404, state: null };
    // Only explicit validation/auth/rate rejections are safe to retry. 5xx, conflicts and malformed successes are indeterminate.
    if (!response.ok) return { outcome: [400, 401, 403, 422, 429].includes(response.status) ? "rejected" : "uncertain", code: response.status, state: null };
    const data = await response.json();
    if (data.id !== message.providerMessageId || typeof data.state !== "string" || !states.has(data.state)) return { outcome: "uncertain", code: response.status, state: null };
    return { outcome: "accepted", code: response.status, state: data.state };
  } catch { return { outcome: "uncertain", code: null, state: null }; }
}
export const sendSms = (message: SmsMessage) => call("POST", message);
export const lookupSms = (message: SmsMessage) => call("GET", message);
