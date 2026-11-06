// Tibay 2.42" OLED 4-Pin I2C Diagnostic & Display Test
// Configured specifically for 4-pin I2C modules (GND, VDD, SCL, SDA).
#include <Wire.h>
#include <U8g2lib.h>

constexpr uint8_t BUZZER_PIN = 32;
constexpr uint8_t OLED_SDA_PIN = 25;
constexpr uint8_t OLED_SCL_PIN = 26;

// 4-pin I2C constructor: reset pin is U8X8_PIN_NONE (managed internally by module)
// NONAME2 is the standard driver for 2.42" I2C OLEDs.
U8G2_SSD1309_128X64_NONAME2_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE, OLED_SCL_PIN, OLED_SDA_PIN);

uint32_t frameCount = 0;
bool i2cFound = false;

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, HIGH); // Silence active-LOW buzzer
  delay(1000);

  Serial.println("=========================================");
  Serial.println("  Tibay 2.42\" OLED 4-Pin I2C Test");
  Serial.println("=========================================");
  Serial.printf("Wiring: SDA=GPIO%d, SCL=GPIO%d\n", OLED_SDA_PIN, OLED_SCL_PIN);

  // 1. Initialize ESP32 I2C bus
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN, 100000);
  Wire.setTimeOut(50);

  // 2. Scan I2C
  Serial.print("Scanning I2C bus... ");
  for (uint8_t address = 1; address < 127; ++address) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.printf("Found device at 0x%02X! ", address);
      if (address == 0x3C || address == 0x3D) i2cFound = true;
    }
  }

  if (i2cFound) {
    Serial.println("\n[OK] Communication link confirmed at 0x3C.");
  } else {
    Serial.println("\n[FAIL] No response at 0x3C. Check 4-pin wiring.");
  }

  // 3. Initialize OLED display
  Serial.println("Initializing U8g2 SSD1309 display controller...");
  oled.setI2CAddress(0x3C << 1);
  oled.begin();
  oled.setFont(u8g2_font_6x12_tf);

  Serial.println("[OK] Initialization sent. Rendering frames to OLED now...");
}

void loop() {
  oled.clearBuffer();

  // Draw border
  oled.drawFrame(0, 0, 128, 64);
  oled.drawHLine(0, 16, 128);

  // Header
  oled.setCursor(6, 12);
  oled.print("TIBAY GYM - 4PIN OLED");

  // Content
  oled.setCursor(6, 30);
  oled.print("Status: WORKING");

  oled.setCursor(6, 44);
  oled.printf("I2C: 0x3C  SDA:%d SCL:%d", OLED_SDA_PIN, OLED_SCL_PIN);

  // Animated counter proving live refresh
  oled.setCursor(6, 58);
  oled.printf("Frame Count: #%lu", (unsigned long)++frameCount);

  oled.sendBuffer();

  Serial.printf("Frame #%lu rendered on OLED\n", (unsigned long)frameCount);
  delay(1000);
}
