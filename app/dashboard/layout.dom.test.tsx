// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import DashboardLayout from "./layout";

let pathname = "/dashboard";
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/lib/auth/require-auth", () => ({ RequireAuth: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/dashboard/dashboard-nav", () => ({ DashboardNav: () => <nav>Navigation</nav> }));
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); pathname = "/dashboard";
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

it("starts the content transition before the new page can paint at full opacity", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  const startsBeforePaint: boolean[] = [];
  function Page({ name }: { name: string }) {
    useEffect(() => { startsBeforePaint.push(animate.mock.calls.length > 0); }, [name]);
    return <main>{name}</main>;
  }
  const view = render(<DashboardLayout><Page name="Overview" /></DashboardLayout>);
  animate.mockClear();
  pathname = "/dashboard/people";
  view.rerender(<DashboardLayout><Page name="People" /></DashboardLayout>);
  expect(startsBeforePaint).toEqual([true, true]);
});

it("keeps data updates steady and cancels the previous transition on rapid navigation", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  const view = render(<DashboardLayout><main>Initial data</main></DashboardLayout>);
  view.rerender(<DashboardLayout><main>Updated data</main></DashboardLayout>);
  expect(animate).toHaveBeenCalledTimes(1);
  pathname = "/dashboard/people";
  view.rerender(<DashboardLayout><main>People</main></DashboardLayout>);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(animate).toHaveBeenCalledTimes(2);
  expect(screenContent()).toBe("People");
  function screenContent() { return view.container.querySelector("main")?.textContent; }
});

it("respects reduced motion", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const animate = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  render(<DashboardLayout><main>Overview</main></DashboardLayout>);
  expect(animate).not.toHaveBeenCalled();
});
