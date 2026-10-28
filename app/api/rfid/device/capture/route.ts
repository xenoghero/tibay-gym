import { requireDevice } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody, ApiError } from "@/lib/server/rfid/http";
import { captureAssignment } from "@/lib/server/rfid/enrollment";
import { validateCapture } from "@/lib/server/rfid/validation";
import { scanAttendance } from "@/lib/server/attendance";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    const device = await requireDevice(request);
    const body = await readBody(request);
    let result;
    if (body.mode === "enrollment") result = await captureAssignment(request, body);
    else {
      const capture = validateCapture(body, device.id);
      if (capture.mode !== "attendance" || typeof body.requestedAt !== "number") throw new ApiError(400, "invalid-body");
      result = await scanAttendance({ source: "rfid", uid: capture.uid, eventId: capture.eventId, requestedAt: body.requestedAt, request });
    }
    // No person IDs, registry bindings, or private profile fields reach the OLED.
    return json({ resultCode: result.resultCode, action: result.action, assignmentId: result.assignmentId });
  }, "device-capture");
}
