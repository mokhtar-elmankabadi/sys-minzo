-- =====================================================================
-- DAY CLOSING
-- =====================================================================
create or replace function public._sale_day_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public._day_closed(new.location_id, new.business_day) then raise exception 'DAY_CLOSED'; end if;
  return new;
end $$;
create trigger sales_day_guard before insert on public.sales for each row execute function public._sale_day_guard();

create or replace function public._day_summary(p_loc smallint, p_day date) returns jsonb
language sql stable security definer set search_path = public as $$
  with sl as (select * from public.sales where location_id = p_loc and business_day = p_day),
  pay as (select p.method, sum(p.amount) amt from public.sale_payments p join sl on sl.id = p.sale_id where sl.status = 'posted' group by p.method),
  rt as (select r.* from public.returns r where r.location_id = p_loc and public._bday_of(r.created_at) = p_day),
  ex as (select e.*, c.name cat from public.expenses e join public.expense_categories c on c.id = e.category_id where e.location_id = p_loc and e.exp_date = p_day),
  sh as (select s.* from public.shifts s where s.location_id = p_loc and (
           exists (select 1 from sl where sl.shift_id = s.id) or public._bday_of(s.opened_at) = p_day))
  select jsonb_build_object(
    'invoices', (select count(*) from sl where status = 'posted'),
    'voids', (select count(*) from sl where status = 'void'),
    'gross', (select coalesce(sum(gross),0) from sl where status = 'posted'),
    'discount', (select coalesce(sum(discount),0) from sl where status = 'posted'),
    'vat', (select coalesce(sum(vat),0) from sl where status = 'posted'),
    'total', (select coalesce(sum(total),0) from sl where status = 'posted'),
    'cost', (select coalesce(sum(cost),0) from sl where status = 'posted'),
    'returns', (select coalesce(sum(amount),0) from rt),
    'returns_n', (select count(*) from rt),
    'returns_cash', (select coalesce(sum(amount),0) from rt where refund_method = 'cash'),
    'pay', coalesce((select jsonb_object_agg(method, amt) from pay), '{}'::jsonb),
    'expenses', (select coalesce(sum(amount),0) from ex where status = 'approved'),
    'expense_list', coalesce((select jsonb_agg(jsonb_build_object('no',no,'cat',cat,'note',note,'amount',amount,'status',status,'drawer',shift_id is not null) order by created_at) from ex where status in ('approved','pending')), '[]'::jsonb),
    'expenses_pending', (select count(*) from ex where status = 'pending'),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('id',id,'cashier',(select name from public.staff where id = sh.cashier_id),'status',status,'opened_at',opened_at,'closed_at',closed_at,
               'expected',expected_cash,'counted',counted_cash,'diff',diff,'reason',diff_reason) order by opened_at) from sh), '[]'::jsonb),
    'cash_diff', (select coalesce(sum(diff),0) from sh),
    'deposited', (select coalesce(sum(-m.amount),0) from public.cash_moves m where m.kind = 'deposit' and m.amount < 0 and m.ref_type = 'shift' and m.ref_id in (select id::text from sh)),
    'open_shifts', (select count(*) from public.shifts where location_id = p_loc and status = 'open'),
    'handed_shifts', (select count(*) from public.shifts where location_id = p_loc and status = 'handed'),
    'held_open', (select count(*) from public.held_sales where location_id = p_loc and status = 'open'),
    'transfers_waiting', (select count(*) from public.transfers where (to_location = p_loc and status = 'shipped') or (from_location = p_loc and status = 'approved'))
  );
$$;

