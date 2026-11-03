-- SYS Minzo · phase 2b · suppliers, purchase invoices into FIFO (with price-change alert), supplier payments, warranty & service

update public.roles set perms = perms || '{"suppliers":"vaedpxr"}' where id = 'acct';
update public.roles set perms = perms || '{"suppliers":"vaexr"}'   where id = 'asstacct';
update public.roles set perms = perms || '{"suppliers":"va"}'      where id in ('keeper','dataentry');
update public.roles set perms = perms || '{"suppliers":"v"}'       where id in ('mgr','asstkeeper');
update public.roles set perms = perms || '{"svc":"vaepr"}' where id in ('mgr','asstmgr');
update public.roles set perms = perms || '{"svc":"vae"}'   where id in ('shiftmgr','keeper','promo');
update public.roles set perms = perms || '{"svc":"va"}'    where id in ('seller','cashier');
update public.roles set perms = perms || '{"svc":"v"}'     where id = 'asstkeeper';
update public.roles set perms = perms || '{"svc":"vp"}'    where id = 'acct';

alter table public.store add column price_alert_pct numeric(5,2) not null default 10;
alter table public.items add column brand text;

-- ---------- suppliers ----------
create table public.suppliers (
  id serial primary key,
  name text not null unique,
  kind text not null default 'credit' check (kind in ('credit','cash','consignment')),
  contact text, phone text,
  terms_days int not null default 30,
  credit_limit numeric(14,2) not null default 0,
  alert_days int not null default 3,
  bank_info text,
  opening_balance numeric(14,2) not null default 0,
  opening_date date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  supplier_id int not null references public.suppliers(id),
  supplier_ref text,
  location_id smallint not null references public.locations(id),
  inv_date date not null,
  due_date date not null,
  gross numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  cost_pending boolean not null default false,
  note text,
  staff_id uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create table public.purchase_lines (
  id bigserial primary key,
  invoice_id uuid not null references public.purchase_invoices(id) on delete cascade,
  item_id uuid not null references public.items(id),
  qty numeric(14,3) not null check (qty > 0),
  unit_cost numeric(14,4) not null,
  prev_cost numeric(14,4),
  diff_reason text,
  serials text[]
);
create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  supplier_id int not null references public.suppliers(id),
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('cash','bank','cheque','insta','wallet','credit')),
  account_id int references public.cash_accounts(id),
  ref text, cheque_date date, note text,
  staff_id uuid references public.staff(id),
  approved_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create sequence public.purchase_no_seq start 1;
create sequence public.spay_no_seq start 1;

