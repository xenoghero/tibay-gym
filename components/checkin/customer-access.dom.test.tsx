// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/components/people/purchase-form", () => ({ PurchaseForm: ({ previousRequestId, onSubmitted }: { previousRequestId?: string; onSubmitted?: () => void }) => <><p>{previousRequestId ? `Replacing ${previousRequestId}` : "Restricted purchase form"}</p><button onClick={onSubmitted}>Submit payment request</button></> }));
vi.mock("./promotion-banner", () => ({ PromotionBanner: () => null }));
import { CustomerAccess } from "./customer-access";
let verified: boolean, logoutFails: boolean, customerName: string;
const calls: Array<{ method: string; url: string }> = [];
beforeEach(() => { verified = true; logoutFails = false; customerName = "Mara Santos"; calls.length = 0;
  window.history.replaceState(null, "", "/customer");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const method = options?.method ?? "GET"; calls.push({ method, url });
    if (method === "DELETE") return Response.json({}, { status: logoutFails ? 503 : 200 });
    if (url.includes("payments")) return Response.json({ requests: [{ id: "pay", status: "pending", amountMinor: 6000, method: "cash", submittedAt: Date.now(), rejectionReason: null }], nextCursor: null });
    return Response.json({ name: customerName, verified, rateCategory: "student", type: "guest", expiresAt: Date.now() + 1800000 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function login() {
  await act(async () => { render(<CustomerAccess />); });
  await act(async () => { fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "09999999999" } }); fireEvent.submit(screen.getByRole("button", { name: "View my membership" }).closest("form")!); });
}
it("revokes before clearing account view and keeps a failed sign-out retryable", async () => {
  await login(); logoutFails = true;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign out / use a different number" })); });
  expect(screen.getByRole("alert").textContent).toContain("retry"); expect(screen.getByRole("region", { name: "Membership card" })).toBeTruthy();
  logoutFails = false;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign out / use a different number" })); });
  expect(screen.getByLabelText("Phone number").getAttribute("value")).toBe(""); expect(screen.queryByRole("region", { name: "Membership card" })).toBeNull();
  expect(calls.filter(call => call.method === "DELETE")).toHaveLength(2);
});
it("opens the existing membership purchase with the check-in identity, then shows pending review without attendance", async () => {
  let membershipSubmitted = false;
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (String(url).includes("payments")) return Response.json({ requests: [], pendingMembership: membershipSubmitted ? {
      id: "membership-1", kind: "new_membership", status: "pending", amountMinor: 60000, method: "cash", submittedAt: Date.now(), rejectionReason: null,
    } : null, nextCursor: null });
    return original(url, options);
  });
  await act(async () => { render(<CustomerAccess membershipSetup />); });
  expect(calls[0]).toEqual({ method: "GET", url: "/api/customer/session" });
  expect(calls.some(call => call.method === "POST")).toBe(false);
  expect(screen.getByRole("heading", { name: "Start membership" })).toBeDefined();
  expect(screen.getByText("Restricted purchase form")).toBeDefined();
  expect(screen.queryByLabelText("Phone number")).toBeNull();
  membershipSubmitted = true;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Submit payment request" })); });
  expect(screen.getByText(/Please approach the front desk.*No daily charge or attendance/)).toBeDefined();
  expect(calls.some(call => call.url.startsWith("/api/attendance"))).toBe(false);
  expect(screen.getByRole("link", { name: "Check-in ↗" }).getAttribute("href")).toBe("/checkin");
});
it("shows an existing pending membership even when the latest payment page contains only daily sessions", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => String(url).includes("payments") ? Response.json({
    requests: [{ id: "daily", kind: "daily_session", status: "pending", amountMinor: 6000, method: "cash", submittedAt: Date.now(), rejectionReason: null }],
    pendingMembership: { id: "old-membership", kind: "new_membership", status: "pending", amountMinor: 60000, method: "cash", submittedAt: Date.now() - 100000, rejectionReason: null }, nextCursor: "older",
  }) : original(url, options));
  await act(async () => { render(<CustomerAccess membershipSetup />); });
  expect(screen.getByRole("region", { name: "Pending membership request" })).toBeDefined();
  expect(screen.getByText(/Please approach the front desk to confirm your payment/)).toBeDefined();
  expect(screen.queryByText("Restricted purchase form")).toBeNull();
});
it("does not imply membership approval is pending for a guest with only daily payments", async () => {
  await act(async () => { render(<CustomerAccess membershipSetup />); });
  expect(screen.getByText("Restricted purchase form")).toBeDefined();
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Overview" })); });
  expect(screen.queryByText(/No daily charge or attendance was created by this membership request/)).toBeNull();
});
it("rechecks verification during membership handoff rather than trusting the earlier lookup", async () => {
  verified = false;
  await act(async () => { render(<CustomerAccess membershipSetup />); });
  expect(screen.getByText("Profile verification needed")).toBeDefined();
  expect(screen.queryByText("Restricted purchase form")).toBeNull();
  expect(calls.some(call => call.url.includes("purchase") || call.url.startsWith("/api/attendance"))).toBe(false);
  expect(screen.getByRole("link", { name: /Choose a daily session/ }).getAttribute("href")).toBe("/checkin");
});
it("allows direct members payment setup visits to enter their phone when no session exists", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "customer-session-required" }, { status: 401 }));
  await act(async () => { render(<CustomerAccess membershipSetup />); });
  expect(screen.getByLabelText<HTMLInputElement>("Phone number").disabled).toBe(false);
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "09171234567" } });
    fireEvent.submit(screen.getByRole("button", { name: "View my membership" }).closest("form")!);
  });
  expect(screen.getByText("Restricted purchase form")).toBeDefined();
  expect(window.location.hash).toBe("#renew");
  const loginCall = vi.mocked(fetch).mock.calls.find(([, options]) => options?.method === "POST");
  expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({ phone: "09171234567" });
});
it("shows pending visitors their limited payment status while withholding membership purchases", async () => {
  verified = false; await login();
  expect(screen.getByText("Latest payment")).toBeTruthy(); expect(screen.getByText("Pending review", { exact: true })).toBeTruthy();
  expect(screen.queryByText("Restricted purchase form")).toBeNull();
  expect(screen.queryByRole("link", { name: "Start membership" })).toBeNull();
  window.history.pushState(null, "", "#renew");
  await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(screen.queryByText("Restricted purchase form")).toBeNull();
  expect(screen.getByText("Profile verification needed")).toBeTruthy();
});
it("clears the displayed customer when the server-issued session expires", async () => {
  vi.useFakeTimers(); await login();
  expect(screen.getByText("Mara Santos", { exact: true })).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(1800001); });
  expect(screen.getByRole("alert").textContent).toContain("expired"); expect(screen.getByLabelText("Phone number")).toBeTruthy();
  expect(screen.queryByText("Mara Santos", { exact: true })).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Member navigation" })).toBeNull();
});
it("shows the selected customer's name and replaces it when using a different number", async () => {
  expect(screen.queryByText("Mara Santos", { exact: true })).toBeNull();
  await login();
  expect(screen.getByText("Mara Santos", { exact: true }).closest("p")?.textContent).toBe("Mara Santos");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign out / use a different number" })); });
  expect(screen.queryByText("Mara Santos", { exact: true })).toBeNull();
  customerName = "Nina Flores";
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "09171234567" } });
    fireEvent.submit(screen.getByRole("button", { name: "View my membership" }).closest("form")!);
  });
  expect(screen.getByText("Nina Flores", { exact: true })).toBeTruthy();
  expect(screen.queryByText("Mara Santos", { exact: true })).toBeNull();
});
it("surfaces a rejected latest payment and opens its correction without a new purchase", async () => {
  const fetcher = vi.mocked(fetch);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, options) => String(url).includes("payments") ? Response.json({ requests: [
    { id: "rejected-request", status: "rejected", amountMinor: 60000, method: "gcash", submittedAt: Date.now(), rejectionReason: "Price mismatch" },
    { id: "older-approved", status: "approved", amountMinor: 6000, method: "cash", submittedAt: Date.now() - 60000, rejectionReason: null },
  ], nextCursor: null }) : original(url, options));
  await login();
  expect(screen.getByRole("heading", { name: "Payment needs attention" })).toBeTruthy();
  expect(screen.queryByText("Restricted purchase form")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Correct submission" })); });
  expect(screen.getByText("Replacing rejected-request")).toBeTruthy();
  expect(document.activeElement?.textContent).toBe("Correct your payment");
  expect(screen.getByRole("link", { name: "Membership" }).getAttribute("aria-current")).toBe("page");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel replacement" })); });
  expect(screen.queryByText("Restricted purchase form")).toBeNull();
  expect(screen.queryByText("Approved", { exact: true })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: /View payment history/ })); });
  expect(screen.getByText("Approved", { exact: true })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Membership card" })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Correct submission →" })); });
  expect(screen.getByText("Replacing rejected-request")).toBeTruthy();
});
it("labels older pages correctly and provides a path back to the latest requests", async () => {
  const fetcher = vi.mocked(fetch);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, options) => String(url).includes("payments") ? Response.json({ requests: [
    { id: "request", status: String(url).includes("cursor=") ? "rejected" : "pending", amountMinor: 60000, method: "cash", submittedAt: Date.now(), rejectionReason: null },
  ], nextCursor: String(url).includes("cursor=") ? null : "older-page" }) : original(url, options));
  await login();
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: /View payment history/ })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Older requests" })); });
  expect(screen.getByText("Earlier requests")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Payment needs attention" })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Back to latest requests" })); });
  expect(screen.getByRole("heading", { name: "Payment history" })).toBeTruthy();
});
it("refreshes the membership overview when checking an approved payment", async () => {
  await login();
  const fetcher = vi.mocked(fetch);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, options) => String(url).endsWith("/session") ? Response.json({ name: customerName, verified: true, rateCategory: "student", type: "member", status: "active", membershipExpiryMs: Date.now() + 86400000, expiresAt: Date.now() + 1800000 }) : original(url, options));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh payment status" })); });
  expect(screen.getByText("Active", { exact: true })).toBeTruthy();
  expect(screen.queryByText("Guest", { exact: true })).toBeNull();
  expect(screen.getByRole("link", { name: "Renew membership" })).toBeTruthy();
});

