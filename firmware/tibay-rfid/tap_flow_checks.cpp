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
