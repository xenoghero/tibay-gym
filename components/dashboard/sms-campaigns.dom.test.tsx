// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SmsCampaigns } from "./sms-campaigns";
afterEach(cleanup);
const contacts = [{ id: "p1", name: "Synthetic Customer", phone: "09171234567", contact: {
  phone: "+639171234567", permission: true, optedOut: false, revision: 1, updatedAt: 1 } }];
it("requires preview and explicit review before dispatch and invalidates preview after edits", async () => {
  const request = vi.fn().mockResolvedValue({ id: "campaign1", count: 1, excluded: 0, text: "Reviewed message", personIds: ["p1"] });
  render(<SmsCampaigns contacts={contacts} request={request} />);
  fireEvent.change(screen.getByLabelText("Campaign message"), { target: { value: "Reviewed message" } });
  fireEvent.click(screen.getByLabelText(/Synthetic Customer/));
  expect(screen.queryByRole("button", { name: /Queue campaign/ })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preview campaign" })); });
  expect(request.mock.calls[0][1]).toMatchObject({ action: "campaign-preview", personIds: ["p1"], text: "Reviewed message" });
  const dispatch = screen.getByRole("button", { name: "Queue campaign for 1 recipients" }) as HTMLButtonElement;
  expect(dispatch.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I reviewed this message/)); expect(dispatch.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("Campaign message"), { target: { value: "Changed message" } });
  expect(screen.queryByRole("button", { name: /Queue campaign/ })).toBeNull(); expect(request).toHaveBeenCalledTimes(1);
});
it("does not offer opted-out customers for selection", () => {
  render(<SmsCampaigns contacts={[{ ...contacts[0], contact: { ...contacts[0].contact, optedOut: true } }]} request={vi.fn()} />);
  expect(screen.queryByLabelText(/Synthetic Customer/)).toBeNull(); expect(screen.getByText(/No eligible recipients/)).toBeTruthy();
});
