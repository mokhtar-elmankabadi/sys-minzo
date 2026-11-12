-- 0035 · importing from Excel: customers, suppliers with opening balances, and sale-price updates
-- Every import runs twice: first a trial that changes nothing and lists every problem row by row,
-- then the real run — which is all-or-nothing (one bad row and nothing is saved).
-- A supplier's opening balance that is already recorded is never changed by an import.

create or replace function public._imp_date(v text) returns date
language plpgsql immutable set search_path = public as $$
begin
  if v is null or btrim(v) = '' then return null; end if;
  return btrim(v)::date;
exception when others then raise exception 'BAD_DATE';
end $$;

create or replace function public._imp_num(v text) returns numeric
language plpgsql immutable set search_path = public as $$
begin
  if v is null or btrim(v) = '' then return null; end if;
  return replace(replace(btrim(v), ',', ''), '٫', '.')::numeric;
exception when others then raise exception 'BAD_NUMBER';
end $$;

-- customers: matched by mobile number; without a number every row is a new customer
create or replace function public.customers_import(p_token text, p_rows jsonb, p_commit boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; r jsonb; i int := 0; e text[]; errs jsonb := '[]'; nw int := 0; up int := 0; nm text; ph text; bd date; ex public.customers; seen text[] := '{}'; can_e boolean;
begin
  s := public._session(p_token); perform public._require(s,'customers','a');
  can_e := public._can(s.role_id,'customers','e');
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'TOO_MANY_ROWS'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; e := '{}'; bd := null; ex := null;
    nm := nullif(btrim(coalesce(r->>'name','')), '');
    if nm is null then e := e || text 'الاسم ناقص'; elsif char_length(nm) > 120 then e := e || text 'الاسم طويل قوي'; end if;
    ph := nullif(regexp_replace(coalesce(r->>'phone',''), '[^0-9+]', '', 'g'), '');
    if ph is not null and length(regexp_replace(ph, '\D', '', 'g')) not between 7 and 15 then e := e || text 'رقم الموبايل مش مظبوط'; end if;
    if ph is not null and ph = any(seen) then e := e || text 'الموبايل ده متكرر في الملف'; elsif ph is not null then seen := seen || ph; end if;
    begin bd := public._imp_date(r->>'birthday'); exception when others then e := e || text 'تاريخ الميلاد مش مفهوم — اكتبه زي 1990-05-21'; end;
    if bd is not null and (bd > current_date or bd < date '1900-01-01') then e := e || text 'تاريخ الميلاد مش منطقي'; end if;
    if ph is not null then select * into ex from public.customers where phone = ph; end if;
    if ex.id is not null and not can_e then e := e || text 'العميل موجود بنفس الموبايل، وتحديثه محتاج صلاحية تعديل العملاء'; end if;
    if array_length(e, 1) > 0 then errs := errs || jsonb_build_object('row', i, 'name', nm, 'errs', to_jsonb(e)); continue; end if;
    if ex.id is null then
      nw := nw + 1;
      if p_commit then insert into public.customers (name, phone, area, address, notes, birthday)
        values (nm, ph, nullif(btrim(r->>'area'),''), nullif(btrim(r->>'address'),''), nullif(btrim(r->>'notes'),''), bd); end if;
    else
      up := up + 1;
      if p_commit then update public.customers set name = nm, area = coalesce(nullif(btrim(r->>'area'),''), area), address = coalesce(nullif(btrim(r->>'address'),''), address),
        notes = coalesce(nullif(btrim(r->>'notes'),''), notes), birthday = coalesce(bd, birthday), updated_at = now() where id = ex.id; end if;
    end if;
  end loop;
  if p_commit then
    if jsonb_array_length(errs) > 0 then raise exception 'IMPORT_HAS_ERRORS'; end if;
    perform public._audit(s, 'استيراد عملاء', nw || ' جديد · ' || up || ' تحديث', null, null, null, null);
  end if;
  return jsonb_build_object('new', nw, 'updated', up, 'errors', errs);
end $$;

-- suppliers: matched by name; a new supplier can come with its opening balance (what we owe him on that date)
create or replace function public.suppliers_import(p_token text, p_rows jsonb, p_commit boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; r jsonb; i int := 0; e text[]; errs jsonb := '[]'; nw int := 0; up int := 0; nm text; kd text; k text; td int; cl numeric; ob numeric; od date; ex public.suppliers; seen text[] := '{}'; can_e boolean; tot numeric := 0;
begin
  s := public._session(p_token); perform public._require(s,'suppliers','a');
  can_e := public._can(s.role_id,'suppliers','e');
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'TOO_MANY_ROWS'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; e := '{}'; ex := null; td := null; cl := null; ob := null; od := null;
    nm := nullif(btrim(coalesce(r->>'name','')), '');
    if nm is null then e := e || text 'اسم المورد ناقص'; end if;
    if nm is not null and lower(nm) = any(seen) then e := e || text 'المورد ده متكرر في الملف'; elsif nm is not null then seen := seen || lower(nm); end if;
    k := lower(btrim(coalesce(r->>'kind','')));
    kd := case when k = '' then null when k in ('آجل','اجل','أجل','credit','على الحساب') then 'credit' when k in ('كاش','نقدي','نقدى','cash') then 'cash'
               when k in ('أمانة','امانة','بضاعة أمانة','بضاعة امانة','consignment') then 'consignment' else 'bad' end;
    if kd = 'bad' then e := e || text 'نوع المورد لازم يكون: آجل أو كاش أو أمانة'; end if;
    begin td := public._imp_num(r->>'terms_days')::int; exception when others then e := e || text 'مدة السداد لازم تكون رقم أيام'; end;
    if td is not null and td not between 0 and 365 then e := e || text 'مدة السداد من ٠ لـ ٣٦٥ يوم'; end if;
    begin cl := public._imp_num(r->>'credit_limit'); exception when others then e := e || text 'حد الائتمان لازم يكون رقم'; end;
    if cl is not null and cl < 0 then e := e || text 'حد الائتمان مينفعش يكون بالسالب'; end if;
    begin ob := public._imp_num(r->>'opening_balance'); exception when others then e := e || text 'رصيد أول المدة لازم يكون رقم'; end;
    begin od := public._imp_date(r->>'opening_date'); exception when others then e := e || text 'تاريخ الرصيد مش مفهوم — اكتبه زي 2026-01-01'; end;
    if od is not null and od > current_date then e := e || text 'تاريخ الرصيد في المستقبل'; end if;
    if nm is not null then select * into ex from public.suppliers where lower(name) = lower(nm); end if;
    if ex.id is not null then
      if not can_e then e := e || text 'المورد موجود، وتحديثه محتاج صلاحية تعديل الموردين'; end if;
      if ob is not null and ob <> ex.opening_balance then e := e || ('رصيد أول المدة للمورد ده متسجّل قبل كده (' || ex.opening_balance || ') ومش بيتغير من الاستيراد'); end if;
    end if;
    if array_length(e, 1) > 0 then errs := errs || jsonb_build_object('row', i, 'name', nm, 'errs', to_jsonb(e)); continue; end if;
    if ex.id is null then
      nw := nw + 1; tot := tot + coalesce(ob, 0);
      if p_commit then insert into public.suppliers (name, kind, contact, phone, terms_days, credit_limit, bank_info, opening_balance, opening_date)
        values (nm, coalesce(kd,'credit'), nullif(btrim(r->>'contact'),''), nullif(btrim(r->>'phone'),''), coalesce(td,30), coalesce(cl,0), nullif(btrim(r->>'bank_info'),''), coalesce(ob,0), coalesce(od, current_date)); end if;
    else
      up := up + 1;
      if p_commit then update public.suppliers set kind = coalesce(kd, kind), contact = coalesce(nullif(btrim(r->>'contact'),''), contact), phone = coalesce(nullif(btrim(r->>'phone'),''), phone),
        terms_days = coalesce(td, terms_days), credit_limit = coalesce(cl, credit_limit), bank_info = coalesce(nullif(btrim(r->>'bank_info'),''), bank_info) where id = ex.id; end if;
    end if;
  end loop;
  if p_commit then
    if jsonb_array_length(errs) > 0 then raise exception 'IMPORT_HAS_ERRORS'; end if;
    perform public._audit(s, 'استيراد موردين', nw || ' جديد · ' || up || ' تحديث', null, 'أرصدة أول المدة: ' || tot, null, null);
  end if;
  return jsonb_build_object('new', nw, 'updated', up, 'errors', errs, 'opening_total', tot);
end $$;

-- sale prices: the item is found by its code, extra code, barcode, or exact name
create or replace function public.prices_import(p_token text, p_rows jsonb, p_commit boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; r jsonb; i int := 0; e text[]; errs jsonb := '[]'; warns jsonb := '[]'; ch int := 0; same int := 0; it public.items; k text; pr numeric; seen uuid[] := '{}'; n int;
begin
  s := public._session(p_token); perform public._require(s,'items','e');
  if not (public._has(s.role_id,'prices') or s.role_id in ('owner','gm','dataentry')) then raise exception 'NOT_ALLOWED:prices'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then raise exception 'TOO_MANY_ROWS'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; e := '{}'; it := null; pr := null;
    k := nullif(btrim(coalesce(r->>'code','')), '');
    if k is not null then
      select * into it from public.items where code = k or barcode = k;
      if it.id is null then select i2.* into it from public.item_codes c join public.items i2 on i2.id = c.item_id where lower(c.code) = lower(k); end if;
    end if;
    if it.id is null and nullif(btrim(coalesce(r->>'barcode','')), '') is not null then select * into it from public.items where barcode = btrim(r->>'barcode'); end if;
    if it.id is null and nullif(btrim(coalesce(r->>'name','')), '') is not null then
      select count(*) into n from public.items where lower(name) = lower(btrim(r->>'name'));
      if n = 1 then select * into it from public.items where lower(name) = lower(btrim(r->>'name'));
      elsif n > 1 then e := e || text 'فيه أكتر من صنف بنفس الاسم — استخدم الكود'; end if;
    end if;
    if it.id is null and array_length(e, 1) is null then e := e || text 'الصنف مش موجود — اتأكد من الكود أو الباركود أو الاسم'; end if;
    begin pr := public._imp_num(r->>'sale_price'); exception when others then e := e || text 'السعر لازم يكون رقم'; end;
    if pr is null and array_length(e, 1) is null then e := e || text 'السعر الجديد ناقص'; elsif pr is not null and pr <= 0 then e := e || text 'السعر لازم يكون أكبر من صفر'; end if;
    if it.id is not null and it.id = any(seen) then e := e || text 'الصنف ده متكرر في الملف'; elsif it.id is not null then seen := seen || it.id; end if;
    if array_length(e, 1) > 0 then errs := errs || jsonb_build_object('row', i, 'name', coalesce(it.name, r->>'name', k), 'errs', to_jsonb(e)); continue; end if;
    if pr = it.sale_price then same := same + 1; continue; end if;
    ch := ch + 1;
    if it.last_cost > 0 and pr < it.last_cost then warns := warns || jsonb_build_object('row', i, 'name', it.name, 'old', it.sale_price, 'new', pr, 'cost', it.last_cost); end if;
    if p_commit then
      update public.items set sale_price = pr, updated_at = now() where id = it.id;
      perform public._audit(s, 'تعديل سعر بيع', it.name, it.sale_price::text, pr::text, coalesce(nullif(btrim(r->>'reason'),''), 'استيراد أسعار من Excel'), null);
    end if;
  end loop;
  if p_commit and jsonb_array_length(errs) > 0 then raise exception 'IMPORT_HAS_ERRORS'; end if;
  return jsonb_build_object('changed', ch, 'same', same, 'errors', errs, 'below_cost', warns);
end $$;

revoke execute on function public._imp_date(text), public._imp_num(text) from public, anon, authenticated;
revoke execute on function public.customers_import(text, jsonb, boolean), public.suppliers_import(text, jsonb, boolean), public.prices_import(text, jsonb, boolean) from public, anon;
grant execute on function public.customers_import(text, jsonb, boolean), public.suppliers_import(text, jsonb, boolean), public.prices_import(text, jsonb, boolean) to authenticated;
