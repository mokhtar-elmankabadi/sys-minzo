-- SYS Minzo · phase 2c · general ledger (derived from source documents + approved manual entries), periods,
-- store & VAT settings, salesperson commission rules and report

-- ---------- shifts: the float comes from the treasury and goes back to it at approval (keeps cash accounts true) ----------
create or replace function public.shift_open(p_token text, p_float numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.sess; dr int; tr int; nid uuid;
begin
  s := public._session(p_token); perform public._require(s,'pos','a');
  if s.device_location is null then raise exception 'DEVICE_HAS_NO_LOCATION'; end if;
  dr := public._drawer_of(s.device_location); if dr is null then raise exception 'NO_DRAWER'; end if;
  if exists (select 1 from public.shifts where drawer_id = dr and status = 'open') then raise exception 'SHIFT_ALREADY_OPEN'; end if;
  select id into tr from public.cash_accounts where kind = 'treasury' and active order by id limit 1;
  insert into public.shifts (location_id, device_id, drawer_id, cashier_id, opening_float) values (s.device_location, s.device_id, dr, s.staff_id, coalesce(p_float,0)) returning id into nid;
  if coalesce(p_float,0) > 0 then
    insert into public.cash_moves (account_id, amount, kind, method, shift_id, note, staff_id) values
      (dr, p_float, 'float', 'cash', nid, 'رصيد فتح الوردية', s.staff_id),
      (tr, -p_float, 'float', 'cash', null, 'فكّة لدرج الوردية', s.staff_id);
  end if;
  perform public._audit(s,'فتح وردية',(select name from public.cash_accounts where id = dr),null,p_float::text,null,s.device_location);
  return nid;
end $$;

create or replace function public.shift_approve(p_token text, p_shift uuid, p_to_treasury numeric) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; sh public.shifts; tr int; keep numeric;
begin
  s := public._session(p_token); perform public._require(s,'close','p');
  select * into sh from public.shifts where id = p_shift for update;
  if sh.status <> 'handed' then raise exception 'NOT_HANDED'; end if;
  if not public._loc_ok(s, sh.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  if sh.cashier_id = s.staff_id and s.role_id <> 'owner' then raise exception 'CANNOT_APPROVE_OWN_SHIFT'; end if;
  if coalesce(p_to_treasury,0) > sh.counted_cash then raise exception 'MORE_THAN_COUNTED'; end if;
  select id into tr from public.cash_accounts where kind = 'treasury' and active order by id limit 1;
  update public.shifts set status = 'approved', approved_by = s.staff_id, approved_at = now() where id = sh.id;
  if coalesce(sh.diff,0) <> 0 then
    insert into public.cash_moves (account_id, amount, kind, method, note, staff_id, ref_type, ref_id)
    values (sh.drawer_id, sh.diff, 'adjust', 'cash', case when sh.diff < 0 then 'عجز وردية' else 'زيادة وردية' end, s.staff_id, 'shift', sh.id::text);
  end if;
  if coalesce(p_to_treasury,0) > 0 then
    insert into public.cash_moves (account_id, amount, kind, method, note, staff_id, ref_type, ref_id) values
      (sh.drawer_id, -p_to_treasury, 'deposit', 'cash', 'توريد للخزنة', s.staff_id, 'shift', sh.id::text),
      (tr, p_to_treasury, 'deposit', 'cash', 'توريد من الدرج', s.staff_id, 'shift', sh.id::text);
  end if;
  keep := sh.counted_cash - coalesce(p_to_treasury,0);
  if keep > 0 then   -- the float that stays in the drawer is carried in the books by the treasury until the next shift opens with it
    insert into public.cash_moves (account_id, amount, kind, method, note, staff_id, ref_type, ref_id) values
      (sh.drawer_id, -keep, 'float', 'cash', 'فكّة باقية في الدرج', s.staff_id, 'shift', sh.id::text),
      (tr, keep, 'float', 'cash', 'فكّة باقية في الدرج', s.staff_id, 'shift', sh.id::text);
  end if;
  perform public._audit(s,'اعتماد تسليم وردية',sh.id::text,null,coalesce(p_to_treasury,0)::text,null,sh.location_id);
end $$;

-- cost review also corrects the stock-move cost so the ledger follows
create or replace function public.purchase_set_costs(p_token text, p_invoice uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; pi public.purchase_invoices; ln jsonb; pl public.purchase_lines; g numeric := 0;
begin
  s := public._session(p_token); perform public._require(s,'suppliers','e');
  if (select hide_cost from public.roles where id = s.role_id) then raise exception 'NOT_ALLOWED:cost'; end if;
  select * into pi from public.purchase_invoices where id = p_invoice for update;
  for ln in select * from jsonb_array_elements(p_lines) loop
    select * into pl from public.purchase_lines where id = (ln->>'line_id')::bigint and invoice_id = pi.id;
    if pl.id is null then continue; end if;
    update public.purchase_lines set unit_cost = (ln->>'unit_cost')::numeric where id = pl.id;
    update public.stock_layers set unit_cost = (ln->>'unit_cost')::numeric where item_id = pl.item_id and location_id = pi.location_id and ref = pi.no;
    update public.stock_moves set cost = round(pl.qty * (ln->>'unit_cost')::numeric, 2) where item_id = pl.item_id and ref_type = 'purchase' and ref_id = pi.no;
    update public.items set last_cost = (ln->>'unit_cost')::numeric, updated_at = now() where id = pl.item_id;
  end loop;
  select sum(qty * unit_cost) into g from public.purchase_lines where invoice_id = pi.id;
  update public.purchase_invoices set gross = round(g,2), total = round(g - discount,2), cost_pending = false where id = pi.id;
  perform public._audit(s,'مراجعة تكلفة فاتورة شراء',pi.no,pi.total::text,round(g - pi.discount,2)::text,null,pi.location_id);
end $$;

-- ---------- chart of accounts ----------
update public.roles set perms = perms || '{"gl":"vaepxr"}' where id = 'acct';
update public.roles set perms = perms || '{"gl":"vaxr"}'   where id = 'asstacct';

create table public.gl_accounts (
  code text primary key,
  name text not null,
  name_en text,
  kind text not null check (kind in ('A','L','E','R','X')),
  parent text references public.gl_accounts(code),
  system boolean not null default false
);
insert into public.gl_accounts (code, name, name_en, kind, parent, system) values
 ('1','الأصول','Assets','A',null,true),('11','الأصول المتداولة','Current assets','A','1',true),
 ('1101','الخزنة الرئيسية','Main treasury','A','11',true),('1102','أدراج الكاشير','Cashier drawers','A','11',true),('1103','البنوك والمحافظ','Banks & wallets','A','11',true),
 ('1104','مستحقات شركات التقسيط','Due from finance companies','A','11',true),('1105','عملاء ومدينون','Receivables','A','11',true),('1106','المخزون','Inventory','A','11',true),
 ('1108','مستحق على الموردين — ضمان','Supplier warranty claims','A','11',true),('1109','بضاعة في الطريق (تحويلات)','Goods in transit','A','11',true),('1110','تحويلات بين الخزائن','Cash transfers clearing','A','11',true),
 ('12','الأصول الثابتة','Fixed assets','A','1',true),('1201','الأصول الثابتة','Fixed assets','A','12',true),
 ('2','الخصوم','Liabilities','L',null,true),('2101','الموردين','Suppliers','L','2',true),('2102','مصروفات مستحقة','Accrued expenses','L','2',true),
 ('2103','أرصدة دائنة للعملاء','Customer credit','L','2',true),('2104','ضريبة القيمة المضافة المستحقة','VAT payable','L','2',true),
 ('3','حقوق الملكية','Equity','E',null,true),('3101','رأس المال','Capital','E','3',true),('3102','الأرباح المحتجزة','Retained earnings','E','3',true),('3103','أرصدة افتتاحية','Opening balances','E','3',true),
 ('4','الإيرادات','Revenue','R',null,true),('4101','المبيعات','Sales','R','4',true),('4102','مردودات المبيعات','Sales returns','R','4',true),('4103','إيرادات أخرى وخصم مكتسب','Other income','R','4',true),
 ('5','التكاليف والمصروفات','Costs & expenses','X',null,true),('5101','تكلفة البضاعة المباعة','Cost of goods sold','X','5',true),
 ('52','مصروفات التشغيل','Operating expenses','X','5',true),('5201','مرتبات وأجور','Salaries','X','52',true),('5202','إيجارات','Rent','X','52',true),('5203','كهرباء ومرافق','Utilities','X','52',true),
 ('5204','نقل وشحن','Transport','X','52',true),('5205','دعاية وتسويق','Advertising','X','52',true),('5206','تالف وفاقد','Damage & waste','X','52',true),('5207','مصروفات متنوعة وعجز','Sundry & shortages','X','52',true),
 ('5208','إهلاك','Depreciation','X','52',true),('5209','عمولات شركات التقسيط','Finance-company commission','X','52',true),('5210','صيانة','Maintenance','X','52',true);

create table public.gl_manual (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  entry_date date not null,
  memo text not null,
  kind text not null default 'manual' check (kind in ('manual','closing')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by uuid references public.staff(id),
  approved_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create table public.gl_manual_lines (
  id bigserial primary key,
  entry_id uuid not null references public.gl_manual(id) on delete cascade,
  account text not null references public.gl_accounts(code),
  dr numeric(14,2) not null default 0 check (dr >= 0),
  cr numeric(14,2) not null default 0 check (cr >= 0)
);
create table public.gl_periods (month text primary key, closed_by uuid references public.staff(id), closed_at timestamptz not null default now());
create table public.gl_years (year int primary key, closed_by uuid references public.staff(id), closed_at timestamptz not null default now());
create sequence public.jv_no_seq start 1;
do $$ declare t text; begin foreach t in array array['gl_accounts','gl_manual','gl_manual_lines','gl_periods','gl_years'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy "devices read" on public.%I for select to authenticated using (public.is_device())', t);
end loop; end $$;

create or replace function public._cash_gl(p_account int, p_method text) returns text
language sql stable security definer set search_path = public as $$
  select case when p_method is not null and p_method not in ('cash') then '1103'
              else (select case kind when 'drawer' then '1102' when 'treasury' then '1101' else '1103' end from public.cash_accounts where id = p_account) end;
$$;

-- every posting, derived from the documents (never edited by hand) + approved manual & closing entries
create or replace function public._gl_rows(p_from date, p_to date)
returns table (d date, src text, ref text, memo text, account text, dr numeric, cr numeric, loc smallint)
language sql stable security definer set search_path = public as $$
  with sm as (select m.*, (m.created_at at time zone 'Africa/Cairo')::date as dd from public.stock_moves m),
  cm as (select m.*, (m.created_at at time zone 'Africa/Cairo')::date as dd from public.cash_moves m),
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
    select cm.dd, 'cash', coalesce(cm.ref_id, cm.kind), coalesce(cm.note, cm.kind), x.account, x.dr, x.cr, null::smallint
      from cm cross join lateral (
        select public._cash_gl(cm.account_id, cm.method) account, greatest(cm.amount,0) dr, greatest(-cm.amount,0) cr
        union all
        select case when cm.kind in ('float','deposit') and cm.ref_type is distinct from 'finance' then '1110'
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
    -- manual & closing entries (approved only)
    select m.entry_date, m.kind, m.no, m.memo, l.account, l.dr, l.cr, null::smallint
      from public.gl_manual m join public.gl_manual_lines l on l.entry_id = m.id where m.status = 'approved'
  ) all_rows
  where d between coalesce(p_from, date '2000-01-01') and coalesce(p_to, date '2999-12-31') and (dr <> 0 or cr <> 0);
$$;

create or replace function public.gl_journal(p_token text, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'gl','v')) then raise exception 'NOT_ALLOWED:gl'; end if;
  return coalesce((select jsonb_agg(jsonb_build_array(r.d, r.src, r.ref, r.memo, r.account, r.dr, r.cr, r.loc) order by r.d, r.ref) from public._gl_rows(p_from, p_to) r), '[]'::jsonb);
end $$;

create or replace function public._gl_locked(p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gl_periods where month = to_char(p_date,'YYYY-MM')) or exists (select 1 from public.gl_years where year = extract(year from p_date)::int);
$$;

create or replace function public.gl_manual_save(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; ln jsonb; v_dr numeric := 0; v_cr numeric := 0; eid uuid; v_no text; v_d date := (p->>'date')::date; n int := 0;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'gl','a')) then raise exception 'NOT_ALLOWED:gl'; end if;
  if coalesce(trim(p->>'memo'),'') = '' then raise exception 'MEMO_REQUIRED'; end if;
  if public._gl_locked(v_d) then raise exception 'PERIOD_CLOSED'; end if;
  for ln in select * from jsonb_array_elements(coalesce(p->'lines','[]')) loop
    if coalesce((ln->>'dr')::numeric,0) > 0 and coalesce((ln->>'cr')::numeric,0) > 0 then raise exception 'LINE_BOTH_SIDES'; end if;
    if exists (select 1 from public.gl_accounts a where a.parent = ln->>'account') then raise exception 'NOT_LEAF_ACCOUNT'; end if;
    v_dr := v_dr + coalesce((ln->>'dr')::numeric,0); v_cr := v_cr + coalesce((ln->>'cr')::numeric,0); n := n + 1;
  end loop;
  if n < 2 or v_dr <= 0 or abs(v_dr - v_cr) > 0.004 then raise exception 'NOT_BALANCED'; end if;
  v_no := 'JV-' || lpad(nextval('public.jv_no_seq')::text, 5, '0');
  insert into public.gl_manual (no, entry_date, memo, status, created_by, approved_by)
  values (v_no, v_d, trim(p->>'memo'), case when s.role_id = 'owner' then 'approved' else 'pending' end, s.staff_id, case when s.role_id = 'owner' then s.staff_id end) returning id into eid;
  insert into public.gl_manual_lines (entry_id, account, dr, cr)
  select eid, x->>'account', coalesce((x->>'dr')::numeric,0), coalesce((x->>'cr')::numeric,0) from jsonb_array_elements(p->'lines') x
   where coalesce((x->>'dr')::numeric,0) > 0 or coalesce((x->>'cr')::numeric,0) > 0;
  perform public._audit(s,'قيد يدوي',v_no,null,v_dr::text,p->>'memo',null);
  return jsonb_build_object('no', v_no, 'status', case when s.role_id = 'owner' then 'approved' else 'pending' end);
end $$;

create or replace function public.gl_manual_decide(p_token text, p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; m public.gl_manual;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'gl','p')) then raise exception 'NOT_ALLOWED:gl'; end if;
  select * into m from public.gl_manual where id = p_id for update;
  if m.status <> 'pending' then raise exception 'BAD_STATUS'; end if;
  if m.created_by = s.staff_id and s.role_id <> 'owner' then raise exception 'CANNOT_APPROVE_OWN'; end if;
  if p_ok and public._gl_locked(m.entry_date) then raise exception 'PERIOD_CLOSED'; end if;
  update public.gl_manual set status = case when p_ok then 'approved' else 'rejected' end, approved_by = s.staff_id where id = p_id;
  perform public._audit(s,case when p_ok then 'اعتماد قيد يدوي' else 'رفض قيد يدوي' end,m.no,null,null,null,null);
end $$;

create or replace function public.gl_account_save(p_token text, p_parent text, p_name text, p_name_en text) returns text
language plpgsql security definer set search_path = public as $$
declare s public.sess; par public.gl_accounts; v_code text; n int := 1; ln int;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'gl','p')) then raise exception 'NOT_ALLOWED:gl'; end if;
  select * into par from public.gl_accounts where code = p_parent;
  if par.code is null or coalesce(trim(p_name),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  ln := case when length(par.code) <= 2 then 4 else length(par.code) + 2 end;
  loop
    v_code := par.code || lpad(((select count(*) from public.gl_accounts where parent = par.code) + n)::text, ln - length(par.code), '0');
    exit when not exists (select 1 from public.gl_accounts where code = v_code); n := n + 1;
  end loop;
  insert into public.gl_accounts (code, name, name_en, kind, parent) values (v_code, trim(p_name), coalesce(nullif(trim(p_name_en),''), trim(p_name)), par.kind, par.code);
  perform public._audit(s,'إضافة حساب',v_code||' · '||p_name,null,null,null,null);
  return v_code;
end $$;

create or replace function public.gl_period_set(p_token text, p_month text, p_close boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if p_close then
    if not (s.role_id in ('owner','gm') or public._can(s.role_id,'gl','p')) then raise exception 'NOT_ALLOWED:gl'; end if;
    insert into public.gl_periods (month, closed_by) values (p_month, s.staff_id) on conflict do nothing;
  else
    if s.role_id <> 'owner' then raise exception 'ONLY_OWNER'; end if;
    if exists (select 1 from public.gl_years where year = left(p_month,4)::int) then raise exception 'YEAR_CLOSED'; end if;
    delete from public.gl_periods where month = p_month;
  end if;
  perform public._audit(s,case when p_close then 'إقفال فترة' else 'إعادة فتح فترة' end,p_month,null,null,null,null);
end $$;

create or replace function public.gl_year_close(p_token text, p_year int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; eid uuid; v_no text; np numeric; m int;
begin
  s := public._session(p_token);
  if s.role_id <> 'owner' then raise exception 'ONLY_OWNER'; end if;
  if exists (select 1 from public.gl_years where year = p_year) then raise exception 'YEAR_CLOSED'; end if;
  v_no := 'CLS-' || p_year;
  insert into public.gl_manual (no, entry_date, memo, kind, status, created_by, approved_by) values (v_no, make_date(p_year,12,31), 'قيد إقفال سنة ' || p_year, 'closing', 'approved', s.staff_id, s.staff_id) returning id into eid;
  insert into public.gl_manual_lines (entry_id, account, dr, cr)
  select eid, r.account, greatest(sum(r.cr) - sum(r.dr),0), greatest(sum(r.dr) - sum(r.cr),0)
    from public._gl_rows(make_date(p_year,1,1), make_date(p_year,12,31)) r join public.gl_accounts a on a.code = r.account
   where a.kind in ('R','X') and r.src <> 'closing' group by r.account having sum(r.dr) <> sum(r.cr);
  select coalesce(sum(l.dr) - sum(l.cr),0) into np from public.gl_manual_lines l where l.entry_id = eid;   -- dr − cr of closing lines = net profit
  insert into public.gl_manual_lines (entry_id, account, dr, cr) values (eid, '3102', greatest(-np,0), greatest(np,0));
  insert into public.gl_years (year, closed_by) values (p_year, s.staff_id);
  for m in 1..12 loop insert into public.gl_periods (month, closed_by) values (p_year || '-' || lpad(m::text,2,'0'), s.staff_id) on conflict do nothing; end loop;
  perform public._audit(s,'إقفال سنوي',p_year::text,null,np::text,null,null);
  return jsonb_build_object('no', v_no, 'net_profit', np);
end $$;

-- ---------- store & VAT settings ----------
create or replace function public.store_save(p_token text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; b public.store;
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm') then raise exception 'NOT_ALLOWED:settings'; end if;
  select * into b from public.store where id = 1 for update;
  if coalesce((p->>'vat_registered')::boolean, b.vat_registered) and not b.vat_registered then
    if s.role_id <> 'owner' then raise exception 'ONLY_OWNER'; end if;
    if coalesce(p->>'vat_rin','') !~ '^[0-9]{9}$' then raise exception 'BAD_RIN'; end if;
    if nullif(p->>'vat_from','') is null then raise exception 'VAT_FROM_REQUIRED'; end if;
  end if;
  update public.store set
    name = coalesce(nullif(trim(p->>'name'),''), name),
    vat_registered = coalesce((p->>'vat_registered')::boolean, vat_registered),
    vat_rin = coalesce(nullif(p->>'vat_rin',''), vat_rin),
    vat_from = coalesce(nullif(p->>'vat_from','')::date, vat_from),
    vat_rate = coalesce((p->>'vat_rate')::numeric, vat_rate),
    prices_include_vat = coalesce((p->>'prices_include_vat')::boolean, prices_include_vat),
    price_alert_pct = coalesce((p->>'price_alert_pct')::numeric, price_alert_pct),
    day_close_time = coalesce(nullif(p->>'day_close_time','')::time, day_close_time),
    day_open_time = coalesce(nullif(p->>'day_open_time','')::time, day_open_time),
    updated_at = now()
  where id = 1;
  perform public._audit(s,'تعديل الإعدادات','',to_jsonb(b)::text,p::text,null,null);
end $$;

create or replace function public.item_vat_set(p_token text, p_item uuid, p_rate numeric) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm') then raise exception 'NOT_ALLOWED:settings'; end if;
  update public.items set vat_rate = p_rate, updated_at = now() where id = p_item;
  perform public._audit(s,'نسبة ضريبة لصنف',(select name from public.items where id = p_item),null,coalesce(p_rate::text,'الافتراضي'),null,null);
end $$;

-- ---------- salesperson commission ----------
create table public.commission_rules (
  id serial primary key,
  scope text not null check (scope in ('dept','group','item')),
  ref text not null,                 -- department id / group id / item id
  rate numeric(6,3) not null check (rate >= 0),
  valid_from date, valid_to date
);
create table public.commission_tiers (id serial primary key, pct numeric(6,2) not null, extra_rate numeric(6,3) not null default 0, bonus numeric(14,2) not null default 0);
create table public.staff_targets (staff_id uuid not null references public.staff(id), month text not null, target numeric(14,2) not null, primary key (staff_id, month));
do $$ declare t text; begin foreach t in array array['commission_rules','commission_tiers','staff_targets'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy "devices read" on public.%I for select to authenticated using (public.is_device())', t);
end loop; end $$;

create or replace function public.commission_config_save(p_token text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; x jsonb;
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm','acct') then raise exception 'NOT_ALLOWED:commission'; end if;
  if p ? 'rules' then
    delete from public.commission_rules where id > 0;
    insert into public.commission_rules (scope, ref, rate, valid_from, valid_to)
    select x->>'scope', x->>'ref', (x->>'rate')::numeric, nullif(x->>'valid_from','')::date, nullif(x->>'valid_to','')::date from jsonb_array_elements(p->'rules') x;
  end if;
  if p ? 'tiers' then
    delete from public.commission_tiers where id > 0;
    insert into public.commission_tiers (pct, extra_rate, bonus) select (x->>'pct')::numeric, (x->>'extra_rate')::numeric, coalesce((x->>'bonus')::numeric,0) from jsonb_array_elements(p->'tiers') x;
  end if;
  if p ? 'targets' then
    for x in select * from jsonb_array_elements(p->'targets') loop
      insert into public.staff_targets (staff_id, month, target) values ((x->>'staff_id')::uuid, x->>'month', (x->>'target')::numeric)
      on conflict (staff_id, month) do update set target = excluded.target;
    end loop;
  end if;
  perform public._audit(s,'تعديل قواعد العمولة','',null,null,null,null);
end $$;

-- net sales per salesperson for a month (sales − returns), commission by item → group → department rate, plus the highest tier reached
create or replace function public.commission_report(p_token text, p_month text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; d1 date := (p_month || '-01')::date; d2 date := ((p_month || '-01')::date + interval '1 month - 1 day')::date;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm','acct','mgr') or s.role_id = 'seller') then raise exception 'NOT_ALLOWED:commission'; end if;
  return coalesce((
    with lines as (
      select sa.seller_id, sl.item_id, it.department_id, it.group_id, sa.business_day dd,
             (sl.unit_price * sl.qty - sl.discount) * (case when sa.gross - sa.discount > 0 then (sa.total - sa.vat) / (sa.gross - sa.discount) else 1 end) amt
        from public.sales sa join public.sale_lines sl on sl.sale_id = sa.id join public.items it on it.id = sl.item_id
       where sa.status = 'posted' and sa.seller_id is not null and sa.business_day between d1 and d2
      union all
      select sa.seller_id, rl.item_id, it.department_id, it.group_id, (r.created_at at time zone 'Africa/Cairo')::date, -(rl.amount - rl.amount * sa.vat / nullif(sa.total,0))
        from public.return_lines rl join public.returns r on r.id = rl.return_id join public.sales sa on sa.id = r.sale_id join public.items it on it.id = rl.item_id
       where sa.seller_id is not null and (r.created_at at time zone 'Africa/Cairo')::date between d1 and d2
    ), rated as (
      select l.*, coalesce(
        (select c.rate from public.commission_rules c where c.scope = 'item' and c.ref = l.item_id::text and (c.valid_from is null or l.dd >= c.valid_from) and (c.valid_to is null or l.dd <= c.valid_to) limit 1),
        (select c.rate from public.commission_rules c where c.scope = 'group' and c.ref = l.group_id::text limit 1),
        (select c.rate from public.commission_rules c where c.scope = 'dept' and c.ref = l.department_id::text limit 1), 0) rate
      from lines l
    ), per as (
      select seller_id, round(sum(amt),2) net, round(sum(amt * rate / 100),2) base from rated group by seller_id
    )
    select jsonb_agg(jsonb_build_object('staff_id', per.seller_id, 'name', st.name, 'net', per.net, 'base', per.base, 'target', tg.target,
             'attain', case when tg.target > 0 then round(per.net / tg.target * 100, 1) end, 'tier_pct', tr.pct, 'extra', round(coalesce(per.net * tr.extra_rate / 100,0),2), 'bonus', coalesce(tr.bonus,0),
             'total', round(per.base + coalesce(per.net * tr.extra_rate / 100,0) + coalesce(tr.bonus,0), 2)) order by st.name)
      from per join public.staff st on st.id = per.seller_id
      left join public.staff_targets tg on tg.staff_id = per.seller_id and tg.month = p_month
      left join lateral (select * from public.commission_tiers t where tg.target > 0 and per.net / tg.target * 100 >= t.pct order by t.pct desc limit 1) tr on true
     where s.role_id <> 'seller' or per.seller_id = s.staff_id
  ), '[]'::jsonb);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.setup_status(), public.setup_first_run(text,text,text,text), public.device_register(text),
  public.device_pending(text), public.device_set(text,uuid,text,text,smallint,boolean), public.staff_login(text), public.staff_logout(text),
  public.staff_change_pin(text,text,text), public.staff_list(text), public.staff_save(text,uuid,text,text,smallint,boolean,text), public.staff_directory(text), public.is_device(),
  public.item_save(text,jsonb), public.group_save(text,int,int,text), public.items_import(text,jsonb,smallint,boolean), public.item_brand_set(text,uuid,text), public.item_vat_set(text,uuid,numeric),
  public.shift_open(text,numeric), public.shift_current(text), public.shift_handover(text,jsonb,text), public.shift_approve(text,uuid,numeric),
  public.sale_post(text,jsonb), public.sale_void(text,uuid,text,text),
  public.transfer_create(text,smallint,smallint,jsonb,text), public.transfer_approve(text,uuid), public.transfer_ship(text,uuid), public.transfer_receive(text,uuid,jsonb,text),
  public.held_create(text,jsonb), public.held_take(text,uuid), public.held_cancel(text,uuid),
  public.fin_company_save(text,jsonb), public.fin_settle(text,uuid,numeric,date,text,text), public.return_post(text,uuid,jsonb,text,text,text),
  public.supplier_save(text,jsonb), public.purchase_post(text,jsonb), public.purchase_set_costs(text,uuid,jsonb), public.supplier_pay(text,jsonb),
  public.wrule_save(text,jsonb), public.svc_open(text,jsonb), public.svc_advance(text,uuid,text,text), public.svc_claim_settle(text,uuid,text,text),
  public.gl_journal(text,date,date), public.gl_manual_save(text,jsonb), public.gl_manual_decide(text,uuid,boolean), public.gl_account_save(text,text,text,text),
  public.gl_period_set(text,text,boolean), public.gl_year_close(text,int), public.store_save(text,jsonb),
  public.commission_config_save(text,jsonb), public.commission_report(text,text)
  to authenticated;
