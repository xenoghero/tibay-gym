// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase/firestore";
vi.mock("@/lib/db", () => ({ listPersons: vi.fn(async () => []) }));
vi.mock("@/lib/csv", () => ({ downloadCsv: vi.fn(), toCsv: vi.fn(() => "csv") }));
import { listPersons, type Person } from "@/lib/db";
import { downloadCsv, toCsv } from "@/lib/csv";
import { LeadStatistics } from "./lead-statistics";

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it("loads only when opened, filters by registration date, exports the same totals and retains filters", async () => {
  vi.mocked(listPersons).mockResolvedValue([
    { id: "old", type: "member", createdAt: Timestamp.fromDate(new Date(2020, 0, 1)), leadSource: "facebook" },
    { id: "new", type: "guest", createdAt: Timestamp.now(), leadSource: "ads" },
  ] as Person[]);
  const view = render(<LeadStatistics enabled={false} />);
  expect(listPersons).not.toHaveBeenCalled();
  await act(async () => { view.rerender(<LeadStatistics enabled />); });
  const table = screen.getByRole("table");
  expect(within(table).getByRole("row", { name: "Facebook Page 0 0.0% 0 0" })).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "all" } });
  expect(within(table).getByRole("row", { name: "Facebook Page 1 50.0% 1 0" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Leads CSV" }));
  expect(downloadCsv).toHaveBeenCalledWith("tibay-gym-leads_all-time.csv", expect.anything());
  expect(vi.mocked(toCsv).mock.calls[0][1]).toContainEqual(["Facebook Page", 1, "50.0%", 1, 0]);
  view.rerender(<LeadStatistics enabled={false} />);
  view.rerender(<LeadStatistics enabled />);
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("all");
  expect(listPersons).toHaveBeenCalledTimes(1);
});

it("recovers failed reads through refresh and displays an empty period", async () => {
  vi.mocked(listPersons).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
  await act(async () => { render(<LeadStatistics enabled />); });
  expect(screen.getByRole("alert").textContent).toContain("Couldn't load leads");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh leads" })); });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("No new clients in this period")).toBeTruthy();
});

it("blocks reversed or incomplete custom ranges and their exports", async () => {
  vi.mocked(listPersons).mockResolvedValue([]);
  await act(async () => { render(<LeadStatistics enabled />); });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "custom" } });
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Leads start date"), { target: { value: "2026-10-30" } });
  fireEvent.change(screen.getByLabelText("Leads end date"), { target: { value: "2026-10-01" } });
  expect(screen.getByRole("alert")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Leads CSV" }) as HTMLButtonElement).disabled).toBe(true);
});
