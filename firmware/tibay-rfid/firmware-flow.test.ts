import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./tibay-rfid.ino", import.meta.url), "utf8");
const scan = source.split("void scan() {")[1]?.split("\nvoid setup() {")[0];

describe("physical card tap flow", () => {
  it("refreshes the idle command before choosing attendance or enrollment for that tap", () => {
    expect(scan).toBeDefined();
    const readPosition = scan!.indexOf("reader.PICC_ReadCardSerial()");
    const refreshPosition = scan!.indexOf("poll();");
    const modePosition = scan!.indexOf('pendingMode = assignmentId.isEmpty() ? "attendance" : "enrollment"');
    const idleOnlyPosition = scan!.indexOf("if (assignmentId.isEmpty()) {");
    const idleOnlyEnd = scan!.indexOf("\n  }", idleOnlyPosition);
    expect(readPosition).toBeGreaterThanOrEqual(0);
    expect(refreshPosition).toBeGreaterThan(readPosition);
    expect(modePosition).toBeGreaterThan(refreshPosition);
    expect(idleOnlyPosition).toBeGreaterThan(readPosition);
    expect(refreshPosition).toBeGreaterThan(idleOnlyPosition);
    expect(idleOnlyEnd).toBeGreaterThan(refreshPosition);
    expect(scan!.slice(refreshPosition, idleOnlyEnd)).toContain("if (!healthy || !authorized) return;");
  });

  it("acknowledges a newly read card before waiting for the backend", () => {
    expect(scan).toBeDefined();
    const readPosition = scan!.indexOf("reader.PICC_ReadCardSerial()");
    const beepPosition = scan!.indexOf("readBeep();");
    const refreshPosition = scan!.indexOf("poll();");
    expect(beepPosition).toBeGreaterThan(readPosition);
    expect(refreshPosition).toBeGreaterThan(beepPosition);
    expect(source).toContain('if (status == 200 && (code == "rfid-assigned" || code == "checked-in" || code == "checked-out")) beep();');
  });
});
