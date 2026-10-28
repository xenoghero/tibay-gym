import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Person } from "./person";
import { attendanceLogConverter, type AttendanceLog } from "./attendance-log";

export interface UnverifiedPerson extends Person { address: string }

export function watchUnverifiedPersons(count: number, next: (people: UnverifiedPerson[]) => void, error: () => void) {
  return onSnapshot(query(collection(db, "unverifiedPersons"), orderBy("createdAt", "desc"), limit(count)),
    snapshot => next(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as UnverifiedPerson)), error);
}

export function watchUnverifiedVisits(personId: string, next: (visits: AttendanceLog[]) => void, error: () => void) {
  return onSnapshot(query(collection(db, "unverifiedAttendanceLogs").withConverter(attendanceLogConverter),
    where("personId", "==", personId)), snapshot => next(snapshot.docs.map(doc => doc.data())
      .sort((a, b) => b.checkInAt.toMillis() - a.checkInAt.toMillis())), error);
}