it("keeps renewal separate and returns to the overview after submission", async () => {
  await login();
  expect(screen.getByText("Guest", { exact: true })).toBeTruthy();
  expect(screen.queryByText("Restricted purchase form")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Start membership" })); });
  expect(window.location.hash).toBe("#renew");
  expect(screen.getByText("Restricted purchase form")).toBeTruthy();
  expect(screen.queryByText("Latest payment")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Submit payment request" })); });
  expect(window.location.hash).toBe("#overview");
  expect(screen.queryByText("Restricted purchase form")).toBeNull();
  expect(screen.getByText(/Payment request submitted for gym review/)).toBeTruthy();
  expect(screen.getByText("Guest", { exact: true })).toBeTruthy();
});

it("keeps the latest overview payment separate from older history and supports browser navigation", async () => {
  const fetcher = vi.mocked(fetch), original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, options) => String(url).includes("payments") ? Response.json({ requests: [
    { id: "request", status: String(url).includes("cursor=") ? "rejected" : "pending", amountMinor: 60000, method: "cash", submittedAt: Date.now(), rejectionReason: null },
  ], nextCursor: String(url).includes("cursor=") ? null : "older-page" }) : original(url, options));
  await login();
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: /View payment history/ })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Older requests" })); });
  expect(screen.getByText("Rejected", { exact: true })).toBeTruthy();
  window.history.replaceState(null, "", "#overview");
  await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(screen.getByText("Pending review", { exact: true })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Payment needs attention" })).toBeNull();
});

