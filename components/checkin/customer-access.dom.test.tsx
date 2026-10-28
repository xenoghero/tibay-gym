// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/components/people/purchase-form", () => ({ PurchaseForm: () => <p>Restricted purchase form</p> }));
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
  await act(async () => { fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "09999999999" } }); fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!); });
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
