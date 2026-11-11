-- 0031 · stock count (جرد) and purchase suggestions (owner's choices)
-- · The owner / GM (or whoever may adjust stock) starts a count for one place and picks the staff who count; only they
--   (and the owner / GM) see the counting screen, until it is ended.
-- · Counting is blind: staff never see the system quantity, only what they themselves entered.
-- · Several staff may count the same item in different spots; the review lists those items with who / how many / when,
--   and nothing is added up for them until the owner decides.
-- · Selling and transfers go on during the count: for each item, everything that moved after its last count is added back,
--   so the comparison is made at the moment it was counted.
-- · «Recount the differences» opens a new round for the items with a difference only.
-- · Nothing changes in stock until the owner approves; the shortage / excess is posted at cost.

create sequence if not exists public.stocktake_no_seq;
create table if not exists public.stocktakes (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  location_id smallint not null references public.locations(id),
  status text not null default 'open' check (status in ('open','review','posted','cancelled')),
  round int not null default 1,
  recount uuid[],
  note text,
  started_by uuid references public.staff(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  posted_by uuid references public.staff(id),
  posted_at timestamptz,
  result jsonb
);
create unique index if not exists stocktakes_one_open on public.stocktakes (location_id) where status in ('open','review');
create table if not exists public.stocktake_staff (
  stocktake_id uuid not null references public.stocktakes(id) on delete cascade,
  staff_id uuid not null references public.staff(id),
  primary key (stocktake_id, staff_id)
);
create table if not exists public.stocktake_counts (
  id bigserial primary key,
  stocktake_id uuid not null references public.stocktakes(id) on delete cascade,
  item_id uuid not null references public.items(id),
  staff_id uuid references public.staff(id),
  qty numeric(12,3) not null check (qty >= 0),
  round int not null default 1,
  counted_at timestamptz not null default now()
);
create index if not exists stocktake_counts_st on public.stocktake_counts (stocktake_id, item_id);
do $$ declare t text; begin
  foreach t in array array['stocktakes','stocktake_staff','stocktake_counts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

-- the count's own adjustments may take reserved items too
create or replace function public._reserved(p_item uuid, p_loc smallint) returns numeric
language sql stable security definer set search_path = public as $$
  select case when current_setting('mz.skipres', true) = '1' then 0 else
    coalesce((select sum(rl.qty) from public.reservation_lines rl join public.reservations r on r.id = rl.reservation_id
     where r.status = 'open' and r.location_id = p_loc and rl.item_id = p_item
       and r.id::text is distinct from nullif(current_setting('mz.res', true), '')), 0) end
$$;

create or replace function public._st_manager(s public.sess) returns boolean
language sql stable security definer set search_path = public as $$
  select s.role_id in ('owner','gm') or public._can(s.role_id,'stock','a')
$$;
create or replace function public._st_counter(s public.sess, p_st uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select s.role_id in ('owner','gm') or exists (select 1 from public.stocktake_staff where stocktake_id = p_st and staff_id = s.staff_id)
$$;

create or replace function public.stocktake_start(p_token text, p_loc smallint, p_staff_j jsonb, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sid uuid; no text; u uuid; p_staff uuid[] := (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(coalesce(p_staff_j,'[]')) x);
begin
  s := public._session(p_token);
  if not public._st_manager(s) then raise exception 'NOT_ALLOWED:stock'; end if;
  if not public._loc_ok(s, p_loc) then raise exception 'OUT_OF_SCOPE'; end if;
  if coalesce(cardinality(p_staff),0) = 0 then raise exception 'STAFF_REQUIRED'; end if;
  if exists (select 1 from public.stocktakes where location_id = p_loc and status in ('open','review')) then raise exception 'COUNT_RUNNING'; end if;
  no := 'ST-' || lpad(nextval('public.stocktake_no_seq')::text, 4, '0');
  insert into public.stocktakes (no, location_id, note, started_by) values (no, p_loc, nullif(trim(p_note),''), s.staff_id) returning id into sid;
  foreach u in array p_staff loop
    if exists (select 1 from public.staff where id = u and active) then insert into public.stocktake_staff values (sid, u) on conflict do nothing; end if;
  end loop;
  perform public._audit(s,'بدء جرد',no,null,(select string_agg(name, '، ') from public.staff where id = any(p_staff)),p_note,p_loc);
  return jsonb_build_object('id', sid, 'no', no);
end $$;

-- open counts this person may count in (for the menu and the counting screen); never any quantity
create or replace function public.stocktake_my(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'no',t.no,'loc',t.location_id,'status',t.status,'round',t.round,
      'recount', case when t.round > 1 then (select jsonb_agg(i.id) from public.items i where i.id = any(t.recount)) end) order by t.started_at)
    from public.stocktakes t where t.status = 'open' and public._st_counter(s, t.id)), '[]'::jsonb);
end $$;

create or replace function public.stocktake_count(p_token text, p_st uuid, p_item uuid, p_qty numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; t public.stocktakes; it public.items; cid bigint;
begin
  s := public._session(p_token);
  select * into t from public.stocktakes where id = p_st;
  if t.id is null or t.status <> 'open' then raise exception 'COUNT_CLOSED'; end if;
  if not public._st_counter(s, t.id) then raise exception 'NOT_ALLOWED:stock'; end if;
  if p_qty is null or p_qty < 0 or p_qty > 100000 then raise exception 'BAD_QTY'; end if;
  select * into it from public.items where id = p_item;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if t.round > 1 and not (p_item = any(coalesce(t.recount, '{}'))) then raise exception 'NOT_IN_RECOUNT'; end if;
  insert into public.stocktake_counts (stocktake_id, item_id, staff_id, qty, round) values (t.id, it.id, s.staff_id, p_qty, t.round) returning id into cid;
  return jsonb_build_object('id', cid, 'item', it.name, 'mine', (select sum(qty) from public.stocktake_counts where stocktake_id = t.id and item_id = it.id and staff_id = s.staff_id and round = t.round));
end $$;

create or replace function public.stocktake_my_entries(p_token text, p_st uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; t public.stocktakes;
begin
  s := public._session(p_token);
  select * into t from public.stocktakes where id = p_st;
  if t.id is null or not public._st_counter(s, t.id) then raise exception 'NOT_ALLOWED:stock'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'item_id',c.item_id,'qty',c.qty,'at',c.counted_at) order by c.counted_at desc)
    from public.stocktake_counts c where c.stocktake_id = t.id and c.staff_id = s.staff_id and c.round = t.round), '[]'::jsonb);
