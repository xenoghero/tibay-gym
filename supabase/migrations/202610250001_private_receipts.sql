begin;
create table if not exists public.tibay_receipts (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  payment_request_id text not null unique,
  charge_id text not null,
  person_id text not null,
  private_object_path text not null unique,
  upload_digest text not null check (upload_digest ~ '^[a-f0-9]{64}$'),
  uploaded_at timestamptz not null default now(),
  linked_at timestamptz,
  purge_after timestamptz default (now() + interval '1 day'),
  ocr_status text not null default 'queued' check (ocr_status in ('queued','processing','extracted','needs_review','failed')),
  extracted_reference text,
  normalized_reference text,
  extracted_amount_minor integer check (extracted_amount_minor > 0),
  raw_text text,
  confidence real check (confidence between 0 and 100),
  error_code text,
  processed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  claim_token uuid,
  lease_until timestamptz,
  corrected_reference text,
  corrected_amount_minor integer check (corrected_amount_minor > 0),
  corrected_by text,
  corrected_at timestamptz,
  correction_revision integer not null default 0,
  artifact_deleted_at timestamptz
);
alter table public.tibay_receipts enable row level security;
alter table public.tibay_receipts force row level security;
revoke all on public.tibay_receipts from public, anon, authenticated;
grant select, insert, update, delete on public.tibay_receipts to service_role;
create index if not exists tibay_receipts_person_idx on public.tibay_receipts(person_id, uploaded_at desc);
create index if not exists tibay_receipts_reference_idx on public.tibay_receipts(normalized_reference) where normalized_reference is not null;
create index if not exists tibay_receipts_work_idx on public.tibay_receipts(ocr_status, uploaded_at) where linked_at is not null and attempt_count < 3;
create index if not exists tibay_receipts_cleanup_idx on public.tibay_receipts(purge_after) where linked_at is null;

create or replace function public.tibay_claim_receipt_ocr(p_claim_token uuid, p_limit integer default 1)
returns setof public.tibay_receipts language plpgsql security invoker set search_path = '' as $$
begin
  update public.tibay_receipts set ocr_status = 'failed', error_code = 'retry-exhausted', claim_token = null, lease_until = null
    where ocr_status = 'processing' and lease_until <= now() and attempt_count >= 3;
  return query
    update public.tibay_receipts r set ocr_status = 'processing', claim_token = p_claim_token,
      lease_until = now() + interval '5 minutes', attempt_count = r.attempt_count + 1, error_code = null
    where r.id in (
      select q.id from public.tibay_receipts q
      where q.linked_at is not null and q.artifact_deleted_at is null and q.attempt_count < 3 and
        (q.ocr_status in ('queued','failed') or (q.ocr_status = 'processing' and q.lease_until <= now()))
      order by q.uploaded_at, q.id limit greatest(1, least(p_limit, 3)) for update skip locked
    ) returning r.*;
end;
$$;
revoke all on function public.tibay_claim_receipt_ocr(uuid, integer) from public, anon, authenticated;
grant execute on function public.tibay_claim_receipt_ocr(uuid, integer) to service_role;

create or replace function public.tibay_receipt_ready()
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tibay_receipts' and c.relrowsecurity and c.relforcerowsecurity)
    and not pg_catalog.has_table_privilege('anon','public.tibay_receipts','SELECT,INSERT,UPDATE,DELETE')
    and not pg_catalog.has_table_privilege('authenticated','public.tibay_receipts','SELECT,INSERT,UPDATE,DELETE')
    and exists(select 1 from storage.buckets where id = 'payment-receipts' and public = false)
    and not exists(select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('SELECT','ALL') and roles && array['public','anon','authenticated']::name[]);
$$;
revoke all on function public.tibay_receipt_ready() from public, anon, authenticated;
grant execute on function public.tibay_receipt_ready() to service_role;
commit;
