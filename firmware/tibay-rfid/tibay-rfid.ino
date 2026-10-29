// Tibay entrance scanner. All attendance/ownership decisions belong to Vercel.
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <SPI.h>
#include <MFRC522.h>
#include <hd44780.h>
#include <hd44780ioClass/hd44780_I2Cexp.h>
#include <esp_system.h>
#include <time.h>
#include <sys/time.h>
#if __has_include("scanner_config.h")
#include "scanner_config.h"
#else
#include "scanner_config.example.h"
#endif

constexpr uint32_t REMOVAL_MS = 3000, RESULT_MS = 3000;
constexpr uint32_t ATTENDANCE_RETRY_MS = 30000, ENROLLMENT_RETRY_MS = 600000;
constexpr uint32_t NORMAL_POLL_MS = 15000, ARMED_POLL_MS = 2000;
constexpr uint32_t ASSIGNMENT_WAIT_MS = 60000;
constexpr uint32_t WIFI_RECONNECT_MS = 15000, PRESENCE_MS = 100;
constexpr uint8_t BUZZER_PIN = 32;
constexpr uint8_t LCD_COLUMNS = 20, LCD_ROWS = 4;
// Auto-detect the I2C backpack address and LCD pin mapping.
hd44780_I2Cexp lcd;
MFRC522 reader(5, 27);
Preferences storage;

String assignmentId, pendingBody, pendingMode;
int64_t assignmentDeadline = 0, pendingAt = 0;
uint32_t nextNetwork = 0, nextWifi = 0, nextPresence = 0, connectingUntil = 0;
uint32_t backoff = 5000, absenceMs = 0, lastPresence = 0, resultUntil = 0, buzzerUntil = 0;
uint32_t scanWaitUntil = 0;
bool scanWaiting = false;
String scanWaitTitle;
bool healthy = false, authorized = false, latched = true, absenceStarted = false;
bool hardwareReady = false, configured = false, wasConnected = false;
bool storageReady = false, storageFault = false;
bool backendFailed = false;
String backendDetail = "Refreshing backend";
String screenTitle, screenDetail;

bool due(uint32_t deadline) { return static_cast<int32_t>(millis() - deadline) >= 0; }
int64_t epochMs() {
  struct timeval value;
  gettimeofday(&value, nullptr);
  return static_cast<int64_t>(value.tv_sec) * 1000 + value.tv_usec / 1000;
}
bool clockReady() { return epochMs() > 1735689600000LL; }

// Reserve two physical rows per field; never rely on LCD DDRAM auto-wrapping.
void screenField(const String &text, uint8_t firstRow) {
  unsigned int offset = 0;
  for (uint8_t row = firstRow; row < firstRow + 2; ++row) {
    while (offset < text.length() && text[offset] == ' ') ++offset;
    unsigned int end = min(offset + LCD_COLUMNS, text.length());
    if (end < text.length() && text[end] != ' ') {
      unsigned int space = end;
      while (space > offset && text[space] != ' ') --space;
      if (space > offset) end = space;
    }
    lcd.setCursor(0, row);
    lcd.print(text.substring(offset, end));
    for (unsigned int column = end - offset; column < LCD_COLUMNS; ++column) lcd.print(' ');
    offset = end;
  }
}

void screen(const String &title, const String &detail = "") {
  if (title == screenTitle && detail == screenDetail) return;
  screenTitle = title; screenDetail = detail;
  screenField(title, 0);
  screenField(detail, 2);
  // Do not print request bodies, card UIDs, credentials, or person information.
  Serial.println(title);
}
void message(const String &title, const String &detail = "") {
  screen(title, detail); resultUntil = millis() + RESULT_MS;
}
void beep() { digitalWrite(BUZZER_PIN, LOW); buzzerUntil = millis() + 150; }
// A short physical-read acknowledgement is distinct from the later success beep.
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
  if (resultUntil && !due(resultUntil)) return;
  if (storageFault) { screen("Recovery storage error", "Service scanner"); return; }
  if (!authorized && healthy) { screen("Device unauthorized", "Check provisioning"); return; }
  if (!pendingBody.isEmpty()) { screen("Could not confirm", "Recovering same tap"); return; }
  if (WiFi.status() != WL_CONNECTED) {
    if (!due(connectingUntil)) screen("Connecting", "Wi-Fi and HTTPS");
    else screen("Offline", "Use QR check-in");
    return;
  }
  if (!clockReady()) { screen("Connecting", "Waiting for time"); return; }
  int32_t scanRemaining = static_cast<int32_t>(scanWaitUntil - millis());
  if (scanWaiting && scanRemaining > 0) {
    uint32_t seconds = (static_cast<uint32_t>(scanRemaining) + 999) / 1000;
    screen(scanWaitTitle, String("Next tap in ") + seconds + "s / Remove card");
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
  screen("Could not confirm", "Recovering same tap");
}

