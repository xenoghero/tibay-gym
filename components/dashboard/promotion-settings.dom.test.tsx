// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PromotionSettings as Settings } from "@/lib/promotions";
const mocks = vi.hoisted(() => ({ user: { getIdToken: async () => "admin-token" }, fetch: vi.fn() }));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("next/image", () => ({ default: ({ unoptimized: _, ...props }: Record<string, unknown>) => createElement("img", props) }));
import { PromotionSettings } from "./promotion-settings";
let settings: Settings;
let conflict: boolean;
beforeEach(() => {
  conflict = false;
  settings = { revision: 3, banners: [
    { id: "one", title: "First offer", enabled: true, imageUrl: "/one.webp" },
    { id: "two", title: "Second offer", enabled: false, imageUrl: "/two.webp" },
  ] };
  mocks.fetch.mockReset().mockImplementation(async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      if (conflict) return Response.json({ error: "settings-changed" }, { status: 409 });
      const body = JSON.parse(String(options.body));
      return Response.json({ ...body, revision: body.revision + 1, banners: body.banners.map((banner: { id: string }) => ({ ...settings.banners.find(item => item.id === banner.id), ...banner })) });
    }
    if (options?.method === "PUT") return Response.json({ ...settings, revision: 4, banners: [...settings.banners, { id: "three", title: "New offer", enabled: true, imageUrl: "/three.webp" }] });
    return Response.json(settings);
  });
  vi.stubGlobal("fetch", mocks.fetch);
  URL.createObjectURL = vi.fn(() => "blob:preview"); URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows dimension guidance and an admin empty state without publishing anything", async () => {
  settings.banners = [];
  await act(async () => { render(<PromotionSettings />); });
  expect(screen.getByText("No promotions yet")).toBeDefined();
  expect(screen.getByText("Design your banner at 1500 × 500 px")).toBeDefined();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
it("reviews ordering, visibility and removals before saving the current revision", async () => {
  await act(async () => { render(<PromotionSettings />); });
  fireEvent.click(screen.getByRole("button", { name: "Move banner 2 earlier" }));
  expect(screen.getByLabelText("Banner 1 description").getAttribute("value")).toBe("Second offer");
  fireEvent.click(screen.getAllByLabelText("Visible on check-in")[0]);
  fireEvent.click(screen.getByRole("button", { name: "Remove banner 2" }));
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({ revision: 3, banners: [{ id: "two", title: "Second offer", enabled: true }] });
  expect(screen.getByRole("status").textContent).toBe("Promotions saved.");
});
it("keeps drafts on stale-save errors and requires reloading before another mutation", async () => {
  conflict = true;
  await act(async () => { render(<PromotionSettings />); });
  fireEvent.change(screen.getByLabelText("Banner 1 description"), { target: { value: "Edited offer" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(screen.getByRole("alert").textContent).toContain("another session");
  expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByLabelText("Banner 1 description").getAttribute("value")).toBe("Edited offer");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reload promotions" })); });
  expect(screen.getByLabelText("Banner 1 description").getAttribute("value")).toBe("First offer");
});
it("previews an image and publishes it with an authenticated binary upload", async () => {
  await act(async () => { render(<PromotionSettings />); });
  const file = new File(["image bytes"], "offer.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Banner image"), { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText("Banner description"), { target: { value: "New offer" } });
  expect(screen.getByAltText("Selected banner preview")).toBeDefined();
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "Upload & publish" }).closest("form")!); });
  const request = mocks.fetch.mock.calls[1][1];
  expect(request.method).toBe("PUT"); expect(request.body).toBe(file);
  expect(request.headers).toMatchObject({ Authorization: "Bearer admin-token", "Content-Type": "image/png", "x-promotion-title": "New%20offer" });
  expect(screen.getByRole("status").textContent).toContain("published");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});
