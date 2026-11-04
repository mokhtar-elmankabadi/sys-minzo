-- 0016 · Finance & analysis: opening balance sheet, project capital (partners, loans, fixed assets & depreciation),
--        report data access, tax invoices, e-invoice queue, final-report archive
-- ==============================================================================================================

-- ---------- permissions the prototype had for these screens ----------
update public.roles set perms = '{"reports":"vxr"}'::jsonb || perms where id in ('mgr','acct');
update public.roles set perms = '{"reports":"v"}'::jsonb || perms where id in ('asstmgr','asstacct','promo');
update public.roles set perms = '{"opening":"vaep","capital":"v","basis":"v","flow":"v","taxinv":"vaer","einv":"vae"}'::jsonb || perms where id = 'acct';
update public.roles set perms = '{"taxinv":"vr","einv":"v"}'::jsonb || perms where id in ('asstacct','mgr');
update public.roles set perms = '{"taxinv":"vr"}'::jsonb || perms where id in ('cashier','shiftmgr');

-- ---------- chart of accounts additions ----------
insert into public.gl_accounts (code, name, name_en, kind, parent, system) values
  ('1107','مصروفات مدفوعة مقدمًا','Prepaid expenses','A','11',true),
  ('1202','مجمع الإهلاك','Accumulated depreciation','A','12',true),
  ('2105','قروض','Loans','L','2',true),
  ('3104','مسحوبات الشركاء','Partner drawings','E','3',true)
on conflict (code) do nothing;
alter table public.gl_manual drop constraint if exists gl_manual_kind_check;
alter table public.gl_manual add constraint gl_manual_kind_check check (kind in ('manual','closing','opening'));

alter table public.store add column if not exists opening_date date;
alter table public.store add column if not exists opening_locked boolean not null default false;
alter table public.store add column if not exists opening jsonb not null default '{}'::jsonb;
alter table public.store add column if not exists tax jsonb not null default '{"cr":"","act":"","branch":"0","addr":"","env":"preprod","token":false}'::jsonb;

