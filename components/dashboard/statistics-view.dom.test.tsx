// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./finance-statistics", () => ({ FinanceStatistics: () => <p>Collections report fixture</p> }));
vi.mock("@/lib/db", () => ({
  getLogsInRange: vi.fn(async () => []),
  listPersons: vi.fn(async () => []),
  getMembershipExpiryWatch: vi.fn(async () => []),
  effectiveMemberStatus: () => "active",
  RANGE_QUERY_LIMIT: 5000,
}));
vi.mock("@/lib/csv", () => ({ downloadCsv: vi.fn(), toCsv: vi.fn() }));
import { StatisticsView } from "./statistics-view";
import { getLogsInRange, getMembershipExpiryWatch } from "@/lib/db";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("shows one report at a time and supports arrow, Home and End tab navigation", async () => {
  await act(async () => { render(<StatisticsView />); });
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("statistics-tab-collections");
  expect(screen.queryByRole("button", { name: "Attendance CSV" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("tab", { name: "Collections" }), { key: "ArrowRight" });
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("statistics-tab-attendance");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Attendance" }));
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("statistics-tab-renewals");
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(screen.getByRole("tab", { name: "Collections" }).getAttribute("aria-selected")).toBe("true");
});

it("retains attendance filters across tabs and keeps the renewal window independent", async () => {
  await act(async () => { render(<StatisticsView />); });
  fireEvent.click(screen.getByRole("tab", { name: "Attendance" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Last 30 days" })); });
  const attendanceQueries = vi.mocked(getLogsInRange).mock.calls.length;
  fireEvent.click(screen.getByRole("tab", { name: "Renewals" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "14 days" })); });
  expect(getMembershipExpiryWatch).toHaveBeenLastCalledWith(14);
  expect(getLogsInRange).toHaveBeenCalledTimes(attendanceQueries);
  fireEvent.click(screen.getByRole("tab", { name: "Attendance" }));
  expect(screen.getByRole("button", { name: "Last 30 days" }).getAttribute("aria-pressed")).toBe("true");
});

it("recovers attendance errors through refresh without showing an endless skeleton", async () => {
  vi.mocked(getLogsInRange).mockRejectedValueOnce(new Error("offline"));
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => { render(<StatisticsView />); });
  fireEvent.click(screen.getByRole("tab", { name: "Attendance" }));
  expect(screen.getByRole("alert").textContent).toContain("Couldn't load");
  const refresh = screen.getByRole("button", { name: "Refresh attendance" }) as HTMLButtonElement;
  expect(refresh.disabled).toBe(false);
  await act(async () => { fireEvent.click(refresh); });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(within(screen.getByRole("tabpanel")).getByText("No check-ins in this date range.")).toBeTruthy();
  errorLog.mockRestore();
});
