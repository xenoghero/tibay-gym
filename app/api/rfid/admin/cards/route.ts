import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody, ApiError } from "@/lib/server/rfid/http";
import { removeCard } from "@/lib/server/rfid/enrollment";
import { documentId } from "@/lib/server/rfid/validation";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    const uid = await requireAdmin(request);
    const body = await readBody(request);
    if (body.operation !== "remove") throw new ApiError(400, "invalid-operation");
    return json(await removeCard(uid, documentId(body.personId), body.expectedPreviousUid));
  });
}
