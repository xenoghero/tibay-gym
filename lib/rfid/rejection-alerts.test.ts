import { expect, it, vi } from "vitest";
import { Timestamp } from "firebase/firestore";
vi.mock("@/lib/firebase", () => ({ db: {} }));
import { formatRejectionTime, visibleRejections, REJECTION_ALERT_WINDOW_MS, type RejectionAlertEvent } from "./rejection-alerts";

const now = Date.parse("2026-09-18T01:00:00Z");
const event = (id: string, overrides: Partial<RejectionAlertEvent> = {}): RejectionAlertEvent => ({
  id, personId: "p1", resultCode: "expired-member", dismissedAt: null, occurredAt: Timestamp.fromMillis(now), ...overrides,
});
it("restores recent persisted alerts, deduplicates identities, and separates diagnostics/dismissals", () => {
  expect(visibleRejections([event("saved"), event("saved"), event("unknown", { resultCode: "unknown-card" }),
    event("dismissed", { dismissedAt: Timestamp.fromMillis(now) }), event("deleted", { personId: null }),
    event("old", { occurredAt: Timestamp.fromMillis(now - REJECTION_ALERT_WINDOW_MS - 1) })], now).map((e) => e.id)).toEqual(["saved"]);
  expect(visibleRejections([], now)).toEqual([]);
});
it("bounds a stack to the newest fifty events", () => {
  const events = Array.from({ length: 60 }, (_, i) => event(String(i), { occurredAt: Timestamp.fromMillis(now - i * 1000) }));
  const result = visibleRejections(events.reverse(), now);
  expect(result).toHaveLength(50);
  expect(result[0].id).toBe("0");
  expect(result.at(-1)?.id).toBe("49");
});
it("formats the tap date/time in the configured gym zone", () => {
  expect(formatRejectionTime(Timestamp.fromMillis(now))).toContain("9:00:00 AM");
  expect(formatRejectionTime(Timestamp.fromMillis(now))).toContain("Sep 18, 2026");
});
