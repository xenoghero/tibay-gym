// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DashboardLayout from "./layout";

// Let React register standard animation events in jsdom, which has no CSS engine.
vi.hoisted(() => {
  if (!("AnimationEvent" in window)) Object.defineProperty(window, "AnimationEvent", { value: Event });
});

const { auth, replace } = vi.hoisted(() => ({
  auth: { user: null as { uid: string } | null, loading: true },
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ replace }) }));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => auth }));
vi.mock("@/components/dashboard/dashboard-nav", () => ({ DashboardNav: () => <nav>Navigation</nav> }));

afterEach(() => { cleanup(); auth.user = null; auth.loading = true; vi.clearAllMocks(); });

it("keeps navigation visible without a workspace skeleton while refresh restores sign-in", () => {
  const protectedContent = vi.fn(() => <main>Overview content</main>);
  const Content = protectedContent;
  const view = render(<DashboardLayout><Content /></DashboardLayout>);
  expect(screen.queryByRole("navigation")).not.toBeNull();
  expect(screen.queryByRole("status", { name: "Loading your workspace…" })).toBeNull();
  const splash = screen.getByRole("status", { name: "Loading your dashboard" });
  expect(splash.textContent).toBe("Tibay Gym");
  expect(protectedContent).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();

  auth.user = { uid: "admin" }; auth.loading = false;
  view.rerender(<DashboardLayout><Content /></DashboardLayout>);
  expect(protectedContent).not.toHaveBeenCalled();
  fireEvent.animationIteration(splash.firstElementChild!);
  expect(screen.getByRole("main").textContent).toBe("Overview content");
  expect(screen.queryByRole("status")).toBeNull();
});

it("keeps looping until sign-in resolves, then finishes the current cycle", () => {
  const view = render(<DashboardLayout><main>Overview content</main></DashboardLayout>);
  const logo = screen.getByRole("status").firstElementChild!;
  fireEvent.animationIteration(logo);
  expect(screen.queryByRole("main")).toBeNull();
  auth.user = { uid: "admin" }; auth.loading = false;
  view.rerender(<DashboardLayout><main>Overview content</main></DashboardLayout>);
  expect(screen.queryByRole("main")).toBeNull();
  fireEvent.animationIteration(logo);
  expect(screen.getByRole("main").textContent).toBe("Overview content");
});

it("finishes the current cycle before redirecting when restoration finds no user", () => {
  const view = render(<DashboardLayout><main>Protected content</main></DashboardLayout>);
  auth.loading = false;
  view.rerender(<DashboardLayout><main>Protected content</main></DashboardLayout>);
  expect(replace).not.toHaveBeenCalled();
  fireEvent.animationIteration(screen.getByRole("status").firstElementChild!);
  expect(replace).toHaveBeenCalledWith("/login");
  expect(screen.queryByRole("main")).toBeNull();
});

it("still hides protected content and redirects when signed out", () => {
  auth.loading = false;
  render(<DashboardLayout><main>Protected content</main></DashboardLayout>);
  expect(screen.queryByRole("main")).toBeNull();
  expect(replace).toHaveBeenCalledWith("/login");
});
