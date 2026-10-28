import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "./memory-firestore";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: mocks.db }));
vi.mock("@/lib/server/public-rate-limit", () => ({ publicCaller: () => "test", publicRateLimiter: { consume: vi.fn() } }));
vi.mock("@/lib/server/rfid/rate-limit", () => ({ throttle: vi.fn() }));
import { POST as register } from "@/app/api/attendance/register/route";
import { POST as lookup } from "@/app/api/attendance/lookup/route";
import { POST as scan } from "@/app/api/attendance/scan/route";
import { approveUnverified, deleteUnverified } from "@/lib/server/unverified";
import { DEFAULT_SETTINGS } from "@/lib/finance/rules";

let store: ReturnType<typeof memoryFirestore>;
const body = { eventId: "registration-operation-0001", phone: "09999999999", name: "Sam", address: "Street",
  rateCategory: "student", leadSource: "friends", leadSourceOther: null };
const request = (data: unknown) => new Request("https://tibay.test/api", { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
const rows = (collection: string) => [...store.data].filter(([path]) => path.startsWith(`${collection}/`));
beforeEach(() => {
  store = memoryFirestore(); mocks.db.mockReturnValue(store.db);
  store.data.set("gymSettings/finance", { ...DEFAULT_SETTINGS, financialCutoverAt: Date.now() - 1, rateRevision: 1 });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("immediately saves an unverified account with zero visits and no payment", async () => {
  const response = await register(request(body));
  expect(response.status).toBe(200);
  const { personId } = await response.json();
  expect(store.data.get(`unverifiedPersons/${personId}`)).toMatchObject({ name: "Sam", phone: body.phone,
    address: "Street", rateCategory: "student", visitCount: 0, lastVisitAt: null });
  expect(store.data.get(`unverifiedAttendanceState/${personId}`)).toMatchObject({ openLogId: null, lastAction: null });
  for (const collection of ["persons", "attendanceLogs", "unverifiedAttendanceLogs", "charges", "paymentRequests"])
    expect(rows(collection)).toHaveLength(0);
  expect(await (await lookup(request({ phone: body.phone }))).json()).toMatchObject({ person: { id: personId, unverified: true, visitCount: 0 } });
});

it("can approve an account before its first check-in", async () => {
  const { personId } = await (await register(request(body))).json();
  await approveUnverified(personId, "admin");
  expect(store.data.get(`persons/${personId}`)).toMatchObject({ visitCount: 0, lastVisitAt: null, verifiedBy: "admin" });
  expect(rows("unverifiedPersons")).toHaveLength(0);
  expect(rows("attendanceLogs")).toHaveLength(0);
  expect(store.data.get(`profileDetails/${personId}`)).toMatchObject({ address: "Street" });
  expect((await register(request(body))).status).toBe(200);
  expect(rows("unverifiedPersons")).toHaveLength(0);
});

it("can check in later using the saved profile", async () => {
  const { personId } = await (await register(request(body))).json();
  const missingPayment = await scan(request({ eventId: "unpaid-checkin-operation-01", requestedAt: Date.now(), personId }));
  expect(missingPayment.status).toBe(409);
  expect(store.data.get(`unverifiedPersons/${personId}`)?.visitCount).toBe(0);
  const response = await scan(request({ eventId: "later-checkin-operation-01", requestedAt: Date.now(), personId,
    paymentMethod: "cash", expectedAmountMinor: 6000 }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ action: "checked-in", visitCount: 1, unverified: true });
  expect(rows("unverifiedPersons")).toHaveLength(1);
  expect(rows("unverifiedAttendanceLogs")).toHaveLength(1);
  expect(rows("charges")).toHaveLength(1);
});

it("deduplicates retries and concurrent registrations for the same phone", async () => {
  const first = await register(request(body));
  const retry = await register(request(body));
  expect(await retry.json()).toEqual(await first.json());
  const responses = await Promise.all(["other-registration-00001", "other-registration-00002"].map(eventId => register(request({ ...body, eventId }))));
  expect(responses.map(response => response.status)).toEqual([409, 409]);
  expect(rows("unverifiedPersons")).toHaveLength(1);
  expect(rows("auditEvents")).toHaveLength(1);
});

it("rejects duplicate official phones and invalid registration details", async () => {
  store.data.set("persons/existing", { phone: body.phone });
  expect((await register(request(body))).status).toBe(409);
  for (const patch of [{ phone: "123" }, { name: "" }, { rateCategory: "" }, { paymentMethod: "cash" }])
    expect((await register(request({ ...body, ...patch }))).status).toBe(400);
  expect(rows("unverifiedPersons")).toHaveLength(0);
});

it("does not recreate a rejected account when an old request is retried", async () => {
  const { personId } = await (await register(request(body))).json();
  await deleteUnverified(personId);
  expect((await register(request(body))).status).toBe(409);
  expect(rows("unverifiedPersons")).toHaveLength(0);
});
