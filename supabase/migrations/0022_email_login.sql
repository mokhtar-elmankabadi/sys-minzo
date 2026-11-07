-- 0022 · email sign-in for chosen staff, from any device
-- A staff member with email_login on signs in once with email + password (Supabase Auth, not anonymous);
-- that browser becomes a «personal» device tied to them alone, and from then on opens with their usual PIN.
-- Showroom devices and their PIN sign-in are unchanged. Existing data is not modified, except that the
-- email box is switched on for the current owner / general-manager accounts so they can link themselves.

alter table public.staff
  add column if not exists email_login boolean not null default false,
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists pw_must_change boolean not null default false,
  add column if not exists pw_reset_at timestamptz;

alter table public.store add column if not exists auto_lock_min int not null default 10;
alter table public.store drop constraint if exists store_auto_lock_min_check;
alter table public.store add constraint store_auto_lock_min_check check (auto_lock_min between 0 and 240);

alter table public.devices drop constraint if exists devices_kind_check;
alter table public.devices add constraint devices_kind_check check (kind in ('admin','cashier','warehouse','custom','personal'));

-- accounts people made for themselves; they stay here, with no access, until linked to a staff member
create table if not exists public.pending_accounts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.pending_accounts enable row level security;

-- wrong PINs on an email device; 5 in a row and the email + password are needed again
create table if not exists public.email_pin_fails (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  fails int not null default 0,
  locked_at timestamptz
);
alter table public.email_pin_fails enable row level security;

update public.staff set email_login = true where role_id in ('owner','gm') and not email_login;

-- when the caller last typed their password (the amr claim keeps that moment across token refreshes)
create or replace function public._pw_signed_at() returns timestamptz
language sql stable set search_path = public as $$
  select to_timestamp(max((x->>'timestamp')::bigint))
    from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) x
   where x->>'method' = 'password';
$$;

-- the email account behind this request (null for anonymous showroom devices)
create or replace function public._email_uid() returns uuid
language sql stable security definer set search_path = public as $$
  select u.id from auth.users u where u.id = auth.uid() and not coalesce(u.is_anonymous, false);
$$;

-- personal device for a linked staff member: made on first use, never needs approval
create or replace function public._personal_device(st public.staff) returns public.devices
language plpgsql security definer set search_path = public as $$
declare d public.devices;
begin
  update public.devices set active = true, kind = 'personal', location_id = null, last_seen = now(), name = 'شخصي — ' || st.name
   where auth_uid = st.auth_user_id returning * into d;
  if d.id is null then
    insert into public.devices (name, kind, auth_uid, active, location_id, last_seen)
    values ('شخصي — ' || st.name, 'personal', st.auth_user_id, true, null, now()) returning * into d;
  end if;
  return d;
end $$;

-- what an email sign-in may do next: ready (ask for the PIN), link (owner / GM: PIN links the account),
-- pending (waiting for the owner), disabled, need_password (sign in again with email + password)
create or replace function public.email_session() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._email_uid(); st public.staff; f public.email_pin_fails;
begin
  if uid is null then return jsonb_build_object('status','no_email'); end if;
  select * into f from public.email_pin_fails where auth_user_id = uid;
  if f.locked_at is not null and coalesce(public._pw_signed_at(), '-infinity') <= f.locked_at then return jsonb_build_object('status','need_password'); end if;
  select * into st from public.staff where auth_user_id = uid;
  if st.id is null then
    if exists (select 1 from public.pending_accounts where auth_user_id = uid) then return jsonb_build_object('status','pending'); end if;
    return jsonb_build_object('status','link');
  end if;
  if not st.active or not st.email_login then return jsonb_build_object('status','disabled'); end if;
  if st.pw_reset_at is not null and coalesce(public._pw_signed_at(), '-infinity') <= st.pw_reset_at then return jsonb_build_object('status','need_password'); end if;
  return jsonb_build_object('status','ready','name',st.name,'must_change_pw',st.pw_must_change);
end $$;

