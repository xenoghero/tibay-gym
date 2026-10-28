import { requireCustomer } from "@/lib/server/customer-session";
import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi } from "@/lib/server/rfid/http";
import { documentId } from "@/lib/server/rfid/validation";
import { adminDb } from "@/lib/server/firebase-admin";
import { supabaseAdmin } from "@/lib/server/supabase";
import { PROFILE_BUCKET } from "@/lib/server/private-images";
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
    const db = adminDb();
    const person = (await db.doc(`persons/${personId}`).get()).data() ?? (await db.doc(`unverifiedPersons/${personId}`).get()).data();
    if (!person || person.deletingAt || !person.profileImagePath) throw new ApiError(404, "image-unavailable");
    const result = await supabaseAdmin().storage.from(PROFILE_BUCKET).download(person.profileImagePath);
    if (result.error) throw new ApiError(404, "image-unavailable");
    return new Response(await result.data.arrayBuffer(), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  });
}
