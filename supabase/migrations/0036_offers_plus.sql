-- 0036 · more offers and discounts (owner's choices)
-- · an offer can target any mix of items, groups and departments (scope 'mix', refs 'i:<item>', 'g:<group>', 'd:<dept>').
-- · new kinds: fixed (one price per piece), tier (more pieces → bigger %), mixmatch (any N pieces for a set amount),
--   cross (buy from A → % off B), spend_gift (invoice over an amount → a gift), inv_tier (invoice % by invoice size).
-- · saved offer formulas the owner can reuse as buttons.
-- · quick discount buttons for the cashier (percent only, same limits and approvals as today).
-- · a customer group can carry a fixed discount %: chosen at the till it needs no approval up to that %;
--   like the manual discount it applies to the whole invoice after offers.

alter table public.offers add column if not exists tiers jsonb;
alter table public.offers add column if not exists refs2 text[];
alter table public.offers drop constraint if exists offers_kind_check;
alter table public.offers add constraint offers_kind_check check (kind in ('pct','amount','bxgy','bundle','gift','nth','fixed','tier','mixmatch','cross','spend_gift','inv_tier'));
alter table public.offers drop constraint if exists offers_scope_check;
alter table public.offers add constraint offers_scope_check check (scope in ('item','group','dept','invoice','bundle','mix'));

create or replace function public._ref_hit(p_refs text[], p_scope text, p_item uuid, p_group int, p_dept int) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(case p_scope when 'item' then p_item::text = any(p_refs) when 'bundle' then p_item::text = any(p_refs)
                     when 'group' then p_group::text = any(p_refs) when 'dept' then p_dept::text = any(p_refs)
                     when 'mix' then ('i:' || p_item) = any(p_refs) or coalesce(('g:' || p_group) = any(p_refs), false) or coalesce(('d:' || p_dept) = any(p_refs), false)
                     else true end, false)
$$;
create or replace function public._offer_hits(o public.offers, p_item uuid, p_group int, p_dept int) returns boolean
language sql immutable set search_path = public as $$
  select public._ref_hit(o.refs, o.scope, p_item, p_group, p_dept) and (o.kind not in ('gift','spend_gift') or p_item is distinct from o.gift_item);
$$;
create or replace function public._tier_pct(p_tiers jsonb, p_amount numeric) returns numeric
language sql immutable set search_path = public as $$
  select coalesce((select max(least((t->>'pct')::numeric, 100)) from jsonb_array_elements(coalesce(p_tiers, '[]'::jsonb)) t where (t->>'min')::numeric <= p_amount), 0)
$$;

create or replace function public._offer_is_group(p_offer int) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select o.kind in ('bxgy','bundle','gift','nth','tier','mixmatch','cross','spend_gift','inv_tier') or o.scope = 'invoice' from public.offers o where o.id = p_offer), false)
$$;

