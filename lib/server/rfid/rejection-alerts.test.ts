import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ event: undefined as Record<string, unknown> | undefined, update: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: () => ({
  doc: (path: string) => ({ path }),
  runTransaction: async (work: (tx: unknown) => Promise<void>) => work({
    get: async () => ({ data: () => mocks.event }),
    set: vi.fn(), update: (_: unknown, fields: Record<string, unknown>) => { mocks.update(fields); Object.assign(mocks.event!, fields); },
  }),
}) }));
vi.mock("./auth", () => ({ requireAdmin: mocks.admin }));
import { dismissRejectedMemberTap } from "./rejection-alerts";
import { POST } from "@/app/api/rfid/admin/alerts/route";
import { ApiError } from "./http";
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue("admin"); mocks.event = { resultCode: "expired-member", dismissedAt: null, occurredAt: "original", personId: "p1" }; });
it("persists dismissal once without removing or rewriting the rejection", async () => {
  await dismissRejectedMemberTap("event");
  const dismissedAt = mocks.event!.dismissedAt;
  await dismissRejectedMemberTap("event");
  expect(mocks.update).toHaveBeenCalledTimes(1);
  expect(mocks.event).toEqual({ resultCode: "expired-member", dismissedAt, occurredAt: "original", personId: "p1" });
});
it("does not recreate an event removed by profile deletion or retention", async () => {
  mocks.event = undefined;
  await dismissRejectedMemberTap("event");
  expect(mocks.update).not.toHaveBeenCalled();
});
it("rejects unknown-card diagnostics and invalid document paths", async () => {
  mocks.event!.resultCode = "unknown-card";
  await expect(dismissRejectedMemberTap("event")).rejects.toMatchObject({ code: "invalid-alert" });
  await expect(dismissRejectedMemberTap("bad/path")).rejects.toMatchObject({ code: "invalid-id" });
  expect(mocks.update).not.toHaveBeenCalled();
});
it("requires admin authorization before dismissing", async () => {
  mocks.admin.mockRejectedValue(new ApiError(403, "admin-required"));
  const response = await POST(new Request("https://example.com/api/rfid/admin/alerts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: "event" }),
  }));
  expect(response.status).toBe(403);
  expect(mocks.update).not.toHaveBeenCalled();
});
