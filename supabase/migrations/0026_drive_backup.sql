-- 0026 · daily copy to Google Drive + Gmail (same design as MELT)
-- A Google Apps Script calls the Edge Function «backup-export» every morning with a secret key; the function calls
-- backup_dump() (everything, for restoring) and backup_readable() (Arabic sheets, for reading) with the service role,
-- builds the Excel file, and writes one line to backup_log. Only the owner can read backup_log from the app.
-- backup_restore_full() is for emergencies only (server side); the in-app «استعادة» button is unchanged.

create table if not exists public.backup_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null default 'drive',
  bytes bigint not null default 0,
  note text
);
alter table public.backup_log enable row level security;
drop policy if exists "owner read" on public.backup_log;
create policy "owner read" on public.backup_log for select to authenticated using ((select (public._rs()).role_id) = 'owner');
revoke all on public.backup_log from anon;
revoke insert, update, delete, truncate on public.backup_log from authenticated;

-- only the sha256 of the secret key is kept; no policy at all → nobody reads it except the service role
create table if not exists public.backup_keys (
  id smallserial primary key,
  key_hash text not null unique,
  label text,
  created_at timestamptz not null default now()
);
alter table public.backup_keys enable row level security;
revoke all on public.backup_keys from anon, authenticated;

-- tables that are never part of the copy: the log itself, the in-app snapshots (would multiply the size) and live sign-ins
create or replace function public._bk_skip() returns text[] language sql immutable set search_path = public as $$ select array['backup_log','backups','staff_sessions'] $$;

-- everything, as {app, version, at, store, tables:{name:[rows]}, seqs}
create or replace function public.backup_dump() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t text; j jsonb; tabs jsonb := '{}'::jsonb; sq jsonb;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> all(public._bk_skip()) order by tablename loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into j;
    tabs := tabs || jsonb_build_object(t, j);
  end loop;
  select coalesce(jsonb_object_agg(sequencename, last_value), '{}'::jsonb) into sq from pg_sequences where schemaname = 'public';
  return jsonb_build_object('app','SYS Minzo','version',1,'at',now(),'store',(select name from public.store limit 1),'tables',tabs,'seqs',sq);
end $$;

