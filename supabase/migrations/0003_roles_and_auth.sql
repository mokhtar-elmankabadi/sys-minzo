-- SYS Minzo · phase 1 · base roles, first-run setup, device registration, PIN login & sessions

alter table public.devices add column failed_attempts int not null default 0, add column locked_until timestamptz;

-- ---------- the 13 base roles (perms: v=view a=add e=edit d=hide p=approve x=export r=print i=import) ----------
insert into public.roles (id,name,perms,sens,scope_all_locations,scope_days,max_discount_pct,max_amount,hide_cost,hide_margin,hide_salary,is_base) values
('owner','المالك','{"*":"vaedpxri"}','["*"]',true,0,100,0,false,false,false,true),
('gm','المدير العام','{"*":"vaedpxri"}','["manualClose","openDay","closeTimes","editAfterClose","voidInvoice","itemAvail","prices","drawer","reprint","adminMode","labels","finalReports","users","devices"]',true,0,30,100000,false,false,false,true),
('mgr','مدير فرع','{"dash":"v","pos":"var","items":"vx","entry":"va","stock":"vaepxr","transfers":"vaepr","customers":"vae","cash":"vaep","close":"vaepr","users":"vae","devices":"v","print":"var","audit":"v"}','["manualClose","openDay","drawer","reprint","adminMode","labels","users","voidRequest"]',false,0,10,5000,false,false,true,true),
('asstmgr','مساعد مدير فرع','{"dash":"v","pos":"var","items":"v","entry":"va","stock":"vaer","transfers":"vaer","customers":"vae","cash":"vae","close":"vaepr","print":"vr","audit":"v"}','["manualClose","openDay","drawer","reprint","adminMode","labels"]',false,0,8,3000,false,false,true,true),
('shiftmgr','مدير شيفت','{"pos":"var","items":"v","stock":"va","transfers":"va","customers":"va","cash":"vae","close":"vaepr"}','["drawer","reprint","adminMode"]',false,1,10,2000,true,true,true,true),
('seller','بائع','{"pos":"va","items":"v","customers":"vae"}','[]',false,30,5,0,true,true,true,true),
('cashier','كاشير','{"pos":"va","customers":"va","close":"va"}','[]',false,1,5,500,true,true,true,true),
('acct','المحاسب','{"dash":"v","items":"vx","stock":"vx","transfers":"v","customers":"vx","cash":"vaedpxr","close":"vaepxr","audit":"vx","io":"vxi"}','["manualClose","closeTimes","editAfterClose","finalReports","backup"]',true,0,0,50000,false,false,false,true),
('asstacct','نائب المحاسب','{"dash":"v","items":"vx","stock":"vx","customers":"vx","cash":"vaxr","close":"vxr","audit":"v","io":"vxi"}','["reprint"]',true,0,0,10000,false,false,true,true),
('dataentry','مدخل بيانات','{"items":"vaexi","entry":"vae","customers":"vae","print":"vr","io":"vxi"}','["labels"]',true,0,0,0,false,true,true,true),
('keeper','أمين مخازن','{"items":"vae","entry":"vae","stock":"vaepxr","transfers":"vaepr","print":"vr"}','["labels"]',false,0,0,1000,true,true,true,true),
('asstkeeper','مساعد أمين مخزن','{"items":"v","stock":"var","transfers":"va","print":"vr"}','["labels"]',false,7,0,0,true,true,true,true),
('promo','مسؤول العروض والمرتجعات','{"dash":"v","items":"ve","stock":"v","customers":"v","returns":"vaep","offers":"vaedp"}','["prices","itemAvail"]',true,0,15,0,false,false,true,true);

-- ---------- helpers ----------
create or replace function public._me_device() returns public.devices
language plpgsql stable security definer set search_path = public as $$
declare d public.devices;
begin
  select * into d from public.devices where auth_uid = auth.uid();
  if d.id is null then raise exception 'DEVICE_NOT_REGISTERED'; end if;
  if not d.active then raise exception 'DEVICE_NOT_APPROVED'; end if;
  return d;
end $$;

