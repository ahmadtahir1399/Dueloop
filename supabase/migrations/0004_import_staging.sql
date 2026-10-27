-- 0004_import_staging.sql: staging tables for the import pipeline (ADR 0010). Rows are parsed and
-- validated by packages/ingest, staged here, previewed (dry run) and then committed in one transaction.

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  uploaded_by uuid references auth.users (id) on delete set null, -- null when staged by the service role
  status text not null default 'staged' check (status in ('staged', 'committed')),
  file_name text not null check (length(btrim(file_name)) > 0),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object'),
  options jsonb not null check (jsonb_typeof(options) = 'object'),
  counts jsonb not null default '{}' check (jsonb_typeof(counts) = 'object'), -- file-level summary at staging
  result jsonb check (result is null or jsonb_typeof(result) = 'object'), -- commit counts
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  check ((status = 'committed') = (committed_at is not null)),
  unique (tenant_id, id)
);
create index import_batches_tenant_created_idx on public.import_batches (tenant_id, created_at);

create table public.import_rows (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  batch_id uuid not null,
  row_number integer not null check (row_number >= 1), -- line in the original file where the record starts
  raw jsonb not null check (jsonb_typeof(raw) = 'array'), -- original cells, for the error report
  normalised jsonb check (normalised is null or jsonb_typeof(normalised) = 'object'),
  errors jsonb not null default '[]' check (jsonb_typeof(errors) = 'array'),
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  skip_reason text, -- e.g. the status column said "Paid"
  -- Exactly one outcome per row: importable, invalid, or deliberately skipped.
  check (
    (normalised is not null)::int + (jsonb_array_length(errors) > 0)::int + (skip_reason is not null)::int = 1
  ),
  primary key (batch_id, row_number),
  foreign key (tenant_id, batch_id) references public.import_batches (tenant_id, id) on delete cascade
);

alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
revoke all on table public.import_batches, public.import_rows from anon, authenticated, service_role;
grant select, insert, update, delete on table public.import_batches, public.import_rows to service_role;
grant select, insert on table public.import_batches, public.import_rows to authenticated;

-- ADR 0008: owner and accountant read and stage imports; collectors and outsiders see nothing.
create policy import_batches_select on public.import_batches for select to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy import_batches_insert on public.import_batches for insert to authenticated
  with check (
    tenant_id in (select private.my_tenant_ids(array['owner', 'accountant']))
    and uploaded_by = (select auth.uid())
    and status = 'staged'
  );

create policy import_rows_select on public.import_rows for select to authenticated
  using (tenant_id in (select private.my_tenant_ids(array['owner', 'accountant'])));
create policy import_rows_insert on public.import_rows for insert to authenticated
  with check (
    tenant_id in (select private.my_tenant_ids(array['owner', 'accountant']))
    and exists (
      select 1 from public.import_batches b
      where b.tenant_id = import_rows.tenant_id and b.id = import_rows.batch_id and b.status = 'staged'
    )
  );
