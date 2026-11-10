-- 0029 · items & sets (owner's choices)
-- 1) extra codes: a Chinese / supplier code (or more) next to the item's own code; any of them finds the item when searching or selling.
-- 2) automatic code by group, numbers only: <department 2 digits><group 2 digits>-<serial 4 digits>, e.g. 0103-0007.
-- 3) sets (أطقم): a set item made of pieces.
--    · open set: no own stock — selling it takes the pieces at that moment;
--    · closed set (packed in a carton): «assemble» takes the pieces and adds sets; «take apart» does the reverse.
--    Selling a set uses the packed sets first, then builds the rest from pieces.
-- 4) swapping an item from an invoice (for a piece inside an offer): the old piece comes back at its offer price and the new
--    piece goes out; the price either stays as in the offer, or the customer pays — or gets back — the difference.

-- ---------- 1) extra codes ----------
create table if not exists public.item_codes (
  code text primary key,
  item_id uuid not null references public.items(id) on delete cascade,
  kind text not null default 'cn' check (kind in ('cn','alt')),
  created_at timestamptz not null default now()
);
create index if not exists item_codes_item on public.item_codes (item_id);
alter table public.item_codes enable row level security;
drop policy if exists "role read" on public.item_codes;
create policy "role read" on public.item_codes for select to authenticated using ((select public._r_any()));
revoke all on public.item_codes from anon;
revoke insert, update, delete, truncate on public.item_codes from authenticated;

create or replace function public._code_taken(p_code text, p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.items where (code = p_code or barcode = p_code) and id is distinct from p_item)
      or exists (select 1 from public.item_codes where code = p_code and item_id is distinct from p_item)
$$;

-- an item's own code / barcode may not be another item's extra code
create or replace function public._items_code_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.item_codes c where c.code in (new.code, coalesce(new.barcode, new.code)) and c.item_id <> new.id) then
    raise exception 'CODE_TAKEN:%', new.code;
  end if;
  return new;
end $$;
drop trigger if exists items_code_guard on public.items;
create trigger items_code_guard before insert or update of code, barcode on public.items for each row execute function public._items_code_guard();

create or replace function public.item_codes_set(p_token text, p_item uuid, p_codes jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; c text; n int := 0; it public.items;
begin
  s := public._session(p_token);
  if not (public._can(s.role_id,'items','e') or public._can(s.role_id,'items','a')) then raise exception 'NOT_ALLOWED:items'; end if;
  select * into it from public.items where id = p_item;
  if it.id is null then raise exception 'NOT_FOUND'; end if;
  delete from public.item_codes where item_id = p_item;
  for c in select distinct trim(x) from jsonb_array_elements_text(coalesce(p_codes,'[]')) x where trim(x) <> '' loop
    if length(c) > 40 then raise exception 'BAD_VALUE'; end if;
    if public._code_taken(c, p_item) then raise exception 'CODE_TAKEN:%', c; end if;
    insert into public.item_codes (code, item_id, kind) values (c, p_item, 'cn'); n := n + 1;
  end loop;
  perform public._audit(s,'أكواد الصنف',it.name,null,(select string_agg(code, '، ') from public.item_codes where item_id = p_item),null,null);
  return n;
end $$;

-- ---------- 2) automatic code by group ----------
create or replace function public._next_code(p_dep int, p_grp int) returns text
language plpgsql stable security definer set search_path = public as $$
declare pre text := lpad(coalesce(p_dep,0)::text, 2, '0') || lpad(coalesce(p_grp,0)::text, 2, '0'); n int; c text;
begin
  select coalesce(max(substring(code from '^' || pre || '-([0-9]+)$')::int), 0) into n from public.items where code ~ ('^' || pre || '-[0-9]+$');
  loop
    n := n + 1; c := pre || '-' || lpad(n::text, 4, '0');
    exit when not public._code_taken(c, null);
  end loop;
  return c;
end $$;

create or replace function public.item_next_code(p_token text, p_department int, p_group int) returns text
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if p_group is not null then select department_id into p_department from public.item_groups where id = p_group; end if;
  return public._next_code(p_department, p_group);
end $$;

