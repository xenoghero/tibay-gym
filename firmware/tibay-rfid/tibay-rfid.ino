// Tibay entrance scanner. All attendance/ownership decisions belong to Vercel.
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <SPI.h>
#include <MFRC522.h>
#include <U8g2lib.h>
#include <esp_system.h>
#include <time.h>
#include <sys/time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include "tap_flow.h"
#include "tibay_logo.h"
#if __has_include("scanner_config.h")
#include "scanner_config.h"
#else
#include "scanner_config.example.h"
#endif

constexpr uint32_t REMOVAL_MS = 400, RESULT_MS = 3000;
constexpr uint32_t ATTENDANCE_RETRY_MS = 30000, ENROLLMENT_RETRY_MS = 600000;
constexpr uint32_t COMMAND_POLL_MS = 60000, ATTENDANCE_WAIT_MS = 3000;
constexpr uint32_t ASSIGNMENT_WAIT_MS = 60000;
constexpr uint32_t EXPIRED_RESULT_MS = 5000;
constexpr uint32_t WIFI_RECONNECT_MS = 15000, PRESENCE_MS = 100;
constexpr uint8_t BUZZER_PIN = 32;
// 128x64 SSD1309 4-pin I2C module (internal reset and address 0x3C).
U8G2_SSD1309_128X64_NONAME2_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE, 26, 25);
MFRC522 reader(5, 27);
Preferences storage;

String assignmentId, pendingBody, pendingMode;
int64_t assignmentDeadline = 0, pendingAt = 0;
uint32_t nextNetwork = 0, nextWifi = 0, nextPresence = 0, connectingUntil = 0;
uint32_t backoff = 5000, absenceMs = 0, lastPresence = 0, resultUntil = 0, buzzerStarted = 0;
bool successBeeping = false;
bool expiredBeeping = false;
uint32_t scanWaitUntil = 0;
bool scanWaiting = false;
bool assignmentCooldown = false;
String scanWaitTitle;
bool healthy = false, authorized = false, latched = true, absenceStarted = false;
bool hardwareReady = false, configured = false, wasConnected = false;
bool storageReady = false, storageFault = false;
bool backendFailed = false;
String backendDetail = "Refreshing backend";
String screenTitle, screenDetail;
CardHold cardHold;
String tapUid;
uint32_t tapStarted = 0, lastFrame = 0;
uint32_t screenStarted = 0;
bool tapActive = false, confirmationDelayed = false, networkBusy = false;
QueueHandle_t networkDone = nullptr;
// The UI owns this job until launch; the worker owns it until queue completion.
struct NetworkJob {
  bool capture = false;
  String body, detail;
  JsonDocument response;
  int status = -1;
} networkJob;

bool due(uint32_t deadline) { return static_cast<int32_t>(millis() - deadline) >= 0; }
int64_t epochMs() {
  struct timeval value;
  gettimeofday(&value, nullptr);
  return static_cast<int64_t>(value.tv_sec) * 1000 + value.tv_usec / 1000;
}
bool clockReady() { return epochMs() > 1735689600000LL; }

// --- UI Drawing Helpers & Procedural Icons (128x64 OLED) ---

void drawCentered(int16_t y, const String &text, const uint8_t *font) {
  oled.setFont(font);
  int16_t w = oled.getStrWidth(text.c_str());
  int16_t x = (128 - w) / 2;
  if (x < 0) x = 0;
  oled.drawStr(x, y, text.c_str());
}

void drawTitle(int16_t y, const String &text) {
  oled.setFont(u8g2_font_helvB10_tf);
  if (oled.getStrWidth(text.c_str()) <= 114) {
    drawCentered(y, text, u8g2_font_helvB10_tf);
  } else {
    oled.setFont(u8g2_font_helvB08_tf);
    if (oled.getStrWidth(text.c_str()) <= 122) {
      drawCentered(y, text, u8g2_font_helvB08_tf);
    } else {
      drawCentered(y, text, u8g2_font_6x12_tf);
    }
  }
}

void drawSubtitle(int16_t y, const String &text) {
  oled.setFont(u8g2_font_6x12_tf);
  if (oled.getStrWidth(text.c_str()) <= 122) {
    drawCentered(y, text, u8g2_font_6x12_tf);
  } else {
    oled.setFont(u8g2_font_helvR08_tf);
    if (oled.getStrWidth(text.c_str()) <= 124) {
      drawCentered(y, text, u8g2_font_helvR08_tf);
    } else {
      drawCentered(y, text, u8g2_font_5x7_tf);
    }
  }
}

void drawDetail(int16_t y, const String &text) {
  drawSubtitle(y, text);
}

void drawIconCheck(int16_t cx, int16_t cy) {
  oled.drawCircle(cx, cy, 8);
  oled.drawCircle(cx, cy, 7);
  oled.drawLine(cx - 4, cy, cx - 1, cy + 3);
  oled.drawLine(cx - 4, cy - 1, cx - 1, cy + 2);
  oled.drawLine(cx - 1, cy + 3, cx + 4, cy - 3);
  oled.drawLine(cx - 1, cy + 2, cx + 4, cy - 4);
}