end $$;

create or replace function public.stocktake_entry_delete(p_token text, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; c public.stocktake_counts; t public.stocktakes;
begin
  s := public._session(p_token);
  select * into c from public.stocktake_counts where id = p_id;
  select * into t from public.stocktakes where id = c.stocktake_id;
  if c.id is null or t.status <> 'open' then raise exception 'COUNT_CLOSED'; end if;
  if c.staff_id is distinct from s.staff_id and s.role_id not in ('owner','gm') then raise exception 'NOT_ALLOWED:stock'; end if;
  delete from public.stocktake_counts where id = p_id;
end $$;

-- the comparison, item by item (latest round wins for recounted items)
create or replace function public._st_calc(p_st uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.stocktakes;
begin
  select * into t from public.stocktakes where id = p_st;
  return coalesce((
    with c as (
      select c.*, max(c.round) over (partition by c.item_id) as last_round from public.stocktake_counts c where c.stocktake_id = t.id),
    cur as (select * from c where round = last_round),
    per as (
      select item_id, sum(qty) counted, max(counted_at) last_at, count(distinct staff_id) staff_n,
             jsonb_agg(jsonb_build_object('staff', (select name from public.staff where id = cur.staff_id), 'qty', qty, 'at', counted_at) order by counted_at) entries,
             (select jsonb_agg(x) from (select (select name from public.staff where id = c2.staff_id) staff, sum(c2.qty) qty from cur c2 where c2.item_id = cur.item_id group by c2.staff_id) x) by_staff
        from cur group by item_id),
    items as (
      select i.id, i.name, i.code, i.unit, i.serial_required, i.last_cost from public.items i
       where i.id in (select item_id from per)
          or (exists (select 1 from public.stock st where st.item_id = i.id and st.location_id = t.location_id and st.qty <> 0) and not exists (select 1 from public.item_kits k where k.kit_id = i.id)))
    select jsonb_agg(jsonb_build_object('item_id', it.id, 'name', it.name, 'code', it.code, 'unit', it.unit, 'serial', it.serial_required,
        'counted', p.counted, 'staff_n', coalesce(p.staff_n, 0), 'entries', p.entries, 'by_staff', p.by_staff, 'last_at', p.last_at,
        'now', coalesce((select qty from public.stock where item_id = it.id and location_id = t.location_id), 0),
        'after', coalesce((select sum(m.qty) from public.stock_moves m where m.item_id = it.id and m.location_id = t.location_id
                            and m.created_at > coalesce(p.last_at, now()) and m.ref_type is distinct from 'stocktake'), 0),
        'cost', coalesce((select sum(l.qty_left * l.unit_cost) / nullif(sum(l.qty_left), 0) from public.stock_layers l where l.item_id = it.id and l.location_id = t.location_id and l.qty_left > 0), it.last_cost, 0))
      order by it.name)
    from items it left join per p on p.item_id = it.id), '[]'::jsonb);
end $$;

create or replace function public.stocktake_review(p_token text, p_st uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; t public.stocktakes;
begin
  s := public._session(p_token);
  if not public._st_manager(s) then raise exception 'NOT_ALLOWED:stock'; end if;
  select * into t from public.stocktakes where id = p_st;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('stocktake', to_jsonb(t) || jsonb_build_object('staff', (select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name)) from public.stocktake_staff x join public.staff st on st.id = x.staff_id where x.stocktake_id = t.id)),
    'entries_n', (select count(*) from public.stocktake_counts where stocktake_id = t.id),
    'lines', case when t.status = 'posted' then t.result else public._st_calc(t.id) end);
end $$;

create or replace function public.stocktakes_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if not public._st_manager(s) then raise exception 'NOT_ALLOWED:stock'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'no',t.no,'loc',t.location_id,'status',t.status,'round',t.round,'started_at',t.started_at,'ended_at',t.ended_at,'posted_at',t.posted_at,
      'by',(select name from public.staff where id = t.started_by),'entries',(select count(*) from public.stocktake_counts where stocktake_id = t.id),
      'items',(select count(distinct item_id) from public.stocktake_counts where stocktake_id = t.id),
      'counters',(select jsonb_agg(st.name) from public.stocktake_staff x join public.staff st on st.id = x.staff_id where x.stocktake_id = t.id),
      'short_value',(select coalesce(sum((r->>'value')::numeric) filter (where (r->>'value')::numeric < 0), 0) from jsonb_array_elements(coalesce(t.result,'[]')) r),
      'over_value',(select coalesce(sum((r->>'value')::numeric) filter (where (r->>'value')::numeric > 0), 0) from jsonb_array_elements(coalesce(t.result,'[]')) r))
      order by t.started_at desc)
    from public.stocktakes t where public._loc_ok(s, t.location_id)), '[]'::jsonb);
