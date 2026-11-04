-- 0015 · Control: audit verification, roles & permissions, backups & restore, system reset, item availability, export log
-- ==================================================================================================================

-- ---------- sensitive permissions the prototype had ----------
update public.roles set sens = sens || '["itemSched"]'::jsonb where id in ('gm','promo') and not sens ? 'itemSched';
update public.roles set sens = sens || '["itemAvail"]'::jsonb where id = 'mgr' and not sens ? 'itemAvail';
update public.roles set sens = sens || '["exportSensitive"]'::jsonb where id in ('gm','acct') and not sens ? 'exportSensitive';
update public.roles set sens = sens || '["backup"]'::jsonb where id = 'gm' and not sens ? 'backup';
update public.roles set perms = '{"avail":"vaed"}'::jsonb || perms where id in ('mgr','promo');

-- the audit chain hashes the timestamp as text: pin it to UTC so the hash never depends on the session's time zone
alter function public.audit_chain() set timezone = 'UTC';

-- PIN check for the person at the device (used before sensitive actions)
create or replace function public._pin_ok(s public.sess, p_pin text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.staff where id = s.staff_id and pin_hash is not null and pin_hash = crypt(coalesce(p_pin,''), pin_hash));
$$;
create or replace function public._owner_pin_ok(p_pin text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.staff where role_id = 'owner' and active and pin_hash is not null and pin_hash = crypt(coalesce(p_pin,''), pin_hash));
$$;

-- =====================================================================
-- AUDIT LOG: verify the hash chain
-- =====================================================================
create or replace function public.audit_verify(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions set timezone = 'UTC' as $$
declare s public.sess; r record; prev text := 'genesis'; cnt int := 0;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'audit','v')) then raise exception 'NOT_ALLOWED:audit:v'; end if;
  for r in select * from public.audit_log order by n loop
    cnt := cnt + 1;
    if r.prev_hash is distinct from prev or r.hash is distinct from encode(digest(r.prev_hash || coalesce(r.action,'') || coalesce(r.entity,'') || coalesce(r.before,'') || coalesce(r.after,'')
         || coalesce(r.reason,'') || r.at::text || coalesce(r.staff_id::text,''), 'sha256'), 'hex') then
      return jsonb_build_object('ok', false, 'at', r.n, 'checked', cnt);
    end if;
    prev := r.hash;
  end loop;
  return jsonb_build_object('ok', true, 'checked', cnt, 'last', prev);
end $$;

