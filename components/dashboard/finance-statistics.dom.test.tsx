// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "synthetic-token" } } }));
import { FinanceStatistics } from "./finance-statistics";
import { auth } from "@/lib/firebase";
import { buildFinanceReport, reportRange } from "@/lib/finance/report";
import { AT, chargeFixture, paymentFixture } from "@/tests/finance-fixtures";
const fixture = () => {
  const c = chargeFixture("example");
  return { ...buildFinanceReport([c], [paymentFixture("pay", c)], reportRange(new URLSearchParams({ date: "2026-10-26" }))), revision: "snapshot-1", nextCursor: null, generatedAt: AT, financialCutoverAt: AT };
};
beforeEach(() => {
  // Firebase supplies a new User object after a new sign-in. Keep caches isolated.
  Object.assign(auth, { currentUser: { getIdToken: async () => "synthetic-token" } });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fixture())));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("shows distinct totals, exact daily amounts, immutable categories and labelled date controls", async () => {
  await act(async () => { render(<FinanceStatistics />); });
  expect(screen.getByText("Expected charges / recorded purchases")).toBeTruthy();
  expect(screen.getByText("Pending daily payments")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Financial records" }).textContent).toContain("student");
  expect(screen.getByRole("region", { name: "Daily collection amounts" }).textContent).toContain("2026-10-26");
  await act(async () => { fireEvent.change(screen.getByLabelText("Period"), { target: { value: "week" } }); });
  expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain("period=week");
  await act(async () => { fireEvent.change(screen.getByLabelText("Period"), { target: { value: "custom" } }); });
  expect(screen.getByLabelText("Through")).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer synthetic-token" });
});
it("withholds stale money on failure and recovers through an explicit refresh", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "report-record-limit" }, { status: 413 }));
  await act(async () => { render(<FinanceStatistics compact />); });
  expect(screen.getByRole("alert").textContent).toContain("shorter period");
  expect(screen.queryByText("Expected charges / recorded purchases")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh collections" })); });
  expect(screen.queryByRole("alert")).toBeNull(); expect(screen.getByText("Expected charges / recorded purchases")).toBeTruthy();
});
it("refuses mixing ledger pages when the source snapshot changed", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...fixture(), nextCursor: "more" })).mockResolvedValueOnce(Response.json({ ...fixture(), revision: "snapshot-2" }));
  await act(async () => { render(<FinanceStatistics />); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Load more records" })); });
  expect(screen.getByRole("alert").textContent).toContain("Collections changed");
  expect(screen.getByRole("region", { name: "Financial records" }).querySelectorAll("tbody tr")).toHaveLength(1);
});

it("does not reload collections when returning from another window or browser tab", async () => {
  await act(async () => { render(<FinanceStatistics compact />); });
  await act(async () => { fireEvent.focus(window); fireEvent(document, new Event("visibilitychange")); });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps loaded totals visible during the automatic refresh", async () => {
  vi.useFakeTimers();
  await act(async () => { render(<FinanceStatistics compact />); });
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(screen.getByText("Confirmed collections")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Updating");
});

it("reuses a recent compact report when navigating away and back", async () => {
  const view = await act(async () => render(<FinanceStatistics compact />));
  view.unmount();
  await act(async () => { render(<FinanceStatistics compact />); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Confirmed collections")).toBeTruthy();
});

it("refreshes expired cached reports while retaining the last snapshot", async () => {
  vi.useFakeTimers();
  const view = await act(async () => render(<FinanceStatistics compact />));
  view.unmount();
  vi.advanceTimersByTime(61_000);
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => { render(<FinanceStatistics compact />); });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Confirmed collections")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Updating");
});

it("does not reuse another signed-in user's report", async () => {
  const view = await act(async () => render(<FinanceStatistics compact />));
  view.unmount();
  Object.assign(auth, { currentUser: { getIdToken: async () => "another-token" } });
  await act(async () => { render(<FinanceStatistics compact />); });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("withholds cached totals when an automatic update fails", async () => {
  vi.useFakeTimers();
  await act(async () => { render(<FinanceStatistics compact />); });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "financial-data-conflict" }, { status: 409 }));
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(screen.getByRole("alert").textContent).toContain("reconciliation");
  expect(screen.queryByText("Confirmed collections")).toBeNull();
});

it("pauses automatic requests while the browser tab is hidden", async () => {
  vi.useFakeTimers();
  await act(async () => { render(<FinanceStatistics compact />); });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => { vi.advanceTimersByTime(120_000); });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("switches to the next Philippine date without showing yesterday's totals", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T15:59:30Z"));
  await act(async () => { render(<FinanceStatistics compact />); });
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => { vi.advanceTimersByTime(30_000); });
  expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain("date=2026-10-29");
  expect(screen.queryByText("Confirmed collections")).toBeNull();
});

it("hides yesterday's totals immediately while the resumed day's report is loading", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T15:59:30Z"));
  await act(async () => { render(<FinanceStatistics compact />); });
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
  vi.setSystemTime(new Date("2026-10-30T09:00:00Z"));
  await act(async () => { fireEvent(document, new Event("visibilitychange")); });
  expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain("date=2026-10-30");
  expect(screen.queryByText("Confirmed collections")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Loading collections");
});

it("preserves the selected date in Statistics when manually refreshing on a later day", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T09:00:00Z"));
  await act(async () => { render(<FinanceStatistics />); });
  vi.setSystemTime(new Date("2026-10-30T09:00:00Z"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh collections" })); });
  expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain("date=2026-10-29");
});

for (const trigger of ["manual refresh", "return to tab", "window focus"] as const) {
  it(`drops yesterday's membership collections on ${trigger} after midnight`, async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T15:59:30Z"));
    const recordedAt = Date.parse("2026-10-29T09:00:00Z");
    const charge = chargeFixture("yesterday-membership", {
      kind: "new_membership", amountMinor: 60000, chargeDate: "2026-10-29",
      recognizedPurchaseAt: recordedAt, confirmedPaymentRequestId: "membership-payment",
    });
    const payment = paymentFixture("membership-payment", charge, { status: "approved", confirmedAt: recordedAt });
    vi.mocked(fetch).mockImplementation(async input => Response.json({
      ...buildFinanceReport([charge], [payment], reportRange(new URL(String(input), "http://localhost").searchParams)),
      revision: "membership-snapshot", nextCursor: null, generatedAt: Date.now(), financialCutoverAt: AT,
    }));
    await act(async () => { render(<FinanceStatistics compact />); });
    expect(screen.getByText(/1 confirmed transactions/)).toBeTruthy();
    // Simulate a suspended browser: wall time changes without running the interval.
    vi.setSystemTime(new Date("2026-10-30T09:00:00Z"));
    await act(async () => {
      if (trigger === "manual refresh") fireEvent.click(screen.getByRole("button", { name: "Refresh collections" }));
      else if (trigger === "return to tab") fireEvent(document, new Event("visibilitychange"));
      else fireEvent.focus(window);
    });
    expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain("date=2026-10-30");
    expect(screen.getByText(/0 confirmed transactions/)).toBeTruthy();
    expect(screen.queryByText(/1 confirmed transactions/)).toBeNull();
  });
}
