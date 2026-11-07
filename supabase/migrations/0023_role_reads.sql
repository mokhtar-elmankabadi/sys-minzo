-- 0023 · reading follows the signed-in person's role, not just the device
-- Every read now carries the staff session (header x-mz-token). Without a valid session nothing is readable
-- (a locked screen, an account waiting for approval). With one, each table opens only to the roles whose
-- screens use it; salary tables also respect «hide salaries», and item costs come back empty for roles with
-- «hide cost» through the *_v() functions. Server functions (security definer) are unaffected.

-- the staff session behind this request, if any
create or replace function public._rs() returns public.sess
language plpgsql stable security definer set search_path = public, extensions as $$
declare tok text; r public.sess;
begin
  begin tok := nullif(current_setting('request.headers', true)::json->>'x-mz-token', ''); exception when others then tok := null; end;
  if tok is null or auth.uid() is null then return null; end if;
  select s.id, s.name, s.role_id, s.location_id, d.id, d.location_id into r
    from public.staff_sessions ss join public.staff s on s.id = ss.staff_id join public.devices d on d.id = ss.device_id
   where ss.token_hash = encode(digest(tok,'sha256'),'hex') and ss.expires_at > now() and s.active and d.active and d.auth_uid = auth.uid()
     and (d.kind <> 'personal' or (s.email_login and s.auth_user_id = d.auth_uid));
  return r;
end $$;

-- may this role open this screen? (same rules as the side menu)
create or replace function public._scr(p_role text, p_scr text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare top boolean := p_role in ('owner','gm'); c boolean;
begin
  c := case p_scr
    when 'staff' then top or public._can(p_role,'staff','v')
    when 'reports' then top or public._can(p_role,'reports','v')
    when 'basis' then top or public._can(p_role,'basis','v') or public._can(p_role,'gl','v')
    when 'flow' then top or public._can(p_role,'flow','v') or public._can(p_role,'gl','v')
    when 'capital' then top or public._can(p_role,'capital','v')
    when 'opening' then top or public._can(p_role,'opening','v')
    when 'taxinv' then top or public._can(p_role,'taxinv','v')
    when 'einv' then top or public._can(p_role,'einv','v')
    when 'audit' then top or public._can(p_role,'audit','v')
    when 'export' then top or exists (select 1 from public.roles r, jsonb_each_text(r.perms) e where r.id = p_role and e.value like '%x%')
    when 'close' then public._can(p_role,'close','v')
    when 'expense' then public._can(p_role,'expense','v')
    when 'print' then top or public._has(p_role,'labels') or public._has(p_role,'printerSetup') or public._can(p_role,'print','v')
    when 'gl' then top or public._can(p_role,'gl','v')
    when 'commission' then p_role in ('owner','gm','acct','mgr','seller')
    when 'settings' then top
    when 'suppliers' then public._can(p_role,'suppliers','v') or public._can(p_role,'stock','a')
    when 'inst' then top or public._can(p_role,'inst','v')
    when 'cash' then public._can(p_role,'cash','v') or public._can(p_role,'close','v')
    when 'stock' then public._can(p_role,'stock','v') or public._can(p_role,'items','v')
    when 'items' then public._can(p_role,'items','v')
    when 'users' then p_role = 'owner' or public._has(p_role,'users')
    when 'devices' then p_role = 'owner' or public._has(p_role,'devices')
    else false end;
  return coalesce(c, false);
end $$;

create or replace function public._r_any() returns boolean
language sql stable security definer set search_path = public as $$ select (public._rs()).staff_id is not null $$;

create or replace function public._r_scr(p text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select bool_or(public._scr(r.role_id, x)) from public._rs() r, unnest(p) x where r.staff_id is not null), false)
$$;

create or replace function public._r_cost() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not ro.hide_cost from public._rs() r join public.roles ro on ro.id = r.role_id), false)
$$;

create or replace function public._r_salary() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not ro.hide_salary and public._scr(r.role_id, 'staff') from public._rs() r join public.roles ro on ro.id = r.role_id), false)
$$;