-- =====================================================================
-- ROLES & PERMISSIONS
-- =====================================================================
create or replace function public.role_save(p_token text, p jsonb, p_owner_pin text) returns text
language plpgsql security definer set search_path = public as $$
declare s public.sess; me public.roles; b public.roles; rid text; k text; v text; c text; mine text; sens_new jsonb := coalesce(p->'sens','[]'::jsonb); perms_new jsonb := '{}'::jsonb;
begin
  s := public._session(p_token);
  if not (s.role_id = 'owner' or public._has(s.role_id,'users')) then raise exception 'NOT_ALLOWED:users'; end if;
  if s.role_id <> 'owner' and not public._owner_pin_ok(p_owner_pin) then raise exception 'NEEDS_OWNER'; end if;
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  select * into me from public.roles where id = s.role_id;
  rid := nullif(p->>'id','');
  if rid = 'owner' then raise exception 'ONLY_OWNER_EDITS_OWNER'; end if;
  -- keep only real letters, and never more than the editor has
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p->'perms','{}'::jsonb)) loop
    c := '';
    mine := coalesce(me.perms->>k, me.perms->>'*', '');
    foreach v in array regexp_split_to_array(coalesce(v,''), '') loop
      if v <> '' and position(v in 'vaedpxri') > 0 and position(v in c) = 0 then
        if position(v in mine) = 0 then raise exception 'ESCALATION'; end if;
        c := c || v;
      end if;
    end loop;
    if c <> '' then perms_new := perms_new || jsonb_build_object(k, c); end if;
  end loop;
  if s.role_id <> 'owner' then
    if exists (select 1 from jsonb_array_elements_text(sens_new) x where not public._has(s.role_id, x)) then raise exception 'ESCALATION'; end if;
    if coalesce((p->>'scope_all_locations')::boolean,false) and not me.scope_all_locations then raise exception 'ESCALATION'; end if;
    if coalesce((p->>'max_discount_pct')::numeric,0) > me.max_discount_pct then raise exception 'ESCALATION'; end if;
    if me.max_amount > 0 and (coalesce((p->>'max_amount')::numeric,0) = 0 or (p->>'max_amount')::numeric > me.max_amount) then raise exception 'ESCALATION'; end if;
    if not coalesce((p->>'hide_cost')::boolean,true) and me.hide_cost then raise exception 'ESCALATION'; end if;
  end if;
  if rid is null then
    rid := 'r_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    insert into public.roles (id, name, perms, sens, scope_all_locations, scope_days, max_discount_pct, max_amount, hide_cost, hide_margin, hide_salary, is_base)
    values (rid, trim(p->>'name'), perms_new, sens_new, coalesce((p->>'scope_all_locations')::boolean,false), coalesce((p->>'scope_days')::int,0),
            coalesce((p->>'max_discount_pct')::numeric,0), coalesce((p->>'max_amount')::numeric,0), coalesce((p->>'hide_cost')::boolean,true),
            coalesce((p->>'hide_margin')::boolean,true), coalesce((p->>'hide_salary')::boolean,true), false);
    perform public._audit(s,'إضافة دور',trim(p->>'name'),null,perms_new::text,p->>'reason',null);
  else
    select * into b from public.roles where id = rid for update;
    if b.id is null then raise exception 'NOT_FOUND'; end if;
    update public.roles set name = trim(p->>'name'), perms = perms_new, sens = sens_new, scope_all_locations = coalesce((p->>'scope_all_locations')::boolean, scope_all_locations),
      scope_days = coalesce((p->>'scope_days')::int, scope_days), max_discount_pct = coalesce((p->>'max_discount_pct')::numeric, max_discount_pct),
      max_amount = coalesce((p->>'max_amount')::numeric, max_amount), hide_cost = coalesce((p->>'hide_cost')::boolean, hide_cost),
      hide_margin = coalesce((p->>'hide_margin')::boolean, hide_margin), hide_salary = coalesce((p->>'hide_salary')::boolean, hide_salary) where id = rid;
    perform public._audit(s,'تعديل صلاحيات دور',b.name,jsonb_build_object('perms',b.perms,'sens',b.sens)::text,jsonb_build_object('perms',perms_new,'sens',sens_new)::text,p->>'reason',null);
  end if;
  return rid;
end $$;

