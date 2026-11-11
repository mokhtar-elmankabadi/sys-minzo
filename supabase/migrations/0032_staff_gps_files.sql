-- 0032 · staff: punching from the phone with location, and a complete staff file (owner's choices)
-- · each place gets a point on the map and a distance; a punch from the phone sends where the person is.
--   Outside the distance it is still recorded, with a red «outside the place» mark that the owner sees.
-- · while someone is checked in and the system is open on their phone, it checks every few minutes:
--   leaving the place / coming back is recorded and shown to the owner (a website can't track a closed phone).
-- · the staff file: personal data, photo and papers (stored privately; opened only through short-lived links).

alter table public.locations add column if not exists lat double precision;
alter table public.locations add column if not exists lng double precision;
alter table public.locations add column if not exists radius_m int not null default 150 check (radius_m between 20 and 5000);

alter table public.attendance drop constraint if exists attendance_source_check;
alter table public.attendance add constraint attendance_source_check check (source in ('pin','manual','gps'));
alter table public.attendance add column if not exists in_geo jsonb;
alter table public.attendance add column if not exists out_geo jsonb;
alter table public.attendance add column if not exists outside boolean not null default false;

create table if not exists public.att_events (
  id bigserial primary key,
  staff_id uuid not null references public.staff(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('in_out','out_out','away','back')),
  location_id smallint references public.locations(id),
  dist_m int,
  acc_m int,
  lat double precision,
  lng double precision,
  seen_by uuid references public.staff(id)
);
create index if not exists att_events_at on public.att_events (at desc);

alter table public.staff add column if not exists phone text;
alter table public.staff add column if not exists birth_date date;
alter table public.staff add column if not exists hire_date date;
alter table public.staff add column if not exists national_id text;
alter table public.staff add column if not exists address text;
alter table public.staff add column if not exists emergency text;
alter table public.staff add column if not exists job_title text;
alter table public.staff add column if not exists hr_notes text;
alter table public.staff add column if not exists photo_path text;

create table if not exists public.staff_docs (
  id bigserial primary key,
  staff_id uuid not null references public.staff(id) on delete cascade,
  title text not null,
  path text not null unique,
  mime text,
  bytes int,
  uploaded_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['att_events','staff_docs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

-- private bucket; files are only reached through the minzo-files server function
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit) values ('minzo-files', 'minzo-files', false, 6291456)
    on conflict (id) do update set public = false, file_size_limit = 6291456;
  end if;
end $$;

-- distance in metres between two points
create or replace function public._geo_m(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision) returns double precision
language sql immutable set search_path = public as $$
  select 6371000 * 2 * asin(sqrt(power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)))
$$;

-- the place to compare with: the device's place when it has a point, else the nearest place with a point
create or replace function public._geo_place(s public.sess, p_lat double precision, p_lng double precision) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.locations;
begin
  if p_lat is null or p_lng is null then return null; end if;
  select * into l from public.locations where id = s.device_location and lat is not null and active;
  if l.id is null then
    select * into l from public.locations where lat is not null and active order by public._geo_m(lat, lng, p_lat, p_lng) limit 1;
  end if;
  if l.id is null then return null; end if;
  return jsonb_build_object('loc', l.id, 'dist', round(public._geo_m(l.lat, l.lng, p_lat, p_lng)), 'radius', l.radius_m);
end $$;

-- punch with the phone's location (p_lat / p_lng may be null when the phone refused — then it is marked outside)
create or replace function public.attend_punch_geo(p_token text, p_lat double precision, p_lng double precision, p_acc double precision) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; a public.attendance; d date := (now() at time zone 'Africa/Cairo')::date; g jsonb; is_out boolean; info jsonb; any_geo boolean;
begin
  s := public._session(p_token);
  any_geo := exists (select 1 from public.locations where lat is not null and active);
  g := public._geo_place(s, p_lat, p_lng);
  -- inside = within the distance, allowing for the phone's own accuracy (up to 100 m)
  is_out := any_geo and (g is null or (g->>'dist')::numeric > (g->>'radius')::numeric + least(coalesce(p_acc, 0), 100));
  info := jsonb_build_object('lat', p_lat, 'lng', p_lng, 'acc', round(p_acc::numeric), 'loc', g->'loc', 'dist', g->'dist', 'outside', is_out, 'no_gps', p_lat is null);
  select * into a from public.attendance where staff_id = s.staff_id and day = d for update;
  if a.id is null then
    insert into public.attendance (staff_id, day, check_in, location_id, source, in_geo, outside)
    values (s.staff_id, d, now(), coalesce((g->>'loc')::smallint, s.device_location), 'gps', info, is_out) returning * into a;
    if is_out then insert into public.att_events (staff_id, kind, location_id, dist_m, acc_m, lat, lng) values (s.staff_id, 'in_out', (g->>'loc')::smallint, (g->>'dist')::int, round(p_acc)::int, p_lat, p_lng); end if;
    return jsonb_build_object('state','in','at',a.check_in,'outside',is_out,'dist',g->'dist','loc',g->'loc');
  elsif a.check_out is null then
    update public.attendance set check_out = now(), out_geo = info, outside = a.outside or is_out where id = a.id returning * into a;
    if is_out then insert into public.att_events (staff_id, kind, location_id, dist_m, acc_m, lat, lng) values (s.staff_id, 'out_out', (g->>'loc')::smallint, (g->>'dist')::int, round(p_acc)::int, p_lat, p_lng); end if;
    return jsonb_build_object('state','out','at',a.check_out,'since',a.check_in,'outside',is_out,'dist',g->'dist','loc',g->'loc');
  end if;
  raise exception 'ALREADY_OUT';
end $$;

-- while checked in with the system open: record leaving / coming back (only the changes)
create or replace function public.attend_ping(p_token text, p_lat double precision, p_lng double precision, p_acc double precision) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; a public.attendance; g jsonb; away boolean; last text;
begin
  s := public._session(p_token);
  select * into a from public.attendance where staff_id = s.staff_id and day = (now() at time zone 'Africa/Cairo')::date;
  if a.id is null or a.check_in is null or a.check_out is not null then return jsonb_build_object('tracking', false); end if;
  g := public._geo_place(s, p_lat, p_lng);
  if g is null or p_acc > 150 then return jsonb_build_object('tracking', true, 'skipped', true); end if;   -- no place points / too rough a fix
  away := (g->>'dist')::numeric > (g->>'radius')::numeric + least(coalesce(p_acc, 0), 100);
  select kind into last from public.att_events where staff_id = s.staff_id and kind in ('away','back') and at >= a.check_in order by at desc, id desc limit 1;
  if away and last is distinct from 'away' then
    insert into public.att_events (staff_id, kind, location_id, dist_m, acc_m, lat, lng) values (s.staff_id, 'away', (g->>'loc')::smallint, (g->>'dist')::int, round(p_acc)::int, p_lat, p_lng);
  elsif not away and last = 'away' then
    insert into public.att_events (staff_id, kind, location_id, dist_m, acc_m, lat, lng) values (s.staff_id, 'back', (g->>'loc')::smallint, (g->>'dist')::int, round(p_acc)::int, p_lat, p_lng);
  end if;
  return jsonb_build_object('tracking', true, 'away', away, 'dist', g->'dist');
end $$;

create or replace function public.att_events_list(p_token text, p_days int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._staff_right(s,'v');
  return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'staff',st.name,'staff_id',e.staff_id,'at',e.at,'kind',e.kind,'loc',e.location_id,'dist',e.dist_m,'acc',e.acc_m,'lat',e.lat,'lng',e.lng,'seen',e.seen_by is not null) order by e.at desc)
    from public.att_events e join public.staff st on st.id = e.staff_id where e.at > now() - make_interval(days => greatest(coalesce(p_days,7),1))), '[]'::jsonb);
