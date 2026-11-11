-- 0034 · reports for the new parts + forecast per item and per branch
-- · a price quote now remembers the invoice it became (from now on), so the conversion rate can be reported.
-- · weekly quantities sold per item and place (net of returns) for the item forecast.
-- · who counted what in stock counts, and how many of their items had to be counted again.

alter table public.quotes add column if not exists sale_id uuid references public.sales(id);
alter table public.quotes add column if not exists converted_at timestamptz;

-- after a sale made from a quote: link them (only a fresh sale by the same person, sharing at least one item)
create or replace function public.quote_mark(p_token text, p_quote uuid, p_sale uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; q public.quotes; sa public.sales;
begin
  s := public._session(p_token);
  select * into q from public.quotes where id = p_quote for update;
  select * into sa from public.sales where id = p_sale;
  if q.id is null or sa.id is null or q.sale_id is not null then return; end if;
  if sa.status <> 'posted' or sa.created_at < now() - interval '30 minutes' or s.staff_id not in (sa.cashier_id, coalesce(sa.seller_id, sa.cashier_id)) then return; end if;
  if not exists (select 1 from public.sale_lines l where l.sale_id = sa.id
                   and l.item_id::text in (select x->>'item_id' from jsonb_array_elements(coalesce(q.lines, '[]'::jsonb)) x)) then return; end if;
  update public.quotes set sale_id = sa.id, converted_at = now() where id = q.id;
end $$;

-- weekly net quantity per item and place, last p_weeks weeks (week 1 = the last 7 days)
create or replace function public.fc_item_hist(p_token text, p_weeks int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess; w int := least(greatest(coalesce(p_weeks, 26), 4), 60); d0 date := (now() at time zone 'Africa/Cairo')::date;
begin
  s := public._session(p_token);
  if not (s.role_id in ('owner','gm') or public._can(s.role_id,'reports','v')) then raise exception 'NOT_ALLOWED:reports'; end if;
  return coalesce((
    with mv as (
      select l.item_id, sa.location_id loc, sa.business_day d, l.qty q
        from public.sale_lines l join public.sales sa on sa.id = l.sale_id
       where sa.status = 'posted' and sa.business_day > d0 - w * 7 and sa.business_day <= d0
      union all
      select rl.item_id, r.location_id, (r.created_at at time zone 'Africa/Cairo')::date, -rl.qty
        from public.return_lines rl join public.returns r on r.id = rl.return_id
       where r.created_at > (d0 - w * 7)::timestamp at time zone 'Africa/Cairo'),
    wk as (select item_id, loc, ((d0 - d) / 7) + 1 wk, sum(q) q from mv group by 1, 2, 3)
    select jsonb_agg(jsonb_build_object('item_id', item_id, 'loc', loc, 'w', ws))
      from (select item_id, loc, jsonb_object_agg(wk::text, round(q, 3)) ws from wk where wk between 1 and w group by 1, 2) x), '[]'::jsonb);
end $$;

-- stock counts per counter between two dates (posted counts only)
create or replace function public.stocktake_staff_stats(p_token text, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sess;
begin
  s := public._session(p_token);
  if not public._st_manager(s) then raise exception 'NOT_ALLOWED:stock'; end if;
  return coalesce((
    with t as (select id from public.stocktakes where status = 'posted' and (posted_at at time zone 'Africa/Cairo')::date between p_from and p_to),
    c as (select c.*, max(c.round) over (partition by c.stocktake_id, c.item_id) last_round from public.stocktake_counts c where c.stocktake_id in (select id from t))
    select jsonb_agg(jsonb_build_object('staff', st.name, 'counts', x.counts, 'items', x.items, 'entries', x.entries, 'redone', x.redone) order by x.items desc)
      from (select staff_id, count(distinct stocktake_id) counts, count(distinct (stocktake_id, item_id)) items, count(*) entries,
                   count(distinct (stocktake_id, item_id)) filter (where round < last_round) redone
              from c group by staff_id) x join public.staff st on st.id = x.staff_id), '[]'::jsonb);
end $$;

revoke execute on function public.quote_mark(text, uuid, uuid), public.fc_item_hist(text, int), public.stocktake_staff_stats(text, date, date) from public, anon;
grant execute on function public.quote_mark(text, uuid, uuid), public.fc_item_hist(text, int), public.stocktake_staff_stats(text, date, date) to authenticated;