-- =====================================================================
-- PROJECT CAPITAL: partners, capital / drawings / loans, fixed assets
-- =====================================================================
create table public.partners (
  id serial primary key,
  name text not null,
  share_pct numeric(6,3) not null default 0 check (share_pct between 0 and 100),
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.capital_moves (
  id serial primary key,
  no text not null unique,
  partner_id int references public.partners(id),
  kind text not null check (kind in ('contribution','drawing','loan_in','loan_repay')),
  amount numeric(14,2) not null check (amount > 0),
  account_id int not null references public.cash_accounts(id),
  move_date date not null,
  note text,
  status text not null default 'posted' check (status in ('posted','void')),
  void_reason text,
  staff_id uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create sequence public.cap_no_seq start 1;
create table public.fixed_assets (
  id serial primary key,
  name text not null,
  location_id smallint references public.locations(id),
  start_date date not null,                 -- purchase date, or the opening date for assets brought in at opening
  start_value numeric(14,2) not null check (start_value >= 0),   -- cost, or net book value at the opening date
  salvage numeric(14,2) not null default 0,
  life_months int not null default 60,      -- remaining useful life from start_date
  opening boolean not null default false,
  paid_from int references public.cash_accounts(id),
  disposed_on date,
  note text,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
alter table public.partners enable row level security;
alter table public.capital_moves enable row level security;
alter table public.fixed_assets enable row level security;

create or replace function public._fin_right(s public.sess, p_mod text, p_act text) returns void language plpgsql stable security definer set search_path = public as $$
begin if not (s.role_id in ('owner','gm') or public._can(s.role_id, p_mod, p_act)) then raise exception 'NOT_ALLOWED:%:%', p_mod, p_act; end if; end $$;

create or replace function public.partner_save(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid int;
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm') then raise exception 'ONLY_OWNER'; end if;
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if (p->>'id') is null then
    insert into public.partners (name, share_pct, phone) values (trim(p->>'name'), coalesce((p->>'share_pct')::numeric,0), nullif(trim(p->>'phone'),'')) returning id into nid;
  else
    update public.partners set name = trim(p->>'name'), share_pct = coalesce((p->>'share_pct')::numeric, share_pct), phone = nullif(trim(p->>'phone'),''),
      active = coalesce((p->>'active')::boolean, active) where id = (p->>'id')::int returning id into nid;
  end if;
  if (select sum(share_pct) from public.partners where active) > 100.0001 then raise exception 'SHARES_OVER_100'; end if;
  perform public._audit(s,'بيانات شريك',trim(p->>'name'),null,(p->>'share_pct') || '%',null,null);
  return nid;
end $$;

create or replace function public.capital_move(p_token text, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare s public.sess; m public.capital_moves; acc public.cash_accounts; d date := coalesce(nullif(p->>'move_date','')::date, (now() at time zone 'Africa/Cairo')::date);
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm') then raise exception 'ONLY_OWNER'; end if;
  if coalesce((p->>'amount')::numeric,0) <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if (p->>'kind') in ('contribution','drawing') and nullif(p->>'partner_id','') is null then raise exception 'PARTNER_REQUIRED'; end if;
  select * into acc from public.cash_accounts where id = (p->>'account_id')::int and active and kind <> 'drawer';
  if acc.id is null then raise exception 'TREASURY_OR_BANK'; end if;
  if public._gl_locked(d) then raise exception 'PERIOD_CLOSED'; end if;
  insert into public.capital_moves (no, partner_id, kind, amount, account_id, move_date, note, staff_id)
  values ('CAP-' || lpad(nextval('public.cap_no_seq')::text,4,'0'), nullif(p->>'partner_id','')::int, p->>'kind', (p->>'amount')::numeric, acc.id, d, nullif(trim(p->>'note'),''), s.staff_id)
  returning * into m;
  insert into public.cash_moves (account_id, amount, kind, method, ref_type, ref_id, note, staff_id, gl_account, created_at)
  values (acc.id, case when m.kind in ('contribution','loan_in') then m.amount else -m.amount end, 'adjust', case when acc.kind = 'treasury' then 'cash' else 'bank' end,
          'capital', m.no, (case m.kind when 'contribution' then 'رأس مال من ' when 'drawing' then 'مسحوبات ' when 'loan_in' then 'قرض' else 'سداد قرض' end) || coalesce((select name from public.partners where id = m.partner_id),'') || coalesce(' — ' || m.note,''),
          s.staff_id, case when m.kind in ('loan_in','loan_repay') then '2105' when m.kind = 'drawing' then '3104' else '3101' end,
          case when d < (now() at time zone 'Africa/Cairo')::date then (d + time '12:00') at time zone 'Africa/Cairo' else now() end);
  perform public._audit(s,'حركة رأس مال',m.no,null,m.kind || ' · ' || m.amount,m.note,null);
  return m.no;
end $$;

create or replace function public.asset_save(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid int; acc public.cash_accounts; fa public.fixed_assets; op boolean := coalesce((p->>'opening')::boolean,false);
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'opening','e')) then raise exception 'NOT_ALLOWED:capital'; end if;
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if (p->>'id') is not null then   -- only the disposal date and the note change after registration
    update public.fixed_assets set disposed_on = nullif(p->>'disposed_on','')::date, note = nullif(trim(p->>'note'),'') where id = (p->>'id')::int returning id into nid;
    perform public._audit(s,'تعديل أصل ثابت',trim(p->>'name'),null,p->>'disposed_on',p->>'note',null);
    return nid;
  end if;
  if coalesce((p->>'start_value')::numeric,0) <= 0 or coalesce((p->>'life_months')::int,0) <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if op and (select opening_locked from public.store) then raise exception 'OPENING_LOCKED'; end if;
  if not op then
    select * into acc from public.cash_accounts where id = (p->>'paid_from')::int and active and kind <> 'drawer';
    if acc.id is null then raise exception 'TREASURY_OR_BANK'; end if;
  end if;
  insert into public.fixed_assets (name, location_id, start_date, start_value, salvage, life_months, opening, paid_from, note, created_by)
  values (trim(p->>'name'), nullif(p->>'location_id','')::smallint, case when op then coalesce((select opening_date from public.store), (now() at time zone 'Africa/Cairo')::date) else coalesce(nullif(p->>'start_date','')::date, (now() at time zone 'Africa/Cairo')::date) end,
          (p->>'start_value')::numeric, coalesce(nullif(p->>'salvage','')::numeric,0), (p->>'life_months')::int, op, acc.id, nullif(trim(p->>'note'),''), s.staff_id)
  returning * into fa;
  if not op then
    insert into public.cash_moves (account_id, amount, kind, method, ref_type, ref_id, note, staff_id, gl_account)
    values (acc.id, -fa.start_value, 'adjust', case when acc.kind = 'treasury' then 'cash' else 'bank' end, 'asset', 'FA-' || fa.id, 'شراء أصل ثابت: ' || fa.name, s.staff_id, '1201');
  end if;
  perform public._audit(s,'أصل ثابت',fa.name,null,fa.start_value::text,null,fa.location_id);
  return fa.id;
end $$;

-- =====================================================================
-- OPENING BALANCE SHEET
-- cash lines → cash_moves 'opening' (so the treasury screen starts from them); everything else → one gl_manual 'opening' entry.
-- Both sides go through 3103 «أرصدة افتتاحية», which nets to zero when the sheet balances.
-- =====================================================================
create or replace function public.opening_save(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; st public.store; d date := nullif(p->>'date','')::date; c jsonb; eid uuid; ln jsonb; v numeric; diff numeric := 0; fixed numeric;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'opening','e')) then raise exception 'NOT_ALLOWED:opening:e'; end if;
  select * into st from public.store;
  if st.opening_locked then raise exception 'OPENING_LOCKED'; end if;
  if d is null then raise exception 'BAD_DATES'; end if;
  -- remove the previous draft
  delete from public.cash_moves where ref_type = 'opening_bs';
  delete from public.gl_manual where kind = 'opening';
  for c in select * from jsonb_array_elements(coalesce(p->'cash','[]'::jsonb)) loop
    if coalesce((c->>'v')::numeric,0) <> 0 then
      insert into public.cash_moves (account_id, amount, kind, method, ref_type, ref_id, note, staff_id, created_at)
      values ((c->>'id')::int, (c->>'v')::numeric, 'opening', 'cash', 'opening_bs', 'OB', 'رصيد افتتاحي', s.staff_id, (d + time '00:01') at time zone 'Africa/Cairo');
    end if;
  end loop;
  select coalesce(sum(start_value),0) into fixed from public.fixed_assets where opening;
  insert into public.gl_manual (no, entry_date, memo, kind, status, created_by, approved_by) values ('OB-' || to_char(d,'YYYYMMDD'), d, 'الميزانية الافتتاحية', 'opening', 'approved', s.staff_id, s.staff_id) returning id into eid;
  for ln in select * from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('a','1103','v',coalesce((p->>'ar')::numeric,0),'side','dr'),      -- card / InstaPay sales not yet settled
      jsonb_build_object('a','1104','v',coalesce((p->>'fin')::numeric,0),'side','dr'),     -- due from finance companies
      jsonb_build_object('a','1105','v',coalesce((p->>'recv')::numeric,0),'side','dr'),
      jsonb_build_object('a','1107','v',coalesce((p->>'pre')::numeric,0),'side','dr'),
      jsonb_build_object('a','1201','v',fixed,'side','dr'),
      jsonb_build_object('a','2102','v',coalesce((p->>'acc')::numeric,0),'side','cr'),
      jsonb_build_object('a','2103','v',coalesce((p->>'def')::numeric,0),'side','cr'),
      jsonb_build_object('a','2105','v',coalesce((p->>'loans')::numeric,0),'side','cr'),
      jsonb_build_object('a','3101','v',coalesce((p->>'capital')::numeric,0),'side','cr'),
      jsonb_build_object('a','3102','v',coalesce((p->>'retained')::numeric,0),'side','cr'))) loop
    v := (ln->>'v')::numeric;
    if v = 0 then continue; end if;
    if (ln->>'side') = 'dr' then
      insert into public.gl_manual_lines (entry_id, account, dr, cr) values (eid, ln->>'a', greatest(v,0), greatest(-v,0)), (eid, '3103', greatest(-v,0), greatest(v,0));
    else
      insert into public.gl_manual_lines (entry_id, account, dr, cr) values (eid, ln->>'a', greatest(-v,0), greatest(v,0)), (eid, '3103', greatest(v,0), greatest(-v,0));
    end if;
  end loop;
  if not exists (select 1 from public.gl_manual_lines where entry_id = eid) then delete from public.gl_manual where id = eid; end if;
  update public.store set opening_date = d, opening = p - 'cash' || jsonb_build_object('cash', p->'cash'), updated_at = now() where id = 1;
  -- balance check: everything that went through 3103 (cash, stock, suppliers, this entry) should net to zero
  select coalesce(sum(dr - cr),0) into diff from public._gl_rows(null, null) where account = '3103';
  perform public._audit(s,'حفظ الميزانية الافتتاحية',d::text,null,diff::text,null,null);
  return jsonb_build_object('diff', diff);
end $$;

create or replace function public.opening_lock(p_token text, p_lock boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; diff numeric;
begin
  s := public._session(p_token);
  if p_lock then
    if not (s.role_id in ('owner','gm') or public._can(s.role_id,'opening','p')) then raise exception 'NOT_ALLOWED:opening:p'; end if;
    select coalesce(sum(dr - cr),0) into diff from public._gl_rows(null, null) where account = '3103';
    if abs(diff) > 0.009 then raise exception 'NOT_BALANCED'; end if;
  elsif s.role_id <> 'owner' then raise exception 'ONLY_OWNER'; end if;
  update public.store set opening_locked = p_lock, updated_at = now() where id = 1;
  perform public._audit(s, case when p_lock then 'اعتماد وإقفال الأرصدة الافتتاحية' else 'فتح الأرصدة الافتتاحية للتعديل' end, null, null, null, null, null);
end $$;

-- report screens read the ledger with «reports» or «gl» view rights
create or replace function public.fin_rows(p_token text, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'gl','v') or public._can(s.role_id,'reports','v') or public._can(s.role_id,'basis','v') or public._can(s.role_id,'flow','v') or public._can(s.role_id,'capital','v') or public._can(s.role_id,'opening','v')) then raise exception 'NOT_ALLOWED:reports'; end if;
  if (select hide_cost from public.roles where id = s.role_id) then raise exception 'NOT_ALLOWED:cost'; end if;
  return coalesce((select jsonb_agg(jsonb_build_array(r.d, r.src, r.ref, r.account, r.dr, r.cr, r.loc)) from public._gl_rows(p_from, p_to) r), '[]'::jsonb);
end $$;

-- =====================================================================
-- TAX INVOICES (A4) & E-INVOICE QUEUE
-- =====================================================================
create table public.tax_invoices (
  id serial primary key,
  no text not null unique,
  sale_id uuid not null unique references public.sales(id),
  buyer_name text, buyer_tin text, buyer_address text,
  issued_by uuid references public.staff(id),
  issued_at timestamptz not null default now(),
  prints int not null default 1
);
create sequence public.taxinv_no_seq start 1;
create table public.einv_docs (
  sale_id uuid primary key references public.sales(id),
  kind text not null check (kind in ('B2C','B2B')),
  status text not null default 'ready' check (status in ('ready','queued','valid','invalid','cancelled')),
  uuid text,
  errors text,
  updated_by uuid references public.staff(id),
  updated_at timestamptz not null default now()
);
alter table public.tax_invoices enable row level security;
alter table public.einv_docs enable row level security;

create or replace function public.tax_invoice_issue(p_token text, p_sale uuid, p_buyer jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sa public.sales; t public.tax_invoices;
begin
  s := public._session(p_token); perform public._fin_right(s,'taxinv','r');
  if not (select vat_registered from public.store) then raise exception 'VAT_OFF'; end if;
  select * into sa from public.sales where id = p_sale;
  if sa.id is null or sa.status <> 'posted' then raise exception 'NOT_FOUND'; end if;
  if not public._loc_ok(s, sa.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  if coalesce(p_buyer->>'tin','') <> '' and (p_buyer->>'tin') !~ '^[0-9]{9}$' then raise exception 'BAD_RIN'; end if;
  select * into t from public.tax_invoices where sale_id = sa.id;
  if t.id is null then
    insert into public.tax_invoices (no, sale_id, buyer_name, buyer_tin, buyer_address, issued_by)
    values ('TI-' || to_char(now() at time zone 'Africa/Cairo','YYYY') || '-' || lpad(nextval('public.taxinv_no_seq')::text,5,'0'), sa.id, nullif(trim(p_buyer->>'name'),''), nullif(trim(p_buyer->>'tin'),''), nullif(trim(p_buyer->>'address'),''), s.staff_id)
    returning * into t;
    perform public._audit(s,'إصدار فاتورة ضريبية',t.no,null,sa.no,null,sa.location_id);
  else
    update public.tax_invoices set prints = prints + 1 where id = t.id returning * into t;
    perform public._audit(s,'إعادة طباعة فاتورة ضريبية',t.no,null,'نسخة ' || t.prints,null,sa.location_id);
  end if;
  return jsonb_build_object('no', t.no, 'prints', t.prints, 'buyer_name', t.buyer_name, 'buyer_tin', t.buyer_tin, 'buyer_address', t.buyer_address, 'issued_at', t.issued_at);
end $$;

create or replace function public.einv_set(p_token text, p_sales uuid[], p_status text, p_uuid text, p_error text) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; n int;
begin
  s := public._session(p_token); perform public._fin_right(s,'einv','e');
  if not (select vat_registered from public.store) then raise exception 'VAT_OFF'; end if;
  if p_status not in ('ready','queued','valid','invalid','cancelled') then raise exception 'BAD_STATUS'; end if;
  insert into public.einv_docs (sale_id, kind, status, uuid, errors, updated_by)
  select sa.id, case when exists (select 1 from public.tax_invoices t where t.sale_id = sa.id and t.buyer_tin is not null) then 'B2B' else 'B2C' end, p_status, nullif(p_uuid,''), nullif(p_error,''), s.staff_id
    from public.sales sa where sa.id = any(p_sales) and sa.status = 'posted'
  on conflict (sale_id) do update set status = excluded.status, uuid = coalesce(excluded.uuid, public.einv_docs.uuid), errors = excluded.errors, updated_by = excluded.updated_by, updated_at = now();
  get diagnostics n = row_count;
  perform public._audit(s,'حالة إيصال إلكتروني',n || ' فاتورة',null,p_status,p_error,null);
  return n;
end $$;

create or replace function public.tax_settings_save(p_token text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm','acct') then raise exception 'NOT_ALLOWED:settings'; end if;
  update public.store set tax = p, updated_at = now() where id = 1;
  perform public._audit(s,'بيانات المنظومة الضريبية',null,null,p->>'env',null,null);
end $$;

-- =====================================================================
-- FINAL REPORTS ARCHIVE (versions never change)
-- =====================================================================
create table public.final_reports (
  id serial primary key,
  period_from date not null, period_to date not null,
  edition text not null check (edition in ('partners','audit')),
  provisional boolean not null,
  hash text not null,
  html text not null,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
alter table public.final_reports enable row level security;
create or replace function public._final_block() returns trigger language plpgsql as $$ begin raise exception 'final_reports is append-only'; end $$;
create trigger final_reports_block before update or delete on public.final_reports for each row execute function public._final_block();

create or replace function public.final_report_save(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; nid int; h text;
begin
  s := public._session(p_token);
  if not (s.role_id = 'owner' or public._has(s.role_id, case when p->>'edition' = 'audit' then 'finalAudit' else 'finalReports' end)) then raise exception 'NOT_ALLOWED:finalReports'; end if;
  h := encode(digest(p->>'html', 'sha256'), 'hex');
  insert into public.final_reports (period_from, period_to, edition, provisional, hash, html, created_by)
  values ((p->>'from')::date, (p->>'to')::date, p->>'edition', coalesce((p->>'provisional')::boolean,true), h, p->>'html', s.staff_id) returning id into nid;
  perform public._audit(s,'تقرير نهائي',(p->>'from') || ' ← ' || (p->>'to'),null,(p->>'edition') || ' · ' || left(h,16),null,null);
  return nid;
end $$;

-- ---------- read access ----------
do $$ declare t text; begin foreach t in array array['partners','capital_moves','fixed_assets','tax_invoices','einv_docs'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy "devices read" on public.%I for select to authenticated using (public.is_device())', t);
end loop; end $$;
create policy "devices read" on public.final_reports for select to authenticated using (public.is_device());

-- the reset learns the new tables (they reference sales, so they must be emptied together)
create or replace function public.system_reset(p_token text, p_level text, p_pin text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; moves text[] := array['stock','stock_layers','stock_moves','serials','transfers','transfer_lines','shifts','cash_moves','sales','sale_lines','sale_payments',
          'held_sales','finance_receivables','returns','return_lines','purchase_invoices','purchase_lines','supplier_payments','service_tickets','gl_manual','gl_manual_lines',
          'gl_periods','gl_years','expenses','day_closings','loyalty_moves','deliveries','label_prints','capital_moves','tax_invoices','einv_docs'];
        master text[] := array['items','item_groups','customers','suppliers','finance_companies','finance_plans','warranty_rules','offers','commission_rules','commission_tiers',
          'staff_targets','item_rules','partners','fixed_assets'];
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
create or replace function public._gl_rows(p_from date, p_to date)
returns table (d date, src text, ref text, memo text, account text, dr numeric, cr numeric, loc smallint)
language sql stable security definer set search_path = public as $$
  with sm as (select m.*, (m.created_at at time zone 'Africa/Cairo')::date as dd from public.stock_moves m),
  cm as (select m.*, case when m.ref_type = 'expense' then coalesce((select e.exp_date from public.expenses e where e.no = m.ref_id and m.amount < 0), (m.created_at at time zone 'Africa/Cairo')::date)
                          else (m.created_at at time zone 'Africa/Cairo')::date end as dd,
                     case when m.ref_type = 'expense' then (select e.location_id from public.expenses e where e.no = m.ref_id) end as loc
               from public.cash_moves m),
  sale_lines_gl as (   -- the sale entry (revenue side + money side); a void posts its exact mirror
    select s.business_day d, s.no ref, s.location_id loc, s.id sale_id, x.account, x.dr, x.cr from public.sales s
    cross join lateral (
      select '4101'::text account, 0::numeric dr, (s.total - s.vat) cr union all
      select '2104', 0, s.vat where s.vat <> 0 union all
      select public._cash_gl(c.account_id, c.method), c.amount, 0 from public.cash_moves c where c.ref_type = 'sale' and c.ref_id = s.no and c.kind = 'sale' union all
      select '1104', p.amount, 0 from public.sale_payments p where p.sale_id = s.id and p.method = 'inst' union all
      select '5209', s.fin_commission, 0 where s.fin_commission <> 0 union all
      select '1104', 0, s.fin_commission where s.fin_commission <> 0
    ) x
  )
  select * from (
    -- sales
    select g.d, 'sale', g.ref, 'فاتورة بيع ' || g.ref, g.account, g.dr, g.cr, g.loc from sale_lines_gl g
    union all
    -- voids: mirror on the void date
    select (select min(dd) from sm where sm.kind = 'void' and sm.ref_id = g.ref), 'void', g.ref, 'إلغاء ' || g.ref, g.account, g.cr, g.dr, g.loc
      from sale_lines_gl g join public.sales s on s.id = g.sale_id where s.status = 'void'
    union all
    -- stock movements at cost
    select sm.dd, 'stock', coalesce(sm.ref_id, sm.kind), case sm.kind when 'opening' then 'رصيد أول المدة' when 'purchase' then 'استلام مشتريات' when 'sale' then 'تكلفة مبيعات'
             when 'return' then 'مرتجع للمخزون' when 'void' then 'إلغاء — رجوع للمخزون' when 'transfer_out' then 'تحويل خارج' when 'transfer_in' then 'تحويل داخل' when 'waste' then 'فاقد' else 'تسوية' end,
           a.account, a.dr, a.cr, sm.location_id
      from sm cross join lateral (
        select case when (sm.kind = 'waste' and sm.ref_type = 'return') then null
                    when sm.kind in ('opening','purchase','return','void','transfer_in') or (sm.kind = 'adjust' and sm.qty > 0) then '1106'
                    when sm.kind = 'sale' then '5101' when sm.kind = 'transfer_out' then '1109' when sm.kind = 'waste' then '5206'
                    when sm.kind = 'adjust' and sm.ref_type = 'warranty' then '1108' else '5207' end account, sm.cost dr, 0::numeric cr
        union all
        select case when (sm.kind = 'waste' and sm.ref_type = 'return') then null
                    when sm.kind = 'opening' then '3103' when sm.kind = 'purchase' then '2101' when sm.kind in ('return','void') then '5101'
                    when sm.kind = 'transfer_in' then '1109' when sm.kind = 'waste' and sm.ref_type = 'transfer' then '1109'
                    when sm.kind = 'adjust' and sm.qty > 0 and sm.ref_type = 'warranty' then '1108' when sm.kind = 'adjust' and sm.qty > 0 then '4103'
                    else '1106' end, 0, sm.cost
      ) a where a.account is not null and sm.cost <> 0
    union all
    -- purchase invoice discount
    select pi.inv_date, 'purchase', pi.no, 'خصم فاتورة شراء ' || pi.no, x.account, x.dr, x.cr, pi.location_id
      from public.purchase_invoices pi cross join lateral (select '2101' account, pi.discount dr, 0::numeric cr union all select '4103', 0, pi.discount) x where pi.discount <> 0
    union all
    -- supplier opening balances
    select coalesce(su.opening_date, (su.created_at at time zone 'Africa/Cairo')::date), 'opening', 'SUP-' || su.id, 'رصيد أول المدة — ' || su.name, x.account, x.dr, x.cr, null::smallint
      from public.suppliers su cross join lateral (select '3103' account, su.opening_balance dr, 0::numeric cr union all select '2101', 0, su.opening_balance) x where su.opening_balance <> 0
    union all
    -- returns: revenue side
    select (r.created_at at time zone 'Africa/Cairo')::date, 'return', r.no, 'مرتجع ' || r.no, x.account, x.dr, x.cr, r.location_id
      from public.returns r join public.sales s on s.id = r.sale_id
      cross join lateral (
        select '4102' account, round(r.amount - r.amount * s.vat / nullif(s.total,0), 2) dr, 0::numeric cr union all
        select '2104', round(r.amount * s.vat / nullif(s.total,0), 2), 0 where s.vat <> 0 union all
        select case when r.refund_method = 'credit' then '2103' when r.refund_method = 'cash' then '1102' else '1103' end, 0, r.amount
      ) x
    union all
    -- returns: damaged goods written off (cost leaves COGS into waste)
    select (r.created_at at time zone 'Africa/Cairo')::date, 'return', r.no, 'مرتجع تالف ' || r.no, x.account, x.dr, x.cr, r.location_id
      from public.return_lines rl join public.returns r on r.id = rl.return_id
      cross join lateral (select '5206' account, rl.cost dr, 0::numeric cr union all select '5101', 0, rl.cost) x where rl.condition = 'damaged' and rl.cost <> 0
    union all
    -- cash movements that are not part of a sale / refund
    select cm.dd, case when cm.ref_type = 'expense' then 'expense' else 'cash' end, coalesce(cm.ref_id, cm.kind), coalesce(cm.note, cm.kind), x.account, x.dr, x.cr, cm.loc
      from cm cross join lateral (
        select public._cash_gl(cm.account_id, cm.method) account, greatest(cm.amount,0) dr, greatest(-cm.amount,0) cr
        union all
        select case when cm.gl_account is not null then cm.gl_account
                    when cm.kind in ('float','deposit') and cm.ref_type is distinct from 'finance' then '1110'
                    when cm.kind = 'deposit' and cm.ref_type = 'finance' then '1104'
                    when cm.kind = 'adjust' then case when cm.amount < 0 then '5207' else '4103' end
                    when cm.kind = 'expense' and cm.ref_type = 'supplier' then '2101'
                    when cm.kind = 'opening' then '3103' else '5207' end,
               greatest(-cm.amount,0), greatest(cm.amount,0)
      ) x where cm.kind not in ('sale','refund') and cm.amount <> 0
    union all
    -- finance company paid less than the expected net → extra commission
    select fr.received_on, 'cash', fr.ref, 'فرق تحويل شركة تقسيط', x.account, x.dr, x.cr, fr.location_id
      from public.finance_receivables fr cross join lateral (select '5209' account, (fr.net - fr.received) dr, 0::numeric cr union all select '1104', 0, fr.net - fr.received) x
     where fr.status = 'settled' and fr.received <> fr.net
    union all
    -- supplier credit notes (warranty claims)
    select (sp.created_at at time zone 'Africa/Cairo')::date, 'supplier', sp.no, coalesce(sp.note,'إشعار دائن مورد'), x.account, x.dr, x.cr, null::smallint
      from public.supplier_payments sp cross join lateral (select '2101' account, sp.amount dr, 0::numeric cr union all select '1108', 0, sp.amount) x where sp.method = 'credit'
    union all
    -- straight-line depreciation of the fixed-asset register, one entry at each month end
    select x.me, 'depreciation', 'FA-' || fa.id, 'إهلاك ' || fa.name, y.account, y.dr, y.cr, fa.location_id
      from public.fixed_assets fa
      cross join lateral (select (date_trunc('month', gs) + interval '1 month - 1 day')::date me
                            from generate_series(date_trunc('month', fa.start_date) + interval '1 month', date_trunc('month', least(coalesce(fa.disposed_on, current_date), current_date)), interval '1 month') gs
                           limit greatest(fa.life_months,0)) x
      cross join lateral (select '5208'::text account, round((fa.start_value - fa.salvage) / nullif(fa.life_months,0), 2) dr, 0::numeric cr
                          union all select '1202', 0, round((fa.start_value - fa.salvage) / nullif(fa.life_months,0), 2)) y
     where fa.life_months > 0 and x.me <= current_date
    union all
    -- manual, opening & closing entries (approved only)
    select m.entry_date, m.kind, m.no, m.memo, l.account, l.dr, l.cr, null::smallint
      from public.gl_manual m join public.gl_manual_lines l on l.entry_id = m.id where m.status = 'approved'
  ) all_rows
  where d between coalesce(p_from, date '2000-01-01') and coalesce(p_to, date '2999-12-31') and (dr <> 0 or cr <> 0);
$$;
revoke execute on function public._fin_right(public.sess,text,text), public._final_block(), public._gl_rows(date,date) from public, anon, authenticated;
revoke execute on function public.partner_save(text,jsonb), public.capital_move(text,jsonb), public.asset_save(text,jsonb), public.opening_save(text,jsonb), public.opening_lock(text,boolean),
  public.fin_rows(text,date,date), public.tax_invoice_issue(text,uuid,jsonb), public.einv_set(text,uuid[],text,text,text), public.tax_settings_save(text,jsonb), public.final_report_save(text,jsonb) from public, anon;
grant execute on function public.partner_save(text,jsonb), public.capital_move(text,jsonb), public.asset_save(text,jsonb), public.opening_save(text,jsonb), public.opening_lock(text,boolean),
  public.fin_rows(text,date,date), public.tax_invoice_issue(text,uuid,jsonb), public.einv_set(text,uuid[],text,text,text), public.tax_settings_save(text,jsonb), public.final_report_save(text,jsonb) to authenticated;
