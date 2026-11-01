// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: account }) }));
const account = { getIdToken: async () => "admin-token" };
import { RegistrationSettings } from "./registration-settings";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("loads the saved switch and persists the opposite value with its revision", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ requireVerification: true, revision: 3 }))
    .mockResolvedValueOnce(Response.json({ requireVerification: false, revision: 4 }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<RegistrationSettings />); });
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  await act(async () => { fireEvent.click(screen.getByRole("switch")); });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ requireVerification: false, revision: 3 });
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  expect(screen.getByRole("status").textContent).toContain("saved");
});
it("retains the saved state and requires a reload after a conflicting change", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ requireVerification: true, revision: 3 }))
    .mockResolvedValueOnce(Response.json({}, { status: 409 })));
  await act(async () => { render(<RegistrationSettings />); });
  await act(async () => { fireEvent.click(screen.getByRole("switch")); });
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("alert").textContent).toContain("another session");
  expect(screen.getByRole<HTMLButtonElement>("switch").disabled).toBe(true);
});
