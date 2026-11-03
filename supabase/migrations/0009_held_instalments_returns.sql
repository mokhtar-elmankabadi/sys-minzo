-- SYS Minzo · phase 2a · held invoices (seller → cashier), instalment companies, partial returns

-- ---------- permissions for returns on the base roles ----------
update public.roles set perms = perms || '{"returns":"vaep"}' where id in ('mgr','asstmgr');
update public.roles set perms = perms || '{"returns":"vap"}'  where id = 'shiftmgr';
update public.roles set perms = perms || '{"returns":"va"}'   where id = 'cashier';
update public.roles set perms = perms || '{"inst":"vaepxr"}'  where id = 'acct';
update public.roles set perms = perms || '{"inst":"vxr"}'     where id = 'asstacct';
update public.roles set perms = perms || '{"inst":"v"}'       where id in ('mgr','asstmgr');

-- ---------- held invoices ----------
create table public.held_sales (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  location_id smallint not null references public.locations(id),
  seller_id uuid references public.staff(id),
  created_by uuid references public.staff(id),
  payload jsonb not null,
  status text not null default 'open' check (status in ('open','taken','cancelled')),
  taken_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create sequence public.held_no_seq start 1;
alter table public.held_sales enable row level security;
create policy "devices read" on public.held_sales for select to authenticated using (public.is_device());

create or replace function public.held_create(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; no text; hid uuid;
begin
  s := public._session(p_token); perform public._require(s,'pos','a');
  if s.device_location is null then raise exception 'DEVICE_HAS_NO_LOCATION'; end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'EMPTY_SALE'; end if;
  no := 'H-' || lpad(nextval('public.held_no_seq')::text, 5, '0');
  insert into public.held_sales (no, location_id, seller_id, created_by, payload)
  values (no, s.device_location, case when s.role_id = 'seller' then s.staff_id else nullif(p->>'seller_id','')::uuid end, s.staff_id, p) returning id into hid;
  perform public._audit(s,'تعليق فاتورة',no,null,null,null,s.device_location);
  return jsonb_build_object('id', hid, 'no', no);
end $$;

create or replace function public.held_take(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; h public.held_sales;
begin
  s := public._session(p_token); perform public._require(s,'pos','a');
  select * into h from public.held_sales where id = p_id for update;
  if h.status <> 'open' then raise exception 'HELD_ALREADY_TAKEN'; end if;
  if not public._loc_ok(s, h.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  update public.held_sales set status = 'taken', taken_by = s.staff_id where id = p_id;
  perform public._audit(s,'استرجاع فاتورة معلّقة',h.no,null,null,null,h.location_id);
  return h.payload || jsonb_build_object('seller_id', h.seller_id, 'held_no', h.no);
end $$;

create or replace function public.held_cancel(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; h public.held_sales;
begin
  s := public._session(p_token);
  select * into h from public.held_sales where id = p_id for update;
  if h.status <> 'open' then raise exception 'HELD_ALREADY_TAKEN'; end if;
  if h.created_by <> s.staff_id and not public._can(s.role_id,'close','p') then raise exception 'NOT_ALLOWED:held'; end if;
  update public.held_sales set status = 'cancelled' where id = p_id;
  perform public._audit(s,'إلغاء فاتورة معلّقة',h.no,null,null,null,h.location_id);
end $$;

-- ---------- instalment companies ----------
insert into public.cash_accounts (name, kind) select 'البنك — حساب جاري', 'bank' where not exists (select 1 from public.cash_accounts where kind = 'bank');

create table public.finance_companies (
  id serial primary key,
  name text not null unique,
  transfer_days int not null default 7 check (transfer_days >= 0),
  phone text,
  account_id int references public.cash_accounts(id),
  active boolean not null default true
);
create table public.finance_plans (
  id serial primary key,
  company_id int not null references public.finance_companies(id) on delete cascade,
  name text not null,
  months int not null check (months > 0),
  rate numeric(6,3) not null default 0 check (rate >= 0),
  payer text not null default 'store' check (payer in ('store','customer')),
  active boolean not null default true
);
alter table public.sale_payments add column plan_id int references public.finance_plans(id);
alter table public.sales add column fin_commission numeric(14,2) not null default 0;
create table public.finance_receivables (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  company_id int not null references public.finance_companies(id),
  plan_id int not null references public.finance_plans(id),
  location_id smallint not null references public.locations(id),
  amount numeric(14,2) not null,
  commission numeric(14,2) not null default 0,
  net numeric(14,2) not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open','settled','cancelled')),
  received numeric(14,2),
  received_on date,
  ref text,
  diff_reason text,
  settled_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
do $$ declare t text; begin foreach t in array array['finance_companies','finance_plans','finance_receivables'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy "devices read" on public.%I for select to authenticated using (public.is_device())', t);
end loop; end $$;

-- company + its plans in one call: p = {id?, name, transfer_days, phone, account_id, active, plans:[{id?, name, months, rate, payer, active}]}
create or replace function public.fin_company_save(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; cid int; pl jsonb; keep int[] := '{}'; nid int;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'inst','e')) then raise exception 'NOT_ALLOWED:inst'; end if;
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if (p->>'id') is null then
    insert into public.finance_companies (name, transfer_days, phone, account_id, active)
    values (trim(p->>'name'), coalesce((p->>'transfer_days')::int,7), p->>'phone', nullif(p->>'account_id','')::int, coalesce((p->>'active')::boolean,true)) returning id into cid;
  else
    cid := (p->>'id')::int;
    update public.finance_companies set name = trim(p->>'name'), transfer_days = coalesce((p->>'transfer_days')::int,7), phone = p->>'phone',
      account_id = nullif(p->>'account_id','')::int, active = coalesce((p->>'active')::boolean,true) where id = cid;
  end if;
  for pl in select * from jsonb_array_elements(coalesce(p->'plans','[]')) loop
    if coalesce(trim(pl->>'name'),'') = '' then continue; end if;
    if (pl->>'id') is null then
      insert into public.finance_plans (company_id, name, months, rate, payer) values (cid, trim(pl->>'name'), (pl->>'months')::int, (pl->>'rate')::numeric, pl->>'payer') returning id into nid;
      keep := keep || nid;
    else
      update public.finance_plans set name = trim(pl->>'name'), months = (pl->>'months')::int, rate = (pl->>'rate')::numeric, payer = pl->>'payer', active = coalesce((pl->>'active')::boolean,true)
       where id = (pl->>'id')::int and company_id = cid;
      keep := keep || (pl->>'id')::int;
    end if;
  end loop;
  update public.finance_plans set active = false where company_id = cid and not (id = any(keep));
  perform public._audit(s,'حفظ شركة تقسيط',p->>'name',null,null,null,null);
  return cid;
end $$;

create or replace function public.fin_settle(p_token text, p_id uuid, p_amount numeric, p_date date, p_ref text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; r public.finance_receivables; acc int;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'inst','e')) then raise exception 'NOT_ALLOWED:inst'; end if;
  select * into r from public.finance_receivables where id = p_id for update;
  if r.status <> 'open' then raise exception 'ALREADY_SETTLED'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if coalesce(trim(p_ref),'') = '' then raise exception 'REF_REQUIRED'; end if;
  if abs(p_amount - r.net) >= 1 and coalesce(length(trim(p_reason)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select coalesce(account_id, (select id from public.cash_accounts where kind = 'bank' and active order by id limit 1)) into acc from public.finance_companies where id = r.company_id;
  update public.finance_receivables set status = 'settled', received = p_amount, received_on = coalesce(p_date, current_date), ref = p_ref, diff_reason = p_reason, settled_by = s.staff_id where id = p_id;
  insert into public.cash_moves (account_id, amount, kind, method, ref_type, ref_id, note, staff_id)
  values (acc, p_amount, 'deposit', 'bank', 'finance', p_id::text, 'تحويل شركة تقسيط · ' || p_ref, s.staff_id);
  perform public._audit(s,'تحصيل من شركة تقسيط',(select name from public.finance_companies where id = r.company_id),r.net::text,p_amount::text,p_reason,r.location_id);
end $$;

-- ---------- sale_post: adds instalment payments (plan_id), customer required, receivable with due date ----------
create or replace function public.sale_post(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; sh public.shifts; st public.store; it public.items; ln jsonb; pay jsonb; ex public.sales; pl public.finance_plans; co public.finance_companies;
        bd date; sid uuid; no text; gross numeric := 0; disc numeric := 0; vat numeric := 0; total numeric; v_cost numeric := 0; lc numeric; lv numeric; comm numeric := 0; c1 numeric;
        dp numeric := coalesce((p->>'discount_pct')::numeric,0); maxd numeric; appr public.staff; paid numeric := 0; cust uuid; need_cust boolean := false;
        r numeric; share numeric; lines_tmp jsonb := '[]'; w numeric;
begin
  s := public._session(p_token); perform public._require(s,'pos','a');
  if s.role_id = 'seller' then raise exception 'SELLER_CANNOT_COLLECT'; end if;
  if (p->>'client_uuid') is not null then
    select * into ex from public.sales where client_uuid = (p->>'client_uuid')::uuid;
    if ex.id is not null then return jsonb_build_object('id', ex.id, 'no', ex.no, 'total', ex.total, 'duplicate', true); end if;
  end if;
  select * into sh from public.shifts where drawer_id = public._drawer_of(s.device_location) and status = 'open';
  if sh.id is null then raise exception 'NO_OPEN_SHIFT'; end if;
  bd := public._business_day(sh.location_id);
  select * into st from public.store where id = 1;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'EMPTY_SALE'; end if;
  select max_discount_pct into maxd from public.roles where id = s.role_id;
  if dp < 0 or dp > 100 then raise exception 'BAD_DISCOUNT'; end if;
  if dp > maxd then
    if coalesce(p->>'approver_pin','') = '' then raise exception 'DISCOUNT_NEEDS_APPROVAL:%', maxd; end if;
    select stf.* into appr from public.staff stf join public.roles ro on ro.id = stf.role_id
     where stf.active and stf.pin_hash = crypt(p->>'approver_pin', stf.pin_hash) and ro.max_discount_pct >= dp and stf.id <> s.staff_id limit 1;
    if appr.id is null then raise exception 'APPROVER_NOT_VALID'; end if;
  end if;
  for ln in select * from jsonb_array_elements(p->'lines') loop
    select * into it from public.items where id = (ln->>'item_id')::uuid and not hidden;
    if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if (ln->>'qty')::numeric <= 0 then raise exception 'BAD_QTY'; end if;
    if it.serial_required then
      need_cust := true;
      if (ln->>'qty')::numeric <> 1 then raise exception 'SERIAL_ITEM_QTY_ONE:%', it.name; end if;
      if not exists (select 1 from public.serials where serial = ln->>'serial' and item_id = it.id and location_id = sh.location_id and status = 'in_stock') then
        raise exception 'SERIAL_NOT_AVAILABLE:%', coalesce(ln->>'serial','—');
      end if;
    end if;
    gross := gross + it.sale_price * (ln->>'qty')::numeric;
    lines_tmp := lines_tmp || jsonb_build_object('item_id', it.id, 'qty', ln->'qty', 'price', it.sale_price, 'serial', ln->'serial', 'waste', ln->'cut_waste_m', 'vat_rate', coalesce(it.vat_rate, st.vat_rate));
  end loop;
  disc := round(gross * dp / 100, 2);
  total := gross - disc;
  if st.vat_registered and st.vat_from is not null and bd >= st.vat_from then
    for ln in select * from jsonb_array_elements(lines_tmp) loop
      r := (ln->>'vat_rate')::numeric / 100; share := (ln->>'price')::numeric * (ln->>'qty')::numeric * (1 - dp/100);
      vat := vat + case when st.prices_include_vat then share - share/(1+r) else share * r end;
    end loop;
    vat := round(vat, 2);
    if not st.prices_include_vat then total := total + vat; end if;
  end if;
  for pay in select * from jsonb_array_elements(coalesce(p->'payments','[]')) loop
    if (pay->>'method') not in ('cash','card','insta','wallet','inst') then raise exception 'BAD_PAYMENT_METHOD'; end if;
    if (pay->>'method') = 'inst' then
      select * into pl from public.finance_plans where id = nullif(pay->>'plan_id','')::int and active;
      if pl.id is null then raise exception 'PLAN_REQUIRED'; end if;
      need_cust := true;
    end if;
    paid := paid + (pay->>'amount')::numeric;
  end loop;
  if paid < total then raise exception 'UNDERPAID:%', total - paid; end if;
  if paid - total > coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p->'payments') x where x->>'method' = 'cash'),0) then raise exception 'OVERPAID_NON_CASH'; end if;
  if coalesce(trim(p->'customer'->>'phone'),'') <> '' then
    insert into public.customers (name, phone) values (coalesce(nullif(trim(p->'customer'->>'name'),''),'عميل'), trim(p->'customer'->>'phone'))
    on conflict (phone) do update set name = coalesce(nullif(trim(excluded.name),''), public.customers.name) returning id into cust;
  elsif need_cust then raise exception 'CUSTOMER_REQUIRED';
  end if;
  no := 'INV-' || lpad(nextval('public.sale_no_seq')::text, 6, '0');
  insert into public.sales (no, location_id, shift_id, device_id, cashier_id, seller_id, customer_id, business_day, gross, discount, vat, total, client_uuid)
  values (no, sh.location_id, sh.id, s.device_id, s.staff_id, nullif(p->>'seller_id','')::uuid, cust, bd, gross, disc, vat, total, nullif(p->>'client_uuid','')::uuid)
  returning id into sid;
  for ln in select * from jsonb_array_elements(lines_tmp) loop
    w := coalesce(nullif(ln->>'waste','')::numeric,0) / 100.0;
    lc := public._fifo_out((ln->>'item_id')::uuid, sh.location_id, (ln->>'qty')::numeric);
    if w > 0 then
      lv := public._fifo_out((ln->>'item_id')::uuid, sh.location_id, w);
      insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values ((ln->>'item_id')::uuid, sh.location_id, -w, lv, 'waste', 'sale', no, s.staff_id);
    end if;
    v_cost := v_cost + lc;
    insert into public.sale_lines (sale_id, item_id, qty, unit_price, discount, cost, serial, cut_waste_m)
    values (sid, (ln->>'item_id')::uuid, (ln->>'qty')::numeric, (ln->>'price')::numeric, round((ln->>'price')::numeric*(ln->>'qty')::numeric*dp/100,2), lc, nullif(ln->>'serial',''), nullif(w,0));
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values ((ln->>'item_id')::uuid, sh.location_id, -(ln->>'qty')::numeric, lc, 'sale', 'sale', no, s.staff_id);
    if coalesce(ln->>'serial','') <> '' then update public.serials set status = 'sold', sale_id = sid where serial = ln->>'serial'; end if;
  end loop;
  for pay in select * from jsonb_array_elements(p->'payments') loop
    if (pay->>'amount')::numeric = 0 then continue; end if;
    insert into public.sale_payments (sale_id, method, amount, plan_id) values (sid, pay->>'method', (pay->>'amount')::numeric, nullif(pay->>'plan_id','')::int);
    if pay->>'method' = 'inst' then
      select * into pl from public.finance_plans where id = (pay->>'plan_id')::int;
      select * into co from public.finance_companies where id = pl.company_id;
      c1 := case when pl.payer = 'store' then round((pay->>'amount')::numeric * pl.rate / 100, 2) else 0 end;
      comm := comm + c1;
      insert into public.finance_receivables (sale_id, company_id, plan_id, location_id, amount, commission, net, due_date)
      values (sid, co.id, pl.id, sh.location_id, (pay->>'amount')::numeric, c1, (pay->>'amount')::numeric - c1, bd + co.transfer_days);
    end if;
  end loop;
  update public.sales set cost = v_cost, fin_commission = comm where id = sid;
  insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, staff_id)
  select sh.drawer_id, case when x.method = 'cash' then x.amount - (paid - total) else x.amount end, 'sale', x.method, sh.id, 'sale', no, s.staff_id
    from (select pay2->>'method' method, sum((pay2->>'amount')::numeric) amount from jsonb_array_elements(p->'payments') pay2 group by 1) x where x.amount <> 0 and x.method <> 'inst';
  if (p->>'held_id') is not null then update public.held_sales set status = 'taken', taken_by = s.staff_id where id = (p->>'held_id')::uuid and status in ('open','taken'); end if;
  if appr.id is not null then perform public._audit(s,'اعتماد خصم يدوي فوق الحد',no,maxd::text||'%',dp::text||'% · '||appr.name,null,sh.location_id); end if;
  perform public._audit(s,'فاتورة بيع',no,null,total::text,null,sh.location_id);
  return jsonb_build_object('id', sid, 'no', no, 'gross', gross, 'discount', disc, 'vat', vat, 'total', total, 'change', paid - total, 'business_day', bd, 'commission', comm);
end $$;

-- void also cancels any open instalment receivable for that invoice
create or replace function public.sale_void(p_token text, p_sale uuid, p_reason text, p_approver_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; sa public.sales; ln record; appr public.staff; sh public.shifts;
begin
  s := public._session(p_token);
  if coalesce(length(trim(p_reason)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into sa from public.sales where id = p_sale for update;
  if sa.status <> 'posted' then raise exception 'ALREADY_VOID'; end if;
  if exists (select 1 from public.returns where sale_id = sa.id) then raise exception 'HAS_RETURNS'; end if;
  if exists (select 1 from public.finance_receivables where sale_id = sa.id and status = 'settled') then raise exception 'INSTALMENT_SETTLED'; end if;
  if not (s.role_id in ('owner','gm') or public._has(s.role_id,'voidInvoice')) then
    if not public._has(s.role_id,'voidRequest') then raise exception 'NOT_ALLOWED:void'; end if;
    select * into appr from public.staff where active and role_id in ('owner','gm') and pin_hash = crypt(coalesce(p_approver_pin,''), pin_hash) limit 1;
    if appr.id is null then raise exception 'APPROVER_NOT_VALID'; end if;
  end if;
  if not public._loc_ok(s, sa.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  for ln in select * from public.sale_lines where sale_id = sa.id loop
    perform public._fifo_in(ln.item_id, sa.location_id, ln.qty, case when ln.qty > 0 then ln.cost / ln.qty else 0 end, 'إلغاء '||sa.no);
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (ln.item_id, sa.location_id, ln.qty, ln.cost, 'void', 'sale', sa.no, s.staff_id);
    if ln.serial is not null then update public.serials set status = 'in_stock', sale_id = null where serial = ln.serial; end if;
  end loop;
  select * into sh from public.shifts where drawer_id = public._drawer_of(sa.location_id) and status = 'open';
  insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, note, staff_id)
  select public._drawer_of(sa.location_id), -sum(amount), 'refund', method, sh.id, 'sale', sa.no, 'إلغاء فاتورة', s.staff_id
    from public.cash_moves where ref_type = 'sale' and ref_id = sa.no and kind = 'sale' group by method;
  update public.finance_receivables set status = 'cancelled' where sale_id = sa.id and status = 'open';
  update public.sales set status = 'void', void_reason = p_reason, void_by = s.staff_id where id = sa.id;
  perform public._audit(s,'إلغاء فاتورة',sa.no,sa.total::text,'ملغاة'||coalesce(' · بموافقة '||appr.name,''),p_reason,sa.location_id);
end $$;

-- ---------- partial returns ----------
create table public.returns (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  sale_id uuid not null references public.sales(id),
  location_id smallint not null references public.locations(id),
  shift_id uuid references public.shifts(id),
  staff_id uuid references public.staff(id),
  approved_by uuid references public.staff(id),
  reason text not null,
  refund_method text not null check (refund_method in ('cash','card','insta','wallet','credit')),
  amount numeric(14,2) not null,
  cost numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);
create table public.return_lines (
  id bigserial primary key,
  return_id uuid not null references public.returns(id) on delete cascade,
  sale_line_id bigint not null references public.sale_lines(id),
  item_id uuid not null references public.items(id),
  qty numeric(14,3) not null check (qty > 0),
  amount numeric(14,2) not null,
  cost numeric(14,2) not null,
  condition text not null check (condition in ('resell','damaged')),
  serial text
);
create sequence public.return_no_seq start 1;
do $$ declare t text; begin foreach t in array array['returns','return_lines'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy "devices read" on public.%I for select to authenticated using (public.is_device())', t);
end loop; end $$;

-- p_lines: [{sale_line_id, qty, condition}] · refund from this device's open shift (cash, card…) or 'credit' (no money out)
create or replace function public.return_post(p_token text, p_sale uuid, p_lines jsonb, p_reason text, p_refund text, p_approver_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; sa public.sales; sl public.sale_lines; ln jsonb; q numeric; done_q numeric; amt numeric := 0; cst numeric := 0; la numeric; lc numeric;
        rid uuid; no text; appr public.staff; sh public.shifts; approver uuid;
begin
  s := public._session(p_token); perform public._require(s,'returns','a');
  if coalesce(length(trim(p_reason)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into sa from public.sales where id = p_sale;
  if sa.id is null or sa.status <> 'posted' then raise exception 'SALE_NOT_RETURNABLE'; end if;
  if not public._loc_ok(s, sa.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  if public._can(s.role_id,'returns','p') then approver := s.staff_id;
  else
    select stf.* into appr from public.staff stf where stf.active and stf.id <> s.staff_id and stf.pin_hash = crypt(coalesce(p_approver_pin,''), stf.pin_hash)
       and public._can(stf.role_id,'returns','p') limit 1;
    if appr.id is null then raise exception 'APPROVER_NOT_VALID'; end if;
    approver := appr.id;
  end if;
  if p_refund <> 'credit' then
    select * into sh from public.shifts where drawer_id = public._drawer_of(s.device_location) and status = 'open';
    if sh.id is null then raise exception 'NO_OPEN_SHIFT'; end if;
  end if;
  no := 'RT-' || lpad(nextval('public.return_no_seq')::text, 5, '0');
  insert into public.returns (no, sale_id, location_id, shift_id, staff_id, approved_by, reason, refund_method, amount)
  values (no, sa.id, sa.location_id, sh.id, s.staff_id, approver, p_reason, p_refund, 0) returning id into rid;
  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]')) loop
    q := (ln->>'qty')::numeric; if coalesce(q,0) <= 0 then continue; end if;
    select * into sl from public.sale_lines where id = (ln->>'sale_line_id')::bigint and sale_id = sa.id;
    if sl.id is null then raise exception 'LINE_NOT_IN_SALE'; end if;
    select coalesce(sum(qty),0) into done_q from public.return_lines where sale_line_id = sl.id;
    if q > sl.qty - done_q then raise exception 'RETURN_MORE_THAN_SOLD'; end if;
    la := round(((sl.unit_price * sl.qty - sl.discount) / sl.qty) * q * (case when sa.gross - sa.discount > 0 then sa.total / (sa.gross - sa.discount) else 1 end), 2);
    lc := round(sl.cost / sl.qty * q, 2);
    insert into public.return_lines (return_id, sale_line_id, item_id, qty, amount, cost, condition, serial)
    values (rid, sl.id, sl.item_id, q, la, lc, coalesce(ln->>'condition','resell'), sl.serial);
    if coalesce(ln->>'condition','resell') = 'resell' then
      perform public._fifo_in(sl.item_id, sa.location_id, q, sl.cost / sl.qty, no);
      insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (sl.item_id, sa.location_id, q, lc, 'return', 'return', no, s.staff_id);
      if sl.serial is not null then update public.serials set status = 'in_stock', sale_id = null, location_id = sa.location_id where serial = sl.serial; end if;
    else
      insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (sl.item_id, sa.location_id, 0, lc, 'waste', 'return', no || ' تالف', s.staff_id);
      if sl.serial is not null then update public.serials set status = 'returned_to_supplier', sale_id = null where serial = sl.serial; end if;
    end if;
    amt := amt + la; cst := cst + lc;
  end loop;
  if amt <= 0 then raise exception 'NOTHING_TO_RETURN'; end if;
  update public.returns set amount = amt, cost = cst where id = rid;
  if p_refund <> 'credit' then
    insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, note, staff_id)
    values (sh.drawer_id, -amt, 'refund', p_refund, sh.id, 'return', no, 'مرتجع ' || sa.no, s.staff_id);
  end if;
  perform public._audit(s,'مرتجع',no||' · '||sa.no,null,amt::text,p_reason||coalesce(' · بموافقة '||appr.name,''),sa.location_id);
  return jsonb_build_object('id', rid, 'no', no, 'amount', amt);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.setup_status(), public.setup_first_run(text,text,text,text), public.device_register(text),
  public.device_pending(text), public.device_set(text,uuid,text,text,smallint,boolean), public.staff_login(text), public.staff_logout(text),
  public.staff_change_pin(text,text,text), public.staff_list(text), public.staff_save(text,uuid,text,text,smallint,boolean,text), public.staff_directory(text), public.is_device(),
  public.item_save(text,jsonb), public.group_save(text,int,int,text), public.items_import(text,jsonb,smallint,boolean),
  public.shift_open(text,numeric), public.shift_current(text), public.shift_handover(text,jsonb,text), public.shift_approve(text,uuid,numeric),
  public.sale_post(text,jsonb), public.sale_void(text,uuid,text,text),
  public.transfer_create(text,smallint,smallint,jsonb,text), public.transfer_approve(text,uuid), public.transfer_ship(text,uuid), public.transfer_receive(text,uuid,jsonb,text),
  public.held_create(text,jsonb), public.held_take(text,uuid), public.held_cancel(text,uuid),
  public.fin_company_save(text,jsonb), public.fin_settle(text,uuid,numeric,date,text,text), public.return_post(text,uuid,jsonb,text,text,text)
  to authenticated;
