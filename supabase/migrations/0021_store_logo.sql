-- 0021 · store logo: an image kept on the store row (small data URL, resized in the browser before upload)
create or replace function public.store_logo_save(p_token text, p_logo text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; v text := nullif(trim(coalesce(p_logo,'')),'');
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm') then raise exception 'NOT_ALLOWED:settings'; end if;
  if v is not null then
    if v !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'BAD_IMAGE'; end if;
    if length(v) > 400000 then raise exception 'IMAGE_TOO_BIG'; end if;
  end if;
  update public.store set logo_url = v, updated_at = now() where id = 1;
  perform public._audit(s, case when v is null then 'إزالة الشعار' else 'تغيير الشعار' end, '', null, case when v is null then null else round(length(v) * 3 / 4 / 1024.0)::text || ' KB' end, null, null);
end $$;
revoke execute on function public.store_logo_save(text,text) from public, anon;
grant execute on function public.store_logo_save(text,text) to authenticated;
