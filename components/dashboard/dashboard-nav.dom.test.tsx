// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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
it("opens the mobile dialog and closes it after selecting a destination or changing routes", () => {
  const view = render(<DashboardNav />);
  const trigger = screen.getByRole("button", { name: "Open navigation" });
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  let dialog = screen.getByRole("dialog", { name: "Navigation" });
  fireEvent.click(within(dialog).getByRole("link", { name: "Overview" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger);
  dialog = screen.getByRole("dialog", { name: "Navigation" });
  pathname = "/dashboard/statistics";
  view.rerender(<DashboardNav />);
  expect(dialog.hasAttribute("open")).toBe(false);
});
