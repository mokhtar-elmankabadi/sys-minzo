-- Supabase blocks UPDATE without WHERE on API requests (safeupdate); the store row is id = 1
create or replace function public.setup_first_run(p_store_name text, p_device_name text, p_owner_name text, p_owner_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d uuid; o uuid; w text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  perform 1 from public.store where id = 1 and setup_done for update;
  if found or exists (select 1 from public.devices) then raise exception 'ALREADY_SET_UP'; end if;
  w := public._pin_weak(p_owner_pin); if w is not null then raise exception '%', w; end if;
  insert into public.devices (auth_uid, name, kind, active) values (auth.uid(), p_device_name, 'admin', true) returning id into d;
  insert into public.staff (name, role_id, pin_hash, pin_must_change) values (p_owner_name, 'owner', crypt(p_owner_pin, gen_salt('bf', 10)), false) returning id into o;
  update public.store set name = coalesce(nullif(trim(p_store_name),''), name), setup_done = true, updated_at = now() where id = 1;
  insert into public.audit_log (staff_id, staff_name, device_id, action, entity) values (o, p_owner_name, d, 'تهيئة النظام لأول مرة', p_store_name);
  return jsonb_build_object('device_id', d, 'owner_id', o);
end $$;
