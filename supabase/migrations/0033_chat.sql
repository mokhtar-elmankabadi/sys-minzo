-- 0033 · internal chat (owner's choices)
-- · a room for every branch/place (its staff + owner + GM; staff with «all places» are in every place room),
--   an admin room (owner, GM, branch managers, accountant, storekeeper), and private messages between any two staff.
-- · owner and GM read everything, except: the GM does not see the owner's private conversations.
-- · each message shows the sender's name and role only.
-- · the sender can delete a message within 5 minutes; others then see «deleted», owner / GM still see what it said.
-- · voice notes up to 2 minutes, removed after 30 days; photos (made smaller on the phone) removed after 45 days.
--   the text of the message stays. Files are stored privately and reached only through the minzo-files function.

create table if not exists public.chat_msgs (
  id bigserial primary key,
  room text not null check (room ~ '^(admin|loc:[0-9]+|dm:[0-9a-f-]{36}:[0-9a-f-]{36})$'),
  sender uuid not null references public.staff(id),
  kind text not null default 'text' check (kind in ('text','image','voice')),
  body text check (char_length(body) <= 2000),
  path text unique,
  mime text,
  bytes int,
  dur_s int check (dur_s between 0 and 121),
  at timestamptz not null default now(),
  deleted_at timestamptz,
  media_gone_at timestamptz,
  check (kind = 'text' and body is not null and path is null or kind <> 'text' and path is not null)
);
create index if not exists chat_msgs_room on public.chat_msgs (room, id desc);
create index if not exists chat_msgs_media on public.chat_msgs (at) where path is not null and media_gone_at is null;

create table if not exists public.chat_reads (
  staff_id uuid not null references public.staff(id) on delete cascade,
  room text not null,
  last_id bigint not null default 0,
  primary key (staff_id, room)
);

do $$ declare t text; begin
  foreach t in array array['chat_msgs','chat_reads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

-- what this person may do in a room: 'rw' (member), 'r' (review only), null (nothing)
create or replace function public._chat_access(s public.sess, p_room text) returns text
language plpgsql stable security definer set search_path = public as $$
declare a uuid; b uuid; loc smallint;
begin
  if p_room is null then return null; end if;
  if p_room = 'admin' then
    return case when s.role_id in ('owner','gm','mgr','acct','keeper') then 'rw' end;
  elsif p_room ~ '^loc:[0-9]+$' then
    loc := substr(p_room, 5)::smallint;
    if not exists (select 1 from public.locations where id = loc and active) then return null; end if;
    if s.role_id in ('owner','gm') or s.location_id is null or s.location_id = loc then return 'rw'; end if;
    return null;
  elsif p_room ~ '^dm:[0-9a-f-]{36}:[0-9a-f-]{36}$' then
    a := split_part(p_room, ':', 2)::uuid; b := split_part(p_room, ':', 3)::uuid;
    if a >= b then return null; end if;
    if s.staff_id in (a, b) then
      if not exists (select 1 from public.staff where id = case when s.staff_id = a then b else a end) then return null; end if;
      return 'rw';
    end if;
    if s.role_id = 'owner' then return 'r'; end if;
    if s.role_id = 'gm' and not exists (select 1 from public.staff where id in (a, b) and role_id = 'owner') then return 'r'; end if;
    return null;
  end if;
  return null;
end $$;

-- rooms this person is a member of (for the list and unread count)
create or replace function public._chat_my_rooms(s public.sess) returns setof text
language sql stable security definer set search_path = public as $$
  select 'admin' where s.role_id in ('owner','gm','mgr','acct','keeper')
  union all
  select 'loc:' || id from public.locations where active and (s.role_id in ('owner','gm') or s.location_id is null or s.location_id = id)
  union all
  select distinct room from public.chat_msgs where room like 'dm:%' and (split_part(room, ':', 2) = s.staff_id::text or split_part(room, ':', 3) = s.staff_id::text)
$$;

create or replace function public._chat_name(s public.sess, p_room text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_room = 'admin' then 'الإدارة'
    when p_room like 'loc:%' then (select name from public.locations where id = substr(p_room, 5)::smallint)
    else (select string_agg(st.name, ' · ' order by st.name) from public.staff st
           where st.id::text in (split_part(p_room, ':', 2), split_part(p_room, ':', 3)) and (st.id <> s.staff_id or not (s.staff_id::text in (split_part(p_room, ':', 2), split_part(p_room, ':', 3)))))
  end
$$;

create or replace function public.chat_rooms(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; mine jsonb; others jsonb := '[]'::jsonb;
begin
  s := public._session(p_token);
  select coalesce(jsonb_agg(x order by x->>'sort', (x->>'last_at')::timestamptz desc nulls last), '[]'::jsonb) into mine from (
    select jsonb_build_object('room', r.room, 'name', public._chat_name(s, r.room),
      'kind', case when r.room = 'admin' then 'admin' when r.room like 'loc:%' then 'loc' else 'dm' end,
      'sort', case when r.room = 'admin' then '0' when r.room like 'loc:%' then '1' || lpad(substr(r.room, 5), 6, '0') else '2' end,
      'other', case when r.room like 'dm:%' then (select jsonb_build_object('id', st.id, 'role', ro.name, 'active', st.active) from public.staff st join public.roles ro on ro.id = st.role_id
                                                   where st.id::text in (split_part(r.room, ':', 2), split_part(r.room, ':', 3)) and st.id <> s.staff_id) end,
      'last_at', l.at, 'last', case when l.id is null then null when l.deleted_at is not null then 'رسالة اتمسحت' when l.kind = 'image' then '📷 صورة' when l.kind = 'voice' then '🎤 فويس' else left(l.body, 80) end,
      'last_by', (select name from public.staff where id = l.sender),
      'unread', (select count(*) from public.chat_msgs m where m.room = r.room and m.id > coalesce(rd.last_id, 0) and m.sender <> s.staff_id and m.deleted_at is null and m.at > now() - interval '60 days')) x
    from public._chat_my_rooms(s) r(room)
    left join lateral (select * from public.chat_msgs m where m.room = r.room order by m.id desc limit 1) l on true
    left join public.chat_reads rd on rd.staff_id = s.staff_id and rd.room = r.room) q;
  if s.role_id in ('owner','gm') then
    select coalesce(jsonb_agg(jsonb_build_object('room', room, 'name', public._chat_name(s, room), 'last_at', last_at, 'n', n) order by last_at desc), '[]'::jsonb) into others
      from (select room, max(at) last_at, count(*) n from public.chat_msgs
             where room like 'dm:%' and split_part(room, ':', 2) <> s.staff_id::text and split_part(room, ':', 3) <> s.staff_id::text
             group by room) d
     where public._chat_access(s, room) = 'r';
  end if;
  return jsonb_build_object('rooms', mine, 'others', others, 'me', s.staff_id);
end $$;

create or replace function public.chat_people(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'role', ro.name, 'room', 'dm:' || least(st.id, s.staff_id) || ':' || greatest(st.id, s.staff_id)) order by st.name)
    from public.staff st join public.roles ro on ro.id = st.role_id where st.active and st.id <> s.staff_id), '[]'::jsonb);
end $$;

-- messages of a room: the newest 80, or older than p_before, or newer than p_after (polling). Marks them read.
create or replace function public.chat_msgs(p_token text, p_room text, p_after bigint, p_before bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; acc text; top boolean; res jsonb; mx bigint;
begin
  s := public._session(p_token);
  acc := public._chat_access(s, p_room);
  if acc is null then raise exception 'NOT_ALLOWED:chat'; end if;
  top := s.role_id in ('owner','gm');
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'by', m.sender, 'name', st.name, 'role', ro.name, 'kind', m.kind,
      'body', case when m.deleted_at is null or top then m.body end, 'deleted', m.deleted_at is not null,
      'media', m.path is not null and m.media_gone_at is null and (m.deleted_at is null or top), 'gone', m.media_gone_at is not null,
      'dur', m.dur_s, 'at', m.at, 'mine', m.sender = s.staff_id) order by m.id), '[]'::jsonb), max(m.id)
    into res, mx
    from (select * from public.chat_msgs where room = p_room
            and (p_after is null or id > p_after) and (p_before is null or id < p_before)
          order by id desc limit 80) m
    join public.staff st on st.id = m.sender join public.roles ro on ro.id = st.role_id;
  if mx is not null and p_before is null then
    insert into public.chat_reads (staff_id, room, last_id) values (s.staff_id, p_room, mx)
    on conflict (staff_id, room) do update set last_id = greatest(public.chat_reads.last_id, excluded.last_id);
  end if;
  return jsonb_build_object('access', acc, 'msgs', res);
