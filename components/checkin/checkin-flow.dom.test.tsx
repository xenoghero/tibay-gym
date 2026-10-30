// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckInFlow } from "./checkin-flow";
import { PublicEntry } from "./public-entry";

// Keep image/framework resources out of the request trace; attendance code is real.
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }));
let clock: number;
let loseScan: boolean;
let lookupMissing: boolean;
let backendError: string | null;
let openVisit: boolean;
const NOW = 1800000000000;
const outgoing: Array<{ path: string; body: Record<string, unknown> }> = [];
const getPosition = vi.fn<(success: PositionCallback, failure?: PositionErrorCallback | null, options?: PositionOptions) => void>();
const fetchMock = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
  const path = String(url);
  if (!["/api/attendance/lookup", "/api/attendance/scan", "/api/attendance/register"].includes(path)) throw new Error("Unexpected external/database/sweep request");
  const body = JSON.parse(String(options?.body)); outgoing.push({ path, body });
  if (backendError) return Response.json({ error: backendError }, { status: 422 });
  if (path.endsWith("lookup")) return Response.json({
    person: lookupMissing ? null : { id: "p1", name: "Alex", type: "member", status: "active", membershipExpiryMs: NOW + 86400000, visitCount: 0 },
    ...(body.intent === "checkout" ? { expectedLogId: "existing-log" } : {}),
  });
  if (loseScan) { loseScan = false; throw new Error("Sensitive transport details must not be displayed"); }
  if (path.endsWith("register")) return Response.json({ personId: "pending-1" });
  const action = openVisit ? "checked-out" : "checked-in";
  openVisit = !openVisit;
  return Response.json({ action,
    personId: "p1", checkInAtMs: NOW, visitCount: 1 });
});
beforeEach(() => {
  vi.clearAllMocks(); clock = NOW; loseScan = false; lookupMissing = false; backendError = null; openVisit = false; outgoing.length = 0;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("isSecureContext", false);
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: getPosition } });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  localStorage.clear(); sessionStorage.clear();
  vi.spyOn(Storage.prototype, "setItem");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function submit() {
  await act(async () => { fireEvent.submit(document.querySelector("form")!); });
}
function mount() {
  render(<CheckInFlow />);
  fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "09123456789" } });
}
it("Create Account opens all profile fields directly without renewal or payment controls", () => {
  render(<PublicEntry />);
  expect(screen.queryByText("Renewal and payment status")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
  for (const label of ["Name", "Phone number", /Address/, "Where did you know Tibay Gym?"]) {
    expect(screen.getByLabelText(label)).toBeDefined();
  }
  expect(screen.queryByRole("group", { name: "Daily payment method" })).toBeNull();
  expect(screen.queryByText("Renewal and payment status")).toBeNull();
  expect(screen.getByRole("group", { name: "Rate category" })).toBeDefined();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Back to welcome/ }));
  fireEvent.click(screen.getByRole("button", { name: "Check In" }));
  expect(screen.getByLabelText("Phone number")).toBeDefined();
  expect(screen.queryByLabelText("Name")).toBeNull();
});
it("creating an account saves it without a payment or attendance request", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ personId: "pending-1" }));
  render(<CheckInFlow registrationIntent />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sam" } });
  fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "09123456789" } });
  fireEvent.click(screen.getByRole("radio", { name: /Student/ }));
  fireEvent.change(screen.getByLabelText("Where did you know Tibay Gym?"), { target: { value: "friends" } });
  await submit();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toBe("/api/attendance/register");
  expect(screen.getByText("Account created")).toBeDefined();
  expect(screen.getByText(/awaiting admin verification/i)).toBeDefined();
  expect(screen.queryByRole("group", { name: "Daily payment method" })).toBeNull();
  expect(screen.queryByText("Checked in")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check in now" }));
  expect(screen.getByLabelText<HTMLInputElement>("Phone number").value).toBe("09123456789");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("phone input keeps only digits and caps typed or pasted values at 11 digits", () => {
  render(<CheckInFlow />);
  const input = screen.getByLabelText<HTMLInputElement>("Phone number");
  fireEvent.change(input, { target: { value: "+09a12-345 67890!" } });
  expect(input.value).toBe("09123456789");
  expect(input.checkValidity()).toBe(true);
  fireEvent.change(input, { target: { value: "letters!?" } });
  expect(input.value).toBe("");
  expect(input.checkValidity()).toBe(false);
});
it("daily payment keeps the amount visible and submits the selected cash method", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({
    person: { id: "p1", name: "Alex", type: "guest", visitCount: 2 },
    paymentDue: { amountMinor: 7000, expiredMember: false, gcashAvailable: false },
  }));
  mount(); await submit();
  expect(screen.getAllByText("₱70.00")).toHaveLength(2);
  expect(screen.getByRole<HTMLInputElement>("radio", { name: /GCash/ }).disabled).toBe(true);
  expect(screen.queryByLabelText("GCash receipt")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: /Cash Pay/ }));
  await submit();
  expect(outgoing.at(-1)).toMatchObject({ path: "/api/attendance/scan", body: { paymentMethod: "cash", expectedAmountMinor: 7000 } });
  expect(screen.getByText("Checked in")).toBeDefined();
});
it("GCash reveals a required receipt and selecting cash removes that requirement", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({
    person: { id: "p1", name: "Alex", type: "guest", visitCount: 2 },
    paymentDue: { amountMinor: 7000, expiredMember: false, gcashAvailable: true },
  }));
  mount(); await submit();
  fireEvent.click(screen.getByRole("radio", { name: /GCash/ }));
  expect(screen.getByLabelText<HTMLInputElement>("GCash receipt").required).toBe(true);
  expect(document.querySelector("form")!.checkValidity()).toBe(false);
  fireEvent.click(screen.getByRole("radio", { name: /Cash Pay/ }));
  expect(screen.queryByLabelText("GCash receipt")).toBeNull();
  expect(document.querySelector("form")!.checkValidity()).toBe(true);
});
it("shows configured bank details and QR only for the selected daily payment account", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ person: { id: "p1", name: "Alex", type: "guest", visitCount: 2 },
    paymentDue: { amountMinor: 7000, expiredMember: false, gcashAvailable: true, paymentRevision: 3, paymentAccounts: [
      { id: "account_bank0001", kind: "bank", name: "BPI savings", accountHolder: "Tibay Gym", accountNumber: "0012345678", qrImage: "data:image/png;base64,AAAA", enabled: true },
    ] } }));
  mount(); await submit();
  expect(screen.queryByRole("radio", { name: /GCash/ })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: /BPI savings/ }));
  expect(screen.getByText("0012345678")).toBeTruthy();
  expect(screen.getByRole("img", { name: "BPI savings payment QR code" })).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Payment receipt").required).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: /Cash Pay/ }));
  expect(screen.queryByRole("img", { name: "BPI savings payment QR code" })).toBeNull();
  expect(screen.queryByLabelText("Payment receipt")).toBeNull();
});
it("an incomplete phone cannot submit attendance", async () => {
  render(<CheckInFlow />);
  const input = screen.getByLabelText<HTMLInputElement>("Phone number");
  fireEvent.change(input, { target: { value: "0912345678" } });
  expect(input.checkValidity()).toBe(false);
  await submit();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toMatch(/11-digit/);
});
it("page mount/hydration starts no acquisition, attendance/sweep or direct Firestore request", async () => {
  mount(); await act(async () => {});
  expect(fetchMock).not.toHaveBeenCalled(); expect(getPosition).not.toHaveBeenCalled();
  expect(screen.queryByRole("radio")).toBeNull();
});
it("known-person submission makes lookup + scan without requesting device position", async () => {
  mount(); await submit();
  expect(outgoing.map(row => row.path)).toEqual(["/api/attendance/lookup", "/api/attendance/scan"]);
  expect(getPosition).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Alex" })).toBeDefined();
  expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByLabelText<HTMLInputElement>("Phone number").value).toBe("");
  expect(outgoing).toHaveLength(2);
});
it("the same phone form checks in on the first submission and checks out on the second", async () => {
  mount(); await submit();
  expect(screen.getByText("Checked in")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  clock += 60000;
  fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "09123456789" } });
  loseScan = true;
  await submit();
  expect(screen.getByLabelText<HTMLInputElement>("Phone number").disabled).toBe(true);
  expect(screen.queryByRole("radio")).toBeNull();
  await submit();
  expect(getPosition).not.toHaveBeenCalled();
  expect(outgoing.every(row => !Object.hasOwn(row.body, "location"))).toBe(true);
  expect(outgoing[3].body).toEqual(outgoing[4].body);
  expect(outgoing.filter(row => row.path.endsWith("scan")).every(row => row.body.intent === "attendance")).toBe(true);
  expect(outgoing[1].body.eventId).not.toBe(outgoing[3].body.eventId);
  expect(screen.getByText("Checked out")).toBeDefined();
});
it("lost response locks phone, retries the original identity and renders no premature receipt", async () => {
  loseScan = true; mount(); await submit();
  expect(screen.getByRole("alert").textContent).toMatch(/Earlier attendance is still unconfirmed/);
  expect(screen.queryByRole("heading", { name: "Alex" })).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("Phone number").disabled).toBe(true);
  expect(screen.queryByRole("radio")).toBeNull();
  clock += 4000; await submit();
  expect(outgoing[2].body).toEqual(outgoing[1].body);
  expect(screen.getByRole("heading", { name: "Alex" })).toBeDefined();
});
it("guest form delay preserves capture; uncertainty locks name, address and reset", async () => {
  lookupMissing = true; mount(); await submit(); clock += 90000;
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sam" } });
  fireEvent.change(screen.getByLabelText(/Address/), { target: { value: "Street" } });
  fireEvent.click(screen.getByRole("radio", { name: /Student/ }));
  fireEvent.change(screen.getByLabelText("Where did you know Tibay Gym?"), { target: { value: "friends" } });
  loseScan = true; await submit();
  expect(screen.getByLabelText<HTMLInputElement>("Name").disabled).toBe(true);
  expect(screen.getByLabelText<HTMLTextAreaElement>(/Address/).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: /different number/ }).disabled).toBe(true);
  expect(outgoing[1]).toMatchObject({ path: "/api/attendance/register", body: { phone: "09123456789", name: "Sam", address: "Street" } });
  await submit(); expect(outgoing[2].body).toEqual(outgoing[1].body);
  expect(screen.getByText("Account created")).toBeDefined();
  expect(getPosition).not.toHaveBeenCalled(); expect(Storage.prototype.setItem).not.toHaveBeenCalled();
});
it("offline state stops all acquisition and network requests", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  mount(); await submit();
  expect(screen.getByRole("alert").textContent).toMatch(/offline/);
  expect(fetchMock).not.toHaveBeenCalled(); expect(getPosition).not.toHaveBeenCalled();
});
it("deadline timer disables recovery and synthetic form resubmission cannot replace an expired event", async () => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  loseScan = true; mount(); await submit();
  await act(async () => { clock += 30001; await vi.advanceTimersByTimeAsync(30001); });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Attendance unconfirmed" }).disabled).toBe(true);
  await submit(); expect(outgoing).toHaveLength(2);
  expect(screen.getByRole("alert").textContent).toMatch(/recovery window has ended/);
  expect(Storage.prototype.setItem).not.toHaveBeenCalled();
});
it("shows server wait time, blocks resubmission, and enables retry when the countdown ends", async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValueOnce(Response.json({ error: "rate-limited", retryAfterSeconds: 24 },
    { status: 429, headers: { "Retry-After": "24" } }));
  mount(); await submit();
  expect(screen.getByText("Try again in 24 seconds.")).toBeDefined();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Please wait" }).disabled).toBe(true);
  await submit(); expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => { clock += 23000; await vi.advanceTimersByTimeAsync(23000); });
  expect(screen.getByText("Try again in 1 second.")).toBeDefined();
  await act(async () => { clock += 1000; await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Retry" }).disabled).toBe(false);
  await submit();
  expect(screen.getByText("Checked in")).toBeDefined();
});
