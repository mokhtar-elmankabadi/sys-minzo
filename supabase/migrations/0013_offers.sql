-- 0013 · offers engine: priced on the server inside sale_post, previewed for the POS, margin guard on save
alter table public.store add column if not exists min_margin_pct numeric(5,2) not null default 10;
alter table public.sale_lines add column if not exists offer_id int;
alter table public.sale_lines add column if not exists offer_disc numeric(14,2) not null default 0;
alter table public.sales add column if not exists offer_disc numeric(14,2) not null default 0;

create table public.offers (
  id serial primary key,
  name text not null,
  kind text not null check (kind in ('pct','amount','bxgy','bundle','gift')),
  scope text not null check (scope in ('item','group','dept','invoice','bundle')),
  refs text[] not null default '{}',            -- item / group / department ids; bundle = its items
  value numeric(14,3) not null default 0,       -- pct → %, amount → EGP per unit (or off the invoice), bundle → set price
  buy_qty numeric(10,3), get_qty numeric(10,3), -- bxgy: buy X get Y · gift: every X target units → Y gift units
  gift_item uuid references public.items(id),
  min_total numeric(14,2),                      -- invoice offers: minimum invoice
  locs smallint[],                              -- null = every showroom
  starts_at timestamptz not null default now(), ends_at timestamptz,
  days smallint[],                              -- 0 = Sunday … 6, null = every day
  hour_from time, hour_to time,                 -- time-of-day offers (may wrap past midnight)
  priority int not null default 1,
  status text not null default 'active' check (status in ('active','paused','ended')),
  note text,
  created_by uuid references public.staff(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.offers enable row level security;
create policy "devices read" on public.offers for select to authenticated using (public.is_device());

create or replace function public._offer_live(o public.offers, p_loc smallint, p_at timestamptz) returns boolean
language plpgsql stable set search_path = public as $$
declare t time := (p_at at time zone 'Africa/Cairo')::time; dw int := extract(dow from (p_at at time zone 'Africa/Cairo'))::int;
begin
  if o.status <> 'active' or p_at < o.starts_at or (o.ends_at is not null and p_at >= o.ends_at) then return false; end if;
  if o.locs is not null and cardinality(o.locs) > 0 and not (p_loc = any(o.locs)) then return false; end if;
  if o.days is not null and cardinality(o.days) > 0 and not (dw = any(o.days)) then return false; end if;
  if o.hour_from is not null and o.hour_to is not null then
    if o.hour_from <= o.hour_to then if not (t >= o.hour_from and t < o.hour_to) then return false; end if;
    elsif not (t >= o.hour_from or t < o.hour_to) then return false; end if;
  end if;
  return true;
end $$;

create or replace function public._offer_hits(o public.offers, p_item uuid, p_group int, p_dept int) returns boolean
language sql immutable as $$
  select case o.scope when 'item' then p_item::text = any(o.refs) when 'bundle' then p_item::text = any(o.refs)
                      when 'group' then p_group::text = any(o.refs) when 'dept' then p_dept::text = any(o.refs) else true end
         and (o.kind <> 'gift' or p_item is distinct from o.gift_item);
$$;

-- p_lines: [{item_id, qty, price}, …] → {lines:[{d, o, n}], inv:{d,o,n}, total}
create or replace function public._offer_price(p_lines jsonb, p_loc smallint, p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int := coalesce(jsonb_array_length(p_lines),0); i int; j int; o public.offers;
        iid uuid[] := '{}'; q numeric[] := '{}'; pr numeric[] := '{}'; d numeric[] := '{}'; ofid int[] := '{}'; onm text[] := '{}'; cl boolean[] := '{}'; grp int[] := '{}'; dep int[] := '{}';
        units numeric; free numeric; k numeric; u numeric; setv numeric; refv text; base numeric; dd numeric; acc numeric; lst int; idx int[]; rr record;
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
    if o.kind in ('pct','amount') then
      for i in 1..n loop
        if cl[i] or not public._offer_hits(o, iid[i], grp[i], dep[i]) then continue; end if;
        d[i] := round(case when o.kind = 'pct' then pr[i] * q[i] * least(o.value,100) / 100 else least(pr[i], o.value) * q[i] end, 2);
        ofid[i] := o.id; onm[i] := o.name; cl[i] := true;
      end loop;
    elsif o.kind = 'bxgy' then
      idx := '{}'; units := 0;
      for rr in select g.i from generate_series(1,n) g(i) order by pr[g.i], g.i loop
        if cl[rr.i] or not public._offer_hits(o, iid[rr.i], grp[rr.i], dep[rr.i]) then continue; end if;
        idx := idx || rr.i; units := units + floor(q[rr.i]);
      end loop;
      if cardinality(idx) = 0 or coalesce(o.buy_qty,0) < 1 or coalesce(o.get_qty,0) < 1 then continue; end if;
      free := floor(units / (o.buy_qty + o.get_qty)) * o.get_qty;
      if free <= 0 then continue; end if;
      foreach j in array idx loop        -- cheapest units go free
        u := least(floor(q[j]), free); free := free - u;
        d[j] := round(u * pr[j], 2); ofid[j] := o.id; onm[j] := o.name; cl[j] := true;
      end loop;
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
  -- one invoice offer, on what no item offer touched
  base := 0; for i in 1..n loop if not cl[i] then base := base + pr[i] * q[i]; end if; end loop;
  if base > 0 then
    for o in select * from public.offers where status = 'active' and scope = 'invoice' order by priority desc, id loop
      if not public._offer_live(o, p_loc, p_at) or base < coalesce(o.min_total,0) then continue; end if;
      dd := round(case when o.kind = 'pct' then base * least(o.value,100) / 100 else least(o.value, base) end, 2);
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

create or replace function public.offers_preview(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; arr jsonb := '[]'; ln jsonb; pr numeric;
begin
  s := public._session(p_token); perform public._require(s,'pos','v');
  for ln in select * from jsonb_array_elements(coalesce(p->'lines','[]')) loop
    select sale_price into pr from public.items where id = (ln->>'item_id')::uuid;
    arr := arr || jsonb_build_object('item_id', ln->>'item_id', 'qty', (ln->>'qty')::numeric, 'price', coalesce(pr,0));
  end loop;
  return public._offer_price(arr, s.device_location, now());
exception when others then
  return jsonb_build_object('lines', '[]'::jsonb, 'inv', null, 'total', 0, 'error', true);
end $$;

-- conflicting active offer with the same priority, overlapping dates/places/days and at least one shared item
create or replace function public._offer_overlap(a public.offers) returns text
language sql stable security definer set search_path = public as $$
  select b.name from public.offers b
   where b.status = 'active' and b.id is distinct from a.id and b.priority = a.priority
     and tstzrange(b.starts_at, b.ends_at) && tstzrange(a.starts_at, a.ends_at)
     and (b.locs is null or a.locs is null or cardinality(b.locs) = 0 or cardinality(a.locs) = 0 or b.locs && a.locs)
     and (b.days is null or a.days is null or cardinality(b.days) = 0 or cardinality(a.days) = 0 or b.days && a.days)
     and ((a.scope = 'invoice') = (b.scope = 'invoice'))
     and (a.scope = 'invoice' or exists (select 1 from public.items i where not i.hidden
            and public._offer_hits(a, i.id, i.group_id, i.department_id) and public._offer_hits(b, i.id, i.group_id, i.department_id)))
   limit 1;
$$;

-- worst-case unit margin per targeted item, after the highest instalment commission the store may pay
create or replace function public._offer_margins(o public.offers) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare wc numeric := coalesce((select max(rate) from public.finance_plans where active and payer = 'store'),0); mm numeric := (select min_margin_pct from public.store where id = 1);
        setv numeric; gc numeric; it record; net numeric; na numeric; wl jsonb := '[]'; m numeric;
begin
  if o.scope = 'invoice' and o.kind = 'amount' then return jsonb_build_object('worst_comm', wc, 'min_margin', mm, 'rows', wl); end if;
  if o.kind = 'bundle' then select sum(sale_price) into setv from public.items where id::text = any(o.refs); end if;
  if o.kind = 'gift' then select last_cost into gc from public.items where id = o.gift_item; end if;
  for it in select i.id, i.name, i.sale_price, i.last_cost from public.items i
             where not i.hidden and i.last_cost > 0 and public._offer_hits(o, i.id, i.group_id, i.department_id) order by i.name limit 2000 loop
    net := case o.kind when 'pct' then it.sale_price * (1 - least(o.value,100) / 100)
                       when 'amount' then it.sale_price - least(o.value, it.sale_price)
                       when 'bxgy' then it.sale_price * o.buy_qty / nullif(o.buy_qty + o.get_qty,0)
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

create or replace function public.offer_save(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; o public.offers; prev public.offers; mg jsonb; c text; nid int;
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
  if coalesce(trim(o.name),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if o.ends_at is not null and o.ends_at <= o.starts_at then raise exception 'BAD_DATES'; end if;
  if o.scope <> 'invoice' and cardinality(o.refs) = 0 then raise exception 'OFFER_TARGET_REQUIRED'; end if;
  if (o.kind = 'bundle') <> (o.scope = 'bundle') then raise exception 'BAD_OFFER'; end if;
  if o.kind = 'bundle' and (cardinality(o.refs) < 2 or o.value <= 0) then raise exception 'BUNDLE_NEEDS_ITEMS'; end if;
  if o.scope = 'invoice' and o.kind not in ('pct','amount') then raise exception 'BAD_OFFER'; end if;
  if o.kind = 'pct' and not (o.value > 0 and o.value <= 100) then raise exception 'BAD_AMOUNT'; end if;
  if o.kind = 'amount' and o.value <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if o.kind = 'bxgy' and (coalesce(o.buy_qty,0) < 1 or coalesce(o.get_qty,0) < 1) then raise exception 'BAD_QTY'; end if;
  if o.kind = 'gift' and o.gift_item is null then raise exception 'GIFT_REQUIRED'; end if;
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
    update public.offers set name = o.name, kind = o.kind, scope = o.scope, refs = o.refs, value = o.value, buy_qty = o.buy_qty, get_qty = o.get_qty, gift_item = o.gift_item,
      min_total = o.min_total, locs = o.locs, starts_at = o.starts_at, ends_at = o.ends_at, days = o.days, hour_from = o.hour_from, hour_to = o.hour_to,
      priority = o.priority, note = o.note, updated_at = now() where id = o.id;
  end if;
  perform public._audit(s, case when prev.id is null then 'إنشاء عرض' else 'تعديل عرض' end, o.name, case when prev.id is null then null else to_jsonb(prev)::text end, to_jsonb(o)::text,
    case when jsonb_array_length(mg->'rows') > 0 then 'اتأكد رغم تحذير الهامش' end, null);
  return jsonb_build_object('ok', true, 'id', o.id);
end $$;

create or replace function public.offer_set_status(p_token text, p_id int, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; o public.offers; c text;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'offers','e')) then raise exception 'NOT_ALLOWED:offers'; end if;
  if p_status not in ('active','paused','ended') then raise exception 'BAD_STATUS'; end if;
  select * into o from public.offers where id = p_id for update;
  if o.id is null or o.status = 'ended' then raise exception 'BAD_STATUS'; end if;
  if p_status = 'active' then o.status := 'active'; c := public._offer_overlap(o); if c is not null then raise exception 'OFFER_OVERLAP:%', c; end if; end if;
  update public.offers set status = p_status, ends_at = case when p_status = 'ended' and (ends_at is null or ends_at > now()) then now() else ends_at end, updated_at = now() where id = p_id;
  perform public._audit(s, case p_status when 'active' then 'تشغيل عرض' when 'paused' then 'إيقاف عرض مؤقتًا' else 'إنهاء عرض' end, o.name, null, null, null, null);
end $$;

-- ---------- sale_post: items priced by the offers engine (if it fails the sale goes on at normal prices) ----------
create or replace function public.sale_post(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; sh public.shifts; st public.store; it public.items; ln jsonb; pay jsonb; ex public.sales; pl public.finance_plans; co public.finance_companies;
        bd date; sid uuid; no text; gross numeric := 0; disc numeric := 0; vat numeric := 0; total numeric; v_cost numeric := 0; lc numeric; lv numeric; comm numeric := 0; c1 numeric;
        dp numeric := coalesce((p->>'discount_pct')::numeric,0); maxd numeric; appr public.staff; paid numeric := 0; cust uuid; need_cust boolean := false;
        r numeric; share numeric; lines_tmp jsonb := '[]'; w numeric; ofr jsonb; od numeric; ld numeric; odt numeric := 0; i int; n int;
begin
  s := public._session(p_token); perform public._require(s,'pos','a');
  if s.role_id = 'seller' then raise exception 'SELLER_CANNOT_COLLECT'; end if;
  if (p->>'client_uuid') is not null then
    select * into ex from public.sales where client_uuid = (p->>'client_uuid')::uuid;
    if ex.id is not null then return jsonb_build_object('id', ex.id, 'no', ex.no, 'total', ex.total, 'duplicate', true); end if;
  end if;
  select * into sh from public.shifts where drawer_id = public._drawer_of(s.device_location) and status = 'open';
  if sh.id is null then raise exception 'NO_OPEN_SHIFT'; end if;
  bd := public._business_day(sh.location_id);
  select * into st from public.store where id = 1;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'EMPTY_SALE'; end if;
  select max_discount_pct into maxd from public.roles where id = s.role_id;
  if dp < 0 or dp > 100 then raise exception 'BAD_DISCOUNT'; end if;
  if dp > maxd then
    if coalesce(p->>'approver_pin','') = '' then raise exception 'DISCOUNT_NEEDS_APPROVAL:%', maxd; end if;
    select stf.* into appr from public.staff stf join public.roles ro on ro.id = stf.role_id
     where stf.active and stf.pin_hash = crypt(p->>'approver_pin', stf.pin_hash) and ro.max_discount_pct >= dp and stf.id <> s.staff_id limit 1;
    if appr.id is null then raise exception 'APPROVER_NOT_VALID'; end if;
  end if;
  for ln in select * from jsonb_array_elements(p->'lines') loop
    select * into it from public.items where id = (ln->>'item_id')::uuid and not hidden;
    if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if (ln->>'qty')::numeric <= 0 then raise exception 'BAD_QTY'; end if;
    if it.serial_required then
      need_cust := true;
      if (ln->>'qty')::numeric <> 1 then raise exception 'SERIAL_ITEM_QTY_ONE:%', it.name; end if;
      if not exists (select 1 from public.serials where serial = ln->>'serial' and item_id = it.id and location_id = sh.location_id and status = 'in_stock') then
        raise exception 'SERIAL_NOT_AVAILABLE:%', coalesce(ln->>'serial','—');
      end if;
    end if;
    gross := gross + it.sale_price * (ln->>'qty')::numeric;
    lines_tmp := lines_tmp || jsonb_build_object('item_id', it.id, 'qty', ln->'qty', 'price', it.sale_price, 'serial', ln->'serial', 'waste', ln->'cut_waste_m', 'vat_rate', coalesce(it.vat_rate, st.vat_rate));
  end loop;
  n := jsonb_array_length(lines_tmp);
  -- offers: skipped when the sale was rung up offline (the customer paid the normal price)
  if coalesce((p->>'offers_seen')::boolean, true) then
    begin ofr := public._offer_price(lines_tmp, sh.location_id, now()); exception when others then ofr := null; end;
  end if;
  for i in 0..n-1 loop
    od := coalesce(((ofr->'lines'->i)->>'d')::numeric, 0);
    ld := od + round(((lines_tmp->i->>'price')::numeric * (lines_tmp->i->>'qty')::numeric - od) * dp / 100, 2);
    lines_tmp := jsonb_set(lines_tmp, array[i::text], (lines_tmp->i) || jsonb_build_object('od', od, 'ld', ld, 'ofid', (ofr->'lines'->i)->'o'));
    disc := disc + ld; odt := odt + od;
  end loop;
  total := gross - disc;
  if st.vat_registered and st.vat_from is not null and bd >= st.vat_from then
    for ln in select * from jsonb_array_elements(lines_tmp) loop
      r := (ln->>'vat_rate')::numeric / 100; share := (ln->>'price')::numeric * (ln->>'qty')::numeric - (ln->>'ld')::numeric;
      vat := vat + case when st.prices_include_vat then share - share/(1+r) else share * r end;
    end loop;
    vat := round(vat, 2);
    if not st.prices_include_vat then total := total + vat; end if;
  end if;
  for pay in select * from jsonb_array_elements(coalesce(p->'payments','[]')) loop
    if (pay->>'method') not in ('cash','card','insta','wallet','inst') then raise exception 'BAD_PAYMENT_METHOD'; end if;
    if (pay->>'method') = 'inst' then
      select * into pl from public.finance_plans where id = nullif(pay->>'plan_id','')::int and active;
      if pl.id is null then raise exception 'PLAN_REQUIRED'; end if;
      need_cust := true;
    end if;
    paid := paid + (pay->>'amount')::numeric;
  end loop;
  if paid < total then raise exception 'UNDERPAID:%', total - paid; end if;
  if paid - total > coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p->'payments') x where x->>'method' = 'cash'),0) then raise exception 'OVERPAID_NON_CASH'; end if;
  if coalesce(trim(p->'customer'->>'phone'),'') <> '' then
    insert into public.customers (name, phone) values (coalesce(nullif(trim(p->'customer'->>'name'),''),'عميل'), trim(p->'customer'->>'phone'))
    on conflict (phone) do update set name = coalesce(nullif(trim(excluded.name),''), public.customers.name) returning id into cust;
  elsif need_cust then raise exception 'CUSTOMER_REQUIRED';
  end if;
  no := 'INV-' || lpad(nextval('public.sale_no_seq')::text, 6, '0');
  insert into public.sales (no, location_id, shift_id, device_id, cashier_id, seller_id, customer_id, business_day, gross, discount, vat, total, client_uuid, offer_disc)
  values (no, sh.location_id, sh.id, s.device_id, s.staff_id, nullif(p->>'seller_id','')::uuid, cust, bd, gross, disc, vat, total, nullif(p->>'client_uuid','')::uuid, odt)
  returning id into sid;
  for ln in select * from jsonb_array_elements(lines_tmp) loop
    w := coalesce(nullif(ln->>'waste','')::numeric,0) / 100.0;
    lc := public._fifo_out((ln->>'item_id')::uuid, sh.location_id, (ln->>'qty')::numeric);
    if w > 0 then
      lv := public._fifo_out((ln->>'item_id')::uuid, sh.location_id, w);
      insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values ((ln->>'item_id')::uuid, sh.location_id, -w, lv, 'waste', 'sale', no, s.staff_id);
    end if;
    v_cost := v_cost + lc;
    insert into public.sale_lines (sale_id, item_id, qty, unit_price, discount, cost, serial, cut_waste_m, offer_id, offer_disc)
    values (sid, (ln->>'item_id')::uuid, (ln->>'qty')::numeric, (ln->>'price')::numeric, (ln->>'ld')::numeric, lc, nullif(ln->>'serial',''), nullif(w,0), nullif(ln->>'ofid','')::int, (ln->>'od')::numeric);
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values ((ln->>'item_id')::uuid, sh.location_id, -(ln->>'qty')::numeric, lc, 'sale', 'sale', no, s.staff_id);
    if coalesce(ln->>'serial','') <> '' then update public.serials set status = 'sold', sale_id = sid where serial = ln->>'serial'; end if;
  end loop;
  for pay in select * from jsonb_array_elements(p->'payments') loop
    if (pay->>'amount')::numeric = 0 then continue; end if;
    insert into public.sale_payments (sale_id, method, amount, plan_id) values (sid, pay->>'method', (pay->>'amount')::numeric, nullif(pay->>'plan_id','')::int);
    if pay->>'method' = 'inst' then
      select * into pl from public.finance_plans where id = (pay->>'plan_id')::int;
      select * into co from public.finance_companies where id = pl.company_id;
      c1 := case when pl.payer = 'store' then round((pay->>'amount')::numeric * pl.rate / 100, 2) else 0 end;
      comm := comm + c1;
      insert into public.finance_receivables (sale_id, company_id, plan_id, location_id, amount, commission, net, due_date)
      values (sid, co.id, pl.id, sh.location_id, (pay->>'amount')::numeric, c1, (pay->>'amount')::numeric - c1, bd + co.transfer_days);
    end if;
  end loop;
  update public.sales set cost = v_cost, fin_commission = comm where id = sid;
  insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, staff_id)
  select sh.drawer_id, case when x.method = 'cash' then x.amount - (paid - total) else x.amount end, 'sale', x.method, sh.id, 'sale', no, s.staff_id
    from (select pay2->>'method' method, sum((pay2->>'amount')::numeric) amount from jsonb_array_elements(p->'payments') pay2 group by 1) x where x.amount <> 0 and x.method <> 'inst';
  if (p->>'held_id') is not null then update public.held_sales set status = 'taken', taken_by = s.staff_id where id = (p->>'held_id')::uuid and status in ('open','taken'); end if;
  if appr.id is not null then perform public._audit(s,'اعتماد خصم يدوي فوق الحد',no,maxd::text||'%',dp::text||'% · '||appr.name,null,sh.location_id); end if;
  perform public._audit(s,'فاتورة بيع',no,null,total::text,null,sh.location_id);
  return jsonb_build_object('id', sid, 'no', no, 'gross', gross, 'discount', disc, 'offer_disc', odt, 'vat', vat, 'total', total, 'change', paid - total, 'business_day', bd, 'commission', comm);
end $$;

-- settings: minimum margin for the offers guard
create or replace function public.store_save(p_token text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; b public.store;
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm') then raise exception 'NOT_ALLOWED:settings'; end if;
  select * into b from public.store where id = 1 for update;
  if coalesce((p->>'vat_registered')::boolean, b.vat_registered) and not b.vat_registered then
    if s.role_id <> 'owner' then raise exception 'ONLY_OWNER'; end if;
    if coalesce(p->>'vat_rin','') !~ '^[0-9]{9}$' then raise exception 'BAD_RIN'; end if;
    if nullif(p->>'vat_from','') is null then raise exception 'VAT_FROM_REQUIRED'; end if;
  end if;
  if not coalesce((p->>'vat_registered')::boolean, b.vat_registered) and b.vat_registered and s.role_id <> 'owner' then raise exception 'ONLY_OWNER'; end if;
  update public.store set
    name = coalesce(nullif(trim(p->>'name'),''), name),
    vat_registered = coalesce((p->>'vat_registered')::boolean, vat_registered),
    vat_rin = coalesce(nullif(p->>'vat_rin',''), vat_rin),
    vat_from = coalesce(nullif(p->>'vat_from','')::date, vat_from),
    vat_rate = coalesce((p->>'vat_rate')::numeric, vat_rate),
    prices_include_vat = coalesce((p->>'prices_include_vat')::boolean, prices_include_vat),
    price_alert_pct = coalesce((p->>'price_alert_pct')::numeric, price_alert_pct),
    min_margin_pct = coalesce((p->>'min_margin_pct')::numeric, min_margin_pct),
    day_close_time = coalesce(nullif(p->>'day_close_time','')::time, day_close_time),
    day_open_time = coalesce(nullif(p->>'day_open_time','')::time, day_open_time),
    updated_at = now()
  where id = 1;
  perform public._audit(s,'تعديل الإعدادات','',to_jsonb(b)::text,p::text,null,null);
end $$;

revoke execute on function public._offer_live(public.offers,smallint,timestamptz), public._offer_hits(public.offers,uuid,int,int), public._offer_price(jsonb,smallint,timestamptz),
  public._offer_overlap(public.offers), public._offer_margins(public.offers) from public, anon, authenticated;
grant execute on function public.offers_preview(text,jsonb), public.offer_save(text,jsonb), public.offer_set_status(text,int,text) to authenticated;
alter function public._offer_hits(public.offers, uuid, int, int) set search_path = public;
