import type { LeadSource, RateCategory } from "@/lib/finance/contracts";
export const LEAD_SOURCES: Array<[LeadSource, string]> = [["ads", "Ads"], ["facebook", "Facebook Page"], ["google", "Google Search"], ["friends", "Friends"], ["signage", "Physical Signage"], ["others", "Others"]];
export interface RegistrationFields { rateCategory: RateCategory; leadSource: LeadSource; leadSourceOther: string | null }
export function registrationFields(data: Record<string, unknown>): RegistrationFields {
  if (data.rateCategory !== "student" && data.rateCategory !== "regular") throw new Error("Choose Student or Regular.");
  if (!LEAD_SOURCES.some(([source]) => source === data.leadSource)) throw new Error("Choose where you heard about Tibay Gym.");
  const other = typeof data.leadSourceOther === "string" ? data.leadSourceOther.trim() : "";
  if (data.leadSource === "others" && (!other || other.length > 300)) throw new Error("Tell us where you heard about Tibay Gym (up to 300 characters).");
  return { rateCategory: data.rateCategory, leadSource: data.leadSource as LeadSource, leadSourceOther: data.leadSource === "others" ? other : null };
}