create or replace function public._offer_price(p_lines jsonb, p_loc smallint, p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int := coalesce(jsonb_array_length(p_lines),0); i int; j int; o public.offers;
        iid uuid[] := '{}'; q numeric[] := '{}'; pr numeric[] := '{}'; d numeric[] := '{}'; ofid int[] := '{}'; onm text[] := '{}'; cl boolean[] := '{}'; grp int[] := '{}'; dep int[] := '{}';
        units numeric; free numeric; k numeric; u numeric; setv numeric; refv text; base numeric; dd numeric; acc numeric; lst int; idx int[]; ridx int[]; rr record;
        uidx int[]; upr numeric[]; nb int; sets int; pc numeric; part numeric; hit boolean[];
        inv jsonb := null; res jsonb := '[]';
begin
  for i in 1..n loop
    iid := iid || ((p_lines->(i-1))->>'item_id')::uuid; q := q || ((p_lines->(i-1))->>'qty')::numeric; pr := pr || ((p_lines->(i-1))->>'price')::numeric;
    d := d || 0::numeric; ofid := ofid || null::int; onm := onm || null::text; cl := cl || false;
    select it.group_id, it.department_id into rr from public.items it where it.id = iid[i];
    grp := grp || rr.group_id; dep := dep || rr.department_id;
  end loop;
  for o in select * from public.offers where status = 'active' and scope <> 'invoice' order by priority desc, id loop
    if not public._offer_live(o, p_loc, p_at) then continue; end if;
    if o.kind in ('pct','amount','fixed') then
      for i in 1..n loop
        if cl[i] or not public._offer_hits(o, iid[i], grp[i], dep[i]) then continue; end if;
        if o.kind = 'fixed' and pr[i] <= o.value then continue; end if;
        d[i] := round(case o.kind when 'pct' then pr[i] * q[i] * least(o.value,100) / 100 when 'amount' then least(pr[i], o.value) * q[i] else (pr[i] - o.value) * q[i] end, 2);
        ofid[i] := o.id; onm[i] := o.name; cl[i] := true;
      end loop;
    elsif o.kind = 'tier' then        -- the more pieces from the targets, the bigger the % on all of them
      units := 0; idx := '{}';
      for i in 1..n loop
        if cl[i] or not public._offer_hits(o, iid[i], grp[i], dep[i]) then continue; end if;
        units := units + q[i]; idx := idx || i;
      end loop;
      pc := public._tier_pct(o.tiers, units);
      if cardinality(idx) = 0 or pc <= 0 then continue; end if;
      foreach j in array idx loop d[j] := round(pr[j] * q[j] * pc / 100, 2); ofid[j] := o.id; onm[j] := o.name; cl[j] := true; end loop;
    elsif o.kind in ('bxgy','nth') then
      idx := '{}'; units := 0;
      for rr in select g.i from generate_series(1,n) g(i) order by pr[g.i], g.i loop
        if cl[rr.i] or not public._offer_hits(o, iid[rr.i], grp[rr.i], dep[rr.i]) then continue; end if;
        idx := idx || rr.i; units := units + floor(q[rr.i]);
      end loop;
      if cardinality(idx) = 0 or coalesce(o.buy_qty,0) < 1 or coalesce(o.get_qty,0) < 1 then continue; end if;
      free := floor(units / (o.buy_qty + o.get_qty)) * o.get_qty;
      if free <= 0 then continue; end if;
      foreach j in array idx loop        -- cheapest units first
        u := least(floor(q[j]), free); free := free - u;      -- every target line is part of the offer (paid or free)
        d[j] := round(u * pr[j] * case when o.kind = 'nth' then least(o.value,100) / 100 else 1 end, 2); ofid[j] := o.id; onm[j] := o.name; cl[j] := true;
      end loop;
    elsif o.kind = 'mixmatch' then     -- any N pieces from the targets for a set amount (dearest pieces first)
      nb := floor(coalesce(o.buy_qty,0))::int;
      if nb < 2 or o.value <= 0 then continue; end if;
      uidx := '{}'; upr := '{}';
      for rr in select g.i from generate_series(1,n) g(i) order by pr[g.i] desc, g.i loop
        if cl[rr.i] or not public._offer_hits(o, iid[rr.i], grp[rr.i], dep[rr.i]) then continue; end if;
        for j in 1..floor(q[rr.i])::int loop uidx := uidx || rr.i; upr := upr || pr[rr.i]; end loop;
      end loop;
      sets := floor(cardinality(uidx)::numeric / nb)::int;
      if sets < 1 then continue; end if;
      hit := array_fill(false, array[n]);
      for k in 0..sets-1 loop
        setv := 0; for j in 1..nb loop setv := setv + upr[k * nb + j]; end loop;
        if setv <= o.value then continue; end if;
        dd := setv - o.value; acc := 0;
        for j in 1..nb loop
          lst := uidx[k * nb + j];
          part := case when j = nb then dd - acc else round(dd * upr[k * nb + j] / setv, 2) end;
          d[lst] := d[lst] + part; acc := acc + part; hit[lst] := true;
        end loop;
      end loop;
      for i in 1..n loop if hit[i] then ofid[i] := o.id; onm[i] := o.name; cl[i] := true; end if; end loop;
    elsif o.kind = 'cross' then        -- every N pieces from A → M pieces from B at value% off (cheapest of B first)
      if o.refs2 is null or cardinality(o.refs2) = 0 or coalesce(o.buy_qty,0) < 1 or coalesce(o.get_qty,0) < 1 then continue; end if;
      idx := '{}'; units := 0; ridx := '{}';
      for i in 1..n loop
        if cl[i] or not public._offer_hits(o, iid[i], grp[i], dep[i]) then continue; end if;
        idx := idx || i; units := units + floor(q[i]);
      end loop;
      for rr in select g.i from generate_series(1,n) g(i) order by pr[g.i], g.i loop
        if cl[rr.i] or rr.i = any(idx) or not public._ref_hit(o.refs2, 'mix', iid[rr.i], grp[rr.i], dep[rr.i]) then continue; end if;
        ridx := ridx || rr.i;
      end loop;
      free := floor(units / o.buy_qty) * o.get_qty;
      if free <= 0 or cardinality(ridx) = 0 then continue; end if;
      k := 0;
      foreach j in array ridx loop
        u := least(floor(q[j]), free); free := free - u;
        if u <= 0 then continue; end if;
        d[j] := round(u * pr[j] * least(o.value,100) / 100, 2); ofid[j] := o.id; onm[j] := o.name; cl[j] := true; k := k + u;
      end loop;
      if k > 0 then foreach j in array idx loop ofid[j] := o.id; onm[j] := o.name; cl[j] := true; end loop; end if;
    elsif o.kind = 'bundle' then
      k := null; setv := 0;
      foreach refv in array o.refs loop
        select coalesce(sum(floor(q[g.i])),0), max(pr[g.i]) into units, base from generate_series(1,n) g(i) where not cl[g.i] and iid[g.i]::text = refv;
        if units = 0 then k := 0; exit; end if;
        k := least(coalesce(k, units), units); setv := setv + base;
      end loop;
      if coalesce(k,0) = 0 or setv <= o.value then continue; end if;
      foreach refv in array o.refs loop
        u := k;
        for i in 1..n loop
          if cl[i] or iid[i]::text <> refv or u <= 0 then continue; end if;
          dd := least(floor(q[i]), u); u := u - dd;
          d[i] := round(dd * pr[i] * (1 - o.value / setv), 2); ofid[i] := o.id; onm[i] := o.name; cl[i] := true;
        end loop;
      end loop;
    elsif o.kind = 'gift' then
      if o.gift_item is null then continue; end if;
      units := 0; idx := '{}';
      for i in 1..n loop
        if cl[i] or not public._offer_hits(o, iid[i], grp[i], dep[i]) then continue; end if;
        units := units + floor(q[i]); idx := idx || i;
      end loop;
      free := floor(units / greatest(coalesce(o.buy_qty,1),1)) * greatest(coalesce(o.get_qty,1),1);
      if free <= 0 then continue; end if;
      k := 0;
      for i in 1..n loop
        if cl[i] or iid[i] <> o.gift_item or free <= 0 then continue; end if;
        u := least(floor(q[i]), free); free := free - u; k := k + u;
        d[i] := round(u * pr[i], 2); ofid[i] := o.id; onm[i] := o.name; cl[i] := true;
      end loop;
      if k > 0 then foreach j in array idx loop ofid[j] := o.id; onm[j] := o.name; cl[j] := true; end loop; end if;
    end if;
  end loop;
  -- gifts for an invoice over an amount (counted on what no item offer touched, without the gift itself)
  for o in select * from public.offers where status = 'active' and kind = 'spend_gift' order by priority desc, id loop
    if not public._offer_live(o, p_loc, p_at) or o.gift_item is null then continue; end if;
    base := 0; for i in 1..n loop if not cl[i] and iid[i] <> o.gift_item then base := base + pr[i] * q[i]; end if; end loop;
    if base < coalesce(o.min_total, 0) or base <= 0 then continue; end if;
    free := greatest(coalesce(o.get_qty,1),1);
    for i in 1..n loop
      if cl[i] or iid[i] <> o.gift_item or free <= 0 then continue; end if;
      u := least(floor(q[i]), free); free := free - u;
      if u <= 0 then continue; end if;
      d[i] := round(u * pr[i], 2); ofid[i] := o.id; onm[i] := o.name; cl[i] := true;
    end loop;
  end loop;
  -- one invoice offer, on what no item offer touched
  base := 0; for i in 1..n loop if not cl[i] then base := base + pr[i] * q[i]; end if; end loop;
  if base > 0 then
    for o in select * from public.offers where status = 'active' and scope = 'invoice' and kind in ('pct','amount','inv_tier') order by priority desc, id loop
      if not public._offer_live(o, p_loc, p_at) or base < coalesce(o.min_total,0) then continue; end if;
      dd := round(case o.kind when 'pct' then base * least(o.value,100) / 100 when 'amount' then least(o.value, base) else base * public._tier_pct(o.tiers, base) / 100 end, 2);
      if dd <= 0 then continue; end if;
      acc := 0; lst := null;
      for i in 1..n loop
        if cl[i] then continue; end if;
        d[i] := round(dd * pr[i] * q[i] / base, 2); acc := acc + d[i]; ofid[i] := o.id; onm[i] := o.name; lst := i;
      end loop;
      d[lst] := d[lst] + (dd - acc);
      inv := jsonb_build_object('d', dd, 'o', o.id, 'n', o.name);
      exit;
    end loop;
  end if;
  for i in 1..n loop res := res || jsonb_build_object('d', d[i], 'o', ofid[i], 'n', onm[i]); end loop;
  return jsonb_build_object('lines', res, 'inv', inv, 'total', (select coalesce(sum(x),0) from unnest(d) x));
end $$;

create or replace function public._offer_margins(o public.offers) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare wc numeric := coalesce((select max(rate) from public.finance_plans where active and payer = 'store'),0); mm numeric := (select min_margin_pct from public.store where id = 1);
        setv numeric; gc numeric; it record; net numeric; na numeric; wl jsonb := '[]'; m numeric; o2 public.offers := o; tp numeric;
begin
  if (o.scope = 'invoice' and o.kind = 'amount') or o.kind = 'spend_gift' then return jsonb_build_object('worst_comm', wc, 'min_margin', mm, 'rows', wl); end if;
  if o.kind = 'bundle' then select sum(sale_price) into setv from public.items where id::text = any(o.refs); end if;
  if o.kind = 'gift' then select last_cost into gc from public.items where id = o.gift_item; end if;
  if o.kind = 'cross' then o2.refs := o.refs2; o2.scope := 'mix'; end if;
  tp := (select coalesce(max((t->>'pct')::numeric), 0) from jsonb_array_elements(coalesce(o.tiers, '[]'::jsonb)) t);
  for it in select i.id, i.name, i.sale_price, i.last_cost from public.items i
             where not i.hidden and i.last_cost > 0 and public._offer_hits(o2, i.id, i.group_id, i.department_id) order by i.name limit 2000 loop
    net := case o.kind when 'pct' then it.sale_price * (1 - least(o.value,100) / 100)
                       when 'amount' then it.sale_price - least(o.value, it.sale_price)
                       when 'fixed' then least(it.sale_price, o.value)
                       when 'tier' then it.sale_price * (1 - least(tp,100) / 100)
                       when 'inv_tier' then it.sale_price * (1 - least(tp,100) / 100)
                       when 'mixmatch' then least(it.sale_price, o.value / greatest(coalesce(o.buy_qty,1),1))
                       when 'cross' then it.sale_price * (1 - least(o.value,100) / 100)
                       when 'bxgy' then it.sale_price * o.buy_qty / nullif(o.buy_qty + o.get_qty,0)
                       when 'nth' then it.sale_price * (o.buy_qty + o.get_qty * (1 - least(o.value,100) / 100)) / nullif(o.buy_qty + o.get_qty,0)
                       when 'bundle' then it.sale_price * o.value / nullif(setv,0)
                       when 'gift' then it.sale_price - coalesce(gc,0) * coalesce(o.get_qty,1) / greatest(coalesce(o.buy_qty,1),1) end;
    na := round(net * (1 - wc / 100), 2);
    m := case when na > 0 then round((na - it.last_cost) / na * 100, 1) end;
    if na < it.last_cost or m < mm then
      wl := wl || jsonb_build_object('item', it.name, 'net', na, 'cost', it.last_cost, 'margin', m, 'level', case when na < it.last_cost then 'cost' else 'margin' end);
    end if;
  end loop;
  return jsonb_build_object('worst_comm', wc, 'min_margin', mm, 'rows', wl);
end $$;

create or replace function public._mix_refs_ok(p_refs text[]) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(bool_and(r ~ '^(i:[0-9a-f-]{36}|g:[0-9]+|d:[0-9]+)$'), false) from unnest(p_refs) r
$$;
create or replace function public._tiers_ok(p_tiers jsonb, p_money boolean) returns boolean
language plpgsql immutable set search_path = public as $$
declare t jsonb; n int := 0; mins numeric[] := '{}';
begin
  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) = 0 or jsonb_array_length(p_tiers) > 10 then return false; end if;
  for t in select * from jsonb_array_elements(p_tiers) loop
    if (t->>'min') is null or (t->>'pct') is null or (t->>'min')::numeric <= 0 or not ((t->>'pct')::numeric > 0 and (t->>'pct')::numeric <= 100) then return false; end if;
    if not p_money and (t->>'min')::numeric % 1 <> 0 then return false; end if;
    if (t->>'min')::numeric = any(mins) then return false; end if;
    mins := mins || (t->>'min')::numeric;
  end loop;
  return true;