void drawIconAlert(int16_t cx, int16_t cy) {
  oled.drawCircle(cx, cy, 8);
  oled.drawCircle(cx, cy, 7);
  oled.drawBox(cx - 1, cy - 4, 3, 5);
  oled.drawBox(cx - 1, cy + 2, 3, 2);
}

void drawIconDenied(int16_t cx, int16_t cy) {
  oled.drawCircle(cx, cy, 8);
  oled.drawCircle(cx, cy, 7);
  oled.drawLine(cx - 3, cy - 3, cx + 3, cy + 3);
  oled.drawLine(cx - 3, cy - 4, cx + 4, cy + 3);
  oled.drawLine(cx - 3, cy + 3, cx + 3, cy - 3);
  oled.drawLine(cx - 3, cy + 4, cx + 4, cy - 3);
}

void drawIconMemberCard(int16_t cx, int16_t cy) {
  oled.drawRFrame(cx - 16, cy - 9, 32, 18, 2);
  oled.drawDisc(cx - 8, cy - 3, 3);
  oled.drawCircle(cx - 8, cy + 5, 5, U8G2_DRAW_UPPER_LEFT | U8G2_DRAW_UPPER_RIGHT);
  oled.drawHLine(cx - 1, cy - 4, 12);
  oled.drawHLine(cx - 1, cy, 12);
  oled.drawHLine(cx - 1, cy + 4, 8);
}

void drawIconCardLift(int16_t cx, int16_t cy) {
  oled.drawRFrame(cx - 13, cy + 1, 26, 8, 2);
  oled.drawLine(cx, cy - 8, cx, cy - 1);
  oled.drawLine(cx, cy - 8, cx - 3, cy - 5);
  oled.drawLine(cx, cy - 8, cx + 3, cy - 5);
}

