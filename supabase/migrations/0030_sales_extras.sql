-- 0030 · selling extras (owner's choices)
-- 1) reservations with a deposit: the items are held for the customer (nobody else can sell or move them);
--    the deposit sits as a customer balance (2103) until the sale; if the reservation is cancelled the deposit goes back in full.
-- 2) price quotes: a printable offer for the customer, no stock or money moves; later loaded into the sale screen.
-- 3) coupons: a code that takes a percent or an amount off the invoice (limits: dates, minimum, uses, once per customer).
-- 4) «the second at a discount» (nth): for every X bought, the next Y (the cheapest) get Z% off.
-- 5) customer birthday (a greeting list only — no discount).

-- ---------- 5) birthday ----------
alter table public.customers add column if not exists birthday date;

-- ---------- 1) reservations ----------
alter table public.cash_moves drop constraint if exists cash_moves_kind_check;
alter table public.cash_moves add constraint cash_moves_kind_check
  check (kind in ('opening','sale','refund','expense','transfer','deposit','float','adjust','reserve'));
create sequence if not exists public.reservation_no_seq;
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  location_id smallint not null references public.locations(id),
  customer_id uuid not null references public.customers(id),
  staff_id uuid references public.staff(id),
  status text not null default 'open' check (status in ('open','done','cancelled')),
  total numeric(14,2) not null default 0,
  deposit numeric(14,2) not null default 0,
  due_date date,
  note text,
  sale_id uuid references public.sales(id),
  cancel_reason text,
  closed_by uuid references public.staff(id),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.reservation_lines (
  id bigserial primary key,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  item_id uuid not null references public.items(id),
  qty numeric(12,3) not null check (qty > 0),
  unit_price numeric(14,2) not null default 0
);
create index if not exists reservation_lines_item on public.reservation_lines (item_id);
create index if not exists reservations_open on public.reservations (location_id) where status = 'open';

-- ---------- 2) quotes ----------
create sequence if not exists public.quote_no_seq;
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  location_id smallint references public.locations(id),
  customer_name text,
  customer_phone text,
  lines jsonb not null default '[]'::jsonb,
  gross numeric(14,2) not null default 0,
  offer_disc numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  valid_until date,
  note text,
  staff_id uuid references public.staff(id),
  created_at timestamptz not null default now()
);

