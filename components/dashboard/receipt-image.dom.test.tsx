// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: stableUser }) }));
const stableUser = { getIdToken: async () => "synthetic-token" };
const OriginalURL = URL;
import { ReceiptImage } from "./receipt-image";
beforeEach(() => {
  vi.stubGlobal("URL", class extends OriginalURL {
    static createObjectURL = vi.fn(() => "blob:http://localhost/synthetic-receipt");
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps the loader through download and decoding, then immediately reveals the loaded image", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  await act(async () => { render(<ReceiptImage receiptId="r1" />); });
  expect(screen.getByText("Loading receipt image…")).toBeTruthy();
  expect(screen.getByRole("group", { name: "Receipt image" }).getAttribute("aria-busy")).toBe("true");
  await act(async () => { finish(new Response("synthetic image", { headers: { "Content-Type": "image/webp" } })); });
  const image = screen.getByAltText("Private GCash receipt");
  expect(image.getAttribute("data-ready")).toBe("false");
  expect(screen.getByText("Loading receipt image…")).toBeTruthy();
  await act(async () => { fireEvent.load(image); });
  expect(screen.queryByText("Loading receipt image…")).toBeNull();
  expect(image.getAttribute("data-ready")).toBe("true");
  expect(image.getAttribute("aria-hidden")).toBe("false");
  expect(screen.getByRole("group", { name: "Receipt image" }).getAttribute("aria-busy")).toBe("false");
});

it("replaces a failed download with a retry and releases the image URL on close", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response("synthetic image", { headers: { "Content-Type": "image/webp" } }));
  vi.stubGlobal("fetch", fetcher);
  let unmount!: () => void;
  await act(async () => { ({ unmount } = render(<ReceiptImage receiptId="r1" />)); });
  expect(screen.queryByText("Loading receipt image…")).toBeNull();
  expect(screen.getByText("Receipt image unavailable")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry image" })); });
  expect(screen.getByText("Loading receipt image…")).toBeTruthy();
  await act(async () => { fireEvent.load(screen.getByAltText("Private GCash receipt")); });
  expect(screen.queryByText("Receipt image unavailable")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/synthetic-receipt");
});

it("stops loading and offers retry when the browser cannot decode the receipt", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid image")));
  await act(async () => { render(<ReceiptImage receiptId="r1" />); });
  fireEvent.error(screen.getByAltText("Private GCash receipt"));
  expect(screen.getByRole("button", { name: "Retry image" })).toBeTruthy();
  expect(screen.queryByText("Loading receipt image…")).toBeNull();
});
