import { requireDevice } from "@/lib/server/rfid/auth";
import { handleApi, json } from "@/lib/server/rfid/http";

export const runtime = "nodejs";

// Authentication probe only; command polling and attendance are later phases.
export async function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    await requireDevice(request);
    return json({ resultCode: "authenticated", display: { message: "Scanner authenticated" } });
  });
}
