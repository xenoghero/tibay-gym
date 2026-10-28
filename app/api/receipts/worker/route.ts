import { requireMaintenanceCaller } from "@/lib/server/maintenance-auth";
import { handleApi, json } from "@/lib/server/rfid/http";
import { cleanupOrphanReceipts, recoverReceiptLinks } from "@/lib/server/receipt-store";
import { recoverReceiptCorrections } from "@/lib/server/receipt-review";
import { cleanupReceiptRetention } from "@/lib/server/receipt-cleanup";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  return handleApi(async () => {
    await requireMaintenanceCaller(request);
    await recoverReceiptLinks();
    await recoverReceiptCorrections();
    const retainedArtifactsRemoved = await cleanupReceiptRetention();
    return json({ orphansRemoved: await cleanupOrphanReceipts(), retainedArtifactsRemoved });
  });
}
