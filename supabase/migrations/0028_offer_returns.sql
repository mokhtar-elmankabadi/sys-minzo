-- 0028 · returns of offer items (owner's rules)
-- · an item whose offer was on itself alone (percent / amount off that item) comes back at its offer price (as before);
-- · an offer on a group (buy X get Y, set price, gift, invoice offer): when part of it comes back, the offer is cancelled
--   on what stays with the customer, and that discount is taken off the refund;
-- · if that makes the refund negative, the return is refused — the customer returns the whole offer or swaps the piece.
-- Cancelled offer lines are remembered in offer_voids, so a later return of them is refunded without the offer discount.

alter table public.returns add column if not exists offer_back numeric(14,2) not null default 0;

create table if not exists public.offer_voids (
  sale_line_id bigint primary key references public.sale_lines(id) on delete cascade,
  offer_id int,
  return_id uuid references public.returns(id) on delete cascade,
  charged numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.offer_voids enable row level security;
drop policy if exists "role read" on public.offer_voids;
create policy "role read" on public.offer_voids for select to authenticated using ((select public._r_any()));
revoke all on public.offer_voids from anon;
revoke insert, update, delete, truncate on public.offer_voids from authenticated;

-- is this offer on a group of items (so a partial return cancels it)?
create or replace function public._offer_is_group(p_offer int) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select o.kind in ('bxgy','bundle','gift') or o.scope = 'invoice' from public.offers o where o.id = p_offer), false)
$$;

-- what a return would refund: per line, the offer discount taken back, the net, and whether it is refused
create or replace function public._return_calc(p_sale uuid, p_lines jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sa public.sales; ratio numeric; ln jsonb; sl public.sale_lines; q numeric; done_q numeric; unit numeric; la numeric; amt numeric := 0;
        out_lines jsonb := '[]'; this_q jsonb := '{}'; ofs int[] := '{}'; o int; back numeric := 0; ch numeric; rest numeric; voids jsonb := '[]'; offers jsonb := '[]'; o_back numeric; voided boolean;
begin
  select * into sa from public.sales where id = p_sale;
  if sa.id is null or sa.status <> 'posted' then raise exception 'SALE_NOT_RETURNABLE'; end if;
  ratio := case when sa.gross - sa.discount > 0 then sa.total / (sa.gross - sa.discount) else 1 end;
  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]')) loop
    q := (ln->>'qty')::numeric; if coalesce(q,0) <= 0 then continue; end if;
    select * into sl from public.sale_lines where id = (ln->>'sale_line_id')::bigint and sale_id = sa.id;
    if sl.id is null then raise exception 'LINE_NOT_IN_SALE'; end if;
    select coalesce(sum(qty),0) into done_q from public.return_lines where sale_line_id = sl.id;
    if q + coalesce((this_q->>sl.id::text)::numeric, 0) > sl.qty - done_q then raise exception 'RETURN_MORE_THAN_SOLD'; end if;
    this_q := this_q || jsonb_build_object(sl.id::text, q + coalesce((this_q->>sl.id::text)::numeric, 0));
    voided := exists (select 1 from public.offer_voids v where v.sale_line_id = sl.id);
    -- offer already cancelled on this line → refund without the offer discount (the manual discount share stays)
    unit := (sl.unit_price * sl.qty - sl.discount + case when voided then coalesce(sl.offer_disc,0) else 0 end) / sl.qty;
    la := round(unit * q * ratio, 2);
    amt := amt + la;
    out_lines := out_lines || jsonb_build_object('sale_line_id', sl.id, 'qty', q, 'amount', la, 'condition', coalesce(ln->>'condition','resell'),
      'offer_id', sl.offer_id, 'offer_price', round((sl.unit_price * sl.qty - sl.discount) / sl.qty * ratio, 2), 'voided', voided);
    if sl.offer_id is not null and not voided and public._offer_is_group(sl.offer_id) and not sl.offer_id = any(ofs) then ofs := ofs || sl.offer_id; end if;
  end loop;
  -- group offers touched: cancel the discount on what the customer keeps
  foreach o in array ofs loop
    o_back := 0;
    for sl in select * from public.sale_lines l where l.sale_id = sa.id and l.offer_id = o
                and not exists (select 1 from public.offer_voids v where v.sale_line_id = l.id) loop
      select coalesce(sum(qty),0) into done_q from public.return_lines where sale_line_id = sl.id;
      rest := sl.qty - done_q - coalesce((this_q->>sl.id::text)::numeric, 0);
      if rest <= 0 or coalesce(sl.offer_disc,0) <= 0 then continue; end if;
      ch := round(sl.offer_disc * rest / sl.qty * ratio, 2);
      o_back := o_back + ch;
      voids := voids || jsonb_build_object('sale_line_id', sl.id, 'offer_id', o, 'charged', ch);
    end loop;
    back := back + o_back;
    offers := offers || jsonb_build_object('id', o, 'name', (select name from public.offers where id = o), 'back', o_back);
  end loop;
  return jsonb_build_object('lines', out_lines, 'amount', amt, 'offer_back', back, 'net', amt - back, 'blocked', amt - back < 0,
    'offers', offers, 'voids', voids);
end $$;