-- item_save: same as before, the new item's code comes from its group when none is typed
create or replace function public.item_save(p_token text, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.sess; b public.items; nid uuid; dep int; grp int; u text := coalesce(p->>'unit','piece'); cd text;
begin
  s := public._session(p_token);
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if u not in ('piece','set','meter','dozen') then raise exception 'BAD_UNIT'; end if;
  if (p->>'barcode') is not null and not public._ean13_ok(p->>'barcode') then raise exception 'BAD_EAN13'; end if;
  dep := nullif(p->>'department_id','')::int; grp := nullif(p->>'group_id','')::int;
  if grp is not null then select coalesce(department_id, dep) into dep from public.item_groups where id = grp; end if;
  if (p->>'id') is null then
    perform public._require(s,'items','a');
    cd := nullif(trim(coalesce(p->>'code','')),'');
    if cd is not null and public._code_taken(cd, null) then raise exception 'CODE_TAKEN:%', cd; end if;
    insert into public.items (code, barcode, name, department_id, group_id, unit, sale_price, last_cost, min_qty, serial_required, warranty_months, min_length, vat_rate, variants)
    values (coalesce(cd, public._next_code(dep, grp)), nullif(p->>'barcode',''), trim(p->>'name'), dep, grp, u,
            coalesce((p->>'sale_price')::numeric,0), coalesce((p->>'last_cost')::numeric,0), coalesce((p->>'min_qty')::numeric,0),
            coalesce((p->>'serial_required')::boolean,false), coalesce((p->>'warranty_months')::int,0), nullif(p->>'min_length','')::numeric, nullif(p->>'vat_rate','')::numeric, p->>'variants')
    returning id into nid;
    perform public._audit(s,'إضافة صنف',p->>'name',null,p->>'sale_price',null,null);
    return nid;
  end if;
  perform public._require(s,'items','e');
  select * into b from public.items where id = (p->>'id')::uuid for update;
  if b.id is null then raise exception 'NOT_FOUND'; end if;
  if (p->>'updated_at') is not null and b.updated_at > (p->>'updated_at')::timestamptz then raise exception 'EDITED_BY_SOMEONE_ELSE'; end if;
  if coalesce((p->>'sale_price')::numeric, b.sale_price) <> b.sale_price and not (public._has(s.role_id,'prices') or s.role_id in ('owner','gm','dataentry')) then raise exception 'NOT_ALLOWED:prices'; end if;
  update public.items set name = trim(p->>'name'), barcode = nullif(p->>'barcode',''), department_id = dep, group_id = grp, unit = u,
    sale_price = coalesce((p->>'sale_price')::numeric, sale_price), min_qty = coalesce((p->>'min_qty')::numeric, min_qty),
    serial_required = coalesce((p->>'serial_required')::boolean, serial_required), warranty_months = coalesce((p->>'warranty_months')::int, warranty_months),
    min_length = nullif(p->>'min_length','')::numeric, vat_rate = nullif(p->>'vat_rate','')::numeric, variants = p->>'variants',
    hidden = coalesce((p->>'hidden')::boolean, hidden), updated_at = now()
   where id = b.id;
  if b.sale_price <> coalesce((p->>'sale_price')::numeric, b.sale_price) then
    perform public._audit(s,'تعديل سعر بيع',b.name,b.sale_price::text,p->>'sale_price',p->>'reason',null);
  else perform public._audit(s,'تعديل صنف',b.name,null,null,p->>'reason',null); end if;
  return b.id;
end $$;

-- ---------- 3) sets ----------
alter table public.stock_moves drop constraint if exists stock_moves_kind_check;
alter table public.stock_moves add constraint stock_moves_kind_check
  check (kind in ('opening','purchase','sale','return','transfer_out','transfer_in','adjust','waste','void','kit'));