it("renders an expired membership explicitly rather than as a guest or active pass", async () => {
  const fetcher = vi.mocked(fetch), original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, options) => String(url).endsWith("/session") ? Response.json({ name: customerName, verified: true, rateCategory: "student", type: "member", status: "expired", membershipExpiryMs: Date.now() - 86400000, expiresAt: Date.now() + 1800000 }) : original(url, options));
  await login();
  expect(screen.getByText("Expired", { exact: true })).toBeTruthy();
  expect(screen.getByText("Expired on")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Renew membership" })).toBeTruthy();
});

it("navigates all three member screens and marks the current destination", async () => {
  await act(async () => { render(<CustomerAccess />); });
  expect(screen.queryByRole("navigation", { name: "Member navigation" })).toBeNull();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "09999999999" } });
    fireEvent.submit(screen.getByRole("button", { name: "View my membership" }).closest("form")!);
  });
  expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Membership" })); });
  expect(screen.getByText("Restricted purchase form")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Membership" }).getAttribute("aria-current")).toBe("page");
  expect(screen.queryByRole("link", { name: /Back to overview/ })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Payments" })); });
  expect(screen.getByRole("heading", { name: "Payment history" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Payments" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Membership" }).hasAttribute("aria-current")).toBe(false);
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Overview" })); });
  expect(screen.getByRole("region", { name: "Membership card" })).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign out / use a different number" })); });
  expect(screen.queryByRole("navigation", { name: "Member navigation" })).toBeNull();
});
