"use client";

import { useCoach } from "./coach-shell";
import { Schedule } from "./schedule";

export default function CoachSchedulePage() {
  return <Schedule user={useCoach().user} />;
}
