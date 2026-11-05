-- the reset learns the payroll tables
create or replace function public.system_reset(p_token text, p_level text, p_pin text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; moves text[] := array['stock','stock_layers','stock_moves','serials','transfers','transfer_lines','shifts','cash_moves','sales','sale_lines','sale_payments',
          'held_sales','finance_receivables','returns','return_lines','purchase_invoices','purchase_lines','supplier_payments','service_tickets','gl_manual','gl_manual_lines',
          'gl_periods','gl_years','expenses','day_closings','loyalty_moves','deliveries','label_prints','capital_moves','tax_invoices','einv_docs','attendance','advances','payroll_lines','payroll_runs'];
        master text[] := array['items','item_groups','customers','suppliers','finance_companies','finance_plans','warranty_rules','offers','commission_rules','commission_tiers',
          'staff_targets','item_rules','partners','fixed_assets','staff_pay'];
        lst text[]; sq text; bid bigint;
begin
  s := public._session(p_token);
  if s.role_id <> 'owner' then raise exception 'ONLY_OWNER'; end if;
  if p_level not in ('moves','all') then raise exception 'BAD_STATUS'; end if;
  if not public._pin_ok(s, p_pin) then raise exception 'WRONG_PIN'; end if;
  if coalesce(trim(p_confirm),'') <> 'تصفير' then raise exception 'CONFIRM_REQUIRED'; end if;
  bid := public._backup_take('before', case when p_level = 'all' then 'قبل التصفير الكامل' else 'قبل تصفير الحركات' end, s.staff_id);
  lst := moves || case when p_level = 'all' then master else '{}'::text[] end;
  select array_agg(x) into lst from unnest(lst) x where exists (select 1 from pg_tables where schemaname = 'public' and tablename = x);
  execute 'truncate ' || (select string_agg(format('public.%I', x), ', ') from unnest(lst) x) || ' restart identity';
  if p_level = 'moves' then delete from public.fixed_assets where not opening; end if;   -- bought assets are movements; opening assets are part of the opening sheet
  update public.store set opening_locked = false, opening_date = case when p_level = 'all' then null else opening_date end, opening = case when p_level = 'all' then '{}'::jsonb else opening end where id = 1;
  for sq in select sequencename from pg_sequences where schemaname = 'public' and sequencename like '%\_no\_seq' loop
    execute format('alter sequence public.%I restart with 1', sq);
  end loop;
  if p_level = 'all' then alter sequence public.item_code_seq restart with 1; end if;
  perform public._audit(s, case when p_level = 'all' then 'تصفير كامل للنظام' else 'تصفير الحركات' end, 'نسخة قبلها #' || bid, null, array_length(lst,1)::text || ' جدول', null, null);
  return jsonb_build_object('tables', array_length(lst,1), 'backup', bid);
end $$;