-- preview for the return screen
create or replace function public.return_preview(p_token text, p_sale uuid, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sa public.sales;
begin
  s := public._session(p_token); perform public._require(s,'returns','a');
  select * into sa from public.sales where id = p_sale;
  if sa.id is null then raise exception 'SALE_NOT_RETURNABLE'; end if;
  if not public._loc_ok(s, sa.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  return public._return_calc(p_sale, p_lines) - 'voids';
end $$;

-- same as before, with the offer rules above
create or replace function public.return_post(p_token text, p_sale uuid, p_lines jsonb, p_reason text, p_refund text, p_approver_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; sa public.sales; sl public.sale_lines; ln jsonb; lc numeric; cst numeric := 0; calc jsonb; net numeric;
        rid uuid; no text; appr public.staff; sh public.shifts; approver uuid; v jsonb;
begin
  s := public._session(p_token); perform public._require(s,'returns','a');
  if coalesce(length(trim(p_reason)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into sa from public.sales where id = p_sale for update;
  if sa.id is null or sa.status <> 'posted' then raise exception 'SALE_NOT_RETURNABLE'; end if;
  if not public._loc_ok(s, sa.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  calc := public._return_calc(p_sale, p_lines);
  if (calc->>'amount')::numeric <= 0 then raise exception 'NOTHING_TO_RETURN'; end if;
  if (calc->>'blocked')::boolean then raise exception 'OFFER_RETURN_BLOCKED:%', -(calc->>'net')::numeric; end if;
  net := (calc->>'net')::numeric;
  if public._can(s.role_id,'returns','p') then approver := s.staff_id;
  else
    select stf.* into appr from public.staff stf where stf.active and stf.id <> s.staff_id and stf.pin_hash = crypt(coalesce(p_approver_pin,''), stf.pin_hash)
       and public._can(stf.role_id,'returns','p') limit 1;
    if appr.id is null then raise exception 'APPROVER_NOT_VALID'; end if;
    approver := appr.id;
  end if;
  if p_refund <> 'credit' and net > 0 then
    select * into sh from public.shifts where drawer_id = public._drawer_of(s.device_location) and status = 'open';
    if sh.id is null then raise exception 'NO_OPEN_SHIFT'; end if;
  end if;
  no := 'RT-' || lpad(nextval('public.return_no_seq')::text, 5, '0');
  insert into public.returns (no, sale_id, location_id, shift_id, staff_id, approved_by, reason, refund_method, amount, offer_back)
  values (no, sa.id, sa.location_id, sh.id, s.staff_id, approver, p_reason, p_refund, 0, (calc->>'offer_back')::numeric) returning id into rid;
  for ln in select * from jsonb_array_elements(calc->'lines') loop
    select * into sl from public.sale_lines where id = (ln->>'sale_line_id')::bigint;
    lc := round(sl.cost / sl.qty * (ln->>'qty')::numeric, 2);
    insert into public.return_lines (return_id, sale_line_id, item_id, qty, amount, cost, condition, serial)
    values (rid, sl.id, sl.item_id, (ln->>'qty')::numeric, (ln->>'amount')::numeric, lc, ln->>'condition', sl.serial);
    if ln->>'condition' = 'resell' then
      perform public._fifo_in(sl.item_id, sa.location_id, (ln->>'qty')::numeric, sl.cost / sl.qty, no);
      insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (sl.item_id, sa.location_id, (ln->>'qty')::numeric, lc, 'return', 'return', no, s.staff_id);
      if sl.serial is not null then update public.serials set status = 'in_stock', sale_id = null, location_id = sa.location_id where serial = sl.serial; end if;
    else
      insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (sl.item_id, sa.location_id, 0, lc, 'waste', 'return', no || ' تالف', s.staff_id);
      if sl.serial is not null then update public.serials set status = 'returned_to_supplier', sale_id = null where serial = sl.serial; end if;
    end if;
    cst := cst + lc;
  end loop;
  for v in select * from jsonb_array_elements(calc->'voids') loop
    insert into public.offer_voids (sale_line_id, offer_id, return_id, charged) values ((v->>'sale_line_id')::bigint, (v->>'offer_id')::int, rid, (v->>'charged')::numeric)
    on conflict (sale_line_id) do nothing;
  end loop;
  update public.returns set amount = net, cost = cst where id = rid;
  if p_refund <> 'credit' and net > 0 then
    insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, note, staff_id)
    values (sh.drawer_id, -net, 'refund', p_refund, sh.id, 'return', no, 'مرتجع ' || sa.no, s.staff_id);
  end if;
  perform public._audit(s,'مرتجع',no||' · '||sa.no,null,net::text,
    p_reason || case when (calc->>'offer_back')::numeric > 0 then ' · اتلغى خصم عرض ' || (calc->>'offer_back') else '' end || coalesce(' · بموافقة '||appr.name,''), sa.location_id);
  return jsonb_build_object('id', rid, 'no', no, 'amount', net, 'offer_back', (calc->>'offer_back')::numeric);
end $$;

revoke execute on function public._offer_is_group(int), public._return_calc(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.return_preview(text, uuid, jsonb) from public, anon;
grant execute on function public.return_preview(text, uuid, jsonb) to authenticated;
