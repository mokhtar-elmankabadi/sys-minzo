-- A raised exception rolled back the failed-attempt counter, so the 5-try lock never triggered.
-- Wrong PIN / locked device now RETURN an error object instead of raising.
create or replace function public.staff_login(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d public.devices; st public.staff; tok text; r public.roles; n int;
begin
  d := public._me_device();
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
revoke execute on function public.staff_login(text) from public, anon;
grant execute on function public.staff_login(text) to authenticated;
