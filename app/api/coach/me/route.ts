import { handleApi, json } from "@/lib/server/rfid/http";
import { requireCoach } from "@/lib/server/coaches";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    const { id, coach } = await requireCoach(request);
    return json({ id, name: coach.name, email: coach.email });
  });
}
