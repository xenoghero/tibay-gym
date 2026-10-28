import { afterAll, beforeAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key, public boolean); insert into storage.buckets values ('payment-receipts', false); grant usage on schema storage to service_role; grant select on storage.buckets to service_role;");
  await db.exec(await readFile("supabase/migrations/202610250001_private_receipts.sql", "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });
it("installs private receipt metadata and blocks direct anonymous/authenticated reads and writes", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await expect(db.query("select * from public.tibay_receipts")).rejects.toThrow(/permission denied/);
    await expect(db.query("select * from public.tibay_claim_receipt_ocr('00000000-0000-4000-8000-000000000001', 1)")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  expect((await db.query<{ ready: boolean }>("select public.tibay_receipt_ready() as ready")).rows[0].ready).toBe(true);
  await db.exec("reset role");
});
it("enforces unique request/object links and recovers expired OCR leases with bounded attempts", async () => {
  const insert = (id: string, request: string, object: string) => db.query("insert into public.tibay_receipts(id,payment_request_id,charge_id,person_id,private_object_path,upload_digest,linked_at) values($1,$2,'c1','p1',$3,$4,now())", [id.repeat(64), request, object, "d".repeat(64)]);
  await insert("a", "r1", "p1/a.webp");
  await expect(insert("b", "r1", "p1/b.webp")).rejects.toThrow(/unique constraint/);
  await expect(insert("c", "r2", "p1/a.webp")).rejects.toThrow(/unique constraint/);
  const claim = () => db.query<{ id: string; attempt_count: number }>("select * from public.tibay_claim_receipt_ocr('00000000-0000-4000-8000-000000000001', 1)");
  expect((await claim()).rows[0].attempt_count).toBe(1);
  expect((await claim()).rows).toHaveLength(0);
  await db.exec("update public.tibay_receipts set lease_until=now()-interval '1 minute'");
  expect((await claim()).rows[0].attempt_count).toBe(2);
  await db.exec("update public.tibay_receipts set lease_until=now()-interval '1 minute'");
  expect((await claim()).rows[0].attempt_count).toBe(3);
  await db.exec("update public.tibay_receipts set lease_until=now()-interval '1 minute'");
  expect((await claim()).rows).toHaveLength(0);
  expect((await db.query<{ ocr_status: string }>("select ocr_status from public.tibay_receipts")).rows[0].ocr_status).toBe("failed");
});
