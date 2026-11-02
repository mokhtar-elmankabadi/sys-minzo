-- SYS Minzo · phase 1 · core schema
-- Security model: each physical device signs in once (Supabase Auth user owned by the store).
-- Staff then unlock the device with their personal PIN (checked server-side, see 0002).
-- Devices may READ through RLS; every WRITE goes through security-definer functions that
-- check the staff session, the role permissions and limits, and write the audit log.

create extension if not exists pgcrypto;

-- ---------- store & places ----------
create table public.store (
  id smallint primary key default 1 check (id = 1),
  name text not null default 'اسم المحل',
  logo_url text,
  country text not null default 'EG',
  currency text not null default 'EGP',
  vat_registered boolean not null default false,
  vat_rin text,
  vat_from date,
  vat_rate numeric(5,2) not null default 14,
  prices_include_vat boolean not null default true,
  day_close_time time not null default '06:00',
  day_open_time time not null default '07:00',
  setup_done boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.store (id) values (1);

create table public.locations (
  id smallserial primary key,
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('showroom','warehouse')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- roles, staff, devices ----------
create table public.roles (
  id text primary key,
  name text not null,
  perms jsonb not null default '{}'::jsonb,      -- {"pos":"vaedpxri", ...}
  sens jsonb not null default '[]'::jsonb,       -- ["drawer","reprint",...]
  scope_all_locations boolean not null default false,
  scope_days int not null default 0,             -- 0 = no limit
  max_discount_pct numeric(5,2) not null default 0,
  max_amount numeric(14,2) not null default 0,   -- 0 = no limit
  hide_cost boolean not null default true,
  hide_margin boolean not null default true,
  hide_salary boolean not null default true,
  is_base boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role_id text not null references public.roles(id),
  location_id smallint references public.locations(id),   -- null = all locations
  pin_hash text,                 -- crypt() bcrypt hash of the PIN / password
  pin_must_change boolean not null default true,
  email text unique,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  auth_uid uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  kind text not null default 'admin' check (kind in ('admin','cashier','warehouse','custom')),
  location_id smallint references public.locations(id),
  active boolean not null default true,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create table public.staff_sessions (
  token_hash text primary key,
  staff_id uuid not null references public.staff(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- ---------- catalogue ----------
create table public.departments (
  id serial primary key,
  name text not null unique,
  name_en text,
  kind text not null default 'home' check (kind in ('home','elec','tex')),
  sort int not null default 0
);

create table public.item_groups (
  id serial primary key,
  department_id int not null references public.departments(id),
  parent_id int references public.item_groups(id),
  name text not null,
  sort int not null default 0,
  unique (department_id, parent_id, name)
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                      -- internal code
  barcode text unique,                            -- factory barcode or generated label code
  name text not null,
  department_id int references public.departments(id),
  group_id int references public.item_groups(id),
  unit text not null default 'piece' check (unit in ('piece','set','meter','dozen')),
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  last_cost numeric(14,4) not null default 0,
  min_qty numeric(14,3) not null default 0,
  serial_required boolean not null default false,
  warranty_months int not null default 0,
  min_length numeric(8,2),                        -- metre items: shortest sellable length
  vat_rate numeric(5,2),                          -- null = store default
  variants text,
  hidden boolean not null default false,          -- soft delete
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_name_idx on public.items using gin (to_tsvector('simple', name));

-- ---------- stock ----------
create table public.stock (
  item_id uuid not null references public.items(id),
  location_id smallint not null references public.locations(id),
  qty numeric(14,3) not null default 0,
  primary key (item_id, location_id)
);

create table public.stock_layers (          -- FIFO cost layers
  id bigserial primary key,
  item_id uuid not null references public.items(id),
  location_id smallint not null references public.locations(id),
  qty_in numeric(14,3) not null,
  qty_left numeric(14,3) not null,
  unit_cost numeric(14,4) not null,
  ref text,
  created_at timestamptz not null default now()
);
create index stock_layers_open_idx on public.stock_layers (item_id, location_id, id) where qty_left > 0;

create table public.stock_moves (           -- every movement, signed quantity
  id bigserial primary key,
  item_id uuid not null references public.items(id),
  location_id smallint not null references public.locations(id),
  qty numeric(14,3) not null,
  cost numeric(14,2) not null default 0,
  kind text not null check (kind in ('opening','purchase','sale','return','transfer_out','transfer_in','adjust','waste','void')),
  ref_type text,
  ref_id text,
  staff_id uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create index stock_moves_item_idx on public.stock_moves (item_id, location_id, created_at);

create table public.serials (
  serial text primary key,
  item_id uuid not null references public.items(id),
  location_id smallint references public.locations(id),
  status text not null default 'in_stock' check (status in ('in_stock','sold','returned_to_supplier','in_transit')),
  sale_id uuid,
  created_at timestamptz not null default now()
);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  from_location smallint not null references public.locations(id),
  to_location smallint not null references public.locations(id),
  status text not null default 'requested' check (status in ('requested','approved','shipped','received','cancelled')),
  note text,
  requested_by uuid references public.staff(id),
  approved_by uuid references public.staff(id),
  shipped_by uuid references public.staff(id),
  received_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_location <> to_location)
);
create table public.transfer_lines (
  transfer_id uuid not null references public.transfers(id) on delete cascade,
  item_id uuid not null references public.items(id),
  qty numeric(14,3) not null check (qty > 0),
  qty_received numeric(14,3),
  serials text[],
  primary key (transfer_id, item_id)
);

-- ---------- cash ----------
create table public.cash_accounts (
  id serial primary key,
  name text not null,
  kind text not null check (kind in ('drawer','treasury','bank','wallet')),
  location_id smallint references public.locations(id),
  active boolean not null default true
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  location_id smallint not null references public.locations(id),
  device_id uuid references public.devices(id),
  drawer_id int not null references public.cash_accounts(id),
  cashier_id uuid not null references public.staff(id),
  opened_at timestamptz not null default now(),
  opening_float numeric(14,2) not null default 0,
  closed_at timestamptz,
  counted jsonb,                       -- {"den":{"200":3,...},"card":..,"insta":..,"wallet":..}
  expected_cash numeric(14,2),
  counted_cash numeric(14,2),
  diff numeric(14,2),
  diff_reason text,
  status text not null default 'open' check (status in ('open','handed','approved')),
  approved_by uuid references public.staff(id),
  approved_at timestamptz
);
create unique index shifts_one_open_per_drawer on public.shifts (drawer_id) where status = 'open';

create table public.cash_moves (
  id bigserial primary key,
  account_id int not null references public.cash_accounts(id),
  amount numeric(14,2) not null,          -- + in, - out
  kind text not null check (kind in ('opening','sale','refund','expense','transfer','deposit','float','adjust')),
  method text not null default 'cash' check (method in ('cash','card','insta','wallet','bank','cheque','inst')),
  shift_id uuid references public.shifts(id),
  ref_type text,
  ref_id text,
  note text,
  staff_id uuid references public.staff(id),
  created_at timestamptz not null default now()
);

-- ---------- sales ----------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique,
  points int not null default 0,
  created_at timestamptz not null default now()
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  location_id smallint not null references public.locations(id),
  shift_id uuid references public.shifts(id),
  device_id uuid references public.devices(id),
  cashier_id uuid references public.staff(id),
  seller_id uuid references public.staff(id),
  customer_id uuid references public.customers(id),
  business_day date not null,
  gross numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  vat numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  cost numeric(14,2) not null default 0,
  status text not null default 'posted' check (status in ('posted','void')),
  void_reason text,
  void_by uuid references public.staff(id),
  client_uuid uuid unique,                -- idempotency for offline sync
  created_at timestamptz not null default now()
);
create table public.sale_lines (
  id bigserial primary key,
  sale_id uuid not null references public.sales(id) on delete cascade,
  item_id uuid not null references public.items(id),
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  vat numeric(14,2) not null default 0,
  cost numeric(14,2) not null default 0,
  serial text,
  cut_waste_m numeric(8,2)
);
create table public.sale_payments (
  id bigserial primary key,
  sale_id uuid not null references public.sales(id) on delete cascade,
  method text not null check (method in ('cash','card','insta','wallet','inst')),
  amount numeric(14,2) not null
);

-- ---------- audit (append-only, hash chained) ----------
create table public.audit_log (
  n bigserial primary key,
  at timestamptz not null default now(),
  staff_id uuid,
  staff_name text,
  device_id uuid,
  action text not null,
  entity text,
  before text,
  after text,
  reason text,
  location_id smallint,
  prev_hash text,
  hash text
);
create or replace function public.audit_chain() returns trigger language plpgsql set search_path = public, extensions as $$
declare p text;
begin
  select hash into p from public.audit_log order by n desc limit 1;
  new.prev_hash := coalesce(p, 'genesis');
  new.hash := encode(digest(new.prev_hash || coalesce(new.action,'') || coalesce(new.entity,'') || coalesce(new.before,'') || coalesce(new.after,'') || coalesce(new.reason,'') || new.at::text || coalesce(new.staff_id::text,''), 'sha256'), 'hex');
  return new;
end $$;
create trigger audit_chain_bi before insert on public.audit_log for each row execute function public.audit_chain();
create or replace function public.audit_block() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_block_ud before update or delete on public.audit_log for each row execute function public.audit_block();

-- ---------- RLS: active devices may read; nobody writes directly ----------
create or replace function public.is_device() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.devices d where d.auth_uid = auth.uid() and d.active);
$$;

do $$
declare t text;
begin
  foreach t in array array['store','locations','roles','departments','item_groups','items','stock','stock_layers','stock_moves','serials',
                           'transfers','transfer_lines','cash_accounts','shifts','cash_moves','customers','sales','sale_lines','sale_payments','audit_log','devices']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "devices read" on public.%I for select to authenticated using (public.is_device())', t);
  end loop;
end $$;
-- staff and sessions hold PIN hashes and tokens: no direct access at all
alter table public.staff enable row level security;
alter table public.staff_sessions enable row level security;

-- ---------- starting configuration (no business data) ----------
insert into public.locations (code, name, kind) values
  ('s1','المعرض الأول','showroom'), ('s2','المعرض الثاني','showroom'), ('w','المخزن الرئيسي','warehouse');

insert into public.departments (name, name_en, kind, sort) values
  ('أدوات منزلية','Housewares','home',1), ('أجهزة كهربائية','Electrical appliances','elec',2), ('مفروشات','Home textiles','tex',3);

insert into public.cash_accounts (name, kind, location_id) values
  ('درج المعرض الأول','drawer',1), ('درج المعرض الثاني','drawer',2), ('الخزنة الرئيسية','treasury',null);
