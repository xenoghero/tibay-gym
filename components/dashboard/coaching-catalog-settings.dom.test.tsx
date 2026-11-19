// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: admin }) }));
const admin = { getIdToken: async () => "synthetic-token" };
import { CoachingCatalogSettings } from "./coaching-catalog-settings";
const catalog = { revision: 3, topUpPriceMinor: 25000, topUpValidityDays: 30, packages: [
  { id: "pkg-a", priceMinor: 75000, sessions: 4, validityDays: 7, visible: true },
  { id: "pkg-b", priceMinor: 150000, sessions: 8, validityDays: 15, visible: true },
] };
let posted: { packages: unknown[] } & Record<string, unknown> | null;
beforeEach(() => {
  posted = null;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { posted = JSON.parse(String(init.body)); return Response.json({ ...posted, revision: 4 }); }
    return Response.json(catalog);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("saves one edited package without touching the others and confirms with a toast", async () => {
  const onSaved = vi.fn();
  await act(async () => { render(<CoachingCatalogSettings onSaved={onSaved} />); });
  expect(screen.getAllByText(/4 sessions · 7 days · ₱188 \/ session/)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Edit ₱1,500 package" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Price (₱)"), { target: { value: "1600" } });
  fireEvent.click(within(dialog).getByRole("switch", { name: /Show to customers/ }));
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Save package" })); });
  expect(posted).toMatchObject({ revision: 3, topUpPriceMinor: 25000, topUpValidityDays: 30, packages: [catalog.packages[0], { id: "pkg-b", priceMinor: 160000, sessions: 8, validityDays: 15, visible: false }] });
  expect(onSaved).toHaveBeenCalledWith("₱1,600 package saved. Applies to new purchases.");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("appends a new package with a fresh id", async () => {
  await act(async () => { render(<CoachingCatalogSettings onSaved={() => {}} />); });
  fireEvent.click(screen.getByRole("button", { name: "Add package" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Price (₱)"), { target: { value: "5000" } });
  fireEvent.change(within(dialog).getByLabelText("Sessions"), { target: { value: "20" } });
  fireEvent.change(within(dialog).getByLabelText("Valid for (days)"), { target: { value: "60" } });
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Add package" })); });
  expect(posted?.packages).toHaveLength(3);
  expect(posted?.packages[2]).toEqual({ id: "pkg-custom-3", priceMinor: 500000, sessions: 20, validityDays: 60, visible: false });
});
