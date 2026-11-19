import { requireCustomer } from "@/lib/server/customer-session";
import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi } from "@/lib/server/rfid/http";
import { documentId } from "@/lib/server/rfid/validation";
import { profileImageResponse } from "@/lib/server/private-images";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    let personId: string;
    if (request.headers.has("authorization")) {
      await requireAdmin(request); personId = documentId(new URL(request.url).searchParams.get("personId"));
    } else {
      const { session } = await requireCustomer(request); personId = session.personId;
      const target = new URL(request.url).searchParams.get("personId");
      if (target && target !== personId) throw new ApiError(403, "customer-scope-required");
    }
    return profileImageResponse(personId);
  });
}
