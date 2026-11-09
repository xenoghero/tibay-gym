#include "tap_flow.h"

constexpr bool stableCardChecks() {
  CardHold hold;
  if (hold.observe(0, 1) || hold.observe(100, 1) || hold.observe(200, 1) ||
      hold.observe(300, 1) || !hold.observe(400, 1)) return false;
  hold.reset(); // Moving away cancels the partially observed hold.
  if (hold.observe(500, 1) || hold.observe(600, 1)) return false;
  if (hold.observe(700, 2) || hold.observe(800, 2) || hold.observe(900, 2) ||
      hold.observe(1000, 2) || !hold.observe(1100, 2)) return false;
  if (hold.observe(1400, 2)) return false; // A blocked interval is not observed presence.
  hold.reset();
  return !hold.observe(UINT32_MAX - 199, 1) && !hold.observe(UINT32_MAX - 99, 1) &&
    !hold.observe(0, 1) && !hold.observe(100, 1) && hold.observe(200, 1);
}
static_assert(stableCardChecks(), "Card hold must require 400 ms of the same observed card");
static_assert(tapPhase(0) == TapPhase::Greeting && tapPhase(599) == TapPhase::Greeting);
static_assert(tapPhase(600) == TapPhase::Verifying && tapPhase(9999) == TapPhase::Verifying);
static_assert(tapPhase(10000) == TapPhase::Delayed);
static_assert(successBeepOn(0) && successBeepOn(69));
static_assert(!successBeepOn(70) && !successBeepOn(139));
static_assert(successBeepOn(140) && successBeepOn(209));
static_assert(!successBeepOn(210) && !successBeepOn(10000));
constexpr bool expiredBeepChecks() {
  for (uint32_t elapsed = 0; elapsed < 1000; ++elapsed) {
    bool expected = elapsed < 70 || (elapsed >= 140 && elapsed < 210) ||
      (elapsed >= 280 && elapsed < 350) || (elapsed >= 420 && elapsed < 490);
    if (expiredBeepOn(elapsed) != expected) return false;
  }
  return !expiredBeepOn(UINT32_MAX);
}
static_assert(expiredBeepChecks(), "Expired membership must sound exactly four 70 ms beeps");