-- ---------- 3) coupons ----------
create table if not exists public.coupons (
  id serial primary key,
  code text not null unique,
  kind text not null check (kind in ('pct','amount')),
  value numeric(14,2) not null check (value > 0),
  max_disc numeric(14,2),
  min_total numeric(14,2),
  max_uses int,
  once_per_customer boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active','paused','ended')),
  note text,
  uses int not null default 0,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create table if not exists public.coupon_uses (
  id bigserial primary key,
  coupon_id int not null references public.coupons(id),
  sale_id uuid not null references public.sales(id) on delete cascade,
  customer_phone text,
  amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);
alter table public.sales add column if not exists coupon_disc numeric(14,2) not null default 0;

do $$ declare t text; begin
  foreach t in array array['reservations','reservation_lines','quotes','coupons','coupon_uses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('drop policy if exists "role read" on public.%I', t);
    execute format('create policy "role read" on public.%I for select to authenticated using ((select public._r_any()))', t);
  end loop;
end $$;

-- items held by open reservations at a place (other than the one being completed now)
create or replace function public._reserved(p_item uuid, p_loc smallint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(rl.qty), 0) from public.reservation_lines rl join public.reservations r on r.id = rl.reservation_id
   where r.status = 'open' and r.location_id = p_loc and rl.item_id = p_item
     and r.id::text is distinct from nullif(current_setting('mz.res', true), '')
$$;

-- FIFO out (as in 0029) — reserved items can't leave except for their own reservation
create or replace function public._fifo_out(p_item uuid, p_loc smallint, p_qty numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare left_q numeric := p_qty; c numeric := 0; ly record; take numeric; nm text; have numeric; res numeric; kit boolean;
begin
  if p_qty <= 0 then return 0; end if;
  have := coalesce((select sum(qty_left) from public.stock_layers where item_id = p_item and location_id = p_loc and qty_left > 0), 0);
  kit := exists (select 1 from public.item_kits where kit_id = p_item);
  if not kit then
    res := public._reserved(p_item, p_loc);
    if res > 0 and have >= p_qty and have - res < p_qty then
      select name into nm from public.items where id = p_item;
      raise exception 'RESERVED_STOCK:%', nm;
    end if;
  end if;
  if have < p_qty and kit then
    perform public._kit_build(p_item, p_loc, p_qty - have, 'طقم مفتوح', null);
    have := p_qty;
  end if;
  if have < p_qty then
    select name into nm from public.items where id = p_item;
    raise exception 'INSUFFICIENT_STOCK:%', nm;
  end if;
  for ly in select id, qty_left, unit_cost from public.stock_layers where item_id = p_item and location_id = p_loc and qty_left > 0 order by id for update loop
    exit when left_q <= 0;
    take := least(left_q, ly.qty_left);
    update public.stock_layers set qty_left = qty_left - take where id = ly.id;
    c := c + take * ly.unit_cost; left_q := left_q - take;
  end loop;
  update public.stock set qty = qty - p_qty where item_id = p_item and location_id = p_loc;
  return round(c, 2);
end $$;

create or replace function public._cust_upsert(p_name text, p_phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if coalesce(trim(p_phone),'') !~ '^01[0-9]{9}$' then raise exception 'CUSTOMER_REQUIRED'; end if;
  insert into public.customers (name, phone) values (coalesce(nullif(trim(p_name),''),'عميل'), trim(p_phone))
  on conflict (phone) do update set name = coalesce(nullif(trim(excluded.name),''), public.customers.name) returning id into cid;
  return cid;
end $$;

-- p = {customer:{name,phone}, lines:[{item_id,qty}], deposit, method, due_date, note}
create or replace function public.reservation_create(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sh public.shifts; it public.items; ln jsonb; rid uuid; no text; tot numeric := 0; dep numeric := coalesce((p->>'deposit')::numeric, 0);
        meth text := coalesce(nullif(p->>'method',''),'cash'); cid uuid; have numeric;
begin
  s := public._session(p_token); perform public._require(s,'pos','a');
  if s.role_id = 'seller' then raise exception 'SELLER_CANNOT_COLLECT'; end if;
  if dep <= 0 then raise exception 'DEPOSIT_REQUIRED'; end if;
  if meth not in ('cash','card','insta','wallet') then raise exception 'BAD_PAYMENT_METHOD'; end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'EMPTY_SALE'; end if;
  select * into sh from public.shifts where drawer_id = public._drawer_of(s.device_location) and status = 'open';
  if sh.id is null then raise exception 'NO_OPEN_SHIFT'; end if;
  cid := public._cust_upsert(p->'customer'->>'name', p->'customer'->>'phone');
  no := 'RS-' || lpad(nextval('public.reservation_no_seq')::text, 5, '0');
  insert into public.reservations (no, location_id, customer_id, staff_id, deposit, due_date, note)
  values (no, sh.location_id, cid, s.staff_id, dep, coalesce(nullif(p->>'due_date','')::date, (now() at time zone 'Africa/Cairo')::date + 14), nullif(trim(p->>'note'),''))
  returning id into rid;
  for ln in select * from jsonb_array_elements(p->'lines') loop
    select * into it from public.items where id = (ln->>'item_id')::uuid and not hidden;
    if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if coalesce((ln->>'qty')::numeric,0) <= 0 then raise exception 'BAD_QTY'; end if;
    if not exists (select 1 from public.item_kits where kit_id = it.id) then
      have := coalesce((select sum(qty_left) from public.stock_layers where item_id = it.id and location_id = sh.location_id and qty_left > 0), 0);
      if have - public._reserved(it.id, sh.location_id) - coalesce((select sum(qty) from public.reservation_lines where reservation_id = rid and item_id = it.id), 0) < (ln->>'qty')::numeric then
        raise exception 'INSUFFICIENT_STOCK:%', it.name;
      end if;
    end if;
    insert into public.reservation_lines (reservation_id, item_id, qty, unit_price) values (rid, it.id, (ln->>'qty')::numeric, it.sale_price);
    tot := tot + it.sale_price * (ln->>'qty')::numeric;
  end loop;
  if dep > tot then raise exception 'DEPOSIT_MORE_THAN_TOTAL'; end if;
  update public.reservations set total = tot where id = rid;
  insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, note, staff_id, gl_account)
  values (sh.drawer_id, dep, 'reserve', meth, sh.id, 'reservation', no, 'عربون حجز ' || no, s.staff_id, '2103');
  perform public._audit(s,'حجز بعربون',no,null,dep::text || ' من ' || tot::text,null,sh.location_id);
  return jsonb_build_object('id', rid, 'no', no, 'total', tot, 'deposit', dep);
end $$;

create or replace function public.reservation_pay(p_token text, p_id uuid, p_amount numeric, p_method text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sh public.shifts; r public.reservations;
begin
  s := public._session(p_token); perform public._require(s,'pos','a');
  if s.role_id = 'seller' then raise exception 'SELLER_CANNOT_COLLECT'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if coalesce(p_method,'cash') not in ('cash','card','insta','wallet') then raise exception 'BAD_PAYMENT_METHOD'; end if;
  select * into r from public.reservations where id = p_id for update;
  if r.id is null or r.status <> 'open' then raise exception 'RESERVATION_CLOSED'; end if;
  if not public._loc_ok(s, r.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  if r.deposit + p_amount > r.total then raise exception 'DEPOSIT_MORE_THAN_TOTAL'; end if;
  select * into sh from public.shifts where drawer_id = public._drawer_of(s.device_location) and status = 'open';
  if sh.id is null then raise exception 'NO_OPEN_SHIFT'; end if;
  update public.reservations set deposit = deposit + p_amount where id = r.id;
  insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, note, staff_id, gl_account)
  values (sh.drawer_id, p_amount, 'reserve', coalesce(p_method,'cash'), sh.id, 'reservation', r.no, 'دفعة على حجز ' || r.no, s.staff_id, '2103');
  perform public._audit(s,'دفعة على حجز',r.no,r.deposit::text,(r.deposit + p_amount)::text,null,r.location_id);
  return jsonb_build_object('deposit', r.deposit + p_amount);
end $$;

-- cancelling always gives the whole deposit back (owner's rule)
create or replace function public.reservation_cancel(p_token text, p_id uuid, p_reason text, p_method text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sh public.shifts; r public.reservations;
begin
  s := public._session(p_token); perform public._require(s,'pos','a');
  if s.role_id = 'seller' then raise exception 'SELLER_CANNOT_COLLECT'; end if;
  if coalesce(length(trim(p_reason)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if coalesce(p_method,'cash') not in ('cash','card','insta','wallet') then raise exception 'BAD_PAYMENT_METHOD'; end if;
  select * into r from public.reservations where id = p_id for update;
  if r.id is null or r.status <> 'open' then raise exception 'RESERVATION_CLOSED'; end if;
  if not public._loc_ok(s, r.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  select * into sh from public.shifts where drawer_id = public._drawer_of(s.device_location) and status = 'open';
  if sh.id is null then raise exception 'NO_OPEN_SHIFT'; end if;
  update public.reservations set status = 'cancelled', cancel_reason = trim(p_reason), closed_by = s.staff_id, closed_at = now() where id = r.id;
  if r.deposit > 0 then
    insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, note, staff_id, gl_account)
    values (sh.drawer_id, -r.deposit, 'reserve', coalesce(p_method,'cash'), sh.id, 'reservation', r.no, 'رد عربون حجز ' || r.no, s.staff_id, '2103');
  end if;
  perform public._audit(s,'إلغاء حجز',r.no,null,'رد ' || r.deposit::text,p_reason,r.location_id);
  return jsonb_build_object('refund', r.deposit);
end $$;

create or replace function public.reservations_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._require(s,'pos','v');
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'no',r.no,'loc',r.location_id,'status',r.status,'total',r.total,'deposit',r.deposit,'due',r.due_date,'note',r.note,
      'at',r.created_at,'closed_at',r.closed_at,'cancel_reason',r.cancel_reason,'customer',c.name,'phone',c.phone,'staff',(select name from public.staff where id = r.staff_id),
      'sale_no',(select no from public.sales where id = r.sale_id),
      'lines',(select jsonb_agg(jsonb_build_object('item_id',rl.item_id,'qty',rl.qty,'price',rl.unit_price) order by rl.id) from public.reservation_lines rl where rl.reservation_id = r.id))
      order by (r.status = 'open') desc, r.created_at desc)
    from public.reservations r join public.customers c on c.id = r.customer_id
   where public._loc_ok(s, r.location_id) and (r.status = 'open' or r.created_at > now() - interval '120 days')), '[]'::jsonb);
end $$;

-- ---------- 2) quotes ----------
-- p = {customer:{name,phone}, lines:[{item_id,qty}], valid_days, note}
create or replace function public.quote_save(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; it public.items; ln jsonb; arr jsonb := '[]'; ofr jsonb; outl jsonb := '[]'; i int := 0; g numeric := 0; od numeric := 0; no text; qid uuid; loc smallint;
begin
  s := public._session(p_token); perform public._require(s,'pos','v');
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'EMPTY_SALE'; end if;
  loc := coalesce(s.device_location, (select id from public.locations where kind = 'showroom' order by id limit 1));
  for ln in select * from jsonb_array_elements(p->'lines') loop
    select * into it from public.items where id = (ln->>'item_id')::uuid and not hidden;
    if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if coalesce((ln->>'qty')::numeric,0) <= 0 then raise exception 'BAD_QTY'; end if;
    arr := arr || jsonb_build_object('item_id', it.id, 'qty', (ln->>'qty')::numeric, 'price', it.sale_price);
  end loop;
  begin ofr := public._offer_price(arr, loc, now()); exception when others then ofr := null; end;
  for ln in select * from jsonb_array_elements(arr) loop
    select * into it from public.items where id = (ln->>'item_id')::uuid;
    outl := outl || jsonb_build_object('item_id', it.id, 'name', it.name, 'code', it.code, 'unit', it.unit, 'qty', (ln->>'qty')::numeric, 'price', it.sale_price,
      'od', coalesce((ofr->'lines'->i->>'d')::numeric, 0), 'offer', ofr->'lines'->i->>'n');
    g := g + it.sale_price * (ln->>'qty')::numeric; od := od + coalesce((ofr->'lines'->i->>'d')::numeric, 0); i := i + 1;
  end loop;
  no := 'QT-' || lpad(nextval('public.quote_no_seq')::text, 5, '0');
  insert into public.quotes (no, location_id, customer_name, customer_phone, lines, gross, offer_disc, total, valid_until, note, staff_id)
  values (no, loc, nullif(trim(p->'customer'->>'name'),''), nullif(trim(p->'customer'->>'phone'),''), outl, g, od, g - od,
          (now() at time zone 'Africa/Cairo')::date + greatest(coalesce((p->>'valid_days')::int, 7), 1), nullif(trim(p->>'note'),''), s.staff_id)
  returning id into qid;
  perform public._audit(s,'عرض سعر',no,null,(g - od)::text,null,loc);
  return (select to_jsonb(q) from public.quotes q where id = qid);
end $$;

create or replace function public.quotes_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._require(s,'pos','v');
  return coalesce((select jsonb_agg(to_jsonb(q) || jsonb_build_object('staff', (select name from public.staff where id = q.staff_id)) order by q.created_at desc)
    from (select * from public.quotes where created_at > now() - interval '120 days' order by created_at desc limit 300) q), '[]'::jsonb);
end $$;

-- ---------- 3) coupons ----------
create or replace function public._coupon_get(p_code text, p_phone text) returns public.coupons
language plpgsql stable security definer set search_path = public as $$
declare c public.coupons;
begin
  select * into c from public.coupons where upper(code) = upper(trim(p_code));
  if c.id is null then raise exception 'COUPON_NOT_FOUND'; end if;
  if c.status <> 'active' or c.starts_at > now() or (c.ends_at is not null and c.ends_at <= now()) then raise exception 'COUPON_NOT_ACTIVE'; end if;
  if c.max_uses is not null and c.uses >= c.max_uses then raise exception 'COUPON_USED_UP'; end if;
  if c.once_per_customer then
    if coalesce(trim(p_phone),'') = '' then raise exception 'COUPON_NEEDS_CUSTOMER'; end if;
    if exists (select 1 from public.coupon_uses u join public.sales sa on sa.id = u.sale_id where u.coupon_id = c.id and u.customer_phone = trim(p_phone) and sa.status = 'posted') then
      raise exception 'COUPON_ALREADY_USED';
    end if;
  end if;
  return c;
end $$;

create or replace function public.coupon_check(p_token text, p_code text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; c public.coupons;
begin
  s := public._session(p_token); perform public._require(s,'pos','v');
  c := public._coupon_get(p_code, p_phone);
  return jsonb_build_object('code', c.code, 'kind', c.kind, 'value', c.value, 'max_disc', c.max_disc, 'min_total', c.min_total, 'once', c.once_per_customer);
end $$;

create or replace function public.coupon_save(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid int; cd text := upper(regexp_replace(coalesce(p->>'code',''), '\s', '', 'g'));
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'offers','a')) then raise exception 'NOT_ALLOWED:offers'; end if;
  if cd !~ '^[A-Z0-9_-]{3,20}$' then raise exception 'BAD_COUPON_CODE'; end if;
  if coalesce(p->>'kind','') not in ('pct','amount') then raise exception 'BAD_OFFER'; end if;
  if coalesce((p->>'value')::numeric,0) <= 0 or (p->>'kind' = 'pct' and (p->>'value')::numeric > 100) then raise exception 'BAD_AMOUNT'; end if;
  if (p->>'ends_at') is not null and (p->>'ends_at')::timestamptz <= coalesce((p->>'starts_at')::timestamptz, now()) then raise exception 'BAD_DATES'; end if;
  if (p->>'id') is null then
    insert into public.coupons (code, kind, value, max_disc, min_total, max_uses, once_per_customer, starts_at, ends_at, note, created_by)
    values (cd, p->>'kind', (p->>'value')::numeric, nullif(p->>'max_disc','')::numeric, nullif(p->>'min_total','')::numeric, nullif(p->>'max_uses','')::int,
            coalesce((p->>'once_per_customer')::boolean, false), coalesce((p->>'starts_at')::timestamptz, now()), nullif(p->>'ends_at','')::timestamptz, nullif(trim(p->>'note'),''), s.staff_id)
    returning id into nid;
  else
    update public.coupons set code = cd, kind = p->>'kind', value = (p->>'value')::numeric, max_disc = nullif(p->>'max_disc','')::numeric, min_total = nullif(p->>'min_total','')::numeric,
      max_uses = nullif(p->>'max_uses','')::int, once_per_customer = coalesce((p->>'once_per_customer')::boolean, false),
      starts_at = coalesce((p->>'starts_at')::timestamptz, starts_at), ends_at = nullif(p->>'ends_at','')::timestamptz, note = nullif(trim(p->>'note'),'')
     where id = (p->>'id')::int returning id into nid;
    if nid is null then raise exception 'NOT_FOUND'; end if;
  end if;
  perform public._audit(s, case when (p->>'id') is null then 'إنشاء كوبون' else 'تعديل كوبون' end, cd, null, (p->>'kind') || ' ' || (p->>'value'), null, null);
  return nid;
exception when unique_violation then raise exception 'NAME_TAKEN';
end $$;

create or replace function public.coupon_set_status(p_token text, p_id int, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; c public.coupons;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'offers','e')) then raise exception 'NOT_ALLOWED:offers'; end if;
  if p_status not in ('active','paused','ended') then raise exception 'BAD_VALUE'; end if;
  update public.coupons set status = p_status where id = p_id returning * into c;
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  perform public._audit(s,'حالة كوبون',c.code,null,p_status,null,null);
end $$;

create or replace function public.coupons_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'offers','v')) then raise exception 'NOT_ALLOWED:offers'; end if;
  return coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('disc_total', (select coalesce(sum(u.amount),0) from public.coupon_uses u join public.sales sa on sa.id = u.sale_id where u.coupon_id = c.id and sa.status = 'posted'))
    order by (c.status = 'active') desc, c.created_at desc) from public.coupons c), '[]'::jsonb);
