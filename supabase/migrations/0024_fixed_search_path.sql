-- 0024 · pin the search path of two older helpers (security advisor)
alter function public._final_block() set search_path = public;
alter function public._rule_live(public.item_rules, timestamptz) set search_path = public;