exception when others then return false;
end $$;

create or replace function public.offer_save(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; o public.offers; prev public.offers; mg jsonb; c text;
begin
  s := public._session(p_token);
  o := jsonb_populate_record(null::public.offers, p);
  if o.id is not null then
    select * into prev from public.offers where id = o.id for update;
    if prev.id is null then raise exception 'NOT_FOUND'; end if;
    if not (s.role_id in ('owner','gm') or public._can(s.role_id,'offers','e')) then raise exception 'NOT_ALLOWED:offers'; end if;
    o.status := prev.status; o.created_by := prev.created_by; o.created_at := prev.created_at;
  else
    if not (s.role_id in ('owner','gm') or public._can(s.role_id,'offers','a')) then raise exception 'NOT_ALLOWED:offers'; end if;
    o.status := 'active'; o.created_by := s.staff_id; o.created_at := now();
  end if;
  o.starts_at := coalesce(o.starts_at, now()); o.priority := coalesce(o.priority, 1); o.refs := coalesce(o.refs, '{}'); o.value := coalesce(o.value, 0);
  if o.kind not in ('cross') then o.refs2 := null; end if;
  if o.kind not in ('tier','inv_tier') then o.tiers := null; end if;
  if coalesce(trim(o.name),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if o.ends_at is not null and o.ends_at <= o.starts_at then raise exception 'BAD_DATES'; end if;
  if o.scope <> 'invoice' and cardinality(o.refs) = 0 then raise exception 'OFFER_TARGET_REQUIRED'; end if;
  if o.scope = 'mix' and not public._mix_refs_ok(o.refs) then raise exception 'BAD_OFFER'; end if;
  if (o.kind = 'bundle') <> (o.scope = 'bundle') then raise exception 'BAD_OFFER'; end if;
  if o.kind = 'bundle' and (cardinality(o.refs) < 2 or o.value <= 0) then raise exception 'BUNDLE_NEEDS_ITEMS'; end if;
  if o.scope = 'invoice' and o.kind not in ('pct','amount','inv_tier','spend_gift') then raise exception 'BAD_OFFER'; end if;
  if o.kind in ('inv_tier','spend_gift') and o.scope <> 'invoice' then raise exception 'BAD_OFFER'; end if;
  if o.kind in ('pct','cross','nth') and not (o.value > 0 and o.value <= 100) then raise exception 'BAD_AMOUNT'; end if;
  if o.kind in ('amount','fixed','mixmatch') and o.value <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if o.kind in ('bxgy','nth','cross') and (coalesce(o.buy_qty,0) < 1 or coalesce(o.get_qty,0) < 1 or o.buy_qty % 1 <> 0 or o.get_qty % 1 <> 0) then raise exception 'BAD_QTY'; end if;
  if o.kind = 'mixmatch' and (coalesce(o.buy_qty,0) < 2 or o.buy_qty % 1 <> 0) then raise exception 'BAD_QTY'; end if;
  if o.kind in ('tier','inv_tier') and not public._tiers_ok(o.tiers, o.kind = 'inv_tier') then raise exception 'BAD_TIERS'; end if;
  if o.kind = 'cross' and (o.refs2 is null or cardinality(o.refs2) = 0 or not public._mix_refs_ok(o.refs2)) then raise exception 'OFFER_TARGET_REQUIRED'; end if;
  if o.kind in ('gift','spend_gift') and o.gift_item is null then raise exception 'GIFT_REQUIRED'; end if;
  if o.kind = 'spend_gift' and coalesce(o.min_total,0) <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if o.hour_from is not null and o.hour_to is not null and o.hour_from = o.hour_to then raise exception 'BAD_DATES'; end if;
  c := public._offer_overlap(o);
  if c is not null then raise exception 'OFFER_OVERLAP:%', c; end if;
  mg := public._offer_margins(o);
  if jsonb_array_length(mg->'rows') > 0 then
    if not coalesce((p->>'confirm')::boolean, false) then return jsonb_build_object('ok', false, 'check', mg); end if;
    if exists (select 1 from jsonb_array_elements(mg->'rows') x where x->>'level' = 'cost') and s.role_id not in ('owner','gm') then raise exception 'BELOW_COST_NEEDS_OWNER'; end if;
  end if;
  o.updated_at := now();
  if o.id is null then
    o.id := nextval(pg_get_serial_sequence('public.offers','id'));
    insert into public.offers select o.*;
  else
    update public.offers set name = o.name, kind = o.kind, scope = o.scope, refs = o.refs, refs2 = o.refs2, tiers = o.tiers, value = o.value, buy_qty = o.buy_qty, get_qty = o.get_qty, gift_item = o.gift_item,
      min_total = o.min_total, locs = o.locs, starts_at = o.starts_at, ends_at = o.ends_at, days = o.days, hour_from = o.hour_from, hour_to = o.hour_to,
      priority = o.priority, note = o.note, updated_at = now() where id = o.id;
  end if;
  perform public._audit(s, case when prev.id is null then 'إنشاء عرض' else 'تعديل عرض' end, o.name, case when prev.id is null then null else to_jsonb(prev)::text end, to_jsonb(o)::text,
    case when jsonb_array_length(mg->'rows') > 0 then 'اتأكد رغم تحذير الهامش' end, null);
  return jsonb_build_object('ok', true, 'id', o.id);
end $$;

-- ---------- saved offer formulas ----------
create table if not exists public.offer_templates (
  id serial primary key,
  name text not null check (char_length(name) between 1 and 60),
  section text not null default 'offer' check (section in ('offer','disc')),
  body jsonb not null,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
alter table public.offer_templates enable row level security;
revoke all on public.offer_templates from anon;
revoke insert, update, delete, truncate on public.offer_templates from authenticated;

create or replace function public.offer_tpls(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'offers','v')) then raise exception 'NOT_ALLOWED:offers'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'section', section, 'body', body) order by section, name) from public.offer_templates), '[]'::jsonb);
end $$;
create or replace function public.offer_tpl_save(p_token text, p_name text, p_section text, p_body jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid int; b jsonb;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'offers','a')) then raise exception 'NOT_ALLOWED:offers'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if (select count(*) from public.offer_templates) >= 60 then raise exception 'TOO_MANY_ROWS'; end if;
  -- only the formula is kept: no dates, places, status or ids
  b := coalesce(p_body, '{}'::jsonb) - array['id','status','starts_at','ends_at','created_by','created_at','updated_at','confirm'];
  if jsonb_typeof(b) <> 'object' or (b->>'kind') is null then raise exception 'BAD_OFFER'; end if;
  insert into public.offer_templates (name, section, body, created_by) values (left(btrim(p_name), 60), case when p_section = 'disc' then 'disc' else 'offer' end, b, s.staff_id) returning id into nid;
  perform public._audit(s, 'صيغة عرض جديدة', btrim(p_name), null, null, null, null);
  return nid;