void failure(bool throttled = false) {
  healthy = false; backendFailed = true;
  nextNetwork = millis() + (throttled ? 60000 : backoff);
  backoff = min(backoff * 2, static_cast<uint32_t>(60000));
  if (!pendingBody.isEmpty()) screen("Could not confirm", "Recovering same tap");
  else screen("Backend unavailable", backendDetail);
}

// Fixed diagnostic fields only. Never print the URL, body, headers, SSID, or UID.
void networkDiagnostic(bool capture, uint32_t startedAt, int status, const char *outcome, int tlsError = 0) {
  Serial.printf("[RFID-net] op=%s status=%d elapsedMs=%lu wifi=%d rssi=%d tls=%d outcome=%s\n",
    capture ? "capture" : "commands", status, static_cast<unsigned long>(millis() - startedAt),
    static_cast<int>(WiFi.status()), static_cast<int>(WiFi.RSSI()), tlsError, outcome);
}

// Strict HTTPS, host validation, CA trust, no redirects that could leak headers.
int requestJson(const char *path, const String *body, JsonDocument &response) {
  uint32_t startedAt = millis();
  WiFiClientSecure tls; tls.setCACert(BACKEND_ROOT_CA); tls.setHandshakeTimeout(5);
  HTTPClient http; http.setConnectTimeout(5000); http.setTimeout(5000);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if (!http.begin(tls, String(BACKEND_ORIGIN) + path)) {
    backendDetail = "HTTPS setup failed";
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
    backendDetail = status == HTTPC_ERROR_READ_TIMEOUT ? "Request timed out" :
      (tlsError ? "TLS connection error" : "Connection failed");
    networkDiagnostic(body != nullptr, startedAt, status, "transport-error", tlsError);
    return status;
  }
  if (status != 200) {
    backendDetail = status == 429 ? "Rate limited / retry" : String("HTTP ") + status + " / retry";
    networkDiagnostic(body != nullptr, startedAt, status, "http-error");
    if (status == 401 || status == 403 || status == 429 || status >= 500) return status;
  }
  if (responseSize > 2048 || payload.length() > 2048) {
    backendDetail = "Response too large";
    networkDiagnostic(body != nullptr, startedAt, status, "oversized-response");
    return -1;
  }
  if (deserializeJson(response, payload)) {
    if (status == 200) backendDetail = "Invalid response";
    networkDiagnostic(body != nullptr, startedAt, status, "invalid-json");
    return -1;
  }
  if (status == 200) networkDiagnostic(body != nullptr, startedAt, status, "json-ok");
  return status;
}

void poll() {
  JsonDocument response;
  int status = requestJson("/api/rfid/device/commands", nullptr, response);
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
    nextNetwork = millis() + ARMED_POLL_MS;
  } else {
    if (!assignmentId.isEmpty()) message(epochMs() >= assignmentDeadline ? "Assignment timeout" : "Assignment ended", "See admin profile");
    // An attendance command is authoritative. A local deadline alone cannot switch modes.
    assignmentId = ""; assignmentDeadline = 0; nextNetwork = millis() + NORMAL_POLL_MS;
  }
  idleScreen();
}

