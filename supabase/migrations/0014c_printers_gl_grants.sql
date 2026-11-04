-- =====================================================================
-- PRINTERS & LABELS
-- =====================================================================
create table public.printers (
  id serial primary key,
  name text not null,
  kind text not null check (kind in ('thermal','laser','label')),
  lang text not null default 'windows',            -- escpos | windows | zpl | tspl | epl
  conn text not null default 'usb',                -- usb | ip | bt | shared
  addr text,
  location_id smallint references public.locations(id),
  paper text not null default '80',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.print_map (
  id serial primary key,
  location_id smallint not null references public.locations(id),
  device_id uuid references public.devices(id) on delete cascade,
  doc text not null check (doc in ('sale','reports','labels','docs')),
  printer_id int references public.printers(id),
  size text,
  copies int not null default 1 check (copies between 1 and 5),
  fallback_id int references public.printers(id),
  locked boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index print_map_uq on public.print_map (location_id, coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid), doc);
create table public.label_templates (
  id serial primary key,
  name text not null,
  w numeric(6,1) not null, h numeric(6,1) not null,
  code text not null default 'code128' check (code in ('code128','ean13','code39','qr')),
  els jsonb not null,
  is_default boolean not null default false,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
insert into public.label_templates (name, w, h, code, els, is_default) values ('ملصق سعر ٥٠×٣٠', 50, 30, 'code128',
 '{"store":{"on":1,"x":2,"y":1.5,"fs":2.2},"name":{"on":1,"x":2,"y":5,"fs":2.6},"bc":{"on":1,"x":2,"y":9.5,"w":46,"h":12},"var":{"on":0,"x":2,"y":23,"fs":2.2},"sn":{"on":0,"x":26,"y":23,"fs":2},"price":{"on":1,"x":30,"y":23.5,"fs":3.6}}', true);
create table public.label_prints (
  id bigserial primary key,
  item_id uuid not null references public.items(id),
  qty int not null,
  template_id int references public.label_templates(id),
  reprint boolean not null default false,
  location_id smallint references public.locations(id),
  staff_id uuid references public.staff(id),
  created_at timestamptz not null default now()
);

create or replace function public._print_setup(s public.sess) returns void language plpgsql stable security definer set search_path = public as $$
begin if not (s.role_id in ('owner','gm') or public._has(s.role_id,'printerSetup')) then raise exception 'NOT_ALLOWED:printerSetup'; end if; end $$;

create or replace function public.printer_save(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid int;
begin
  s := public._session(p_token); perform public._print_setup(s);
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if (p->>'id') is null then
    insert into public.printers (name, kind, lang, conn, addr, location_id, paper) values (trim(p->>'name'), p->>'kind', coalesce(p->>'lang','windows'), coalesce(p->>'conn','usb'),
      nullif(trim(p->>'addr'),''), nullif(p->>'location_id','')::smallint, coalesce(nullif(p->>'paper',''),'80')) returning id into nid;
  else
    update public.printers set name = trim(p->>'name'), kind = p->>'kind', lang = coalesce(p->>'lang', lang), conn = coalesce(p->>'conn', conn), addr = nullif(trim(p->>'addr'),''),
      location_id = nullif(p->>'location_id','')::smallint, paper = coalesce(nullif(p->>'paper',''), paper), active = coalesce((p->>'active')::boolean, active) where id = (p->>'id')::int returning id into nid;
  end if;
  perform public._audit(s,'إعداد طابعة',trim(p->>'name'),null,p->>'kind',null,nullif(p->>'location_id','')::smallint);
  return nid;
end $$;

create or replace function public.print_map_save(p_token text, p_loc smallint, p_device uuid, p_rows jsonb, p_lock boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; r jsonb;
begin
  s := public._session(p_token); perform public._print_setup(s);
  if not public._loc_ok(s, p_loc) then raise exception 'OUT_OF_SCOPE'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.print_map (location_id, device_id, doc, printer_id, size, copies, fallback_id, locked)
    values (p_loc, p_device, r->>'doc', nullif(r->>'printer_id','')::int, nullif(r->>'size',''), coalesce(nullif(r->>'copies','')::int,1), nullif(r->>'fallback_id','')::int, p_lock)
    on conflict (location_id, coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid), doc)
    do update set printer_id = excluded.printer_id, size = excluded.size, copies = excluded.copies, fallback_id = excluded.fallback_id, locked = excluded.locked, updated_at = now();
  end loop;
  perform public._audit(s, case when p_lock then 'حفظ وقفل ربط الطابعات' else 'فتح ربط الطابعات' end, (select name from public.locations where id = p_loc), null, null, null, p_loc);
end $$;

create or replace function public.label_tpl_save(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid int;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._has(s.role_id,'labels') or public._has(s.role_id,'printerSetup')) then raise exception 'NOT_ALLOWED:labels'; end if;
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  if coalesce((p->>'is_default')::boolean,false) then update public.label_templates set is_default = false where is_default; end if;
  if (p->>'id') is null then
    insert into public.label_templates (name, w, h, code, els, is_default, created_by) values (trim(p->>'name'), (p->>'w')::numeric, (p->>'h')::numeric, coalesce(p->>'code','code128'), p->'els',
      coalesce((p->>'is_default')::boolean,false), s.staff_id) returning id into nid;
  else
    update public.label_templates set name = trim(p->>'name'), w = (p->>'w')::numeric, h = (p->>'h')::numeric, code = coalesce(p->>'code', code), els = p->'els',
      is_default = coalesce((p->>'is_default')::boolean, is_default) where id = (p->>'id')::int returning id into nid;
  end if;
  return nid;
end $$;

create or replace function public.label_print_log(p_token text, p_rows jsonb, p_template int, p_loc smallint) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; r jsonb; n int := 0; again int := 0; rp boolean;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._has(s.role_id,'labels')) then raise exception 'NOT_ALLOWED:labels'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    rp := exists (select 1 from public.label_prints where item_id = (r->>'item_id')::uuid);
    insert into public.label_prints (item_id, qty, template_id, reprint, location_id, staff_id) values ((r->>'item_id')::uuid, (r->>'qty')::int, p_template, rp, p_loc, s.staff_id);
    n := n + (r->>'qty')::int; if rp then again := again + 1; end if;
  end loop;
  perform public._audit(s,'طباعة ملصقات',n::text || ' ملصق',null,case when again > 0 then again || ' صنف إعادة طباعة' end,null,p_loc);
  return n;
end $$;

create or replace function public.receipt_save(p_token text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._print_setup(s);
  update public.store set receipt = p, updated_at = now() where id = 1;
  perform public._audit(s,'قالب الإيصال',null,null,p->>'size',null,null);
end $$;

create or replace function public.loyalty_save(p_token text, p_on boolean, p_per numeric, p_value numeric) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm') then raise exception 'NOT_ALLOWED:settings'; end if;
  if coalesce(p_per,0) <= 0 or coalesce(p_value,0) < 0 then raise exception 'BAD_AMOUNT'; end if;
  update public.store set loyalty_on = p_on, loyalty_per = p_per, loyalty_value = p_value, updated_at = now() where id = 1;
  perform public._audit(s,'إعدادات الولاء',null,null,p_per || ' / ' || p_value,null,null);
end $$;

-- ---------- read access for devices ----------
do $$ declare t text; begin foreach t in array array['expense_categories','expenses','day_closings','loyalty_moves','deliveries','printers','print_map','label_templates','label_prints'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy "devices read" on public.%I for select to authenticated using (public.is_device())', t);
end loop; end $$;
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
        select case when cm.gl_account is not null then cm.gl_account
                    when cm.kind in ('float','deposit') and cm.ref_type is distinct from 'finance' then '1110'
                    when cm.kind = 'deposit' and cm.ref_type = 'finance' then '1104'
                    when cm.kind = 'adjust' then case when cm.amount < 0 then '5207' else '4103' end
                    when cm.kind = 'expense' and cm.ref_type = 'supplier' then '2101'
                    when cm.kind = 'opening' then '3103' else '5207' end,
               greatest(-cm.amount,0), greatest(cm.amount,0)
      ) x where cm.kind not in ('sale','refund') and cm.amount <> 0
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
    -- manual & closing entries (approved only)
    select m.entry_date, m.kind, m.no, m.memo, l.account, l.dr, l.cr, null::smallint
      from public.gl_manual m join public.gl_manual_lines l on l.entry_id = m.id where m.status = 'approved'
  ) all_rows
  where d between coalesce(p_from, date '2000-01-01') and coalesce(p_to, date '2999-12-31') and (dr <> 0 or cr <> 0);
$$;
-- ---------- grants: helpers stay private, the screens' functions are callable by signed-in devices ----------
revoke execute on function public._day_closed(smallint,date), public._bday_of(timestamptz), public._expense_pay(public.expenses,uuid), public._day_summary(smallint,date),
  public._cust_spent(uuid), public._cust_points(uuid), public._print_setup(public.sess), public._sale_day_guard(), public._gl_rows(date,date)
  from public, anon, authenticated;
revoke execute on function public.expense_save(text,jsonb), public.expense_decide(text,uuid,boolean,text), public.expense_void(text,uuid,text),
  public.expense_category_save(text,jsonb), public.day_close_preview(text,smallint,date), public.day_close(text,smallint,date,text), public.day_reopen(text,smallint,date,text),
  public.customers_list(text), public.customer_save(text,jsonb), public.loyalty_move(text,uuid,int,text,text), public.customer_history(text,uuid), public.serial_lookup(text,text),
  public.delivery_save(text,jsonb), public.delivery_advance(text,uuid,text,text), public.printer_save(text,jsonb), public.print_map_save(text,smallint,uuid,jsonb,boolean),
  public.label_tpl_save(text,jsonb), public.label_print_log(text,jsonb,int,smallint), public.receipt_save(text,jsonb), public.loyalty_save(text,boolean,numeric,numeric)
  from public, anon;
grant execute on function public.expense_save(text,jsonb), public.expense_decide(text,uuid,boolean,text), public.expense_void(text,uuid,text),
  public.expense_category_save(text,jsonb), public.day_close_preview(text,smallint,date), public.day_close(text,smallint,date,text), public.day_reopen(text,smallint,date,text),
  public.customers_list(text), public.customer_save(text,jsonb), public.loyalty_move(text,uuid,int,text,text), public.customer_history(text,uuid), public.serial_lookup(text,text),
  public.delivery_save(text,jsonb), public.delivery_advance(text,uuid,text,text), public.printer_save(text,jsonb), public.print_map_save(text,smallint,uuid,jsonb,boolean),
  public.label_tpl_save(text,jsonb), public.label_print_log(text,jsonb,int,smallint), public.receipt_save(text,jsonb), public.loyalty_save(text,boolean,numeric,numeric)
  to authenticated;