-- PIN on an email device: checks the PIN of the linked staff member only (never anyone else's)
create or replace function public.email_pin_login(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := public._email_uid(); st public.staff; d public.devices; f public.email_pin_fails; tok text; r public.roles; n int;
begin
  if uid is null then return jsonb_build_object('error','NO_EMAIL'); end if;
  select * into f from public.email_pin_fails where auth_user_id = uid;
  if f.locked_at is not null and coalesce(public._pw_signed_at(), '-infinity') <= f.locked_at then return jsonb_build_object('error','NEED_PASSWORD'); end if;
  select * into st from public.staff where auth_user_id = uid;
  if st.id is null then
    -- first sign-in of the owner / general manager (whether they made the account themselves or not):
    -- their PIN says which account this email belongs to. Anyone else waits for the owner to link them.
    select * into st from public.staff
     where active and email_login and auth_user_id is null and role_id in ('owner','gm')
       and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash) limit 1;
    if st.id is not null then
      update public.staff set auth_user_id = uid where id = st.id returning * into st;
      delete from public.pending_accounts where auth_user_id = uid;
      perform public._audit_raw(st.id, st.name, null, 'ربط حساب إيميل', st.name, null, (select email from auth.users where id = uid), null);
    end if;
  elsif not st.active or not st.email_login then return jsonb_build_object('error','EMAIL_DISABLED');
  elsif st.pw_reset_at is not null and coalesce(public._pw_signed_at(), '-infinity') <= st.pw_reset_at then return jsonb_build_object('error','NEED_PASSWORD');
  elsif st.pin_hash is null or st.pin_hash <> crypt(p_pin, st.pin_hash) then st := null;
  end if;
  if st.id is null then
    insert into public.email_pin_fails (auth_user_id, fails) values (uid, 1)
    on conflict (auth_user_id) do update set fails = public.email_pin_fails.fails + 1 returning fails into n;
    perform public._audit_raw(null, null, null, 'رمز غلط على جهاز إيميل', (select email from auth.users where id = uid), null, n::text, null);
    if n >= 5 then
      update public.email_pin_fails set fails = 0, locked_at = now() where auth_user_id = uid;
      delete from public.staff_sessions ss using public.devices dv where dv.id = ss.device_id and dv.auth_uid = uid;
      return jsonb_build_object('error','NEED_PASSWORD');
    end if;
    return jsonb_build_object('error','WRONG_PIN','left',5 - n);
  end if;
  insert into public.email_pin_fails (auth_user_id, fails, locked_at) values (uid, 0, null)
  on conflict (auth_user_id) do update set fails = 0, locked_at = null;
  d := public._personal_device(st);
  tok := encode(gen_random_bytes(32), 'hex');
  delete from public.staff_sessions where expires_at < now();
  insert into public.staff_sessions (token_hash, staff_id, device_id, expires_at) values (encode(digest(tok,'sha256'),'hex'), st.id, d.id, now() + interval '12 hours');
  select * into r from public.roles where id = st.role_id;
  perform public._audit_raw(st.id, st.name, d.id, 'دخول بالإيميل', d.name, null, null, null);
  return jsonb_build_object('token', tok, 'staff', jsonb_build_object('id',st.id,'name',st.name,'role_id',st.role_id,'location_id',st.location_id,'must_change',st.pin_must_change,'must_change_pw',st.pw_must_change),
    'role', to_jsonb(r), 'device', jsonb_build_object('id',d.id,'name',d.name,'kind',d.kind,'location_id',d.location_id));
end $$;

-- the person changed their temporary password
create or replace function public.email_pw_changed() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._email_uid();
begin
  if uid is null then raise exception 'NO_EMAIL'; end if;
  update public.staff set pw_must_change = false where auth_user_id = uid;
end $$;

-- audit row without a session (sign-in events)
create or replace function public._audit_raw(p_staff uuid, p_name text, p_device uuid, p_action text, p_entity text, p_before text, p_after text, p_loc smallint) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log (staff_id, staff_name, device_id, action, entity, before, after, location_id)
  values (p_staff, p_name, p_device, p_action, p_entity, p_before, p_after, p_loc);
$$;

-- a session on a personal device lives only while that person may still sign in by email
create or replace function public._session(p_token text) returns public.sess
language plpgsql security definer set search_path = public, extensions as $$
declare d public.devices; r public.sess;
begin
  d := public._me_device();
  select s.id, s.name, s.role_id, s.location_id, d.id, d.location_id into r
    from public.staff_sessions ss join public.staff s on s.id = ss.staff_id
   where ss.token_hash = encode(digest(p_token,'sha256'),'hex') and ss.device_id = d.id and ss.expires_at > now() and s.active
     and (d.kind <> 'personal' or (s.email_login and s.auth_user_id = d.auth_uid));
  if r.staff_id is null then raise exception 'SESSION_EXPIRED'; end if;
  update public.staff_sessions set expires_at = now() + interval '12 hours' where token_hash = encode(digest(p_token,'sha256'),'hex');
  return r;
end $$;

-- showroom PIN sign-in: unchanged, except that a personal device only opens for its own person (by email PIN)
create or replace function public.staff_login(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d public.devices; st public.staff; tok text; r public.roles; n int;
begin
  d := public._me_device();
  if d.kind = 'personal' then return jsonb_build_object('error','USE_EMAIL'); end if;
  if d.locked_until is not null and d.locked_until > now() then
    return jsonb_build_object('error','LOCKED','until',d.locked_until);
  end if;
  select * into st from public.staff where active and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash) limit 1;
  if st.id is null then
    update public.devices set failed_attempts = failed_attempts + 1,
      locked_until = case when failed_attempts + 1 >= 5 then now() + interval '5 minutes' else locked_until end
     where id = d.id returning failed_attempts into n;
    insert into public.audit_log (device_id, action, entity, after) values (d.id, 'محاولة دخول برمز غلط', d.name, n::text);
    if n >= 5 then
      update public.devices set failed_attempts = 0 where id = d.id;
      return jsonb_build_object('error','LOCKED','until',now() + interval '5 minutes');
    end if;
    return jsonb_build_object('error','WRONG_PIN','left',5 - n);
  end if;
  if d.kind <> 'admin' and st.location_id is not null and d.location_id is not null and st.location_id <> d.location_id
     and not (select scope_all_locations from public.roles where id = st.role_id) then
    return jsonb_build_object('error','WRONG_LOCATION');
  end if;
  update public.devices set failed_attempts = 0, locked_until = null, last_seen = now() where id = d.id;
  tok := encode(gen_random_bytes(32), 'hex');
  delete from public.staff_sessions where expires_at < now();
  insert into public.staff_sessions (token_hash, staff_id, device_id, expires_at) values (encode(digest(tok,'sha256'),'hex'), st.id, d.id, now() + interval '12 hours');
  select * into r from public.roles where id = st.role_id;
  insert into public.audit_log (staff_id, staff_name, device_id, action, entity, location_id) values (st.id, st.name, d.id, 'دخول', d.name, d.location_id);
  return jsonb_build_object('token', tok, 'staff', jsonb_build_object('id',st.id,'name',st.name,'role_id',st.role_id,'location_id',st.location_id,'must_change',st.pin_must_change),
    'role', to_jsonb(r), 'device', jsonb_build_object('id',d.id,'name',d.name,'kind',d.kind,'location_id',d.location_id));
end $$;

-- turning the email box off, stopping the person, or unlinking: every session ends on every device
create or replace function public._staff_access_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (old.email_login and not new.email_login) or (old.active and not new.active) or (old.auth_user_id is not null and new.auth_user_id is distinct from old.auth_user_id) then
    delete from public.staff_sessions where staff_id = new.id;
    if old.auth_user_id is not null then update public.devices set active = false where kind = 'personal' and auth_uid = old.auth_user_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists staff_access_guard on public.staff;
create trigger staff_access_guard after update on public.staff for each row execute function public._staff_access_guard();

-- users screen: who may manage whom (same rule as staff_save: only the owner touches an owner account)
create or replace function public._staff_manage(s public.sess, p_staff uuid) returns public.staff
language plpgsql security definer set search_path = public as $$
declare st public.staff;
begin
  if not (s.role_id = 'owner' or public._has(s.role_id, 'users')) then raise exception 'NOT_ALLOWED:users'; end if;
  select * into st from public.staff where id = p_staff;
  if st.id is null then raise exception 'NOT_FOUND'; end if;
  if st.role_id = 'owner' and s.role_id <> 'owner' then raise exception 'NOT_ALLOWED:users'; end if;
  return st;
end $$;

create or replace function public.staff_email_set(p_token text, p_staff uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; st public.staff;
begin
  s := public._session(p_token); st := public._staff_manage(s, p_staff);
  update public.staff set email_login = coalesce(p_on, false) where id = st.id;
  perform public._audit(s, case when p_on then 'فتح الدخول بالإيميل' else 'قفل الدخول بالإيميل' end, st.name, null, null, null, null);
end $$;

create or replace function public.email_accounts(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if not (s.role_id = 'owner' or public._has(s.role_id, 'users')) then raise exception 'NOT_ALLOWED:users'; end if;
  return jsonb_build_object(
    'pending', coalesce((select jsonb_agg(jsonb_build_object('auth_user_id',p.auth_user_id,'email',p.email,'name',p.name,'at',p.created_at) order by p.created_at) from public.pending_accounts p), '[]'::jsonb),
    'linked', coalesce((select jsonb_agg(jsonb_build_object('staff_id',st.id,'email',u.email,'must_change_pw',st.pw_must_change)) from public.staff st join auth.users u on u.id = st.auth_user_id), '[]'::jsonb));
end $$;

create or replace function public.staff_link(p_token text, p_staff uuid, p_auth uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; st public.staff; pa public.pending_accounts;
begin
  s := public._session(p_token); st := public._staff_manage(s, p_staff);
  if st.auth_user_id is not null then raise exception 'ALREADY_LINKED'; end if;
  select * into pa from public.pending_accounts where auth_user_id = p_auth;
  if pa.auth_user_id is null then raise exception 'NOT_FOUND'; end if;
  update public.staff set auth_user_id = pa.auth_user_id, email_login = true where id = st.id;
  delete from public.pending_accounts where auth_user_id = pa.auth_user_id;
  perform public._audit(s, 'ربط حساب إيميل', st.name, null, pa.email, null, null);
end $$;

create or replace function public.staff_unlink(p_token text, p_staff uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; st public.staff;
begin
  s := public._session(p_token); st := public._staff_manage(s, p_staff);
  if st.auth_user_id is null then return; end if;
  update public.staff set auth_user_id = null, pw_must_change = false where id = st.id;
  perform public._audit(s, 'فك ربط حساب إيميل', st.name, null, null, null, null);
end $$;

-- the Edge Function asks this, with the caller's own sign-in, before any account change
create or replace function public.email_admin_check(p_token text, p_staff uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; st public.staff;
begin
  s := public._session(p_token);
  if p_staff is null then
    if not (s.role_id = 'owner' or public._has(s.role_id, 'users')) then raise exception 'NOT_ALLOWED:users'; end if;
    return jsonb_build_object('actor', s.staff_id, 'actor_name', s.staff_name);
  end if;
  st := public._staff_manage(s, p_staff);
  return jsonb_build_object('actor', s.staff_id, 'actor_name', s.staff_name, 'staff_id', st.id, 'staff_name', st.name, 'auth_user_id', st.auth_user_id, 'active', st.active);
end $$;

create or replace function public.store_autolock_save(p_token text, p_min int) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; o int;
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm') then raise exception 'NOT_ALLOWED:settings'; end if;
  if p_min is null or p_min < 0 or p_min > 240 then raise exception 'BAD_VALUE'; end if;
  select auto_lock_min into o from public.store where id = 1;
  update public.store set auto_lock_min = p_min, updated_at = now() where id = 1;
  perform public._audit(s, 'القفل التلقائي', null, o::text, p_min::text, null, null);
end $$;

revoke execute on function public._pw_signed_at(), public._email_uid(), public._personal_device(public.staff), public._audit_raw(uuid,text,uuid,text,text,text,text,smallint),
  public._staff_access_guard(), public._staff_manage(public.sess, uuid) from public, anon, authenticated;
revoke execute on function public.email_session(), public.email_pin_login(text), public.email_pw_changed(), public.staff_email_set(text,uuid,boolean),
  public.email_accounts(text), public.staff_link(text,uuid,uuid), public.staff_unlink(text,uuid), public.email_admin_check(text,uuid), public.store_autolock_save(text,int) from public, anon;
grant execute on function public.email_session(), public.email_pin_login(text), public.email_pw_changed(), public.staff_email_set(text,uuid,boolean),
  public.email_accounts(text), public.staff_link(text,uuid,uuid), public.staff_unlink(text,uuid), public.email_admin_check(text,uuid), public.store_autolock_save(text,int) to authenticated;

-- users screen: show the email box and the linked email for each person
create or replace function public.staff_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if not public._has(s.role_id,'users') then raise exception 'NOT_ALLOWED:users'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'name',st.name,'role_id',st.role_id,'location_id',st.location_id,'active',st.active,'has_pin',st.pin_hash is not null,'must_change',st.pin_must_change,
      'email_login',st.email_login,'email',u.email,'pw_must_change',st.pw_must_change) order by st.name)
    from public.staff st left join auth.users u on u.id = st.auth_user_id
   where public._loc_ok(s, coalesce(st.location_id, s.location_id))), '[]'::jsonb);
end $$;
