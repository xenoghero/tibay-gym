// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DashboardLayout from "./layout";

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
  expect(screen.getByRole("status").textContent).toBe("Checking sign-in…");
  expect(protectedContent).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();

  auth.user = { uid: "admin" }; auth.loading = false;
  view.rerender(<DashboardLayout><Content /></DashboardLayout>);
  expect(screen.getByRole("main").textContent).toBe("Overview content");
  expect(screen.queryByRole("status")).toBeNull();
});

it("still hides protected content and redirects when signed out", () => {
  auth.loading = false;
  render(<DashboardLayout><main>Protected content</main></DashboardLayout>);
  expect(screen.queryByRole("main")).toBeNull();
  expect(replace).toHaveBeenCalledWith("/login");
});