void renderScreen(const String &title, const String &detail) {
  // 1. Standby / Welcome Screen
  if (title == "Tap RFID") {
    drawCentered(10, "WELCOME TO TIBAY GYM", u8g2_font_6x12_tf);
    oled.drawHLine(6, 13, 116);
    oled.drawXBMP((128 - TIBAY_LOGO_WIDTH) / 2, 16, TIBAY_LOGO_WIDTH, TIBAY_LOGO_HEIGHT, TIBAY_LOGO_BITS);
    uint8_t accentWidth = 4 + (millis() / 350) % 3;
    oled.drawHLine(32 - accentWidth, 32, accentWidth);
    oled.drawHLine(96, 32, accentWidth);
    drawCentered(58, "TAP YOUR CARD", u8g2_font_helvB10_tf);
    return;
  }

  // 2. Member Enrollment Screen (Pairing card to member profile)
  if (title == "Tap RFID to assign") {
    oled.drawBox(0, 0, 128, 13);
    oled.setDrawColor(0);
    drawCentered(10, "LINK MEMBER CARD", u8g2_font_6x12_tf);
    oled.setDrawColor(1);
    drawIconMemberCard(64, 27);
    drawCentered(48, "TAP MEMBER CARD", u8g2_font_helvB08_tf);
    drawCentered(61, "Hold card steady", u8g2_font_6x12_tf);
    return;
  }

  // 3. Card Removal Latch
  if (title == "Getting ready") {
    drawIconCardLift(64, 14);
    drawTitle(36, "PLEASE LIFT CARD");
    int idx = detail.indexOf("Wait ");
    String timeStr = (idx >= 0) ? detail.substring(idx + 5) : detail;
    drawCentered(54, String("Ready in ") + timeStr, u8g2_font_6x12_tf);
    return;
  }

  if (title == "Welcome back") {
    oled.drawHLine(16, 10, 96);
    drawCentered(29, "WELCOME BACK,", u8g2_font_helvB10_tf);
    drawCentered(48, "KA-TIBAY!", u8g2_font_helvB10_tf);
    oled.drawHLine(16, 58, 96);
    return;
  }

  if (title == "Card detected" || title == "Linking card") {
    drawIconMemberCard(64, 12);
    drawTitle(35, title == "Card detected" ? "CARD DETECTED" : "LINKING CARD...");
    drawDetail(49, "Please wait");
    drawCentered(61, "No need to tap again", u8g2_font_5x7_tf);
    uint8_t dot = (millis() / 250) % 5;
    oled.drawBox(50 + dot * 6, 20, 3, 2);
    return;
  }

  if (title == "Assignment cooldown") {
    drawIconCardLift(64, 10);
    drawTitle(31, "PLEASE REMOVE CARD");
    drawDetail(47, detail);
    drawCentered(61, "All RFID taps paused", u8g2_font_5x7_tf);
    return;
  }

  // 4. In-flight Tap Verification
  if (title == "Confirming") {
    oled.drawRFrame(12, 8, 104, 24, 3);
    drawCentered(25, String("VERIFYING") + String("...").substring(0, 1 + (millis() / 300) % 3), u8g2_font_helvB10_tf);
    drawCentered(46, "Contacting server", u8g2_font_6x12_tf);
    drawCentered(58, "Please hold still", u8g2_font_5x7_tf);
    return;
  }

  // 5. Successful Attendance Check-in
  if (title == "Checked in") {
    drawIconCheck(64, 11);
    drawCentered(33, "CHECKED IN!", u8g2_font_helvB10_tf);
    drawCentered(47, "Tara buhat na!", u8g2_font_6x12_tf);
    if (detail.indexOf("Next tap") >= 0) {
      int idx = detail.indexOf("Next tap in ");
      String sec = (idx >= 0) ? detail.substring(idx + 12, detail.indexOf('s', idx)) : "3";
      drawCentered(59, String("Ready in ") + sec + "s • Lift card", u8g2_font_5x7_tf);
    } else {
      drawCentered(59, "Tibay Gym entrance", u8g2_font_5x7_tf);
    }
    return;
  }

  // 6. Successful Attendance Check-out
  if (title == "Checked out") {
    drawIconCheck(64, 11);
    drawCentered(33, "CHECKED OUT", u8g2_font_helvB10_tf);
    drawSubtitle(47, "Great workout! See you!");
    if (detail.indexOf("Next tap") >= 0) {
      int idx = detail.indexOf("Next tap in ");
      String sec = (idx >= 0) ? detail.substring(idx + 12, detail.indexOf('s', idx)) : "3";
      drawCentered(59, String("Ready in ") + sec + "s • Lift card", u8g2_font_5x7_tf);
    } else {
      drawCentered(59, "Tibay Gym exit", u8g2_font_5x7_tf);
    }
    return;
  }

  // 7. Successful Card Assignment
  if (title == "RFID assigned") {
    drawIconCheck(64, 10);
    drawCentered(29, "CARD LINKED!", u8g2_font_helvB10_tf);
    drawCentered(42, "Ready for gym visits", u8g2_font_6x12_tf);
    if (detail.indexOf("Next tap in ") >= 0 || detail.indexOf("Next card in ") >= 0) {
      int idx = detail.indexOf("Next tap in ");
      if (idx < 0) idx = detail.indexOf("Next card in ");
      int numStart = idx >= 0 ? detail.indexOf("in ", idx) + 3 : -1;
      String sec = (numStart >= 3) ? detail.substring(numStart, detail.indexOf('s', numStart)) : "3";
      oled.drawRFrame(12, 47, 104, 16, 3);
      drawCentered(59, String("Next card in ") + sec + "s", u8g2_font_6x12_tf);
    } else {
      drawCentered(58, "Member card ready", u8g2_font_5x7_tf);
    }
    return;
  }

  // 8. Offline Mode
  if (title == "Offline") {
    drawIconAlert(64, 12);
    drawCentered(35, "OFFLINE MODE", u8g2_font_helvB10_tf);
    drawSubtitle(50, "Please use QR check-in");
    drawCentered(61, "Wi-Fi disconnected", u8g2_font_5x7_tf);
    return;
  }

  // 9. Membership Expired
  if (title == "Membership expired") {
    uint32_t elapsed = millis() - screenStarted;
    int16_t offset = elapsed < 120 ? -3 : elapsed < 240 ? 3 : elapsed < 360 ? -1 : 0;
    drawIconAlert(64 + offset, 10);
    if (elapsed >= 480) oled.drawCircle(64, 10, 9 + (elapsed / 600) % 2);
    drawCentered(28, "MEMBERSHIP", u8g2_font_helvB08_tf);
    drawCentered(41, "EXPIRED", u8g2_font_helvB10_tf);
    drawCentered(52, "Please renew at desk", u8g2_font_5x7_tf);
    drawCentered(62, "Attendance not recorded", u8g2_font_5x7_tf);
    return;
  }

  // 10. Card already owned by another member
  if (title == "Card already owned") {
    drawIconAlert(64, 12);
    drawTitle(34, "CARD ALREADY IN USE");
    drawSubtitle(49, "Belongs to another member");
    drawCentered(61, "Use an unassigned card", u8g2_font_5x7_tf);
    return;
  }

  // 11. Unknown / Unregistered Card
  if (title == "Unknown card") {
    drawIconAlert(64, 12);
    drawTitle(34, "CARD UNREGISTERED");
    drawSubtitle(49, "Register at front desk");
    drawCentered(61, "Card not found in system", u8g2_font_5x7_tf);
    return;
  }

  // 12. Card already assigned to this person (replace required)
  if (title == "Use Replace Card") {
    drawIconAlert(64, 12);
    drawTitle(34, "CARD ALREADY LINKED");
    drawSubtitle(49, "Use 'Replace Card' in admin");
    return;
  }

  // 13. Unsupported card (UID != 4 bytes)
  if (title == "Unsupported card") {
    drawIconDenied(64, 12);
    drawTitle(34, "UNSUPPORTED CARD");
    drawSubtitle(49, "4-byte Mifare required");
    return;
  }

  // 14. Device unauthorized
  if (title == "Device unauthorized") {
    drawIconDenied(64, 12);
    drawTitle(34, "DEVICE LOCKED");
    drawSubtitle(49, "Check provisioning");
    return;
  }

  // 15. Connecting
  if (title == "Connecting") {
    drawCentered(12, "TIBAY GYM", u8g2_font_6x12_tf);
    oled.drawHLine(10, 16, 108);
    drawCentered(36, "CONNECTING...", u8g2_font_helvB10_tf);
    drawDetail(54, detail.isEmpty() ? "Wi-Fi and HTTPS" : detail);
    return;
  }

  if (title == "Confirmation delayed") {
    drawIconAlert(64, 11);
    drawTitle(32, "TAKING LONGER");
    drawDetail(48, "Please ask front desk");
    drawCentered(61, "No need to tap again", u8g2_font_5x7_tf);
    return;
  }

  // 16. In-flight tap retry / unconfirmed tap
  if (title == "Could not confirm") {
    drawIconAlert(64, 12);
    if (detail == "Checking your card") {
      drawTitle(32, "PLEASE WAIT");
      drawDetail(48, "Checking your card");
      drawCentered(61, "No need to tap again", u8g2_font_5x7_tf);
    } else {
      drawTitle(34, "NOT CONFIRMED");
      drawDetail(50, detail.isEmpty() ? "Please ask front desk" : detail);
    }
    return;
  }

  // 17. Assignment timeout or cancelled or ended
  if (title == "Assignment timeout" || title == "Assignment ended" || title == "Assignment cancelled") {
    drawIconAlert(64, 12);
    String t = (title == "Assignment timeout") ? "ENROLLMENT TIMEOUT" :
               (title == "Assignment cancelled" ? "ENROLL CANCELLED" : "ENROLLMENT ENDED");
    drawTitle(34, t);
    drawDetail(50, detail.isEmpty() ? "Returned to attendance" : detail);
    return;
  }

  // 18. Hardware / Storage / Setup faults
  if (title == "RFID error" || title == "Recovery storage error" || title == "Setup required") {
    drawIconDenied(64, 12);
    String t = (title == "RFID error") ? "RFID ERROR" :
               (title == "Recovery storage error" ? "STORAGE FAULT" : "SETUP REQUIRED");
    drawTitle(34, t);
    drawDetail(50, detail);
    return;
  }

  // 19. Generic fallback layout (for backend unavailable, request rejected, etc.)
  drawIconAlert(64, 12);
  drawTitle(34, title);
  if (!detail.isEmpty()) drawDetail(50, detail);
}