create or replace function public.role_delete(p_token text, p_id text, p_owner_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; b public.roles;
begin
  s := public._session(p_token);
  if not (s.role_id = 'owner' or public._has(s.role_id,'users')) then raise exception 'NOT_ALLOWED:users'; end if;
  if s.role_id <> 'owner' and not public._owner_pin_ok(p_owner_pin) then raise exception 'NEEDS_OWNER'; end if;
  select * into b from public.roles where id = p_id;
  if b.id is null then raise exception 'NOT_FOUND'; end if;
  if b.is_base then raise exception 'BASE_ROLE'; end if;
  if exists (select 1 from public.staff where role_id = p_id) then raise exception 'ROLE_IN_USE'; end if;
  delete from public.roles where id = p_id;
  perform public._audit(s,'حذف دور',b.name,b.perms::text,null,null,null);
end $$;

create or replace function public.pin_check(p_token text, p_pin text) returns boolean
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin s := public._session(p_token); return public._pin_ok(s, p_pin); end $$;

-- =====================================================================
-- BACKUPS & RESTORE
-- =====================================================================
create table public.backups (
  id bigserial primary key,
  kind text not null check (kind in ('hourly','daily','manual','before')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  tables int not null default 0,
  rows int not null default 0,
  bytes int not null default 0,
  data jsonb not null
);
alter table public.backups enable row level security;   -- no read policy: only through the functions below

create or replace function public._backup_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; j jsonb; tabs jsonb := '{}'::jsonb; sq jsonb;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename not in ('backups','staff_sessions') order by tablename loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into j;
    tabs := tabs || jsonb_build_object(t, j);
  end loop;
  select coalesce(jsonb_object_agg(sequencename, last_value), '{}'::jsonb) into sq from pg_sequences where schemaname = 'public';
  return jsonb_build_object('app','SYS Minzo','version',1,'at',now(),'store',(select name from public.store),'tables',tabs,'seqs',sq);
end $$;

create or replace function public._backup_take(p_kind text, p_note text, p_staff uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare d jsonb := public._backup_data(); nid bigint; n int;
begin
  select coalesce(sum(jsonb_array_length(value)),0) into n from jsonb_each(d->'tables');
  insert into public.backups (kind, note, created_by, tables, rows, bytes, data)
  values (p_kind, p_note, p_staff, (select count(*) from jsonb_object_keys(d->'tables')), n, octet_length(d::text), d) returning id into nid;
  -- keep 24 hourly, 30 daily, 20 manual / before-change snapshots
  delete from public.backups where kind = 'hourly' and id not in (select id from public.backups where kind = 'hourly' order by id desc limit 24);
  delete from public.backups where kind = 'daily' and id not in (select id from public.backups where kind = 'daily' order by id desc limit 30);
  delete from public.backups where kind in ('manual','before') and id not in (select id from public.backups where kind in ('manual','before') order by id desc limit 20);
  return nid;
end $$;

create or replace function public._backup_right(s public.sess) returns void language plpgsql stable security definer set search_path = public as $$
begin if not (s.role_id = 'owner' or public._has(s.role_id,'backup')) then raise exception 'NOT_ALLOWED:backup'; end if; end $$;

create or replace function public.backups_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._backup_right(s);
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'note',note,'at',created_at,'by',(select name from public.staff where id = b.created_by),'tables',tables,'rows',rows,'bytes',bytes) order by id desc) from public.backups b), '[]'::jsonb);
end $$;

create or replace function public.backup_now(p_token text, p_note text) returns bigint
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid bigint;
begin
  s := public._session(p_token); perform public._backup_right(s);
  nid := public._backup_take('manual', nullif(trim(p_note),''), s.staff_id);
  perform public._audit(s,'نسخة احتياطية',nid::text,null,null,p_note,null);
  return nid;
end $$;