create type public.sess as (staff_id uuid, staff_name text, role_id text, location_id smallint, device_id uuid, device_location smallint);

create or replace function public._session(p_token text) returns public.sess
language plpgsql security definer set search_path = public, extensions as $$
declare d public.devices; r public.sess;
begin
  d := public._me_device();
  select s.id, s.name, s.role_id, s.location_id, d.id, d.location_id into r
    from public.staff_sessions ss join public.staff s on s.id = ss.staff_id
   where ss.token_hash = encode(digest(p_token,'sha256'),'hex') and ss.device_id = d.id and ss.expires_at > now() and s.active;
  if r.staff_id is null then raise exception 'SESSION_EXPIRED'; end if;
  update public.staff_sessions set expires_at = now() + interval '12 hours' where token_hash = encode(digest(p_token,'sha256'),'hex');
  return r;
end $$;

create or replace function public._can(p_role text, p_mod text, p_act text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select position(p_act in coalesce(r.perms->>p_mod, r.perms->>'*', '')) > 0 from public.roles r where r.id = p_role), false);
$$;

create or replace function public._has(p_role text, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select r.sens ? p_key or r.sens ? '*' from public.roles r where r.id = p_role), false);
$$;

create or replace function public._require(s public.sess, p_mod text, p_act text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._can(s.role_id, p_mod, p_act) then raise exception 'NOT_ALLOWED:%:%', p_mod, p_act; end if;
end $$;

create or replace function public._loc_ok(s public.sess, p_loc smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select (select scope_all_locations from public.roles where id = s.role_id) or s.location_id is null or s.location_id = p_loc;
$$;

create or replace function public._audit(s public.sess, p_action text, p_entity text, p_before text, p_after text, p_reason text, p_loc smallint)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (staff_id, staff_name, device_id, action, entity, before, after, reason, location_id)
  values (s.staff_id, s.staff_name, s.device_id, p_action, p_entity, p_before, p_after, p_reason, p_loc);
$$;

create or replace function public._pin_weak(p text) returns text
language plpgsql immutable set search_path = public as $$
declare i int; up boolean := true; dn boolean := true;
begin
  if p ~ '^[0-9]+$' then
    if length(p) < 4 or length(p) > 8 then return 'PIN_LENGTH'; end if;
    if p ~ '^(.)\1+$' then return 'PIN_REPEATED'; end if;
    for i in 2..length(p) loop
      if substr(p,i,1)::int <> substr(p,i-1,1)::int + 1 then up := false; end if;
      if substr(p,i,1)::int <> substr(p,i-1,1)::int - 1 then dn := false; end if;
    end loop;
    if up or dn then return 'PIN_SEQUENCE'; end if;
    return null;
  end if;
  if length(p) < 6 or p !~ '[0-9]' or p !~ '[^0-9[:space:]]' then return 'PASSWORD_WEAK'; end if;
  return null;
end $$;

create or replace function public._pin_taken(p text, p_except uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.staff where active and pin_hash is not null and id is distinct from p_except and pin_hash = crypt(p, pin_hash));
$$;

-- ---------- first run: the very first signed-in device creates the owner ----------
create or replace function public.setup_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'setup_done', (select setup_done from public.store),
    'device', (select jsonb_build_object('id',id,'name',name,'active',active,'kind',kind,'location_id',location_id) from public.devices where auth_uid = auth.uid()),
    'store', (select name from public.store));
$$;

create or replace function public.setup_first_run(p_store_name text, p_device_name text, p_owner_name text, p_owner_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d uuid; o uuid; w text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  perform 1 from public.store where setup_done for update;
  if found or exists (select 1 from public.devices) then raise exception 'ALREADY_SET_UP'; end if;
  w := public._pin_weak(p_owner_pin); if w is not null then raise exception '%', w; end if;
  insert into public.devices (auth_uid, name, kind, active) values (auth.uid(), p_device_name, 'admin', true) returning id into d;
  insert into public.staff (name, role_id, pin_hash, pin_must_change) values (p_owner_name, 'owner', crypt(p_owner_pin, gen_salt('bf', 10)), false) returning id into o;
  update public.store set name = coalesce(nullif(trim(p_store_name),''), name), setup_done = true, updated_at = now();
  insert into public.audit_log (staff_id, staff_name, device_id, action, entity) values (o, p_owner_name, d, 'تهيئة النظام لأول مرة', p_store_name);
  return jsonb_build_object('device_id', d, 'owner_id', o);
end $$;

-- ---------- other devices: register (pending) → owner / GM approves ----------
create or replace function public.device_register(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.devices;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  if not (select setup_done from public.store) then raise exception 'NOT_SET_UP'; end if;
  insert into public.devices (auth_uid, name, kind, active) values (auth.uid(), p_name, 'cashier', false)
  on conflict (auth_uid) do update set name = excluded.name returning * into d;
  return jsonb_build_object('id', d.id, 'active', d.active);
end $$;

create or replace function public.device_pending(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if not public._has(s.role_id,'devices') then raise exception 'NOT_ALLOWED:devices'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'created_at',created_at) order by created_at) from public.devices where not active), '[]'::jsonb);
end $$;