void screen(const String &title, const String &detail = "") {
  bool changed = title != screenTitle || detail != screenDetail;
  bool animated = title == "Tap RFID" || title == "Confirming" || title == "Linking card" || title == "Membership expired";
  if (!changed && (!animated || millis() - lastFrame < 120)) return;
  lastFrame = millis();
  if (title != screenTitle) screenStarted = lastFrame;
  screenTitle = title; screenDetail = detail;
  oled.clearBuffer();
  renderScreen(title, detail);
  oled.sendBuffer();
  // Do not print request bodies, card UIDs, credentials, or person information.
  if (changed) Serial.println(title);
}
void message(const String &title, const String &detail = "") {
  screen(title, detail);
  resultUntil = millis() + (title == "Membership expired" ? EXPIRED_RESULT_MS : RESULT_MS);
}
void beep() { buzzerStarted = millis(); successBeeping = true; digitalWrite(BUZZER_PIN, LOW); }
void expiredBeep() { buzzerStarted = millis(); expiredBeeping = true; digitalWrite(BUZZER_PIN, LOW); }
// A short physical-read acknowledgement is distinct from the later double beep.
// Finish it before HTTPS so a slow request cannot leave the buzzer sounding.
void readBeep() { digitalWrite(BUZZER_PIN, LOW); delay(45); digitalWrite(BUZZER_PIN, HIGH); }

String feedback(const String &code) {
  if (code == "rfid-assigned") return "RFID assigned";
  if (code == "checked-in") return "Checked in";
  if (code == "checked-out") return "Checked out";
  if (code == "expired-member") return "Membership expired";
  if (code == "unknown-card") return "Unknown card";
  if (code == "card-owned") return "Card already owned";
  if (code == "assignment-expired") return "Assignment timeout";
  if (code == "assignment-cancelled") return "Assignment cancelled";
  if (code == "assignment-completed") return "Assignment ended";
  if (code == "command-mismatch" || code == "command-inactive") return "Assignment ended";
  if (code == "unauthorized" || code == "device-mismatch") return "Device unauthorized";
  if (code == "enrollment-active") return "Assignment active";
  if (code == "invalid-uid") return "Unsupported card";
  if (code == "binding-changed" || code == "registry-conflict") return "Card binding conflict";
  if (code == "replace-required") return "Use Replace Card";
  if (code == "no-card-assigned") return "No card to replace";
  if (code == "person-unavailable") return "Person unavailable";
  if (code == "retry-expired") return "Could not confirm";
  if (code == "event-id-conflict") return "Event conflict";
  return "Request rejected";
}

