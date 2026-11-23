// @vitest-environment jsdom
vi.hoisted(() => {
  if (!window.AnimationEvent) Object.defineProperty(window, "AnimationEvent", { value: window.Event, configurable: true });
});
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemberSessions } from "./member-sessions";

const row = (id: string, date: string, start: number | null, extra = {}) => ({ id, date, start, minutes: start === null ? null : 60, coachName: "Marco", outcome: null,
  started: true, muscles: [], exercises: [], note: null, ...extra });
const november = {
  month: "2026-11", today: "2026-11-23",
  sessions: [
    row("w", "2026-11-05", null, { outcome: "done" }),
    row("x", "2026-11-16", 7 * 60, { outcome: "no_show", muscles: ["Legs"] }),
    row("d", "2026-11-23", 7 * 60, { outcome: "done", muscles: ["Legs", "Glutes"], note: "Great depth on squats.",
      exercises: [{ name: "Back squat", done: true, sets: [{ reps: 8, kg: 60 }, { reps: 6, kg: 65 }] }, { name: "Walking lunge", done: true, sets: [{ reps: 12, kg: null }] },
        { name: "Calf raise", done: false, sets: [] }] }),
    row("n", "2026-11-25", 7 * 60, { started: false, muscles: ["Legs"] }),
    row("u", "2026-11-30", 7 * 60, { started: false }),
  ],
  next: { date: "2026-11-25", start: 7 * 60, end: 8 * 60, coachName: "Marco", muscles: ["Legs"] },
};
const fetch = vi.fn();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse("2026-11-23T04:00:00Z"));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  fetch.mockReset().mockImplementation(async (path: string) => new Response(JSON.stringify(path.endsWith("2026-11") ? november : { ...november, month: "2026-10", sessions: [] })));
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("shows the month's sessions as cards with the next one, then a session's exercises, sets and the coach's note", async () => {
  render(<MemberSessions sessionsLeft={8} sessions={12} />);
  expect(await screen.findByRole("button", { name: "Monday, November 23, Legs, Glutes, ✓ Done · 2 of 3" })).toBeTruthy();
  expect(String(fetch.mock.calls[0][0])).toBe("/api/customer/coaching?month=2026-11");
  expect(screen.getByRole("button", { name: "Wednesday, November 25, Legs, Next · Coach Marco" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Monday, November 30, Coaching session, Coming up" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Monday, November 16, Legs, No-show" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Thursday, November 5, Recorded, ✓ Done" }).textContent).toContain("No time recorded");
  expect(screen.getByText(/^Next:/).textContent).toBe("Next: Wed, Nov 25 · 7:00 AM · Coach Marco");
  expect(screen.getByText("of 12 left", { exact: false }).textContent).toBe("8 of 12 left");

  fireEvent.click(screen.getByRole("button", { name: /^Monday, November 23/ }));
  const sheet = screen.getByRole("dialog", { name: "Legs, Glutes" });
  expect(within(sheet).getByText("Mon, Nov 23 · 7:00 AM–8:00 AM")).toBeTruthy();
  expect(within(sheet).getByText("2 of 3")).toBeTruthy();
  expect(within(sheet).getByText("8 × 60 kg")).toBeTruthy();
  expect(within(sheet).getByText("6 × 65 kg")).toBeTruthy();
  expect(within(sheet).getByText("12 reps")).toBeTruthy();
  expect(within(sheet).getByLabelText("Not done").nextSibling?.textContent).toBe("Calf raise");
  expect(within(sheet).getByText("Great depth on squats.")).toBeTruthy();

  fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(await screen.findByText("No sessions in October.")).toBeTruthy();
  expect(String(fetch.mock.calls.at(-1)![0])).toBe("/api/customer/coaching?month=2026-10");
});