create or replace function public.day_close_preview(p_token text, p_loc smallint, p_day date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; dc public.day_closings; st public.store; cur date; lt timestamp := (now() at time zone 'Africa/Cairo');
begin
  s := public._session(p_token); perform public._require(s,'close','v');
  if not public._loc_ok(s, p_loc) then raise exception 'OUT_OF_SCOPE'; end if;
  select * into st from public.store;
  cur := public._bday_of(now());
  select * into dc from public.day_closings where location_id = p_loc and business_day = p_day;
  return jsonb_build_object('day', p_day, 'current_day', cur, 'early', p_day >= cur and not (lt::time >= st.day_close_time and lt::time < st.day_open_time and p_day = cur),
    'close_time', st.day_close_time, 'open_time', st.day_open_time,
    'closing', case when dc.location_id is null then null else jsonb_build_object('status',dc.status,'closed_at',dc.closed_at,'closed_by',(select name from public.staff where id = dc.closed_by),
       'note',dc.note,'reopened_at',dc.reopened_at,'reopened_by',(select name from public.staff where id = dc.reopened_by),'reopen_reason',dc.reopen_reason,'summary',dc.summary) end,
    'summary', public._day_summary(p_loc, p_day));
end $$;

create or replace function public.day_close(p_token text, p_loc smallint, p_day date, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sm jsonb; pv jsonb;
begin
  s := public._session(p_token); perform public._require(s,'close','p');
  if not public._loc_ok(s, p_loc) then raise exception 'OUT_OF_SCOPE'; end if;
  if public._day_closed(p_loc, p_day) then raise exception 'ALREADY_CLOSED'; end if;
  pv := public.day_close_preview(p_token, p_loc, p_day);
  if p_day > (pv->>'current_day')::date then raise exception 'BAD_DATES'; end if;
  sm := pv->'summary';
  if (sm->>'open_shifts')::int > 0 then raise exception 'SHIFT_STILL_OPEN'; end if;
  if (sm->>'handed_shifts')::int > 0 then raise exception 'SHIFTS_NOT_APPROVED'; end if;
  if (pv->>'early')::boolean then
    if not (public._has(s.role_id,'manualClose') or s.role_id = 'owner') then raise exception 'NOT_ALLOWED:manualClose'; end if;
    if coalesce(length(trim(p_note)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  end if;
  insert into public.day_closings (location_id, business_day, status, summary, note, closed_by) values (p_loc, p_day, 'closed', sm, nullif(trim(p_note),''), s.staff_id)
  on conflict (location_id, business_day) do update set status = 'closed', summary = excluded.summary, note = excluded.note, closed_by = excluded.closed_by, closed_at = now();
  perform public._audit(s,'تقفيل يوم',(select name from public.locations where id = p_loc) || ' · ' || p_day,null,(sm->>'total'),p_note,p_loc);
  return sm;
end $$;

create or replace function public.day_reopen(p_token text, p_loc smallint, p_day date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if s.role_id <> 'owner' then raise exception 'ONLY_OWNER'; end if;
  if coalesce(length(trim(p_reason)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.day_closings set status = 'reopened', reopened_by = s.staff_id, reopened_at = now(), reopen_reason = trim(p_reason)
   where location_id = p_loc and business_day = p_day and status = 'closed';
  if not found then raise exception 'NOT_FOUND'; end if;
  perform public._audit(s,'إعادة فتح يوم',(select name from public.locations where id = p_loc) || ' · ' || p_day,null,null,p_reason,p_loc);
end $$;

-- =====================================================================
-- CUSTOMERS & LOYALTY
-- =====================================================================
alter table public.customers add column if not exists address text;
alter table public.customers add column if not exists area text;
alter table public.customers add column if not exists notes text;
alter table public.customers add column if not exists hidden boolean not null default false;
alter table public.customers add column if not exists updated_at timestamptz not null default now();

create table public.loyalty_moves (
  id bigserial primary key,
  customer_id uuid not null references public.customers(id),
  points int not null,
  kind text not null check (kind in ('adjust','redeem')),
  note text not null,
  staff_id uuid references public.staff(id),
  created_at timestamptz not null default now()
);
alter table public.loyalty_moves enable row level security;

create or replace function public._cust_spent(p_cust uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(total) from public.sales where customer_id = p_cust and status = 'posted'),0)
       - coalesce((select sum(r.amount) from public.returns r join public.sales s on s.id = r.sale_id where s.customer_id = p_cust),0);
$$;
create or replace function public._cust_points(p_cust uuid) returns int
language sql stable security definer set search_path = public as $$
  select (case when st.loyalty_on and st.loyalty_per > 0 then floor(greatest(public._cust_spent(p_cust),0) / st.loyalty_per)::int else 0 end)
       + coalesce((select sum(points) from public.loyalty_moves where customer_id = p_cust),0)::int
  from public.store st;
$$;

create or replace function public.customers_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._require(s,'customers','v');
  return coalesce((select jsonb_agg(x order by x->>'last' desc nulls last) from (
    select jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone,'area',c.area,'address',c.address,'notes',c.notes,'created_at',c.created_at,
      'invoices',(select count(*) from public.sales where customer_id = c.id and status = 'posted'),
      'spent',public._cust_spent(c.id),'points',public._cust_points(c.id),
      'last',(select max(created_at) from public.sales where customer_id = c.id and status = 'posted'),
      'warranties',(select count(*) from public.serials sr join public.sales sa on sa.id = sr.sale_id join public.items it on it.id = sr.item_id
                     where sa.customer_id = c.id and sr.status = 'sold' and it.warranty_months > 0 and sa.created_at + make_interval(months => it.warranty_months) > now())) x
    from public.customers c where not c.hidden) t), '[]'::jsonb);
end $$;

create or replace function public.customer_save(p_token text, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid uuid; ph text := nullif(regexp_replace(coalesce(p->>'phone',''),'[^0-9+]','','g'),'');
begin
  s := public._session(p_token);
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if (p->>'id') is null then
    perform public._require(s,'customers','a');
    insert into public.customers (name, phone, area, address, notes) values (trim(p->>'name'), ph, nullif(trim(p->>'area'),''), nullif(trim(p->>'address'),''), nullif(trim(p->>'notes'),''))
    returning id into nid;
    perform public._audit(s,'إضافة عميل',trim(p->>'name'),null,ph,null,null);
  else
    perform public._require(s,'customers','e');
    update public.customers set name = trim(p->>'name'), phone = ph, area = nullif(trim(p->>'area'),''), address = nullif(trim(p->>'address'),''),
      notes = nullif(trim(p->>'notes'),''), hidden = coalesce((p->>'hidden')::boolean, hidden), updated_at = now() where id = (p->>'id')::uuid returning id into nid;
    if nid is null then raise exception 'NOT_FOUND'; end if;
    perform public._audit(s,'تعديل عميل',trim(p->>'name'),null,ph,null,null);
  end if;
  return nid;
exception when unique_violation then raise exception 'PHONE_TAKEN';
end $$;

create or replace function public.loyalty_move(p_token text, p_customer uuid, p_points int, p_kind text, p_note text) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; bal int;
begin
  s := public._session(p_token); perform public._require(s,'customers','e');
  if p_kind not in ('adjust','redeem') or coalesce(p_points,0) = 0 then raise exception 'BAD_AMOUNT'; end if;
  if p_kind = 'adjust' and not (s.role_id in ('owner','gm') or public._can(s.role_id,'customers','p')) then raise exception 'NOT_ALLOWED:customers:p'; end if;
  if coalesce(length(trim(p_note)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  bal := public._cust_points(p_customer);
  if p_kind = 'redeem' and (p_points <= 0 or p_points > bal) then raise exception 'MORE_THAN_POINTS'; end if;
  insert into public.loyalty_moves (customer_id, points, kind, note, staff_id) values (p_customer, case when p_kind = 'redeem' then -abs(p_points) else p_points end, p_kind, trim(p_note), s.staff_id);
  perform public._audit(s, case when p_kind = 'redeem' then 'استبدال نقاط' else 'تسوية نقاط' end, (select name from public.customers where id = p_customer), bal::text, public._cust_points(p_customer)::text, p_note, null);
  return public._cust_points(p_customer);
end $$;

create or replace function public.customer_history(p_token text, p_customer uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._require(s,'customers','v');
  return jsonb_build_object(
    'sales', coalesce((select jsonb_agg(jsonb_build_object('id',id,'no',no,'at',created_at,'total',total,'status',status,'loc',location_id) order by created_at desc) from public.sales where customer_id = p_customer), '[]'::jsonb),
    'loyalty', coalesce((select jsonb_agg(jsonb_build_object('at',created_at,'points',points,'kind',kind,'note',note) order by created_at desc) from public.loyalty_moves where customer_id = p_customer), '[]'::jsonb),
    'serials', coalesce((select jsonb_agg(jsonb_build_object('serial',sr.serial,'item',it.name,'sold',sa.created_at,'months',it.warranty_months,
               'until',(sa.created_at + make_interval(months => it.warranty_months))::date) order by sa.created_at desc)
             from public.serials sr join public.sales sa on sa.id = sr.sale_id join public.items it on it.id = sr.item_id where sa.customer_id = p_customer), '[]'::jsonb),
    'points', public._cust_points(p_customer), 'spent', public._cust_spent(p_customer));
end $$;

create or replace function public.serial_lookup(p_token text, p_serial text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; r jsonb;
begin
  s := public._session(p_token);
  select jsonb_build_object('serial',sr.serial,'status',sr.status,'item',it.name,'months',it.warranty_months,'location',sr.location_id,
     'sale_no',sa.no,'sold',sa.created_at,'until',case when sa.id is not null then (sa.created_at + make_interval(months => it.warranty_months))::date end,
     'customer',c.name,'phone',c.phone,
     'tickets',(select count(*) from public.service_tickets t where t.serial = sr.serial)) into r
    from public.serials sr join public.items it on it.id = sr.item_id left join public.sales sa on sa.id = sr.sale_id left join public.customers c on c.id = sa.customer_id
   where upper(sr.serial) = upper(trim(p_serial));
  return r;
end $$;

-- =====================================================================
-- DELIVERY & INSTALLATION
-- =====================================================================
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  sale_id uuid references public.sales(id),
  location_id smallint not null references public.locations(id),
  customer_name text not null,
  phone text not null,
  address text not null,
  area text,
  scheduled date,
  slot text,
  install boolean not null default false,
  items text,
  driver text,
  installer text,
  status text not null default 'new' check (status in ('new','prep','way','delivered','closed','cancelled')),
  note text,
  log jsonb not null default '[]'::jsonb,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.deliveries enable row level security;
create sequence public.dlv_no_seq start 1;

create or replace function public.delivery_save(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; d public.deliveries; sa public.sales; loc smallint; its text; cu public.customers;
begin
  s := public._session(p_token);
  if (p->>'sale_id') is not null then
    select * into sa from public.sales where id = (p->>'sale_id')::uuid;
    if sa.id is null or sa.status <> 'posted' then raise exception 'NOT_FOUND'; end if;
    select string_agg(it.name || ' ×' || trim(to_char(l.qty,'FM999990.###')), ' · ') into its from public.sale_lines l join public.items it on it.id = l.item_id where l.sale_id = sa.id;
    select * into cu from public.customers where id = sa.customer_id;
  end if;
  loc := coalesce(sa.location_id, nullif(p->>'location_id','')::smallint, s.device_location, s.location_id);
  if loc is null then raise exception 'NOT_FOUND'; end if;
  if not public._loc_ok(s, loc) then raise exception 'OUT_OF_SCOPE'; end if;
  if coalesce(trim(coalesce(p->>'customer_name', cu.name)),'') = '' or coalesce(trim(coalesce(nullif(p->>'phone',''), cu.phone)),'') = '' then raise exception 'CUSTOMER_REQUIRED'; end if;
  if coalesce(trim(p->>'address'),'') = '' then raise exception 'ADDRESS_REQUIRED'; end if;
  if (p->>'id') is null then
    perform public._require(s,'delivery','a');
    insert into public.deliveries (no, sale_id, location_id, customer_name, phone, address, area, scheduled, slot, install, items, driver, installer, note, created_by, log)
    values ('DLV-' || lpad(nextval('public.dlv_no_seq')::text,5,'0'), sa.id, loc, trim(coalesce(nullif(p->>'customer_name',''), cu.name)), trim(coalesce(nullif(p->>'phone',''), cu.phone)),
            trim(p->>'address'), nullif(trim(p->>'area'),''), nullif(p->>'scheduled','')::date, nullif(p->>'slot',''), coalesce((p->>'install')::boolean,false),
            coalesce(nullif(trim(p->>'items'),''), its), nullif(trim(p->>'driver'),''), nullif(trim(p->>'installer'),''), nullif(trim(p->>'note'),''), s.staff_id,
            jsonb_build_array(jsonb_build_object('at',now(),'by',s.staff_name,'to','new')))
    returning * into d;
    if cu.id is not null and cu.address is null then update public.customers set address = trim(p->>'address'), area = coalesce(area, nullif(trim(p->>'area'),'')) where id = cu.id; end if;
    perform public._audit(s,'طلب توصيل',d.no,null,d.customer_name,null,loc);
  else
    perform public._require(s,'delivery','e');
    update public.deliveries set customer_name = trim(p->>'customer_name'), phone = trim(p->>'phone'), address = trim(p->>'address'), area = nullif(trim(p->>'area'),''),
      scheduled = nullif(p->>'scheduled','')::date, slot = nullif(p->>'slot',''), install = coalesce((p->>'install')::boolean, install), items = nullif(trim(p->>'items'),''),
      driver = nullif(trim(p->>'driver'),''), installer = nullif(trim(p->>'installer'),''), note = nullif(trim(p->>'note'),''), updated_at = now()
     where id = (p->>'id')::uuid and status not in ('closed','cancelled') returning * into d;
    if d.id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return jsonb_build_object('id', d.id, 'no', d.no);
end $$;

create or replace function public.delivery_advance(p_token text, p_id uuid, p_to text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; d public.deliveries; ok boolean;
begin
  s := public._session(p_token); perform public._require(s,'delivery','e');
  select * into d from public.deliveries where id = p_id for update;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  if not public._loc_ok(s, d.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  ok := (d.status = 'new' and p_to = 'prep') or (d.status = 'prep' and p_to = 'way') or (d.status = 'way' and p_to = 'delivered')
     or (d.status = 'delivered' and p_to = 'closed') or (d.status not in ('closed','cancelled','delivered') and p_to = 'cancelled')
     or (d.status = 'way' and p_to = 'prep');   -- returned to the showroom (customer not home)
  if not ok then raise exception 'BAD_STATUS'; end if;
  if p_to in ('cancelled','prep') and d.status <> 'new' and coalesce(length(trim(p_note)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_to = 'way' and d.driver is null and coalesce(trim(p_note),'') = '' then raise exception 'DRIVER_REQUIRED'; end if;
  update public.deliveries set status = p_to, driver = case when p_to = 'way' and driver is null then trim(p_note) else driver end, updated_at = now(),
    log = log || jsonb_build_array(jsonb_build_object('at',now(),'by',s.staff_name,'to',p_to,'note',nullif(trim(p_note),''))) where id = d.id;
  perform public._audit(s,'حالة توصيل',d.no,d.status,p_to,p_note,d.location_id);
end $$;
revoke execute on function public._sale_day_guard(), public._day_summary(smallint,date), public.day_close_preview(text,smallint,date), public.day_close(text,smallint,date,text),
  public.day_reopen(text,smallint,date,text), public._cust_spent(uuid), public._cust_points(uuid), public.customers_list(text), public.customer_save(text,jsonb),
  public.loyalty_move(text,uuid,int,text,text), public.customer_history(text,uuid), public.serial_lookup(text,text), public.delivery_save(text,jsonb), public.delivery_advance(text,uuid,text,text)
  from public, anon, authenticated;
