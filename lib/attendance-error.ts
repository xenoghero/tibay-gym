/** Sanitized backend/transport error; never includes a request body or SDK error. */
export class AttendanceApiError extends Error {
  constructor(message: string, public code: string, public status: number, public retryAfterSeconds?: number) {
    super(message);
    this.name = "AttendanceApiError";
  }
}