-- replace the old «any approved device» read rule table by table
do $$
declare t text; rule text;
  rules jsonb := '{
    "departments":"any","item_groups":"any","locations":"any","store":"any","roles":"any","cash_accounts":"any",
    "expense_categories":"any","gl_accounts":"any","offers":"any","warranty_rules":"any","finance_companies":"any",
    "finance_plans":"any","printers":"any","print_map":"any","label_templates":"any","label_prints":"any",
    "item_rules":"any","held_sales":"any","customers":"any","loyalty_moves":"any","serials":"any","stock":"any",
    "deliveries":"any","service_tickets":"any","transfers":"any","transfer_lines":"any","day_closings":"any",
    "shifts":"any","sales":"any","sale_payments":"any","returns":"any","suppliers":"any",
    "cash_moves":["cash","close","reports","flow","gl","basis","capital","export"],
    "expenses":["expense","close","cash","reports","export"],
    "purchase_invoices":["suppliers","reports","flow","opening","gl","export"],
    "supplier_payments":["suppliers","reports","flow","opening","gl","export"],
    "finance_receivables":["inst","cash","flow","reports"],
    "gl_manual":["gl","basis","reports"],"gl_manual_lines":["gl","basis","reports"],"gl_periods":["gl","basis","reports"],"gl_years":["gl","basis","reports"],
    "capital_moves":["capital","reports","flow"],"partners":["capital","reports","flow"],
    "fixed_assets":["capital","opening","reports"],"final_reports":["reports"],
    "tax_invoices":["taxinv","einv"],"einv_docs":["taxinv","einv"],
    "audit_log":["audit","export"],"devices":["devices","print","audit","settings"],
    "commission_rules":["commission","staff"],"commission_tiers":["commission","staff"],"staff_targets":["commission","staff"],
    "staff_pay":"salary","payroll_runs":"salary","payroll_lines":"salary","advances":"salary","attendance":"salary",
    "items":"cost_any","sale_lines":"cost_any","return_lines":"cost_any",
    "stock_layers":"cost_stock","stock_moves":"cost_stock","purchase_lines":"cost_sup"
  }';
  expr text;
begin
  for t, rule in select key, value::text from jsonb_each(rules) loop
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then continue; end if;
    execute format('drop policy if exists "devices read" on public.%I', t);
    execute format('drop policy if exists "role read" on public.%I', t);
    expr := case
      when rule = '"any"' then '(select public._r_any())'
      when rule = '"salary"' then '(select public._r_salary())'
      when rule = '"cost_any"' then '(select public._r_cost())'
      when rule = '"cost_stock"' then '(select public._r_cost()) and (select public._r_scr(array[''stock'',''items'',''reports'',''flow'',''basis'']))'
      when rule = '"cost_sup"' then '(select public._r_cost()) and (select public._r_scr(array[''suppliers'',''reports'']))'
      else format('(select public._r_scr(%L::text[]))', translate(rule, '[]"', '{}'))
    end;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "role read" on public.%I for select to authenticated using (%s)', t, expr);
  end loop;
end $$;

-- cost-free copies for everyone else (functions, so filters still work from the app): same rows,
-- cost columns empty unless the role may see cost
create or replace function public.items_v() returns setof public.items
language sql stable security definer set search_path = public as $$
  select id, code, barcode, name, department_id, group_id, unit, sale_price,
         case when (select public._r_cost()) then last_cost end,
         min_qty, serial_required, warranty_months, min_length, vat_rate, variants, hidden, created_at, updated_at, brand
    from public.items where (select public._r_any()) $$;
create or replace function public.sale_lines_v() returns setof public.sale_lines
language sql stable security definer set search_path = public as $$
  select id, sale_id, item_id, qty, unit_price, discount, vat, case when (select public._r_cost()) then cost end, serial, cut_waste_m, offer_id, offer_disc
    from public.sale_lines where (select public._r_any()) $$;
create or replace function public.return_lines_v() returns setof public.return_lines
language sql stable security definer set search_path = public as $$
  select id, return_id, sale_line_id, item_id, qty, amount, case when (select public._r_cost()) then cost end, condition, serial
    from public.return_lines where (select public._r_any()) $$;
create or replace function public.stock_layers_v() returns setof public.stock_layers
language sql stable security definer set search_path = public as $$
  select id, item_id, location_id, qty_in, qty_left, case when (select public._r_cost()) then unit_cost end, ref, created_at
    from public.stock_layers where (select public._r_scr(array['stock','items','reports','flow','basis'])) $$;
create or replace function public.stock_moves_v() returns setof public.stock_moves
language sql stable security definer set search_path = public as $$
  select id, item_id, location_id, qty, case when (select public._r_cost()) then cost end, kind, ref_type, ref_id, staff_id, created_at
    from public.stock_moves where (select public._r_scr(array['stock','items','reports','flow','basis'])) $$;
create or replace function public.purchase_lines_v() returns setof public.purchase_lines
language sql stable security definer set search_path = public as $$
  select id, invoice_id, item_id, qty, case when (select public._r_cost()) then unit_cost end,
         case when (select public._r_cost()) then prev_cost end, diff_reason, serials
    from public.purchase_lines where (select public._r_scr(array['suppliers','reports'])) $$;

revoke execute on function public.items_v(), public.sale_lines_v(), public.return_lines_v(), public.stock_layers_v(), public.stock_moves_v(), public.purchase_lines_v() from public, anon;
grant execute on function public.items_v(), public.sale_lines_v(), public.return_lines_v(), public.stock_layers_v(), public.stock_moves_v(), public.purchase_lines_v() to authenticated;

revoke execute on function public._rs(), public._scr(text,text), public._r_any(), public._r_scr(text[]), public._r_cost(), public._r_salary() from public, anon;
-- policies run as the reader, so the readers need these
grant execute on function public._rs(), public._scr(text,text), public._r_any(), public._r_scr(text[]), public._r_cost(), public._r_salary() to authenticated;
