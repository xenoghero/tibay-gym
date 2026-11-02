import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/server/promotions", () => ({ getPromotionSettings: mocks.get }));
import { GET } from "./route";
it("returns only visible banners in order, without admin revision or enabled flags", async () => {
  mocks.get.mockResolvedValue({ revision: 9, banners: [
    { id: "hidden", title: "Draft", imageUrl: "https://test/hidden", enabled: false },
    { id: "visible", title: "Offer", imageUrl: "https://test/visible", enabled: true },
  ] });
  const response = await GET();
  expect(await response.json()).toEqual({ banners: [{ id: "visible", title: "Offer", imageUrl: "https://test/visible" }] });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
