-- SYS Minzo · phase 1 · items & import with opening stock, FIFO engine, shifts, sales & void, transfers

alter table public.transfer_lines add column cost numeric(14,2) not null default 0;
create sequence public.item_code_seq start 1;
create sequence public.sale_no_seq start 1;
create sequence public.transfer_no_seq start 1;

-- ---------- business day (Cairo time; sales blocked between closing and opening) ----------
create or replace function public._business_day(p_loc smallint) returns date
language plpgsql stable security definer set search_path = public as $$
declare st public.store; lt timestamp := (now() at time zone 'Africa/Cairo');
begin
  select * into st from public.store;
  if lt::time >= st.day_close_time and lt::time < st.day_open_time then raise exception 'DAY_CLOSING_WINDOW'; end if;
  return case when lt::time < st.day_close_time then (lt::date - 1) else lt::date end;
end $$;

-- ---------- FIFO engine ----------
create or replace function public._fifo_in(p_item uuid, p_loc smallint, p_qty numeric, p_unit_cost numeric, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_qty <= 0 then return; end if;
  insert into public.stock_layers (item_id, location_id, qty_in, qty_left, unit_cost, ref) values (p_item, p_loc, p_qty, p_qty, p_unit_cost, p_ref);
  insert into public.stock (item_id, location_id, qty) values (p_item, p_loc, p_qty)
  on conflict (item_id, location_id) do update set qty = public.stock.qty + excluded.qty;
end $$;

create or replace function public._fifo_out(p_item uuid, p_loc smallint, p_qty numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare left_q numeric := p_qty; c numeric := 0; ly record; take numeric; nm text;
begin
  if p_qty <= 0 then return 0; end if;
  if coalesce((select sum(qty_left) from public.stock_layers where item_id = p_item and location_id = p_loc and qty_left > 0), 0) < p_qty then
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

-- ---------- EAN-13 check digit ----------
create or replace function public._ean13_ok(b text) returns boolean
language plpgsql immutable set search_path = public as $$
declare s int := 0; i int;
begin
  if b !~ '^[0-9]{13}$' then return true; end if;            -- only validate 13-digit numeric codes
  for i in 1..12 loop s := s + substr(b,i,1)::int * case when i % 2 = 0 then 3 else 1 end; end loop;
  return (10 - s % 10) % 10 = substr(b,13,1)::int;
end $$;

-- ---------- items ----------
create or replace function public.item_save(p_token text, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.sess; b public.items; nid uuid; dep int; grp int; u text := coalesce(p->>'unit','piece');
begin
  s := public._session(p_token);
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if u not in ('piece','set','meter','dozen') then raise exception 'BAD_UNIT'; end if;
  if (p->>'barcode') is not null and not public._ean13_ok(p->>'barcode') then raise exception 'BAD_EAN13'; end if;
  dep := nullif(p->>'department_id','')::int; grp := nullif(p->>'group_id','')::int;
  if (p->>'id') is null then
    perform public._require(s,'items','a');
    insert into public.items (code, barcode, name, department_id, group_id, unit, sale_price, last_cost, min_qty, serial_required, warranty_months, min_length, vat_rate, variants)
    values (coalesce(nullif(p->>'code',''), 'IT-'||lpad(nextval('public.item_code_seq')::text, 5, '0')), nullif(p->>'barcode',''), trim(p->>'name'), dep, grp, u,
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

create or replace function public.group_save(p_token text, p_department int, p_parent int, p_name text) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid int;
begin
  s := public._session(p_token); perform public._require(s,'items','a');
  insert into public.item_groups (department_id, parent_id, name) values (p_department, p_parent, trim(p_name))
  on conflict (department_id, parent_id, name) do update set name = excluded.name returning id into nid;
  return nid;
end $$;

-- ---------- import: items + opening stock (dry run first, then commit) ----------
-- rows: [{code, barcode, name, department, group, unit, sale_price, cost, min_qty, serial_required, warranty_months, qty, serials:[...]}]
create or replace function public.items_import(p_token text, p_rows jsonb, p_location smallint, p_commit boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; r jsonb; i int := 0; errs jsonb := '[]'; ok int := 0; upd int := 0; dep int; grp int; it public.items; e text[];
        u text; q numeric; c numeric; sn text; nm text; seen_bc text[] := '{}'; unit_map jsonb := '{"قطعة":"piece","طقم":"set","متر":"meter","دستة":"dozen","جهاز":"piece","piece":"piece","set":"set","meter":"meter","dozen":"dozen"}';
begin
  s := public._session(p_token);
  perform public._require(s,'io','i'); perform public._require(s,'items','a');
  if p_location is not null and exists (select 1 from public.stock_moves where location_id = p_location and kind <> 'opening') then
    raise exception 'OPENING_AFTER_MOVES';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; e := '{}';
    nm := trim(coalesce(r->>'name',''));
    u := coalesce(unit_map->>lower(trim(coalesce(r->>'unit','piece'))), 'x');
    q := nullif(r->>'qty','')::numeric; c := nullif(r->>'cost','')::numeric;
    if nm = '' then e := e || 'الاسم ناقص'; end if;
    if u = 'x' then e := e || ('وحدة غير معروفة: '||(r->>'unit')); end if;
    if (r->>'sale_price') is null or (r->>'sale_price')::numeric < 0 then e := e || 'سعر البيع ناقص أو غلط'; end if;
    if coalesce(r->>'barcode','') <> '' then
      if not public._ean13_ok(r->>'barcode') then e := e || 'رقم الفحص في باركود EAN-13 غلط'; end if;
      if (r->>'barcode') = any(seen_bc) then e := e || 'الباركود متكرر في الملف'; end if;
      seen_bc := seen_bc || (r->>'barcode');
    end if;
    select id into dep from public.departments where name = trim(coalesce(r->>'department','')) or name_en ilike trim(coalesce(r->>'department',''));
    if dep is null then e := e || ('قسم غير موجود: '||coalesce(r->>'department','—')); end if;
    if coalesce(q,0) > 0 then
      if p_location is null then e := e || 'حدد المكان عشان الرصيد'; end if;
      if c is null or c < 0 then e := e || 'التكلفة ناقصة للرصيد'; end if;
    end if;
    select * into it from public.items where (coalesce(r->>'code','') <> '' and code = r->>'code') or (coalesce(r->>'barcode','') <> '' and barcode = r->>'barcode') limit 1;
    if array_length(e,1) > 0 then errs := errs || jsonb_build_object('row', i, 'name', nm, 'errors', to_jsonb(e)); continue; end if;
    if it.id is null then ok := ok + 1; else upd := upd + 1; end if;
    if not p_commit then continue; end if;
    grp := null;
    if coalesce(trim(r->>'group'),'') <> '' then
      insert into public.item_groups (department_id, parent_id, name) values (dep, null, trim(r->>'group'))
      on conflict (department_id, parent_id, name) do nothing;
      select id into grp from public.item_groups where department_id = dep and parent_id is null and name = trim(r->>'group');
    end if;
    if it.id is null then
      insert into public.items (code, barcode, name, department_id, group_id, unit, sale_price, last_cost, min_qty, serial_required, warranty_months)
      values (coalesce(nullif(r->>'code',''), 'IT-'||lpad(nextval('public.item_code_seq')::text,5,'0')), nullif(r->>'barcode',''), nm, dep, grp, u,
              (r->>'sale_price')::numeric, coalesce(c,0), coalesce(nullif(r->>'min_qty','')::numeric,0),
              coalesce(lower(r->>'serial_required') in ('1','true','نعم','yes'), false), coalesce(nullif(r->>'warranty_months','')::int,0))
      returning * into it;
    else
      update public.items set name = nm, department_id = dep, group_id = coalesce(grp, group_id), unit = u, sale_price = (r->>'sale_price')::numeric,
        min_qty = coalesce(nullif(r->>'min_qty','')::numeric, min_qty), updated_at = now() where id = it.id;
    end if;
    if coalesce(q,0) > 0 then
      perform public._fifo_in(it.id, p_location, q, c, 'رصيد أول المدة');
      update public.items set last_cost = c where id = it.id;
      insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, staff_id) values (it.id, p_location, q, round(q*c,2), 'opening', 'import', s.staff_id);
      if r ? 'serials' then
        for sn in select jsonb_array_elements_text(r->'serials') loop
          insert into public.serials (serial, item_id, location_id) values (sn, it.id, p_location) on conflict (serial) do nothing;
        end loop;
      end if;
    end if;
  end loop;
  if p_commit then
    if jsonb_array_length(errs) > 0 then raise exception 'IMPORT_HAS_ERRORS'; end if;
    perform public._audit(s,'استيراد أصناف',(ok+upd)::text||' صف', null, ok||' جديد · '||upd||' تحديث', null, p_location);
  end if;
  return jsonb_build_object('new', ok, 'updated', upd, 'errors', errs, 'committed', p_commit);
end $$;

-- ---------- shifts ----------
create or replace function public._drawer_of(p_loc smallint) returns int
language sql stable security definer set search_path = public as $$
  select id from public.cash_accounts where kind = 'drawer' and location_id = p_loc and active order by id limit 1;
$$;

create or replace function public.shift_open(p_token text, p_float numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.sess; dr int; nid uuid;
begin
  s := public._session(p_token); perform public._require(s,'pos','a');
  if s.device_location is null then raise exception 'DEVICE_HAS_NO_LOCATION'; end if;
  dr := public._drawer_of(s.device_location); if dr is null then raise exception 'NO_DRAWER'; end if;
  if exists (select 1 from public.shifts where drawer_id = dr and status = 'open') then raise exception 'SHIFT_ALREADY_OPEN'; end if;
  insert into public.shifts (location_id, device_id, drawer_id, cashier_id, opening_float) values (s.device_location, s.device_id, dr, s.staff_id, coalesce(p_float,0)) returning id into nid;
  insert into public.cash_moves (account_id, amount, kind, method, shift_id, note, staff_id) values (dr, coalesce(p_float,0), 'float', 'cash', nid, 'رصيد فتح الوردية', s.staff_id);
  perform public._audit(s,'فتح وردية',(select name from public.cash_accounts where id = dr),null,p_float::text,null,s.device_location);
  return nid;
end $$;

create or replace function public._shift_totals(p_shift uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cash', coalesce(sum(amount) filter (where method = 'cash'), 0),
    'card', coalesce(sum(amount) filter (where method = 'card'), 0),
    'insta', coalesce(sum(amount) filter (where method = 'insta'), 0),
    'wallet', coalesce(sum(amount) filter (where method = 'wallet'), 0),
    'sales', (select count(*) from public.sales where shift_id = p_shift and status = 'posted'),
    'total', (select coalesce(sum(total),0) from public.sales where shift_id = p_shift and status = 'posted'))
  from public.cash_moves where shift_id = p_shift;
$$;

create or replace function public.shift_current(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sh public.shifts;
begin
  s := public._session(p_token);
  select * into sh from public.shifts where drawer_id = public._drawer_of(s.device_location) and status = 'open';
  if sh.id is null then return null; end if;
  return to_jsonb(sh) || jsonb_build_object('cashier_name',(select name from public.staff where id = sh.cashier_id), 'totals', public._shift_totals(sh.id));
end $$;

create or replace function public.shift_handover(p_token text, p_counted jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sh public.shifts; t jsonb; cnt numeric := 0; k text; dff numeric; other numeric := 0;
begin
  s := public._session(p_token);
  select * into sh from public.shifts where drawer_id = public._drawer_of(s.device_location) and status = 'open' for update;
  if sh.id is null then raise exception 'NO_OPEN_SHIFT'; end if;
  if sh.cashier_id <> s.staff_id and not public._can(s.role_id,'close','p') then raise exception 'NOT_YOUR_SHIFT'; end if;
  t := public._shift_totals(sh.id);
  for k in select jsonb_object_keys(coalesce(p_counted->'den','{}')) loop cnt := cnt + k::numeric * coalesce((p_counted->'den'->>k)::numeric,0); end loop;
  dff := cnt - (t->>'cash')::numeric;
  other := abs(coalesce((p_counted->>'card')::numeric,0) - (t->>'card')::numeric) + abs(coalesce((p_counted->>'insta')::numeric,0) - (t->>'insta')::numeric)
         + abs(coalesce((p_counted->>'wallet')::numeric,0) - (t->>'wallet')::numeric);
  if (dff <> 0 or other <> 0) and coalesce(length(trim(p_reason)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.shifts set closed_at = now(), counted = p_counted, expected_cash = (t->>'cash')::numeric, counted_cash = cnt, diff = dff, diff_reason = p_reason, status = 'handed' where id = sh.id;
  perform public._audit(s,'تسليم وردية',sh.id::text,(t->>'cash'),cnt::text,p_reason,sh.location_id);
  return jsonb_build_object('expected', t->'cash', 'counted', cnt, 'diff', dff, 'totals', t);
end $$;

create or replace function public.shift_approve(p_token text, p_shift uuid, p_to_treasury numeric) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; sh public.shifts; tr int;
begin
  s := public._session(p_token); perform public._require(s,'close','p');
  select * into sh from public.shifts where id = p_shift for update;
  if sh.status <> 'handed' then raise exception 'NOT_HANDED'; end if;
  if not public._loc_ok(s, sh.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  if sh.cashier_id = s.staff_id and s.role_id <> 'owner' then raise exception 'CANNOT_APPROVE_OWN_SHIFT'; end if;
  update public.shifts set status = 'approved', approved_by = s.staff_id, approved_at = now() where id = sh.id;
  if coalesce(p_to_treasury,0) > 0 then
    if p_to_treasury > sh.counted_cash then raise exception 'MORE_THAN_COUNTED'; end if;
    select id into tr from public.cash_accounts where kind = 'treasury' and active order by id limit 1;
    insert into public.cash_moves (account_id, amount, kind, method, note, staff_id, ref_type, ref_id) values
      (sh.drawer_id, -p_to_treasury, 'deposit', 'cash', 'توريد للخزنة', s.staff_id, 'shift', sh.id::text),
      (tr, p_to_treasury, 'deposit', 'cash', 'توريد من الدرج', s.staff_id, 'shift', sh.id::text);
  end if;
  if coalesce(sh.diff,0) <> 0 then
    insert into public.cash_moves (account_id, amount, kind, method, note, staff_id, ref_type, ref_id)
    values (sh.drawer_id, sh.diff, 'adjust', 'cash', case when sh.diff < 0 then 'عجز وردية' else 'زيادة وردية' end, s.staff_id, 'shift', sh.id::text);
  end if;
  perform public._audit(s,'اعتماد تسليم وردية',sh.id::text,null,coalesce(p_to_treasury,0)::text,null,sh.location_id);
end $$;

-- ---------- sales ----------
-- p: {client_uuid, lines:[{item_id, qty, serial, cut_waste_m}], discount_pct, approver_pin, customer:{name,phone}, seller_id, payments:[{method, amount}]}
create or replace function public.sale_post(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; sh public.shifts; st public.store; it public.items; ln jsonb; pay jsonb; ex public.sales;
        bd date; sid uuid; no text; gross numeric := 0; disc numeric := 0; vat numeric := 0; total numeric; v_cost numeric := 0; lc numeric; lv numeric;
        dp numeric := coalesce((p->>'discount_pct')::numeric,0); maxd numeric; appr public.staff; paid numeric := 0; cash_in numeric := 0; cust uuid; need_cust boolean := false;
        r numeric; share numeric; lines_tmp jsonb := '[]'; i int := 0; w numeric;
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
  select * into st from public.store;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'EMPTY_SALE'; end if;
  -- discount limit
  select max_discount_pct into maxd from public.roles where id = s.role_id;
  if dp < 0 or dp > 100 then raise exception 'BAD_DISCOUNT'; end if;
  if dp > maxd then
    if coalesce(p->>'approver_pin','') = '' then raise exception 'DISCOUNT_NEEDS_APPROVAL:%', maxd; end if;
    select stf.* into appr from public.staff stf join public.roles ro on ro.id = stf.role_id
     where stf.active and stf.pin_hash = crypt(p->>'approver_pin', stf.pin_hash) and ro.max_discount_pct >= dp and stf.id <> s.staff_id limit 1;
    if appr.id is null then raise exception 'APPROVER_NOT_VALID'; end if;
  end if;
  -- price lines from the catalogue (server is the source of truth)
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
    lines_tmp := lines_tmp || jsonb_build_object('item_id', it.id, 'qty', ln->'qty', 'price', it.sale_price, 'serial', ln->'serial', 'waste', ln->'cut_waste_m', 'vat_rate', coalesce(it.vat_rate, st.vat_rate), 'unit', it.unit);
  end loop;
  disc := round(gross * dp / 100, 2);
  total := gross - disc;
  if st.vat_registered and st.vat_from is not null and bd >= st.vat_from then
    for ln in select * from jsonb_array_elements(lines_tmp) loop
      r := (ln->>'vat_rate')::numeric / 100; share := (ln->>'price')::numeric * (ln->>'qty')::numeric * (1 - dp/100);
      vat := vat + case when st.prices_include_vat then share - share/(1+r) else share * r end;
    end loop;
    vat := round(vat, 2);
    if not st.prices_include_vat then total := total + vat; end if;
  end if;
  -- payments
  for pay in select * from jsonb_array_elements(coalesce(p->'payments','[]')) loop
    if (pay->>'method') not in ('cash','card','insta','wallet') then raise exception 'BAD_PAYMENT_METHOD'; end if;
    paid := paid + (pay->>'amount')::numeric;
  end loop;
  if paid < total then raise exception 'UNDERPAID:%', total - paid; end if;
  if paid - total > coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p->'payments') x where x->>'method' = 'cash'),0) then raise exception 'OVERPAID_NON_CASH'; end if;
  -- customer
  if coalesce(trim(p->'customer'->>'phone'),'') <> '' then
    insert into public.customers (name, phone) values (coalesce(nullif(trim(p->'customer'->>'name'),''),'عميل'), trim(p->'customer'->>'phone'))
    on conflict (phone) do update set name = coalesce(nullif(trim(excluded.name),''), public.customers.name) returning id into cust;
  elsif need_cust then raise exception 'CUSTOMER_REQUIRED';
  end if;
  -- write
  no := 'INV-' || lpad(nextval('public.sale_no_seq')::text, 6, '0');
  insert into public.sales (no, location_id, shift_id, device_id, cashier_id, seller_id, customer_id, business_day, gross, discount, vat, total, client_uuid)
  values (no, sh.location_id, sh.id, s.device_id, s.staff_id, nullif(p->>'seller_id','')::uuid, cust, bd, gross, disc, vat, total, nullif(p->>'client_uuid','')::uuid)
  returning id into sid;
  for ln in select * from jsonb_array_elements(lines_tmp) loop
    w := coalesce(nullif(ln->>'waste','')::numeric,0) / 100.0;           -- cut waste comes in cm
    lc := public._fifo_out((ln->>'item_id')::uuid, sh.location_id, (ln->>'qty')::numeric);
    if w > 0 then
      lv := public._fifo_out((ln->>'item_id')::uuid, sh.location_id, w);
      insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values ((ln->>'item_id')::uuid, sh.location_id, -w, lv, 'waste', 'sale', no, s.staff_id);
    end if;
    v_cost := v_cost + lc;
    insert into public.sale_lines (sale_id, item_id, qty, unit_price, discount, cost, serial, cut_waste_m)
    values (sid, (ln->>'item_id')::uuid, (ln->>'qty')::numeric, (ln->>'price')::numeric, round((ln->>'price')::numeric*(ln->>'qty')::numeric*dp/100,2), lc, nullif(ln->>'serial',''), nullif(w,0));
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values ((ln->>'item_id')::uuid, sh.location_id, -(ln->>'qty')::numeric, lc, 'sale', 'sale', no, s.staff_id);
    if coalesce(ln->>'serial','') <> '' then update public.serials set status = 'sold', sale_id = sid where serial = ln->>'serial'; end if;
  end loop;
  update public.sales set cost = v_cost where id = sid;
  for pay in select * from jsonb_array_elements(p->'payments') loop
    if (pay->>'amount')::numeric = 0 then continue; end if;
    insert into public.sale_payments (sale_id, method, amount) values (sid, pay->>'method', (pay->>'amount')::numeric);
  end loop;
  -- cash actually kept = cash given − change; other methods recorded on the drawer for shift reconciliation
  insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, staff_id)
  select sh.drawer_id, case when x.method = 'cash' then x.amount - (paid - total) else x.amount end, 'sale', x.method, sh.id, 'sale', no, s.staff_id
    from (select pay2->>'method' method, sum((pay2->>'amount')::numeric) amount from jsonb_array_elements(p->'payments') pay2 group by 1) x where x.amount <> 0;
  if appr.id is not null then perform public._audit(s,'اعتماد خصم يدوي فوق الحد',no,maxd::text||'%',dp::text||'% · '||appr.name,null,sh.location_id); end if;
  perform public._audit(s,'فاتورة بيع',no,null,total::text,null,sh.location_id);
  return jsonb_build_object('id', sid, 'no', no, 'gross', gross, 'discount', disc, 'vat', vat, 'total', total, 'change', paid - total, 'business_day', bd);
end $$;

-- void: GM / owner directly; branch manager with GM / owner PIN; restores stock at the original cost
create or replace function public.sale_void(p_token text, p_sale uuid, p_reason text, p_approver_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sess; sa public.sales; ln record; appr public.staff; sh public.shifts; refund numeric;
begin
  s := public._session(p_token);
  if coalesce(length(trim(p_reason)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into sa from public.sales where id = p_sale for update;
  if sa.status <> 'posted' then raise exception 'ALREADY_VOID'; end if;
  if not (s.role_id in ('owner','gm') or public._has(s.role_id,'voidInvoice')) then
    if not public._has(s.role_id,'voidRequest') then raise exception 'NOT_ALLOWED:void'; end if;
    select * into appr from public.staff where active and role_id in ('owner','gm') and pin_hash = crypt(coalesce(p_approver_pin,''), pin_hash) limit 1;
    if appr.id is null then raise exception 'APPROVER_NOT_VALID'; end if;
  end if;
  if not public._loc_ok(s, sa.location_id) then raise exception 'OUT_OF_SCOPE'; end if;
  for ln in select * from public.sale_lines where sale_id = sa.id loop
    perform public._fifo_in(ln.item_id, sa.location_id, ln.qty, case when ln.qty > 0 then ln.cost / ln.qty else 0 end, 'إلغاء '||sa.no);
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (ln.item_id, sa.location_id, ln.qty, ln.cost, 'void', 'sale', sa.no, s.staff_id);
    if ln.serial is not null then update public.serials set status = 'in_stock', sale_id = null where serial = ln.serial; end if;
  end loop;
  select * into sh from public.shifts where drawer_id = public._drawer_of(sa.location_id) and status = 'open';
  insert into public.cash_moves (account_id, amount, kind, method, shift_id, ref_type, ref_id, note, staff_id)
  select public._drawer_of(sa.location_id), -sum(amount), 'refund', method, sh.id, 'sale', sa.no, 'إلغاء فاتورة', s.staff_id
    from public.cash_moves where ref_type = 'sale' and ref_id = sa.no and kind = 'sale' group by method;
  update public.sales set status = 'void', void_reason = p_reason, void_by = s.staff_id where id = sa.id;
  perform public._audit(s,'إلغاء فاتورة',sa.no,sa.total::text,'ملغاة'||coalesce(' · بموافقة '||appr.name,''),p_reason,sa.location_id);
end $$;

-- ---------- transfers: request → approve → ship (FIFO out) → receive (FIFO in at the same cost) ----------
create or replace function public.transfer_create(p_token text, p_from smallint, p_to smallint, p_lines jsonb, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; tid uuid; no text; ln jsonb;
begin
  s := public._session(p_token); perform public._require(s,'transfers','a');
  if not (public._loc_ok(s,p_from) or public._loc_ok(s,p_to)) then raise exception 'OUT_OF_SCOPE'; end if;
  if jsonb_array_length(coalesce(p_lines,'[]')) = 0 then raise exception 'EMPTY_TRANSFER'; end if;
  no := 'TR-' || lpad(nextval('public.transfer_no_seq')::text, 5, '0');
  insert into public.transfers (no, from_location, to_location, note, requested_by) values (no, p_from, p_to, p_note, s.staff_id) returning id into tid;
  for ln in select * from jsonb_array_elements(p_lines) loop
    insert into public.transfer_lines (transfer_id, item_id, qty, serials) values (tid, (ln->>'item_id')::uuid, (ln->>'qty')::numeric,
      case when ln ? 'serials' then array(select jsonb_array_elements_text(ln->'serials')) else null end);
  end loop;
  perform public._audit(s,'طلب تحويل',no,null,null,p_note,p_from);
  return jsonb_build_object('id', tid, 'no', no);
end $$;

create or replace function public.transfer_approve(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; t public.transfers;
begin
  s := public._session(p_token); perform public._require(s,'transfers','p');
  select * into t from public.transfers where id = p_id for update;
  if t.status <> 'requested' then raise exception 'BAD_STATUS'; end if;
  if not public._loc_ok(s, t.from_location) then raise exception 'OUT_OF_SCOPE'; end if;
  update public.transfers set status = 'approved', approved_by = s.staff_id, updated_at = now() where id = p_id;
  perform public._audit(s,'اعتماد تحويل',t.no,'مطلوب','معتمد',null,t.from_location);
end $$;

create or replace function public.transfer_ship(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; t public.transfers; ln record; c numeric; sn text;
begin
  s := public._session(p_token); perform public._require(s,'transfers','a');
  select * into t from public.transfers where id = p_id for update;
  if t.status <> 'approved' then raise exception 'BAD_STATUS'; end if;
  if not public._loc_ok(s, t.from_location) then raise exception 'OUT_OF_SCOPE'; end if;
  for ln in select * from public.transfer_lines where transfer_id = p_id loop
    if (select serial_required from public.items where id = ln.item_id) then
      if coalesce(array_length(ln.serials,1),0) <> ln.qty then raise exception 'SERIALS_REQUIRED'; end if;
      foreach sn in array ln.serials loop
        update public.serials set status = 'in_transit' where serial = sn and item_id = ln.item_id and location_id = t.from_location and status = 'in_stock';
        if not found then raise exception 'SERIAL_NOT_AVAILABLE:%', sn; end if;
      end loop;
    end if;
    c := public._fifo_out(ln.item_id, t.from_location, ln.qty);
    update public.transfer_lines set cost = c where transfer_id = p_id and item_id = ln.item_id;
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (ln.item_id, t.from_location, -ln.qty, c, 'transfer_out', 'transfer', t.no, s.staff_id);
  end loop;
  update public.transfers set status = 'shipped', shipped_by = s.staff_id, updated_at = now() where id = p_id;
  perform public._audit(s,'شحن تحويل',t.no,'معتمد','في الطريق',null,t.from_location);
end $$;

-- p_received: {"<item_id>": qty, ...}; missing items = full quantity received
create or replace function public.transfer_receive(p_token text, p_id uuid, p_received jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; t public.transfers; ln record; q numeric; short numeric := 0; sn text;
begin
  s := public._session(p_token); perform public._require(s,'transfers','a');
  select * into t from public.transfers where id = p_id for update;
  if t.status <> 'shipped' then raise exception 'BAD_STATUS'; end if;
  if not public._loc_ok(s, t.to_location) then raise exception 'OUT_OF_SCOPE'; end if;
  for ln in select * from public.transfer_lines where transfer_id = p_id loop
    q := coalesce((p_received->>ln.item_id::text)::numeric, ln.qty);
    if q < 0 or q > ln.qty then raise exception 'BAD_QTY'; end if;
    perform public._fifo_in(ln.item_id, t.to_location, q, case when ln.qty > 0 then ln.cost / ln.qty else 0 end, t.no);
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (ln.item_id, t.to_location, q, round(ln.cost*q/ln.qty,2), 'transfer_in', 'transfer', t.no, s.staff_id);
    if q < ln.qty then
      short := short + (ln.qty - q);
      insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (ln.item_id, t.to_location, 0, round(ln.cost*(ln.qty-q)/ln.qty,2), 'waste', 'transfer', t.no||' عجز', s.staff_id);
    end if;
    update public.transfer_lines set qty_received = q where transfer_id = p_id and item_id = ln.item_id;
    if ln.serials is not null then
      foreach sn in array ln.serials loop update public.serials set status = 'in_stock', location_id = t.to_location where serial = sn; end loop;
    end if;
  end loop;
  if short > 0 and coalesce(length(trim(p_reason)),0) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.transfers set status = 'received', received_by = s.staff_id, updated_at = now() where id = p_id;
  perform public._audit(s,'استلام تحويل',t.no,'في الطريق','مستلم'||case when short > 0 then ' · عجز '||short else '' end,p_reason,t.to_location);
end $$;

-- ---------- grants ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.setup_status(), public.setup_first_run(text,text,text,text), public.device_register(text),
  public.device_pending(text), public.device_set(text,uuid,text,text,smallint,boolean), public.staff_login(text), public.staff_logout(text),
  public.staff_change_pin(text,text,text), public.staff_list(text), public.staff_save(text,uuid,text,text,smallint,boolean,text), public.is_device(),
  public.item_save(text,jsonb), public.group_save(text,int,int,text), public.items_import(text,jsonb,smallint,boolean),
  public.shift_open(text,numeric), public.shift_current(text), public.shift_handover(text,jsonb,text), public.shift_approve(text,uuid,numeric),
  public.sale_post(text,jsonb), public.sale_void(text,uuid,text,text),
  public.transfer_create(text,smallint,smallint,jsonb,text), public.transfer_approve(text,uuid), public.transfer_ship(text,uuid), public.transfer_receive(text,uuid,jsonb,text)
  to authenticated;