create or replace function public.device_set(p_token text, p_device uuid, p_name text, p_kind text, p_location smallint, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; b public.devices;
begin
  s := public._session(p_token);
  if not public._has(s.role_id,'devices') then raise exception 'NOT_ALLOWED:devices'; end if;
  select * into b from public.devices where id = p_device;
  if b.id = s.device_id and not p_active then raise exception 'CANNOT_DISABLE_OWN_DEVICE'; end if;
  update public.devices set name = coalesce(p_name, name), kind = coalesce(p_kind, kind), location_id = p_location, active = p_active where id = p_device;
  perform public._audit(s, case when p_active and not b.active then 'اعتماد جهاز' when not p_active then 'إيقاف جهاز' else 'تعديل جهاز' end, coalesce(p_name,b.name), b.kind||'/'||b.active, p_kind||'/'||p_active, null, p_location);
end $$;

-- ---------- PIN login ----------
create or replace function public.staff_login(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d public.devices; st public.staff; tok text; r public.roles;
begin
  d := public._me_device();
  if d.locked_until is not null and d.locked_until > now() then raise exception 'LOCKED_UNTIL:%', d.locked_until; end if;
  select * into st from public.staff where active and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash) limit 1;
  if st.id is null then
    update public.devices set failed_attempts = failed_attempts + 1,
      locked_until = case when failed_attempts + 1 >= 5 then now() + interval '5 minutes' else locked_until end where id = d.id;
    insert into public.audit_log (device_id, action, entity) values (d.id, 'محاولة دخول برمز غلط', d.name);
    raise exception 'WRONG_PIN';
  end if;
  if d.kind <> 'admin' and st.location_id is not null and d.location_id is not null and st.location_id <> d.location_id
     and not (select scope_all_locations from public.roles where id = st.role_id) then raise exception 'WRONG_LOCATION'; end if;
  update public.devices set failed_attempts = 0, locked_until = null, last_seen = now() where id = d.id;
  tok := encode(gen_random_bytes(32), 'hex');
  delete from public.staff_sessions where expires_at < now();
  insert into public.staff_sessions (token_hash, staff_id, device_id, expires_at) values (encode(digest(tok,'sha256'),'hex'), st.id, d.id, now() + interval '12 hours');
  select * into r from public.roles where id = st.role_id;
  insert into public.audit_log (staff_id, staff_name, device_id, action, entity, location_id) values (st.id, st.name, d.id, 'دخول', d.name, d.location_id);
  return jsonb_build_object('token', tok, 'staff', jsonb_build_object('id',st.id,'name',st.name,'role_id',st.role_id,'location_id',st.location_id,'must_change',st.pin_must_change),
    'role', to_jsonb(r), 'device', jsonb_build_object('id',d.id,'name',d.name,'kind',d.kind,'location_id',d.location_id));
end $$;

create or replace function public.staff_logout(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from public.staff_sessions where token_hash = encode(digest(p_token,'sha256'),'hex');
$$;

create or replace function public.staff_change_pin(p_token text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; w text;
begin
  s := public._session(p_token);
  if not exists (select 1 from public.staff where id = s.staff_id and pin_hash = crypt(p_old, pin_hash)) then raise exception 'WRONG_PIN'; end if;
  w := public._pin_weak(p_new); if w is not null then raise exception '%', w; end if;
  if public._pin_taken(p_new, s.staff_id) then raise exception 'PIN_TAKEN'; end if;
  update public.staff set pin_hash = crypt(p_new, gen_salt('bf',10)), pin_must_change = false where id = s.staff_id;
  perform public._audit(s, 'تغيير الرمز السري', s.staff_name, null, null, null, s.location_id);
end $$;

-- ---------- staff management (owner / GM / managers for their own branch) ----------
create or replace function public.staff_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if not public._has(s.role_id,'users') then raise exception 'NOT_ALLOWED:users'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role_id',role_id,'location_id',location_id,'active',active,'has_pin',pin_hash is not null,'must_change',pin_must_change) order by name)
    from public.staff where public._loc_ok(s, coalesce(location_id, s.location_id))), '[]'::jsonb);
end $$;

create or replace function public.staff_save(p_token text, p_id uuid, p_name text, p_role text, p_location smallint, p_active boolean, p_temp_pin text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; b public.staff; nid uuid; w text;
begin
  s := public._session(p_token);
  if not public._has(s.role_id,'users') then raise exception 'NOT_ALLOWED:users'; end if;
  if p_role = 'owner' and s.role_id <> 'owner' then raise exception 'ONLY_OWNER_CREATES_OWNER'; end if;
  if s.role_id not in ('owner','gm') and (p_location is distinct from s.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  if s.role_id not in ('owner','gm') and p_role in ('owner','gm','mgr','acct') then raise exception 'ESCALATION'; end if;
  if p_temp_pin is not null then
    w := public._pin_weak(p_temp_pin); if w is not null then raise exception '%', w; end if;
    if public._pin_taken(p_temp_pin, p_id) then raise exception 'PIN_TAKEN'; end if;
  end if;
  if p_id is null then
    insert into public.staff (name, role_id, location_id, active, pin_hash, pin_must_change)
    values (p_name, p_role, p_location, coalesce(p_active,true), case when p_temp_pin is null then null else crypt(p_temp_pin, gen_salt('bf',10)) end, true) returning id into nid;
    perform public._audit(s, 'إضافة موظف', p_name, null, p_role, null, p_location);
    return nid;
  end if;
  select * into b from public.staff where id = p_id;
  if b.role_id = 'owner' and s.role_id <> 'owner' then raise exception 'ONLY_OWNER_EDITS_OWNER'; end if;
  if b.role_id = 'owner' and (p_role <> 'owner' or not p_active) and (select count(*) from public.staff where role_id='owner' and active) <= 1 then raise exception 'LAST_OWNER'; end if;
  update public.staff set name = p_name, role_id = p_role, location_id = p_location, active = p_active,
    pin_hash = case when p_temp_pin is null then pin_hash else crypt(p_temp_pin, gen_salt('bf',10)) end,
    pin_must_change = case when p_temp_pin is null then pin_must_change else true end
   where id = p_id;
  if p_temp_pin is not null then delete from public.staff_sessions where staff_id = p_id; end if;
  perform public._audit(s, case when p_temp_pin is not null then 'تعيين رمز مؤقت' else 'تعديل موظف' end, p_name, b.role_id||'/'||b.active, p_role||'/'||p_active, null, p_location);
  return p_id;
end $$;

-- ---------- grants: functions are the only write path ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.setup_status(), public.setup_first_run(text,text,text,text), public.device_register(text),
  public.device_pending(text), public.device_set(text,uuid,text,text,smallint,boolean), public.staff_login(text), public.staff_logout(text),
  public.staff_change_pin(text,text,text), public.staff_list(text), public.staff_save(text,uuid,text,text,smallint,boolean,text), public.is_device()
  to authenticated;
