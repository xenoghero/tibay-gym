import { cleanupProfileImages } from "@/lib/server/private-images";
import { requireMaintenanceCaller } from "@/lib/server/maintenance-auth";
import { handleApi, json } from "@/lib/server/rfid/http";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  return handleApi(async () => { await requireMaintenanceCaller(request); return json(await cleanupProfileImages()); });
}