void idleScreen() {
  if (resultUntil && !due(resultUntil)) {
    screen(screenTitle, screenDetail);
    return;
  }
  if (storageFault) { screen("Recovery storage error", "Service scanner"); return; }
  if (!authorized && healthy) { screen("Device unauthorized", "Check provisioning"); return; }
  if (tapActive) {
    bool greeting = tapPhase(millis() - tapStarted) == TapPhase::Greeting;
    if (!assignmentId.isEmpty()) screen(greeting ? "Card detected" : "Linking card");
    else screen(greeting ? "Welcome back" : "Confirming");
    return;
  }
  if (!pendingBody.isEmpty()) {
    if (confirmationDelayed) screen("Confirmation delayed");
    else screen("Could not confirm", "Checking your card");
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    if (!due(connectingUntil)) screen("Connecting", "Wi-Fi and HTTPS");
    else screen("Offline", "Use QR check-in");
    return;
  }
  if (!clockReady()) { screen("Connecting", "Waiting for time"); return; }
  int32_t scanRemaining = static_cast<int32_t>(scanWaitUntil - millis());
  if (scanWaiting && scanRemaining > 0) {
    uint32_t seconds = (static_cast<uint32_t>(scanRemaining) + 999) / 1000;
    if (assignmentCooldown && due(resultUntil)) {
      screen("Assignment cooldown", String("Next tap in ") + seconds + "s");
      return;
    }
    String prefix = (scanWaitTitle == "RFID assigned") ? "Next card in " : "Next tap in ";
    screen(scanWaitTitle, prefix + seconds + "s / Remove card");
    return;
  }
  if (!healthy) { screen(backendFailed ? "Backend unavailable" : "Connecting", backendDetail); return; }
  if (!assignmentId.isEmpty() && epochMs() >= assignmentDeadline) {
    screen("Assignment timeout", "Waiting for backend"); return;
  }
  // Match scan()'s removal gate: a successful backend poll alone does not mean
  // the reader can accept a tap, especially immediately after boot.
  if (latched) {
    uint32_t remaining = absenceMs < REMOVAL_MS ? REMOVAL_MS - absenceMs : 0;
    uint32_t seconds = (remaining + 999) / 1000;
    screen("Getting ready", String("Remove card / Wait ") + seconds + "s");
    return;
  }
  if (!assignmentId.isEmpty()) screen("Tap RFID to assign");
  else screen("Tap RFID");
}

bool clearPending() {
  // Clear durable data before accepting any next scan; failure must block scans.
  if (storage.isKey("pending") && !storage.remove("pending")) {
    storageFault = true; screen("Recovery storage error", "Service scanner"); return false;
  }
  pendingBody = ""; pendingMode = ""; pendingAt = 0;
  confirmationDelayed = false;
  return true;
}

void restorePending() {
  pendingBody = storage.getString("pending", "");
  if (pendingBody.isEmpty()) return;
  JsonDocument saved;
  if (deserializeJson(saved, pendingBody) || pendingBody.length() > 1024 ||
      saved["deviceId"].as<String>() != DEVICE_ID ||
      (saved["mode"].as<String>() != "attendance" && saved["mode"].as<String>() != "enrollment") ||
      !saved["requestedAt"].is<int64_t>() || saved["eventId"].as<String>().length() != 32) {
    storageFault = true; screen("Recovery storage error", "Service scanner"); return;
  }
  pendingMode = saved["mode"].as<String>(); pendingAt = saved["requestedAt"].as<int64_t>();
  screen("Could not confirm", "Checking your card");
}

void failure(bool throttled = false) {
  healthy = false; backendFailed = true;
  nextNetwork = millis() + (throttled ? 60000 : backoff);
  backoff = min(backoff * 2, static_cast<uint32_t>(60000));
  if (tapActive || !pendingBody.isEmpty()) idleScreen();
  else screen("Backend unavailable", backendDetail);
}

// Fixed diagnostic fields only. Never print the URL, body, headers, SSID, or UID.
void networkDiagnostic(bool capture, uint32_t startedAt, int status, const char *outcome, int tlsError = 0) {
  Serial.printf("[RFID-net] op=%s status=%d elapsedMs=%lu wifi=%d rssi=%d tls=%d outcome=%s\n",
    capture ? "capture" : "commands", status, static_cast<unsigned long>(millis() - startedAt),
    static_cast<int>(WiFi.status()), static_cast<int>(WiFi.RSSI()), tlsError, outcome);
}

