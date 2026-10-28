import { requireAdmin } from "@/lib/server/rfid/auth";
import { requireCustomer } from "@/lib/server/customer-session";
import { documentId } from "@/lib/server/rfid/validation";
import { ApiError, handleApi } from "@/lib/server/rfid/http";
import { supabaseAdmin } from "@/lib/server/supabase";
import { RECEIPT_BUCKET, RECEIPT_TABLE } from "@/lib/server/receipt-store";
import { adminDb } from "@/lib/server/firebase-admin";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    let personId: string | null = null;
    if (request.headers.has("authorization")) await requireAdmin(request);
    else personId = (await requireCustomer(request)).session.personId;
    const id = documentId(new URL(request.url).searchParams.get("id"));
    const result = await supabaseAdmin().from(RECEIPT_TABLE).select("person_id,private_object_path").eq("id", id).single();
    if (result.error) throw new ApiError(404, "receipt-unavailable");
    if (personId && personId !== result.data.person_id) throw new ApiError(403, "customer-scope-required");
    const db = adminDb();
    const retention = (await db.doc(`receiptRetention/${id}`).get()).data();
    if (retention?.purgeState) throw new ApiError(404, "receipt-unavailable");
    const person = (await db.doc(`persons/${result.data.person_id}`).get()).data() ?? (await db.doc(`unverifiedPersons/${result.data.person_id}`).get()).data();
    if (!person || person.deletingAt) throw new ApiError(404, "receipt-unavailable");
    const image = await supabaseAdmin().storage.from(RECEIPT_BUCKET).download(result.data.private_object_path);
    if (image.error) throw new ApiError(404, "receipt-unavailable");
    return new Response(await image.data.arrayBuffer(), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  });
}
