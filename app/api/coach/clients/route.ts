import { handleApi, json } from "@/lib/server/rfid/http";
import { requireCoach } from "@/lib/server/coaches";
import { coachClient, coachClients } from "@/lib/server/coach-clients";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    const { id } = await requireCoach(request), clientId = new URL(request.url).searchParams.get("id");
    return json(clientId ? await coachClient(id, clientId) : await coachClients(id));
  });
}
