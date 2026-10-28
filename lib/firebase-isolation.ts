// Shared validation only; callers pass explicit env values so Next can inline public settings.
export const ISOLATED_FIREBASE_PROJECT = "demo-reshape-attendance";

export function emulatorAddress(value: string | undefined): { host: string; port: number } {
  const match = /^(localhost|127\.0\.0\.1):(\d{1,5})$/.exec(value ?? "");
  const port = Number(match?.[2]);
  if (!match || port < 1 || port > 65535) {
    throw new Error("Isolated Firebase requires a loopback emulator host:port");
  }
  return { host: match[1], port };
}

export function assertIsolatedFirebase(projectId: string | undefined, firestore: string | undefined,
  auth: string | undefined): void {
  if (projectId !== ISOLATED_FIREBASE_PROJECT) {
    throw new Error("Isolated Firebase requires the demo-reshape-attendance project");
  }
  emulatorAddress(firestore);
  emulatorAddress(auth);
}
