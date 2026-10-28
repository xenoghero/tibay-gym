import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mutation: vi.fn(), attendance: vi.fn() }));
vi.mock("@/lib/admin-api", () => ({ adminMutation: mocks.mutation }));
vi.mock("@/lib/attendance-api", () => ({ attendanceApi: mocks.attendance }));
vi.mock("@/lib/firebase", () => ({ db: {} }));
import { createPerson, updatePersonWithProfileDetails, convertGuestToMember, deletePerson } from "./person";
beforeEach(() => { vi.clearAllMocks(); mocks.mutation.mockResolvedValue({ id: "p1" }); });
it("sends profile creation to the protected server", async () => {
  const input = { phone: "09123456789", name: "New", type: "guest" as const, status: null, membershipExpiry: null, joinDate: null };
  expect(await createPerson(input)).toBe("p1");
  expect(mocks.mutation).toHaveBeenCalledWith("profile-create", { input });
});
it("sends profile details and conversion through audited operations", async () => {
  const input = { phone: "09123456789", name: "New", type: "guest" as const, status: null, membershipExpiry: null, joinDate: null };
  await updatePersonWithProfileDetails("p1", input, { birthDate: null, address: "Address" });
  expect(mocks.mutation).toHaveBeenCalledWith("profile-update", { personId: "p1", input, details: { birthDate: null, address: "Address" } });
  await convertGuestToMember("p1", { status: "active", membershipExpiry: null, joinDate: null });
  expect(mocks.mutation).toHaveBeenCalledWith("convert", { personId: "p1", input: { status: "active", membershipExpiry: null, joinDate: null } });
});
it("delegates cleanup to the guarded authorized backend", async () => {
  await deletePerson("p1");
  expect(mocks.attendance).toHaveBeenCalledWith("/api/attendance/admin", { operation: "delete-profile", personId: "p1" }, true);
});
