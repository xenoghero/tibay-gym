// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SmsCampaigns, SmsCampaignHistory } from "./sms-campaigns";

afterEach(cleanup);
const contacts = [{ id: "p1", name: "Synthetic Customer", phone: "09171234567", contact: {
  phone: "+639171234567", permission: true, optedOut: false, revision: 1, updatedAt: 1 } }];
const preview = { id: "campaign1", count: 1, excluded: 0, text: "Reviewed message", personIds: ["p1"] };
function compose() {
  fireEvent.click(screen.getByLabelText(/Synthetic Customer/));
  fireEvent.click(screen.getByRole("button", { name: "Continue to message" }));
  fireEvent.change(screen.getByLabelText("Campaign message"), { target: { value: "Reviewed message" } });
}
it("requires preview and explicit review before dispatch and invalidates review after edits", async () => {
  const request = vi.fn().mockResolvedValue(preview);
  render(<SmsCampaigns contacts={contacts} request={request} />);
  compose();
  expect(screen.queryByRole("button", { name: /Queue \d+ messages?/ })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review announcement" })); });
  expect(request.mock.calls[0][1]).toMatchObject({ action: "campaign-preview", personIds: ["p1"], text: "Reviewed message" });
  const dispatch = screen.getByRole("button", { name: "Queue 1 message" }) as HTMLButtonElement;
  expect(dispatch.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I reviewed this message/)); expect(dispatch.disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
  fireEvent.change(screen.getByLabelText("Campaign message"), { target: { value: "Changed message" } });
  expect(screen.queryByRole("button", { name: /Queue \d+ messages?/ })).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect((screen.getByLabelText(/Synthetic Customer/) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Continue to message" }));
  expect((screen.getByLabelText("Campaign message") as HTMLTextAreaElement).value).toBe("Changed message");
});
it("excludes opted-out, invalid and changed numbers and explains why", () => {
  render(<SmsCampaigns contacts={[
    { ...contacts[0], contact: { ...contacts[0].contact, optedOut: true } },
    { ...contacts[0], id: "p2", name: "Changed Number", phone: "09179876543" },
    { ...contacts[0], id: "p3", name: "Invalid Number", phone: "" },
  ]} request={vi.fn()} />);
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.getByText(/No eligible recipients/)).toBeTruthy();
  expect(screen.getByText("Opted out")).toBeTruthy();
  expect(screen.getByText("Number changed")).toBeTruthy();
  expect(screen.getByText("Invalid mobile number")).toBeTruthy();
});
it("loads recipients inside the picker and keeps selection through search", async () => {
  const loadMore = vi.fn().mockResolvedValue(undefined);
  render(<SmsCampaigns contacts={contacts} request={vi.fn()} hasMore loadMore={loadMore} />);
  fireEvent.click(screen.getByLabelText(/Synthetic Customer/));
  fireEvent.change(screen.getByLabelText("Search recipients"), { target: { value: "no match" } });
  expect(screen.getByText(/1 selected/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Load more recipients" })); });
  expect(loadMore).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Search recipients"), { target: { value: "" } });
  expect((screen.getByLabelText(/Synthetic Customer/) as HTMLInputElement).checked).toBe(true);
});
it("queues once, explains processing, and links to the exact announcement", async () => {
  const request = vi.fn().mockResolvedValue(preview), onQueued = vi.fn().mockResolvedValue(undefined), onHistory = vi.fn();
  render(<SmsCampaigns contacts={contacts} request={request} onQueued={onQueued} onHistory={onHistory} />);
  compose();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review announcement" })); });
  fireEvent.click(screen.getByLabelText(/I reviewed this message/));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Queue \d+ messages?/ })); });
  expect(request.mock.calls[1][1]).toEqual({ action: "campaign-dispatch", campaignId: "campaign1" });
  expect(onQueued).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Queueing alone does not send/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View delivery progress" }));
  expect(onHistory).toHaveBeenCalledWith("campaign1");
  expect(request.mock.calls.some(([, body]) => body?.action === "worker")).toBe(false);
});
it("preserves the editor when preview fails and lets the admin retry", async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error("Connection unavailable")).mockResolvedValue(preview);
  render(<SmsCampaigns contacts={contacts} request={request} />);
  compose();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review announcement" })); });
  expect(screen.getByRole("alert").textContent).toContain("Connection unavailable");
  expect((screen.getByLabelText("Campaign message") as HTMLTextAreaElement).value).toBe("Reviewed message");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review announcement" })); });
  expect(screen.getByRole("heading", { name: /Step 3/ })).toBeTruthy();
});
it("loads history on entry and restores saved drafts for review", async () => {
  const detail = { ...preview, createdAt: 1793206800000, dispatchRequestedAt: null, totals: {}, recipients: [{ personId: "p1", status: "queued", errorCode: null, messageId: null }] };
  const request = vi.fn().mockImplementation(async (query: string) => query === "?view=campaigns" ? { campaigns: [detail], next: null } : detail);
  const onReview = vi.fn();
  await act(async () => { render(<SmsCampaignHistory contacts={contacts} request={request} active selectedId="campaign1" onReview={onReview} />); });
  const details = screen.getByRole("region", { name: "Announcement details" });
  expect(within(details).getByText("Reviewed message")).toBeTruthy();
  fireEvent.click(within(details).getByRole("button", { name: "Review saved draft" }));
  expect(onReview).toHaveBeenCalledWith(preview);
});

it("stops selection at 100 recipients and blocks continuing after consent changes", () => {
  const people = Array.from({ length: 101 }, (_, index) => ({ ...contacts[0], id: "p" + index, name: "Member " + index }));
  const { rerender } = render(<SmsCampaigns contacts={people} request={vi.fn()} />);
  const boxes = screen.getAllByRole("checkbox");
  boxes.slice(0, 100).forEach(box => fireEvent.click(box));
  expect((boxes[100] as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Continue to message" }) as HTMLButtonElement).disabled).toBe(false);
  rerender(<SmsCampaigns contacts={people.map((row, index) => index === 0 ? { ...row, contact: { ...row.contact, optedOut: true } } : row)} request={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Continue to message" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Remove Member 0" }));
  expect((screen.getByRole("button", { name: "Continue to message" }) as HTMLButtonElement).disabled).toBe(false);
});
