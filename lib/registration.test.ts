import { expect, it } from "vitest";
import { registrationFields, LEAD_SOURCES } from "./registration";
it.each(LEAD_SOURCES)("accepts required registration source %s", source => {
  expect(registrationFields({ rateCategory: "student", leadSource: source, leadSourceOther: "An event" }).leadSource).toBe(source);
});
it.each([{}, { rateCategory: "member", leadSource: "ads" }, { rateCategory: "regular", leadSource: "unknown" }, { rateCategory: "student", leadSource: "others", leadSourceOther: " " }])("rejects incomplete registration %j", input => {
  expect(() => registrationFields(input)).toThrow();
});
it("drops unused other-source details", () => {
  expect(registrationFields({ rateCategory: "regular", leadSource: "google", leadSourceOther: "private" }).leadSourceOther).toBeNull();
});