end $$;

create or replace function public.att_events_seen(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._staff_right(s,'v');
  update public.att_events set seen_by = s.staff_id where seen_by is null;
end $$;

-- the place's point and distance (owner / GM)
create or replace function public.location_geo_set(p_token text, p_loc smallint, p_lat double precision, p_lng double precision, p_radius int) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; l public.locations;
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm') then raise exception 'NOT_ALLOWED:settings'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then raise exception 'BAD_VALUE'; end if;
  if coalesce(p_radius,150) not between 20 and 5000 then raise exception 'BAD_VALUE'; end if;
  update public.locations set lat = p_lat, lng = case when p_lat is null then null else p_lng end, radius_m = coalesce(p_radius,150) where id = p_loc returning * into l;
  if l.id is null then raise exception 'NOT_FOUND'; end if;
  perform public._audit(s,'مكان البصمة',l.name,null,coalesce(round(p_lat::numeric,5)::text || ',' || round(p_lng::numeric,5)::text || ' · ' || l.radius_m || 'م','اتشال'),null,l.id);
end $$;

-- ---------- the staff file ----------
create or replace function public.staff_file_get(p_token text, p_staff uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; st public.staff;
begin
  s := public._session(p_token);
  if s.staff_id is distinct from p_staff then perform public._staff_right(s,'v'); end if;
  select * into st from public.staff where id = p_staff;
  if st.id is null then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('id', st.id, 'name', st.name, 'role_id', st.role_id, 'location_id', st.location_id, 'active', st.active, 'created_at', st.created_at,
    'phone', st.phone, 'birth_date', st.birth_date, 'hire_date', st.hire_date, 'national_id', st.national_id, 'address', st.address, 'emergency', st.emergency,
    'job_title', st.job_title, 'hr_notes', case when s.role_id in ('owner','gm') or public._can(s.role_id,'staff','e') then st.hr_notes end, 'photo', st.photo_path is not null,
    'docs', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'mime', d.mime, 'bytes', d.bytes, 'at', d.created_at, 'by', (select name from public.staff where id = d.uploaded_by)) order by d.created_at desc)
                      from public.staff_docs d where d.staff_id = st.id), '[]'::jsonb));
