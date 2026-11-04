-- 0014 · Daily operations: expenses, day closing, customers & loyalty, delivery & installation, printers & labels
-- ======================================================================================================

-- ---------- roles: modules the prototype had for these screens (existing keys are kept) ----------
update public.roles set perms = '{"returns":"vaep","delivery":"vae","expense":"vaep"}'::jsonb || perms where id = 'mgr';
update public.roles set perms = '{"returns":"va","delivery":"vae","expense":"va"}'::jsonb || perms where id = 'asstmgr';
update public.roles set perms = '{"returns":"va","delivery":"va","expense":"va"}'::jsonb || perms where id = 'shiftmgr';
update public.roles set perms = '{"returns":"va","delivery":"v","expense":"va"}'::jsonb || perms where id = 'cashier';
update public.roles set perms = '{"delivery":"v"}'::jsonb || perms where id = 'seller';
update public.roles set perms = '{"delivery":"vae"}'::jsonb || perms where id = 'keeper';
update public.roles set perms = '{"expense":"vaedpx","delivery":"v","returns":"v"}'::jsonb || perms where id = 'acct';
update public.roles set perms = '{"expense":"vax","returns":"v"}'::jsonb || perms where id = 'asstacct';
update public.roles set sens = sens || '["printerSetup"]'::jsonb where id in ('gm','mgr') and not sens ? 'printerSetup';

-- ---------- store settings ----------
alter table public.store add column if not exists loyalty_on boolean not null default true;
alter table public.store add column if not exists loyalty_per numeric(10,2) not null default 100;     -- EGP spent per point
alter table public.store add column if not exists loyalty_value numeric(10,2) not null default 0.5;   -- EGP value of one point
alter table public.store add column if not exists receipt jsonb not null default
  '{"size":"80","logo":true,"name":true,"addr":"","phone":"","footer":"الاستبدال خلال ١٤ يوم بالفاتورة الأصلية","savings":true,"qr":true}'::jsonb;

-- =====================================================================
-- EXPENSES
-- =====================================================================
create table public.expense_categories (
  id serial primary key,
  name text not null unique,
  grp text not null default 'تشغيلية' check (grp in ('إدارية','تشغيلية','بيعية')),
  account text not null references public.gl_accounts(code),
  budget numeric(14,2) not null default 0,         -- monthly, 0 = no budget
  active boolean not null default true,
  sort int not null default 0
);
insert into public.expense_categories (name, grp, account, sort) values
 ('إيجار','إدارية','5202',1), ('مرتبات وأجور','إدارية','5201',2), ('كهرباء','تشغيلية','5203',3), ('مياه وغاز','تشغيلية','5203',4),
 ('نقل بضاعة','تشغيلية','5204',5), ('صيانة','تشغيلية','5210',6), ('دعاية وإعلان','بيعية','5205',7), ('عمولات توصيل','بيعية','5204',8),
 ('نثريات','تشغيلية','5207',9), ('رسوم بنكية','إدارية','5207',10);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  exp_date date not null,
  location_id smallint references public.locations(id),      -- null = general (head office)
  category_id int not null references public.expense_categories(id),
  amount numeric(14,2) not null check (amount > 0),
  payee text,
  note text not null,
  source_account int not null references public.cash_accounts(id),
  method text not null default 'cash' check (method in ('cash','bank','insta','wallet','cheque')),
  recurring boolean not null default false,
  status text not null default 'approved' check (status in ('pending','approved','rejected','void')),
  shift_id uuid references public.shifts(id),
  created_by uuid references public.staff(id),
  approved_by uuid references public.staff(id),
  approved_at timestamptz,
  decision_note text,
  void_reason text,
  void_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create index expenses_date_idx on public.expenses (exp_date, location_id);
create sequence public.exp_no_seq start 1;
alter table public.cash_moves add column if not exists gl_account text references public.gl_accounts(code);

-- day closing table first (expenses check it)
create table public.day_closings (
  location_id smallint not null references public.locations(id),
  business_day date not null,
  status text not null default 'closed' check (status in ('closed','reopened')),
  summary jsonb not null default '{}'::jsonb,
  note text,
  closed_by uuid references public.staff(id),
  closed_at timestamptz not null default now(),
  reopened_by uuid references public.staff(id),
  reopened_at timestamptz,
  reopen_reason text,
  primary key (location_id, business_day)
);
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.day_closings enable row level security;

