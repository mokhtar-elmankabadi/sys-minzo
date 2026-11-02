-- is_device() is only needed by RLS policies for signed-in devices
revoke execute on function public.is_device() from public, anon;
grant execute on function public.is_device() to authenticated;
