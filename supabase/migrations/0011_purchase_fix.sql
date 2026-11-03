-- purchase_post: local variable clashed with the gross column
create or replace function public.purchase_post(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; sup public.suppliers; st public.store; it public.items; ln jsonb; pid uuid; no text; v_gross numeric := 0; disc numeric := coalesce((p->>'discount')::numeric,0);
        uc numeric; pend boolean := false; hide boolean; loc smallint := (p->>'location_id')::smallint; sn text; d date := coalesce(nullif(p->>'inv_date','')::date, current_date);
begin
  s := public._session(p_token);
  if not (public._can(s.role_id,'suppliers','a') or public._can(s.role_id,'stock','a')) then raise exception 'NOT_ALLOWED:suppliers'; end if;
  if not public._loc_ok(s, loc) then raise exception 'OUT_OF_SCOPE'; end if;
  select * into sup from public.suppliers where id = (p->>'supplier_id')::int and active;
  if sup.id is null then raise exception 'SUPPLIER_REQUIRED'; end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'EMPTY_INVOICE'; end if;
  select * into st from public.store where id = 1;
  select hide_cost into hide from public.roles where id = s.role_id;
  no := 'PUR-' || lpad(nextval('public.purchase_no_seq')::text, 5, '0');
  insert into public.purchase_invoices (no, supplier_id, supplier_ref, location_id, inv_date, due_date, gross, discount, total, note, staff_id)
  values (no, sup.id, p->>'supplier_ref', loc, d, d + sup.terms_days, 0, 0, 0, p->>'note', s.staff_id) returning id into pid;
  for ln in select * from jsonb_array_elements(p->'lines') loop
    select * into it from public.items where id = (ln->>'item_id')::uuid;
    if it.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
    if (ln->>'qty')::numeric <= 0 then raise exception 'BAD_QTY'; end if;
    if hide or (ln->>'unit_cost') is null then uc := it.last_cost; pend := true;
    else
      uc := (ln->>'unit_cost')::numeric;
      if uc < 0 then raise exception 'BAD_COST'; end if;
      if it.last_cost > 0 and abs(uc - it.last_cost) / it.last_cost * 100 > st.price_alert_pct then
        if coalesce(ln->>'diff_reason','') not in ('price','quality') then raise exception 'PRICE_DIFF:%', it.name; end if;
      end if;
    end if;
    if it.serial_required then
      if coalesce(jsonb_array_length(ln->'serials'),0) <> (ln->>'qty')::numeric then raise exception 'SERIALS_REQUIRED:%', it.name; end if;
      for sn in select jsonb_array_elements_text(ln->'serials') loop
        if exists (select 1 from public.serials where serial = sn) then raise exception 'SERIAL_EXISTS:%', sn; end if;
        insert into public.serials (serial, item_id, location_id) values (sn, it.id, loc);
      end loop;
    end if;
    insert into public.purchase_lines (invoice_id, item_id, qty, unit_cost, prev_cost, diff_reason, serials)
    values (pid, it.id, (ln->>'qty')::numeric, uc, it.last_cost, nullif(ln->>'diff_reason',''),
            case when ln ? 'serials' then array(select jsonb_array_elements_text(ln->'serials')) else null end);
    perform public._fifo_in(it.id, loc, (ln->>'qty')::numeric, uc, no);
    insert into public.stock_moves (item_id, location_id, qty, cost, kind, ref_type, ref_id, staff_id) values (it.id, loc, (ln->>'qty')::numeric, round((ln->>'qty')::numeric*uc,2), 'purchase', 'purchase', no, s.staff_id);
    if not pend then update public.items set last_cost = uc, updated_at = now() where id = it.id; end if;
    v_gross := v_gross + (ln->>'qty')::numeric * uc;
  end loop;
  if disc < 0 or disc > v_gross then raise exception 'BAD_DISCOUNT'; end if;
  update public.purchase_invoices set gross = round(v_gross,2), discount = disc, total = round(v_gross - disc,2), cost_pending = pend where id = pid;
  perform public._audit(s,'فاتورة شراء',no||' · '||sup.name,null,round(v_gross - disc,2)::text,case when pend then 'بالكميات — التكلفة مستنية مراجعة المحاسب' end,loc);
  return jsonb_build_object('id', pid, 'no', no, 'total', round(v_gross - disc,2), 'cost_pending', pend);
end $$;