end $$;

-- too many messages in a minute → refuse (protects the free plan)
create or replace function public._chat_can_send(s public.sess, p_room text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public._chat_access(s, p_room) is distinct from 'rw' then raise exception 'NOT_ALLOWED:chat'; end if;
  if p_room like 'dm:%' and exists (select 1 from public.staff where id::text in (split_part(p_room, ':', 2), split_part(p_room, ':', 3)) and not active) then raise exception 'NOT_ALLOWED:chat'; end if;
  if (select count(*) from public.chat_msgs where sender = s.staff_id and at > now() - interval '1 minute') >= 30 then raise exception 'TOO_FAST'; end if;
end $$;

create or replace function public.chat_send(p_token text, p_room text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; b text := btrim(coalesce(p_body, '')); i bigint;
begin
  s := public._session(p_token);
  perform public._chat_can_send(s, p_room);
  if b = '' then raise exception 'NAME_REQUIRED'; end if;
  if char_length(b) > 2000 then raise exception 'BAD_VALUE'; end if;
  insert into public.chat_msgs (room, sender, kind, body) values (p_room, s.staff_id, 'text', b) returning id into i;
  return jsonb_build_object('id', i);
end $$;

create or replace function public.chat_delete(p_token text, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; m public.chat_msgs;
begin
  s := public._session(p_token);
  select * into m from public.chat_msgs where id = p_id for update;
  if m.id is null or m.sender <> s.staff_id then raise exception 'NOT_ALLOWED:chat'; end if;
  if m.deleted_at is not null then return; end if;
  if m.at < now() - interval '5 minutes' then raise exception 'CHAT_DELETE_LATE'; end if;
  update public.chat_msgs set deleted_at = now() where id = m.id;
end $$;

create or replace function public.chat_unread(p_token text) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  return (select count(*) from public._chat_my_rooms(s) r(room)
            join public.chat_msgs m on m.room = r.room
            left join public.chat_reads rd on rd.staff_id = s.staff_id and rd.room = r.room
           where m.id > coalesce(rd.last_id, 0) and m.sender <> s.staff_id and m.deleted_at is null and m.at > now() - interval '60 days');
end $$;

-- asked by the minzo-files function: may this person upload to the room (p_ids null),
-- or which of these messages' files may they open (returns {id: path})
create or replace function public.chat_file_check(p_token text, p_room text, p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; acc text;
begin
  s := public._session(p_token);
  if p_ids is null then
    perform public._chat_can_send(s, p_room);
    return jsonb_build_object('actor', s.staff_id);
  end if;
  acc := public._chat_access(s, p_room);
  if acc is null then raise exception 'NOT_ALLOWED:chat'; end if;
  return jsonb_build_object('paths', coalesce((select jsonb_object_agg(id::text, path) from public.chat_msgs
    where room = p_room and id = any(p_ids[1:60]) and path is not null and media_gone_at is null
      and (deleted_at is null or s.role_id in ('owner','gm'))), '{}'::jsonb));
end $$;

-- for the minzo-files function only: files past their time (voice 30 days, photos 45 days)
create or replace function public._chat_expired(p_limit int) returns table (id bigint, path text)
language sql stable security definer set search_path = public as $$
  select id, path from public.chat_msgs
   where path is not null and media_gone_at is null
     and ((kind = 'voice' and at < now() - interval '30 days') or (kind = 'image' and at < now() - interval '45 days'))
   order by at limit greatest(coalesce(p_limit, 50), 1)
$$;

revoke execute on function public._chat_access(public.sess, text), public._chat_my_rooms(public.sess), public._chat_name(public.sess, text),
  public._chat_can_send(public.sess, text), public._chat_expired(int) from public, anon, authenticated;
grant execute on function public._chat_expired(int) to service_role;
revoke execute on function public.chat_rooms(text), public.chat_people(text), public.chat_msgs(text, text, bigint, bigint), public.chat_send(text, text, text),
  public.chat_delete(text, bigint), public.chat_unread(text), public.chat_file_check(text, text, bigint[]) from public, anon;
grant execute on function public.chat_rooms(text), public.chat_people(text), public.chat_msgs(text, text, bigint, bigint), public.chat_send(text, text, text),
  public.chat_delete(text, bigint), public.chat_unread(text), public.chat_file_check(text, text, bigint[]) to authenticated;
