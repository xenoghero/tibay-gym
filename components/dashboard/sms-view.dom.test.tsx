// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect((screen.getByLabelText("Enable sending") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
  expect(screen.getByText("What would you like to do?")).toBeTruthy();
  expect(fetcher.mock.calls.every(([, options]) => options.method !== "POST")).toBe(true);
  expect((screen.getByRole("button", { name: "Process queued messages" }) as HTMLButtonElement).disabled).toBe(true);
});
it("processes the queue only after an explicit action and links to history", async () => {
  const fetcher = vi.fn().mockImplementation(async (url: string, options: RequestInit) => Response.json(options.method === "POST" ? { disabled: false, processed: 1 } : url.includes("contacts") ? { contacts: [], next: null } : url.includes("campaigns") ? { campaigns: [], next: null } : { ...data, configured: true, settings: { ...data.settings, enabled: true } }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<SmsView />); });
  expect(fetcher.mock.calls.every(([, options]) => options.method !== "POST")).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Process queued messages" })); });
  const request = fetcher.mock.calls.find(([, options]) => options.method === "POST")![1];
  expect(JSON.parse(request.body).action).toBe("worker");
  expect(request.headers.Authorization).toBe("Bearer synthetic-admin-token");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "View delivery results" })); });
  expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
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
  fireEvent.keyDown(screen.getByRole("tab", { name: "Messages" }), { key: "End" });
  expect(screen.getByRole("tab", { name: "Contacts" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(screen.getByRole("tab", { name: "Contacts" }), { key: "Home" });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Messages" }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.change(screen.getByLabelText("Expiry template"), { target: { value: "Unsaved reminder" } });
  fireEvent.click(screen.getByRole("tab", { name: "Contacts" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh" })); });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
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
  expect(within(screen.getByRole("tabpanel", { name: "Contacts" })).getByText("Number changed")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Opt out Reinier Luna" })).toBeNull();
});

it("preserves a campaign draft when switching tabs", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => Response.json(url.includes("contacts") ? { contacts: [{ id: "p1", name: "Mara Santos", phone: "09171234567", contact: { permission: true, optedOut: false, phone: "+639171234567", revision: 1 } }], next: null } : data)));
  await act(async () => { render(<SmsView />); });
  fireEvent.click(screen.getByRole("button", { name: "Send an announcement" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Mara Santos/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to message" }));
  fireEvent.change(screen.getByLabelText("Campaign message"), { target: { value: "Saturday opening hours" } });
  fireEvent.click(screen.getByRole("tab", { name: "Contacts" }));
  fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
  fireEvent.click(screen.getByRole("button", { name: "Back to messages" }));
  fireEvent.click(screen.getByRole("button", { name: "Send an announcement" }));
  expect((screen.getByLabelText("Campaign message") as HTMLTextAreaElement).value).toBe("Saturday opening hours");
});

it("checks reminders without queueing and requires a separate queue and process action", async () => {
  const fetcher = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
    if (options.method === "POST") return Response.json({ disabled: false, examined: 50, queued: 2 });
    if (url.includes("view=contacts")) return Response.json({ contacts: [], next: null });
    if (url.includes("view=reminders")) return Response.json({ examined: 50, due: 2, next: null });
    return Response.json({ ...data, configured: true, settings: { ...data.settings, enabled: true } });
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<SmsView />); });
  fireEvent.click(screen.getByRole("button", { name: "Review due reminders" }));
  expect(screen.queryByRole("button", { name: "Queue next reminder batch" })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check due reminders" })); });
  expect(screen.getByText("2 eligible reminders found")).toBeTruthy();
  expect(fetcher.mock.calls.every(([, options]) => options.method !== "POST")).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Queue next reminder batch" })); });
  expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST").map(([, options]) => JSON.parse(options.body).action)).toEqual(["reminders"]);
  expect(screen.getByRole("button", { name: "Process queued messages" })).toBeTruthy();
});
it("refreshes all loaded contact pages without losing selection or the next cursor", async () => {
  const person = (id: string, name: string) => ({ id, name, phone: "09171234567", contact: { permission: true, optedOut: false, phone: "+639171234567", revision: 1 } });
  const fetcher = vi.fn().mockImplementation(async (url: string) => Response.json(url.includes("view=contacts") ? url.includes("after=") ? { contacts: [person("p2", "Nina Flores")], next: null } : { contacts: [person("p1", "Mara Santos")], next: "p1" } : data));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<SmsView />); });
  fireEvent.click(screen.getByRole("button", { name: "Send an announcement" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Load more recipients" })); });
  fireEvent.click(screen.getByRole("checkbox", { name: /Nina Flores/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh" })); });
  expect((screen.getByRole("checkbox", { name: /Nina Flores/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole("button", { name: "Load more recipients" })).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => url.includes("after=p1"))).toHaveLength(2);
});
