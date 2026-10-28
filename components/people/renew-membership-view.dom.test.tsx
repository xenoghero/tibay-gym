// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Person } from "@/lib/db/person";
const mocks = vi.hoisted(() => ({ token: vi.fn(async () => "synthetic-token"), user: { getIdToken: async () => "synthetic-token" } }));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/db/person", () => ({ watchPerson: vi.fn() }));
vi.mock("@/components/people/people-form-shell", () => ({ PeopleFormShell: () => null }));
import { RenewMembershipForm } from "./renew-membership-view";
const person = { id: "p1", name: "Alex" } as Person;
const quote = { kind: "renewal", amountMinor: 100000, categorySnapshot: "student", rateRevision: 1, quoteToken: "quote", coverage: { startDate: "2026-10-25", expiryDate: "2026-11-25", months: 1 } };
let posted: Array<Record<string, unknown>>, loseResponse: boolean;
beforeEach(() => { posted = []; loseResponse = false;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") { posted.push(JSON.parse(String(options.body))); if (loseResponse) { loseResponse = false; throw new Error("Lost response"); } return Response.json({ id: "request" }); }
    return Response.json(quote);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("submits a reviewed configured monthly quote as pending and does not directly activate membership", async () => {
  await act(async () => { render(<RenewMembershipForm person={person} onReload={vi.fn()} />); });
  expect(screen.getByText(/2026-10-25 to 2026-11-25/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Submit payment request for review" })); });
  expect(posted).toHaveLength(1); expect(posted[0]).toMatchObject({ personId: "p1", method: "cash", quoteToken: "quote" });
  expect(screen.getByRole("status").textContent).toContain("Membership is unchanged until approval");
});
it("reuses the same operation after an uncertain submission", async () => {
  await act(async () => { render(<RenewMembershipForm person={person} onReload={vi.fn()} />); }); loseResponse = true;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Submit payment request for review" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Submit payment request for review" })); });
  expect(posted).toHaveLength(2); expect(posted[0].operationId).toBe(posted[1].operationId);
});
it("keeps custom/longer pricing unavailable and supports a fresh membership reload", async () => {
  const reload = vi.fn(); await act(async () => { render(<RenewMembershipForm person={person} onReload={reload} />); });
  expect(screen.queryByRole("button", { name: "Custom expiry" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reload membership" })); expect(reload).toHaveBeenCalledOnce();
});