// Strict HTTPS, host validation, CA trust, no redirects that could leak headers.
int requestJson(const char *path, const String *body, JsonDocument &response, String &detail) {
  uint32_t startedAt = millis();
  WiFiClientSecure tls; tls.setCACert(BACKEND_ROOT_CA); tls.setHandshakeTimeout(5);
  HTTPClient http; http.setConnectTimeout(5000); http.setTimeout(5000);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if (!http.begin(tls, String(BACKEND_ORIGIN) + path)) {
    detail = "HTTPS setup failed";
    networkDiagnostic(body != nullptr, startedAt, -1, "https-setup");
    return -1;
  }
  http.addHeader("Authorization", String("Bearer ") + DEVICE_CREDENTIAL);
  http.addHeader("X-RFID-Device-Id", DEVICE_ID);
  int status;
  if (body) { http.addHeader("Content-Type", "application/json"); status = http.POST(*body); }
  else status = http.GET();
  // Current backend JSON responses are small. Reject unexpected oversized data.
  String payload;
  int responseSize = http.getSize();
  if (status > 0 && responseSize <= 2048) payload = http.getString();
  char tlsMessage[128];
  int tlsError = tls.lastError(tlsMessage, sizeof(tlsMessage));
  http.end();
  if (status <= 0) {
    detail = status == HTTPC_ERROR_READ_TIMEOUT ? "Request timed out" :
      (tlsError ? "TLS connection error" : "Connection failed");
    networkDiagnostic(body != nullptr, startedAt, status, "transport-error", tlsError);
    return status;
  }
  if (status != 200) {
    detail = status == 429 ? "Rate limited / retry" : String("HTTP ") + status + " / retry";
    networkDiagnostic(body != nullptr, startedAt, status, "http-error");
    if (status == 401 || status == 403 || status == 429 || status >= 500) return status;
  }
  if (responseSize > 2048 || payload.length() > 2048) {
    detail = "Response too large";
    networkDiagnostic(body != nullptr, startedAt, status, "oversized-response");
    return -1;
  }
  if (deserializeJson(response, payload)) {
    if (status == 200) detail = "Invalid response";
    networkDiagnostic(body != nullptr, startedAt, status, "invalid-json");
    return -1;
  }
  if (status == 200) networkDiagnostic(body != nullptr, startedAt, status, "json-ok");
  return status;
}

void networkWorker(void *) {
  networkJob.status = requestJson(networkJob.capture ? "/api/rfid/device/capture" : "/api/rfid/device/commands",
    networkJob.capture ? &networkJob.body : nullptr, networkJob.response, networkJob.detail);
  uint8_t done = 1;
  xQueueSend(networkDone, &done, portMAX_DELAY);
  vTaskDelete(nullptr);
}

void startNetwork(bool capture) {
  if (networkBusy) return;
  networkJob.capture = capture;
  networkJob.body = capture ? pendingBody : "";
  networkJob.response.clear();
  networkJob.detail = backendDetail;
  networkBusy = true;
  if (xTaskCreate(networkWorker, "rfid-https", 12288, nullptr, 1, nullptr) != pdPASS) {
    networkBusy = false;
    backendDetail = "Network task unavailable";
    if (pendingBody.isEmpty()) { tapActive = false; tapUid = ""; }
    failure();
  }
}

void poll() { startNetwork(false); }
void submit() { startNetwork(true); }

void handlePoll(int status, JsonDocument &response) {
  if (status == 401 || status == 403) {
    authorized = false; healthy = true; nextNetwork = millis() + 60000;
    message("Device unauthorized", "Check provisioning"); return;
  }
  String mode = response["mode"].as<String>();
  if (status != 200 || (mode != "enrollment" && mode != "attendance") ||
      (mode == "enrollment" && (!response["expiresAt"].is<int64_t>() ||
         response["assignmentId"].as<String>().isEmpty()))) {
    if (status == 200) {
      backendDetail = "Invalid command";
      Serial.println("[RFID-net] op=commands outcome=invalid-command");
    }
    failure(status == 429); return;
  }
  healthy = true; authorized = true; backoff = 5000; backendFailed = false;
  backendDetail = "Refreshing backend";
  scanWaiting = false;
  if (mode == "enrollment") {
    assignmentId = response["assignmentId"].as<String>();
    assignmentDeadline = response["expiresAt"].as<int64_t>();
    nextNetwork = millis() + COMMAND_POLL_MS;
  } else {
    if (!assignmentId.isEmpty()) message(epochMs() >= assignmentDeadline ? "Assignment timeout" : "Assignment ended", "See admin profile");
    // An attendance command is authoritative. A local deadline alone cannot switch modes.
    assignmentId = ""; assignmentDeadline = 0; nextNetwork = millis() + COMMAND_POLL_MS;
  }
  if (!tapActive) idleScreen();
}

