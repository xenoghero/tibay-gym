import type { Timestamp } from "firebase-admin/firestore";

// Stored document bodies; IDs belong to document paths, never mutable fields.
export const RFID_COLLECTIONS = {
  cards: "rfidCards", assignments: "rfidAssignments", devices: "rfidDevices",
  attendanceState: "attendanceState", results: "scanResults",
  tapEvents: "rfidTapEvents", cardChanges: "rfidCardChanges",
} as const;
export const ENTRANCE_DEVICE_ID = "entrance-01";
export type ScanAction = "checked-in" | "checked-out";
export type AssignmentOperation = "assign" | "replace";
export interface RfidCard {
  personId: string;
  assignedAt: Timestamp;
  updatedAt: Timestamp;
  assignedBy: string;
}
export interface RfidAssignment {
  personId: string;
  deviceId: string;
  operation: AssignmentOperation;
  expectedPreviousUid: string | null;
  status: "pending" | "completed" | "cancelled" | "expired";
  capturedUid: string | null;
  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  completedAt: Timestamp | null;
  lastErrorCode: string | null;
}
export interface RfidDevice {
  label: string;
  enabled: boolean;
  credentialHash: string;
  activeAssignmentId: string | null;
  lastSeenAt: Timestamp | null;
  firmwareVersion: string | null;
  updatedAt: Timestamp;
}
export interface AttendanceState {
  openLogId: string | null;
  lastAcceptedScanAt: Timestamp | null;
  lastAction: ScanAction | null;
  lastLogId?: string | null;
  updatedAt: Timestamp;
}
export interface ScanResult {
  origin: string;
  eventId: string;
  requestFingerprint: string;
  requestedAt: Timestamp;
  resultCode: string;
  action: ScanAction | null;
  logId: string | null;
  personId: string | null;
  assignmentId: string | null;
  processedAt: Timestamp;
  retainUntil: Timestamp;
}
export interface RfidTapEvent {
  deviceId: string;
  personId: string | null;
  resultCode: "expired-member" | "unknown-card" | "enrollment-active" | "person-unavailable";
  effectiveStatusAtTap: "active" | "expired" | null;
  occurredAt: Timestamp;
  dismissedAt: Timestamp | null;
  attendanceLogId: null;
  retainUntil: Timestamp;
}
export interface RfidCardChange {
  personId: string;
  operation: AssignmentOperation | "remove";
  previousUid: string | null;
  newUid: string | null;
  assignmentId: string | null;
  adminUid: string;
  occurredAt: Timestamp;
  retainUntil: Timestamp;
}

// A separate projection permits availability listeners without exposing secrets.
export interface RfidDeviceStatus {
  label: string;
  enabled: boolean;
  lastSeenAt: Timestamp | null;
  updatedAt: Timestamp;
}