end $$;
create or replace function public.offer_tpl_del(p_token text, p_id int) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; nm text;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'offers','e')) then raise exception 'NOT_ALLOWED:offers'; end if;
  delete from public.offer_templates where id = p_id returning name into nm;
  if nm is null then raise exception 'NOT_FOUND'; end if;
  perform public._audit(s, 'حذف صيغة عرض', nm, null, null, null, null);
end $$;

-- ---------- quick discount buttons for the cashier ----------
alter table public.store add column if not exists quick_disc numeric[] not null default '{5,10}';
create or replace function public.store_quick_disc_save(p_token text, p_vals jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; v numeric[];
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm') then raise exception 'NOT_ALLOWED:settings'; end if;
  if jsonb_typeof(p_vals) <> 'array' then raise exception 'BAD_VALUE'; end if;
  select coalesce(array_agg(distinct round(x::numeric, 2) order by round(x::numeric, 2)), '{}') into v from jsonb_array_elements_text(p_vals) x;
  if cardinality(v) > 8 or exists (select 1 from unnest(v) x where not (x > 0 and x <= 100)) then raise exception 'BAD_VALUE'; end if;
  update public.store set quick_disc = v where id = 1;
  perform public._audit(s, 'أزرار الخصم السريع', 'الإعدادات', null, array_to_string(v, '٪ · ') || '٪', null, null);
end $$;

-- ---------- a fixed discount for a customer group ----------
alter table public.customer_groups add column if not exists discount_pct numeric(5,2) not null default 0;
alter table public.customer_groups drop constraint if exists customer_groups_discount_pct_check;
alter table public.customer_groups add constraint customer_groups_discount_pct_check check (discount_pct >= 0 and discount_pct <= 100);

create or replace function public._cust_group_disc(p_phone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('pct', g.discount_pct, 'group', g.name)
                     from public.customers c join public.customer_group_members m on m.customer_id = c.id join public.customer_groups g on g.id = m.group_id
                    where c.phone = nullif(regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'), '') and g.discount_pct > 0
                    order by g.discount_pct desc limit 1), jsonb_build_object('pct', 0, 'group', null))
$$;
create or replace function public.cust_group_disc(p_token text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._require(s,'pos','v');
  return public._cust_group_disc(p_phone);
end $$;
create or replace function public.cust_group_disc_set(p_token text, p_group int, p_pct numeric) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; g public.customer_groups;
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm') then raise exception 'NOT_ALLOWED:offers'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then raise exception 'BAD_VALUE'; end if;
  select * into g from public.customer_groups where id = p_group for update;
  if g.id is null then raise exception 'NOT_FOUND'; end if;
  update public.customer_groups set discount_pct = round(p_pct, 2) where id = g.id;
  perform public._audit(s, 'خصم مجموعة عملاء', g.name, g.discount_pct::text || '٪', round(p_pct, 2)::text || '٪', null, null);
end $$;
create or replace function public.cust_groups(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._cx_right(s);
  return coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'note',g.note,'at',g.created_at,'discount_pct',g.discount_pct,
            'members',(select coalesce(jsonb_agg(m.customer_id),'[]'::jsonb) from public.customer_group_members m where m.group_id = g.id)) order by g.name)
          from public.customer_groups g), '[]'::jsonb);
