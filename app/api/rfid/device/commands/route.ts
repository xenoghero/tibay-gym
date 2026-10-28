import { requireDevice } from "@/lib/server/rfid/auth";
import { handleApi, json } from "@/lib/server/rfid/http";
import { pollCommand } from "@/lib/server/rfid/enrollment";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    await requireDevice(request);
    return json(await pollCommand(request));
  }, "device-commands");
}
