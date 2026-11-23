// @vitest-environment jsdom
vi.hoisted(() => {
  if (!window.AnimationEvent) Object.defineProperty(window, "AnimationEvent", { value: window.Event, configurable: true });
});
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import { Schedule, type ScheduleBooking, type ScheduleData } from "./schedule";

const client = (id: string, name: string, sessionsLeft: number, booked: number, extra = {}) => ({ id, name, phone: "09123456789", fbName: null, goals: null, remarks: null,
  preferredSchedule: null, status: "active", sessionsLeft, coachingExpiresAt: Date.parse("2026-12-18T00:00:00+08:00"), frozen: false, hasPhoto: false, photoPosition: null,
  booked, next: null, ...extra });
const session = (id: string, personId: string, date: string, start: number, extra: Partial<ScheduleBooking> = {}): ScheduleBooking => ({
  id, coachId: "coach1", personId, date, start, minutes: 60, seriesId: null, muscles: [], exercises: [], note: null, mark: null, ...extra });
// Thursday, Nov 19 2026, 2:10 PM in Manila.
const data: ScheduleData = {
  today: "2026-11-19", minuteNow: 14 * 60 + 10,
  bookings: [
    session("b1", "mark", "2026-11-19", 7 * 60, { muscles: ["Legs"] }),
    session("b2", "jenny", "2026-11-19", 15 * 60),
    session("b3", "paolo", "2026-11-19", 19 * 60),
    session("b4", "mark", "2026-11-17", 8 * 60, { mark: { id: "m4", outcome: "done", coachId: "coach1", createdAt: Date.parse("2026-11-17T01:00:00Z") } }),
  ],
  clients: [
    client("carlo", "Carlo Mendoza", 10, 0, { preferredSchedule: { weekdays: ["tue", "thu"], timeSlot: "afternoon" } }),
    client("jenny", "Jenny Cruz", 5, 1), client("mark", "Mark Villanueva", 11, 0), client("paolo", "Paolo Reyes", 1, 1),
    client("kris", "Kristine Dela Cruz", 6, 0, { frozen: true }),
  ],
};
const fetch = vi.fn();
/** The POST bodies sent to `path`, once the awaited ID token lets them through. */
const posted = (path: string, count = 1) => vi.waitFor(() => {
  const calls = fetch.mock.calls.filter(([url, init]) => url === path && init?.method === "POST");
  expect(calls.length).toBeGreaterThanOrEqual(count);
  return calls.map(call => JSON.parse(call[1].body));
});
const user = { getIdToken: async () => "token" } as unknown as User;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse("2026-11-19T06:10:00Z"));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  fetch.mockReset().mockImplementation(async (_path: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === "POST" ? { ids: ["new"], id: "m-new", outcome: "done" } : data)));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("crypto", { randomUUID: () => "operation-0000-0000" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("shows the month as day cards with sessions, done days and sessions to mark", async () => {
  render(<Schedule user={user} />);
  const today = await screen.findByRole("button", { name: "Thursday, November 19, 3 sessions, 1 to mark" });
  expect(String(fetch.mock.calls[0][0])).toBe("/api/coach/bookings?from=2026-11-01&to=2026-12-07");
  expect(within(today).getByText("Mark · Legs")).toBeTruthy();
  expect(within(today).getByText("1 to mark")).toBeTruthy();
  expect(within(screen.getByRole("button", { name: /^Tuesday, November 17/ })).getByText("✓ 1 done")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /^\w+day, November \d+/ })).toHaveLength(30);
  expect(screen.getByText("November 2026")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url === "/api/coach/bookings?from=2026-12-01&to=2027-01-07")).toBe(true));
});

