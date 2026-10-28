import { approveUnverified, deleteUnverified } from "@/lib/server/unverified";
import { onlyFields } from "@/lib/server/attendance-request";
import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { documentId } from "@/lib/server/rfid/validation";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    const adminUid = await requireAdmin(request);
    const body = await readBody(request, 16_384);
    onlyFields(body, ["operation", "personIds"]);
    if (body.operation !== "approve" && body.operation !== "delete") throw new ApiError(400, "invalid-operation");
    if (!Array.isArray(body.personIds) || body.personIds.length < 1 || body.personIds.length > 50 ||
        (body.operation === "approve" && body.personIds.length !== 1)) throw new ApiError(400, "invalid-body");
    const ids = [...new Set(body.personIds.map(id => documentId(id)))];
    const results: Array<{ personId: string; ok: boolean; error?: string }> = [];
    // Each registration is atomic; bulk failures are reported per profile so
    // successful deletions are never presented as having failed.
    for (const personId of ids) {
      try {
        if (body.operation === "approve") await approveUnverified(personId, adminUid);
        else await deleteUnverified(personId, adminUid);
        results.push({ personId, ok: true });
      } catch (error) {
        results.push({ personId, ok: false, error: error instanceof ApiError ? error.code : "server-unavailable" });
      }
    }
    return json({ results });
  }, "unverified-review");
}
