// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: admin }) }));
const admin = { getIdToken: async () => "synthetic-token" };
import { PaymentMethodSettings } from "./payment-method-settings";
let saved: Record<string, unknown> | null;
beforeEach(() => {
  saved = null;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { saved = JSON.parse(String(init.body)); return Response.json({ ...saved, revision: 1 }); }
    return Response.json({ revision: 0, accounts: [] });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("edits the fixed GCash details and preserves leading zeroes", async () => {
  await act(async () => { render(<PaymentMethodSettings />); });
  expect(screen.queryByRole("button", { name: "Add payment account" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit GCash details" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByLabelText("Account type")).toBeNull();
  expect(within(dialog).queryByLabelText("Display name")).toBeNull();
  fireEvent.change(within(dialog).getByLabelText("Account holder"), { target: { value: "Tibay Gym" } });
  const account = within(dialog).getByLabelText("Account / mobile number") as HTMLInputElement;
  expect(account.type).toBe("tel");
  expect(account.inputMode).toBe("numeric");
  fireEvent.change(account, { target: { value: "09171234567" } });
  await act(async () => { fireEvent.submit(within(dialog).getByRole("button", { name: "Save GCash details" }).closest("form")!); });
  expect(saved).toMatchObject({ revision: 0, accounts: [{ kind: "gcash", name: "GCash", accountHolder: "Tibay Gym", accountNumber: "09171234567", enabled: true, qrImage: null }] });
  expect(screen.getByText("09171234567")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("edits the existing GCash identity while removing legacy methods from settings", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ revision: 4, accounts: [
    { id: "account_bank0001", kind: "bank", name: "Bank", enabled: true },
    { id: "account_gcash001", kind: "gcash", name: "Old wallet", accountHolder: "Gym", accountNumber: "09171234567", enabled: true, qrImage: null },
  ] }));
  await act(async () => { render(<PaymentMethodSettings />); });
  expect(screen.queryByText("Bank")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit GCash details" }));
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "Save GCash details" }).closest("form")!); });
  expect(saved).toMatchObject({ revision: 4, accounts: [{ id: "account_gcash001", kind: "gcash", name: "GCash" }] });
  expect((saved!.accounts as unknown[]).length).toBe(1);
});

it("shows the saved QR beside receiving details and keeps it when editing details", async () => {
  const qrImage = "data:image/png;base64,c3ludGhldGljLXFy";
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ revision: 1, accounts: [
    { id: "account_gcash001", kind: "gcash", name: "GCash", accountHolder: "Gym", accountNumber: "09171234567", enabled: true, qrImage },
  ] }));
  await act(async () => { render(<PaymentMethodSettings />); });
  expect(screen.getByRole("img", { name: "GCash payment QR code" }).getAttribute("src")).toBe(qrImage);
  expect(screen.getByText("Configured")).toBeTruthy();
  expect(screen.getByText("Account holder").tagName).toBe("DT");
  expect(screen.getByText("09171234567")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Cash" }).textContent).toContain("Always available");
  fireEvent.click(screen.getByRole("button", { name: "Edit GCash details" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Account holder"), { target: { value: "Updated Gym" } });
  await act(async () => { fireEvent.submit(within(dialog).getByRole("button", { name: "Save GCash details" }).closest("form")!); });
  expect(saved).toMatchObject({ accounts: [{ accountHolder: "Updated Gym", qrImage }] });
  expect(screen.getByRole("img", { name: "GCash payment QR code" }).getAttribute("src")).toBe(qrImage);
});

it("shows a setup state without displaying a placeholder payment QR", async () => {
  await act(async () => { render(<PaymentMethodSettings />); });
  expect(screen.getByText("Needs setup")).toBeTruthy();
  expect(screen.getByText("No QR image uploaded")).toBeTruthy();
  expect(screen.queryByRole("img", { name: "GCash payment QR code" })).toBeNull();
  expect(screen.getByRole("button", { name: "Edit GCash details" })).toBeTruthy();
});
