// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SMS_SETTINGS } from "@/lib/sms/contracts";
const user = { getIdToken: async () => "synthetic-admin-token" };
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user }) }));
import { SmsView } from "./sms-view";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const data = { settings: DEFAULT_SMS_SETTINGS, configured: false, messages: [], next: null };
it("keeps activation unavailable without server configuration and never sends on load", async () => {
  const fetcher = vi.fn().mockImplementation(async (url: string) => Response.json(url.includes("contacts") ? { contacts: [], next: null } : data));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<SmsView />); });
  fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
  expect((screen.getByLabelText("Enable sending") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  expect(screen.getByText("No messages queued.")).toBeTruthy();
  expect(fetcher.mock.calls.every(([, options]) => options.method !== "POST")).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Run sending worker" })); });
  const request = fetcher.mock.calls.find(([, options]) => options.method === "POST")![1];
  expect(JSON.parse(request.body).action).toBe("worker");
  expect(request.headers.Authorization).toBe("Bearer synthetic-admin-token");
});
it("offers an actionable retry after load errors", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 })); vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<SmsView />); });
  expect(screen.getByRole("status").textContent).toContain("Refresh to retry");
  fetcher.mockImplementation(async (url: string) => Response.json(url.includes("contacts") ? { contacts: [], next: null } : data));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh" })); });
  fireEvent.click(screen.getByRole("tab", { name: "Contacts" }));
  expect(screen.getByText("No official customer profiles.")).toBeTruthy();
  expect(screen.queryByText(/Refresh to retry/)).toBeNull();
});

it("supports keyboard tabs and preserves unsaved settings across navigation and refresh", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => Response.json(url.includes("contacts") ? { contacts: [], next: null } : data)));
  await act(async () => { render(<SmsView />); });
  fireEvent.keyDown(screen.getByRole("tab", { name: "Activity" }), { key: "End" });
  expect(screen.getByRole("tab", { name: "Settings" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.change(screen.getByLabelText("Expiry template"), { target: { value: "Unsaved reminder" } });
  fireEvent.click(screen.getByRole("tab", { name: "Contacts" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh" })); });
  fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
  expect((screen.getByLabelText("Expiry template") as HTMLTextAreaElement).value).toBe("Unsaved reminder");
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect((screen.getByLabelText("Expiry template") as HTMLTextAreaElement).value).toBe(DEFAULT_SMS_SETTINGS.expiryTemplate);
});

it("filters contacts and excludes changed numbers from eligible recipients", async () => {
  const contacts = [
    { id: "p1", name: "Reinier Luna", phone: "09171234567", contact: { permission: true, optedOut: false, phone: "+639171234567", revision: 1 } },
    { id: "p2", name: "Mara Santos", phone: "09179876543", contact: { permission: true, optedOut: false, phone: "+639179999999", revision: 1 } },
  ];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => Response.json(url.includes("contacts") ? { contacts, next: null } : data)));
  await act(async () => { render(<SmsView />); });
  fireEvent.click(screen.getByRole("tab", { name: "Contacts" }));
  fireEvent.change(screen.getByLabelText("Permission status"), { target: { value: "eligible" } });
  expect(screen.getByRole("button", { name: "Opt out Reinier Luna" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Opt out Mara Santos" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Permission status"), { target: { value: "all" } });
  fireEvent.change(screen.getByLabelText("Search loaded contacts"), { target: { value: "Mara" } });
  expect(screen.getByText("Number changed")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Opt out Reinier Luna" })).toBeNull();
});

it("preserves a campaign draft when switching tabs", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => Response.json(url.includes("contacts") ? { contacts: [], next: null } : data)));
  await act(async () => { render(<SmsView />); });
  fireEvent.click(screen.getByRole("tab", { name: "Campaigns" }));
  fireEvent.change(screen.getByLabelText("Campaign message"), { target: { value: "Saturday opening hours" } });
  fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  fireEvent.click(screen.getByRole("tab", { name: "Campaigns" }));
  expect((screen.getByLabelText("Campaign message") as HTMLTextAreaElement).value).toBe("Saturday opening hours");
});
