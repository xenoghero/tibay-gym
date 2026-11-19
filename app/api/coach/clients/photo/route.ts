import { handleApi } from "@/lib/server/rfid/http";
import { requireCoach } from "@/lib/server/coaches";
import { assignedClientId } from "@/lib/server/coach-clients";
import { profileImageResponse } from "@/lib/server/private-images";

export const runtime = "nodejs";
/** A coach sees the profile photo of their own clients only. */
export async function GET(request: Request) {
  return handleApi(async () => {
    const { id } = await requireCoach(request);
    return profileImageResponse(await assignedClientId(id, new URL(request.url).searchParams.get("id")));
  });
}
