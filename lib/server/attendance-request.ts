import "server-only";
import { ApiError } from "./rfid/http";
import { isCheckinPhone } from "../checkin-phone";

export function attendancePhone(value: unknown): string {
  if (!isCheckinPhone(value)) throw new ApiError(400, "invalid-body");
  return value;
}

export function attendanceText(value: unknown, max: number, optional = false): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > max) throw new ApiError(400, "invalid-body");
  return value.trim();
}

export function onlyFields(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, "invalid-body");
}

export function attendanceIntent(value: unknown): "attendance" | "checkout" {
  if (value === undefined || value === "attendance") return "attendance";
  if (value === "checkout") return "checkout";
  throw new ApiError(400, "invalid-intent");
}
