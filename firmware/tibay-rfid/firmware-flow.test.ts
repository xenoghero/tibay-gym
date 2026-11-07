import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./tibay-rfid.ino", import.meta.url), "utf8");
const block = (start: string, end: string) => source.split(start)[1]?.split(end)[0] ?? "";
const scan = block("void scan() {", "\nvoid setup() {");
const prepare = block("void prepareCapture() {", "\nvoid serviceNetwork() {");
const service = block("void serviceNetwork() {", "\nvoid scan() {");
const submit = block("void handleSubmit(", "\nString eventId() {");

describe("physical card tap flow", () => {
  it("requires a stable card before the greeting, read beep, or network capture", () => {
    const hold = scan.indexOf("if (!cardHold.observe(millis(), card)) return;");
    const greeting = scan.indexOf('screen(assignmentId.isEmpty() ? "Welcome back" : "Card detected");');
    const beep = scan.indexOf("readBeep();");
    expect(hold).toBeGreaterThan(scan.indexOf("reader.PICC_ReadCardSerial()"));
    expect(greeting).toBeGreaterThan(hold);
    expect(beep).toBeGreaterThan(greeting);
    expect(scan.indexOf("poll();")).toBeGreaterThan(beep);
    expect(scan.indexOf("prepareCapture();")).toBeGreaterThan(beep);
    expect(scan).toContain("if (presence == MFRC522::STATUS_TIMEOUT) {\n    cardHold.reset();");
    expect(scan).toContain("if (!canAccept) { cardHold.reset(); latched = true; return; }");
  });

  it("refreshes attendance mode before persisting and submitting that same card", () => {
    expect(scan).toContain("if (assignmentId.isEmpty()) {");
    expect(scan).toContain("poll();");
    expect(service).toContain("handlePoll(networkJob.status, networkJob.response);");
    expect(service).toContain("if (healthy && authorized) prepareCapture();");
    expect(prepare).toContain('pendingMode = assignmentId.isEmpty() ? "attendance" : "enrollment";');
    expect(prepare).toContain('capture["uid"] = tapUid;');
    expect(prepare.indexOf('storage.putString("pending", pendingBody)')).toBeLessThan(prepare.indexOf("submit();"));
  });

  it("keeps HTTPS off the UI loop and starts capture without waiting for the greeting", () => {
    const worker = block("void networkWorker(void *) {", "\nvoid startNetwork(");
    expect(worker).toContain("requestJson(");
    expect(worker).toContain("xQueueSend(networkDone, &done, portMAX_DELAY);");
    expect(worker).not.toContain("screen(");
    expect(source.match(/requestJson\(/g)).toHaveLength(2); // Definition and worker call only.
    expect(source).toContain('xTaskCreate(networkWorker, "rfid-https", 12288, nullptr, 1, nullptr)');
    expect(service).toContain("if (networkJob.capture && tapActive && tapPhase(millis() - tapStarted) == TapPhase::Greeting) return;");
    expect(service).toContain("xQueueReceive(networkDone, &done, 0)");
    expect(source).toContain("!networkBusy && !cardHold.tracking");
  });

  it("ends foreground verification at the deadline without deleting an uncertain capture", () => {
    const timeout = service.split("// Let a fast response")[0];
    expect(timeout).toContain("tapPhase(millis() - tapStarted) == TapPhase::Delayed");
    expect(timeout).toContain("tapActive = false; tapUid = \"\"; confirmationDelayed = true;");
    expect(timeout).not.toContain("clearPending()");
    expect(source).toContain('screen("Confirmation delayed");');
    expect(source).toContain('drawTitle(32, "TAKING LONGER");');
    expect(source).toContain('"No need to tap again"');
    expect(source).not.toContain("SYNCING TAP");
    expect(source).not.toContain("Recovering same tap");
  });

  it("only shows checked-in feedback and its success beep after an authoritative result", () => {
    expect(submit).toContain("if (!clearPending()) return;");
    expect(submit).toContain('message(feedback(code), code == "retry-expired" ? "Check admin / use QR" : "Remove card");');
    expect(submit).toContain('if (status == 200 && (code == "rfid-assigned" || code == "checked-in" || code == "checked-out")) beep();');
    expect(source).toContain('"CHECKED IN!"');
    expect(source).toContain('"Tara buhat na!"');
    expect(submit).toContain("scanWaitUntil = millis() + (attendanceSucceeded ? ATTENDANCE_WAIT_MS : ASSIGNMENT_WAIT_MS);");
    expect(submit).not.toContain("healthy = false; nextNetwork = scanWaitUntil;");
  });

  it("pauses all card taps and routine requests during assignment cooldown only", () => {
    expect(source).toContain("constexpr uint32_t COMMAND_POLL_MS = 60000, ATTENDANCE_WAIT_MS = 3000;");
    expect(submit).toContain("assignmentCooldown = !attendanceSucceeded;");
    expect(submit).toContain("nextNetwork = assignmentCooldown ? scanWaitUntil : millis() + COMMAND_POLL_MS;");
    expect(scan).toContain("!scanWaiting && !tapActive");
    expect(source).toContain("due(nextNetwork) && !scanWaiting && !networkBusy");
    expect(source).toContain('screen("Assignment cooldown", String("Next tap in ") + seconds + "s");');
    expect(source).toContain('"All RFID taps paused"');
  });

  it("plays a nonblocking double beep only for confirmed successes", () => {
    expect(submit).toContain('if (status == 200 && (code == "rfid-assigned" || code == "checked-in" || code == "checked-out")) beep();');
    expect(source).toContain("digitalWrite(BUZZER_PIN, successBeepOn(elapsed) ? LOW : HIGH);");
    expect(source).toContain("if (elapsed >= SUCCESS_BEEP_MS) successBeeping = false;");
    const beep = block("void beep() {", "// A short physical-read");
    expect(beep).not.toContain("delay(");
  });

  it("preserves responsive removal and the existing three-second attendance countdown", () => {
    expect(source).toContain("constexpr uint32_t REMOVAL_MS = 400, RESULT_MS = 3000;");
    expect(source).toContain("constexpr uint32_t ASSIGNMENT_WAIT_MS = 60000;");
    expect(source).toContain('if (scanWaiting && due(scanWaitUntil)) {\n    if (assignmentCooldown) healthy = false;\n    scanWaiting = false;\n    assignmentCooldown = false;\n    scanWaitTitle = "";\n  }');
    expect(source).toContain("if (!networkBusy && !pendingBody.isEmpty() && clockReady())");
  });
});
