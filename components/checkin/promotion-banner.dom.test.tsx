// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PromotionBanner, PromotionCarousel } from "./promotion-banner";
vi.mock("next/image", () => ({ default: ({ unoptimized: _, ...props }: Record<string, unknown>) => createElement("img", props) }));
const banners = [
  { id: "one", title: "Bring a friend", imageUrl: "/one.webp" },
  { id: "two", title: "November offer", imageUrl: "/two.webp" },
];
let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("renders nothing when there are no promotions or the optional request fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await act(async () => { render(<PromotionBanner />); });
  expect(screen.queryByRole("region", { name: "Gym promotions" })).toBeNull();
});
it("shows one banner without pagination or rotation controls", () => {
  render(<PromotionCarousel banners={[banners[0]]} />);
  expect(screen.getByAltText("Bring a friend")).toBeDefined();
  expect(screen.queryByRole("button")).toBeNull();
});
it("rotates, wraps, supports next/previous and dots, and can pause", () => {
  vi.useFakeTimers(); render(<PromotionCarousel banners={banners} />);
  act(() => vi.advanceTimersByTime(6000)); expect(screen.getByAltText("November offer")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Next promotion" })); expect(screen.getByAltText("Bring a friend")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Previous promotion" })); expect(screen.getByAltText("November offer")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Show promotion 1: Bring a friend" }));
  fireEvent.click(screen.getByRole("button", { name: "Pause automatic promotions" }));
  act(() => vi.advanceTimersByTime(12000)); expect(screen.getByAltText("Bring a friend")).toBeDefined();
});
it("pauses on hover, keyboard focus, hidden tabs, and reduced motion", () => {
  vi.useFakeTimers(); render(<PromotionCarousel banners={banners} />);
  const region = screen.getByRole("region", { name: "Gym promotions" });
  fireEvent.mouseEnter(region); act(() => vi.advanceTimersByTime(6000)); expect(screen.getByAltText("Bring a friend")).toBeDefined();
  fireEvent.mouseLeave(region);
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  fireEvent(document, new Event("visibilitychange"));
  act(() => vi.advanceTimersByTime(6000)); expect(screen.getByAltText("Bring a friend")).toBeDefined();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  fireEvent(document, new Event("visibilitychange"));
  fireEvent.focus(screen.getByRole("button", { name: "Next promotion" }));
  act(() => vi.advanceTimersByTime(6000)); expect(screen.getByAltText("Bring a friend")).toBeDefined();
  cleanup(); reduced = true; render(<PromotionCarousel banners={banners} />);
  act(() => vi.advanceTimersByTime(12000)); expect(screen.getByAltText("Bring a friend")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Pause automatic promotions" })).toBeNull();
});
it("supports horizontal swipes while leaving vertical scrolling alone", () => {
  render(<PromotionCarousel banners={banners} />);
  const image = screen.getByAltText("Bring a friend").parentElement!.parentElement!;
  fireEvent.touchStart(image, { touches: [{ clientX: 200, clientY: 100 }] });
  fireEvent.touchEnd(image, { changedTouches: [{ clientX: 100, clientY: 110 }] });
  expect(screen.getByAltText("November offer")).toBeDefined();
  fireEvent.touchStart(image, { touches: [{ clientX: 100, clientY: 200 }] });
  fireEvent.touchEnd(image, { changedTouches: [{ clientX: 110, clientY: 100 }] });
  expect(screen.getByAltText("November offer")).toBeDefined();
});
it("removes broken images and hides the whole area if none can load", () => {
  render(<PromotionCarousel banners={banners} />);
  fireEvent.error(screen.getByAltText("Bring a friend")); expect(screen.getByAltText("November offer")).toBeDefined();
  fireEvent.error(screen.getByAltText("November offer")); expect(screen.queryByRole("region")).toBeNull();
});
