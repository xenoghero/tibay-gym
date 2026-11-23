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
  hasPhoto: false, photoPosition: null, booked: 0, coachId, coachName: coachId === "rudeus" ? "Rudeus Greyrat" : coachId === "eris" ? "Eris Boreas" : null, next: null, ...extra });
const base = { seriesId: null, minutes: 60, muscles: [], exercises: [], note: null };
const data = {
  today: "2026-11-19", minuteNow: 10 * 60,
  coaches: [{ id: "rudeus", name: "Rudeus Greyrat" }, { id: "eris", name: "Eris Boreas" }],
  bookings: [
    { ...base, id: "b1", coachId: "rudeus", personId: "mark", date: "2026-11-19", start: 7 * 60, muscles: ["Back"], mark: { id: "m1", outcome: "done", coachId: "rudeus", createdAt: Date.parse("2026-11-18T23:00:00Z") } },
    { ...base, id: "b2", coachId: "eris", personId: "jenny", date: "2026-11-19", start: 15 * 60, mark: null },
  ],
  clients: [client("adrian", "Adrian Luna", null, 16, { status: "approved", coachingExpiresAt: null }),
    client("jenny", "Jenny Cruz", "eris", 5, { booked: 1, next: { date: "2026-11-19", start: 15 * 60, coachId: "eris" } }), client("mark", "Mark Villanueva", "rudeus", 11)],
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
    path === "/api/admin/coach-assignments" ? { ok: true, moved: 2, cancelled: [{ date: "2026-11-20", start: 8 * 60 }] }
      : init?.method === "POST" ? { ok: true } : path.startsWith("/api/admin/freezes") ? { requests: [] } : data)));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("crypto", { randomUUID: () => "operation-0000-0000" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("shows every coach's sessions on the day cards with coach badges, and filters by coach", async () => {
  render(<AdminCoaching />);
  const today = await screen.findByRole("button", { name: "Thursday, November 19, 2 sessions" });
  expect(String(fetch.mock.calls[0][0])).toBe("/api/admin/coach-bookings?from=2026-11-01&to=2026-12-07");
  expect(within(today).getByText("Mark · Back")).toBeTruthy();
  expect(within(today).getByText("R")).toBeTruthy();
  expect(within(today).getByText("E")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Eris Boreas/ }));
  expect(screen.getByRole("button", { name: "Thursday, November 19, 1 session" })).toBeTruthy();
});

it("opens a day with each session's coach, and lets the admin change a marked session's outcome", async () => {
  render(<AdminCoaching />);
  fireEvent.click(await screen.findByRole("button", { name: /^Thursday, November 19/ }));
  const day = screen.getByRole("dialog", { name: "Thursday, Nov 19" });
  expect(within(day).getByText("Today · 2 sessions · 2 coaches")).toBeTruthy();
  expect(within(day).getByRole("button", { name: /Mark Villanueva/ }).textContent).toContain("Rudeus");
  fireEvent.click(within(day).getByRole("button", { name: /Mark Villanueva/ }));
  const sheet = screen.getByRole("dialog", { name: "Mark Villanueva" });
  expect(within(sheet).getByText("✓ Session done")).toBeTruthy();
  fireEvent.click(within(sheet).getByRole("button", { name: "Change to No-show" }));
  expect(await posted("/api/admin/coaching-sessions")).toEqual({ action: "fix", markId: "m1", outcome: "no_show" });
});

it("adds a session for an unassigned client with the coach the admin picks", async () => {
  render(<AdminCoaching />);
  fireEvent.click(await screen.findByRole("button", { name: "+ Add session" }));
  const sheet = screen.getByRole("dialog", { name: "Add session" });
  fireEvent.click(within(sheet).getByRole("button", { name: "Client Search or pick a client" }));
  fireEvent.click(within(sheet).getByRole("radio", { name: /Adrian Luna/ }));
  expect(within(sheet).getByText(/adding assigns them to Adrian/)).toBeTruthy();
  fireEvent.click(within(sheet).getByRole("radio", { name: /Eris Boreas/ }));
  fireEvent.change(within(sheet).getByRole("combobox", { name: "Start" }), { target: { value: String(11 * 60) } });
  fireEvent.click(within(sheet).getByRole("button", { name: /^Add Adrian · 11:00 AM/ }));
  expect(await posted("/api/admin/coach-bookings")).toEqual({ action: "book", personId: "adrian", coachId: "eris", date: "2026-11-19", start: 11 * 60, minutes: 60, muscles: [], weeks: 1 });
});

it("switches a client's coach from the Clients list and reports which sessions moved or were cancelled", async () => {
  render(<AdminCoaching />);
  await screen.findByRole("button", { name: /^Thursday, November 19/ });
  fireEvent.click(screen.getByRole("button", { name: "Clients" }));
  fireEvent.click((await screen.findAllByRole("button", { name: "Sessions" }))[1]);
  const client = screen.getByRole("dialog", { name: "Jenny Cruz" });
  fireEvent.click(within(client).getByRole("button", { name: "Switch coach" }));
  const sheet = screen.getByRole("dialog", { name: "Switch coach" });
  fireEvent.click(within(sheet).getByRole("button", { name: "Switch to Rudeus Greyrat" }));
  expect(await posted("/api/admin/coach-assignments")).toEqual({ personId: "jenny", coachId: "rudeus" });
  expect((await screen.findByRole("status")).textContent).toBe("Jenny Cruz is now coached by Rudeus Greyrat.\n2 upcoming sessions moved to Rudeus.\nCancelled because Rudeus was busy: Fri, Nov 20 8:00 AM.");
});
