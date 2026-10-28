#pragma once

// Copy to scanner_config.h beside tibay-rfid.ino. That file is gitignored.
// Defaults deliberately prevent networking until all fields are configured.
static const char WIFI_SSID[] = "";
static const char WIFI_PASSWORD[] = "";
static const char BACKEND_ORIGIN[] = ""; // https://your-deployed-host (no trailing slash/path)
static const char DEVICE_ID[] = "entrance-01";
static const char DEVICE_CREDENTIAL[] = ""; // 43-character secret from rfid:provision

// Install the trusted ROOT CA for the backend's actual certificate chain.
// Multiple PEM root certificates can be concatenated for a planned CA rotation.
// Never use setInsecure() or paste a server leaf certificate here.
static const char BACKEND_ROOT_CA[] = R"PEM(
)PEM";

static const char NTP_SERVER_1[] = "pool.ntp.org";
static const char NTP_SERVER_2[] = "time.cloudflare.com";