void submit() {
  JsonDocument response;
  int status = requestJson("/api/rfid/device/capture", &pendingBody, response);
  if (status == 401 || status == 403) {
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
  healthy = true; authorized = true; backoff = 5000; backendFailed = false;
  backendDetail = "Refreshing backend";
  message(feedback(code), code == "retry-expired" ? "Check admin / use QR" : "Remove card");
  if (status == 200 && (code == "rfid-assigned" || code == "checked-in" || code == "checked-out")) beep();
  if (assignmentSucceeded || assignmentRejected || attendanceSucceeded) {
    // Keep the result visible during its wait interval. Do not accept
    // another tap until the wait ends and an authoritative command is fetched.
    // These assignment outcomes end enrollment on the backend; attendance
    // success already has no assignment. Only a new admin request can rearm it.
    assignmentId = ""; assignmentDeadline = 0;
    scanWaitTitle = feedback(code);
    scanWaiting = true;
    scanWaitUntil = millis() + (attendanceSucceeded ? NORMAL_POLL_MS : ASSIGNMENT_WAIT_MS);
    resultUntil = 0; healthy = false; nextNetwork = scanWaitUntil;
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

void scan() {
  if (!due(nextPresence)) return;
  nextPresence = millis() + PRESENCE_MS;
  uint32_t sampleGap = millis() - lastPresence;
  lastPresence = millis();
  byte atqa[2], size = sizeof(atqa);
  // Wake halted cards: IsNewCardPresent() alone cannot prove physical removal.
  MFRC522::StatusCode presence = reader.PICC_WakeupA(atqa, &size);
  if (presence == MFRC522::STATUS_TIMEOUT) {
    // Count only observed removal time. A blocking HTTPS request is not evidence
    // that the card remained absent during that unobserved interval.
    if (absenceStarted && sampleGap <= 250) absenceMs += sampleGap;
    absenceStarted = true;
    if (absenceMs >= REMOVAL_MS) latched = false;
    return;
  }
  absenceStarted = false; // Errors/collisions do not count as removal.
  absenceMs = 0;
  bool read = (presence == MFRC522::STATUS_OK || presence == MFRC522::STATUS_COLLISION) && reader.PICC_ReadCardSerial();
  bool canAccept = read && !latched && pendingBody.isEmpty() && !storageFault &&
    !scanWaiting &&
    healthy && authorized && clockReady() && WiFi.status() == WL_CONNECTED &&
    (!resultUntil || due(resultUntil));
  // Taps encountered offline or during recovery are discarded, never queued.
  latched = true;
  char uid[12] = {};
  if (canAccept && reader.uid.size == 4) {
    snprintf(uid, sizeof(uid), "%02X:%02X:%02X:%02X", reader.uid.uidByte[0],
      reader.uid.uidByte[1], reader.uid.uidByte[2], reader.uid.uidByte[3]);
  }
  if (read) reader.PICC_HaltA();
  reader.PCD_StopCrypto1();
  if (!canAccept) return;
  readBeep();
  if (!uid[0]) { message("Unsupported card", "Only verified 4 bytes"); return; }
  if (assignmentId.isEmpty()) {
    // The admin may have reserved enrollment since the last 15-second idle poll.
    // Refresh before choosing the mode for this same physical tap.
    poll();
    if (!healthy || !authorized) return;
  }
  if (!assignmentId.isEmpty() && epochMs() >= assignmentDeadline) {
    message("Assignment timeout", "Waiting for backend"); nextNetwork = millis(); return;
  }
  JsonDocument capture;
  pendingMode = assignmentId.isEmpty() ? "attendance" : "enrollment";
  pendingAt = epochMs();
  capture["mode"] = pendingMode; capture["deviceId"] = DEVICE_ID;
  capture["uid"] = uid; capture["eventId"] = eventId(); capture["requestedAt"] = pendingAt;
  if (pendingMode == "enrollment") capture["assignmentId"] = assignmentId;
  serializeJson(capture, pendingBody);
  // Write-ahead persistence: a power loss after POST must retain exact identity.
  if (storage.putString("pending", pendingBody) != pendingBody.length() ||
      storage.getString("pending", "") != pendingBody) {
    storageFault = true; screen("Recovery storage error", "Service scanner");
  } else { screen("Confirming", "Please wait"); nextNetwork = millis(); }
}

void setup() {
  Serial.begin(115200); pinMode(BUZZER_PIN, OUTPUT); digitalWrite(BUZZER_PIN, HIGH);
  Wire.begin(25, 26);
  if (lcd.begin(LCD_COLUMNS, LCD_ROWS) != 0) {
    Serial.println("LCD initialization failed: check wiring / run I2CexpDiag"); return;
  }
  SPI.begin(18, 19, 23, 5); reader.PCD_Init();
  byte version = reader.PCD_ReadRegister(MFRC522::VersionReg);
  if (version == 0 || version == 0xFF) { screen("RFID error", "Check wiring"); return; }
  // Keep the existing NVS namespace so renaming the sketch preserves pending taps.
  storageReady = storage.begin("reshape-rfid", false);
  if (!storageReady) { screen("Recovery storage error", "Service scanner"); return; }
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
  if (buzzerUntil && due(buzzerUntil)) { digitalWrite(BUZZER_PIN, HIGH); buzzerUntil = 0; }
  if (!hardwareReady || !configured || storageFault) { delay(10); return; }
  scan();
  // Preserve deadlines across restarts using original UTC timestamp, not uptime.
  if (!pendingBody.isEmpty() && clockReady()) {
    int64_t age = epochMs() - pendingAt;
    int64_t limit = pendingMode == "enrollment" ? ENROLLMENT_RETRY_MS : ATTENDANCE_RETRY_MS;
    if (age > limit || age < -5000) {
      if (!clearPending()) return;
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
  if (clockReady() && due(nextNetwork) && (!scanWaiting || due(scanWaitUntil))) {
    if (!pendingBody.isEmpty()) submit(); else poll();
  }
  idleScreen(); delay(5);
}