it("opens a day, steps between its clients, keeps the checklist with sets, then saves it and marks the session done", async () => {
  render(<Schedule user={user} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Thursday, November 19/ }));
  const day = screen.getByRole("dialog", { name: "Thursday, Nov 19" });
  expect(within(day).getAllByRole("button", { name: /^\d/ }).map(card => card.textContent)).toEqual([
    expect.stringContaining("Mark Villanueva"), expect.stringContaining("Jenny Cruz"), expect.stringContaining("Paolo Reyes")]);
  fireEvent.click(within(day).getByRole("button", { name: /Mark Villanueva/ }));

  let sheet = screen.getByRole("dialog", { name: "Mark Villanueva" });
  expect(within(sheet).getByText("1 / 3")).toBeTruthy();
  fireEvent.click(within(sheet).getByRole("button", { name: "Next: Jenny Cruz, 3:00 PM" }));
  sheet = screen.getByRole("dialog", { name: "Jenny Cruz" });
  expect(within(sheet).getByText("You can mark it once it starts at 3:00 PM.")).toBeTruthy();
  fireEvent.click(within(sheet).getByRole("button", { name: "Previous: Mark Villanueva, 7:00 AM" }));
  sheet = screen.getByRole("dialog", { name: "Mark Villanueva" });

  fireEvent.change(within(sheet).getByRole("textbox", { name: "New exercise" }), { target: { value: "Back squat" } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Add" }));
  fireEvent.click(within(sheet).getByRole("button", { name: "+ Add set" }));
  fireEvent.change(within(sheet).getByRole("spinbutton", { name: "Back squat set 1 reps" }), { target: { value: "8" } });
  fireEvent.change(within(sheet).getByRole("spinbutton", { name: "Back squat set 1 kg" }), { target: { value: "62.5" } });
  fireEvent.click(within(sheet).getByRole("button", { name: "+ Add set" }));
  expect((within(sheet).getByRole("spinbutton", { name: "Back squat set 2 kg" }) as HTMLInputElement).value).toBe("62.5");
  expect((within(sheet).getByRole("checkbox", { name: "Back squat done" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.change(within(sheet).getByRole("textbox", { name: /^Note/ }), { target: { value: "Good depth" } });
  fireEvent.click(within(sheet).getByRole("button", { name: /^Mark session done/ }));

  expect((await posted("/api/coach/bookings"))[0]).toEqual({ action: "update", bookingId: "b1", muscles: ["Legs"], note: "Good depth",
    exercises: [{ name: "Back squat", done: true, sets: [{ reps: 8, kg: 62.5 }, { reps: 8, kg: 62.5 }] }] });
  expect((await posted("/api/coach/sessions"))[0]).toEqual({ action: "mark", personId: "mark", outcome: "done", bookingId: "b1", operationId: "operation-0000-0000" });
});

it("adds a session: best-matching client first, a free time, target muscles, weekly through their last coaching day", async () => {
  render(<Schedule user={user} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Thursday, November 19/ }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Add session/ }));
  const sheet = screen.getByRole("dialog", { name: "Add session" });
  // The client list stays folded into one field until opened, then closes on a pick.
  expect(within(sheet).queryByRole("radio", { name: /Carlo Mendoza/ })).toBeNull();
  fireEvent.click(within(sheet).getByRole("button", { name: "Client Search or pick a client" }));
  fireEvent.change(within(sheet).getByRole("searchbox", { name: "Search clients" }), { target: { value: "cruz" } });
  expect(within(sheet).getAllByRole("radio").map(radio => radio.closest("label")!.textContent)).toEqual([expect.stringContaining("Jenny Cruz"), expect.stringContaining("Kristine Dela Cruz")]);
  expect((within(sheet).getByRole("radio", { name: /Kristine Dela Cruz/ }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(within(sheet).getByRole("searchbox", { name: "Search clients" }), { target: { value: "" } });
  fireEvent.click(within(sheet).getByRole("radio", { name: /Carlo Mendoza.*Prefers Thu afternoons/ }));
  expect(within(sheet).queryByRole("searchbox")).toBeNull();
  expect(within(sheet).getByRole("button", { name: /^Client Carlo Mendoza/ })).toBeTruthy();
  // 2:15–3:59 PM would run into Jenny's 3 PM, so the first free afternoon start is 4 PM.
  expect((within(sheet).getByRole("combobox", { name: "Start" }) as HTMLSelectElement).value).toBe(String(16 * 60));
  expect(within(sheet).getByText("✓ Free 4:00 PM–5:00 PM for you and Carlo")).toBeTruthy();
  fireEvent.change(within(sheet).getByRole("combobox", { name: "Start" }), { target: { value: String(15 * 60 + 30) } });
  expect(within(sheet).getByText("You have Jenny at 3:00 PM–4:00 PM")).toBeTruthy();
  expect((within(sheet).getByRole("button", { name: /That time is taken/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(sheet).getByRole("combobox", { name: "Start" }), { target: { value: String(16 * 60 + 15) } });
  fireEvent.change(within(sheet).getByRole("combobox", { name: "Length" }), { target: { value: "45" } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Legs" }));
  expect(within(sheet).getByText(/4:15 PM through Dec 17 · 5 of Carlo’s 10 sessions/)).toBeTruthy();
  fireEvent.click(within(sheet).getByRole("checkbox", { name: /Repeat every Thursday/ }));
  fireEvent.click(within(sheet).getByRole("button", { name: /Add 5 Thursdays/ }));
  expect((await posted("/api/coach/bookings"))[0]).toEqual({ action: "book", personId: "carlo", date: "2026-11-19", start: 16 * 60 + 15, minutes: 45, muscles: ["Legs"], weeks: 5 });
});
