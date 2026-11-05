-- 0019 · payroll entry is dated no later than the approval day (fixes salaries missing from statements until month end)
create or replace function public.payroll_approve(p_token text, p_month text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sess; d2 date := ((p_month || '-01')::date + interval '1 month - 1 day')::date; de date; eid uuid; v_gross numeric; v_ded numeric; v_adv numeric; v_net numeric;
begin
  s := public._session(p_token); perform public._staff_right(s,'p');
  if (select status from public.payroll_runs where month = p_month) is distinct from 'draft' then raise exception 'BAD_STATUS'; end if;
  -- the entry lands on the month's last day, or on the approval day when payroll is approved before the month ends,
  -- so the expense never sits in the future while the salaries have already been paid out
  de := greatest((p_month || '-01')::date, least(d2, (now() at time zone 'Africa/Cairo')::date));
  if public._gl_locked(de) then raise exception 'PERIOD_CLOSED'; end if;
  select coalesce(sum(base + allowances + commission + bonus),0), coalesce(sum(late_deduct + absent_deduct + other_deduct),0), coalesce(sum(advances),0), coalesce(sum(net),0)
    into v_gross, v_ded, v_adv, v_net from public.payroll_lines where month = p_month;
  if v_gross = 0 then raise exception 'EMPTY_PAYROLL'; end if;
  if exists (select 1 from public.payroll_lines where month = p_month and net < 0) then raise exception 'NEGATIVE_NET'; end if;
  insert into public.gl_manual (no, entry_date, memo, kind, status, created_by, approved_by) values ('PR-' || p_month, de, 'مرتبات شهر ' || p_month, 'manual', 'approved', s.staff_id, s.staff_id) returning id into eid;
  insert into public.gl_manual_lines (entry_id, account, dr, cr) values (eid, '5201', v_gross - v_ded, 0);
  if v_adv > 0 then insert into public.gl_manual_lines (entry_id, account, dr, cr) values (eid, '1105', 0, v_adv); end if;
  if v_net > 0 then insert into public.gl_manual_lines (entry_id, account, dr, cr) values (eid, '2102', 0, v_net); end if;
  update public.advances set status = 'deducted', payroll_month = p_month where status = 'open' and adv_date <= d2 and staff_id in (select staff_id from public.payroll_lines where month = p_month and advances > 0);
  update public.payroll_runs set status = 'approved', approved_by = s.staff_id, approved_at = now() where month = p_month;
  perform public._audit(s,'اعتماد مرتبات',p_month,null,v_net::text,null,null);
end $$;

