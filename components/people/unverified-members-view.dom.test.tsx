// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase/firestore";
import type { UnverifiedPerson } from "@/lib/db/unverified";
import { UnverifiedMembersView } from "./unverified-members-view";

const mocks = vi.hoisted(() => ({ people: vi.fn(), visits: vi.fn(), api: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/db/unverified", () => ({ watchUnverifiedPersons: mocks.people, watchUnverifiedVisits: mocks.visits }));
vi.mock("@/lib/attendance-api", () => ({ attendanceApi: mocks.api }));
const stamp = Timestamp.fromMillis(1_800_000_000_000);
const person = (id: string, name: string): UnverifiedPerson => ({
  id, name, phone: id === "p1" ? "09123456789" : "09999999999", address: "Street",
  type: "guest", status: null, membershipExpiry: null, rfidTagId: null, joinDate: null,
  visitCount: 2, lastVisitAt: stamp, createdAt: stamp, updatedAt: stamp,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.people.mockImplementation((_count, next) => { next([person("p1", "Alex"), person("p2", "Sam")]); return mocks.stop; });
  mocks.visits.mockImplementation((_id, next) => { next([{ id: "l1", personId: "p1", source: "qr", checkInAt: stamp, checkOutAt: null, closedReason: null }]); return mocks.stop; });
  mocks.api.mockImplementation(async (_path, body) => ({ results: body.personIds.map((personId: string) => ({ personId, ok: true })) }));
});
afterEach(() => cleanup());

it("requires explicit confirmation to approve and sends an authenticated review request", async () => {
  render(<UnverifiedMembersView />);
  fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0]);
  expect(mocks.api).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Approve Alex?" })).toBeDefined();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm approval" })));
  expect(mocks.api).toHaveBeenCalledExactlyOnceWith("/api/attendance/unverified", { operation: "approve", personIds: ["p1"] }, true);
  expect(screen.getByRole("status").textContent).toContain("All earlier visits now count");
});

it("supports searching, selecting, and cancelling a bulk rejection without sending mutations", () => {
  render(<UnverifiedMembersView />);
  fireEvent.click(screen.getByRole("checkbox", { name: /Select all shown/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete selected (2)" }));
  expect(screen.getByRole("heading", { name: "Delete 2 registrations?" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.api).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "99999" } });
  expect(screen.queryByRole("heading", { name: "Alex" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Sam" })).toBeDefined();
});

it("supports individual deletion and reports partial bulk failures while retaining failed selections", async () => {
  render(<UnverifiedMembersView />);
  fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  expect(screen.getByRole("heading", { name: "Delete Alex?" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Select all shown/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete selected (2)" }));
  mocks.api.mockResolvedValueOnce({ results: [{ personId: "p1", ok: true }, { personId: "p2", ok: false, error: "server-unavailable" }] });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" })));
  expect(screen.getByRole("status").textContent).toContain("1 registration deleted with their check-ins");
  expect(screen.getByRole("alert").textContent).toContain("could not be updated");
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Select Sam" }).checked).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Select Alex" }).checked).toBe(false);
});

it("opens visit history on demand and disables review when live data is unavailable", async () => {
  const view = render(<UnverifiedMembersView />);
  expect(mocks.visits).not.toHaveBeenCalled();
  const details = screen.getAllByText("Check-in history")[0].parentElement as HTMLDetailsElement;
  await act(async () => { details.open = true; fireEvent(details, new Event("toggle")); });
  expect(mocks.visits).toHaveBeenCalled();
  expect(within(details).getByRole("cell", { name: "Open visit" })).toBeDefined();
  view.unmount();
  mocks.people.mockImplementation((_count, _next, error) => { error(); return mocks.stop; });
  render(<UnverifiedMembersView />);
  expect(screen.getByRole("alert").textContent).toContain("Could not load live registrations");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Delete selected (0)" }).disabled).toBe(true);
});

it("keeps retry available after an unconfirmed request and does not report success", async () => {
  render(<UnverifiedMembersView />);
  fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0]);
  mocks.api.mockRejectedValueOnce(new Error("network loss"));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm approval" })));
  expect(screen.getByRole("alert").textContent).toContain("could not be confirmed");
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Confirm approval" }).disabled).toBe(false);
});
