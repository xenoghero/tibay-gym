// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CheckInFeed, type CheckInRow } from "./check-in-feed";

afterEach(cleanup);
const rows = (count: number): CheckInRow[] => Array.from({ length: count }, (_, i) => ({
  logId: `visit-${i}`, personId: `person-${i}`, name: `Visitor ${i + 1}`, phone: "0917 555 0123",
  typeLabel: "Guest", sourceLabel: "QR", time: "2:05 PM", badge: { text: "1 visit", kind: "guest" },
}));
const feed = () => within(screen.getByRole("region", { name: "Check-in rows" }));
const next = () => screen.getByRole("button", { name: "Next check-in page" });
const previous = () => screen.getByRole("button", { name: "Previous check-in page" });

it("paginates all check-ins with correct ranges, numbered navigation and end controls", () => {
  render(<CheckInFeed rows={rows(23)} loading={false} />);
  expect(feed().getAllByRole("link")).toHaveLength(10);
  expect(screen.getByText("Showing 1–10 of 23")).toBeTruthy();
  expect((previous() as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(next());
  expect(feed().getByText("Visitor 11")).toBeTruthy();
  expect(feed().queryByText("Visitor 1")).toBeNull();
  expect(screen.getByRole("button", { name: "Check-in page 2" }).getAttribute("aria-current")).toBe("page");
  fireEvent.click(screen.getByRole("button", { name: "Check-in page 3" }));
  expect(screen.getByText("Showing 21–23 of 23")).toBeTruthy();
  expect(feed().getAllByRole("link")).toHaveLength(3);
  expect((next() as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(previous());
  expect(screen.getByText("Showing 11–20 of 23")).toBeTruthy();
  expect(feed().getByText("Visitor 11").closest("a")?.getAttribute("href")).toBe("/dashboard/people/person-10");
});

it("resets to page one when changing the page size", () => {
  render(<CheckInFeed rows={rows(31)} loading={false} />);
  fireEvent.click(next());
  fireEvent.change(screen.getByLabelText("Per page"), { target: { value: "25" } });
  expect(feed().getAllByRole("link")).toHaveLength(25);
  expect(screen.getByText("Showing 1–25 of 31")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Per page"), { target: { value: "5" } });
  expect(feed().getAllByRole("link")).toHaveLength(5);
  expect(screen.getByText("Showing 1–5 of 31")).toBeTruthy();
});

it("preserves the selected page during live updates and clamps it after deletions", () => {
  const view = render(<CheckInFeed rows={rows(23)} loading={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Check-in page 3" }));
  view.rerender(<CheckInFeed rows={rows(24)} loading={false} />);
  expect(screen.getByText("Showing 21–24 of 24")).toBeTruthy();
  view.rerender(<CheckInFeed rows={rows(10)} loading={false} />);
  expect(screen.getByText("Showing 1–10 of 10")).toBeTruthy();
  view.rerender(<CheckInFeed rows={rows(24)} loading={false} />);
  expect(screen.getByText("Showing 1–10 of 24")).toBeTruthy();
});

it("bounds page buttons for large attendance lists while keeping the last page accessible", () => {
  render(<CheckInFeed rows={rows(1000)} loading={false} />);
  const nav = within(screen.getByRole("navigation", { name: "Check-in pagination" }));
  expect(nav.getAllByRole("button").length).toBeLessThanOrEqual(7);
  fireEvent.click(nav.getByRole("button", { name: "Check-in page 100" }));
  expect(feed().getByText("Visitor 1000")).toBeTruthy();
  expect(screen.getByText("Showing 991–1000 of 1000")).toBeTruthy();
});

it("handles loading, empty and single-page states without misleading controls", () => {
  const view = render(<CheckInFeed rows={[]} loading />);
  expect(screen.getByText("Loading check-ins…")).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Check-in pagination" })).toBeTruthy();
  expect((previous() as HTMLButtonElement).disabled).toBe(true);
  expect((next() as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<CheckInFeed rows={[]} loading={false} />);
  expect(screen.getByText("No check-ins yet today")).toBeTruthy();
  expect(screen.getByText("Showing 0–0 of 0")).toBeTruthy();
  expect((previous() as HTMLButtonElement).disabled).toBe(true);
  expect((next() as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<CheckInFeed rows={rows(1)} loading={false} />);
  expect(screen.getByText("Showing 1–1 of 1")).toBeTruthy();
  expect((previous() as HTMLButtonElement).disabled).toBe(true);
  expect((next() as HTMLButtonElement).disabled).toBe(true);
});
