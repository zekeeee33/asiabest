alter table public.inventory_transactions
  add column if not exists quantity_before numeric(14, 3),
  add column if not exists quantity_after numeric(14, 3);