-- easy-to-read sheets: [{name, cols:[...], rows:[[...]]}] — arrays keep the column order
create or replace function public.backup_readable() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sh jsonb := '[]'::jsonb; locs jsonb; z text := 'Africa/Cairo';
begin
  -- summary
  sh := sh || jsonb_build_array(jsonb_build_object('name','ملخص النسخة','cols',jsonb_build_array('البيان','القيمة'),'rows',jsonb_build_array(
    jsonb_build_array('المحل', (select name from public.store limit 1)),
    jsonb_build_array('وقت النسخة', to_char(now() at time zone z,'YYYY-MM-DD HH24:MI')),
    jsonb_build_array('عدد الأصناف', (select count(*) from public.items)),
    jsonb_build_array('عدد العملاء', (select count(*) from public.customers)),
    jsonb_build_array('عدد فواتير البيع', (select count(*) from public.sales)),
    jsonb_build_array('إجمالي المبيعات (غير الملغاة)', (select coalesce(sum(total),0) from public.sales where status <> 'void')),
    jsonb_build_array('عدد فواتير الشراء', (select count(*) from public.purchase_invoices)),
    jsonb_build_array('عدد الموردين', (select count(*) from public.suppliers)))));

  -- customers
  sh := sh || jsonb_build_array(jsonb_build_object('name','العملاء','cols',jsonb_build_array('الاسم','التليفون','العنوان','المنطقة','نقاط الولاء','عدد الفواتير','إجمالي المشتريات','آخر شراء','ملاحظات'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(c.name, c.phone, c.address, c.area, c.points, coalesce(x.n,0), coalesce(x.tot,0), x.last, c.notes) order by c.name)
      from public.customers c left join lateral (select count(*) n, sum(total) tot, max(business_day)::text last from public.sales s where s.customer_id = c.id and s.status <> 'void') x on true), '[]'::jsonb)));

  -- sales
  sh := sh || jsonb_build_array(jsonb_build_object('name','فواتير البيع','cols',jsonb_build_array('رقم الفاتورة','اليوم','الوقت','الفرع','العميل','البائع','الكاشير','قبل الخصم','الخصم','الضريبة','الصافي','طرق الدفع','الحالة','سبب الإلغاء'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(s.no, s.business_day::text, to_char(s.created_at at time zone z,'HH24:MI'), l.name, cu.name, se.name, ca.name, s.gross, s.discount, s.vat, s.total,
        (select string_agg(case p.method when 'cash' then 'كاش' when 'card' then 'فيزا' when 'wallet' then 'محفظة' when 'inst' then 'تقسيط' when 'points' then 'نقاط' when 'credit' then 'رصيد' else p.method end || ' ' || p.amount, ' + ') from public.sale_payments p where p.sale_id = s.id),
        case when s.status = 'void' then 'ملغاة' else 'مكتملة' end, s.void_reason) order by s.created_at)
      from public.sales s left join public.locations l on l.id = s.location_id left join public.customers cu on cu.id = s.customer_id
      left join public.staff se on se.id = s.seller_id left join public.staff ca on ca.id = s.cashier_id), '[]'::jsonb)));

  -- sale lines
  sh := sh || jsonb_build_array(jsonb_build_object('name','سطور الفواتير','cols',jsonb_build_array('رقم الفاتورة','اليوم','كود الصنف','الصنف','الكمية','سعر الوحدة','الخصم','الإجمالي','التكلفة','المسلسل','حالة الفاتورة'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(s.no, s.business_day::text, i.code, i.name, sl.qty, sl.unit_price, sl.discount + coalesce(sl.offer_disc,0), round(sl.qty * sl.unit_price - sl.discount - coalesce(sl.offer_disc,0), 2), sl.cost, sl.serial,
        case when s.status = 'void' then 'ملغاة' else 'مكتملة' end) order by s.created_at, sl.id)
      from public.sale_lines sl join public.sales s on s.id = sl.sale_id left join public.items i on i.id = sl.item_id), '[]'::jsonb)));

  -- returns
  sh := sh || jsonb_build_array(jsonb_build_object('name','المرتجعات','cols',jsonb_build_array('رقم المرتجع','التاريخ','رقم الفاتورة','الفرع','السبب','طريقة رد الفلوس','المبلغ'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(r.no, to_char(r.created_at at time zone z,'YYYY-MM-DD HH24:MI'), s.no, l.name, r.reason,
        case r.refund_method when 'cash' then 'كاش' when 'credit' then 'رصيد للعميل' else r.refund_method end, r.amount) order by r.created_at)
      from public.returns r left join public.sales s on s.id = r.sale_id left join public.locations l on l.id = r.location_id), '[]'::jsonb)));

  -- suppliers with balances (what we owe them)
  sh := sh || jsonb_build_array(jsonb_build_object('name','الموردين وأرصدتهم','cols',jsonb_build_array('المورد','النوع','المسؤول','التليفون','أيام السداد','حد الائتمان','رصيد أول المدة','المشتريات','المدفوع','إشعارات دائن','الرصيد المستحق','نشط'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(su.name, su.kind, su.contact, su.phone, su.terms_days, su.credit_limit, su.opening_balance, coalesce(pu.t,0), coalesce(pa.paid,0), coalesce(pa.cn,0),
        su.opening_balance + coalesce(pu.t,0) - coalesce(pa.paid,0) - coalesce(pa.cn,0), case when su.active then 'نعم' else 'لا' end) order by su.name)
      from public.suppliers su
      left join lateral (select sum(total) t from public.purchase_invoices pi where pi.supplier_id = su.id) pu on true
      left join lateral (select sum(amount) filter (where method <> 'credit') paid, sum(amount) filter (where method = 'credit') cn from public.supplier_payments sp where sp.supplier_id = su.id) pa on true), '[]'::jsonb)));

  -- purchase invoices
  sh := sh || jsonb_build_array(jsonb_build_object('name','فواتير الشراء','cols',jsonb_build_array('رقم الفاتورة','رقم فاتورة المورد','المورد','الفرع','التاريخ','تاريخ الاستحقاق','الإجمالي','الخصم','الصافي','ملاحظة'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(pi.no, pi.supplier_ref, su.name, l.name, pi.inv_date::text, pi.due_date::text, pi.gross, pi.discount, pi.total, pi.note) order by pi.inv_date, pi.created_at)
      from public.purchase_invoices pi left join public.suppliers su on su.id = pi.supplier_id left join public.locations l on l.id = pi.location_id), '[]'::jsonb)));

  -- supplier payments
  sh := sh || jsonb_build_array(jsonb_build_object('name','مدفوعات الموردين','cols',jsonb_build_array('رقم','التاريخ','المورد','المبلغ','الطريقة','مرجع','تاريخ الشيك','ملاحظة'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(sp.no, to_char(sp.created_at at time zone z,'YYYY-MM-DD'), su.name, sp.amount,
        case sp.method when 'cash' then 'كاش' when 'bank' then 'تحويل بنكي' when 'cheque' then 'شيك' when 'credit' then 'إشعار دائن' else sp.method end, sp.ref, sp.cheque_date::text, sp.note) order by sp.created_at)
      from public.supplier_payments sp left join public.suppliers su on su.id = sp.supplier_id), '[]'::jsonb)));

  -- items
  sh := sh || jsonb_build_array(jsonb_build_object('name','الأصناف','cols',jsonb_build_array('الكود','الباركود','الصنف','القسم','المجموعة','الماركة','الوحدة','سعر البيع','آخر تكلفة','حد أدنى','ضمان (شهور)','مسلسل','مخفي'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(i.code, i.barcode, i.name, d.name, g.name, i.brand, i.unit, i.sale_price, i.last_cost, i.min_qty, i.warranty_months,
        case when i.serial_required then 'نعم' else 'لا' end, case when i.hidden then 'نعم' else 'لا' end) order by d.name, g.name, i.name)
      from public.items i left join public.departments d on d.id = i.department_id left join public.item_groups g on g.id = i.group_id), '[]'::jsonb)));

  -- stock per location (one column per showroom / warehouse)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id), '[]'::jsonb) into locs from public.locations;
  sh := sh || jsonb_build_array(jsonb_build_object('name','المخزون في كل فرع',
    'cols', jsonb_build_array('الكود','الصنف') || coalesce((select jsonb_agg(x->>'name' order by (x->>'id')::int) from jsonb_array_elements(locs) x), '[]'::jsonb) || jsonb_build_array('الإجمالي','قيمة بالتكلفة'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(i.code, i.name)
        || coalesce((select jsonb_agg(coalesce((select st.qty from public.stock st where st.item_id = i.id and st.location_id = (x->>'id')::smallint), 0) order by (x->>'id')::int) from jsonb_array_elements(locs) x), '[]'::jsonb)
        || jsonb_build_array(coalesce((select sum(qty) from public.stock st where st.item_id = i.id),0), round(coalesce((select sum(qty) from public.stock st where st.item_id = i.id),0) * coalesce(i.last_cost,0), 2))
        order by i.name) from public.items i), '[]'::jsonb)));

  -- cash accounts with balances
  sh := sh || jsonb_build_array(jsonb_build_object('name','الخزن والحسابات','cols',jsonb_build_array('الحساب','النوع','الفرع','الرصيد','نشط'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(a.name, a.kind, l.name, coalesce((select sum(amount) from public.cash_moves m where m.account_id = a.id),0), case when a.active then 'نعم' else 'لا' end) order by a.id)
      from public.cash_accounts a left join public.locations l on l.id = a.location_id), '[]'::jsonb)));

  -- cash movements
  sh := sh || jsonb_build_array(jsonb_build_object('name','حركات الخزنة','cols',jsonb_build_array('التاريخ','الحساب','المبلغ','النوع','الطريقة','المرجع','رقم المرجع','ملاحظة','الموظف'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(to_char(m.created_at at time zone z,'YYYY-MM-DD HH24:MI'), a.name, m.amount, m.kind, m.method, m.ref_type, m.ref_id, m.note, st.name) order by m.created_at, m.id)
      from public.cash_moves m left join public.cash_accounts a on a.id = m.account_id left join public.staff st on st.id = m.staff_id), '[]'::jsonb)));

  -- expenses
  sh := sh || jsonb_build_array(jsonb_build_object('name','المصروفات','cols',jsonb_build_array('رقم','التاريخ','الفرع','البند','المجموعة','المبلغ','المستفيد','الطريقة','الحالة','ملاحظة'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(e.no, e.exp_date::text, l.name, c.name, c.grp, e.amount, e.payee, e.method,
        case e.status when 'approved' then 'معتمد' when 'pending' then 'مستني موافقة' when 'rejected' then 'مرفوض' when 'void' then 'ملغي' else e.status end, e.note) order by e.exp_date, e.created_at)
      from public.expenses e left join public.locations l on l.id = e.location_id left join public.expense_categories c on c.id = e.category_id), '[]'::jsonb)));

  -- staff (no PINs or sign-in data)
  sh := sh || jsonb_build_array(jsonb_build_object('name','الموظفين','cols',jsonb_build_array('الاسم','الدور','الفرع','الإيميل','دخول بالإيميل','نشط','تاريخ الإضافة'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(s.name, r.name, l.name, s.email, case when s.email_login then 'نعم' else 'لا' end, case when s.active then 'نعم' else 'لا' end, to_char(s.created_at at time zone z,'YYYY-MM-DD')) order by s.created_at)
      from public.staff s left join public.roles r on r.id = s.role_id left join public.locations l on l.id = s.location_id), '[]'::jsonb)));

  -- advances
  sh := sh || jsonb_build_array(jsonb_build_object('name','السلف','cols',jsonb_build_array('رقم','الموظف','المبلغ','التاريخ','الحالة','اتخصمت في شهر','ملاحظة'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(a.no, s.name, a.amount, a.adv_date::text, case a.status when 'open' then 'مفتوحة' when 'deducted' then 'اتخصمت' else a.status end, a.payroll_month, a.note) order by a.adv_date)
      from public.advances a left join public.staff s on s.id = a.staff_id), '[]'::jsonb)));

  -- installment companies receivables
  sh := sh || jsonb_build_array(jsonb_build_object('name','مستحقات التقسيط','cols',jsonb_build_array('الشركة','رقم الفاتورة','الفرع','المبلغ','العمولة','الصافي المستحق','تاريخ الاستحقاق','الحالة','المحصّل','تاريخ التحصيل','سبب الفرق'),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(fc.name, s.no, l.name, fr.amount, fr.commission, fr.net, fr.due_date::text, case fr.status when 'settled' then 'اتحصّل' when 'open' then 'مستحق' else fr.status end, fr.received, fr.received_on::text, fr.diff_reason) order by fr.created_at)
      from public.finance_receivables fr left join public.finance_companies fc on fc.id = fr.company_id left join public.sales s on s.id = fr.sale_id left join public.locations l on l.id = fr.location_id), '[]'::jsonb)));

  return jsonb_build_object('app','SYS Minzo','at',now(),'sheets',sh);
