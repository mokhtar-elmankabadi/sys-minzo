-- 0017 · Staff payroll & attendance (advances, monthly payroll run posted to the ledger) and paying with loyalty points at the POS
-- ==========================================================================================================================

update public.roles set perms = '{"staff":"vaedpx"}'::jsonb || perms where id = 'acct';
update public.roles set perms = '{"staff":"v"}'::jsonb || perms where id in ('mgr','asstmgr','asstacct');

-- =====================================================================
-- PAY SETTINGS, ATTENDANCE, ADVANCES
-- =====================================================================
create table public.staff_pay (
  staff_id uuid primary key references public.staff(id) on delete cascade,
  base_salary numeric(14,2) not null default 0,
  allowances numeric(14,2) not null default 0,
  shift_start time not null default '10:00',
  day_hours numeric(4,1) not null default 8,
  grace_min int not null default 15,
  work_days int[] not null default '{6,0,1,2,3,4}',   -- 0 = Sunday … 6 = Saturday (Friday off by default)
  deduct_late boolean not null default true,
  deduct_absence boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.attendance (
  id bigserial primary key,
  staff_id uuid not null references public.staff(id) on delete cascade,
  day date not null,
  check_in timestamptz,
  check_out timestamptz,
  location_id smallint references public.locations(id),
  source text not null default 'pin' check (source in ('pin','manual')),
  status text not null default 'present' check (status in ('present','leave','sick','absent','off')),
  note text,
  edited_by uuid references public.staff(id),
  unique (staff_id, day)
);
create table public.advances (
  id serial primary key,
  no text not null unique,
  staff_id uuid not null references public.staff(id),
  amount numeric(14,2) not null check (amount > 0),
  adv_date date not null,
  account_id int not null references public.cash_accounts(id),
  note text,
  status text not null default 'open' check (status in ('open','deducted','void')),
  payroll_month text,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create sequence public.adv_no_seq start 1;
create table public.payroll_runs (
  month text primary key,                          -- YYYY-MM
  status text not null default 'draft' check (status in ('draft','approved','paid')),
  approved_by uuid references public.staff(id), approved_at timestamptz,
  paid_by uuid references public.staff(id), paid_at timestamptz, paid_from int references public.cash_accounts(id)
);
create table public.payroll_lines (
  month text not null references public.payroll_runs(month) on delete cascade,
  staff_id uuid not null references public.staff(id),
  base numeric(14,2) not null default 0, allowances numeric(14,2) not null default 0, commission numeric(14,2) not null default 0, bonus numeric(14,2) not null default 0,
  work_days int not null default 0, present_days int not null default 0, absent_days int not null default 0, late_min int not null default 0,
  late_deduct numeric(14,2) not null default 0, absent_deduct numeric(14,2) not null default 0, other_deduct numeric(14,2) not null default 0, advances numeric(14,2) not null default 0,
  net numeric(14,2) not null default 0, note text,
  primary key (month, staff_id)
);
do $$ declare t text; begin foreach t in array array['staff_pay','attendance','advances','payroll_runs','payroll_lines'] loop
  execute format('alter table public.%I enable row level security', t);
end loop; end $$;
-- attendance is visible to every device (the punch screen); salaries are read through functions only
create policy "devices read" on public.attendance for select to authenticated using (public.is_device());
create policy "devices read" on public.payroll_runs for select to authenticated using (public.is_device());

create or replace function public._staff_right(s public.sess, p_act text) returns void language plpgsql stable security definer set search_path = public as $$
begin if not (s.role_id in ('owner','gm') or public._can(s.role_id,'staff',p_act)) then raise exception 'NOT_ALLOWED:staff:%', p_act; end if; end $$;
create or replace function public._see_salary(s public.sess) returns boolean language sql stable security definer set search_path = public as $$
  select s.role_id in ('owner','gm') or not coalesce((select hide_salary from public.roles where id = s.role_id), true);
$$;

-- check in / check out with your own PIN session on this device
create or replace function public.attend_punch(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; a public.attendance; d date := (now() at time zone 'Africa/Cairo')::date;
begin
  s := public._session(p_token);
  select * into a from public.attendance where staff_id = s.staff_id and day = d for update;
  if a.id is null then
    insert into public.attendance (staff_id, day, check_in, location_id) values (s.staff_id, d, now(), s.device_location) returning * into a;
    return jsonb_build_object('state','in','at',a.check_in);
  elsif a.check_out is null then
    update public.attendance set check_out = now() where id = a.id returning * into a;
    return jsonb_build_object('state','out','at',a.check_out,'since',a.check_in);
  end if;
  raise exception 'ALREADY_OUT';
end $$;

create or replace function public.attend_today(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  return (select to_jsonb(a) from public.attendance a where staff_id = s.staff_id and day = (now() at time zone 'Africa/Cairo')::date);
end $$;

create or replace function public.attend_edit(p_token text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; d date := (p->>'day')::date; st uuid := (p->>'staff_id')::uuid; b public.attendance; loc smallint;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm','mgr','asstmgr') or public._can(s.role_id,'staff','e')) then raise exception 'NOT_ALLOWED:staff:e'; end if;
  select location_id into loc from public.staff where id = st;
  if loc is not null and not public._loc_ok(s, loc) then raise exception 'OUT_OF_SCOPE'; end if;
  if coalesce(length(trim(p->>'note')),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if exists (select 1 from public.payroll_runs where month = to_char(d,'YYYY-MM') and status <> 'draft') then raise exception 'PAYROLL_CLOSED'; end if;
  select * into b from public.attendance where staff_id = st and day = d;
  insert into public.attendance (staff_id, day, check_in, check_out, location_id, source, status, note, edited_by)
  values (st, d, case when nullif(p->>'in','') is null then null else (d + (p->>'in')::time) at time zone 'Africa/Cairo' end,
          case when nullif(p->>'out','') is null then null else (d + (p->>'out')::time) at time zone 'Africa/Cairo' end, loc, 'manual', coalesce(p->>'status','present'), trim(p->>'note'), s.staff_id)
  on conflict (staff_id, day) do update set check_in = excluded.check_in, check_out = excluded.check_out, source = 'manual', status = excluded.status, note = excluded.note, edited_by = excluded.edited_by;
  perform public._audit(s,'تعديل حضور',(select name from public.staff where id = st) || ' · ' || d,
    case when b.id is null then null else coalesce(to_char(b.check_in at time zone 'Africa/Cairo','HH24:MI'),'—') || '–' || coalesce(to_char(b.check_out at time zone 'Africa/Cairo','HH24:MI'),'—') || ' ' || b.status end,
    coalesce(p->>'in','—') || '–' || coalesce(p->>'out','—') || ' ' || coalesce(p->>'status','present'), p->>'note', loc);
end $$;

create or replace function public.staff_pay_save(p_token text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; b public.staff_pay;
begin
  s := public._session(p_token); perform public._staff_right(s,'e');
  if not public._see_salary(s) then raise exception 'NOT_ALLOWED:salary'; end if;
  select * into b from public.staff_pay where staff_id = (p->>'staff_id')::uuid;
  insert into public.staff_pay (staff_id, base_salary, allowances, shift_start, day_hours, grace_min, work_days, deduct_late, deduct_absence)
  values ((p->>'staff_id')::uuid, coalesce((p->>'base_salary')::numeric,0), coalesce((p->>'allowances')::numeric,0), coalesce(nullif(p->>'shift_start','')::time,'10:00'),
          coalesce((p->>'day_hours')::numeric,8), coalesce((p->>'grace_min')::int,15), case when jsonb_array_length(coalesce(p->'work_days','[]'::jsonb)) > 0 then array(select jsonb_array_elements_text(p->'work_days')::int) else '{6,0,1,2,3,4}'::int[] end,
          coalesce((p->>'deduct_late')::boolean,true), coalesce((p->>'deduct_absence')::boolean,true))
  on conflict (staff_id) do update set base_salary = excluded.base_salary, allowances = excluded.allowances, shift_start = excluded.shift_start, day_hours = excluded.day_hours,
    grace_min = excluded.grace_min, work_days = excluded.work_days, deduct_late = excluded.deduct_late, deduct_absence = excluded.deduct_absence, updated_at = now();
  perform public._audit(s,'بيانات راتب',(select name from public.staff where id = (p->>'staff_id')::uuid),b.base_salary::text,p->>'base_salary',null,null);
end $$;

create or replace function public.advance_save(p_token text, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare s public.sess; a public.advances; acc public.cash_accounts; sh uuid;
begin
  s := public._session(p_token); perform public._staff_right(s,'a');
  if coalesce((p->>'amount')::numeric,0) <= 0 then raise exception 'BAD_AMOUNT'; end if;
  select * into acc from public.cash_accounts where id = (p->>'account_id')::int and active;
  if acc.id is null then raise exception 'NOT_FOUND'; end if;
  if acc.kind = 'drawer' then select id into sh from public.shifts where drawer_id = acc.id and status = 'open'; if sh is null then raise exception 'NO_OPEN_SHIFT'; end if; end if;
  insert into public.advances (no, staff_id, amount, adv_date, account_id, note, created_by)
  values ('ADV-' || lpad(nextval('public.adv_no_seq')::text,4,'0'), (p->>'staff_id')::uuid, (p->>'amount')::numeric, (now() at time zone 'Africa/Cairo')::date, acc.id, nullif(trim(p->>'note'),''), s.staff_id)
  returning * into a;
  insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, note, staff_id, gl_account)
  values (acc.id, -a.amount, 'adjust', case when acc.kind in ('drawer','treasury') then 'cash' else 'bank' end, sh, 'advance', a.no, 'سلفة ' || (select name from public.staff where id = a.staff_id), s.staff_id, '1105');
  perform public._audit(s,'سلفة',a.no,null,a.amount::text,a.note,null);
  return a.no;
end $$;

-- =====================================================================
-- PAYROLL RUN
-- deductions: late minutes beyond the grace, at the minute rate of (base ÷ working days ÷ hours ÷ 60);
--             absent working days (no punch and not marked leave / sick / off), at (base ÷ working days)
-- =====================================================================
create or replace function public.payroll_calc(p_token text, p_month text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; d1 date := (p_month || '-01')::date; d2 date := ((p_month || '-01')::date + interval '1 month - 1 day')::date; r record; com jsonb;
        wd int; pres int; absn int; late int; dayr numeric; minr numeric; adv numeric; keep public.payroll_lines; lastd date;
begin
  s := public._session(p_token); perform public._staff_right(s,'e');
  if not public._see_salary(s) then raise exception 'NOT_ALLOWED:salary'; end if;
  insert into public.payroll_runs (month) values (p_month) on conflict do nothing;
  if (select status from public.payroll_runs where month = p_month) <> 'draft' then raise exception 'PAYROLL_CLOSED'; end if;
  begin com := public.commission_report(p_token, p_month); exception when others then com := '[]'; end;
  lastd := least(d2, (now() at time zone 'Africa/Cairo')::date);
  for r in select st.id, st.name, coalesce(sp.base_salary,0) base, coalesce(sp.allowances,0) allow, coalesce(sp.shift_start,'10:00') ss, coalesce(sp.grace_min,15) grace,
                  coalesce(sp.day_hours,8) hrs, coalesce(sp.work_days,'{6,0,1,2,3,4}') wdays, coalesce(sp.deduct_late,true) dl, coalesce(sp.deduct_absence,true) da, st.created_at
             from public.staff st left join public.staff_pay sp on sp.staff_id = st.id
            where st.active and (sp.base_salary > 0 or exists (select 1 from jsonb_array_elements(com) c where (c->>'staff_id')::uuid = st.id)) loop
    select count(*) into wd from generate_series(d1, d2, interval '1 day') g where extract(dow from g)::int = any(r.wdays);
    select count(*) into pres from public.attendance a where a.staff_id = r.id and a.day between d1 and d2 and a.check_in is not null;
    select count(*) into absn from generate_series(greatest(d1, (r.created_at at time zone 'Africa/Cairo')::date), lastd, interval '1 day') g
      where extract(dow from g)::int = any(r.wdays)
        and not exists (select 1 from public.attendance a where a.staff_id = r.id and a.day = g::date and (a.check_in is not null or a.status in ('leave','sick','off')));
    select coalesce(sum(greatest(0, extract(epoch from ((a.check_in at time zone 'Africa/Cairo')::time - r.ss)) / 60 - r.grace)),0)::int into late
      from public.attendance a where a.staff_id = r.id and a.day between d1 and d2 and a.check_in is not null;
    dayr := case when wd > 0 then r.base / wd else 0 end; minr := case when r.hrs > 0 then dayr / r.hrs / 60 else 0 end;
    select coalesce(sum(amount),0) into adv from public.advances where staff_id = r.id and status = 'open' and adv_date <= d2;
    select * into keep from public.payroll_lines where month = p_month and staff_id = r.id;
    insert into public.payroll_lines (month, staff_id, base, allowances, commission, bonus, work_days, present_days, absent_days, late_min, late_deduct, absent_deduct, other_deduct, advances, net, note)
    values (p_month, r.id, r.base, r.allow, coalesce((select (c->>'total')::numeric from jsonb_array_elements(com) c where (c->>'staff_id')::uuid = r.id),0), coalesce(keep.bonus,0),
            wd, pres, absn, late, case when r.dl then round(late * minr, 2) else 0 end, case when r.da then round(absn * dayr, 2) else 0 end, coalesce(keep.other_deduct,0), adv, 0, keep.note)
    on conflict (month, staff_id) do update set base = excluded.base, allowances = excluded.allowances, commission = excluded.commission, work_days = excluded.work_days,
      present_days = excluded.present_days, absent_days = excluded.absent_days, late_min = excluded.late_min, late_deduct = excluded.late_deduct, absent_deduct = excluded.absent_deduct, advances = excluded.advances;
  end loop;
  update public.payroll_lines set net = base + allowances + commission + bonus - late_deduct - absent_deduct - other_deduct - advances where month = p_month;
end $$;

create or replace function public.payroll_line_set(p_token text, p_month text, p_staff uuid, p_bonus numeric, p_other numeric, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; b public.payroll_lines;
begin
  s := public._session(p_token); perform public._staff_right(s,'e');
  if not public._see_salary(s) then raise exception 'NOT_ALLOWED:salary'; end if;
  if (select status from public.payroll_runs where month = p_month) <> 'draft' then raise exception 'PAYROLL_CLOSED'; end if;
  select * into b from public.payroll_lines where month = p_month and staff_id = p_staff for update;
  if b.staff_id is null then raise exception 'NOT_FOUND'; end if;
  if (coalesce(p_bonus,0) <> b.bonus or coalesce(p_other,0) <> b.other_deduct) and coalesce(length(trim(p_note)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.payroll_lines set bonus = coalesce(p_bonus,0), other_deduct = coalesce(p_other,0), note = nullif(trim(p_note),''),
    net = base + allowances + commission + coalesce(p_bonus,0) - late_deduct - absent_deduct - coalesce(p_other,0) - advances where month = p_month and staff_id = p_staff;
  perform public._audit(s,'تعديل سطر مرتب',(select name from public.staff where id = p_staff) || ' · ' || p_month,b.bonus || ' / ' || b.other_deduct,coalesce(p_bonus,0) || ' / ' || coalesce(p_other,0),p_note,null);
end $$;

create or replace function public.payroll_list(p_token text, p_month text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._staff_right(s,'v');
  return jsonb_build_object('run', (select to_jsonb(r) from public.payroll_runs r where month = p_month),
    'lines', case when public._see_salary(s) then coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('name', st.name, 'role', st.role_id, 'loc', st.location_id) order by st.name)
               from public.payroll_lines l join public.staff st on st.id = l.staff_id where l.month = p_month and (public._loc_ok(s, st.location_id) or st.location_id is null)), '[]'::jsonb) end,
    'pay', case when public._see_salary(s) then coalesce((select jsonb_agg(to_jsonb(p)) from public.staff_pay p), '[]'::jsonb) end,
    'advances', case when public._see_salary(s) then coalesce((select jsonb_agg(to_jsonb(a) order by a.adv_date desc) from public.advances a where a.status = 'open' or a.payroll_month = p_month), '[]'::jsonb) end,
    'see_salary', public._see_salary(s));
end $$;

create or replace function public.payroll_approve(p_token text, p_month text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; d2 date := ((p_month || '-01')::date + interval '1 month - 1 day')::date; eid uuid; v_gross numeric; v_ded numeric; v_adv numeric; v_net numeric;
begin
  s := public._session(p_token); perform public._staff_right(s,'p');
  if (select status from public.payroll_runs where month = p_month) is distinct from 'draft' then raise exception 'BAD_STATUS'; end if;
  if public._gl_locked(d2) then raise exception 'PERIOD_CLOSED'; end if;
  select coalesce(sum(base + allowances + commission + bonus),0), coalesce(sum(late_deduct + absent_deduct + other_deduct),0), coalesce(sum(advances),0), coalesce(sum(net),0)
    into v_gross, v_ded, v_adv, v_net from public.payroll_lines where month = p_month;
  if v_gross = 0 then raise exception 'EMPTY_PAYROLL'; end if;
  if exists (select 1 from public.payroll_lines where month = p_month and net < 0) then raise exception 'NEGATIVE_NET'; end if;
  insert into public.gl_manual (no, entry_date, memo, kind, status, created_by, approved_by) values ('PR-' || p_month, d2, 'مرتبات شهر ' || p_month, 'manual', 'approved', s.staff_id, s.staff_id) returning id into eid;
  insert into public.gl_manual_lines (entry_id, account, dr, cr) values (eid, '5201', v_gross - v_ded, 0);
  if v_adv > 0 then insert into public.gl_manual_lines (entry_id, account, dr, cr) values (eid, '1105', 0, v_adv); end if;
  if v_net > 0 then insert into public.gl_manual_lines (entry_id, account, dr, cr) values (eid, '2102', 0, v_net); end if;
  update public.advances set status = 'deducted', payroll_month = p_month where status = 'open' and adv_date <= d2 and staff_id in (select staff_id from public.payroll_lines where month = p_month and advances > 0);
  update public.payroll_runs set status = 'approved', approved_by = s.staff_id, approved_at = now() where month = p_month;
  perform public._audit(s,'اعتماد مرتبات',p_month,null,v_net::text,null,null);
end $$;

create or replace function public.payroll_pay(p_token text, p_month text, p_account int) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; acc public.cash_accounts; v_net numeric;
begin
  s := public._session(p_token); perform public._staff_right(s,'p');
  if (select status from public.payroll_runs where month = p_month) is distinct from 'approved' then raise exception 'BAD_STATUS'; end if;
  select * into acc from public.cash_accounts where id = p_account and active and kind <> 'drawer';
  if acc.id is null then raise exception 'TREASURY_OR_BANK'; end if;
  select coalesce(sum(net),0) into v_net from public.payroll_lines where month = p_month;
  if v_net > 0 then
    insert into public.cash_moves (account_id, amount, kind, method, ref_type, ref_id, note, staff_id, gl_account)
    values (acc.id, -v_net, 'adjust', case when acc.kind = 'treasury' then 'cash' else 'bank' end, 'payroll', 'PR-' || p_month, 'صرف مرتبات ' || p_month, s.staff_id, '2102');
  end if;
  update public.payroll_runs set status = 'paid', paid_by = s.staff_id, paid_at = now(), paid_from = acc.id where month = p_month;
  perform public._audit(s,'صرف مرتبات',p_month,null,v_net::text,null,null);
end $$;

-- =====================================================================
-- LOYALTY POINTS AS A PAYMENT METHOD
-- =====================================================================
alter table public.sale_payments drop constraint if exists sale_payments_method_check;
alter table public.sale_payments add constraint sale_payments_method_check check (method in ('cash','card','insta','wallet','inst','points'));

create or replace function public.customer_points(p_token text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; c public.customers;
begin
  s := public._session(p_token);
  select * into c from public.customers where phone = regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g');
  if c.id is null then return null; end if;
  return jsonb_build_object('name', c.name, 'points', public._cust_points(c.id), 'value', (select loyalty_value from public.store), 'on', (select loyalty_on from public.store));
end $$;

-- a points payment redeems ceil(amount ÷ point value) points from the invoice's customer; a void gives them back
create or replace function public._points_pay() returns trigger language plpgsql security definer set search_path = public as $$
declare sa public.sales; st public.store; need int; bal int;
begin
  if new.method <> 'points' then return new; end if;
  select * into sa from public.sales where id = new.sale_id; select * into st from public.store;
  if not st.loyalty_on or st.loyalty_value <= 0 then raise exception 'LOYALTY_OFF'; end if;
  if sa.customer_id is null then raise exception 'CUSTOMER_REQUIRED'; end if;
  need := ceil(new.amount / st.loyalty_value)::int;
  bal := public._cust_points(sa.customer_id) - floor(greatest(sa.total,0) / nullif(st.loyalty_per,0))::int;   -- points from this very invoice don't count yet
  if need > bal then raise exception 'MORE_THAN_POINTS'; end if;
  insert into public.loyalty_moves (customer_id, points, kind, note, staff_id) values (sa.customer_id, -need, 'redeem', 'دفع بالنقاط · ' || sa.no, sa.cashier_id);
  return new;
end $$;
create trigger sale_payments_points before insert on public.sale_payments for each row execute function public._points_pay();

create or replace function public._points_void() returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.status = 'void' and old.status <> 'void' then
    select -coalesce(sum(points),0) into n from public.loyalty_moves where kind = 'redeem' and note = 'دفع بالنقاط · ' || new.no;
    if n > 0 then insert into public.loyalty_moves (customer_id, points, kind, note, staff_id) values (new.customer_id, n, 'adjust', 'رجوع نقاط فاتورة ملغاة · ' || new.no, new.void_by); end if;
  end if;
  return new;
end $$;
create trigger sales_points_void after update of status on public.sales for each row execute function public._points_void();

create or replace function public.sale_post(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; sh public.shifts; st public.store; it public.items; ln jsonb; pay jsonb; ex public.sales; pl public.finance_plans; co public.finance_companies;
        bd date; sid uuid; no text; gross numeric := 0; disc numeric := 0; vat numeric := 0; total numeric; v_cost numeric := 0; lc numeric; lv numeric; comm numeric := 0; c1 numeric;
        dp numeric := coalesce((p->>'discount_pct')::numeric,0); maxd numeric; appr public.staff; paid numeric := 0; cust uuid; need_cust boolean := false;
        r numeric; share numeric; lines_tmp jsonb := '[]'; w numeric; ofr jsonb; od numeric; ld numeric; odt numeric := 0; i int; n int;
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
    if (pay->>'method') not in ('cash','card','insta','wallet','inst','points') then raise exception 'BAD_PAYMENT_METHOD'; end if;
    if (pay->>'method') = 'points' and (pay->>'amount')::numeric > 0 then need_cust := true; end if;
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
  insert into public.sales (no, location_id, shift_id, device_id, cashier_id, seller_id, customer_id, business_day, gross, discount, vat, total, client_uuid, offer_disc)
  values (no, sh.location_id, sh.id, s.device_id, s.staff_id, nullif(p->>'seller_id','')::uuid, cust, bd, gross, disc, vat, total, nullif(p->>'client_uuid','')::uuid, odt)
  returning id into sid;
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
    from (select pay2->>'method' method, sum((pay2->>'amount')::numeric) amount from jsonb_array_elements(p->'payments') pay2 group by 1) x where x.amount <> 0 and x.method not in ('inst','points');
  if (p->>'held_id') is not null then update public.held_sales set status = 'taken', taken_by = s.staff_id where id = (p->>'held_id')::uuid and status in ('open','taken'); end if;
  if appr.id is not null then perform public._audit(s,'اعتماد خصم يدوي فوق الحد',no,maxd::text||'%',dp::text||'% · '||appr.name,null,sh.location_id); end if;
  perform public._audit(s,'فاتورة بيع',no,null,total::text,null,sh.location_id);
  return jsonb_build_object('id', sid, 'no', no, 'gross', gross, 'discount', disc, 'offer_disc', odt, 'vat', vat, 'total', total, 'change', paid - total, 'business_day', bd, 'commission', comm);
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
      select '5205', p.amount, 0 from public.sale_payments p where p.sale_id = s.id and p.method = 'points' union all
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
revoke execute on function public._staff_right(public.sess,text), public._see_salary(public.sess), public._points_pay(), public._points_void(), public._gl_rows(date,date) from public, anon, authenticated;
revoke execute on function public.attend_punch(text), public.attend_today(text), public.attend_edit(text,jsonb), public.staff_pay_save(text,jsonb), public.advance_save(text,jsonb),
  public.payroll_calc(text,text), public.payroll_line_set(text,text,uuid,numeric,numeric,text), public.payroll_list(text,text), public.payroll_approve(text,text), public.payroll_pay(text,text,int),
  public.customer_points(text,text) from public, anon;
grant execute on function public.attend_punch(text), public.attend_today(text), public.attend_edit(text,jsonb), public.staff_pay_save(text,jsonb), public.advance_save(text,jsonb),
  public.payroll_calc(text,text), public.payroll_line_set(text,text,uuid,numeric,numeric,text), public.payroll_list(text,text), public.payroll_approve(text,text), public.payroll_pay(text,text,int),
  public.customer_points(text,text) to authenticated;
