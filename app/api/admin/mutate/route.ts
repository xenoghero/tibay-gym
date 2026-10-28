import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { mutateAdmin } from "@/lib/server/admin-mutations";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => json(await mutateAdmin(await requireAdmin(request), await readBody(request, 8192))));
}