end $$;

-- emergency restore of a backup_dump() copy: parents first, user triggers off, delete children → parents,
-- insert with overriding system value, triggers back on, every sequence moved past the largest id
create or replace function public.backup_restore_full(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ord text[] := '{}'; t text; cols text; n bigint; tot bigint := 0; r record; mx bigint; left_ text[]; progress boolean;
begin
  if p->>'app' is distinct from 'SYS Minzo' or jsonb_typeof(p->'tables') <> 'object' then raise exception 'BAD_BACKUP'; end if;
  -- tables of the copy that exist here, sorted so every table comes after the tables it points to
  select coalesce(array_agg(tablename::text order by tablename), '{}') into left_ from pg_tables
   where schemaname = 'public' and p->'tables' ? tablename and tablename <> all(public._bk_skip());
  while array_length(left_, 1) > 0 loop
    progress := false;
    foreach t in array left_ loop
      if not exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = format('public.%I', t)::regclass and c.confrelid <> c.conrelid
                       and (select relname from pg_class where oid = c.confrelid) = any(left_)) then
        ord := ord || t; left_ := array_remove(left_, t); progress := true;
      end if;
    end loop;
    if not progress then raise exception 'FK_CYCLE: %', left_; end if;
  end loop;

  foreach t in array ord loop execute format('alter table public.%I disable trigger user', t); end loop;
  -- live sign-ins point to staff / devices, so they go first (everyone signs in again after a restore)
  delete from public.staff_sessions;
  for i in reverse array_length(ord, 1) .. 1 loop execute format('delete from public.%I', ord[i]); end loop;

  foreach t in array ord loop
    if jsonb_array_length(p->'tables'->t) = 0 then continue; end if;
    select string_agg(format('%I', a.attname), ', ' order by a.attnum) into cols from pg_attribute a
     where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
    execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1)', t, cols, cols, t) using p->'tables'->t;
    get diagnostics n = row_count; tot := tot + n;
  end loop;
  foreach t in array ord loop execute format('alter table public.%I enable trigger user', t); end loop;

  -- every sequence / identity owned by a column → max + 1
  for r in select s.relname seq, c.relname tbl, a.attname col from pg_class s
             join pg_depend d on d.objid = s.oid and d.deptype in ('a','i') join pg_class c on c.oid = d.refobjid
             join pg_attribute a on a.attrelid = c.oid and a.attnum = d.refobjsubid join pg_namespace ns on ns.oid = s.relnamespace
            where s.relkind = 'S' and ns.nspname = 'public' and c.relname = any(ord) loop
    execute format('select max(%I)::bigint from public.%I', r.col, r.tbl) into mx;
    if mx is null then perform setval(format('public.%I', r.seq), 1, false); else perform setval(format('public.%I', r.seq), mx, true); end if;
  end loop;
  return jsonb_build_object('tables', array_length(ord, 1), 'rows', tot);
end $$;

revoke execute on function public.backup_dump(), public.backup_readable(), public.backup_restore_full(jsonb), public._bk_skip() from public, anon, authenticated;
grant execute on function public.backup_dump(), public.backup_readable(), public.backup_restore_full(jsonb) to service_role;
