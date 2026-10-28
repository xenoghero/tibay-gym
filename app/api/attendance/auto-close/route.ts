import { sweepStaleSessions } from "@/lib/server/attendance-admin";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { throttle } from "@/lib/server/rfid/rate-limit";
import { requireAdmin } from "@/lib/server/rfid/auth";
import { onlyFields } from "@/lib/server/attendance-request";
import { publicRateLimiter } from "@/lib/server/public-rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function runSweep(request: Request) {
  return handleApi(async () => {
    let publicSweep = false;
    if (request.method === "GET") {
      if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) throw new ApiError(401, "unauthorized");
    } else {
      const body = await readBody(request, 4096);
      onlyFields(body, ["caller"]);
      if (body.caller === "admin") await requireAdmin(request);
      else {
        if (body.caller !== undefined && body.caller !== "public") throw new ApiError(400, "invalid-body");
        publicSweep = true;
      }
    }
    if (publicSweep) publicRateLimiter.consume("public-sweep", "sweep");
    else await throttle("attendance-sweep", 10);
    return json({ closed: await sweepStaleSessions() });
  }, "attendance-sweep");
}
export const GET = runSweep;
export const POST = runSweep;
