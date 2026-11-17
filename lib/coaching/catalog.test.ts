import { expect, it } from "vitest";
import { DEFAULT_COACHING, validateCatalog } from "./catalog";

const saved = DEFAULT_COACHING.packages;
it("starts with the four agreed packages", () => {
  expect(saved.map(p => [p.priceMinor / 100, p.sessions, p.validityDays])).toEqual([[750, 4, 7], [1500, 8, 15], [3000, 12, 40], [3700, 16, 45]]);
});
it("allows editing, hiding and adding packages but never deleting one", () => {
  const edited = [...saved.map(p => p.id === "pkg-4" ? { ...p, priceMinor: 80_000, visible: false } : p), { id: "pkg-20", priceMinor: 450_000, sessions: 20, validityDays: 60, visible: true }];
  expect(validateCatalog(edited, saved)).toEqual(edited);
  expect(() => validateCatalog(saved.slice(1), saved)).toThrow("coaching-package-delete-forbidden");
});
it.each([
  [{ priceMinor: 0 }], [{ sessions: 1.5 }], [{ validityDays: 400 }], [{ visible: "yes" }], [{ id: "Bad ID" }],
])("rejects invalid package values %j", change => {
  expect(() => validateCatalog([{ ...saved[0], ...change }, ...saved.slice(1)], saved)).toThrow("invalid-coaching-packages");
});
it("rejects duplicate package ids", () => {
  expect(() => validateCatalog([...saved, saved[0]], saved)).toThrow("invalid-coaching-packages");
});
