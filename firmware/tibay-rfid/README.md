# Tibay ESP32 RFID scanner

This is the Phase 7 Arduino firmware to upload to the existing ESP32 Dev Module. It replaces the standalone UID-display sketch with an HTTPS client for the existing Reshape backend. It never accesses Firestore directly.

## Hardware

This sketch uses a **20×4 HD44780-compatible character LCD with an I2C backpack** (PCF8574 or MCP23008), replacing the old SSD1306 OLED. The hd44780 library detects the backpack address and pin mapping automatically; the old OLED address `0x3C` is no longer used. Status text occupies rows 1–2 and instructions occupy rows 3–4, with word wrapping and space padding to remove stale characters.

| Module | ESP32 connection |
|---|---|
| LCD SDA | GPIO 25, through a bidirectional I2C level shifter for a 5V backpack |
| LCD SCL | GPIO 26, through the same level shifter |
| LCD VCC | Supply specified by your LCD module; typical 2004 LCD/backpacks require 5V |
| LCD GND | Shared ground with ESP32 and all modules |
| RC522 SS / SCK / MOSI / MISO / RST | GPIO 5 / 18 / 23 / 19 / 27 |
| RC522 VCC | 3.3V (never 5V) |
| Active-LOW buzzer I/O | GPIO 32; retain the existing buzzer power wiring |