end $$;

create or replace function public.staff_file_save(p_token text, p_staff uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; st public.staff;
begin
  s := public._session(p_token); perform public._staff_right(s,'e');
  select * into st from public.staff where id = p_staff for update;
  if st.id is null then raise exception 'NOT_FOUND'; end if;
  if st.role_id = 'owner' and s.role_id <> 'owner' then raise exception 'NOT_ALLOWED:staff'; end if;
  update public.staff set phone = nullif(trim(p->>'phone'),''), birth_date = nullif(p->>'birth_date','')::date, hire_date = nullif(p->>'hire_date','')::date,
    national_id = nullif(trim(p->>'national_id'),''), address = nullif(trim(p->>'address'),''), emergency = nullif(trim(p->>'emergency'),''),
    job_title = nullif(trim(p->>'job_title'),''), hr_notes = nullif(trim(p->>'hr_notes'),'') where id = st.id;
  perform public._audit(s,'ملف موظف',st.name,null,null,null,null);
end $$;

-- the files server function asks this before any upload / open / delete; it answers with the storage path to use
create or replace function public.staff_file_check(p_token text, p_staff uuid, p_action text, p_doc bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; st public.staff; d public.staff_docs;
begin
  s := public._session(p_token);
  select * into st from public.staff where id = p_staff;
  if st.id is null then raise exception 'NOT_FOUND'; end if;
  if p_action in ('open','photo_get') then
    if s.staff_id is distinct from p_staff then perform public._staff_right(s,'v'); end if;
  else
    perform public._staff_right(s,'e');
    if st.role_id = 'owner' and s.role_id <> 'owner' then raise exception 'NOT_ALLOWED:staff'; end if;
  end if;
  if p_doc is not null then
    select * into d from public.staff_docs where id = p_doc and staff_id = p_staff;
    if d.id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return jsonb_build_object('actor', s.staff_id, 'actor_name', s.staff_name, 'staff_name', st.name, 'photo_path', st.photo_path, 'doc_path', d.path, 'doc_title', d.title);
end $$;

revoke execute on function public._geo_m(double precision, double precision, double precision, double precision), public._geo_place(public.sess, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.attend_punch_geo(text, double precision, double precision, double precision), public.attend_ping(text, double precision, double precision, double precision),
  public.att_events_list(text, int), public.att_events_seen(text), public.location_geo_set(text, smallint, double precision, double precision, int),
  public.staff_file_get(text, uuid), public.staff_file_save(text, uuid, jsonb), public.staff_file_check(text, uuid, text, bigint) from public, anon;
grant execute on function public.attend_punch_geo(text, double precision, double precision, double precision), public.attend_ping(text, double precision, double precision, double precision),
  public.att_events_list(text, int), public.att_events_seen(text), public.location_geo_set(text, smallint, double precision, double precision, int),
  public.staff_file_get(text, uuid), public.staff_file_save(text, uuid, jsonb), public.staff_file_check(text, uuid, text, bigint) to authenticated;
