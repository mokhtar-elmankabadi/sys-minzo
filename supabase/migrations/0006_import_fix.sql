-- text[] || 'literal' was parsed as array || array; use array_append
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
    if nm = '' then e := array_append(e, 'الاسم ناقص'); end if;
    if u = 'x' then e := array_append(e, ('وحدة غير معروفة: '||(r->>'unit'))); end if;
    if (r->>'sale_price') is null or (r->>'sale_price')::numeric < 0 then e := array_append(e, 'سعر البيع ناقص أو غلط'); end if;
    if coalesce(r->>'barcode','') <> '' then
      if not public._ean13_ok(r->>'barcode') then e := array_append(e, 'رقم الفحص في باركود EAN-13 غلط'); end if;
      if (r->>'barcode') = any(seen_bc) then e := array_append(e, 'الباركود متكرر في الملف'); end if;
      seen_bc := seen_bc || (r->>'barcode');
    end if;
    select id into dep from public.departments where name = trim(coalesce(r->>'department','')) or name_en ilike trim(coalesce(r->>'department',''));
    if dep is null then e := array_append(e, ('قسم غير موجود: '||coalesce(r->>'department','—'))); end if;
    if coalesce(q,0) > 0 then
      if p_location is null then e := array_append(e, 'حدد المكان عشان الرصيد'); end if;
      if c is null or c < 0 then e := array_append(e, 'التكلفة ناقصة للرصيد'); end if;
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

