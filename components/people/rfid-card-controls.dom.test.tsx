// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CardStatus } from "@/lib/rfid/admin-api";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rfid/admin-api", () => ({ rfidAdminApi: api, cardError: (code: string) => code }));
import { RfidCardControls } from "./rfid-card-controls";

const idle: CardStatus = { uid: null, unavailable: false, scanner: { online: true }, active: null, latest: null };
const pending = (expiresAt: number): CardStatus => ({ ...idle, active: {
  id: "a1", personId: "p1", personName: "Member One", operation: "assign", status: "pending",
  expiresAt, capturedUid: null, lastErrorCode: null,
} });
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
async function open() {
  render(<RfidCardControls personId="p1" personName="Member One" />);
  await advance(0);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  api.mockReset(); api.mockResolvedValue(idle);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("refreshes idle card controls once per minute instead of every five seconds", async () => {
  await open();
  expect(api).toHaveBeenCalledTimes(1);
  await advance(59_999);
  expect(api).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(api).toHaveBeenCalledTimes(2);
});

it("polls faster only while an assignment is active, then returns to minute polling", async () => {
  api.mockResolvedValueOnce(pending(Date.now() + 120_000)).mockResolvedValue(idle);
  await open();
  await advance(4_999);
  expect(api).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(api).toHaveBeenCalledTimes(2);
  await advance(59_999);
  expect(api).toHaveBeenCalledTimes(2);
  await advance(1);
  expect(api).toHaveBeenCalledTimes(3);
});

it("stops fast polling after expiry even if status refreshes fail", async () => {
  api.mockResolvedValueOnce(pending(Date.now() + 6_000)).mockRejectedValue(new Error("Offline"));
  await open();
  await advance(5_000);
  await advance(5_000);
  expect(api).toHaveBeenCalledTimes(3);
  await advance(59_999);
  expect(api).toHaveBeenCalledTimes(3);
  await advance(1);
  expect(api).toHaveBeenCalledTimes(4);
});

it("makes no periodic requests while hidden and cancels timers on unmount", async () => {
  await open();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await advance(120_000);
  expect(api).toHaveBeenCalledTimes(1);
  cleanup();
  await advance(120_000);
  expect(api).toHaveBeenCalledTimes(1);
});
