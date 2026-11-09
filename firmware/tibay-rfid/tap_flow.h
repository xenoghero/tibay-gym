#pragma once
#include <stdint.h>

constexpr uint32_t CARD_HOLD_MS = 400, GREETING_MS = 600, VERIFY_LIMIT_MS = 10000;
constexpr uint32_t SUCCESS_BEEP_MS = 210;
constexpr uint32_t EXPIRED_BEEP_MS = 490;
constexpr bool expiredBeepOn(uint32_t elapsed) {
  return elapsed < EXPIRED_BEEP_MS && elapsed % 140 < 70;
}
constexpr bool successBeepOn(uint32_t elapsed) {
  return elapsed < 70 || (elapsed >= 140 && elapsed < SUCCESS_BEEP_MS);
}

struct CardHold {
  uint32_t uid = 0, observedMs = 0, lastSample = 0;
  bool tracking = false;

  constexpr void reset() { tracking = false; observedMs = 0; }
  constexpr bool observe(uint32_t now, uint32_t card) {
    uint32_t gap = now - lastSample;
    if (!tracking || card != uid || gap > 250) {
      observedMs = 0;
      tracking = true;
    } else {
      observedMs += gap;
    }
    uid = card;
    lastSample = now;
    return observedMs >= CARD_HOLD_MS;
  }
};

enum class TapPhase { Greeting, Verifying, Delayed };
constexpr TapPhase tapPhase(uint32_t elapsed) {
  return elapsed < GREETING_MS ? TapPhase::Greeting :
    elapsed < VERIFY_LIMIT_MS ? TapPhase::Verifying : TapPhase::Delayed;
}