end $$;

-- ---------- 5) birthday in the customer list / save ----------
create or replace function public.customers_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._require(s,'customers','v');
  return coalesce((select jsonb_agg(x order by x->>'last' desc nulls last) from (
    select jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone,'area',c.area,'address',c.address,'notes',c.notes,'created_at',c.created_at,'birthday',c.birthday,
      'invoices',(select count(*) from public.sales where customer_id = c.id and status = 'posted'),
      'spent',public._cust_spent(c.id),'points',public._cust_points(c.id),
      'last',(select max(created_at) from public.sales where customer_id = c.id and status = 'posted'),
      'warranties',(select count(*) from public.serials sr join public.sales sa on sa.id = sr.sale_id join public.items it on it.id = sr.item_id
                     where sa.customer_id = c.id and sr.status = 'sold' and it.warranty_months > 0 and sa.created_at + make_interval(months => it.warranty_months) > now())) x
    from public.customers c where not c.hidden) t), '[]'::jsonb);
end $$;

create or replace function public.customer_save(p_token text, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid uuid; ph text := nullif(regexp_replace(coalesce(p->>'phone',''),'[^0-9+]','','g'),''); bd date := nullif(p->>'birthday','')::date;
begin
  s := public._session(p_token);
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if bd is not null and (bd > current_date or bd < date '1900-01-01') then raise exception 'BAD_DATES'; end if;
  if (p->>'id') is null then
    perform public._require(s,'customers','a');
    insert into public.customers (name, phone, area, address, notes, birthday) values (trim(p->>'name'), ph, nullif(trim(p->>'area'),''), nullif(trim(p->>'address'),''), nullif(trim(p->>'notes'),''), bd)
    returning id into nid;
    perform public._audit(s,'إضافة عميل',trim(p->>'name'),null,ph,null,null);
  else
    perform public._require(s,'customers','e');
    update public.customers set name = trim(p->>'name'), phone = ph, area = nullif(trim(p->>'area'),''), address = nullif(trim(p->>'address'),''),
      notes = nullif(trim(p->>'notes'),''), birthday = bd, hidden = coalesce((p->>'hidden')::boolean, hidden), updated_at = now() where id = (p->>'id')::uuid returning id into nid;
    if nid is null then raise exception 'NOT_FOUND'; end if;
    perform public._audit(s,'تعديل عميل',trim(p->>'name'),null,ph,null,null);
  end if;
  return nid;
exception when unique_violation then raise exception 'PHONE_TAKEN';
end $$;

-- ---------- 4) «the second at a discount» ----------
alter table public.offers drop constraint if exists offers_kind_check;
alter table public.offers add constraint offers_kind_check check (kind in ('pct','amount','bxgy','bundle','gift','nth'));
create or replace function public._offer_is_group(p_offer int) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select o.kind in ('bxgy','bundle','gift','nth') or o.scope = 'invoice' from public.offers o where o.id = p_offer), false)
$$;