create or replace function public.backup_get(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; d jsonb;
begin
  s := public._session(p_token); perform public._backup_right(s);
  select data into d from public.backups where id = p_id;
  if d is null then raise exception 'NOT_FOUND'; end if;
  perform public._audit(s,'تنزيل نسخة احتياطية',p_id::text,null,null,null,null);
  return d;
end $$;

-- tables a restore or a reset never touches: this device's registration, sessions, the audit trail and the backups themselves
create or replace function public.backup_restore(p_token text, p_data jsonb, p_pin text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; t text; cols text; n int := 0; tot int := 0; k text; v bigint; keep text[] := array['devices','staff_sessions','audit_log','backups'];
        restorable text[];
begin
  s := public._session(p_token);
  if s.role_id <> 'owner' then raise exception 'ONLY_OWNER'; end if;
  if not public._pin_ok(s, p_pin) then raise exception 'WRONG_PIN'; end if;
  if coalesce(trim(p_confirm),'') <> 'استعادة' then raise exception 'CONFIRM_REQUIRED'; end if;
  if p_data->>'app' is distinct from 'SYS Minzo' or jsonb_typeof(p_data->'tables') <> 'object' then raise exception 'BAD_BACKUP'; end if;
  perform public._backup_take('before', 'قبل الاستعادة', s.staff_id);
  select array_agg(tablename) into restorable from pg_tables where schemaname = 'public' and tablename <> all(keep) and p_data->'tables' ? tablename;
  set local session_replication_role = replica;
  -- delete (not truncate): with replica mode the foreign keys from the kept tables (devices, sessions) are not checked
  foreach t in array restorable loop execute format('delete from public.%I', t); end loop;
  foreach t in array restorable loop
    if jsonb_array_length(p_data->'tables'->t) = 0 then continue; end if;
    select string_agg(format('%I', a.attname), ', ') into cols from pg_attribute a
     where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped and (p_data->'tables'->t->0) ? a.attname;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)', t, cols, cols, t) using p_data->'tables'->t;
    get diagnostics n = row_count; tot := tot + n;
  end loop;
  for k, v in select key, (value #>> '{}')::bigint from jsonb_each(coalesce(p_data->'seqs','{}'::jsonb)) where jsonb_typeof(value) = 'number' and key not in ('audit_log_n_seq','backups_id_seq') loop
    if exists (select 1 from pg_sequences where schemaname = 'public' and sequencename = k) then perform setval(format('public.%I', k), v); end if;
  end loop;
  set local session_replication_role = origin;
  perform public._audit(s,'استعادة نسخة احتياطية',coalesce(p_data->>'at',''),null,tot::text || ' سطر',null,null);
  return jsonb_build_object('tables', array_length(restorable,1), 'rows', tot);
end $$;

-- =====================================================================
-- SYSTEM RESET
-- =====================================================================
create or replace function public.system_reset(p_token text, p_level text, p_pin text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; moves text[] := array['stock','stock_layers','stock_moves','serials','transfers','transfer_lines','shifts','cash_moves','sales','sale_lines','sale_payments',
          'held_sales','finance_receivables','returns','return_lines','purchase_invoices','purchase_lines','supplier_payments','service_tickets','gl_manual','gl_manual_lines',
          'gl_periods','gl_years','expenses','day_closings','loyalty_moves','deliveries','label_prints'];
        master text[] := array['items','item_groups','customers','suppliers','finance_companies','finance_plans','warranty_rules','offers','commission_rules','commission_tiers',
          'staff_targets','item_rules'];
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
  update public.cash_accounts set active = active;   -- balances come only from cash_moves, so they are back to zero
  for sq in select sequencename from pg_sequences where schemaname = 'public' and sequencename like '%\_no\_seq' loop
    execute format('alter sequence public.%I restart with 1', sq);
  end loop;
  if p_level = 'all' then alter sequence public.item_code_seq restart with 1; end if;
  perform public._audit(s, case when p_level = 'all' then 'تصفير كامل للنظام' else 'تصفير الحركات' end, 'نسخة قبلها #' || bid, null, array_length(lst,1)::text || ' جدول', null, null);
  return jsonb_build_object('tables', array_length(lst,1), 'backup', bid);
end $$;

-- =====================================================================
-- ITEM AVAILABILITY: visible / locked / hidden, per item, group or department, per location, with schedules
-- =====================================================================
create table public.item_rules (
  id serial primary key,
  scope text not null check (scope in ('item','group','dept')),
  ref text not null,                                   -- item uuid, group id or department id
  location_id smallint references public.locations(id),  -- null = every showroom
  state text not null check (state in ('locked','hidden','on')),
  date_from date, date_to date,
  days int[],                                          -- 0 = Sunday … 6 = Saturday; null = every day
  hour_from time, hour_to time,
  reason text,
  active boolean not null default true,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
alter table public.item_rules enable row level security;
create policy "devices read" on public.item_rules for select to authenticated using (public.is_device());

create or replace function public._rule_live(r public.item_rules, p_ts timestamptz) returns boolean
language sql immutable as $$
  select r.active
    and (r.date_from is null or (p_ts at time zone 'Africa/Cairo')::date >= r.date_from)
    and (r.date_to is null or (p_ts at time zone 'Africa/Cairo')::date <= r.date_to)
    and (r.days is null or extract(dow from (p_ts at time zone 'Africa/Cairo'))::int = any(r.days))
    and (r.hour_from is null or r.hour_to is null or
         case when r.hour_from <= r.hour_to then (p_ts at time zone 'Africa/Cairo')::time between r.hour_from and r.hour_to
              else (p_ts at time zone 'Africa/Cairo')::time >= r.hour_from or (p_ts at time zone 'Africa/Cairo')::time <= r.hour_to end);
$$;

-- the most specific live rule wins: item > group > department, and a rule for this location > a rule for all locations
create or replace function public._item_state(p_item uuid, p_loc smallint, p_ts timestamptz) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.state from public.item_rules r join public.items i on i.id = p_item
     where public._rule_live(r, p_ts) and (r.location_id is null or r.location_id = p_loc)
       and ((r.scope = 'item' and r.ref = i.id::text) or (r.scope = 'group' and r.ref = i.group_id::text) or (r.scope = 'dept' and r.ref = i.department_id::text))
     order by case r.scope when 'item' then 0 when 'group' then 1 else 2 end, (r.location_id is null), (r.date_from is null and r.days is null and r.hour_from is null), r.id desc
     limit 1), 'on');
$$;

create or replace function public._sale_line_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare sa public.sales; st text; nm text;
begin
  select * into sa from public.sales where id = new.sale_id;
  st := public._item_state(new.item_id, sa.location_id, now());
  if st <> 'on' and not exists (select 1 from public.staff stf where stf.id = sa.cashier_id and (stf.role_id = 'owner' or public._has(stf.role_id,'overrideLocked'))) then
    select name into nm from public.items where id = new.item_id;
    raise exception 'ITEM_LOCKED:%', nm;
  end if;
  return new;
end $$;
create trigger sale_lines_avail_guard before insert on public.sale_lines for each row execute function public._sale_line_guard();

create or replace function public.item_rule_save(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid int; sched boolean; loc smallint := nullif(p->>'location_id','')::smallint; nm text;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._has(s.role_id,'itemAvail')) then raise exception 'NOT_ALLOWED:itemAvail'; end if;
  sched := nullif(p->>'date_from','') is not null or nullif(p->>'date_to','') is not null or jsonb_array_length(coalesce(p->'days','[]'::jsonb)) > 0 or nullif(p->>'hour_from','') is not null;
  if sched and not (s.role_id in ('owner','gm') or public._has(s.role_id,'itemSched')) then raise exception 'NOT_ALLOWED:itemSched'; end if;
  if loc is not null and not public._loc_ok(s, loc) then raise exception 'OUT_OF_SCOPE'; end if;
  if loc is null and not (select scope_all_locations from public.roles where id = s.role_id) then raise exception 'OUT_OF_SCOPE'; end if;
  if (p->>'state') not in ('locked','hidden','on') or (p->>'scope') not in ('item','group','dept') then raise exception 'BAD_STATUS'; end if;
  if nullif(p->>'date_to','') is not null and nullif(p->>'date_from','') is not null and (p->>'date_to')::date < (p->>'date_from')::date then raise exception 'BAD_DATES'; end if;
  -- a permanent rule replaces the previous permanent rule on the same target
  if not sched then
    update public.item_rules set active = false where active and scope = p->>'scope' and ref = p->>'ref' and location_id is not distinct from loc
      and date_from is null and date_to is null and days is null and hour_from is null;
  end if;
  insert into public.item_rules (scope, ref, location_id, state, date_from, date_to, days, hour_from, hour_to, reason, created_by)
  values (p->>'scope', p->>'ref', loc, p->>'state', nullif(p->>'date_from','')::date, nullif(p->>'date_to','')::date,
          case when jsonb_array_length(coalesce(p->'days','[]'::jsonb)) > 0 then array(select jsonb_array_elements_text(p->'days')::int) end,
          nullif(p->>'hour_from','')::time, nullif(p->>'hour_to','')::time, nullif(trim(p->>'reason'),''), s.staff_id)
  returning id into nid;
  nm := case p->>'scope' when 'item' then (select name from public.items where id::text = p->>'ref') when 'group' then (select name from public.item_groups where id::text = p->>'ref')
        else (select name from public.departments where id::text = p->>'ref') end;
  perform public._audit(s, case when sched then 'جدولة ظهور صنف' else 'تغيير ظهور صنف' end, nm, null,
    (case p->>'state' when 'on' then 'ظاهر' when 'locked' then 'مقفول' else 'مخفي' end) || coalesce(' · ' || (select name from public.locations where id = loc), ' · كل المعارض'), p->>'reason', loc);
  return nid;
end $$;

create or replace function public.item_rule_end(p_token text, p_id int) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; r public.item_rules;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._has(s.role_id,'itemAvail')) then raise exception 'NOT_ALLOWED:itemAvail'; end if;
  update public.item_rules set active = false where id = p_id and active returning * into r;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  perform public._audit(s,'إنهاء قاعدة ظهور',r.scope || ' ' || r.ref,r.state,null,null,r.location_id);
end $$;

create or replace function public.items_stale(p_token text, p_days int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('item_id',st.item_id,'loc',st.location_id,'qty',st.qty,
      'last',(select max(m.created_at) from public.stock_moves m where m.item_id = st.item_id and m.location_id = st.location_id and m.kind = 'sale')))
    from public.stock st join public.locations l on l.id = st.location_id
   where l.kind = 'showroom' and st.qty > 0 and public._loc_ok(s, st.location_id)
     and not exists (select 1 from public.stock_moves m where m.item_id = st.item_id and m.location_id = st.location_id and m.kind = 'sale' and m.created_at > now() - make_interval(days => greatest(p_days,1)))), '[]'::jsonb);
