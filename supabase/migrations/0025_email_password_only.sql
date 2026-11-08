-- 0025 · email devices open with the email password alone (owner's choice): no PIN after the password.
-- The password must have just been typed (within 10 minutes), so a stolen, older sign-in can't open a session.
-- The PIN stays only for the one-time link of a self-made owner / GM account.
create or replace function public.email_password_login() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := public._email_uid(); st public.staff; d public.devices; tok text; r public.roles; pw timestamptz := public._pw_signed_at();
begin
  if uid is null then return jsonb_build_object('error','NO_EMAIL'); end if;
  if pw is null or pw < now() - interval '10 minutes' then return jsonb_build_object('error','NEED_PASSWORD'); end if;
  select * into st from public.staff where auth_user_id = uid;
  if st.id is null then return jsonb_build_object('error','NOT_LINKED'); end if;
  if not st.active or not st.email_login then return jsonb_build_object('error','EMAIL_DISABLED'); end if;
  if st.pw_reset_at is not null and pw <= st.pw_reset_at then return jsonb_build_object('error','NEED_PASSWORD'); end if;
  -- locked (by hand or automatically) after this password was typed → type it again
  if exists (select 1 from public.email_pin_fails f where f.auth_user_id = uid and f.locked_at is not null and pw <= f.locked_at) then return jsonb_build_object('error','NEED_PASSWORD'); end if;
  insert into public.email_pin_fails (auth_user_id, fails, locked_at) values (uid, 0, null)
  on conflict (auth_user_id) do update set fails = 0, locked_at = null;
  d := public._personal_device(st);
  tok := encode(gen_random_bytes(32), 'hex');
  delete from public.staff_sessions where expires_at < now();
  insert into public.staff_sessions (token_hash, staff_id, device_id, expires_at) values (encode(digest(tok,'sha256'),'hex'), st.id, d.id, now() + interval '12 hours');
  select * into r from public.roles where id = st.role_id;
  perform public._audit_raw(st.id, st.name, d.id, 'دخول بالإيميل', d.name, null, null, null);
  return jsonb_build_object('token', tok, 'staff', jsonb_build_object('id',st.id,'name',st.name,'role_id',st.role_id,'location_id',st.location_id,'must_change',false,'must_change_pw',st.pw_must_change),
    'role', to_jsonb(r), 'device', jsonb_build_object('id',d.id,'name',d.name,'kind',d.kind,'location_id',d.location_id));
end $$;

-- unlinking puts the email account back in «waiting accounts», so it can be linked again or deleted
-- (before, it was left with no owner and the same email could not be used again)
create or replace function public.staff_unlink(p_token text, p_staff uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; st public.staff; em text;
begin
  s := public._session(p_token); st := public._staff_manage(s, p_staff);
  if st.auth_user_id is null then return; end if;
  update public.staff set auth_user_id = null, pw_must_change = false where id = st.id;
  select email into em from auth.users where id = st.auth_user_id;
  if em is not null then
    insert into public.pending_accounts (auth_user_id, email, name) values (st.auth_user_id, em, st.name) on conflict (auth_user_id) do nothing;
  end if;
  perform public._audit(s, 'فك ربط حساب إيميل', st.name, null, em, null, null);
end $$;

-- the email device was locked: the next entry needs the password typed again (even after reopening the app)
create or replace function public.email_lock() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._email_uid();
begin
  if uid is null then return; end if;
  insert into public.email_pin_fails (auth_user_id, fails, locked_at) values (uid, 0, now())
  on conflict (auth_user_id) do update set locked_at = now();
  delete from public.staff_sessions ss using public.devices dv where dv.id = ss.device_id and dv.auth_uid = uid;
end $$;

revoke execute on function public.email_password_login(), public.email_lock() from public, anon;
grant execute on function public.email_password_login(), public.email_lock() to authenticated;

-- «make email account» for an email that already has an account nobody owns (waiting, or unlinked earlier):
-- the server function reuses it instead of refusing the email
create or replace function public.email_free_account(p_token text, p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.sess; u uuid;
begin
  s := public._session(p_token);
  if not (s.role_id = 'owner' or public._has(s.role_id, 'users')) then raise exception 'NOT_ALLOWED:users'; end if;
  select au.id into u from auth.users au
   where lower(au.email) = lower(trim(p_email)) and not coalesce(au.is_anonymous, false)
     and not exists (select 1 from public.staff st where st.auth_user_id = au.id);
  return u;
end $$;
revoke execute on function public.email_free_account(text, text) from public, anon;
grant execute on function public.email_free_account(text, text) to authenticated;