end $$;

-- end counting (→ review), reopen, recount the differences, cancel
create or replace function public.stocktake_set(p_token text, p_st uuid, p_action text, p_items_j jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; t public.stocktakes; p_items uuid[] := (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_items_j,'[]')) x);
begin
  s := public._session(p_token);
  if not public._st_manager(s) then raise exception 'NOT_ALLOWED:stock'; end if;
  select * into t from public.stocktakes where id = p_st for update;
  if t.id is null or t.status not in ('open','review') then raise exception 'COUNT_CLOSED'; end if;
  if p_action = 'end' then update public.stocktakes set status = 'review', ended_at = now() where id = t.id;
  elsif p_action = 'reopen' then update public.stocktakes set status = 'open' where id = t.id;
  elsif p_action = 'recount' then
    if coalesce(cardinality(p_items),0) = 0 then raise exception 'NOTHING_TO_RECOUNT'; end if;
    update public.stocktakes set status = 'open', round = t.round + 1, recount = p_items where id = t.id;
  elsif p_action = 'cancel' then update public.stocktakes set status = 'cancelled', ended_at = now() where id = t.id;
  else raise exception 'BAD_VALUE'; end if;
  perform public._audit(s, case p_action when 'end' then 'إنهاء العدّ' when 'reopen' then 'إعادة فتح الجرد' when 'recount' then 'إعادة عدّ الفروق' else 'إلغاء الجرد' end, t.no, null,
    case when p_action = 'recount' then cardinality(p_items)::text || ' صنف' end, null, t.location_id);
