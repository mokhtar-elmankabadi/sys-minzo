-- 0027 · customers: groups, WhatsApp messages (prepared, sent by hand), welcome message per visit on the receipt,
-- store page (QR) and the return policy. Everything goes through functions; the new tables have no read policy.

-- store.cx = {welcome:[text…], slogan, policy, policy_on, links:{fb, ig, maps, phone, wa, web}}
alter table public.store add column if not exists cx jsonb not null default '{}'::jsonb;
update public.store set cx = jsonb_build_object('welcome', '[]'::jsonb, 'slogan', '', 'policy_on', true,
  'policy', 'الاسترجاع خلال ١٤ يوم من تاريخ الشراء ضد عيوب الصناعة فقط، بأصل الفاتورة.', 'links', '{}'::jsonb)
 where cx = '{}'::jsonb;

-- new sensitive right: customer groups & WhatsApp messages (the general manager has it by default)
update public.roles set sens = sens || '["custMsg"]'::jsonb where id = 'gm' and not sens ? 'custMsg';

create table if not exists public.customer_groups (
  id serial primary key,
  name text not null unique,
  note text,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create table if not exists public.customer_group_members (
  group_id int not null references public.customer_groups(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, customer_id)
);
create table if not exists public.wa_campaigns (
  id serial primary key,
  title text not null,
  body text not null,
  audience text not null,
  group_id int references public.customer_groups(id) on delete set null,
  recipients int not null default 0,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create table if not exists public.wa_sends (
  campaign_id int not null references public.wa_campaigns(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  sent_at timestamptz,
  sent_by uuid references public.staff(id),
  primary key (campaign_id, customer_id)
);
create index if not exists cgm_customer on public.customer_group_members (customer_id);
create index if not exists sales_customer_created on public.sales (customer_id, created_at);
do $$ declare t text; begin
  foreach t in array array['customer_groups','customer_group_members','wa_campaigns','wa_sends'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop; end $$;

create or replace function public._cx_right(s public.sess) returns void
language plpgsql stable security definer set search_path = public as $$
begin if not (s.role_id in ('owner','gm') or public._has(s.role_id,'custMsg')) then raise exception 'NOT_ALLOWED:custMsg'; end if; end $$;

-- receipt messages, page links and return policy (owner / general manager)
create or replace function public.store_cx_save(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; w jsonb := '[]'::jsonb; x text; k text; lk jsonb := '{}'::jsonb; v text; r jsonb;
begin
  s := public._session(p_token);
  if s.role_id not in ('owner','gm') then raise exception 'NOT_ALLOWED:settings'; end if;
  for x in select jsonb_array_elements_text(coalesce(p->'welcome','[]'::jsonb)) loop
    x := left(trim(x), 300);
    if x <> '' then w := w || to_jsonb(x); end if;
  end loop;
  if jsonb_array_length(w) > 30 then raise exception 'TOO_MANY'; end if;
  foreach k in array array['fb','ig','maps','web'] loop
    v := trim(coalesce(p->'links'->>k, ''));
    if v <> '' then
      if v !~* '^https?://' then v := 'https://' || v; end if;
      if v !~* '^https?://[^\s<>"'']+$' or length(v) > 300 then raise exception 'BAD_LINK:%', k; end if;
      lk := lk || jsonb_build_object(k, v);
    end if;
  end loop;
  foreach k in array array['phone','wa'] loop
    v := regexp_replace(coalesce(p->'links'->>k, ''), '[^0-9+]', '', 'g');
    if v <> '' then
      if length(v) < 7 or length(v) > 16 then raise exception 'BAD_LINK:%', k; end if;
      lk := lk || jsonb_build_object(k, v);
    end if;
  end loop;
  r := jsonb_build_object('welcome', w, 'slogan', left(trim(coalesce(p->>'slogan','')), 200),
        'policy', left(trim(coalesce(p->>'policy','')), 400), 'policy_on', coalesce((p->>'policy_on')::boolean, true), 'links', lk);
  update public.store set cx = r, updated_at = now() where id = 1;
  perform public._audit(s, 'رسائل الإيصال وصفحة المحل', null, null, jsonb_array_length(w)::text || ' رسالة', null, null);
  return r;
end $$;

-- which visit is this sale for its customer (1 = first)? null when the sale has no customer
create or replace function public.sale_visit(p_token text, p_sale uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; c uuid; t timestamptz;
begin
  s := public._session(p_token);
  select customer_id, created_at into c, t from public.sales where id = p_sale;
  if c is null then return null; end if;
  return (select count(*) from public.sales where customer_id = c and status = 'posted' and created_at <= t);
end $$;

-- one invoice of a customer, line by line, with the offer each line was sold under
create or replace function public.customer_sale(p_token text, p_sale uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._require(s,'customers','v');
  return (select jsonb_build_object('id',sa.id,'no',sa.no,'at',sa.created_at,'loc',sa.location_id,'status',sa.status,'gross',sa.gross,'discount',sa.discount,'vat',sa.vat,'total',sa.total,
      'seller',(select name from public.staff where id = sa.seller_id),'cashier',(select name from public.staff where id = sa.cashier_id),
      'lines',coalesce((select jsonb_agg(jsonb_build_object('item',it.name,'code',it.code,'qty',sl.qty,'price',sl.unit_price,'disc',sl.discount,'offer_disc',coalesce(sl.offer_disc,0),
                 'offer',o.name,'serial',sl.serial) order by sl.id)
               from public.sale_lines sl left join public.items it on it.id = sl.item_id left join public.offers o on o.id = sl.offer_id where sl.sale_id = sa.id), '[]'::jsonb),
      'payments',coalesce((select jsonb_agg(jsonb_build_object('method',method,'amount',amount)) from public.sale_payments where sale_id = sa.id), '[]'::jsonb),
      'returns',coalesce((select jsonb_agg(jsonb_build_object('no',no,'at',created_at,'amount',amount)) from public.returns where sale_id = sa.id), '[]'::jsonb))
    from public.sales sa where sa.id = p_sale);
end $$;

-- groups
create or replace function public.cust_groups(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._cx_right(s);
  return coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'note',g.note,'at',g.created_at,
            'members',(select coalesce(jsonb_agg(m.customer_id),'[]'::jsonb) from public.customer_group_members m where m.group_id = g.id)) order by g.name)
          from public.customer_groups g), '[]'::jsonb);
end $$;

create or replace function public.cust_group_save(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid int; nm text := left(trim(coalesce(p->>'name','')), 80);
begin
  s := public._session(p_token); perform public._cx_right(s);
  if nm = '' then raise exception 'NAME_REQUIRED'; end if;
  if (p->>'id') is null then
    insert into public.customer_groups (name, note, created_by) values (nm, nullif(left(trim(coalesce(p->>'note','')),200),''), s.staff_id) returning id into nid;
    perform public._audit(s,'مجموعة عملاء جديدة',nm,null,null,null,null);
  else
    update public.customer_groups set name = nm, note = nullif(left(trim(coalesce(p->>'note','')),200),'') where id = (p->>'id')::int returning id into nid;
    if nid is null then raise exception 'NOT_FOUND'; end if;
    perform public._audit(s,'تعديل مجموعة عملاء',nm,null,null,null,null);
  end if;
  return nid;
exception when unique_violation then raise exception 'NAME_TAKEN';
end $$;

create or replace function public.cust_group_delete(p_token text, p_id int) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; nm text;
begin
  s := public._session(p_token); perform public._cx_right(s);
  delete from public.customer_groups where id = p_id returning name into nm;
  if nm is null then raise exception 'NOT_FOUND'; end if;
  perform public._audit(s,'حذف مجموعة عملاء',nm,null,null,null,null);
end $$;

create or replace function public.cust_group_set(p_token text, p_id int, p_add jsonb, p_remove jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; nm text; a int; r int;
begin
  s := public._session(p_token); perform public._cx_right(s);
  select name into nm from public.customer_groups where id = p_id;
  if nm is null then raise exception 'NOT_FOUND'; end if;
  insert into public.customer_group_members (group_id, customer_id)
    select p_id, c.id from public.customers c where c.id::text in (select jsonb_array_elements_text(coalesce(p_add,'[]'::jsonb))) on conflict do nothing;
  get diagnostics a = row_count;
  delete from public.customer_group_members where group_id = p_id and customer_id::text in (select jsonb_array_elements_text(coalesce(p_remove,'[]'::jsonb)));
  get diagnostics r = row_count;
  if a + r > 0 then perform public._audit(s,'أعضاء مجموعة عملاء',nm,null,'+' || a || ' / −' || r,null,null); end if;
  return (select count(*) from public.customer_group_members where group_id = p_id);
end $$;

-- WhatsApp messages: the text is prepared for each customer; a person presses «send» in WhatsApp
create or replace function public.wa_campaign_create(p_token text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare s public.sess; nid int; ttl text := left(trim(coalesce(p->>'title','')), 80); bd text := left(trim(coalesce(p->>'body','')), 1500);
        g int := nullif(p->>'group_id','')::int; ids uuid[]; aud text; n int;
begin
  s := public._session(p_token); perform public._cx_right(s);
  if ttl = '' then raise exception 'NAME_REQUIRED'; end if;
  if bd = '' then raise exception 'MESSAGE_REQUIRED'; end if;
  if p ? 'customers' then
    select array_agg(x::uuid) into ids from jsonb_array_elements_text(p->'customers') x; aud := 'اختيار';
  elsif g is not null then
    select array_agg(customer_id) into ids from public.customer_group_members where group_id = g;
    aud := 'مجموعة: ' || coalesce((select name from public.customer_groups where id = g), '');
  else
    aud := 'كل العملاء';
  end if;
  insert into public.wa_campaigns (title, body, audience, group_id, created_by) values (ttl, bd, aud, g, s.staff_id) returning id into nid;
  insert into public.wa_sends (campaign_id, customer_id)
    select nid, c.id from public.customers c
     where not c.hidden and coalesce(length(regexp_replace(c.phone,'[^0-9]','','g')),0) >= 10 and (ids is null and aud = 'كل العملاء' or c.id = any(ids));
  get diagnostics n = row_count;
  if n = 0 then raise exception 'NO_RECIPIENTS'; end if;
  update public.wa_campaigns set recipients = n where id = nid;
  perform public._audit(s,'رسالة واتساب للعملاء',ttl,null,aud || ' · ' || n,null,null);
  return nid;
end $$;

create or replace function public.wa_campaigns(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._cx_right(s);
  return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'audience',c.audience,'at',c.created_at,'total',c.recipients,
            'by',(select name from public.staff where id = c.created_by),
            'sent',(select count(*) from public.wa_sends w where w.campaign_id = c.id and w.sent_at is not null)) order by c.id desc)
          from (select * from public.wa_campaigns order by id desc limit 100) c), '[]'::jsonb);
end $$;

create or replace function public.wa_campaign_get(p_token text, p_id int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._cx_right(s);
  return (select jsonb_build_object('id',c.id,'title',c.title,'body',c.body,'audience',c.audience,'at',c.created_at,
      'rows',coalesce((select jsonb_agg(jsonb_build_object('id',cu.id,'name',cu.name,'phone',cu.phone,'sent',w.sent_at) order by w.sent_at nulls first, cu.name)
               from public.wa_sends w join public.customers cu on cu.id = w.customer_id where w.campaign_id = c.id), '[]'::jsonb))
    from public.wa_campaigns c where c.id = p_id);
end $$;

create or replace function public.wa_mark(p_token text, p_id int, p_customer uuid, p_sent boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token); perform public._cx_right(s);
  update public.wa_sends set sent_at = case when p_sent then now() end, sent_by = case when p_sent then s.staff_id end
   where campaign_id = p_id and customer_id = p_customer;
end $$;

revoke execute on function public._cx_right(public.sess), public.store_cx_save(text,jsonb), public.sale_visit(text,uuid), public.customer_sale(text,uuid),
  public.cust_groups(text), public.cust_group_save(text,jsonb), public.cust_group_delete(text,int), public.cust_group_set(text,int,jsonb,jsonb),
  public.wa_campaign_create(text,jsonb), public.wa_campaigns(text), public.wa_campaign_get(text,int), public.wa_mark(text,int,uuid,boolean) from public, anon;
grant execute on function public.store_cx_save(text,jsonb), public.sale_visit(text,uuid), public.customer_sale(text,uuid),
  public.cust_groups(text), public.cust_group_save(text,jsonb), public.cust_group_delete(text,int), public.cust_group_set(text,int,jsonb,jsonb),
  public.wa_campaign_create(text,jsonb), public.wa_campaigns(text), public.wa_campaign_get(text,int), public.wa_mark(text,int,uuid,boolean) to authenticated;