void handleSubmit(int status, JsonDocument &response) {
  if (status == 401 || status == 403) {
    tapActive = false; tapUid = "";
    authorized = false; healthy = true; nextNetwork = millis() + 60000;
    message("Device unauthorized", "Check provisioning"); return;
  }
  String code = response[status == 200 ? "resultCode" : "error"].as<String>();
  if (status <= 0 || status >= 500 || status == 429 || code.isEmpty() ||
      (status >= 300 && status < 400)) {
    if (status == 200 && code.isEmpty()) {
      backendDetail = "Invalid capture result";
      Serial.println("[RFID-net] op=capture outcome=invalid-result");
    }
    failure(status == 429); return;
  }
  // Only a parsed authoritative response resolves this event. Preserve its body
  // through transport failures; never generate a replacement ID to recover it.
  bool assignmentSucceeded = status == 200 && code == "rfid-assigned";
  bool assignmentRejected = pendingMode == "enrollment" && code == "card-owned";
  bool attendanceSucceeded = pendingMode == "attendance" && status == 200 &&
    (code == "checked-in" || code == "checked-out");
  if (!clearPending()) return;
  tapActive = false; tapUid = "";
  healthy = true; authorized = true; backoff = 5000; backendFailed = false;
  backendDetail = "Refreshing backend";
  message(feedback(code), code == "retry-expired" ? "Check admin / use QR" : "Remove card");
  if (status == 200 && (code == "rfid-assigned" || code == "checked-in" || code == "checked-out")) beep();
  if (code == "expired-member") expiredBeep();
  if (assignmentSucceeded || assignmentRejected || attendanceSucceeded) {
    // Keep the result visible during its wait interval. Do not accept
    // another tap until the wait ends and an authoritative command is fetched.
    // These assignment outcomes end enrollment on the backend; attendance
    // success already has no assignment. Only a new admin request can rearm it.
    assignmentId = ""; assignmentDeadline = 0;
    scanWaitTitle = feedback(code);
    scanWaiting = true;
    assignmentCooldown = !attendanceSucceeded;
    scanWaitUntil = millis() + (attendanceSucceeded ? ATTENDANCE_WAIT_MS : ASSIGNMENT_WAIT_MS);
    resultUntil = 0; nextNetwork = assignmentCooldown ? scanWaitUntil : millis() + COMMAND_POLL_MS;
    // Show enrollment outcome briefly before the full-reader lockout countdown.
    if (assignmentCooldown) resultUntil = millis() + RESULT_MS;
    idleScreen();
    return;
  }
  // Other results, including conflicts and cancellation, re-poll promptly.
  healthy = false; nextNetwork = millis() + 1000;
}

String eventId() {
  char value[33];
  snprintf(value, sizeof(value), "%08lx%08lx%08lx%08lx",
    static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()),
    static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  return String(value);
}

void prepareCapture() {
  if (!assignmentId.isEmpty() && epochMs() >= assignmentDeadline) {
    tapActive = false; tapUid = "";
    message("Assignment timeout", "Waiting for backend"); nextNetwork = millis(); return;
  }
  JsonDocument capture;
  pendingMode = assignmentId.isEmpty() ? "attendance" : "enrollment";
  pendingAt = epochMs();
  capture["mode"] = pendingMode; capture["deviceId"] = DEVICE_ID;
  capture["uid"] = tapUid; capture["eventId"] = eventId(); capture["requestedAt"] = pendingAt;
  if (pendingMode == "enrollment") capture["assignmentId"] = assignmentId;
  serializeJson(capture, pendingBody);
  // Write-ahead persistence: a power loss after POST must retain exact identity.
  if (storage.putString("pending", pendingBody) != pendingBody.length() ||
      storage.getString("pending", "") != pendingBody) {
    storageFault = true; screen("Recovery storage error", "Service scanner");
  } else {
    nextNetwork = millis();
    submit();
  }
}

void serviceNetwork() {
  if (tapActive && tapPhase(millis() - tapStarted) == TapPhase::Delayed) {
    tapActive = false; tapUid = ""; confirmationDelayed = true;
    if (pendingBody.isEmpty()) message("Could not confirm", "Please ask front desk");
    else idleScreen();
  }
  // Let a fast response wait only for the greeting; HTTPS already ran concurrently.
  if (networkJob.capture && tapActive && tapPhase(millis() - tapStarted) == TapPhase::Greeting) return;
  uint8_t done;
  if (!networkBusy || xQueueReceive(networkDone, &done, 0) != pdTRUE) return;
  networkBusy = false;
  backendDetail = networkJob.detail;
  if (networkJob.capture) {
    handleSubmit(networkJob.status, networkJob.response);
  } else {
    handlePoll(networkJob.status, networkJob.response);
    if (tapActive && !tapUid.isEmpty()) {
      if (healthy && authorized) prepareCapture();
      else { tapActive = false; tapUid = ""; }
    }
  }
}

void scan() {
  if (!due(nextPresence)) return;
  nextPresence = millis() + PRESENCE_MS;
  uint32_t sampleGap = millis() - lastPresence;
  lastPresence = millis();
  byte atqa[2], size = sizeof(atqa);
  // Wake halted cards: IsNewCardPresent() alone cannot prove physical removal.
  MFRC522::StatusCode presence = reader.PICC_WakeupA(atqa, &size);
  if (presence == MFRC522::STATUS_TIMEOUT) {
    cardHold.reset();
    if (absenceStarted && sampleGap <= 250) absenceMs += sampleGap;
    absenceStarted = true;
    if (absenceMs >= REMOVAL_MS) latched = false;
    return;
  }
  absenceStarted = false; // Errors/collisions do not count as removal.
  absenceMs = 0;
  bool read = presence == MFRC522::STATUS_OK && reader.PICC_ReadCardSerial();
  bool canAccept = read && !latched && pendingBody.isEmpty() && !storageFault &&
    !scanWaiting && !tapActive &&
    healthy && authorized && clockReady() && WiFi.status() == WL_CONNECTED &&
    (!resultUntil || due(resultUntil));
  if (read) reader.PICC_HaltA();
  reader.PCD_StopCrypto1();
  if (!canAccept) { cardHold.reset(); latched = true; return; }
  // Wait out an idle poll without treating its duration as observed card presence.
  if (networkBusy) { cardHold.reset(); return; }
  if (reader.uid.size != 4) {
    latched = true; cardHold.reset();
    message("Unsupported card", "Only verified 4 bytes"); return;
  }
  uint32_t card = 0;
  for (uint8_t i = 0; i < 4; ++i) card = (card << 8) | reader.uid.uidByte[i];
  if (!cardHold.observe(millis(), card)) return;
  latched = true; cardHold.reset();
  char uid[12];
  snprintf(uid, sizeof(uid), "%02X:%02X:%02X:%02X", reader.uid.uidByte[0],
    reader.uid.uidByte[1], reader.uid.uidByte[2], reader.uid.uidByte[3]);
  tapUid = uid; tapStarted = millis(); tapActive = true; confirmationDelayed = false;
  screen(assignmentId.isEmpty() ? "Welcome back" : "Card detected");
  readBeep();
  if (assignmentId.isEmpty()) {
    // Refresh the mode for this same held card before creating its capture.
    poll();
  } else {
    prepareCapture();
  }
}