end $$;

-- approve: p_dec = {item_id: 'sum'|'max'|'zero'|'skip'} — items counted by several staff and items not counted at all need a decision
create or replace function public.stocktake_post(p_token text, p_st uuid, p_dec jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; t public.stocktakes; r jsonb; res jsonb := '[]'; dec text; counted numeric; expected numeric; var numeric; cst numeric; have numeric; out_c numeric;
        short numeric := 0; over numeric := 0; n int := 0;
begin
  s := public._session(p_token);
  if not public._st_manager(s) then raise exception 'NOT_ALLOWED:stock'; end if;
  select * into t from public.stocktakes where id = p_st for update;
  if t.id is null or t.status <> 'review' then raise exception 'COUNT_NOT_ENDED'; end if;
  perform set_config('mz.skipres', '1', true);
  for r in select * from jsonb_array_elements(public._st_calc(t.id)) loop
    dec := coalesce(p_dec->>(r->>'item_id'), case when r->>'counted' is null then 'skip' when (r->>'staff_n')::int > 1 then null else 'sum' end);
    if dec is null then raise exception 'DECISION_REQUIRED:%', r->>'name'; end if;
    counted := case dec when 'sum' then (r->>'counted')::numeric
                        when 'max' then (select max((x->>'qty')::numeric) from jsonb_array_elements(r->'by_staff') x)
                        when 'zero' then 0 else null end;
    expected := (r->>'now')::numeric - (r->>'after')::numeric;
    var := case when counted is null or coalesce((r->>'serial')::boolean, false) then 0 else counted - expected end;
    cst := (r->>'cost')::numeric;
    if var > 0 then
      perform public._fifo_in((r->>'item_id')::uuid, t.location_id, var, cst, t.no);
      insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values ((r->>'item_id')::uuid, t.location_id, var, round(var * cst, 2), 'adjust', 'stocktake', t.no, s.staff_id);
      over := over + round(var * cst, 2); n := n + 1;
    elsif var < 0 then
      have := coalesce((select sum(qty_left) from public.stock_layers where item_id = (r->>'item_id')::uuid and location_id = t.location_id and qty_left > 0), 0);
      var := -least(-var, have);
      if var < 0 then
        out_c := public._fifo_out((r->>'item_id')::uuid, t.location_id, -var);
        insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values ((r->>'item_id')::uuid, t.location_id, var, out_c, 'adjust', 'stocktake', t.no, s.staff_id);
        short := short - out_c; cst := out_c / -var; n := n + 1;
      end if;
    end if;
    res := res || (r || jsonb_build_object('decision', dec, 'used', counted, 'expected', expected, 'variance', var, 'value', round(var * cst, 2)));
  end loop;
  update public.stocktakes set status = 'posted', posted_by = s.staff_id, posted_at = now(), result = res where id = t.id;
  perform public._audit(s,'اعتماد جرد',t.no,null,'زيادة ' || over::text || ' · عجز ' || short::text,null,t.location_id);
  return jsonb_build_object('no', t.no, 'adjusted', n, 'over', over, 'short', short);
end $$;

-- ---------- purchase suggestions ----------
-- per item: sales per day over the last p_window days → enough for p_cover days + the minimum, minus what is in stock
create or replace function public.purchase_suggest(p_token text, p_cover int, p_window int, p_loc smallint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; cover int := greatest(coalesce(p_cover,30),1); win int := greatest(coalesce(p_window,60),7);
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'suppliers','v') or public._can(s.role_id,'stock','a')) then raise exception 'NOT_ALLOWED:suppliers'; end if;
  return coalesce((
    with sold as (
      select m.item_id, -coalesce(sum(m.qty) filter (where m.kind = 'sale'), 0) - coalesce(sum(m.qty) filter (where m.kind in ('return','void')), 0) q
        from public.stock_moves m where m.created_at > now() - make_interval(days => win) and m.kind in ('sale','return','void')
         and (p_loc is null or m.location_id = p_loc) group by m.item_id),
    last_buy as (
      select distinct on (pl.item_id) pl.item_id, pi.supplier_id, pl.unit_cost, pi.inv_date
        from public.purchase_lines pl join public.purchase_invoices pi on pi.id = pl.invoice_id order by pl.item_id, pi.inv_date desc, pi.created_at desc)
    select jsonb_agg(x order by x->>'supplier' nulls last, (x->>'suggest')::numeric desc) from (
      select jsonb_build_object('item_id', i.id, 'name', i.name, 'code', i.code, 'unit', i.unit, 'min', i.min_qty,
        'stock', st.q, 'sold', round(coalesce(sd.q,0), 1), 'per_day', round(coalesce(sd.q,0) / win, 2),
        'days_left', case when coalesce(sd.q,0) > 0 then round(st.q / (sd.q / win), 0) end,
        'suggest', greatest(ceil(coalesce(sd.q,0) / win * cover + i.min_qty - st.q), 0),
        'supplier_id', lb.supplier_id, 'supplier', (select name from public.suppliers where id = lb.supplier_id), 'last_cost', coalesce(lb.unit_cost, i.last_cost), 'last_buy', lb.inv_date) x
      from public.items i
      cross join lateral (select coalesce(sum(qty),0) q from public.stock where item_id = i.id and (p_loc is null or location_id = p_loc)) st
      left join sold sd on sd.item_id = i.id left join last_buy lb on lb.item_id = i.id
      where not i.hidden and not exists (select 1 from public.item_kits k where k.kit_id = i.id)
        and (coalesce(sd.q,0) > 0 or i.min_qty > 0)
        and greatest(ceil(coalesce(sd.q,0) / win * cover + i.min_qty - st.q), 0) > 0) y), '[]'::jsonb);
end $$;

revoke execute on function public._st_manager(public.sess), public._st_counter(public.sess, uuid), public._st_calc(uuid) from public, anon, authenticated;
revoke execute on function public.stocktake_start(text, smallint, jsonb, text), public.stocktake_my(text), public.stocktake_count(text, uuid, uuid, numeric),
  public.stocktake_my_entries(text, uuid), public.stocktake_entry_delete(text, bigint), public.stocktake_review(text, uuid), public.stocktakes_list(text),
  public.stocktake_set(text, uuid, text, jsonb), public.stocktake_post(text, uuid, jsonb), public.purchase_suggest(text, int, int, smallint) from public, anon;
grant execute on function public.stocktake_start(text, smallint, jsonb, text), public.stocktake_my(text), public.stocktake_count(text, uuid, uuid, numeric),
  public.stocktake_my_entries(text, uuid), public.stocktake_entry_delete(text, bigint), public.stocktake_review(text, uuid), public.stocktakes_list(text),
  public.stocktake_set(text, uuid, text, jsonb), public.stocktake_post(text, uuid, jsonb), public.purchase_suggest(text, int, int, smallint) to authenticated;
