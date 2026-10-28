// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/components/people/purchase-form", () => ({ PurchaseForm: ({ previousRequestId }: { previousRequestId?: string }) => <p>{previousRequestId ? `Replacing ${previousRequestId}` : "Restricted purchase form"}</p> }));
import { CustomerAccess } from "./customer-access";
let verified: boolean, logoutFails: boolean;
const calls: Array<{ method: string; url: string }> = [];
beforeEach(() => { verified = true; logoutFails = false; calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const method = options?.method ?? "GET"; calls.push({ method, url });
    if (method === "DELETE") return Response.json({}, { status: logoutFails ? 503 : 200 });
    if (url.includes("payments")) return Response.json({ requests: [{ id: "pay", status: "pending", amountMinor: 6000, method: "cash", submittedAt: Date.now(), rejectionReason: null }], nextCursor: null });
    return Response.json({ verified, rateCategory: "student", type: "guest", expiresAt: Date.now() + 1800000 });
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
  expect(screen.getByRole("alert").textContent).toContain("retry"); expect(screen.getByText("Membership", { exact: true })).toBeTruthy();
  logoutFails = false;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign out / use a different number" })); });
  expect(screen.getByLabelText("Phone number").getAttribute("value")).toBe(""); expect(screen.queryByText("Membership", { exact: true })).toBeNull();
  expect(calls.filter(call => call.method === "DELETE")).toHaveLength(2);
});
it("shows pending visitors their limited payment status while withholding membership purchases", async () => {
  verified = false; await login();
  expect(screen.getByText("Payment status")).toBeTruthy(); expect(screen.getByText("pending", { exact: true })).toBeTruthy();
  expect(screen.queryByText("Restricted purchase form")).toBeNull();
});
it("clears the displayed customer when the server-issued session expires", async () => {
  vi.useFakeTimers(); await login();
  await act(async () => { vi.advanceTimersByTime(1800001); });
  expect(screen.getByRole("alert").textContent).toContain("expired"); expect(screen.getByLabelText("Phone number")).toBeTruthy();
});
it("surfaces a rejected latest payment and opens its correction without a new purchase", async () => {
  const fetcher = vi.mocked(fetch);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, options) => String(url).includes("payments") ? Response.json({ requests: [
    { id: "rejected-request", status: "rejected", amountMinor: 60000, method: "gcash", submittedAt: Date.now(), rejectionReason: "Price mismatch" },
    { id: "older-approved", status: "approved", amountMinor: 6000, method: "cash", submittedAt: Date.now() - 60000, rejectionReason: null },
  ], nextCursor: null }) : original(url, options));
  await login();
  expect(screen.getByText("Your latest payment needs attention")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Correct submission →" })[0]); });
  expect(screen.getByText("Replacing rejected-request")).toBeTruthy();
  expect(document.activeElement?.id).toBe("customer-purchase");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel replacement" })); });
  expect(screen.getByText("Restricted purchase form")).toBeTruthy();
  const history = screen.getByText("View payment history").closest("details")!;
  expect(history.open).toBe(false);
  fireEvent.click(screen.getByText("View payment history"));
  expect(history.open).toBe(true);
});
it("labels older pages correctly and provides a path back to the latest requests", async () => {
  const fetcher = vi.mocked(fetch);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, options) => String(url).includes("payments") ? Response.json({ requests: [
    { id: "request", status: String(url).includes("cursor=") ? "rejected" : "pending", amountMinor: 60000, method: "cash", submittedAt: Date.now(), rejectionReason: null },
  ], nextCursor: String(url).includes("cursor=") ? null : "older-page" }) : original(url, options));
  await login();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Older requests" })); });
  expect(screen.getByText("Earlier requests")).toBeTruthy();
  expect(screen.queryByText("Your latest payment needs attention")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Back to latest requests" })); });
  expect(screen.getByText("Latest request")).toBeTruthy();
});
it("refreshes the membership overview when checking an approved payment", async () => {
  await login();
  const fetcher = vi.mocked(fetch);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, options) => String(url).endsWith("/session") ? Response.json({ verified: true, rateCategory: "student", type: "member", status: "active", membershipExpiryMs: Date.now() + 86400000, expiresAt: Date.now() + 1800000 }) : original(url, options));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh payment status" })); });
  expect(screen.getByText("Active", { exact: true })).toBeTruthy();
  expect(screen.queryByText("Guest profile")).toBeNull();
});
