// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { voucherFixture } from "@/tests/voucher-fixture";
import { DEFAULT_SETTINGS } from "@/lib/finance/rules";
const authMock = vi.hoisted(() => ({ user: { getIdToken: async () => "synthetic-token" } }));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => authMock }));
import { FinanceSettings } from "./finance-settings";
import { VoucherSettings } from "./voucher-settings";
const pricing = { ...DEFAULT_SETTINGS, studentMonthlyMinor: 100000, rateRevision: 1, financialCutoverAt: 1000 };
let posts: Array<{ url: string; body: Record<string, unknown> }>;
beforeEach(() => {
  posts = [];
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { const body = JSON.parse(String(init.body)); posts.push({ url, body }); return Response.json(url.includes("vouchers") ? { ...voucherFixture(), ...body, id: "created-voucher", status: "enabled", revision: 1 } : { ...pricing, ...body, rateRevision: 2 }); }
    if (url.includes("vouchers")) return Response.json({ records: [voucherFixture({ heldCount: 2, confirmedCount: 3, confirmedDiscountMinor: 1800 })], nextCursor: null });
    return Response.json(pricing);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("compares rates before editing and explicitly reviews changes before saving", async () => {
  await act(async () => { render(<FinanceSettings />); });
  expect(screen.queryByLabelText("Student daily (PHP)")).toBeNull();
  expect(screen.getByText("Membership purchases unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit prices" }));
  fireEvent.change(screen.getByLabelText("Student daily (PHP)"), { target: { value: "65" } });
  fireEvent.submit(screen.getByRole("button", { name: "Review changes" }).closest("form")!);
  const dialog = screen.getByRole("dialog"); expect(dialog.textContent).toContain("₱60.00 → ₱65.00"); expect(posts).toHaveLength(0);
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" })); });
  expect(posts[0].body).toMatchObject({ studentDailyMinor: 6500, rateRevision: 1 });
  expect(screen.getByRole("status").textContent).toContain("Rates saved");
});
it("creates a voucher with explicit scopes and integer centavos", async () => {
  await act(async () => { render(<VoucherSettings />); });
  expect(screen.getByText("3 confirmed")).toBeTruthy(); expect(screen.getByText(/2 held/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "+ Create voucher" }));
  fireEvent.change(screen.getByLabelText("Code"), { target: { value: "DAILY10" } });
  fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Daily kickoff" } });
  fireEvent.change(screen.getByLabelText("Amount off (PHP)"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Total uses (optional)"), { target: { value: "20" } });
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "Save voucher" }).closest("form")!); });
  expect(posts[0].body).toMatchObject({ code: "DAILY10", value: 1000, kinds: ["daily_session"], categories: ["student", "regular"], totalLimit: 20, customerLimit: 1 });
  expect(screen.getByText("Voucher saved. Existing purchases keep their original discount.")).toBeTruthy();
});
it("requires a code-specific confirmation before pausing", async () => {
  await act(async () => { render(<VoucherSettings />); });
  fireEvent.click(screen.getByText("More actions"));
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  const dialog = screen.getByRole("dialog"); expect(dialog.textContent).toContain("Pause TRAIN10?"); expect(posts).toHaveLength(0);
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" })); });
  expect(posts[0].body).toMatchObject({ id: "voucher-1", revision: 1, action: "pause" });
});