-- ---------- warranty & service ----------
create table public.warranty_rules (
  id serial primary key,
  brand text not null,                 -- '*' = any other brand
  group_name text not null default '*',-- '*' = all device types
  months int not null default 12,
  action text not null check (action in ('direct','collect','replace')),
  center text, phone text,
  max_days int not null default 14,
  unique (brand, group_name)
);
insert into public.warranty_rules (brand, group_name, months, action, max_days) values ('*','*',12,'collect',14);
create table public.service_tickets (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  serial text not null,
  item_id uuid not null references public.items(id),
  sale_id uuid references public.sales(id),
  customer_name text, phone text,
  sold_on date not null,
  location_id smallint not null references public.locations(id),
  action text not null check (action in ('direct','collect','replace')),
  suggested text not null,
  reason text,
  problem text not null,
  status text not null check (status in ('directed','received','center','back','done','replaced')),
  center text, center_ref text,
  at_center_since timestamptz,
  new_serial text,
  claim_amount numeric(14,2),
  claim_supplier_id int references public.suppliers(id),
  claim_status text check (claim_status in ('open','credited','unit')),
  history jsonb not null default '[]',
  staff_id uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create sequence public.svc_no_seq start 1;

do $$ declare t text; begin foreach t in array array['suppliers','purchase_invoices','purchase_lines','supplier_payments','warranty_rules','service_tickets'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy "devices read" on public.%I for select to authenticated using (public.is_device())', t);
end loop; end $$;

create or replace view public.supplier_balances with (security_invoker = on) as
  select s.id, s.name,
    s.opening_balance + coalesce((select sum(total) from public.purchase_invoices pi where pi.supplier_id = s.id),0)
                      - coalesce((select sum(amount) from public.supplier_payments sp where sp.supplier_id = s.id),0) as balance
  from public.suppliers s;

-- ---------- functions ----------
create or replace function public.supplier_save(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; sid int;
begin
  s := public._session(p_token);
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if (p->>'id') is null then
    perform public._require(s,'suppliers','a');
    insert into public.suppliers (name, kind, contact, phone, terms_days, credit_limit, alert_days, bank_info, opening_balance, opening_date)
    values (trim(p->>'name'), coalesce(p->>'kind','credit'), p->>'contact', p->>'phone', coalesce((p->>'terms_days')::int,30), coalesce((p->>'credit_limit')::numeric,0),
            coalesce((p->>'alert_days')::int,3), p->>'bank_info', coalesce((p->>'opening_balance')::numeric,0), coalesce(nullif(p->>'opening_date','')::date, current_date)) returning id into sid;
    perform public._audit(s,'إضافة مورد',p->>'name',null,p->>'opening_balance',null,null);
  else
    perform public._require(s,'suppliers','e'); sid := (p->>'id')::int;
    update public.suppliers set name = trim(p->>'name'), kind = coalesce(p->>'kind',kind), contact = p->>'contact', phone = p->>'phone', terms_days = coalesce((p->>'terms_days')::int,terms_days),
      credit_limit = coalesce((p->>'credit_limit')::numeric,credit_limit), alert_days = coalesce((p->>'alert_days')::int,alert_days), bank_info = p->>'bank_info',
      active = coalesce((p->>'active')::boolean,active) where id = sid;
    perform public._audit(s,'تعديل مورد',p->>'name',null,null,null,null);
  end if;
  return sid;
end $$;

-- p: {supplier_id, supplier_ref, location_id, inv_date, discount, note, lines:[{item_id, qty, unit_cost, diff_reason, serials:[]}]}
create or replace function public.purchase_post(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sup public.suppliers; st public.store; it public.items; ln jsonb; pid uuid; no text; gross numeric := 0; disc numeric := coalesce((p->>'discount')::numeric,0);
        uc numeric; pend boolean := false; hide boolean; loc smallint := (p->>'location_id')::smallint; sn text; d date := coalesce(nullif(p->>'inv_date','')::date, current_date);
begin
  s := public._session(p_token);
  if not (public._can(s.role_id,'suppliers','a') or public._can(s.role_id,'stock','a')) then raise exception 'NOT_ALLOWED:suppliers'; end if;
  if not public._loc_ok(s, loc) then raise exception 'OUT_OF_SCOPE'; end if;
  select * into sup from public.suppliers where id = (p->>'supplier_id')::int and active;
  if sup.id is null then raise exception 'SUPPLIER_REQUIRED'; end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'EMPTY_INVOICE'; end if;
  select * into st from public.store where id = 1;
  select hide_cost into hide from public.roles where id = s.role_id;
  no := 'PUR-' || lpad(nextval('public.purchase_no_seq')::text, 5, '0');
  insert into public.purchase_invoices (no, supplier_id, supplier_ref, location_id, inv_date, due_date, gross, discount, total, note, staff_id)
  values (no, sup.id, p->>'supplier_ref', loc, d, d + sup.terms_days, 0, 0, 0, p->>'note', s.staff_id) returning id into pid;
  for ln in select * from jsonb_array_elements(p->'lines') loop
    select * into it from public.items where id = (ln->>'item_id')::uuid;
    if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if (ln->>'qty')::numeric <= 0 then raise exception 'BAD_QTY'; end if;
    if hide or (ln->>'unit_cost') is null then uc := it.last_cost; pend := true;
    else
      uc := (ln->>'unit_cost')::numeric;
      if uc < 0 then raise exception 'BAD_COST'; end if;
      if it.last_cost > 0 and abs(uc - it.last_cost) / it.last_cost * 100 > st.price_alert_pct then
        if coalesce(ln->>'diff_reason','') not in ('price','quality') then raise exception 'PRICE_DIFF:%', it.name; end if;
      end if;
    end if;
    if it.serial_required then
      if coalesce(jsonb_array_length(ln->'serials'),0) <> (ln->>'qty')::numeric then raise exception 'SERIALS_REQUIRED:%', it.name; end if;
      for sn in select jsonb_array_elements_text(ln->'serials') loop
        if exists (select 1 from public.serials where serial = sn) then raise exception 'SERIAL_EXISTS:%', sn; end if;
        insert into public.serials (serial, item_id, location_id) values (sn, it.id, loc);
      end loop;
    end if;
    insert into public.purchase_lines (invoice_id, item_id, qty, unit_cost, prev_cost, diff_reason, serials)
    values (pid, it.id, (ln->>'qty')::numeric, uc, it.last_cost, nullif(ln->>'diff_reason',''),
            case when ln ? 'serials' then array(select jsonb_array_elements_text(ln->'serials')) else null end);
    perform public._fifo_in(it.id, loc, (ln->>'qty')::numeric, uc, no);
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (it.id, loc, (ln->>'qty')::numeric, round((ln->>'qty')::numeric*uc,2), 'purchase', 'purchase', no, s.staff_id);
    if not pend then update public.items set last_cost = uc, updated_at = now() where id = it.id; end if;
    gross := gross + (ln->>'qty')::numeric * uc;
  end loop;
  if disc < 0 or disc > gross then raise exception 'BAD_DISCOUNT'; end if;
  update public.purchase_invoices set gross = round(gross,2), discount = disc, total = round(gross - disc,2), cost_pending = pend where id = pid;
  perform public._audit(s,'فاتورة شراء',no||' · '||sup.name,null,round(gross - disc,2)::text,case when pend then 'بالكميات — التكلفة مستنية مراجعة المحاسب' end,loc);
  return jsonb_build_object('id', pid, 'no', no, 'total', round(gross - disc,2), 'cost_pending', pend);
end $$;

-- accountant fixes costs of an invoice received by quantity (affects the unsold part of its FIFO layers)
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
    update public.items set last_cost = (ln->>'unit_cost')::numeric, updated_at = now() where id = pl.item_id;
  end loop;
  select sum(qty * unit_cost) into g from public.purchase_lines where invoice_id = pi.id;
  update public.purchase_invoices set gross = round(g,2), total = round(g - discount,2), cost_pending = false where id = pi.id;
  perform public._audit(s,'مراجعة تكلفة فاتورة شراء',pi.no,pi.total::text,round(g - pi.discount,2)::text,null,pi.location_id);
end $$;

create or replace function public.supplier_pay(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; sup public.suppliers; amt numeric := (p->>'amount')::numeric; m text := p->>'method'; acc int := nullif(p->>'account_id','')::int; lim numeric; appr public.staff; no text; bal numeric;
begin
  s := public._session(p_token); perform public._require(s,'suppliers','p');
  select * into sup from public.suppliers where id = (p->>'supplier_id')::int;
  if sup.id is null then raise exception 'SUPPLIER_REQUIRED'; end if;
  if coalesce(amt,0) <= 0 then raise exception 'BAD_AMOUNT'; end if;
  select balance into bal from public.supplier_balances where id = sup.id;
  if amt > bal + 0.004 then raise exception 'MORE_THAN_BALANCE:%', bal; end if;
  select max_amount into lim from public.roles where id = s.role_id;
  if lim > 0 and amt > lim then
    select * into appr from public.staff where active and role_id = 'owner' and pin_hash = crypt(coalesce(p->>'approver_pin',''), pin_hash) limit 1;
    if appr.id is null then raise exception 'NEEDS_OWNER:%', lim; end if;
  end if;
  if m in ('cash','bank','insta','wallet') then
    if acc is null then select id into acc from public.cash_accounts where kind = case when m = 'cash' then 'treasury' else 'bank' end and active order by id limit 1; end if;
  elsif m = 'cheque' then
    if coalesce(p->>'ref','') = '' or nullif(p->>'cheque_date','') is null then raise exception 'CHEQUE_DETAILS'; end if;
    if acc is null then select id into acc from public.cash_accounts where kind = 'bank' and active order by id limit 1; end if;
  end if;
  no := 'PAY-' || lpad(nextval('public.spay_no_seq')::text, 5, '0');
  insert into public.supplier_payments (no, supplier_id, amount, method, account_id, ref, cheque_date, note, staff_id, approved_by)
  values (no, sup.id, amt, m, case when m = 'credit' then null else acc end, p->>'ref', nullif(p->>'cheque_date','')::date, p->>'note', s.staff_id, appr.id);
  if m <> 'credit' then
    insert into public.cash_moves (account_id, amount, kind, method, ref_type, ref_id, note, staff_id)
    values (acc, -amt, 'expense', case when m = 'cash' then 'cash' when m = 'cheque' then 'cheque' else 'bank' end, 'supplier', no, 'سداد للمورد ' || sup.name, s.staff_id);
  end if;
  perform public._audit(s,'سداد مورد',no||' · '||sup.name,null,amt::text,coalesce(' · بموافقة '||appr.name,''),null);
  return jsonb_build_object('no', no, 'balance', bal - amt);
end $$;

-- ---------- warranty ----------
create or replace function public._wrule(p_item uuid) returns public.warranty_rules
language plpgsql stable security definer set search_path = public as $$
declare it public.items; g text; w public.warranty_rules;
begin
  select * into it from public.items where id = p_item;
  select name into g from public.item_groups where id = it.group_id;
  select * into w from public.warranty_rules where brand = coalesce(it.brand,'') and group_name = coalesce(g,'');
  if w.id is null then select * into w from public.warranty_rules where brand = coalesce(it.brand,'') and group_name = '*'; end if;
  if w.id is null then select * into w from public.warranty_rules where brand = '*' and group_name = '*'; end if;
  return w;
end $$;

create or replace function public.wrule_save(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; rid int;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'svc','p')) then raise exception 'NOT_ALLOWED:svc'; end if;
  if (p->>'id') is null then
    insert into public.warranty_rules (brand, group_name, months, action, center, phone, max_days)
    values (trim(p->>'brand'), coalesce(nullif(trim(p->>'group_name'),''),'*'), (p->>'months')::int, p->>'action', p->>'center', p->>'phone', coalesce((p->>'max_days')::int,14)) returning id into rid;
  else
    rid := (p->>'id')::int;
    update public.warranty_rules set brand = case when brand = '*' then '*' else trim(p->>'brand') end, group_name = coalesce(nullif(trim(p->>'group_name'),''),'*'), months = (p->>'months')::int,
      action = p->>'action', center = p->>'center', phone = p->>'phone', max_days = coalesce((p->>'max_days')::int,14) where id = rid;
  end if;
  perform public._audit(s,'قاعدة ضمان',p->>'brand',null,p->>'action',null,null);
  return rid;
end $$;

-- p: {serial, item_id?, sold_on?, customer_name, phone, problem, action, reason}
create or replace function public.svc_open(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sr public.serials; sa public.sales; it public.items; w public.warranty_rules; sold date; act text := p->>'action'; tid uuid; no text; st text; ns public.serials; c numeric; cust public.customers;
        supid int; loc smallint;
begin
  s := public._session(p_token); perform public._require(s,'svc','a');
  loc := coalesce(s.device_location, s.location_id);
  if loc is null then raise exception 'DEVICE_HAS_NO_LOCATION'; end if;
  select * into sr from public.serials where serial = trim(p->>'serial');
  select * into it from public.items where id = coalesce(sr.item_id, nullif(p->>'item_id','')::uuid);
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if sr.sale_id is not null then select * into sa from public.sales where id = sr.sale_id; select * into cust from public.customers where id = sa.customer_id; end if;
  sold := coalesce(sa.business_day, nullif(p->>'sold_on','')::date);
  if sold is null then raise exception 'SOLD_DATE_REQUIRED'; end if;
  if coalesce(trim(p->>'problem'),'') = '' then raise exception 'PROBLEM_REQUIRED'; end if;
  w := public._wrule(it.id);
  if (act <> w.action or (sold + make_interval(months => w.months)) < current_date) and coalesce(length(trim(p->>'reason')),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  no := 'SV-' || lpad(nextval('public.svc_no_seq')::text, 5, '0');
  st := case act when 'direct' then 'directed' when 'collect' then 'received' else 'replaced' end;
  if act = 'replace' then
    select * into ns from public.serials where item_id = it.id and location_id = loc and status = 'in_stock' order by created_at limit 1;
    if ns.serial is null then raise exception 'NO_REPLACEMENT_IN_STOCK'; end if;
    c := public._fifo_out(it.id, loc, 1);
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (it.id, loc, -1, c, 'adjust', 'warranty', no, s.staff_id);
    update public.serials set status = 'sold', sale_id = sr.sale_id where serial = ns.serial;
    if sr.serial is not null then update public.serials set status = 'returned_to_supplier' where serial = sr.serial; end if;
    select pi.supplier_id into supid from public.purchase_lines pl join public.purchase_invoices pi on pi.id = pl.invoice_id where pl.item_id = it.id order by pi.created_at desc limit 1;
  end if;
  insert into public.service_tickets (no, serial, item_id, sale_id, customer_name, phone, sold_on, location_id, action, suggested, reason, problem, status, center, new_serial, claim_amount, claim_supplier_id, claim_status, history, staff_id)
  values (no, trim(p->>'serial'), it.id, sa.id, coalesce(nullif(trim(p->>'customer_name'),''), cust.name), coalesce(nullif(trim(p->>'phone'),''), cust.phone), sold, loc, act, w.action, nullif(trim(p->>'reason'),''), trim(p->>'problem'), st, w.center,
          ns.serial, c, supid, case when act = 'replace' then 'open' end, jsonb_build_array(jsonb_build_object('at', now(), 'status', st, 'by', s.staff_name)), s.staff_id)
  returning id into tid;
  perform public._audit(s,'تذكرة ضمان',no||' · '||it.name,null,act,p->>'reason',loc);
  return jsonb_build_object('id', tid, 'no', no, 'status', st, 'new_serial', ns.serial, 'center', w.center, 'phone', w.phone);
end $$;

create or replace function public.svc_advance(p_token text, p_id uuid, p_to text, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; t public.service_tickets;
begin
  s := public._session(p_token); perform public._require(s,'svc','e');
  select * into t from public.service_tickets where id = p_id for update;
  if not ((t.status = 'received' and p_to = 'center') or (t.status = 'center' and p_to = 'back') or (t.status = 'back' and p_to = 'done')) then raise exception 'BAD_STATUS'; end if;
  update public.service_tickets set status = p_to, center_ref = coalesce(nullif(p_ref,''), center_ref), at_center_since = case when p_to = 'center' then now() else at_center_since end,
    history = history || jsonb_build_object('at', now(), 'status', p_to, 'by', s.staff_name, 'ref', p_ref) where id = p_id;
  perform public._audit(s,'تحديث تذكرة ضمان',t.no,t.status,p_to,p_ref,t.location_id);
end $$;

-- supplier settles a replacement: credit to our account, or sends a unit (new serial into stock at the claim cost)
create or replace function public.svc_claim_settle(p_token text, p_id uuid, p_how text, p_serial text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; t public.service_tickets; no text;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'svc','p')) then raise exception 'NOT_ALLOWED:svc'; end if;
  select * into t from public.service_tickets where id = p_id for update;
  if t.claim_status is distinct from 'open' then raise exception 'BAD_STATUS'; end if;
  if p_how = 'credit' then
    if t.claim_supplier_id is null then raise exception 'SUPPLIER_REQUIRED'; end if;
    no := 'PAY-' || lpad(nextval('public.spay_no_seq')::text, 5, '0');
    insert into public.supplier_payments (no, supplier_id, amount, method, note, staff_id) values (no, t.claim_supplier_id, t.claim_amount, 'credit', 'خصم ضمان ' || t.no, s.staff_id);
  elsif p_how = 'unit' then
    if coalesce(trim(p_serial),'') = '' then raise exception 'SERIALS_REQUIRED'; end if;
    if exists (select 1 from public.serials where serial = trim(p_serial)) then raise exception 'SERIAL_EXISTS:%', p_serial; end if;
    perform public._fifo_in(t.item_id, t.location_id, 1, t.claim_amount, t.no);
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (t.item_id, t.location_id, 1, t.claim_amount, 'adjust', 'warranty', t.no, s.staff_id);
    insert into public.serials (serial, item_id, location_id) values (trim(p_serial), t.item_id, t.location_id);
  else raise exception 'BAD_STATUS'; end if;
  update public.service_tickets set claim_status = case when p_how = 'credit' then 'credited' else 'unit' end,
    history = history || jsonb_build_object('at', now(), 'status', 'claim_' || p_how, 'by', s.staff_name) where id = p_id;
  perform public._audit(s,'تسوية مطالبة ضمان',t.no,null,p_how,p_serial,t.location_id);
end $$;

-- item_save keeps the new brand field
create or replace function public.item_brand_set(p_token text, p_item uuid, p_brand text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._require(s,'items','e');
  update public.items set brand = nullif(trim(p_brand),''), updated_at = now() where id = p_item;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.setup_status(), public.setup_first_run(text,text,text,text), public.device_register(text),
  public.device_pending(text), public.device_set(text,uuid,text,text,smallint,boolean), public.staff_login(text), public.staff_logout(text),
  public.staff_change_pin(text,text,text), public.staff_list(text), public.staff_save(text,uuid,text,text,smallint,boolean,text), public.staff_directory(text), public.is_device(),
  public.item_save(text,jsonb), public.group_save(text,int,int,text), public.items_import(text,jsonb,smallint,boolean), public.item_brand_set(text,uuid,text),
  public.shift_open(text,numeric), public.shift_current(text), public.shift_handover(text,jsonb,text), public.shift_approve(text,uuid,numeric),
  public.sale_post(text,jsonb), public.sale_void(text,uuid,text,text),
  public.transfer_create(text,smallint,smallint,jsonb,text), public.transfer_approve(text,uuid), public.transfer_ship(text,uuid), public.transfer_receive(text,uuid,jsonb,text),
  public.held_create(text,jsonb), public.held_take(text,uuid), public.held_cancel(text,uuid),
  public.fin_company_save(text,jsonb), public.fin_settle(text,uuid,numeric,date,text,text), public.return_post(text,uuid,jsonb,text,text,text),
  public.supplier_save(text,jsonb), public.purchase_post(text,jsonb), public.purchase_set_costs(text,uuid,jsonb), public.supplier_pay(text,jsonb),
  public.wrule_save(text,jsonb), public.svc_open(text,jsonb), public.svc_advance(text,uuid,text,text), public.svc_claim_settle(text,uuid,text,text)
  to authenticated;