create or replace function public._day_closed(p_loc smallint, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.day_closings where location_id = p_loc and business_day = p_day and status = 'closed');
$$;

create or replace function public._bday_of(p_ts timestamptz) returns date
language sql stable security definer set search_path = public as $$
  select case when (p_ts at time zone 'Africa/Cairo')::time < st.day_close_time then (p_ts at time zone 'Africa/Cairo')::date - 1 else (p_ts at time zone 'Africa/Cairo')::date end
  from public.store st;
$$;

create or replace function public._expense_pay(e public.expenses, p_staff uuid) returns void
language plpgsql security definer set search_path = public as $$
declare acc public.cash_accounts; sh uuid; cat public.expense_categories;
begin
  select * into acc from public.cash_accounts where id = e.source_account;
  select * into cat from public.expense_categories where id = e.category_id;
  if acc.kind = 'drawer' then
    select id into sh from public.shifts where drawer_id = acc.id and status = 'open';
    if sh is null then raise exception 'NO_OPEN_SHIFT'; end if;
  end if;
  insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, note, staff_id, gl_account)
  values (e.source_account, -e.amount, 'expense', case when e.method = 'cash' then 'cash' else 'bank' end, sh, 'expense', e.no,
          cat.name || ' — ' || e.note, p_staff, cat.account);
  update public.expenses set shift_id = sh where id = e.id;
end $$;

