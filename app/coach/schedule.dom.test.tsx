// @vitest-environment jsdom
vi.hoisted(() => {
  if (!window.AnimationEvent) Object.defineProperty(window, "AnimationEvent", { value: window.Event, configurable: true });
});
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import { Schedule, type ScheduleData } from "./schedule";

const client = (id: string, name: string, sessionsLeft: number, booked: number, extra = {}) => ({ id, name, phone: "09123456789", fbName: null, goals: null, remarks: null,
  preferredSchedule: null, status: "active", sessionsLeft, coachingExpiresAt: Date.parse("2026-12-18T00:00:00+08:00"), frozen: false, hasPhoto: false, photoPosition: null,
  booked, needsBooking: false, ...extra });
const data: ScheduleData = {
  today: "2026-11-19", hourNow: 14, marks: [],
  bookings: [
    { id: "b1", coachId: "coach1", personId: "mark", date: "2026-11-19", hour: 7, seriesId: null, mark: null },
    { id: "b2", coachId: "coach1", personId: "jenny", date: "2026-11-19", hour: 15, seriesId: null, mark: null },
    { id: "b3", coachId: "coach1", personId: "paolo", date: "2026-11-19", hour: 19, seriesId: null, mark: null },
  ],
  clients: [
    client("carlo", "Carlo Mendoza", 10, 0, { needsBooking: true, preferredSchedule: { weekdays: ["tue", "thu"], timeSlot: "afternoon" } }),
    client("jenny", "Jenny Cruz", 5, 1), client("mark", "Mark Villanueva", 11, 0), client("paolo", "Paolo Reyes", 1, 1),
    client("kris", "Kristine Dela Cruz", 6, 0, { frozen: true }),
  ],
};
const fetch = vi.fn();
/** The POST body sent to `path`, once the awaited ID token lets it through. */
const posted = (path: string) => vi.waitFor(() => {
  const call = fetch.mock.calls.find(([url, init]) => url === path && init?.method === "POST");
  expect(call).toBeTruthy();
  return JSON.parse(call![1].body);
});
const user = { getIdToken: async () => "token" } as unknown as User;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse("2026-11-19T06:10:00Z"));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  fetch.mockReset().mockImplementation(async (_path: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === "POST" ? { ids: ["new"] } : data)));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("crypto", { randomUUID: () => "operation-0000-0000" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("shows the day by time slot, with marks due inline and the last session flagged", async () => {
  render(<Schedule user={user} />);
  expect(await screen.findByText("Ended 8:00 AM · not marked yet")).toBeTruthy();
  expect(screen.getByText("Last session · remind to renew")).toBeTruthy();
  expect(String(fetch.mock.calls[0][0])).toBe("/api/coach/bookings?from=2026-11-01&to=2026-12-05");
  const morning = screen.getByRole("region", { name: "Morning, 6 AM–12 PM" });
  fireEvent.click(within(morning).getByRole("button", { name: "✓ Mark done" }));
  expect(await posted("/api/coach/sessions")).toEqual({ action: "mark", personId: "mark", outcome: "done", bookingId: "b1", operationId: "operation-0000-0000" });
});

it("books the client whose preferred slot is free, weekly through their last coaching day", async () => {
  render(<Schedule user={user} />);
  fireEvent.click(await screen.findByRole("button", { name: "Book 4 PM ›" }));
  const sheet = screen.getByRole("dialog", { name: "Book a session" });
  const picks = within(sheet).getAllByRole("button", { pressed: true });
  expect(picks.map(button => button.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("4 PM"), expect.stringContaining("Carlo Mendoza✓ Prefers Thursday afternoons")]));
  expect((within(sheet).getByRole("button", { name: /^3 PMJenny Cruz/ }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(sheet).getByRole("button", { name: /Kristine Dela Cruz/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(sheet).getByText("4:00 PM through Dec 17 · books 5 of Carlo’s 10 sessions")).toBeTruthy();
  fireEvent.click(within(sheet).getByRole("checkbox"));
  fireEvent.click(within(sheet).getByRole("button", { name: "Book 5 Thursdays" }));
  expect(await posted("/api/coach/bookings")).toEqual({ action: "book", personId: "carlo", date: "2026-11-19", hour: 16, weeks: 5 });
});
