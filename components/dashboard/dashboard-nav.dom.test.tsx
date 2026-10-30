// @vitest-environment jsdom
// React checks animation-event support when it loads; jsdom has no animations.
vi.hoisted(() => {
  if (!window.AnimationEvent) Object.defineProperty(window, "AnimationEvent", { value: window.Event, configurable: true });
});
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DashboardNav } from "./dashboard-nav";
let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: { email: "owner@example.com" }, signOut: vi.fn() }) }));
vi.mock("@/components/brand-logo", () => ({ BrandLogo: () => <span>Tibay Gym</span> }));
beforeEach(() => {
  pathname = "/dashboard";
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("keeps destinations accessible when collapsed and restores the saved preference", () => {
  const view = render(<DashboardNav />);
  fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(localStorage.getItem("tibay-sidebar-collapsed")).toBe("true");
  expect(screen.getByRole("button", { name: "Expand sidebar" }).getAttribute("aria-expanded")).toBe("false");
  const nav = screen.getByRole("navigation", { name: "Sidebar navigation" });
  expect(within(nav).getAllByRole("link")).toHaveLength(8);
  expect(within(nav).getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
  view.unmount();
  render(<DashboardNav />);
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(localStorage.getItem("tibay-sidebar-collapsed")).toBe("false");
});
it("marks the parent destination active on nested pages", () => {
  pathname = "/dashboard/people/member-123";
  render(<DashboardNav />);
  const nav = screen.getByRole("navigation", { name: "Sidebar navigation" });
  expect(within(nav).getByRole("link", { name: "People" }).getAttribute("aria-current")).toBe("page");
  expect(within(nav).getByRole("link", { name: "Overview" }).hasAttribute("aria-current")).toBe(false);
});
it("keeps the mobile dialog open for its exit animation after selecting a destination or changing routes", async () => {
  const view = render(<DashboardNav />);
  const trigger = screen.getByRole("button", { name: "Open navigation" });
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  let dialog = screen.getByRole("dialog", { name: "Navigation" });
  fireEvent.click(within(dialog).getByRole("link", { name: "Overview" }));
  expect(dialog.hasAttribute("open")).toBe(true);
  fireEvent.animationEnd(dialog);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger);
  dialog = screen.getByRole("dialog", { name: "Navigation" });
  pathname = "/dashboard/statistics";
  await act(async () => { view.rerender(<DashboardNav />); });
  expect(dialog.hasAttribute("open")).toBe(true);
  fireEvent.animationEnd(dialog);
  expect(dialog.hasAttribute("open")).toBe(false);
});

it.each(["close button", "Escape", "backdrop"])("animates dismissal through %s and restores the menu state", method => {
  render(<DashboardNav />);
  const trigger = screen.getByRole("button", { name: "Open navigation" });
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Navigation" });
  if (method === "close button") fireEvent.click(within(dialog).getByRole("button", { name: "Close navigation" }));
  else if (method === "Escape") fireEvent(dialog, new Event("cancel", { cancelable: true }));
  else fireEvent.click(dialog, { clientX: -1, clientY: -1 });
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(dialog.getAttribute("data-closing")).toBe("true");
  fireEvent.animationEnd(dialog);
  expect(dialog.hasAttribute("open")).toBe(false);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(dialog.getAttribute("data-closing")).toBe("false");
});

it("finishes closing if the animation end event is missed", () => {
  vi.useFakeTimers();
  render(<DashboardNav />);
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  const dialog = screen.getByRole("dialog", { name: "Navigation" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close navigation" }));
  act(() => { vi.advanceTimersByTime(250); });
  expect(dialog.hasAttribute("open")).toBe(false);
});

it("closes immediately when reduced motion is requested", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  render(<DashboardNav />);
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  const dialog = screen.getByRole("dialog", { name: "Navigation" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close navigation" }));
  expect(dialog.hasAttribute("open")).toBe(false);
});
