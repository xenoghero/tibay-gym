// @vitest-environment jsdom
vi.hoisted(() => {
  if (!window.AnimationEvent) Object.defineProperty(window, "AnimationEvent", { value: window.Event, configurable: true });
});
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: { getIdToken: async () => "token" }, loading: false, signOut: vi.fn() }) }));
import { AdminCoaching } from "./coaching-admin";

const client = (id: string, name: string, coachId: string | null, sessionsLeft: number, extra = {}) => ({ id, name, phone: "09666928971", fbName: null, goals: null, remarks: null,
  preferredSchedule: { weekdays: ["mon", "tue"], timeSlot: "morning" }, status: "active", sessionsLeft, coachingExpiresAt: Date.parse("2026-12-18T00:00:00+08:00"), frozen: false,
  hasPhoto: false, photoPosition: null, booked: 0, needsBooking: false, coachId, coachName: coachId === "rudeus" ? "Rudeus Greyrat" : coachId === "eris" ? "Eris Boreas" : null, next: null, ...extra });
const data = {
  today: "2026-11-19", hourNow: 10, marks: [{ date: "2026-11-17", outcome: "done", coachId: "rudeus" }],
  coaches: [{ id: "rudeus", name: "Rudeus Greyrat" }, { id: "eris", name: "Eris Boreas" }],
  bookings: [
    { id: "b1", coachId: "rudeus", personId: "mark", date: "2026-11-19", hour: 7, seriesId: null, mark: { id: "m1", outcome: "done" } },
    { id: "b2", coachId: "eris", personId: "jenny", date: "2026-11-19", hour: 15, seriesId: null, mark: null },
  ],
  clients: [client("adrian", "Adrian Luna", null, 16, { needsBooking: true, status: "approved", coachingExpiresAt: null }),
    client("jenny", "Jenny Cruz", "eris", 5, { booked: 1, next: { date: "2026-11-19", hour: 15, coachId: "eris" } }), client("mark", "Mark Villanueva", "rudeus", 11)],
};
const fetch = vi.fn();
const posted = (path: string) => vi.waitFor(() => {
  const call = fetch.mock.calls.find(([url, init]) => url === path && init?.method === "POST");
  expect(call).toBeTruthy();
  return JSON.parse(call![1].body);
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse("2026-11-19T02:00:00Z"));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  fetch.mockReset().mockImplementation(async (path: string, init?: RequestInit) => new Response(JSON.stringify(
    init?.method === "POST" ? { ok: true } : path.startsWith("/api/admin/freezes") ? { requests: [] } : data)));
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("shows each session with its coach and filters the schedule by coach", async () => {
  render(<AdminCoaching />);
  const morning = await screen.findByRole("region", { name: "Morning, 6 AM–12 PM" });
  expect(within(morning).getByText("Mark Villanueva")).toBeTruthy();
  expect(within(morning).getByText("Rudeus")).toBeTruthy();
  expect(within(morning).getByText("Open · 1 free hour")).toBeTruthy();
  expect(String(fetch.mock.calls[0][0])).toBe("/api/admin/coach-bookings?from=2026-11-01&to=2026-12-05");
  fireEvent.click(screen.getByRole("button", { name: /Eris Boreas/ }));
  expect(within(screen.getByRole("region", { name: "Morning, 6 AM–12 PM" })).queryByText("Mark Villanueva")).toBeNull();
});

it("assigns an unassigned client to a coach, then opens booking with that coach", async () => {
  render(<AdminCoaching />);
  await screen.findByRole("region", { name: "Morning, 6 AM–12 PM" });
  fireEvent.click(screen.getByRole("button", { name: /^Clients/ }));
  fireEvent.click(screen.getAllByRole("button", { name: "Assign a coach" })[0]);
  const sheet = screen.getByRole("dialog", { name: "Assign a coach" });
  expect(within(sheet).getByRole("radio", { checked: true }).textContent).toContain("Rudeus Greyrat");
  fireEvent.click(within(sheet).getByRole("radio", { name: /Eris Boreas/ }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Assign Eris Boreas" }));
  expect(await posted("/api/admin/coach-assignments")).toEqual({ personId: "adrian", coachId: "eris" });
  const book = await screen.findByRole("dialog", { name: "Book a session" });
  expect(within(book).getByRole("radio", { checked: true }).textContent).toContain("Eris Boreas");
});