create table if not exists public.item_kits (
  kit_id uuid primary key references public.items(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.kit_parts (
  kit_id uuid not null references public.item_kits(kit_id) on delete cascade,
  part_id uuid not null references public.items(id),
  qty numeric(10,3) not null check (qty > 0),
  primary key (kit_id, part_id)
);
create index if not exists kit_parts_part on public.kit_parts (part_id);
alter table public.item_kits enable row level security;
alter table public.kit_parts enable row level security;
drop policy if exists "role read" on public.item_kits;
drop policy if exists "role read" on public.kit_parts;
create policy "role read" on public.item_kits for select to authenticated using ((select public._r_any()));
create policy "role read" on public.kit_parts for select to authenticated using ((select public._r_any()));
revoke all on public.item_kits, public.kit_parts from anon;
revoke insert, update, delete, truncate on public.item_kits, public.kit_parts from authenticated;
create sequence if not exists public.kit_no_seq;

create or replace function public.kit_save(p_token text, p_kit uuid, p_parts jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; k public.items; pt public.items; ln jsonb; n int := 0;
begin
  s := public._session(p_token);
  if not (public._can(s.role_id,'items','e') or public._can(s.role_id,'items','a')) then raise exception 'NOT_ALLOWED:items'; end if;
  select * into k from public.items where id = p_kit;
  if k.id is null then raise exception 'NOT_FOUND'; end if;
  if coalesce(jsonb_array_length(p_parts),0) = 0 then
    delete from public.item_kits where kit_id = p_kit;
    perform public._audit(s,'إلغاء طقم',k.name,null,null,null,null);
    return 0;
  end if;
  if k.serial_required then raise exception 'KIT_SERIAL'; end if;
  if exists (select 1 from public.kit_parts where part_id = p_kit) then raise exception 'KIT_IS_PART'; end if;
  insert into public.item_kits (kit_id) values (p_kit) on conflict do nothing;
  delete from public.kit_parts where kit_id = p_kit;
  for ln in select * from jsonb_array_elements(p_parts) loop
    select * into pt from public.items where id = (ln->>'part_id')::uuid;
    if pt.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if pt.id = p_kit then raise exception 'KIT_SELF'; end if;
    if exists (select 1 from public.item_kits where kit_id = pt.id) then raise exception 'KIT_NESTED:%', pt.name; end if;
    if pt.serial_required then raise exception 'KIT_SERIAL'; end if;
    if coalesce((ln->>'qty')::numeric,0) <= 0 then raise exception 'BAD_QTY'; end if;
    insert into public.kit_parts (kit_id, part_id, qty) values (p_kit, pt.id, (ln->>'qty')::numeric)
    on conflict (kit_id, part_id) do update set qty = public.kit_parts.qty + excluded.qty;
    n := n + 1;
  end loop;
  perform public._audit(s,'مكونات طقم',k.name,null,(select string_agg(i.name || ' ×' || kp.qty::text, '، ') from public.kit_parts kp join public.items i on i.id = kp.part_id where kp.kit_id = p_kit),null,null);
  return n;
end $$;

-- build p_qty sets from pieces (pieces out, sets in at the pieces' cost). The moves carry no cost of their own:
-- the value stays in stock and leaves only when the set is sold, so the books are not touched twice.
create or replace function public._kit_build(p_kit uuid, p_loc smallint, p_qty numeric, p_ref text, p_staff uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare kp record; c numeric := 0;
begin
  if p_qty <= 0 then return 0; end if;
  if not exists (select 1 from public.kit_parts where kit_id = p_kit) then raise exception 'KIT_NO_PARTS'; end if;
  for kp in select * from public.kit_parts where kit_id = p_kit loop
    c := c + public._fifo_out(kp.part_id, p_loc, kp.qty * p_qty);
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (kp.part_id, p_loc, -(kp.qty * p_qty), 0, 'kit', 'kit', p_ref, p_staff);
  end loop;
  perform public._fifo_in(p_kit, p_loc, p_qty, c / p_qty, p_ref);
  insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (p_kit, p_loc, p_qty, 0, 'kit', 'kit', p_ref, p_staff);
  return round(c, 2);
end $$;

-- FIFO out, same as before; a set with too few packed sets is built from its pieces first (open set)
create or replace function public._fifo_out(p_item uuid, p_loc smallint, p_qty numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare left_q numeric := p_qty; c numeric := 0; ly record; take numeric; nm text; have numeric;
begin
  if p_qty <= 0 then return 0; end if;
  have := coalesce((select sum(qty_left) from public.stock_layers where item_id = p_item and location_id = p_loc and qty_left > 0), 0);
  if have < p_qty and exists (select 1 from public.item_kits where kit_id = p_item) then
    perform public._kit_build(p_item, p_loc, p_qty - have, 'طقم مفتوح', null);
    have := p_qty;
  end if;
  if have < p_qty then
    select name into nm from public.items where id = p_item;
    raise exception 'INSUFFICIENT_STOCK:%', nm;
  end if;
  for ly in select id, qty_left, unit_cost from public.stock_layers where item_id = p_item and location_id = p_loc and qty_left > 0 order by id for update loop
    exit when left_q <= 0;
    take := least(left_q, ly.qty_left);
    update public.stock_layers set qty_left = qty_left - take where id = ly.id;
    c := c + take * ly.unit_cost; left_q := left_q - take;
  end loop;
  update public.stock set qty = qty - p_qty where item_id = p_item and location_id = p_loc;
  return round(c, 2);
end $$;

create or replace function public.kit_assemble(p_token text, p_kit uuid, p_loc smallint, p_qty numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; no text; c numeric; k public.items;
begin
  s := public._session(p_token);
  if not (public._can(s.role_id,'stock','a') or public._can(s.role_id,'items','e')) then raise exception 'NOT_ALLOWED:stock'; end if;
  if not public._loc_ok(s, p_loc) then raise exception 'OUT_OF_SCOPE'; end if;
  if coalesce(p_qty,0) <= 0 or p_qty <> trunc(p_qty) then raise exception 'BAD_QTY'; end if;
  select * into k from public.items where id = p_kit;
  no := 'KT-' || lpad(nextval('public.kit_no_seq')::text, 5, '0');
  c := public._kit_build(p_kit, p_loc, p_qty, no, s.staff_id);
  perform public._audit(s,'تجميع طقم',no || ' · ' || k.name,null,p_qty::text,p_note,p_loc);
  return jsonb_build_object('no', no, 'cost', c);
end $$;

create or replace function public.kit_disassemble(p_token text, p_kit uuid, p_loc smallint, p_qty numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; no text; c numeric; k public.items; kp record; w numeric; have numeric;
begin
  s := public._session(p_token);
  if not (public._can(s.role_id,'stock','a') or public._can(s.role_id,'items','e')) then raise exception 'NOT_ALLOWED:stock'; end if;
  if not public._loc_ok(s, p_loc) then raise exception 'OUT_OF_SCOPE'; end if;
  if coalesce(p_qty,0) <= 0 or p_qty <> trunc(p_qty) then raise exception 'BAD_QTY'; end if;
  select * into k from public.items where id = p_kit;
  if not exists (select 1 from public.kit_parts where kit_id = p_kit) then raise exception 'KIT_NO_PARTS'; end if;
  have := coalesce((select sum(qty_left) from public.stock_layers where item_id = p_kit and location_id = p_loc and qty_left > 0), 0);
  if have < p_qty then raise exception 'INSUFFICIENT_STOCK:%', k.name; end if;
  no := 'KT-' || lpad(nextval('public.kit_no_seq')::text, 5, '0');
  c := public._fifo_out(p_kit, p_loc, p_qty);
  insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (p_kit, p_loc, -p_qty, 0, 'kit', 'kit', no, s.staff_id);
  -- the set's cost is shared over its pieces by their last cost (equal shares when none has a cost)
  select coalesce(sum(kp2.qty * greatest(i.last_cost,0)),0) into w from public.kit_parts kp2 join public.items i on i.id = kp2.part_id where kp2.kit_id = p_kit;
  for kp in select kp2.*, i.last_cost, (select count(*) from public.kit_parts where kit_id = p_kit) n from public.kit_parts kp2 join public.items i on i.id = kp2.part_id where kp2.kit_id = p_kit loop
    perform public._fifo_in(kp.part_id, p_loc, kp.qty * p_qty,
      case when w > 0 then c * (kp.qty * greatest(kp.last_cost,0) / w) / (kp.qty * p_qty) else c / kp.n / (kp.qty * p_qty) end, no);
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (kp.part_id, p_loc, kp.qty * p_qty, 0, 'kit', 'kit', no, s.staff_id);
  end loop;
  perform public._audit(s,'فك طقم',no || ' · ' || k.name,null,p_qty::text,p_note,p_loc);
  return jsonb_build_object('no', no, 'cost', c);
end $$;

-- per set: packed now, built, taken apart, built while selling (open), sold
create or replace function public.kit_stats(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._require(s,'items','v');
  return coalesce((select jsonb_agg(jsonb_build_object('kit_id', k.kit_id,
      'packed', coalesce((select sum(qty) from public.stock where item_id = k.kit_id), 0),
      'built', coalesce((select sum(qty) from public.stock_moves m where m.item_id = k.kit_id and m.kind = 'kit' and m.qty > 0 and m.ref_id like 'KT-%'), 0),
      'open', coalesce((select sum(qty) from public.stock_moves m where m.item_id = k.kit_id and m.kind = 'kit' and m.qty > 0 and m.ref_id = 'طقم مفتوح'), 0),
      'apart', coalesce((select -sum(qty) from public.stock_moves m where m.item_id = k.kit_id and m.kind = 'kit' and m.qty < 0), 0),
      'sold', coalesce((select -sum(qty) from public.stock_moves m where m.item_id = k.kit_id and m.kind = 'sale'), 0)
                          - coalesce((select sum(qty) from public.stock_moves m where m.item_id = k.kit_id and m.kind in ('return','void')), 0)))
    from public.item_kits k), '[]'::jsonb);
end $$;

-- ---------- 4) swapping a piece from an invoice ----------
alter table public.sales add column if not exists exchange_of uuid references public.sales(id);
alter table public.returns add column if not exists exchange_sale uuid references public.sales(id);
alter table public.sale_payments drop constraint if exists sale_payments_method_check;
alter table public.sale_payments add constraint sale_payments_method_check check (method in ('cash','card','insta','wallet','inst','points','exchange'));

-- old piece back at its offer price (A); new piece: keep → costs A; diff → its own price minus the old piece's discount
create or replace function public._swap_calc(p_sale uuid, p_line bigint, p_item uuid, p_qty numeric, p_mode text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sl public.sale_lines; it public.items; c jsonb; a numeric; ytot numeric; old_disc numeric;
begin
  if p_mode not in ('keep','diff') then raise exception 'BAD_VALUE'; end if;
  select * into sl from public.sale_lines where id = p_line and sale_id = p_sale;
  if sl.id is null then raise exception 'LINE_NOT_IN_SALE'; end if;
  if exists (select 1 from public.offer_voids v where v.sale_line_id = sl.id) then raise exception 'OFFER_ALREADY_CANCELLED'; end if;
  select * into it from public.items where id = p_item and not hidden;
  if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if it.id = sl.item_id then raise exception 'SAME_ITEM'; end if;
  c := public._return_calc(p_sale, jsonb_build_array(jsonb_build_object('sale_line_id', p_line, 'qty', p_qty)));
  a := (c->'lines'->0->>'amount')::numeric;
  old_disc := round(sl.discount / sl.qty * p_qty, 2);
  ytot := case when p_mode = 'keep' then a else round(it.sale_price * p_qty - old_disc, 2) end;
  return jsonb_build_object('old_item', sl.item_id, 'old_price', sl.unit_price, 'back', a, 'new_item', it.id, 'new_name', it.name, 'new_price', it.sale_price,
    'qty', p_qty, 'mode', p_mode, 'new_total', ytot, 'diff', ytot - a, 'serial', it.serial_required, 'offer_id', sl.offer_id);
end $$;

create or replace function public.sale_swap_preview(p_token text, p_sale uuid, p_line bigint, p_item uuid, p_qty numeric, p_mode text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sa public.sales;
begin
  s := public._session(p_token); perform public._require(s,'returns','a');
  select * into sa from public.sales where id = p_sale;
  if sa.id is null or sa.status <> 'posted' then raise exception 'SALE_NOT_RETURNABLE'; end if;
  if not public._loc_ok(s, sa.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  return public._swap_calc(p_sale, p_line, p_item, p_qty, p_mode);
end $$;

-- p = {sale_id, line_id, item_id, qty, mode, method, serial, condition, reason, approver_pin}
create or replace function public.sale_swap(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; sa public.sales; sl public.sale_lines; it public.items; st public.store; sh public.shifts; c jsonb; appr public.staff; approver uuid;
        q numeric := (p->>'qty')::numeric; a numeric; ytot numeric; diff numeric; rid uuid; rno text; sid uuid; no text; bd date; lc numeric; lcost numeric;
        r numeric; net numeric; vat numeric := 0; meth text := coalesce(nullif(p->>'method',''),'cash'); cond text := coalesce(p->>'condition','resell');
begin
  s := public._session(p_token); perform public._require(s,'returns','a');
  if s.role_id = 'seller' then raise exception 'SELLER_CANNOT_COLLECT'; end if;
  if coalesce(q,0) <= 0 then raise exception 'BAD_QTY'; end if;
  if meth not in ('cash','card','insta','wallet') then raise exception 'BAD_PAYMENT_METHOD'; end if;
  select * into sa from public.sales where id = (p->>'sale_id')::uuid for update;
  if sa.id is null or sa.status <> 'posted' then raise exception 'SALE_NOT_RETURNABLE'; end if;
  if not public._loc_ok(s, sa.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  if public._can(s.role_id,'returns','p') then approver := s.staff_id;
  else
    select stf.* into appr from public.staff stf where stf.active and stf.id <> s.staff_id and stf.pin_hash = crypt(coalesce(p->>'approver_pin',''), stf.pin_hash)
       and public._can(stf.role_id,'returns','p') limit 1;
    if appr.id is null then raise exception 'APPROVER_NOT_VALID'; end if;
    approver := appr.id;
  end if;
  select * into sh from public.shifts where drawer_id = public._drawer_of(s.device_location) and status = 'open';
  if sh.id is null then raise exception 'NO_OPEN_SHIFT'; end if;
  c := public._swap_calc(sa.id, (p->>'line_id')::bigint, (p->>'item_id')::uuid, q, p->>'mode');
  a := (c->>'back')::numeric; ytot := (c->>'new_total')::numeric; diff := (c->>'diff')::numeric;
  if ytot < 0 then raise exception 'BAD_VALUE'; end if;
  select * into sl from public.sale_lines where id = (p->>'line_id')::bigint;
  select * into it from public.items where id = (p->>'item_id')::uuid;
  if it.serial_required then
    if q <> 1 then raise exception 'SERIAL_ITEM_QTY_ONE:%', it.name; end if;
    if not exists (select 1 from public.serials where serial = p->>'serial' and item_id = it.id and location_id = sh.location_id and status = 'in_stock') then
      raise exception 'SERIAL_NOT_AVAILABLE:%', coalesce(p->>'serial','—');
    end if;
  end if;

  -- old piece back (no money: its value goes to the new piece)
  rno := 'RT-' || lpad(nextval('public.return_no_seq')::text, 5, '0');
  lcost := round(sl.cost / sl.qty * q, 2);
  insert into public.returns (no, sale_id, location_id, shift_id, staff_id, approved_by, reason, refund_method, amount, cost)
  values (rno, sa.id, sa.location_id, sh.id, s.staff_id, approver, 'استبدال' || coalesce(' · ' || nullif(trim(p->>'reason'),''), ''), 'credit', a, case when cond = 'resell' then lcost else lcost end)
  returning id into rid;
  insert into public.return_lines (return_id, sale_line_id, item_id, qty, amount, cost, condition, serial)
  values (rid, sl.id, sl.item_id, q, a, lcost, cond, sl.serial);
  if cond = 'resell' then
    perform public._fifo_in(sl.item_id, sa.location_id, q, sl.cost / sl.qty, rno);
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (sl.item_id, sa.location_id, q, lcost, 'return', 'return', rno, s.staff_id);
    if sl.serial is not null then update public.serials set status = 'in_stock', sale_id = null, location_id = sa.location_id where serial = sl.serial; end if;
  else
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (sl.item_id, sa.location_id, 0, lcost, 'waste', 'return', rno || ' تالف', s.staff_id);
    if sl.serial is not null then update public.serials set status = 'returned_to_supplier', sale_id = null where serial = sl.serial; end if;
  end if;

  -- new piece out, on a new invoice linked to the old one
  bd := public._business_day(sh.location_id);
  select * into st from public.store where id = 1;
  net := ytot;
  if st.vat_registered and st.vat_from is not null and bd >= st.vat_from then
    r := coalesce(it.vat_rate, st.vat_rate) / 100;
    if st.prices_include_vat then vat := round(ytot - ytot / (1 + r), 2); else net := round(ytot / (1 + r), 2); vat := ytot - net; end if;
  end if;
  no := 'INV-' || lpad(nextval('public.sale_no_seq')::text, 6, '0');
  insert into public.sales (no, location_id, shift_id, device_id, cashier_id, seller_id, customer_id, business_day, gross, discount, vat, total, offer_disc, exchange_of)
  values (no, sh.location_id, sh.id, s.device_id, s.staff_id, sa.seller_id, sa.customer_id, bd, it.sale_price * q, it.sale_price * q - net, vat, ytot,
          case when sl.offer_id is not null then greatest(it.sale_price * q - net, 0) else 0 end, sa.id)
  returning id into sid;
  lc := public._fifo_out(it.id, sh.location_id, q);
  insert into public.sale_lines (sale_id, item_id, qty, unit_price, discount, cost, serial, offer_id, offer_disc)
  values (sid, it.id, q, it.sale_price, it.sale_price * q - net, lc, nullif(p->>'serial',''), sl.offer_id, case when sl.offer_id is not null then greatest(it.sale_price * q - net, 0) else 0 end);
  insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (it.id, sh.location_id, -q, lc, 'sale', 'sale', no, s.staff_id);
  if coalesce(p->>'serial','') <> '' then update public.serials set status = 'sold', sale_id = sid where serial = p->>'serial'; end if;
  update public.sales set cost = lc where id = sid;
  update public.returns set exchange_sale = sid where id = rid;

  -- money: the old piece's value pays first; the customer pays the rest, or gets the change back
  insert into public.sale_payments (sale_id, method, amount) values (sid, 'exchange', least(a, ytot)) ;
  if diff > 0 then
    insert into public.sale_payments (sale_id, method, amount) values (sid, meth, diff);
    insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, note, staff_id)
    values (sh.drawer_id, diff, 'sale', meth, sh.id, 'sale', no, 'فرق استبدال ' || sa.no, s.staff_id);
  elsif diff < 0 then
    insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, note, staff_id)
    values (sh.drawer_id, diff, 'refund', meth, sh.id, 'swap', rno, 'فرق استبدال ' || sa.no, s.staff_id);
  end if;
  perform public._audit(s,'استبدال صنف',sa.no || ' → ' || no,(select name from public.items where id = sl.item_id),it.name || ' · ' || diff::text,
    coalesce(p->>'reason','') || coalesce(' · بموافقة ' || appr.name, ''), sa.location_id);
  return jsonb_build_object('return_no', rno, 'sale_id', sid, 'no', no, 'back', a, 'total', ytot, 'diff', diff, 'vat', vat);
end $$;

revoke execute on function public._code_taken(text, uuid), public._items_code_guard(), public._next_code(int, int), public._kit_build(uuid, smallint, numeric, text, uuid),
  public._swap_calc(uuid, bigint, uuid, numeric, text) from public, anon, authenticated;
revoke execute on function public.item_codes_set(text, uuid, jsonb), public.item_next_code(text, int, int), public.kit_save(text, uuid, jsonb),
  public.kit_assemble(text, uuid, smallint, numeric, text), public.kit_disassemble(text, uuid, smallint, numeric, text), public.kit_stats(text),
  public.sale_swap_preview(text, uuid, bigint, uuid, numeric, text), public.sale_swap(text, jsonb), public.item_save(text, jsonb) from public, anon;
grant execute on function public.item_codes_set(text, uuid, jsonb), public.item_next_code(text, int, int), public.kit_save(text, uuid, jsonb),
  public.kit_assemble(text, uuid, smallint, numeric, text), public.kit_disassemble(text, uuid, smallint, numeric, text), public.kit_stats(text),
  public.sale_swap_preview(text, uuid, bigint, uuid, numeric, text), public.sale_swap(text, jsonb), public.item_save(text, jsonb) to authenticated;

-- ---------- the books: a swap's value (2103 customer credit) pays the new invoice; change given back for a swap leaves the drawer against 2103 ----------
create or replace function public._gl_rows(p_from date, p_to date)
returns table (d date, src text, ref text, memo text, account text, dr numeric, cr numeric, loc smallint)
language sql stable security definer set search_path = public as $$
  with sm as (select m.*, (m.created_at at time zone 'Africa/Cairo')::date as dd from public.stock_moves m),
  cm as (select m.*, case when m.ref_type = 'expense' then coalesce((select e.exp_date from public.expenses e where e.no = m.ref_id and m.amount < 0), (m.created_at at time zone 'Africa/Cairo')::date)
                          else (m.created_at at time zone 'Africa/Cairo')::date end as dd,
                     case when m.ref_type = 'expense' then (select e.location_id from public.expenses e where e.no = m.ref_id) end as loc
               from public.cash_moves m),
  sale_lines_gl as (   -- the sale entry (revenue side + money side); a void posts its exact mirror
    select s.business_day d, s.no ref, s.location_id loc, s.id sale_id, x.account, x.dr, x.cr from public.sales s
    cross join lateral (
      select '4101'::text account, 0::numeric dr, (s.total - s.vat) cr union all
      select '2104', 0, s.vat where s.vat <> 0 union all
      select public._cash_gl(c.account_id, c.method), c.amount, 0 from public.cash_moves c where c.ref_type = 'sale' and c.ref_id = s.no and c.kind = 'sale' union all
      select '1104', p.amount, 0 from public.sale_payments p where p.sale_id = s.id and p.method = 'inst' union all
      select '5205', p.amount, 0 from public.sale_payments p where p.sale_id = s.id and p.method = 'points' union all
      select '2103', p.amount, 0 from public.sale_payments p where p.sale_id = s.id and p.method = 'exchange' union all
      select '5209', s.fin_commission, 0 where s.fin_commission <> 0 union all
      select '1104', 0, s.fin_commission where s.fin_commission <> 0
    ) x
  )
  select * from (
    -- sales
    select g.d, 'sale', g.ref, 'فاتورة بيع ' || g.ref, g.account, g.dr, g.cr, g.loc from sale_lines_gl g
    union all
    -- voids: mirror on the void date
    select (select min(dd) from sm where sm.kind = 'void' and sm.ref_id = g.ref), 'void', g.ref, 'إلغاء ' || g.ref, g.account, g.cr, g.dr, g.loc
      from sale_lines_gl g join public.sales s on s.id = g.sale_id where s.status = 'void'
    union all
    -- stock movements at cost
    select sm.dd, 'stock', coalesce(sm.ref_id, sm.kind), case sm.kind when 'opening' then 'رصيد أول المدة' when 'purchase' then 'استلام مشتريات' when 'sale' then 'تكلفة مبيعات'
             when 'return' then 'مرتجع للمخزون' when 'void' then 'إلغاء — رجوع للمخزون' when 'transfer_out' then 'تحويل خارج' when 'transfer_in' then 'تحويل داخل' when 'waste' then 'فاقد' else 'تسوية' end,
           a.account, a.dr, a.cr, sm.location_id
      from sm cross join lateral (
        select case when (sm.kind = 'waste' and sm.ref_type = 'return') then null
                    when sm.kind in ('opening','purchase','return','void','transfer_in') or (sm.kind = 'adjust' and sm.qty > 0) then '1106'
                    when sm.kind = 'sale' then '5101' when sm.kind = 'transfer_out' then '1109' when sm.kind = 'waste' then '5206'
                    when sm.kind = 'adjust' and sm.ref_type = 'warranty' then '1108' else '5207' end account, sm.cost dr, 0::numeric cr
        union all
        select case when (sm.kind = 'waste' and sm.ref_type = 'return') then null
                    when sm.kind = 'opening' then '3103' when sm.kind = 'purchase' then '2101' when sm.kind in ('return','void') then '5101'
                    when sm.kind = 'transfer_in' then '1109' when sm.kind = 'waste' and sm.ref_type = 'transfer' then '1109'
                    when sm.kind = 'adjust' and sm.qty > 0 and sm.ref_type = 'warranty' then '1108' when sm.kind = 'adjust' and sm.qty > 0 then '4103'
                    else '1106' end, 0, sm.cost
      ) a where a.account is not null and sm.cost <> 0
    union all
    -- purchase invoice discount
    select pi.inv_date, 'purchase', pi.no, 'خصم فاتورة شراء ' || pi.no, x.account, x.dr, x.cr, pi.location_id
      from public.purchase_invoices pi cross join lateral (select '2101' account, pi.discount dr, 0::numeric cr union all select '4103', 0, pi.discount) x where pi.discount <> 0
    union all
    -- supplier opening balances
    select coalesce(su.opening_date, (su.created_at at time zone 'Africa/Cairo')::date), 'opening', 'SUP-' || su.id, 'رصيد أول المدة — ' || su.name, x.account, x.dr, x.cr, null::smallint
      from public.suppliers su cross join lateral (select '3103' account, su.opening_balance dr, 0::numeric cr union all select '2101', 0, su.opening_balance) x where su.opening_balance <> 0
    union all
    -- returns: revenue side
    select (r.created_at at time zone 'Africa/Cairo')::date, 'return', r.no, 'مرتجع ' || r.no, x.account, x.dr, x.cr, r.location_id
      from public.returns r join public.sales s on s.id = r.sale_id
      cross join lateral (
        select '4102' account, round(r.amount - r.amount * s.vat / nullif(s.total,0), 2) dr, 0::numeric cr union all
        select '2104', round(r.amount * s.vat / nullif(s.total,0), 2), 0 where s.vat <> 0 union all
        select case when r.refund_method = 'credit' then '2103' when r.refund_method = 'cash' then '1102' else '1103' end, 0, r.amount
      ) x
    union all
    -- returns: damaged goods written off (cost leaves COGS into waste)
    select (r.created_at at time zone 'Africa/Cairo')::date, 'return', r.no, 'مرتجع تالف ' || r.no, x.account, x.dr, x.cr, r.location_id
      from public.return_lines rl join public.returns r on r.id = rl.return_id
      cross join lateral (select '5206' account, rl.cost dr, 0::numeric cr union all select '5101', 0, rl.cost) x where rl.condition = 'damaged' and rl.cost <> 0
    union all
    -- cash movements that are not part of a sale / refund
    select cm.dd, case when cm.ref_type = 'expense' then 'expense' else 'cash' end, coalesce(cm.ref_id, cm.kind), coalesce(cm.note, cm.kind), x.account, x.dr, x.cr, cm.loc
      from cm cross join lateral (
        select public._cash_gl(cm.account_id, cm.method) account, greatest(cm.amount,0) dr, greatest(-cm.amount,0) cr
        union all
        select case when cm.ref_type = 'swap' then '2103' when cm.gl_account is not null then cm.gl_account
                    when cm.kind in ('float','deposit') and cm.ref_type is distinct from 'finance' then '1110'
                    when cm.kind = 'deposit' and cm.ref_type = 'finance' then '1104'
                    when cm.kind = 'adjust' then case when cm.amount < 0 then '5207' else '4103' end
                    when cm.kind = 'expense' and cm.ref_type = 'supplier' then '2101'
                    when cm.kind = 'opening' then '3103' else '5207' end,
               greatest(-cm.amount,0), greatest(cm.amount,0)
      ) x where (cm.kind not in ('sale','refund') or cm.ref_type = 'swap') and cm.amount <> 0
    union all
    -- finance company paid less than the expected net → extra commission
    select fr.received_on, 'cash', fr.ref, 'فرق تحويل شركة تقسيط', x.account, x.dr, x.cr, fr.location_id
      from public.finance_receivables fr cross join lateral (select '5209' account, (fr.net - fr.received) dr, 0::numeric cr union all select '1104', 0, fr.net - fr.received) x
     where fr.status = 'settled' and fr.received <> fr.net
    union all
    -- supplier credit notes (warranty claims)
    select (sp.created_at at time zone 'Africa/Cairo')::date, 'supplier', sp.no, coalesce(sp.note,'إشعار دائن مورد'), x.account, x.dr, x.cr, null::smallint
      from public.supplier_payments sp cross join lateral (select '2101' account, sp.amount dr, 0::numeric cr union all select '1108', 0, sp.amount) x where sp.method = 'credit'
    union all
    -- straight-line depreciation, one entry at each month end, starting with the purchase month;
    -- an opening-sheet asset is already net on the opening date, so it starts with the month after that day
    select x.me, 'depreciation', 'FA-' || fa.id, 'إهلاك ' || fa.name, y.account, y.dr, y.cr, fa.location_id
      from public.fixed_assets fa
      cross join lateral (select (date_trunc('month', gs) + interval '1 month - 1 day')::date me
                            from generate_series(date_trunc('month', case when fa.opening then fa.start_date + 1 else fa.start_date end), date_trunc('month', least(coalesce(fa.disposed_on, current_date), current_date)), interval '1 month') gs
                           limit greatest(fa.life_months,0)) x
      cross join lateral (select '5208'::text account, round((fa.start_value - fa.salvage) / nullif(fa.life_months,0), 2) dr, 0::numeric cr
                          union all select '1202', 0, round((fa.start_value - fa.salvage) / nullif(fa.life_months,0), 2)) y
     where fa.life_months > 0 and x.me <= current_date
    union all
    -- manual, opening & closing entries (approved only)
    select m.entry_date, m.kind, m.no, m.memo, l.account, l.dr, l.cr, null::smallint
      from public.gl_manual m join public.gl_manual_lines l on l.entry_id = m.id where m.status = 'approved'
  ) all_rows
  where d between coalesce(p_from, date '2000-01-01') and coalesce(p_to, date '2999-12-31') and (dr <> 0 or cr <> 0);
$$;
revoke execute on function public._gl_rows(date,date) from public, anon, authenticated;
