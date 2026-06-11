-- M-Pesa STK push request tracking
-- Run in: Supabase SQL editor

create table if not exists mpesa_requests (
  id            uuid primary key default gen_random_uuid(),
  checkout_id   text unique not null,          -- MerchantRequestID from Daraja
  phone         text not null,
  amount        numeric(10, 2) not null,
  status        text not null default 'pending', -- pending | success | failed | timeout
  mpesa_ref     text,                            -- M-Pesa confirmation code (e.g. RGQ71KX63I)
  result_desc   text,                            -- human-readable result from Safaricom
  cashier_id    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists mpesa_requests_checkout_id on mpesa_requests(checkout_id);
create index if not exists mpesa_requests_cashier_id  on mpesa_requests(cashier_id);
create index if not exists mpesa_requests_created_at  on mpesa_requests(created_at desc);

-- Keep updated_at current
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mpesa_updated_at on mpesa_requests;
create trigger trg_mpesa_updated_at
  before update on mpesa_requests
  for each row execute function touch_updated_at();

-- RLS -----------------------------------------------------------------
alter table mpesa_requests enable row level security;

-- Cashiers can see their own requests (for live status polling)
create policy "cashier reads own mpesa requests"
  on mpesa_requests for select
  using (cashier_id = auth.uid());

-- Manager/owner can see all
create policy "manager reads all mpesa requests"
  on mpesa_requests for select
  using (get_my_role() in ('manager', 'owner'));

-- Only the service_role (Edge Functions) may insert / update
-- (cashier initiates via Edge Function, not direct insert)
-- No client-side insert/update policies needed

-- Realtime -----------------------------------------------------------
alter publication supabase_realtime add table mpesa_requests;
