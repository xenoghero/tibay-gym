// @vitest-environment jsdom
vi.hoisted(() => {
  if (!window.AnimationEvent) Object.defineProperty(window, "AnimationEvent", { value: window.Event, configurable: true });
});
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuditView } from "./audit-view";

vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user }) }));
const user = { getIdToken: async () => "synthetic-token" };
const event = {
  id: "event-one", actorId: "admin-123456789012345678901234567890", action: "payment-approved",
  entityType: "paymentRequest", entityId: "payment-123456789012345678901234567890", personId: "customer-one",
  occurredAt: Date.parse("2026-10-28T04:32:53Z"), operationId: "operation-one",
  relevantBefore: { status: "pending", amountMinor: 5000 },
  relevantAfter: { status: "approved", amountMinor: 5000 }, reason: "Payment received and reviewed",
};
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ events: [event], nextCursor: null })));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) {
    this.setAttribute("open", ""); this.querySelector<HTMLButtonElement>("button")?.focus();
  } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("opens a field comparison with full IDs, copies IDs and restores focus after Escape", async () => {
  await act(async () => { render(<AuditView />); });
  expect(screen.getByText("12:32:53 PM")).toBeTruthy();
  expect(screen.queryByText(event.entityId)).toBeNull();
  const trigger = screen.getByRole("button", { name: /View details: Payment approved/ });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Payment approved" });
  expect(within(dialog).getByText(event.entityId)).toBeTruthy();
  expect(within(dialog).getByText("pending")).toBeTruthy();
  expect(within(dialog).getByText("approved")).toBeTruthy();
  expect(within(dialog).queryByRole("rowheader", { name: "Amount minor" })).toBeNull();
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Copy record id" })); });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(event.entityId);
  expect(within(dialog).getByText("Copied")).toBeTruthy();
  fireEvent(dialog, new window.Event("cancel", { cancelable: true }));
  expect(dialog.getAttribute("data-closing")).toBe("true");
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(document.activeElement).not.toBe(trigger);
  fireEvent.animationEnd(dialog);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("uses applied filters for pagination and refresh, appends events, and clears the query", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ events: [event], nextCursor: "next-one" }));
  await act(async () => { render(<AuditView />); });
  fireEvent.change(screen.getByLabelText("Action"), { target: { value: "payment-approved" } });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ events: [event], nextCursor: "next-one" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply filters" })); });
  fireEvent.change(screen.getByLabelText("Action"), { target: { value: "rates-update" } });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ events: [{ ...event, id: "event-two", action: "registration-created" }], nextCursor: null }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Load more events" })); });
  const query = new URL(String(vi.mocked(fetch).mock.calls.at(-1)![0]), "http://localhost").searchParams;
  expect(query.get("action")).toBe("payment-approved");
  expect(query.get("cursor")).toBe("next-one");
  expect(screen.getAllByRole("button", { name: /View details:/ })).toHaveLength(2);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh" })); });
  expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain("action=payment-approved");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clear filters" })); });
  expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toBe("/api/admin/audit?");
  expect((screen.getByLabelText("Action") as HTMLInputElement).value).toBe("");
});

it("keeps the drawer and scroll lock until the close animation finishes", async () => {
  await act(async () => { render(<AuditView />); });
  fireEvent.click(screen.getByRole("button", { name: /View details:/ }));
  const dialog = screen.getByRole("dialog");
  expect(dialog.getAttribute("data-closing")).toBe("false");
  fireEvent.animationEnd(dialog);
  expect(dialog.hasAttribute("open")).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close event details" }));
  expect(dialog.getAttribute("data-closing")).toBe("true");
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.animationEnd(within(dialog).getByRole("heading", { name: "Payment approved" }));
  expect(dialog.hasAttribute("open")).toBe(true);
  fireEvent.animationEnd(dialog);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.body.style.overflow).not.toBe("hidden");
});

it("finishes closing if the browser does not deliver an animation event", async () => {
  await act(async () => { render(<AuditView />); });
  fireEvent.click(screen.getByRole("button", { name: /View details:/ }));
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Close event details" }));
    expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
    act(() => { vi.advanceTimersByTime(320); });
    expect(screen.queryByRole("dialog")).toBeNull();
  } finally { vi.useRealTimers(); }
});

it("retains results on a failed filter request and retries that exact request", async () => {
  await act(async () => { render(<AuditView />); });
  fireEvent.change(screen.getByLabelText("Customer ID"), { target: { value: "customer-two" } });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 500 }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply filters" })); });
  expect(screen.getByRole("alert").textContent).toContain("Previously loaded activity remains below");
  expect(screen.getByRole("button", { name: /View details:/ })).toBeTruthy();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ events: [], nextCursor: null }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
  expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain("personId=customer-two");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("No events found")).toBeTruthy();
});

it("distinguishes initial loading from an empty result and toggles mobile filters", async () => {
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  await act(async () => { render(<AuditView />); });
  expect(screen.getByText("Loading audit history…")).toBeTruthy();
  expect(screen.queryByText("No events found")).toBeNull();
  const toggle = screen.getByRole("button", { name: "Filters" });
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  await act(async () => { resolve(Response.json({ events: [], nextCursor: null })); });
  expect(screen.getByText("No events found")).toBeTruthy();
});

it("formats stored centavos as pesos while preserving the raw data", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ events: [{
    ...event, relevantBefore: null, relevantAfter: { amountMinor: 6000 },
  }], nextCursor: null }));
  await act(async () => { render(<AuditView />); });
  fireEvent.click(screen.getByRole("button", { name: /View details:/ }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("rowheader", { name: "Amount" })).toBeTruthy();
  expect(within(dialog).getByText("₱60.00")).toBeTruthy();
  expect(within(dialog).getByText("Not recorded")).toBeTruthy();
  expect(within(dialog).getByText(/"amountMinor": 6000/)).toBeTruthy();
});

it("prevents an inverted date range from requesting data", async () => {
  await act(async () => { render(<AuditView />); });
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-29" } });
  fireEvent.change(screen.getByLabelText("Through"), { target: { value: "2026-10-28" } });
  fireEvent.submit(screen.getByRole("button", { name: "Apply filters" }).closest("form")!);
  expect(screen.getByRole("alert").textContent).toContain("Choose a Through date on or after the From date");
  expect(fetch).toHaveBeenCalledTimes(1);
});