end $$;

-- =====================================================================
-- EXPORT LOG (and masking rule for sensitive columns)
-- =====================================================================
create or replace function public.export_log(p_token text, p_dataset text, p_format text, p_rows int, p_sensitive boolean, p_pin text) returns boolean
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if p_sensitive then
    if not (s.role_id = 'owner' or public._has(s.role_id,'exportSensitive')) then raise exception 'NOT_ALLOWED:exportSensitive'; end if;
    if not public._pin_ok(s, p_pin) then raise exception 'WRONG_PIN'; end if;
  end if;
  perform public._audit(s,'تصدير بيانات',p_dataset,null,p_format || ' · ' || p_rows || ' سطر' || case when p_sensitive then ' · بالبيانات الحساسة' else '' end,null,null);
  return true;
end $$;

-- ---------- automatic snapshots: hourly + daily (03:00 Cairo) ----------
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('minzo-backup-hourly', '7 * * * *', $c$select public._backup_take('hourly', null, null)$c$);
  perform cron.schedule('minzo-backup-daily', '17 1 * * *', $c$select public._backup_take('daily', null, null)$c$);
exception when others then raise notice 'pg_cron not available here: %', sqlerrm;
end $$;

-- ---------- grants ----------
revoke execute on function public._pin_ok(public.sess,text), public._owner_pin_ok(text), public._backup_data(), public._backup_take(text,text,uuid), public._backup_right(public.sess),
  public._rule_live(public.item_rules,timestamptz), public._item_state(uuid,smallint,timestamptz), public._sale_line_guard()
  from public, anon, authenticated;
revoke execute on function public.audit_verify(text), public.role_save(text,jsonb,text), public.role_delete(text,text,text), public.pin_check(text,text),
  public.backups_list(text), public.backup_now(text,text), public.backup_get(text,bigint), public.backup_restore(text,jsonb,text,text), public.system_reset(text,text,text,text),
  public.item_rule_save(text,jsonb), public.item_rule_end(text,int), public.items_stale(text,int), public.export_log(text,text,text,int,boolean,text) from public, anon;
grant execute on function public.audit_verify(text), public.role_save(text,jsonb,text), public.role_delete(text,text,text), public.pin_check(text,text),
  public.backups_list(text), public.backup_now(text,text), public.backup_get(text,bigint), public.backup_restore(text,jsonb,text,text), public.system_reset(text,text,text,text),
  public.item_rule_save(text,jsonb), public.item_rule_end(text,int), public.items_stale(text,int), public.export_log(text,text,text,int,boolean,text) to authenticated;
