import { expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/attendance-api", () => ({ attendanceApi: mocks.api }));
import { CheckInFlow } from "./checkin-flow";

it("renders a single attendance form and accessible status without API work", () => {
  const html = renderToString(<CheckInFlow />);
  expect(html).not.toContain("Check out only");
  expect(html).not.toContain('type="radio"');
  expect(html).toContain("Enter your phone number to record your attendance.");
  expect(html).toContain('role="status"'); expect(html).toContain('role="alert"');
  expect(html).toContain('aria-busy="false"');
  expect(mocks.api).not.toHaveBeenCalled();
});
