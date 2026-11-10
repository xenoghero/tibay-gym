# Tibay ESP32 RFID scanner

This is the Phase 7 Arduino firmware to upload to the existing ESP32 Dev Module. It replaces the standalone UID-display sketch with an HTTPS client for the existing Reshape backend. It never accesses Firestore directly.

## Hardware

This sketch uses a **2.42-inch 128×64 SSD1309 OLED configured for I2C**, replacing the 20×4 character LCD. U8g2 renders two word-wrapped lines for status and two for instructions in a 6×12 font (21 characters per line). Each update clears and redraws the framebuffer so old text does not remain.

The installed board's photos appear to show a **four-pin I2C variant**, labeled GND, VDD, SCK, SDA. For that version, connect only GND → GND, VDD → 3V3 (subject to the module's rating), SCK → GPIO 26, and SDA → GPIO 25. There are no external RES/DC/CS pins to connect. The extra control-pin connections below apply only to seven-pin variants. The controller and address of the installed board still need confirmation; board size alone does not identify them.

| Module | ESP32 connection |
|---|---|
| OLED SDA / D1 | GPIO 25, direct 3.3V logic |
| OLED SCL / D0 | GPIO 26, direct 3.3V logic |
| OLED VCC | ESP32 **3V3**, provided your exact module supports 3.3V input |
| OLED GND | Shared ground with ESP32 and all modules |
| OLED RES / RST | GPIO 33; firmware resets the display at startup |
| OLED DC / A0 | GND, selecting 7-bit I2C address `0x3C` |
| OLED CS | GND for I2C operation |
| RC522 SS / SCK / MOSI / MISO / RST | GPIO 5 / 18 / 23 / 19 / 27 |
| RC522 VCC | 3.3V (never 5V) |
| Active-LOW buzzer I/O | GPIO 32; retain the existing buzzer power wiring |