create or replace function public.expense_save(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; e public.expenses; lim numeric; acc public.cash_accounts; loc smallint; d date; amt numeric; st text;
begin
  s := public._session(p_token); perform public._require(s,'expense','a');
  amt := nullif(p->>'amount','')::numeric; if coalesce(amt,0) <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if coalesce(length(trim(p->>'note')),0) < 2 then raise exception 'MEMO_REQUIRED'; end if;
  loc := nullif(p->>'location_id','')::smallint;
  if loc is null and not (select scope_all_locations from public.roles where id = s.role_id) then loc := s.location_id; end if;
  if loc is not null and not public._loc_ok(s, loc) then raise exception 'OUT_OF_SCOPE'; end if;
  d := coalesce(nullif(p->>'exp_date','')::date, public._bday_of(now()));
  if d > (now() at time zone 'Africa/Cairo')::date then raise exception 'BAD_DATES'; end if;
  if public._gl_locked(d) then raise exception 'PERIOD_CLOSED'; end if;
  if loc is not null and public._day_closed(loc, d) and not (public._has(s.role_id,'editAfterClose') or s.role_id = 'owner') then raise exception 'DAY_CLOSED'; end if;
  select * into acc from public.cash_accounts where id = (p->>'source_account')::int and active;
  if acc.id is null then raise exception 'NOT_FOUND'; end if;
  if acc.kind = 'drawer' and acc.location_id is distinct from loc then raise exception 'DRAWER_OTHER_LOCATION'; end if;
  if not exists (select 1 from public.expense_categories where id = (p->>'category_id')::int and active) then raise exception 'NOT_FOUND'; end if;
  select max_amount into lim from public.roles where id = s.role_id;
  st := case when coalesce(lim,0) > 0 and amt > lim then 'pending' else 'approved' end;
  insert into public.expenses (no, exp_date, location_id, category_id, amount, payee, note, source_account, method, recurring, status, created_by, approved_by, approved_at)
  values ('EXP-' || lpad(nextval('public.exp_no_seq')::text, 5, '0'), d, loc, (p->>'category_id')::int, amt, nullif(trim(p->>'payee'),''), trim(p->>'note'),
          acc.id, case when acc.kind in ('drawer','treasury') then 'cash' else coalesce(nullif(p->>'method',''),'bank') end,
          coalesce((p->>'recurring')::boolean,false), st, s.staff_id, case when st = 'approved' then s.staff_id end, case when st = 'approved' then now() end)
  returning * into e;
  if st = 'approved' then perform public._expense_pay(e, s.staff_id); end if;
  perform public._audit(s,'تسجيل مصروف',e.no,null,amt::text,trim(p->>'note'),loc);
  return jsonb_build_object('no', e.no, 'status', st);
end $$;

create or replace function public.expense_decide(p_token text, p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; e public.expenses; lim numeric;
begin
  s := public._session(p_token); perform public._require(s,'expense','p');
  select * into e from public.expenses where id = p_id for update;
  if e.id is null then raise exception 'NOT_FOUND'; end if;
  if e.status <> 'pending' then raise exception 'BAD_STATUS'; end if;
  if e.location_id is not null and not public._loc_ok(s, e.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  if e.created_by = s.staff_id and s.role_id <> 'owner' then raise exception 'CANNOT_APPROVE_OWN'; end if;
  select max_amount into lim from public.roles where id = s.role_id;
  if p_approve and coalesce(lim,0) > 0 and e.amount > lim then raise exception 'NEEDS_OWNER'; end if;
  if not p_approve and coalesce(length(trim(p_note)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.expenses set status = case when p_approve then 'approved' else 'rejected' end, approved_by = s.staff_id, approved_at = now(), decision_note = p_note where id = e.id;
  if p_approve then perform public._expense_pay(e, s.staff_id); end if;
  perform public._audit(s, case when p_approve then 'اعتماد مصروف' else 'رفض مصروف' end, e.no, null, e.amount::text, p_note, e.location_id);
end $$;

create or replace function public.expense_void(p_token text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; e public.expenses; cm public.cash_moves;
begin
  s := public._session(p_token);
  if not (public._can(s.role_id,'expense','d') or public._can(s.role_id,'expense','p')) then raise exception 'NOT_ALLOWED:expense:d'; end if;
  if coalesce(length(trim(p_reason)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into e from public.expenses where id = p_id for update;
  if e.id is null then raise exception 'NOT_FOUND'; end if;
  if e.status not in ('approved','pending') then raise exception 'BAD_STATUS'; end if;
  if e.location_id is not null and not public._loc_ok(s, e.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  if e.status = 'approved' then
    if public._gl_locked((now() at time zone 'Africa/Cairo')::date) then raise exception 'PERIOD_CLOSED'; end if;
    if e.location_id is not null and public._day_closed(e.location_id, e.exp_date) and not (public._has(s.role_id,'editAfterClose') or s.role_id = 'owner') then raise exception 'DAY_CLOSED'; end if;
    select * into cm from public.cash_moves where ref_type = 'expense' and ref_id = e.no and amount < 0 order by id limit 1;
    insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, note, staff_id, gl_account)
    values (cm.account_id, e.amount, 'expense', cm.method,
            (select id from public.shifts where drawer_id = cm.account_id and status = 'open'), 'expense', e.no, 'إلغاء مصروف ' || e.no, s.staff_id, cm.gl_account);
  end if;
  update public.expenses set status = 'void', void_reason = trim(p_reason), void_by = s.staff_id where id = e.id;
  perform public._audit(s,'إلغاء مصروف',e.no,e.amount::text,null,p_reason,e.location_id);
end $$;

create or replace function public.expense_category_save(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid int; acc text := coalesce(nullif(p->>'account',''),'5207');
begin
  s := public._session(p_token);
  if not (public._can(s.role_id,'expense','e') or s.role_id in ('owner','gm','acct')) then raise exception 'NOT_ALLOWED:expense:e'; end if;
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if not exists (select 1 from public.gl_accounts where code = acc and kind = 'X') or exists (select 1 from public.gl_accounts where parent = acc) then raise exception 'NOT_LEAF_ACCOUNT'; end if;
  if (p->>'id') is null then
    insert into public.expense_categories (name, grp, account, budget, sort) values (trim(p->>'name'), coalesce(nullif(p->>'grp',''),'تشغيلية'), acc,
      coalesce(nullif(p->>'budget','')::numeric,0), coalesce((select max(sort) from public.expense_categories),0) + 1) returning id into nid;
  else
    update public.expense_categories set name = trim(p->>'name'), grp = coalesce(nullif(p->>'grp',''), grp), account = acc,
      budget = coalesce(nullif(p->>'budget','')::numeric, budget), active = coalesce((p->>'active')::boolean, active) where id = (p->>'id')::int returning id into nid;
  end if;
  perform public._audit(s,'بند مصروفات',trim(p->>'name'),null,p->>'budget',null,null);
  return nid;
end $$;
revoke execute on function public._day_closed(smallint,date), public._bday_of(timestamptz), public._expense_pay(public.expenses,uuid),
  public.expense_save(text,jsonb), public.expense_decide(text,uuid,boolean,text), public.expense_void(text,uuid,text), public.expense_category_save(text,jsonb)
  from public, anon, authenticated;
