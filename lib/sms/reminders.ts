import { philippineDate } from "@/lib/finance/rules";
import type { SmsMessage, SmsSettings } from "./contracts";
const DAY = 86_400_000;
export function timestampMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    const ms = value.toMillis(); return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
  }
  return null;
}
export function dailySmsTime(now: number, settings: SmsSettings) {
  return Date.parse(`${philippineDate(now)}T${settings.sendTime}:00+08:00`);
}
export interface ReminderCandidate {
  key: string; purpose: "expiry" | "inactivity"; text: string; scheduledAt: number;
  expirySnapshot: string | null; reminderOffset: number | null; lastVisitSnapshot: number | null;
}
export function dueReminders(personId: string, person: Record<string, unknown>, settings: SmsSettings, now: number): ReminderCandidate[] {
  if (person.type !== "member" || person.deletingAt || now < dailySmsTime(now, settings)) return [];
  const expiry = timestampMillis(person.membershipExpiry), lastVisit = timestampMillis(person.lastVisitAt);
  const result: ReminderCandidate[] = [], scheduledAt = dailySmsTime(now, settings);
  if (expiry !== null) {
    const days = Math.round((Date.parse(philippineDate(expiry)) - Date.parse(philippineDate(now))) / DAY);
    if ([7, 5, 1].includes(days)) result.push({ key: `expiry:${personId}:${expiry}:${days}`, purpose: "expiry", scheduledAt,
      text: settings.expiryTemplate.replaceAll("{expiry}", philippineDate(expiry)).replaceAll("{days}", String(days)),
      expirySnapshot: String(expiry), reminderOffset: days, lastVisitSnapshot: null });
  }
  // No-visit members are deliberately excluded. A new visit creates a new episode.
  if (lastVisit !== null && now - lastVisit > 10 * DAY) result.push({ key: `inactivity:${personId}:${lastVisit}`, purpose: "inactivity", scheduledAt,
    text: settings.inactivityTemplate, expirySnapshot: null, reminderOffset: null, lastVisitSnapshot: lastVisit });
  return result;
}
export function reminderStillCurrent(message: Pick<SmsMessage, "purpose" | "scheduledAt" | "expirySnapshot" | "reminderOffset" | "lastVisitSnapshot">, person: Record<string, unknown>, settings: SmsSettings, now: number): "current" | "wait" | "obsolete" {
  if (message.purpose !== "expiry" && message.purpose !== "inactivity") return "current";
  if (person.type !== "member" || person.deletingAt) return "obsolete";
  if (message.purpose === "expiry") {
    if (String(timestampMillis(person.membershipExpiry)) !== message.expirySnapshot || philippineDate(message.scheduledAt) !== philippineDate(now)) return "obsolete";
    const offset = Math.round((Date.parse(philippineDate(Number(message.expirySnapshot))) - Date.parse(philippineDate(now))) / DAY);
    if (offset !== message.reminderOffset) return "obsolete";
  } else if (timestampMillis(person.lastVisitAt) !== message.lastVisitSnapshot || message.lastVisitSnapshot === null || now - message.lastVisitSnapshot <= 10 * DAY) return "obsolete";
  return now < dailySmsTime(now, settings) ? "wait" : "current";
}