Power off before rewiring. Remove the old 5V LCD connection and its level shifter from the display path; keep OLED signals and pull-ups at 3.3V. Comparable [SSD1309 modules support 3.3V input](https://www.lcdwiki.com/res/MSP242X/2.42inch_OLED_SPI_IIC_Module_MSP242X_User_Manual_EN.pdf), but the seller photo does not confirm this exact board's rating. Check its markings/specification before applying power; do not assume 5V tolerance from the controller name.

This firmware requires the module to be configured for I2C. Seven pins alone do not establish its interface mode: follow the exact board's jumper instructions. On the referenced LCDWIKI board, I2C uses R4/R9 fitted and R5 removed; other boards can differ. DC high selects `0x3D` instead; this sketch expects DC grounded at `0x3C` (U8g2 receives the shifted address `0x78`). Use the labels rather than assuming header order. See [U8g2's SSD1309 driver](https://github.com/olikraus/u8g2/blob/master/cppsrc/U8g2lib.h).

The original reader and buzzer wiring remains unchanged; use the OLED wiring above for this sketch. The separate `tibay-lcd-diag` sketch is historical and applies only to the old character LCD.

The current backend accepts only the observed four-byte UIDs, formatted `09:70:65:20` and `69:1A:71:9E`. Seven- and ten-byte UIDs are rejected. Do not broaden acceptance without actual samples and matching backend validation.

## Arduino IDE setup and upload

1. Open `firmware/tibay-rfid/tibay-rfid.ino` in Arduino IDE. Keep the folder name `tibay-rfid`, matching the sketch name.
2. In Boards Manager, install **esp32 by Espressif Systems**. This firmware is compiled against **3.3.11**, board **ESP32 Dev Module** (`esp32:esp32:esp32`).
3. In Library Manager, install **MFRC522 by GithubCommunity** (1.4.12), **U8g2 by oliver** (2.36.19), and **ArduinoJson by Benoit Blanchon** (7.4.3). hd44780, Adafruit GFX, SSD1306, and BusIO are not needed by this sketch. Wi-Fi, HTTPS, SPI, Wire, and Preferences come with the ESP32 core.
4. Copy `scanner_config.example.h` to `scanner_config.h` in the sketch folder. Fill in Wi-Fi SSID/password, the deployed HTTPS origin, and the provisioned device credential. Use `entrance-01` as the device ID. The local configuration file is gitignored. The unchanged example compiles but displays **Setup required** and makes no requests.
5. Set `BACKEND_ROOT_CA` to the trusted root CA PEM for the actual deployed host, as described below.
6. Connect the board with a USB **data** cable. Select its current CP210x COM port; the original setup used COM10, but Windows can assign another port. Select **ESP32 Dev Module** and use its default partition scheme.
7. Click **Verify**, then **Upload**. If the board waits indefinitely for connection, hold BOOT while upload begins and release it once writing starts. Open Serial Monitor at **115200 baud**.
8. On a permitted staging backend, expect **Connecting**, then **Tap RFID**. Leave the field empty for at least 400 ms and wait for the tap prompt before holding the first card in range for 400 ms. An authorized successful poll updates the backend heartbeat at most once per minute.

If you already have a local `scanner_config.h` in the old `reshape-rfid` folder, move it beside the renamed sketch. The Preferences namespace intentionally remains `reshape-rfid` so a normal upload preserves recovery of an uncertain tap. Do not rename that namespace or erase flash during migration.

The stable-hold/greeting revision compiles for ESP32 Dev Module with core 3.3.11 and U8g2 2.36.19: 1,109,864 bytes of program storage (84%) and 51,568 bytes of global RAM (15%). The HTTPS worker additionally allocates a 12,288-byte task stack at runtime. All 71 RFID/backend, firmware-flow, and card-control polling tests pass, along with the compile-time hold, timing, and double-beep assertions in `tap_flow_checks.cpp`. Upload and physical OLED testing are still required. Verify long statuses, countdowns, animation, and switching from long text to short text on the actual display.

Firmware/network configuration alone does not activate the backend. Provisioning defaults to disabled. Follow [server setup](../../documentation/plan/rfid-server-setup.md) for credentials and enablement. Keep production attendance disabled until the planned migration, quota check, access-boundary cutover, and physical QA are complete. This phase creates code and setup instructions; it does not flash a board or enable production.

## Certificate validation

Use the exact final deployed host, such as `https://your-host.vercel.app`, without a trailing slash, path, query, or redirect. Authentication uses `Authorization: Bearer ...` and `X-RFID-Device-Id: entrance-01`.

Inspect that host's certificate chain in a trusted browser's certificate viewer or your trusted certificate tooling. Identify the issuing chain's **root** certificate and obtain/export its Base-64 PEM from the CA's official distribution or a trusted certificate store. Verify the subject and SHA-256 fingerprint against the CA's official details. Paste the complete `-----BEGIN CERTIFICATE-----` through `-----END CERTIFICATE-----` text inside the `R"PEM(...)PEM"` literal. A `.cer` file in binary DER form must be exported as Base-64 first. Do not choose a CA merely because another Vercel domain currently uses it.

The sketch configures the trusted CA using `setCACert`; the HTTPS client checks the hostname and chain. Redirects are disabled. There is no insecure fallback. The ESP32 first obtains UTC from NTP for certificate and request-time checks; allow Wi-Fi access to the configured NTP servers. If the deployment moves to another CA, update the trust roots and reflash. The example intentionally contains no assumed certificate.

Reference: [Espressif secure-client documentation](https://github.com/espressif/arduino-esp32/blob/master/libraries/NetworkClientSecure/README.md).

## Modes, timing, and retries

| Behavior | Firmware / backend contract |
|---|---|
| Background command polling | Every 60 seconds in both attendance and enrollment, matching backend `pollAfterMs`. First poll is immediate at startup/reconnect, except while a result cooldown is active. A deliberate stable card tap in attendance mode still refreshes the command immediately before capture; this is an event-driven request, not background polling. Without a card tap, discovering an admin assignment can take up to 60 seconds. |
| Admin card controls | Visible member profiles refresh every 60 seconds while idle. An active assignment gets 5-second status checks only until its authoritative expiry; completing/cancelling it returns to minute polling. Hidden pages make no periodic status requests. The attendance dashboard retains its separate Firestore live listeners. |
| Heartbeat | Backend persists `lastSeenAt` at most once per 60 seconds; offline threshold is 180 seconds |
| Error backoff | 5 → 10 → 20 → 40 → 60 seconds; authorization/throttle errors wait 60 seconds |
| Wi-Fi reconnect | Automatic reconnect plus a bounded 15-second reconnect attempt |
| Card acceptance | Require the same four-byte UID across 400 ms of observed presence before greeting or beeping. Removal, a failed read, a changed UID, or an observation gap over 250 ms resets the hold. An in-flight idle poll must finish first. RFID proximity does not prove physical contact. |
| Foreground verification | Start the 10-second budget when the hold is accepted. Show **WELCOME BACK, KA-TIBAY!** with the short beep for 600 ms while command refresh/capture begins. Show animated **VERIFYING / Contacting server / Please hold still** only while still waiting; display confirmed results immediately after the greeting. At 10 seconds, switch to delayed-confirmation guidance; an already-sent capture keeps its original identity and safe recovery. A command refresh that finishes after the budget cannot create a capture for the abandoned tap. |
| Card-removal gate | Wake halted cards every 100 ms; require 400 ms of observed absence before accepting another tap |
| HTTPS requests | One worker task runs a single request at a time, with the existing 5-second connect/read and TLS-handshake timeouts. The main loop continues drawing, sampling card presence, and enforcing the foreground deadline. |
| Attendance recovery | Original event only, within 30 seconds of original UTC timestamp |
| Enrollment recovery | Original event only, within 10 minutes, including after assignment deadline |
| Attendance result | Confirmed **Checked in** and **Checked out** retain the 3-second countdown and observed card-removal requirement. The next deliberate card tap refreshes the command immediately; routine background polling resumes on the 60-second schedule. |
| Assignment result and lockout | Confirmed **RFID assigned**, or **Card already owned** during enrollment, starts a 60-second scanner-wide cooldown. The outcome stays visible for the first 3 seconds, followed by **PLEASE REMOVE CARD / Next tap in Ns / All RFID taps paused** for the remaining time. All new RFID taps, including attendance, are discarded; the countdown generates no network requests. At expiry, a successful command refresh and card removal are required before readiness. Wi-Fi reconnect cannot shorten the wait. This local wait resets on restart. |
| Buzzer | One short 45 ms beep acknowledges stable card detection. Backend-confirmed assignment, check-in, and check-out use two 70 ms beeps separated by a 70 ms silent gap. Success tones run in the main loop without a blocking delay; rejection and transport errors never play them. |

`GET /api/rfid/device/commands` authoritatively selects attendance or enrollment. An elapsed local enrollment deadline blocks new captures and shows timeout; it cannot turn a late enrollment tap into attendance. A subsequent attendance command releases firmware enrollment mode. If a previous assignment vanishes before its local deadline, the firmware shows **Assignment ended / See admin profile**, since the existing poll API does not say whether it was cancelled or completed elsewhere. Explicit cancelled/expired capture results have separate messages.

If the admin arms assignment while the scanner still shows **Tap RFID**, one new card tap refreshes the command first and then sends an enrollment capture with that same read UID. A failed command refresh does not send an attendance capture. Once already armed, the scanner does not reinterpret a cancelled or expired enrollment tap as attendance. Remove the card for at least 400 ms, wait for the result countdown to end, then hold the next card in range for 400 ms.

`POST /api/rfid/device/capture` sends `deviceId`, `mode`, `uid`, a random 32-hex-character `eventId`, and a UTC-millisecond `requestedAt`. Enrollment adds `assignmentId`; attendance omits it. The full exact JSON is written to Preferences/NVS **before** sending and restored after restart. A transport failure or malformed response preserves that same JSON. No new ID, timestamp, UID, or mode is substituted during recovery. Storage failure blocks scanning rather than sending an event without durable identity.

After the recovery deadline, the scanner clears the expired local request and shows **NOT CONFIRMED / Check admin / use QR**. This does not assert that the original event failed; it may have committed. Check attendance/card state in the dashboard before making another attendance action. Cards encountered offline, while awaiting a result, or before initial removal are discarded. There is no queue of historical offline taps.

For removal detection the firmware uses `PICC_WakeupA`, since a halted held card can disappear from `PICC_IsNewCardPresent()` despite still being physically present. Communication errors/collisions are not counted as removal. Time spent blocked on HTTPS is not counted as observed absence. See [the MFRC522 implementation](https://github.com/miguelbalboa/rfid/blob/master/src/MFRC522.cpp).

## OLED feedback and troubleshooting

The welcome screen uses a 40×28, one-bit version of the site's Tibay Gym mark (`public/tibay-gym-mark-transparent.svg`), stored in `tibay_logo.h` as a 140-byte flash bitmap. Both yellow and silver artwork become lit pixels on the monochrome OLED. The logo stays steady while small side accents animate; the welcome heading and tap instruction remain visible.

To test detection independently, open `firmware/tibay-oled-diag/tibay-oled-diag.ino`, select ESP32 Dev Module, and upload it. This temporarily replaces the scanner application; it makes no network requests and does not erase its Preferences storage. Open Serial Monitor at **115200 baud** and press EN/RESET. It scans SDA 25 / SCL 26 every three seconds, reporting all responding addresses and bus errors. **This detection-only sketch leaves the OLED dark.** An ACK at `0x3C` or `0x3D` establishes I2C communication, not the controller type or pixel operation. No ACK means power, wiring, address-mode hardware, or the bus needs investigation before changing the graphics driver. A persistent LOW idle line can indicate a short, swapped connection, missing pull-ups, or a device holding the bus. If using a multimeter, check voltage at the OLED VDD/GND pins, not only at the ESP32. Restore the scanner sketch after diagnosis.

- **Tap RFID**: authenticated online attendance mode, with the card-removal gate clear and the scanner ready to accept a physical tap. **Tap RFID to assign**: enrollment mode with that same readiness requirement. Backend connectivity does not guarantee a later request will succeed.
- **Getting ready / Remove card / Wait Ns**: startup or between-tap removal check. Keep the reader empty for 400 ms of observed absence. The countdown progresses only while absence is observed; holding a card or reader communication errors prevent readiness. Neither tap prompt appears until this gate clears.
- **RFID assigned**, **Checked in**, **Checked out**: parsed backend-confirmed success only.
- **TAKING LONGER / Please ask front desk / No need to tap again**: the 10-second foreground budget ended while a capture was uncertain. The scanner safely completes/retries that same request without accepting another tap. A late confirmed result is still displayed. If recovery expires, **NOT CONFIRMED / Check admin / use QR** asks the customer to seek help. A rebooted pending request uses **PLEASE WAIT / Checking your card / No need to tap again** while recovering.
- **Checked in / Next tap in Ns** or **Checked out / Next tap in Ns**: attendance succeeded. Remove the card and wait for the 3-second countdown and refreshed tap prompt before the next customer taps. This scanner-wide wait does not change the backend's separate per-person attendance cooldown.
- **CARD LINKED! / Ready for gym visits**: assignment succeeded. After three seconds this changes to the scanner-wide cooldown screen. Wait the full 60 seconds from confirmation and the refreshed tap prompt before the next card, including attendance. A restart clears the local wait and performs the normal startup command refresh and removal check.
- **Card already owned / Next tap in Ns / Remove card**: the tapped card belongs to another profile. The backend ends that enrollment attempt and clears its active assignment; the firmware clears its local assignment and blocks all RFID taps for 60 seconds before refreshing commands. The scanner then returns to normal **Tap RFID** attendance mode unless the admin has explicitly started a new assignment. Start **Assign Card** or **Replace Card** again to try an available card. Waiting does not release the card from its existing owner.
- **Membership expired**, **Unknown card**, **Card already owned**, **Assignment timeout**, **Assignment cancelled**, and **Device unauthorized**: distinct backend rejection states.
- **MEMBERSHIP / EXPIRED**: a backend-confirmed expired-member rejection shows a brief warning-icon entrance and gentle halo pulse for five seconds, with **Please renew at desk / Attendance not recorded** kept steady. Four short 70 ms beeps, separated by 70 ms gaps, accompany this rejection; the success double beep does not play. New taps are blocked during the prompt, and card removal is required before scanning resumes. The backend preserves attendance logs, visit counters, and check-in/out state; only the rejection audit and recovery receipt are saved. Verify timing, text fit, and sound on the physical scanner after upload.
- **Connecting / Waiting for time**: NTP is not ready. Check network access; do not disable TLS verification to work around it.
- **Connecting / Refreshing backend**: scanning is paused while fetching an authoritative command, including after a tap result or the assignment countdown. This state does not itself indicate a failed request.
- **Backend unavailable**: a request actually failed. The detail distinguishes **Request timed out**, **Connection failed**, **TLS connection error**, **HTTP N / retry**, **Rate limited / retry**, **Invalid response**, **Invalid command**, or **Invalid capture result**. Check Serial diagnostics below before changing Wi-Fi or backend settings. **Offline / Use QR check-in** means Wi-Fi is disconnected.
- **Device unauthorized**: device missing, disabled, or credential revoked/incorrect. Check server provisioning, then update the local credential and reflash if rotating.
- **RFID error / Check wiring**: reader version register failed. **OLED not detected at 0x3C** in Serial: scanning stays disabled; check 3.3V power, shared ground, I2C mode, SDA/SCL, RES on GPIO 33, DC grounded, and CS grounded. An I2C acknowledgement confirms a responding device, not that pixels are visible; verify the display physically.
- **Backlight on but blank text / solid blocks**: adjust the small contrast potentiometer on the backpack. Check the backlight jumper if it remains dark. The library turns the backlight on during initialization.
- **WELCOME BACK, KA-TIBAY! + short beep**: the same supported card remained in reading range for 400 ms. This is a general greeting, not verified identity or successful attendance. The 600 ms greeting overlaps HTTPS work. If confirmation is still pending, animated **VERIFYING / Contacting server / Please hold still** follows. A double beep accompanies a backend-confirmed success. In known enrollment mode, **CARD DETECTED / Please wait**, then **LINKING CARD / No need to tap again**, replace the attendance greeting and verification screens.
- **Recovery storage error / Service scanner**: persistence failed or the saved event is invalid. Do not erase NVS until the last tap's backend state has been checked. Clearing flash loses recovery identity.

Serial output prints state labels and the fixed network diagnostic fields described below, never credentials, request bodies, card UIDs, or private profile data. Local firmware configuration and flashed credentials must stay under the owner's control. Preferences holds at most one pending request; an expired request is cleared after UTC time is available. Normal firmware upload should preserve NVS; avoid **Erase All Flash Before Sketch Upload** while a result is uncertain. Preferences is the ESP32 core's durable storage API ([Espressif documentation](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/preferences.html)).

## Network diagnostics

Open Serial Monitor at **115200 baud** and copy the `[RFID-net]` lines around a failure. Each request reports `op` (commands/capture), raw HTTP/transport `status`, total `elapsedMs` including reading the body, numeric Wi-Fi status, `rssi` in dBm, numeric TLS error, and a fixed outcome label. These diagnostics exclude URLs, SSIDs, headers, bodies, card UIDs, and credentials. A `json-ok` outcome means the body parsed; a following `invalid-command` or `invalid-result` line means its required fields were missing.

- `status=-11` indicates an HTTP read timeout. `status=-1` is a connection failure and can include DNS, TCP, or TLS problems; a nonzero `tls` code provides more detail. TLS handshake failures can also exhaust the separate five-second handshake timeout.
- `status=429` is backend throttling; `status=500` or higher is a server/gateway error. Neither is proof of weak Wi-Fi. Match command/capture failures with backend `integration-request` metrics (`operation`, `status`, `durationMs`) to separate server processing from transport delay.
- `status=200` with `invalid-json` can indicate a malformed or incomplete body. The existing five-second connect/read timeouts remain unchanged; collect timings before deciding whether to raise them.
- Compare `rssi` and `elapsedMs` across successful and failed requests on the physical scanner. Measurements from a desktop do not establish the scanner's Wi-Fi quality. Retries keep the existing backoff and the same durable pending event.

## Physical verification still required

Briefly pass a card through range for less than 400 ms: there must be no greeting, beep, or request. Remove a card partway through the hold and switch UIDs: each new hold must start from zero. Hold one card steadily: the greeting and short beep begin together, with networking already running during the 600 ms greeting. On a slow staging response, verify the dots keep moving and delayed-confirmation guidance appears at 10 seconds from acceptance, without a replacement event or false success. Check both a slow command refresh (no late capture) and a slow/lost capture response (same event safely recovered). Check that a fast success proceeds directly from the greeting to **CHECKED IN! / Tara buhat na!** with the three-second countdown.

Boot with the reader empty and confirm no tap prompt appears before both the first authenticated command refresh and the 400 ms removal check complete. Boot with a card held on the reader: the display must stay on **Getting ready** until the card is removed and 400 ms of absence are observed. Tap once after **Tap RFID** appears and hold it for 400 ms and confirm the greeting and beep begin together. Repeat in enrollment mode and after a normal attendance result; a held card must not show a ready prompt or create another event.

After successful check-in and check-out, verify **Next tap in 3s** counts down while retaining the result title. Present a different customer's card during the wait and confirm it is discarded without another capture. Remove it, wait for the refreshed tap prompt, and confirm the next deliberate tap works. Check a Wi-Fi reconnect during the countdown: it must not shorten the wait. Assignment success/owned-card rejection must instead block all RFID taps and routine network requests for 60 seconds.

After a successful assignment and after a **Card already owned** enrollment result, verify that the outcome remains visible for three seconds, then the remaining portion of the 60-second lockout counts down once per second, and returns to normal **Tap RFID** after the wait when no new assignment has been started. For a rejected owned card, confirm the dashboard shows the attempt ended, no active reservation remains, and the card's existing owner is unchanged. A new enrollment must require an explicit **Assign Card** or **Replace Card** action. Replaying a lost rejection response must not reactivate the old assignment or clear a newer one. Try another card during the countdown and confirm that it causes no capture. Present an attendance card during this wait and confirm it causes no capture, beep, or command refresh. Confirm serial diagnostics show no routine command polling until expiry. Also check Wi-Fi loss/reconnect during the wait and a failed command refresh at the end: scanning must resume only after a successful command refresh.

On a permitted staging setup, verify OLED detection/reset, all four text positions, and long messages such as **Recovery storage error** and **Card binding conflict**. Switch from a long message to a short one and confirm no old characters remain. Also verify both known cards, leading-zero UID output, assign/replace/cancel/timeout/conflict feedback, member/guest check-in/out, expired-member rejection, held-card behavior, Wi-Fi loss/reconnect, CA rejection, credential disable/rotation, a lost committed response, and reboot during an uncertain result. Confirm that retries recover the same event and offline taps never replay. Physical QA is tracked in Phase 10 and production activation in Phase 11.
