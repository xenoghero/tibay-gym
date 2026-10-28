import { collection, limit, onSnapshot, orderBy, query, Timestamp, where, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { GYM_TIME_ZONE } from "@/lib/dates";

export const REJECTION_ALERT_WINDOW_MS = 7 * 86_400_000;
export const REJECTION_ALERT_LIMIT = 50;
export interface RejectionAlertEvent {
  id: string;
  personId: string | null;
  resultCode: string;
  occurredAt: Timestamp;
  dismissedAt: Timestamp | null;
}

/** Admin-only rules protect this bounded stream; diagnostics stay separate. */
export function watchRejectedMemberTaps(onNext: (events: RejectionAlertEvent[]) => void,
  onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(db, "rfidTapEvents"),
    where("resultCode", "==", "expired-member"), where("dismissedAt", "==", null),
    where("occurredAt", ">=", Timestamp.fromMillis(Date.now() - REJECTION_ALERT_WINDOW_MS)),
    orderBy("occurredAt", "desc"), limit(REJECTION_ALERT_LIMIT)),
  (snapshot) => onNext(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as RejectionAlertEvent)), onError);
}

export function visibleRejections(events: RejectionAlertEvent[], now = Date.now()): RejectionAlertEvent[] {
  const unique = new Map<string, RejectionAlertEvent>();
  for (const event of events) {
    if (event.resultCode === "expired-member" && event.personId && event.dismissedAt == null
      && event.occurredAt.toMillis() >= now - REJECTION_ALERT_WINDOW_MS) unique.set(event.id, event);
  }
  return [...unique.values()].sort((a, b) => b.occurredAt.toMillis() - a.occurredAt.toMillis()).slice(0, REJECTION_ALERT_LIMIT);
}

export function formatRejectionTime(timestamp: Timestamp): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: GYM_TIME_ZONE, month: "short", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(timestamp.toDate());
}