create or replace function public._offer_price(p_lines jsonb, p_loc smallint, p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int := coalesce(jsonb_array_length(p_lines),0); i int; j int; o public.offers;
        iid uuid[] := '{}'; q numeric[] := '{}'; pr numeric[] := '{}'; d numeric[] := '{}'; ofid int[] := '{}'; onm text[] := '{}'; cl boolean[] := '{}'; grp int[] := '{}'; dep int[] := '{}';
        units numeric; free numeric; k numeric; u numeric; setv numeric; refv text; base numeric; dd numeric; acc numeric; lst int; idx int[]; rr record;
        inv jsonb := null; res jsonb := '[]';
begin
  for i in 1..n loop
    iid := iid || ((p_lines->(i-1))->>'item_id')::uuid; q := q || ((p_lines->(i-1))->>'qty')::numeric; pr := pr || ((p_lines->(i-1))->>'price')::numeric;
    d := d || 0::numeric; ofid := ofid || null::int; onm := onm || null::text; cl := cl || false;
    select it.group_id, it.department_id into rr from public.items it where it.id = iid[i];
    grp := grp || rr.group_id; dep := dep || rr.department_id;
  end loop;
  for o in select * from public.offers where status = 'active' and scope <> 'invoice' order by priority desc, id loop
    if not public._offer_live(o, p_loc, p_at) then continue; end if;
    if o.kind in ('pct','amount') then
      for i in 1..n loop
        if cl[i] or not public._offer_hits(o, iid[i], grp[i], dep[i]) then continue; end if;
        d[i] := round(case when o.kind = 'pct' then pr[i] * q[i] * least(o.value,100) / 100 else least(pr[i], o.value) * q[i] end, 2);
        ofid[i] := o.id; onm[i] := o.name; cl[i] := true;
      end loop;
    elsif o.kind = 'bxgy' then
      idx := '{}'; units := 0;
      for rr in select g.i from generate_series(1,n) g(i) order by pr[g.i], g.i loop
        if cl[rr.i] or not public._offer_hits(o, iid[rr.i], grp[rr.i], dep[rr.i]) then continue; end if;
        idx := idx || rr.i; units := units + floor(q[rr.i]);
      end loop;
      if cardinality(idx) = 0 or coalesce(o.buy_qty,0) < 1 or coalesce(o.get_qty,0) < 1 then continue; end if;
      free := floor(units / (o.buy_qty + o.get_qty)) * o.get_qty;
      if free <= 0 then continue; end if;
      foreach j in array idx loop        -- cheapest units go free
        u := least(floor(q[j]), free); free := free - u;
        d[j] := round(u * pr[j], 2); ofid[j] := o.id; onm[j] := o.name; cl[j] := true;
      end loop;
    elsif o.kind = 'nth' then        -- every buy_qty units → the next get_qty (cheapest) at value% off
      idx := '{}'; units := 0;
      for rr in select g.i from generate_series(1,n) g(i) order by pr[g.i], g.i loop
        if cl[rr.i] or not public._offer_hits(o, iid[rr.i], grp[rr.i], dep[rr.i]) then continue; end if;
        idx := idx || rr.i; units := units + floor(q[rr.i]);
      end loop;
      if cardinality(idx) = 0 or coalesce(o.buy_qty,0) < 1 or coalesce(o.get_qty,0) < 1 then continue; end if;
      free := floor(units / (o.buy_qty + o.get_qty)) * o.get_qty;
      if free <= 0 then continue; end if;
      foreach j in array idx loop
        u := least(floor(q[j]), free); free := free - u;
        d[j] := round(u * pr[j] * least(o.value,100) / 100, 2); ofid[j] := o.id; onm[j] := o.name; cl[j] := true;
      end loop;
    elsif o.kind = 'bundle' then
      k := null; setv := 0;
      foreach refv in array o.refs loop
        select coalesce(sum(floor(q[g.i])),0), max(pr[g.i]) into units, base from generate_series(1,n) g(i) where not cl[g.i] and iid[g.i]::text = refv;
        if units = 0 then k := 0; exit; end if;
        k := least(coalesce(k, units), units); setv := setv + base;
      end loop;
      if coalesce(k,0) = 0 or setv <= o.value then continue; end if;
      foreach refv in array o.refs loop
        u := k;
        for i in 1..n loop
          if cl[i] or iid[i]::text <> refv or u <= 0 then continue; end if;
          dd := least(floor(q[i]), u); u := u - dd;
          d[i] := round(dd * pr[i] * (1 - o.value / setv), 2); ofid[i] := o.id; onm[i] := o.name; cl[i] := true;
        end loop;
      end loop;
    elsif o.kind = 'gift' then
      if o.gift_item is null then continue; end if;
      units := 0; idx := '{}';
      for i in 1..n loop
        if cl[i] or not public._offer_hits(o, iid[i], grp[i], dep[i]) then continue; end if;
        units := units + floor(q[i]); idx := idx || i;
      end loop;
      free := floor(units / greatest(coalesce(o.buy_qty,1),1)) * greatest(coalesce(o.get_qty,1),1);
      if free <= 0 then continue; end if;
      k := 0;
      for i in 1..n loop
        if cl[i] or iid[i] <> o.gift_item or free <= 0 then continue; end if;
        u := least(floor(q[i]), free); free := free - u; k := k + u;
        d[i] := round(u * pr[i], 2); ofid[i] := o.id; onm[i] := o.name; cl[i] := true;
      end loop;
      if k > 0 then foreach j in array idx loop ofid[j] := o.id; onm[j] := o.name; cl[j] := true; end loop; end if;
    end if;
  end loop;
  -- one invoice offer, on what no item offer touched
  base := 0; for i in 1..n loop if not cl[i] then base := base + pr[i] * q[i]; end if; end loop;
  if base > 0 then
    for o in select * from public.offers where status = 'active' and scope = 'invoice' order by priority desc, id loop
      if not public._offer_live(o, p_loc, p_at) or base < coalesce(o.min_total,0) then continue; end if;
      dd := round(case when o.kind = 'pct' then base * least(o.value,100) / 100 else least(o.value, base) end, 2);
      if dd <= 0 then continue; end if;
      acc := 0; lst := null;
      for i in 1..n loop
        if cl[i] then continue; end if;
        d[i] := round(dd * pr[i] * q[i] / base, 2); acc := acc + d[i]; ofid[i] := o.id; onm[i] := o.name; lst := i;
      end loop;
      d[lst] := d[lst] + (dd - acc);
      inv := jsonb_build_object('d', dd, 'o', o.id, 'n', o.name);
      exit;
    end loop;
  end if;
  for i in 1..n loop res := res || jsonb_build_object('d', d[i], 'o', ofid[i], 'n', onm[i]); end loop;
  return jsonb_build_object('lines', res, 'inv', inv, 'total', (select coalesce(sum(x),0) from unnest(d) x));
end $$;
create or replace function public._offer_margins(o public.offers) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare wc numeric := coalesce((select max(rate) from public.finance_plans where active and payer = 'store'),0); mm numeric := (select min_margin_pct from public.store where id = 1);
        setv numeric; gc numeric; it record; net numeric; na numeric; wl jsonb := '[]'; m numeric;
begin
  if o.scope = 'invoice' and o.kind = 'amount' then return jsonb_build_object('worst_comm', wc, 'min_margin', mm, 'rows', wl); end if;
  if o.kind = 'bundle' then select sum(sale_price) into setv from public.items where id::text = any(o.refs); end if;
  if o.kind = 'gift' then select last_cost into gc from public.items where id = o.gift_item; end if;
  for it in select i.id, i.name, i.sale_price, i.last_cost from public.items i
             where not i.hidden and i.last_cost > 0 and public._offer_hits(o, i.id, i.group_id, i.department_id) order by i.name limit 2000 loop
    net := case o.kind when 'pct' then it.sale_price * (1 - least(o.value,100) / 100)
                       when 'amount' then it.sale_price - least(o.value, it.sale_price)
                       when 'bxgy' then it.sale_price * o.buy_qty / nullif(o.buy_qty + o.get_qty,0)
                       when 'nth' then it.sale_price * (o.buy_qty + o.get_qty * (1 - least(o.value,100) / 100)) / nullif(o.buy_qty + o.get_qty,0)
                       when 'bundle' then it.sale_price * o.value / nullif(setv,0)
                       when 'gift' then it.sale_price - coalesce(gc,0) * coalesce(o.get_qty,1) / greatest(coalesce(o.buy_qty,1),1) end;
    na := round(net * (1 - wc / 100), 2);
    m := case when na > 0 then round((na - it.last_cost) / na * 100, 1) end;
    if na < it.last_cost or m < mm then
      wl := wl || jsonb_build_object('item', it.name, 'net', na, 'cost', it.last_cost, 'margin', m, 'level', case when na < it.last_cost then 'cost' else 'margin' end);
    end if;
  end loop;
  return jsonb_build_object('worst_comm', wc, 'min_margin', mm, 'rows', wl);
end $$;
create or replace function public.offer_save(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; o public.offers; prev public.offers; mg jsonb; c text; nid int;
begin
  s := public._session(p_token);
  o := jsonb_populate_record(null::public.offers, p);
  if o.id is not null then
    select * into prev from public.offers where id = o.id for update;
    if prev.id is null then raise exception 'NOT_FOUND'; end if;
    if not (s.role_id in ('owner','gm') or public._can(s.role_id,'offers','e')) then raise exception 'NOT_ALLOWED:offers'; end if;
    o.status := prev.status; o.created_by := prev.created_by; o.created_at := prev.created_at;
  else
    if not (s.role_id in ('owner','gm') or public._can(s.role_id,'offers','a')) then raise exception 'NOT_ALLOWED:offers'; end if;
    o.status := 'active'; o.created_by := s.staff_id; o.created_at := now();
  end if;
  o.starts_at := coalesce(o.starts_at, now()); o.priority := coalesce(o.priority, 1); o.refs := coalesce(o.refs, '{}'); o.value := coalesce(o.value, 0);
  if coalesce(trim(o.name),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if o.ends_at is not null and o.ends_at <= o.starts_at then raise exception 'BAD_DATES'; end if;
  if o.scope <> 'invoice' and cardinality(o.refs) = 0 then raise exception 'OFFER_TARGET_REQUIRED'; end if;
  if (o.kind = 'bundle') <> (o.scope = 'bundle') then raise exception 'BAD_OFFER'; end if;
  if o.kind = 'bundle' and (cardinality(o.refs) < 2 or o.value <= 0) then raise exception 'BUNDLE_NEEDS_ITEMS'; end if;
  if o.scope = 'invoice' and o.kind not in ('pct','amount') then raise exception 'BAD_OFFER'; end if;
  if o.kind = 'pct' and not (o.value > 0 and o.value <= 100) then raise exception 'BAD_AMOUNT'; end if;
  if o.kind = 'amount' and o.value <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if o.kind = 'bxgy' and (coalesce(o.buy_qty,0) < 1 or coalesce(o.get_qty,0) < 1) then raise exception 'BAD_QTY'; end if;
  if o.kind = 'nth' and (coalesce(o.buy_qty,0) < 1 or coalesce(o.get_qty,0) < 1) then raise exception 'BAD_QTY'; end if;
  if o.kind = 'nth' and not (o.value > 0 and o.value <= 100) then raise exception 'BAD_AMOUNT'; end if;
  if o.kind = 'gift' and o.gift_item is null then raise exception 'GIFT_REQUIRED'; end if;
  if o.hour_from is not null and o.hour_to is not null and o.hour_from = o.hour_to then raise exception 'BAD_DATES'; end if;
  c := public._offer_overlap(o);
  if c is not null then raise exception 'OFFER_OVERLAP:%', c; end if;
  mg := public._offer_margins(o);
  if jsonb_array_length(mg->'rows') > 0 then
    if not coalesce((p->>'confirm')::boolean, false) then return jsonb_build_object('ok', false, 'check', mg); end if;
    if exists (select 1 from jsonb_array_elements(mg->'rows') x where x->>'level' = 'cost') and s.role_id not in ('owner','gm') then raise exception 'BELOW_COST_NEEDS_OWNER'; end if;
  end if;
  o.updated_at := now();
  if o.id is null then
    o.id := nextval(pg_get_serial_sequence('public.offers','id'));
    insert into public.offers select o.*;
  else
    update public.offers set name = o.name, kind = o.kind, scope = o.scope, refs = o.refs, value = o.value, buy_qty = o.buy_qty, get_qty = o.get_qty, gift_item = o.gift_item,
      min_total = o.min_total, locs = o.locs, starts_at = o.starts_at, ends_at = o.ends_at, days = o.days, hour_from = o.hour_from, hour_to = o.hour_to,
      priority = o.priority, note = o.note, updated_at = now() where id = o.id;
  end if;
  perform public._audit(s, case when prev.id is null then 'إنشاء عرض' else 'تعديل عرض' end, o.name, case when prev.id is null then null else to_jsonb(prev)::text end, to_jsonb(o)::text,
    case when jsonb_array_length(mg->'rows') > 0 then 'اتأكد رغم تحذير الهامش' end, null);
  return jsonb_build_object('ok', true, 'id', o.id);
end $$;
create or replace function public.sale_post(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; sh public.shifts; st public.store; it public.items; ln jsonb; pay jsonb; ex public.sales; pl public.finance_plans; co public.finance_companies;
        bd date; sid uuid; no text; gross numeric := 0; disc numeric := 0; vat numeric := 0; total numeric; v_cost numeric := 0; lc numeric; lv numeric; comm numeric := 0; c1 numeric;
        dp numeric := coalesce((p->>'discount_pct')::numeric,0); maxd numeric; appr public.staff; paid numeric := 0; cust uuid; need_cust boolean := false;
        r numeric; share numeric; lines_tmp jsonb := '[]'; w numeric; ofr jsonb; od numeric; ld numeric; odt numeric := 0; i int; n int;
        cp public.coupons; cd numeric := 0; cbase numeric := 0; csh numeric; cacc numeric := 0; clast int; rs public.reservations; dep_pay numeric := 0;
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
  -- completing a reservation: its held items may leave, and its deposit pays part of the invoice
  if nullif(p->>'reservation_id','') is not null then
    select * into rs from public.reservations where id = (p->>'reservation_id')::uuid for update;
    if rs.id is null or rs.status <> 'open' then raise exception 'RESERVATION_CLOSED'; end if;
    if rs.location_id <> sh.location_id then raise exception 'OUT_OF_SCOPE'; end if;
    perform set_config('mz.res', rs.id::text, true);
  end if;
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
  n := jsonb_array_length(lines_tmp);
  -- offers: skipped when the sale was rung up offline (the customer paid the normal price)
  if coalesce((p->>'offers_seen')::boolean, true) then
    begin ofr := public._offer_price(lines_tmp, sh.location_id, now()); exception when others then ofr := null; end;
  end if;
  for i in 0..n-1 loop
    od := coalesce(((ofr->'lines'->i)->>'d')::numeric, 0);
    ld := od + round(((lines_tmp->i->>'price')::numeric * (lines_tmp->i->>'qty')::numeric - od) * dp / 100, 2);
    lines_tmp := jsonb_set(lines_tmp, array[i::text], (lines_tmp->i) || jsonb_build_object('od', od, 'ld', ld, 'ofid', (ofr->'lines'->i)->'o'));
    disc := disc + ld; odt := odt + od;
  end loop;
  -- coupon: a percent / amount off what is left after offers and the manual discount, shared over the lines
  if coalesce(trim(p->>'coupon'),'') <> '' then
    cp := public._coupon_get(p->>'coupon', coalesce(trim(p->'customer'->>'phone'),''));
    for i in 0..n-1 loop cbase := cbase + (lines_tmp->i->>'price')::numeric * (lines_tmp->i->>'qty')::numeric - (lines_tmp->i->>'ld')::numeric; end loop;
    if cbase < coalesce(cp.min_total,0) then raise exception 'COUPON_MIN:%', cp.min_total; end if;
    cd := round(case when cp.kind = 'pct' then cbase * least(cp.value,100) / 100 else least(cp.value, cbase) end, 2);
    if cp.max_disc is not null then cd := least(cd, cp.max_disc); end if;
    if cd > 0 then
      for i in 0..n-1 loop
        csh := round(cd * ((lines_tmp->i->>'price')::numeric * (lines_tmp->i->>'qty')::numeric - (lines_tmp->i->>'ld')::numeric) / nullif(cbase,0), 2);
        lines_tmp := jsonb_set(lines_tmp, array[i::text], (lines_tmp->i) || jsonb_build_object('ld', (lines_tmp->i->>'ld')::numeric + csh));
        cacc := cacc + csh; clast := i;
      end loop;
      lines_tmp := jsonb_set(lines_tmp, array[clast::text], (lines_tmp->clast) || jsonb_build_object('ld', (lines_tmp->clast->>'ld')::numeric + (cd - cacc)));
      disc := disc + cd;
    end if;
  end if;
  total := gross - disc;
  if st.vat_registered and st.vat_from is not null and bd >= st.vat_from then
    for ln in select * from jsonb_array_elements(lines_tmp) loop
      r := (ln->>'vat_rate')::numeric / 100; share := (ln->>'price')::numeric * (ln->>'qty')::numeric - (ln->>'ld')::numeric;
      vat := vat + case when st.prices_include_vat then share - share/(1+r) else share * r end;
    end loop;
    vat := round(vat, 2);
    if not st.prices_include_vat then total := total + vat; end if;
  end if;
  for pay in select * from jsonb_array_elements(coalesce(p->'payments','[]')) loop
    if (pay->>'method') not in ('cash','card','insta','wallet','inst','points','deposit') then raise exception 'BAD_PAYMENT_METHOD'; end if;
    if (pay->>'method') = 'deposit' then
      if rs.id is null then raise exception 'BAD_PAYMENT_METHOD'; end if;
      dep_pay := dep_pay + (pay->>'amount')::numeric;
    end if;
    if (pay->>'method') = 'points' and (pay->>'amount')::numeric > 0 then need_cust := true; end if;
    if (pay->>'method') = 'inst' then
      select * into pl from public.finance_plans where id = nullif(pay->>'plan_id','')::int and active;
      if pl.id is null then raise exception 'PLAN_REQUIRED'; end if;
      need_cust := true;
    end if;
    paid := paid + (pay->>'amount')::numeric;
  end loop;
  if rs.id is not null and dep_pay <> rs.deposit then raise exception 'DEPOSIT_MISMATCH:%', rs.deposit; end if;
  if rs.id is not null and rs.deposit > total then raise exception 'DEPOSIT_MORE_THAN_TOTAL'; end if;
  if paid < total then raise exception 'UNDERPAID:%', total - paid; end if;
  if paid - total > coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p->'payments') x where x->>'method' = 'cash'),0) then raise exception 'OVERPAID_NON_CASH'; end if;
  if coalesce(trim(p->'customer'->>'phone'),'') <> '' then
    insert into public.customers (name, phone) values (coalesce(nullif(trim(p->'customer'->>'name'),''),'عميل'), trim(p->'customer'->>'phone'))
    on conflict (phone) do update set name = coalesce(nullif(trim(excluded.name),''), public.customers.name) returning id into cust;
  elsif need_cust then raise exception 'CUSTOMER_REQUIRED';
  end if;
  no := 'INV-' || lpad(nextval('public.sale_no_seq')::text, 6, '0');
  insert into public.sales (no, location_id, shift_id, device_id, cashier_id, seller_id, customer_id, business_day, gross, discount, vat, total, client_uuid, offer_disc)
  values (no, sh.location_id, sh.id, s.device_id, s.staff_id, nullif(p->>'seller_id','')::uuid, coalesce(cust, rs.customer_id), bd, gross, disc, vat, total, nullif(p->>'client_uuid','')::uuid, odt)
  returning id into sid;
  if cd > 0 then
    update public.sales set coupon_disc = cd where id = sid;
    insert into public.coupon_uses (coupon_id, sale_id, customer_phone, amount) values (cp.id, sid, nullif(trim(p->'customer'->>'phone'),''), cd);
    update public.coupons set uses = uses + 1 where id = cp.id;
  end if;
  if rs.id is not null then update public.reservations set status = 'done', sale_id = sid, closed_by = s.staff_id, closed_at = now() where id = rs.id; end if;
  for ln in select * from jsonb_array_elements(lines_tmp) loop
    w := coalesce(nullif(ln->>'waste','')::numeric,0) / 100.0;
    lc := public._fifo_out((ln->>'item_id')::uuid, sh.location_id, (ln->>'qty')::numeric);
    if w > 0 then
      lv := public._fifo_out((ln->>'item_id')::uuid, sh.location_id, w);
      insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values ((ln->>'item_id')::uuid, sh.location_id, -w, lv, 'waste', 'sale', no, s.staff_id);
    end if;
    v_cost := v_cost + lc;
    insert into public.sale_lines (sale_id, item_id, qty, unit_price, discount, cost, serial, cut_waste_m, offer_id, offer_disc)
    values (sid, (ln->>'item_id')::uuid, (ln->>'qty')::numeric, (ln->>'price')::numeric, (ln->>'ld')::numeric, lc, nullif(ln->>'serial',''), nullif(w,0), nullif(ln->>'ofid','')::int, (ln->>'od')::numeric);
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
    from (select pay2->>'method' method, sum((pay2->>'amount')::numeric) amount from jsonb_array_elements(p->'payments') pay2 group by 1) x where x.amount <> 0 and x.method not in ('inst','points','deposit');
  if (p->>'held_id') is not null then update public.held_sales set status = 'taken', taken_by = s.staff_id where id = (p->>'held_id')::uuid and status in ('open','taken'); end if;
  if appr.id is not null then perform public._audit(s,'اعتماد خصم يدوي فوق الحد',no,maxd::text||'%',dp::text||'% · '||appr.name,null,sh.location_id); end if;
  perform public._audit(s,'فاتورة بيع',no,null,total::text,null,sh.location_id);
  return jsonb_build_object('id', sid, 'no', no, 'gross', gross, 'discount', disc, 'offer_disc', odt, 'vat', vat, 'total', total, 'change', paid - total, 'business_day', bd, 'commission', comm, 'coupon_disc', cd);
end $$;

alter table public.sale_payments drop constraint if exists sale_payments_method_check;
alter table public.sale_payments add constraint sale_payments_method_check check (method in ('cash','card','insta','wallet','inst','points','exchange','deposit'));
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
      select '5205', p.amount, 0 from public.sale_payments p where p.sale_id = s.id and p.method = 'points' union all
      select '2103', p.amount, 0 from public.sale_payments p where p.sale_id = s.id and p.method in ('exchange','deposit') union all
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
        select case when cm.ref_type = 'swap' then '2103' when cm.gl_account is not null then cm.gl_account
                    when cm.kind in ('float','deposit') and cm.ref_type is distinct from 'finance' then '1110'
                    when cm.kind = 'deposit' and cm.ref_type = 'finance' then '1104'
                    when cm.kind = 'adjust' then case when cm.amount < 0 then '5207' else '4103' end
                    when cm.kind = 'expense' and cm.ref_type = 'supplier' then '2101'
                    when cm.kind = 'opening' then '3103' else '5207' end,
               greatest(-cm.amount,0), greatest(cm.amount,0)
      ) x where (cm.kind not in ('sale','refund') or cm.ref_type = 'swap') and cm.amount <> 0
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
    -- straight-line depreciation, one entry at each month end, starting with the purchase month;
    -- an opening-sheet asset is already net on the opening date, so it starts with the month after that day
    select x.me, 'depreciation', 'FA-' || fa.id, 'إهلاك ' || fa.name, y.account, y.dr, y.cr, fa.location_id
      from public.fixed_assets fa
      cross join lateral (select (date_trunc('month', gs) + interval '1 month - 1 day')::date me
                            from generate_series(date_trunc('month', case when fa.opening then fa.start_date + 1 else fa.start_date end), date_trunc('month', least(coalesce(fa.disposed_on, current_date), current_date)), interval '1 month') gs
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
revoke execute on function public._gl_rows(date,date) from public, anon, authenticated;


revoke execute on function public._reserved(uuid, smallint), public._cust_upsert(text, text), public._coupon_get(text, text) from public, anon, authenticated;
revoke execute on function public.reservation_create(text, jsonb), public.reservation_pay(text, uuid, numeric, text), public.reservation_cancel(text, uuid, text, text),
  public.reservations_list(text), public.quote_save(text, jsonb), public.quotes_list(text), public.coupon_check(text, text, text), public.coupon_save(text, jsonb),
  public.coupon_set_status(text, int, text), public.coupons_list(text), public.customers_list(text), public.customer_save(text, jsonb), public.offer_save(text, jsonb), public.sale_post(text, jsonb) from public, anon;
grant execute on function public.reservation_create(text, jsonb), public.reservation_pay(text, uuid, numeric, text), public.reservation_cancel(text, uuid, text, text),
  public.reservations_list(text), public.quote_save(text, jsonb), public.quotes_list(text), public.coupon_check(text, text, text), public.coupon_save(text, jsonb),
  public.coupon_set_status(text, int, text), public.coupons_list(text), public.customers_list(text), public.customer_save(text, jsonb), public.offer_save(text, jsonb), public.sale_post(text, jsonb) to authenticated;
