-- names only (no PIN data) so screens can show who opened a shift, who sold, and pick a salesperson
create or replace function public.staff_directory(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role_id',role_id,'location_id',location_id,'active',active) order by name) from public.staff), '[]'::jsonb);
end $$;
revoke execute on function public.staff_directory(text) from public, anon;
grant execute on function public.staff_directory(text) to authenticated;
