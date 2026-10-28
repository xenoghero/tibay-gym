export interface SmsSettings {
  enabled: boolean;
  revision: number;
  sendTime: string;
  maxAttempts: number;
  policyConfirmed: boolean;
  expiryTemplate: string;
  inactivityTemplate: string;
}
export const DEFAULT_SMS_SETTINGS: SmsSettings = {
  enabled: false, revision: 0, sendTime: "09:00", maxAttempts: 3, policyConfirmed: false,
  expiryTemplate: "Tibay Gym: Your membership expires on {expiry} ({days} days). Visit the gym to renew. To stop SMS, ask the gym admin.",
  inactivityTemplate: "Tibay Gym: We miss you! It has been over 10 days since your last visit. See you at the gym. To stop SMS, ask the gym admin.",
};
export interface SmsContact {
  permission: boolean; optedOut: boolean; phone: string; revision: number; updatedAt: number;
}
export type SmsStatus = "queued" | "sending" | "uncertain" | "accepted" | "sent" | "delivered" | "failed" | "cancelled";
export interface SmsMessage {
  id: string; personId: string; campaignId: string | null; purpose: "test" | "expiry" | "inactivity" | "blast";
  destination: string; text: string; status: SmsStatus; scheduledAt: number; createdAt: number;
  attempts: number; leaseUntil: number; providerMessageId: string; providerState: string | null;
  errorCode: string | null; expirySnapshot: string | null; reminderOffset: number | null;
  lastVisitSnapshot: number | null; completedAt: number | null;
}
export interface SmsAttempt {
  messageId: string; attemptNumber: number; attemptedAt: number;
  responseCode: number | null; outcome: string;
}
export interface SmsCampaign {
  id: string; createdBy: string; messageSnapshot: string; audienceSnapshot: string[];
  audienceFingerprints: Record<string, string>; createdAt: number; dispatchRequestedAt: number | null;
}
