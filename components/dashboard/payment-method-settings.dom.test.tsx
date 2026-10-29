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
it("adds a bank account in the existing settings drawer and preserves leading zeroes", async () => {
  await act(async () => { render(<PaymentMethodSettings />); });
  fireEvent.click(screen.getByRole("button", { name: "Add payment account" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Account type"), { target: { value: "bank" } });
  fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "BPI savings" } });
  fireEvent.change(within(dialog).getByLabelText("Account holder"), { target: { value: "Tibay Gym" } });
  fireEvent.change(within(dialog).getByLabelText("Account / mobile number"), { target: { value: "0012345678" } });
  await act(async () => { fireEvent.submit(within(dialog).getByRole("button", { name: "Save payment account" }).closest("form")!); });
  expect(saved).toMatchObject({ revision: 0, accounts: [{ kind: "bank", accountHolder: "Tibay Gym", accountNumber: "0012345678", enabled: true, qrImage: null }] });
  expect(screen.getByText("BPI savings")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});
