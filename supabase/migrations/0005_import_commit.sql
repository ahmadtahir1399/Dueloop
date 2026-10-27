-- 0005_import_commit.sql: commit a staged import batch in ONE transaction (ADR 0010).
-- public.commit_import_batch is a security INVOKER wrapper (nothing security definer in an exposed
-- schema, Supabase RLS docs); the work runs in private.commit_import_batch_impl, which checks the
-- caller itself: the service role, or an owner/accountant of the batch's tenant.

create function private.commit_import_batch_impl(p_batch_id uuid, p_skip_invalid_rows boolean, p_dry_run boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.import_batches%rowtype;
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  r public.import_rows%rowtype;
  n jsonb;
  inv public.invoices%rowtype;
  cust public.customers%rowtype;
  found_inv boolean;
  cust_id uuid;
  matches int;
  paid bigint;
  changes jsonb;
  new_issued date;
  new_due date;
  new_total bigint;
  code text;
  inv_id uuid;
  warnings jsonb := '[]';
  c_inv_created int := 0; c_inv_updated int := 0; c_inv_unchanged int := 0; c_inv_skipped int := 0; c_inv_errored int := 0;
  cust_created uuid[] := '{}';
  cust_updated uuid[] := '{}';
  cust_seen uuid[] := '{}';
  v_result jsonb;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'import batch not found';
  end if;

  if coalesce(claims ->> 'role', '') <> 'service_role' and not exists (
    select 1 from public.memberships m
    where m.tenant_id = b.tenant_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'accountant')
  ) then
    raise exception using errcode = '42501', message = 'only an owner or accountant of this tenant (or the service role) may commit imports';
  end if;

  if b.status <> 'staged' then
    raise exception using errcode = '55000', message = format('import batch %s is already %s', b.id, b.status);
  end if;

  -- Serialise commits per tenant so overlapping files can never create duplicate customers.
  perform pg_advisory_xact_lock(hashtextextended('dueloop.import:' || b.tenant_id::text, 0));

  if not p_skip_invalid_rows and exists (
    select 1 from public.import_rows x where x.batch_id = b.id and jsonb_array_length(x.errors) > 0
  ) then
    raise exception using errcode = '22023',
      message = 'the batch has rows with errors; fix the file or pass skipInvalidRows to import only the valid rows';
  end if;

  begin -- subtransaction: a dry run rolls everything in here back
    for r in select * from public.import_rows x where x.batch_id = b.id order by x.row_number loop
      if r.skip_reason is not null then
        c_inv_skipped := c_inv_skipped + 1;
        continue;
      end if;
      if jsonb_array_length(r.errors) > 0 then
        c_inv_errored := c_inv_errored + 1;
        continue;
      end if;
      n := r.normalised;

      select * into inv from public.invoices i
      where i.tenant_id = b.tenant_id and i.number = n ->> 'invoiceNumber'
      for update;
      found_inv := found;

      -- Customer: the existing invoice's customer, else identity precedence external id > email > phone.
      cust_id := null;
      if found_inv then
        cust_id := inv.customer_id;
      elsif n #>> '{customer,externalId}' is not null then
        select c.id into cust_id from public.customers c
        where c.tenant_id = b.tenant_id and c.external_id = n #>> '{customer,externalId}';
      elsif n #>> '{customer,email}' is not null then
        select count(*) into matches from public.customers c where c.tenant_id = b.tenant_id and c.email = n #>> '{customer,email}';
        select c.id into cust_id from public.customers c
        where c.tenant_id = b.tenant_id and c.email = n #>> '{customer,email}' order by c.created_at, c.id limit 1;
        if matches > 1 then
          warnings := warnings || jsonb_build_object('row', r.row_number, 'code', 'ambiguous_customer_match',
            'message', format('%s customers share this email; used the oldest', matches));
        end if;
      elsif n #>> '{customer,phone}' is not null then
        select count(*) into matches from public.customers c where c.tenant_id = b.tenant_id and c.phone_e164 = n #>> '{customer,phone}';
        select c.id into cust_id from public.customers c
        where c.tenant_id = b.tenant_id and c.phone_e164 = n #>> '{customer,phone}' order by c.created_at, c.id limit 1;
        if matches > 1 then
          warnings := warnings || jsonb_build_object('row', r.row_number, 'code', 'ambiguous_customer_match',
            'message', format('%s customers share this phone; used the oldest', matches));
        end if;
      end if;

      if cust_id is null then
        if exists (select 1 from public.customers c where c.tenant_id = b.tenant_id
                   and lower(c.display_name) = lower(n #>> '{customer,name}')) then
          warnings := warnings || jsonb_build_object('row', r.row_number, 'code', 'same_name_different_customer',
            'message', 'a customer with this name already exists; name alone never merges customers');
        end if;
        insert into public.customers (tenant_id, display_name, email, phone_e164, external_id)
        values (b.tenant_id, n #>> '{customer,name}', n #>> '{customer,email}', n #>> '{customer,phone}', n #>> '{customer,externalId}')
        returning id into cust_id;
        cust_created := cust_created || cust_id;
      else
        -- Fill contact fields only where empty; report differences, never overwrite.
        select * into cust from public.customers c where c.id = cust_id;
        if (cust.email is null and n #>> '{customer,email}' is not null)
           or (cust.phone_e164 is null and n #>> '{customer,phone}' is not null)
           or (cust.external_id is null and n #>> '{customer,externalId}' is not null) then
          update public.customers c set
            email = coalesce(c.email, n #>> '{customer,email}'),
            phone_e164 = coalesce(c.phone_e164, n #>> '{customer,phone}'),
            external_id = coalesce(c.external_id, n #>> '{customer,externalId}')
          where c.id = cust_id;
          if not cust_id = any (cust_created) then cust_updated := cust_updated || cust_id; end if;
        end if;
        if (cust.email is not null and n #>> '{customer,email}' is not null and cust.email <> n #>> '{customer,email}')
           or (cust.phone_e164 is not null and n #>> '{customer,phone}' is not null and cust.phone_e164 <> n #>> '{customer,phone}')
           or (cust.display_name <> n #>> '{customer,name}') then
          warnings := warnings || jsonb_build_object('row', r.row_number, 'code', 'customer_details_differ',
            'message', 'the file has different contact details for an existing customer; kept the stored ones');
        end if;
      end if;
      cust_seen := cust_seen || cust_id;

      if found_inv then
        if inv.status in ('paid', 'written_off', 'cancelled') then
          c_inv_unchanged := c_inv_unchanged + 1;
          continue;
        end if;
        if inv.currency <> n ->> 'currency' then
          warnings := warnings || jsonb_build_object('row', r.row_number, 'code', 'currency_not_changed',
            'message', format('the invoice is in %s; the file says %s; nothing was changed', inv.currency, n ->> 'currency'));
          c_inv_skipped := c_inv_skipped + 1;
          continue;
        end if;
        new_issued := (n ->> 'issuedOn')::date;
        new_due := (n ->> 'dueOn')::date;
        new_total := (n ->> 'amountMinor')::bigint;
        select coalesce(sum(p.amount), 0) into paid from public.payments p where p.tenant_id = inv.tenant_id and p.invoice_id = inv.id;
        if new_total < paid then
          warnings := warnings || jsonb_build_object('row', r.row_number, 'code', 'total_below_paid',
            'message', format('the new total %s is below the %s already paid; nothing was changed', new_total, paid));
          c_inv_skipped := c_inv_skipped + 1;
          continue;
        end if;
        changes := '{}';
        if new_issued <> inv.issued_on then changes := changes || jsonb_build_object('issuedOn', jsonb_build_object('from', inv.issued_on, 'to', new_issued)); end if;
        if new_due <> inv.due_on then changes := changes || jsonb_build_object('dueOn', jsonb_build_object('from', inv.due_on, 'to', new_due)); end if;
        if new_total <> inv.amount_total then changes := changes || jsonb_build_object('amountTotal', jsonb_build_object('from', inv.amount_total, 'to', new_total)); end if;
        if changes = '{}' then
          c_inv_unchanged := c_inv_unchanged + 1;
          continue;
        end if;
        update public.invoices i set issued_on = new_issued, due_on = new_due, amount_total = new_total where i.id = inv.id;
        insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key)
        values (b.tenant_id, inv.id, 'InvoiceImportUpdated',
                jsonb_build_object('batchId', b.id, 'row', r.row_number, 'changes', changes),
                format('import-update:%s:%s', b.id, r.row_number));
        c_inv_updated := c_inv_updated + 1;
        continue;
      end if;

      -- New invoice: status open, due now (ADR 0010 / issue H), first free reference code candidate.
      inv_id := null;
      foreach code in array (select array_agg(x) from jsonb_array_elements_text(n -> 'referenceCodes') x) loop
        begin
          insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on,
                                       reference_code, next_action_at)
          values (b.tenant_id, cust_id, n ->> 'invoiceNumber', (n ->> 'amountMinor')::bigint, n ->> 'currency',
                  (n ->> 'issuedOn')::date, (n ->> 'dueOn')::date, code, now())
          returning id into inv_id;
          exit;
        exception when unique_violation then
          -- Only a reference-code clash is retried; anything else is a real error.
          if not exists (select 1 from public.invoices i where i.tenant_id = b.tenant_id and i.reference_code = code) then
            raise;
          end if;
        end;
      end loop;
      if inv_id is null then
        raise exception using errcode = '23505',
          message = format('row %s: every reference code candidate is already taken', r.row_number);
      end if;
      insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key)
      values (b.tenant_id, inv_id, 'InvoiceImported', jsonb_build_object('batchId', b.id, 'row', r.row_number),
              format('import:%s', inv_id));
      c_inv_created := c_inv_created + 1;
    end loop;

    v_result := jsonb_build_object(
      'batchId', b.id,
      'dryRun', p_dry_run,
      'invoices', jsonb_build_object('created', c_inv_created, 'updated', c_inv_updated, 'unchanged', c_inv_unchanged,
                                     'skipped', c_inv_skipped, 'errored', c_inv_errored),
      'customers', jsonb_build_object(
        'created', cardinality(cust_created),
        'updated', cardinality(cust_updated),
        'unchanged', (select count(distinct x) from unnest(cust_seen) x
                      where not x = any (cust_created) and not x = any (cust_updated))),
      'warnings', warnings);

    if p_dry_run then
      raise exception using errcode = 'DRY01', message = v_result::text;
    end if;
  exception when sqlstate 'DRY01' then
    return sqlerrm::jsonb; -- everything inside the block is rolled back
  end;

  update public.import_batches set status = 'committed', committed_at = now(), result = v_result where id = b.id;
  return v_result;
end $$;

revoke all on function private.commit_import_batch_impl(uuid, boolean, boolean) from public, anon;
grant execute on function private.commit_import_batch_impl(uuid, boolean, boolean) to authenticated, service_role;

create function public.commit_import_batch(p_batch_id uuid, p_skip_invalid_rows boolean default false, p_dry_run boolean default false)
returns jsonb
language sql security invoker set search_path = '' as $$
  select private.commit_import_batch_impl(p_batch_id, p_skip_invalid_rows, p_dry_run)
$$;
revoke all on function public.commit_import_batch(uuid, boolean, boolean) from public, anon;
grant execute on function public.commit_import_batch(uuid, boolean, boolean) to authenticated, service_role;