end $$;

-- the till: a group discount needs no approval up to the group's %; above that, the usual approval
do $$
declare def text := pg_get_functiondef('public.sale_post(text, jsonb)'::regprocedure); nd text;
begin
  if position('_cust_group_disc' in def) > 0 then return; end if;
  nd := replace(def, '  if dp > maxd then', '  maxd := greatest(maxd, coalesce((public._cust_group_disc(p->''customer''->>''phone'')->>''pct'')::numeric, 0));' || chr(10) || '  if dp > maxd then');
  if nd = def then raise exception 'sale_post: discount check not found'; end if;
  execute nd;
end $$;

revoke execute on function public._ref_hit(text[], text, uuid, int, int), public._tier_pct(jsonb, numeric), public._mix_refs_ok(text[]), public._tiers_ok(jsonb, boolean), public._cust_group_disc(text) from public, anon, authenticated;
revoke execute on function public.offer_tpls(text), public.offer_tpl_save(text, text, text, jsonb), public.offer_tpl_del(text, int), public.store_quick_disc_save(text, jsonb),
  public.cust_group_disc(text, text), public.cust_group_disc_set(text, int, numeric), public.cust_groups(text) from public, anon;
grant execute on function public.offer_tpls(text), public.offer_tpl_save(text, text, text, jsonb), public.offer_tpl_del(text, int), public.store_quick_disc_save(text, jsonb),
  public.cust_group_disc(text, text), public.cust_group_disc_set(text, int, numeric), public.cust_groups(text) to authenticated;
