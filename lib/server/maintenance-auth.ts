import "server-only";
import { timingSafeEqual } from "node:crypto";
import { requireAdmin } from "./rfid/auth";

/** Scheduled maintenance and the existing interactive admin controls share the same protected work. */
export async function requireMaintenanceCaller(request: Request): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (secret && secret.length >= 20) {
    const expected = Buffer.from(`Bearer ${secret}`);
    const supplied = Buffer.from(request.headers.get("authorization") ?? "");
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return;
  }
  await requireAdmin(request);
}
