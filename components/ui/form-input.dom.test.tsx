// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createRef } from "react";
import { FormInput } from "./form-input";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(["time"])("opens the native %s picker from the field body and Alt+Down", type => {
  const showPicker = vi.fn();
  render(<label>Coverage<FormInput type={type} /></label>);
  const input = screen.getByLabelText("Coverage");
  Object.defineProperty(input, "showPicker", { configurable: true, value: showPicker });
  fireEvent.click(input);
  expect(showPicker).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
  expect(showPicker).toHaveBeenCalledTimes(2);
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowRight" });
  expect(showPicker).toHaveBeenCalledTimes(2);
});

it.each([undefined, () => { throw new DOMException("Unavailable", "NotAllowedError"); }])("keeps native editing and change events when showPicker is unavailable", showPicker => {
  const onChange = vi.fn();
  render(<label>Expiry<FormInput type="date" defaultValue="2026-10-29" onChange={onChange} /></label>);
  const input = screen.getByLabelText("Expiry") as HTMLInputElement;
  Object.defineProperty(input, "showPicker", { configurable: true, value: showPicker });
  fireEvent.click(input);
  fireEvent.change(input, { target: { value: "2026-11-29" } });
  expect(input.value).toBe("2026-11-29");
  expect(onChange).toHaveBeenCalledOnce();
});

it("respects readonly, disabled fieldsets and cancelled caller events", () => {
  const showPicker = vi.fn();
  render(<>
    <FormInput aria-label="Read only" type="date" readOnly />
    <fieldset disabled><FormInput aria-label="Disabled" type="date" /></fieldset>
    <FormInput aria-label="Cancelled" type="date" onClick={event => event.preventDefault()} />
  </>);
  for (const label of ["Read only", "Disabled", "Cancelled"]) {
    const input = screen.getByLabelText(label);
    Object.defineProperty(input, "showPicker", { configurable: true, value: showPicker });
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
  }
  expect(showPicker).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("preserves native date bounds, required validation, labels, form values and refs", () => {
  const ref = createRef<HTMLInputElement>();
  render(<form aria-label="Membership"><label htmlFor="expiry">Membership expiry</label>
    <FormInput ref={ref} id="expiry" name="expiry" type="date" required min="2026-10-01" max="2026-12-31" defaultValue="2026-11-29" />
  </form>);
  const input = screen.getByLabelText("Membership expiry") as HTMLInputElement;
  expect(ref.current).toBe(input);
  expect(new FormData(screen.getByRole("form") as HTMLFormElement).get("expiry")).toBe("2026-11-29");
  fireEvent.change(input, { target: { value: "2027-01-01" } });
  expect(input.validity.rangeOverflow).toBe(true);
  fireEvent.change(input, { target: { value: "" } });
  expect(input.validity.valueMissing).toBe(true);
});

it("offers numeric keyboards without changing decimals or treating phone numbers as quantities", () => {
  render(<>
    <FormInput aria-label="Attempts" type="number" min={1} max={3} />
    <FormInput aria-label="Weight" type="number" inputMode="decimal" min="0.1" step="0.1" defaultValue="72.5" />
    <FormInput aria-label="Amount" inputMode="decimal" defaultValue="1200.50" />
    <FormInput aria-label="Phone" type="tel" inputMode="numeric" defaultValue="09171234567" />
  </>);
  expect(screen.getByLabelText("Attempts").getAttribute("inputmode")).toBe("numeric");
  for (const label of ["Weight", "Amount"]) expect(screen.getByLabelText(label).getAttribute("inputmode")).toBe("decimal");
  expect((screen.getByLabelText("Phone") as HTMLInputElement).value).toBe("09171234567");
});
