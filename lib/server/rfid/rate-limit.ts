import "server-only";
import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/server/firebase-admin";
import { ApiError } from "./http";

// Fixed paths per trusted scope; no caller-supplied IDs can grow the collection.
// TTL removes inactive buckets. A transaction coordinates all Vercel instances.
export async function throttle(scope: string, limit: number): Promise<void> {
  const ref = adminDb().collection("rfidRateLimits").doc(createHash("sha256").update(scope).digest("hex"));
  const accepted = await adminDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const now = Date.now();
    const window = Math.floor(now / 60_000);
    const data = snapshot.data();
    const count = data?.window === window ? data.count : 0;
    if (count >= limit) return false;
    tx.set(ref, { window, count: count + 1, retainUntil: Timestamp.fromMillis(now + 86_400_000) });
    return true;
  });
  if (!accepted) throw new ApiError(429, "rate-limited");
}