void setup() {
  Serial.begin(115200); pinMode(BUZZER_PIN, OUTPUT); digitalWrite(BUZZER_PIN, HIGH);
  Wire.begin(25, 26);
  oled.setI2CAddress(0x3C << 1);
  oled.begin();
  Wire.beginTransmission(0x3C);
  if (Wire.endTransmission() != 0) {
    Serial.println("OLED not detected at 0x3C: check I2C mode / wiring / reset"); return;
  }
  oled.setFont(u8g2_font_6x12_tf);
  SPI.begin(18, 19, 23, 5); reader.PCD_Init();
  byte version = reader.PCD_ReadRegister(MFRC522::VersionReg);
  if (version == 0 || version == 0xFF) { screen("RFID error", "Check wiring"); return; }
  // Keep the existing NVS namespace so renaming the sketch preserves pending taps.
  storageReady = storage.begin("reshape-rfid", false);
  if (!storageReady) { screen("Recovery storage error", "Service scanner"); return; }
  networkDone = xQueueCreate(1, sizeof(uint8_t));
  if (!networkDone) { screen("Setup required", "Network memory error"); return; }
  restorePending(); hardwareReady = true;
  String origin(BACKEND_ORIGIN);
  configured = strlen(WIFI_SSID) && strlen(DEVICE_CREDENTIAL) == 43 &&
    String(DEVICE_ID) == "entrance-01" && origin.startsWith("https://") &&
    origin.length() > 8 && origin.indexOf('/', 8) < 0 && origin.indexOf('?') < 0 &&
    origin.indexOf('#') < 0 && origin.indexOf('@') < 0 &&
    String(BACKEND_ROOT_CA).indexOf("-----BEGIN CERTIFICATE-----") >= 0;
  if (!configured) { screen("Setup required", "See firmware README"); return; }
  WiFi.mode(WIFI_STA); WiFi.persistent(false); WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD); nextWifi = millis() + WIFI_RECONNECT_MS;
  connectingUntil = nextWifi;
  configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2); screen("Connecting", "Wi-Fi and HTTPS");
}

void loop() {
  if (expiredBeeping) {
    uint32_t elapsed = millis() - buzzerStarted;
    digitalWrite(BUZZER_PIN, expiredBeepOn(elapsed) ? LOW : HIGH);
    if (elapsed >= EXPIRED_BEEP_MS) expiredBeeping = false;
  }
  if (successBeeping) {
    uint32_t elapsed = millis() - buzzerStarted;
    digitalWrite(BUZZER_PIN, successBeepOn(elapsed) ? LOW : HIGH);
    if (elapsed >= SUCCESS_BEEP_MS) successBeeping = false;
  }
  if (!hardwareReady || !configured || storageFault) { delay(10); return; }
  serviceNetwork();
  scan();
  // Preserve deadlines across restarts using original UTC timestamp, not uptime.
  if (!networkBusy && !pendingBody.isEmpty() && clockReady()) {
    int64_t age = epochMs() - pendingAt;
    int64_t limit = pendingMode == "enrollment" ? ENROLLMENT_RETRY_MS : ATTENDANCE_RETRY_MS;
    if (age > limit || age < -5000) {
      if (!clearPending()) return;
      tapActive = false; tapUid = "";
      healthy = false; nextNetwork = millis();
      message("Could not confirm", "Check admin / use QR");
    }
  }
  bool connected = WiFi.status() == WL_CONNECTED;
  if (!connected) {
    healthy = false; wasConnected = false;
    if (due(nextWifi)) { WiFi.reconnect(); nextWifi = millis() + WIFI_RECONNECT_MS; }
    idleScreen(); delay(5); return;
  }
  if (!wasConnected) {
    wasConnected = true; healthy = false; nextNetwork = millis();
    configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2);
  }
  if (scanWaiting && due(scanWaitUntil)) {
    if (assignmentCooldown) healthy = false;
    scanWaiting = false;
    assignmentCooldown = false;
    scanWaitTitle = "";
  }
  if (clockReady() && due(nextNetwork) && !scanWaiting && !networkBusy && !cardHold.tracking) {
    if (!pendingBody.isEmpty()) submit(); else poll();
  }
  idleScreen(); delay(5);
}
