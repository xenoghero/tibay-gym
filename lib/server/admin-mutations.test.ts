import { beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null }));
vi.mock("./firebase-admin", () => ({ adminDb: () => state.store!.db }));
import { mutateAdmin } from "./admin-mutations";
import { deleteProfile } from "./attendance-admin";
import { auditValues } from "./audit";
import { newProfileQuote, paymentReviewPreview, decidePayment } from "./purchases";
import { DEFAULT_SETTINGS } from "@/lib/finance/rules";
let sequence = 0;
const input = { rateCategory: "student", leadSource: "friends", phone: "09123456789", name: "Private name", type: "guest", status: null, membershipExpiry: null, joinDate: null, rfidTagId: "FA:KE:00:01" };
const body = (action: string, rest: Record<string, unknown> = {}) => ({ action, operationId: `admin-operation-${++sequence}`, ...rest });
const audit = () => [...state.store!.data].filter(([path]) => path.startsWith("auditEvents/"));
beforeEach(() => { state.store = memoryFirestore(); sequence = 0; });
it("creates a guarded profile and audit together; ignores forged card and actor fields", async () => {
  const request = body("profile-create", { input, actorId: "forged", details: { birthDate: null, address: "Private address" } });
  const result = await mutateAdmin("admin", request);
  expect(result.id).toBeTruthy();
  expect(state.store!.data.get(`persons/${result.id}`)).toMatchObject({ rfidTagId: null, visitCount: 0 });
  expect(state.store!.data.has(`attendanceState/${result.id}`)).toBe(true);
  expect(audit()).toHaveLength(1); expect(audit()[0][1].actorId).toBe("admin");
  expect(JSON.stringify(audit())).not.toMatch(/Private name|Private address|09123456789|FA:KE/);
  expect(await mutateAdmin("admin", request)).toEqual(result);
  expect(audit()).toHaveLength(1);
  await expect(mutateAdmin("admin", { ...request, input: { ...input, name: "Changed" } })).rejects.toMatchObject({ status: 409 });
});
it("checks uniqueness and validates fields before committing any records", async () => {
  await mutateAdmin("admin", body("profile-create", { input }));
  const size = state.store!.data.size;
  await expect(mutateAdmin("admin", body("profile-create", { input }))).rejects.toMatchObject({ code: "phone-conflict" });
  await expect(mutateAdmin("admin", body("profile-create", { input: { ...input, phone: "123" } }))).rejects.toMatchObject({ code: "invalid-phone" });
  expect(state.store!.data.size).toBe(size);
});
it("preserves independent RFID ownership and existing history when profiles change", async () => {
  state.store!.data.set("persons/p1", { ...input, rfidTagId: "69:1A:71:9E", visitCount: 7 });
  await mutateAdmin("admin", body("profile-update", { personId: "p1", input }));
  await expect(mutateAdmin("admin", body("convert", { personId: "p1", input: { status: "active", membershipExpiry: null, joinDate: null } }))).rejects.toMatchObject({ code: "purchase-review-required" });
  await expect(mutateAdmin("admin", body("revert-conversion", { personId: "p1" }))).rejects.toMatchObject({ code: "purchase-review-required" });
  expect(state.store!.data.get("persons/p1")).toMatchObject({ rfidTagId: "69:1A:71:9E", visitCount: 7, type: "guest" });
  expect(audit()).toHaveLength(1);
});
it("closes legacy direct renewals so purchases cannot bypass payment approval", async () => {
  const oldExpiry = Date.now() - 86400000;
  state.store!.data.set("persons/p1", { ...input, type: "member", status: "expired", membershipExpiry: Timestamp.fromMillis(oldExpiry), visitCount: 42 });
  await expect(mutateAdmin("admin", body("renew", { personId: "p1", expectedStatus: "expired", expectedExpiryMs: oldExpiry, expiry: { $timestamp: Date.now() + 86400000 * 30 } }))).rejects.toMatchObject({ code: "purchase-review-required" });
  expect(state.store!.data.get("persons/p1")).toMatchObject({ status: "expired", visitCount: 42 });
  expect(audit()).toHaveLength(0);
});
it("rejects invalid expiry, unavailable records and invalid weights without audit success events", async () => {
  const now = Date.now();
  state.store!.data.set("persons/p1", { ...input, type: "member", status: "active", membershipExpiry: Timestamp.fromMillis(now + 86400000) });
  await expect(mutateAdmin("admin", body("renew", { personId: "p1", expectedStatus: "active", expectedExpiryMs: now + 86400000, expiry: { $timestamp: now } }))).rejects.toMatchObject({ code: "purchase-review-required" });
  await expect(mutateAdmin("admin", body("weight-create", { personId: "p1", input: { weightKg: -1, measuredAt: { $timestamp: now } } }))).rejects.toMatchObject({ code: "invalid-weight" });
  state.store!.data.get("persons/p1")!.deletingAt = Timestamp.now();
  await expect(mutateAdmin("admin", body("profile-update", { personId: "p1", input }))).rejects.toMatchObject({ code: "person-unavailable" });
  expect(audit()).toHaveLength(0);
});
it("creates, updates and deletes weight records behind audited operations", async () => {
  state.store!.data.set("persons/p1", input);
  const result = await mutateAdmin("admin", body("weight-create", { personId: "p1", input: { weightKg: 65.44, measuredAt: { $timestamp: Date.now() } } }));
  expect(state.store!.data.get(`weightEntries/${result.id}`)?.weightKg).toBe(65.4);
  await mutateAdmin("admin", body("weight-update", { id: result.id, input: { weightKg: 66, measuredAt: { $timestamp: Date.now() } } }));
  await mutateAdmin("admin", body("weight-delete", { id: result.id }));
  expect(state.store!.data.has(`weightEntries/${result.id}`)).toBe(false); expect(audit()).toHaveLength(3);
});
it("retains minimal financial and audit history through repeated deletion", async () => {
  state.store!.data.set("persons/p1", input);
  state.store!.data.set("profileDetails/p1", { address: "private" });
  state.store!.data.set("charges/c1", { personId: "p1", amountMinor: 6000 });
  state.store!.data.set("paymentRequests/r1", { personId: "p1", chargeId: "c1" });
  await deleteProfile("p1", "admin"); await deleteProfile("p1", "admin");
  expect(state.store!.data.has("persons/p1")).toBe(false); expect(state.store!.data.has("profileDetails/p1")).toBe(false);
  expect(state.store!.data.has("charges/c1")).toBe(true); expect(state.store!.data.has("paymentRequests/r1")).toBe(true);
  expect(audit()).toHaveLength(2);
});
it("uses an allowlist for audit values instead of logging arbitrary nested payloads", () => {
  expect(auditValues({ name: "secret", phone: "secret", token: "secret", rawText: "secret", credentialHash: "secret", status: "active", arbitrary: { secret: true } })).toEqual({ status: "active" });
});
it("creates an admin-entered membership profile and pending financial records atomically before payment approval", async () => {
  state.store!.data.set("gymSettings/finance", { ...DEFAULT_SETTINGS, financialCutoverAt: Date.now() - 1, studentMonthlyMinor: 100000 });
  const quote = await newProfileQuote("student");
  const result = await mutateAdmin("admin", body("profile-create", { input: { ...input, type: "member", status: "active" }, financial: { quoteToken: quote.quoteToken } }));
  expect(state.store!.data.get(`persons/${result.id}`)).toMatchObject({ type: "guest", status: null, membershipExpiry: null });
  expect(result.paymentRequestId).toBeTruthy();
  const preview = await paymentReviewPreview(result.paymentRequestId);
  await decidePayment("admin", { paymentRequestId: result.paymentRequestId, previewToken: preview.previewToken, decision: "approve", reviewed: true });
  expect(state.store!.data.get(`persons/${result.id}`)).toMatchObject({ type: "member", status: "active", visitCount: 0, rfidTagId: null });
});
