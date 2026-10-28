import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ requireDevice: async () => ({ id: "entrance-01" }) }));
vi.mock("@/lib/server/attendance", () => ({ scanAttendance: async () => ({
  resultCode: "checked-in", action: "checked-in", assignmentId: null,
  personId: "private-id", credentialHash: "secret", address: "private", birthDate: "private", weight: 80,
}) }));
vi.mock("./enrollment", () => ({ captureAssignment: async () => ({
  resultCode: "assigned", action: null, assignmentId: "command", personId: "private-id", address: "private",
}) }));
import { POST } from "@/app/api/rfid/device/capture/route";
it.each(["attendance", "enrollment"])("allowlists %s device response fields", async mode => {
  const response = await POST(new Request("https://test/api", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, deviceId: "entrance-01",
      uid: "09:70:65:20", eventId: "event_0123456789ab", requestedAt: Date.now(), assignmentId: mode === "enrollment" ? "command" : undefined }) }));
  expect(response.status).toBe(200);
  expect(Object.keys(await response.json()).sort()).toEqual(["action", "assignmentId", "resultCode"]);
});
it.each(["firestore.rules", "firestore.cutover.rules"])("%s keeps integration and private profile reads restricted", file => {
  const rules = readFileSync(file, "utf8");
  for (const name of ["rfidDevices", "rfidCards", "attendanceState", "unverifiedAttendanceState", "scanResults", "rfidRateLimits", "_serverConfig"])
    expect(rules).toMatch(new RegExp(`match /${name}/[^}]+\\} \\{ allow read, write: if false; \\}`));
  for (const name of ["persons", "attendanceLogs", "unverifiedPersons", "unverifiedAttendanceLogs", "rfidDeviceStatus", "rfidAssignments", "rfidTapEvents", "rfidCardChanges", "profileDetails", "weightEntries"]) {
    const block = rules.split(new RegExp(`match /${name}/[^}]+\\} \\{`))[1]?.split(/\n\s*match \//)[0];
    expect(block).toMatch(/allow (?:read(?:, (?:write|delete))?|get, list): if isAdmin\(\);/);
    expect(block).not.toMatch(/allow (?:read|get|list)[^;]+if true/);
  }
});
it.each(["firestore.rules", "firestore.cutover.rules"])("%s prevents browser mutations from bypassing audit", file => {
  const rules = readFileSync(file, "utf8");
  for (const name of ["persons", "profileDetails", "weightEntries", "statusChanges"]) {
    const block = rules.split(new RegExp(`match /${name}/[^}]+\\} \\{`))[1]?.split(/\n\s*match \//)[0];
    expect(block).not.toMatch(/allow (?:write|create|update|delete)[^;]+if isAdmin/);
    expect(block).toMatch(/if false/);
  }
  expect(rules).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false/);
});