For a 5V LCD/backpack, use a bidirectional I2C level shifter: ESP32 SDA/SCL connect to its LV channels, LCD SDA/SCL to the corresponding HV channels, LV to 3.3V, HV to the LCD's 5V supply, and GND to shared ground. Do not connect SDA/SCL pulled up to 5V directly to ESP32 pins. Direct wiring is appropriate only when the module explicitly supports 3.3V operation and its I2C pull-ups are at 3.3V. See the [library's hardware guidance](https://github.com/duinoWitchery/hd44780#readme).

The [original hardware setup](../../documentation/plan/esp32_rfid_oled_buzzer_setup.md) remains a historical reference for the reader and buzzer; use the LCD wiring above for this sketch.

The current backend accepts only the observed four-byte UIDs, formatted `09:70:65:20` and `69:1A:71:9E`. Seven- and ten-byte UIDs are rejected. Do not broaden acceptance without actual samples and matching backend validation.

## Arduino IDE setup and upload

1. Open `firmware/tibay-rfid/tibay-rfid.ino` in Arduino IDE. Keep the folder name `tibay-rfid`, matching the sketch name.
2. In Boards Manager, install **esp32 by Espressif Systems**. This firmware is compiled against **3.3.11**, board **ESP32 Dev Module** (`esp32:esp32:esp32`).
3. In Library Manager, install **MFRC522 by GithubCommunity** (1.4.12), **hd44780 by Bill Perry** (1.3.2), and **ArduinoJson by Benoit Blanchon** (7.4.3). The sketch uses hd44780's `hd44780_I2Cexp` class; no separate LiquidCrystal library is needed. Adafruit GFX, SSD1306, and BusIO are no longer required by this sketch. Wi-Fi, HTTPS, SPI, Wire, and Preferences come with the ESP32 core.
4. Copy `scanner_config.example.h` to `scanner_config.h` in the sketch folder. Fill in Wi-Fi SSID/password, the deployed HTTPS origin, and the provisioned device credential. Use `entrance-01` as the device ID. The local configuration file is gitignored. The unchanged example compiles but displays **Setup required** and makes no requests.
5. Set `BACKEND_ROOT_CA` to the trusted root CA PEM for the actual deployed host, as described below.
6. Connect the board with a USB **data** cable. Select its current CP210x COM port; the original setup used COM10, but Windows can assign another port. Select **ESP32 Dev Module** and use its default partition scheme.
7. Click **Verify**, then **Upload**. If the board waits indefinitely for connection, hold BOOT while upload begins and release it once writing starts. Open Serial Monitor at **115200 baud**.
8. On a permitted staging backend, expect **Connecting**, then **Tap RFID**. Leave the field empty for at least three seconds before the first tap. An authorized successful poll updates the backend heartbeat at most once per minute.

If you already have a local `scanner_config.h` in the old `reshape-rfid` folder, move it beside the renamed sketch. The Preferences namespace intentionally remains `reshape-rfid` so a normal upload preserves recovery of an uncertain tap. Do not rename that namespace or erase flash during migration.

The LCD revision compiles for ESP32 Dev Module with core 3.3.11 and the library versions above: 746,164 bytes of program storage (56%) and 43,744 bytes of global RAM (13%). The two existing card-tap flow checks pass. This is compile verification; upload and physical LCD testing are still required.

Firmware/network configuration alone does not activate the backend. Provisioning defaults to disabled. Follow [server setup](../../documentation/plan/rfid-server-setup.md) for credentials and enablement. Keep production attendance disabled until the planned migration, quota check, access-boundary cutover, and physical QA are complete. This phase creates code and setup instructions; it does not flash a board or enable production.

## Certificate validation

Use the exact final deployed host, such as `https://your-host.vercel.app`, without a trailing slash, path, query, or redirect. Authentication uses `Authorization: Bearer ...` and `X-RFID-Device-Id: entrance-01`.

Inspect that host's certificate chain in a trusted browser's certificate viewer or your trusted certificate tooling. Identify the issuing chain's **root** certificate and obtain/export its Base-64 PEM from the CA's official distribution or a trusted certificate store. Verify the subject and SHA-256 fingerprint against the CA's official details. Paste the complete `-----BEGIN CERTIFICATE-----` through `-----END CERTIFICATE-----` text inside the `R"PEM(...)PEM"` literal. A `.cer` file in binary DER form must be exported as Base-64 first. Do not choose a CA merely because another Vercel domain currently uses it.

The sketch configures the trusted CA using `setCACert`; the HTTPS client checks the hostname and chain. Redirects are disabled. There is no insecure fallback. The ESP32 first obtains UTC from NTP for certificate and request-time checks; allow Wi-Fi access to the configured NTP servers. If the deployment moves to another CA, update the trust roots and reflash. The example intentionally contains no assumed certificate.

Reference: [Espressif secure-client documentation](https://github.com/espressif/arduino-esp32/blob/master/libraries/NetworkClientSecure/README.md).

## Modes, timing, and retries

| Behavior | Firmware / backend contract |
|---|---|
| Normal command polling | Every 15 seconds; first poll immediately after startup/reconnect. A newly read card in idle mode triggers an immediate command refresh before its capture, so a card tapped after the admin arms enrollment can be assigned on that same tap without waiting for the next scheduled poll. The idle LCD can still take up to 15 seconds to switch to the enrollment prompt when no card is presented. |
| Armed command polling | Every 2 seconds with backend assignment ID and UTC deadline |
| Heartbeat | Backend persists `lastSeenAt` at most once per 60 seconds; offline threshold is 180 seconds |
| Error backoff | 5 → 10 → 20 → 40 → 60 seconds; authorization/throttle errors wait 60 seconds |
| Wi-Fi reconnect | Automatic reconnect plus a bounded 15-second reconnect attempt |
| Card-removal gate | Wake halted cards every 100 ms; require three seconds of observed absence before accepting another tap |
| HTTPS requests | 5-second connect/read timeout and 5-second TLS handshake timeout; single request at a time |
| Attendance recovery | Original event only, within 30 seconds of original UTC timestamp |
| Enrollment recovery | Original event only, within 10 minutes, including after assignment deadline |
| Result display | Three seconds; a short read beep acknowledges an accepted physical tap before HTTPS, while the longer success beep still follows only a backend-confirmed assignment or check-in/out |

`GET /api/rfid/device/commands` authoritatively selects attendance or enrollment. An elapsed local enrollment deadline blocks new captures and shows timeout; it cannot turn a late enrollment tap into attendance. A subsequent attendance command releases firmware enrollment mode. If a previous assignment vanishes before its local deadline, the firmware shows **Assignment ended / See admin profile**, since the existing poll API does not say whether it was cancelled or completed elsewhere. Explicit cancelled/expired capture results have separate messages.

If the admin arms assignment while the scanner still shows **Tap RFID**, one new card tap refreshes the command first and then sends an enrollment capture with that same read UID. A failed command refresh does not send an attendance capture. Once already armed, the scanner does not reinterpret a cancelled or expired enrollment tap as attendance. Remove the card for at least three seconds before another intentional tap.

`POST /api/rfid/device/capture` sends `deviceId`, `mode`, `uid`, a random 32-hex-character `eventId`, and a UTC-millisecond `requestedAt`. Enrollment adds `assignmentId`; attendance omits it. The full exact JSON is written to Preferences/NVS **before** sending and restored after restart. A transport failure or malformed response preserves that same JSON. No new ID, timestamp, UID, or mode is substituted during recovery. Storage failure blocks scanning rather than sending an event without durable identity.

After the recovery deadline, the scanner clears the expired local request and shows **Could not confirm / Check admin / use QR**. This does not assert that the original event failed; it may have committed. Check attendance/card state in the dashboard before making another attendance action. Cards encountered offline, while awaiting a result, or before initial removal are discarded. There is no queue of historical offline taps.

For removal detection the firmware uses `PICC_WakeupA`, since a halted held card can disappear from `PICC_IsNewCardPresent()` despite still being physically present. Communication errors/collisions are not counted as removal. Time spent blocked on HTTPS is not counted as observed absence. See [the MFRC522 implementation](https://github.com/miguelbalboa/rfid/blob/master/src/MFRC522.cpp).

## LCD feedback and troubleshooting

- **Tap RFID**: authenticated online attendance mode. **Tap RFID to assign**: enrollment mode.
- **RFID assigned**, **Checked in**, **Checked out**: parsed backend-confirmed success only.
- **Membership expired**, **Unknown card**, **Card already owned**, **Assignment timeout**, **Assignment cancelled**, and **Device unauthorized**: distinct backend rejection states.
- **Connecting / Waiting for time**: NTP is not ready. Check network access; do not disable TLS verification to work around it.
- **Offline / Backend unavailable**: HTTPS, certificate, deployment, or server failure. Check the final origin, root CA, server Firebase configuration, and deployment logs. Use QR fallback.
- **Device unauthorized**: device missing, disabled, or credential revoked/incorrect. Check server provisioning, then update the local credential and reflash if rotating.
- **RFID error / Check wiring**: reader version register failed. **LCD initialization failed** in Serial: scanning stays disabled; check display power, shared ground, level shifting, and I2C pins. Run **File → Examples → hd44780 → ioClass → hd44780_I2Cexp → I2CexpDiag** if needed; set its Wire SDA/SCL to GPIO 25/26 to match this scanner. Restore the scanner sketch after diagnosis.
- **Backlight on but blank text / solid blocks**: adjust the small contrast potentiometer on the backpack. Check the backlight jumper if it remains dark. The library turns the backlight on during initialization.
- **Short beep on read**: the scanner read a new card while online; this is not proof that assignment or attendance succeeded. A second, longer beep accompanies a backend-confirmed success. Read or request failures rely on the LCD result and QR fallback.
- **Recovery storage error / Service scanner**: persistence failed or the saved event is invalid. Do not erase NVS until the last tap's backend state has been checked. Clearing flash loses recovery identity.

Serial output prints state labels only, never credentials, request bodies, card UIDs, or private profile data. Local firmware configuration and flashed credentials must stay under the owner's control. Preferences holds at most one pending request; an expired request is cleared after UTC time is available. Normal firmware upload should preserve NVS; avoid **Erase All Flash Before Sketch Upload** while a result is uncertain. Preferences is the ESP32 core's durable storage API ([Espressif documentation](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/preferences.html)).

## Physical verification still required

On a permitted staging setup, verify LCD detection/backlight/contrast, all four row positions, and long messages such as **Recovery storage error** and **Card binding conflict**. Switch from a long message to a short one and confirm no old characters remain. Also verify both known cards, leading-zero UID output, assign/replace/cancel/timeout/conflict feedback, member/guest check-in/out, expired-member rejection, held-card behavior, Wi-Fi loss/reconnect, CA rejection, credential disable/rotation, a lost committed response, and reboot during an uncertain result. Confirm that retries recover the same event and offline taps never replay. Physical QA is tracked in Phase 10 and production activation in Phase 11.
