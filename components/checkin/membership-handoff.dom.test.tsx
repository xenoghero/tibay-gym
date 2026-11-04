// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomerAccess } from "./customer-access";

vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("./promotion-banner", () => ({ PromotionBanner: () => null }));
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps the branded handoff visible through session, payment status and the real purchase quote", async () => {
  window.history.replaceState(null, "", "/members#renew");
  vi.stubGlobal("scrollTo", vi.fn());
  const session = deferred(), payments = deferred(), quote = deferred();
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/api/customer/session") return session.promise;
    if (url === "/api/customer/payments") return payments.promise;
    if (url === "/api/customer/purchase") return quote.promise;
    throw new Error(`Unexpected request: ${url}`);
  }));
  render(<CustomerAccess membershipSetup />);
  const expectLoader = () => expect(screen.getByRole("status", { name: "Opening membership payment…" }).textContent).toContain("Tibay");
  expectLoader();
  expect(screen.queryByLabelText("Phone number")).toBeNull();
  await act(async () => { session.resolve(Response.json({ name: "Alex", verified: true, rateCategory: "student", type: "guest", expiresAt: Date.now() + 1800000 })); });
  expectLoader();
  expect(screen.queryByRole("region", { name: "Membership card" })).toBeNull();
  await act(async () => { payments.resolve(Response.json({ requests: [], nextCursor: null })); });
  expectLoader();
  await act(async () => { quote.resolve(Response.json({ kind: "new_membership", categorySnapshot: "student", amountMinor: 60000, baseAmountMinor: 60000, quoteToken: "quote" })); });
  expect(screen.queryByRole("status", { name: "Opening membership payment…" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Start membership" })).toBeDefined();
  expect(screen.getByRole("button", { name: /Submit/ })).toBeDefined();
});

it("releases the loader when the purchase quote fails so the customer can retry", async () => {
  window.history.replaceState(null, "", "/members#renew");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/customer/session") return Response.json({ name: "Alex", verified: true, type: "guest", expiresAt: Date.now() + 1800000 });
    if (url === "/api/customer/payments") return Response.json({ requests: [], nextCursor: null });
    return Response.json({}, { status: 503 });
  }));
  await act(async () => { render(<CustomerAccess membershipSetup />); });
  expect(screen.queryByRole("status", { name: "Opening membership payment…" })).toBeNull();
  expect(screen.getByText(/A purchase quote is unavailable/)).toBeDefined();
  expect(screen.getByRole("button", { name: /Refresh quote/ })).toBeDefined();
});
