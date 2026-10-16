create extension if not exists pgcrypto;

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'viewer_auditor'
    check (role in ('administrator', 'inventory_manager', 'site_supervisor', 'equipment_custodian', 'viewer_auditor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.equipment_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location_type text not null default 'warehouse'
    check (location_type in ('warehouse', 'storage_area', 'construction_site', 'project_warehouse', 'repair_facility', 'person')),
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, location_type)
);

create table public.construction_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index construction_projects_name_ci_unique on public.construction_projects(lower(name));

create table public.user_location_access (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  location_id uuid not null references public.inventory_locations(id) on delete cascade,
  primary key (user_id, location_id)
);

create table public.user_project_access (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  project_id uuid not null references public.construction_projects(id) on delete cascade,
  primary key (user_id, project_id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tracking_type text not null check (tracking_type in ('asset', 'stock')),
  category_id uuid references public.equipment_categories(id) on delete set null,
  location_id uuid references public.inventory_locations(id) on delete set null,
  project_id uuid references public.construction_projects(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  brand text,
  model text,
  serial_number text,
  asset_tag text unique,
  description text,
  purchase_date date,
  purchase_cost numeric(14, 2) check (purchase_cost is null or purchase_cost >= 0),
  warranty_expires_on date,
  condition text not null default 'good'
    check (condition in ('good', 'fair', 'poor', 'damaged', 'missing_parts')),
  status text not null default 'available'
    check (status in ('available', 'assigned', 'in_transit', 'maintenance', 'damaged', 'missing', 'retired')),
  quantity numeric(14, 3) not null default 1 check (quantity >= 0),
  unit text not null default 'unit',
  minimum_stock numeric(14, 3) not null default 0 check (minimum_stock >= 0),
  photo_path text,
  remarks text,
  created_by uuid references public.user_profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((tracking_type = 'asset' and quantity = 1) or tracking_type = 'stock')
);

create unique index inventory_items_serial_unique
  on public.inventory_items(serial_number) where serial_number is not null;
create index inventory_items_status_idx on public.inventory_items(status);
create index inventory_items_location_idx on public.inventory_items(location_id);
create index inventory_items_project_idx on public.inventory_items(project_id);
create index inventory_items_category_idx on public.inventory_items(category_id);
create index inventory_items_updated_idx on public.inventory_items(updated_at desc);

create table public.equipment_assignments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  employee_name text not null,
  project_id uuid references public.construction_projects(id) on delete set null,
  checked_out_by uuid not null references public.user_profiles(id) on delete restrict default auth.uid(),
  checked_out_at timestamptz not null default now(),
  expected_return_at timestamptz,
  returned_by uuid references public.user_profiles(id) on delete restrict,
  returned_at timestamptz,
  return_condition text check (return_condition in ('good', 'fair', 'poor', 'damaged', 'missing_parts')),
  notes text,
  created_at timestamptz not null default now(),
  check (expected_return_at is null or expected_return_at >= checked_out_at),
  check ((returned_at is null and returned_by is null) or (returned_at is not null and returned_by is not null))
);
create unique index equipment_assignments_one_active_per_asset
  on public.equipment_assignments(item_id) where returned_at is null;
create index equipment_assignments_employee_idx on public.equipment_assignments(employee_name);
create index equipment_assignments_project_idx on public.equipment_assignments(project_id);

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  action text not null check (action in ('created', 'checkout', 'return', 'transfer_out', 'transfer_received', 'stock_receipt', 'stock_issue', 'stock_adjustment', 'damage_report', 'mark_missing', 'retire', 'maintenance_start', 'maintenance_complete', 'inspection')),
  quantity numeric(14, 3) not null default 1 check (quantity > 0),
  quantity_before numeric(14, 3),
  quantity_after numeric(14, 3),
  from_location_id uuid references public.inventory_locations(id) on delete set null,
  to_location_id uuid references public.inventory_locations(id) on delete set null,
  employee_name text,
  project_id uuid references public.construction_projects(id) on delete set null,
  notes text,
  performed_by uuid references public.user_profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now()
);
create index inventory_transactions_item_created_idx on public.inventory_transactions(item_id, created_at desc);
create index inventory_transactions_action_idx on public.inventory_transactions(action, created_at desc);

create table public.equipment_transfers (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  from_location_id uuid not null references public.inventory_locations(id) on delete restrict,
  to_location_id uuid not null references public.inventory_locations(id) on delete restrict,
  quantity numeric(14, 3) not null default 1 check (quantity > 0),
  sender_id uuid not null references public.user_profiles(id) on delete restrict default auth.uid(),
  receiver_name text not null,
  receiver_id uuid references public.user_profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'received', 'cancelled')),
  condition_on_receipt text check (condition_on_receipt in ('good', 'fair', 'poor', 'damaged', 'missing_parts')),
  notes text,
  sent_at timestamptz not null default now(),
  received_at timestamptz,
  received_by uuid references public.user_profiles(id) on delete restrict
);
create index equipment_transfers_pending_idx on public.equipment_transfers(status, sent_at desc);

create table public.equipment_inspections (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  inspector_id uuid not null references public.user_profiles(id) on delete restrict default auth.uid(),
  condition text not null check (condition in ('good', 'fair', 'poor', 'damaged', 'missing_parts')),
  notes text,
  inspected_at timestamptz not null default now()
);
create index equipment_inspections_item_idx on public.equipment_inspections(item_id, inspected_at desc);

create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  issue_description text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  maintenance_type text not null default 'repair',
  status text not null default 'requested' check (status in ('requested', 'approved', 'in_progress', 'completed', 'cancelled')),
  reported_by uuid not null references public.user_profiles(id) on delete restrict default auth.uid(),
  assigned_technician text,
  estimated_cost numeric(14, 2) check (estimated_cost is null or estimated_cost >= 0),
  actual_cost numeric(14, 2) check (actual_cost is null or actual_cost >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index maintenance_records_item_idx on public.maintenance_records(item_id, created_at desc);
create index maintenance_records_status_idx on public.maintenance_records(status);

create table public.inventory_notifications (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.inventory_items(id) on delete cascade,
  event_key text not null,
  message text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index inventory_notifications_one_open_event
  on public.inventory_notifications(event_key) where resolved_at is null;

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_record_idx on public.audit_logs(table_name, record_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);

create function public.current_app_role()
returns text language sql stable security definer set search_path = ''
as $$
  select role from public.user_profiles where id = (select auth.uid())
$$;

create function public.has_inventory_role()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('administrator', 'inventory_manager'), false)
$$;

create function public.can_access_location(p_location_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_location_id is null
    or public.has_inventory_role()
    or exists (select 1 from public.user_location_access a where a.user_id = (select auth.uid()) and a.location_id = p_location_id)
$$;

create function public.can_access_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_project_id is null
    or public.has_inventory_role()
    or exists (select 1 from public.user_project_access a where a.user_id = (select auth.uid()) and a.project_id = p_project_id)
$$;

create function public.can_access_inventory_scope(p_location_id uuid, p_project_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.has_inventory_role()
    or (p_location_id is not null and public.can_access_location(p_location_id))
    or (p_project_id is not null and public.can_access_project(p_project_id))
$$;

create function public.can_read_audit_record(p_table_name text, p_before jsonb, p_after jsonb)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_row jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_from_location_id uuid;
  v_to_location_id uuid;
  v_project_id uuid;
begin
  if public.current_app_role() = 'administrator' then return true; end if;
  if public.current_app_role() is distinct from 'viewer_auditor' then return false; end if;
  if p_table_name = 'inventory_items' then
    return
      (p_before is not null and public.can_access_inventory_scope(nullif(p_before ->> 'location_id', '')::uuid, nullif(p_before ->> 'project_id', '')::uuid))
      or (p_after is not null and public.can_access_inventory_scope(nullif(p_after ->> 'location_id', '')::uuid, nullif(p_after ->> 'project_id', '')::uuid));
  end if;
  v_row := coalesce(p_after, p_before);
  if v_row is null then return false; end if;
  v_item_id := nullif(v_row ->> 'item_id', '')::uuid;
  v_location_id := nullif(v_row ->> 'location_id', '')::uuid;
  v_from_location_id := nullif(v_row ->> 'from_location_id', '')::uuid;
  v_to_location_id := nullif(v_row ->> 'to_location_id', '')::uuid;
  v_project_id := nullif(v_row ->> 'project_id', '')::uuid;
  if v_item_id is not null and exists (
    select 1 from public.inventory_items i
    where i.id = v_item_id and public.can_access_inventory_scope(i.location_id, i.project_id)
  ) then return true; end if;
  return (v_location_id is not null and public.can_access_location(v_location_id))
    or (v_from_location_id is not null and public.can_access_location(v_from_location_id))
    or (v_to_location_id is not null and public.can_access_location(v_to_location_id))
    or (v_project_id is not null and public.can_access_project(v_project_id));
end;
$$;

create function public.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.user_profiles(id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger create_profile_for_auth_user
after insert on auth.users
for each row execute function public.handle_new_user_profile();

create function public.audit_inventory_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs(actor_id, action, table_name, record_id, after_value)
    values (auth.uid(), 'insert', tg_table_name, new.id::text, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_logs(actor_id, action, table_name, record_id, before_value, after_value)
    values (auth.uid(), 'update', tg_table_name, new.id::text, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_logs(actor_id, action, table_name, record_id, before_value)
    values (auth.uid(), 'delete', tg_table_name, old.id::text, to_jsonb(old));
    return old;
  end if;
end;
$$;

create trigger inventory_items_audit
after insert or update or delete on public.inventory_items
for each row execute function public.audit_inventory_change();

create function public.record_inventory_creation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.inventory_transactions(item_id, action, quantity, quantity_before, quantity_after, to_location_id, project_id, performed_by)
  values (
    new.id,
    case when new.tracking_type = 'stock' and new.quantity > 0 then 'stock_receipt' else 'created' end,
    case when new.tracking_type = 'stock' and new.quantity > 0 then new.quantity else 1 end,
    0,
    new.quantity,
    new.location_id,
    new.project_id,
    coalesce(auth.uid(), new.created_by)
  );
  if new.tracking_type = 'stock' and new.quantity <= new.minimum_stock then
    insert into public.inventory_notifications(event_key, item_id, message)
    values ('low-stock:' || new.id::text, new.id, 'Stock is at or below its minimum level')
    on conflict (event_key) where resolved_at is null do nothing;
  end if;
  return new;
end;
$$;
create trigger inventory_items_record_creation
after insert on public.inventory_items
for each row execute function public.record_inventory_creation();

create function public.prevent_transaction_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Inventory movement history is immutable' using errcode = '42501';
end;
$$;
create trigger inventory_transactions_immutable
before update or delete on public.inventory_transactions
for each row execute function public.prevent_transaction_mutation();

create function public.guard_inventory_state_changes()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and (
    old.quantity is distinct from new.quantity
    or old.status is distinct from new.status
    or old.condition is distinct from new.condition
    or old.location_id is distinct from new.location_id
    or old.project_id is distinct from new.project_id
  ) then
    raise exception 'Inventory status, quantity, and location changes require an authorized transaction' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger inventory_items_guard_state
before update on public.inventory_items
for each row execute function public.guard_inventory_state_changes();

create trigger assignments_audit after insert or update on public.equipment_assignments
for each row execute function public.audit_inventory_change();
create trigger inventory_transactions_audit after insert on public.inventory_transactions
for each row execute function public.audit_inventory_change();
create trigger transfers_audit after insert or update on public.equipment_transfers
for each row execute function public.audit_inventory_change();
create trigger inspections_audit after insert on public.equipment_inspections
for each row execute function public.audit_inventory_change();
create trigger maintenance_audit after insert or update on public.maintenance_records
for each row execute function public.audit_inventory_change();
create trigger profiles_audit after update on public.user_profiles
for each row execute function public.audit_inventory_change();

create function public.checkout_asset(
  p_item_id uuid,
  p_employee_name text,
  p_project_name text,
  p_expected_return_at timestamptz default null,
  p_notes text default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_item public.inventory_items%rowtype;
  v_project_id uuid;
  v_assignment_id uuid;
begin
  if auth.uid() is null or not (public.has_inventory_role() or coalesce(public.current_app_role() in ('site_supervisor', 'equipment_custodian'), false)) then
    raise exception 'You are not authorized to check out equipment' using errcode = '42501';
  end if;
  if nullif(trim(p_employee_name), '') is null or nullif(trim(p_project_name), '') is null then
    raise exception 'Recipient and project are required' using errcode = '22023';
  end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  if v_item.tracking_type <> 'asset' or v_item.status <> 'available' then
    raise exception 'Only available individual assets can be checked out' using errcode = '23514';
  end if;
  select id into v_project_id from public.construction_projects where lower(name) = lower(trim(p_project_name)) and active;
  if v_project_id is null then raise exception 'Select a valid active construction project' using errcode = '22023'; end if;
  if not public.can_access_inventory_scope(v_item.location_id, v_item.project_id)
    or not public.can_access_project(v_project_id)
    or (v_item.location_id is not null and not public.can_access_location(v_item.location_id)) then
    raise exception 'You do not have access to this project or asset location' using errcode = '42501';
  end if;
  insert into public.equipment_assignments(item_id, employee_name, project_id, expected_return_at, notes)
  values (p_item_id, trim(p_employee_name), v_project_id, p_expected_return_at, p_notes)
  returning id into v_assignment_id;
  update public.inventory_items set status = 'assigned', project_id = v_project_id, updated_at = now() where id = p_item_id;
  insert into public.inventory_transactions(item_id, action, from_location_id, employee_name, project_id, notes)
  values (p_item_id, 'checkout', v_item.location_id, trim(p_employee_name), v_project_id, p_notes);
  return v_assignment_id;
end;
$$;

create function public.return_asset(
  p_item_id uuid,
  p_condition text,
  p_location_id uuid default null,
  p_notes text default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_item public.inventory_items%rowtype;
  v_assignment_id uuid;
  v_assignment_project_id uuid;
  v_old_location_id uuid;
  v_next_status text;
begin
  if auth.uid() is null or not (public.has_inventory_role() or coalesce(public.current_app_role() in ('site_supervisor', 'equipment_custodian'), false)) then
    raise exception 'You are not authorized to return equipment' using errcode = '42501';
  end if;
  if p_condition is null or p_condition not in ('good', 'fair', 'poor', 'damaged', 'missing_parts') then
    raise exception 'Invalid return condition' using errcode = '22023';
  end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  if not public.can_access_inventory_scope(v_item.location_id, v_item.project_id)
    or (p_location_id is not null and not public.can_access_location(p_location_id)) then
    raise exception 'You do not have access to this location' using errcode = '42501';
  end if;
  select id, project_id into v_assignment_id, v_assignment_project_id from public.equipment_assignments where item_id = p_item_id and returned_at is null for update;
  if v_assignment_id is null then raise exception 'No active checkout exists for this asset' using errcode = '23514'; end if;
  update public.equipment_assignments set returned_by = auth.uid(), returned_at = now(), return_condition = p_condition, notes = coalesce(p_notes, notes) where id = v_assignment_id;
  v_next_status := case when p_condition in ('damaged', 'poor', 'missing_parts') then 'damaged' else 'available' end;
  v_old_location_id := v_item.location_id;
  update public.inventory_items set status = v_next_status, condition = p_condition, location_id = coalesce(p_location_id, location_id), project_id = null, updated_at = now() where id = p_item_id;
  insert into public.inventory_transactions(item_id, action, from_location_id, to_location_id, project_id, notes)
  values (p_item_id, 'return', v_old_location_id, coalesce(p_location_id, v_old_location_id), v_assignment_project_id, p_notes);
  return v_assignment_id;
end;
$$;

create function public.move_stock(
  p_item_id uuid,
  p_quantity numeric,
  p_action text,
  p_notes text default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_item public.inventory_items%rowtype;
  v_transaction_id uuid;
  v_delta numeric(14, 3);
  v_action text;
begin
  if auth.uid() is null or not (public.has_inventory_role() or coalesce(public.current_app_role() = 'site_supervisor', false)) then
    raise exception 'You are not authorized to move stock' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 0 or p_action not in ('stock_receipt', 'stock_issue', 'stock_adjustment')
    or (p_action <> 'stock_adjustment' and p_quantity = 0) then
    raise exception 'Invalid stock movement' using errcode = '22023';
  end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  if v_item.tracking_type <> 'stock' then raise exception 'Quantity movements require a stock item' using errcode = '23514'; end if;
  if not public.can_access_inventory_scope(v_item.location_id, v_item.project_id) then
    raise exception 'You do not have access to this stock location or project' using errcode = '42501';
  end if;
  v_action := p_action;
  v_delta := case p_action when 'stock_receipt' then p_quantity when 'stock_issue' then -p_quantity else p_quantity - v_item.quantity end;
  if v_delta = 0 then raise exception 'Stock adjustment does not change the balance' using errcode = '22023'; end if;
  if v_item.quantity + v_delta < 0 then raise exception 'Stock quantity cannot become negative' using errcode = '23514'; end if;
  update public.inventory_items set quantity = quantity + v_delta, updated_at = now() where id = p_item_id;
  insert into public.inventory_transactions(item_id, action, quantity, quantity_before, quantity_after, from_location_id, to_location_id, project_id, notes)
  values (p_item_id, v_action, abs(v_delta), v_item.quantity, v_item.quantity + v_delta, v_item.location_id, v_item.location_id, v_item.project_id, p_notes)
  returning id into v_transaction_id;
  if v_item.quantity + v_delta <= v_item.minimum_stock then
    insert into public.inventory_notifications(event_key, item_id, message)
    values ('low-stock:' || p_item_id::text, p_item_id, 'Stock is at or below its minimum level')
    on conflict (event_key) where resolved_at is null do nothing;
  else
    update public.inventory_notifications set resolved_at = now() where event_key = 'low-stock:' || p_item_id::text and resolved_at is null;
  end if;
  return v_transaction_id;
end;
$$;

create function public.start_equipment_transfer(
  p_item_id uuid,
  p_to_location_id uuid,
  p_receiver_name text,
  p_notes text default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_item public.inventory_items%rowtype;
  v_transfer_id uuid;
begin
  if auth.uid() is null or not (public.has_inventory_role() or coalesce(public.current_app_role() in ('site_supervisor', 'equipment_custodian'), false)) then
    raise exception 'You are not authorized to transfer equipment' using errcode = '42501';
  end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  if v_item.tracking_type <> 'asset' or v_item.status <> 'available' then
    raise exception 'Only available individual assets can be transferred' using errcode = '23514';
  end if;
  if v_item.location_id is null or p_to_location_id = v_item.location_id then
    raise exception 'Choose a different destination for an item with an assigned origin' using errcode = '22023';
  end if;
  if not public.can_access_location(v_item.location_id) or not public.can_access_location(p_to_location_id) then
    raise exception 'You do not have access to the origin or destination location' using errcode = '42501';
  end if;
  if nullif(trim(p_receiver_name), '') is null then raise exception 'A receiving person is required' using errcode = '22023'; end if;
  insert into public.equipment_transfers(item_id, from_location_id, to_location_id, receiver_name, notes)
  values (p_item_id, v_item.location_id, p_to_location_id, trim(p_receiver_name), p_notes)
  returning id into v_transfer_id;
  update public.inventory_items set status = 'in_transit', updated_at = now() where id = p_item_id;
  insert into public.inventory_transactions(item_id, action, from_location_id, to_location_id, project_id, notes)
  values (p_item_id, 'transfer_out', v_item.location_id, p_to_location_id, v_item.project_id, p_notes);
  return v_transfer_id;
end;
$$;

create function public.receive_equipment_transfer(p_transfer_id uuid, p_condition text, p_notes text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_transfer public.equipment_transfers%rowtype;
  v_item public.inventory_items%rowtype;
  v_status text;
begin
  if auth.uid() is null or not (public.has_inventory_role() or coalesce(public.current_app_role() in ('site_supervisor', 'equipment_custodian'), false)) then
    raise exception 'You are not authorized to receive equipment transfers' using errcode = '42501';
  end if;
  if p_condition is null or p_condition not in ('good', 'fair', 'poor', 'damaged', 'missing_parts') then
    raise exception 'Invalid received condition' using errcode = '22023';
  end if;
  select * into v_transfer from public.equipment_transfers where id = p_transfer_id for update;
  if not found or v_transfer.status <> 'pending' then raise exception 'No pending transfer exists' using errcode = '23514'; end if;
  if not public.can_access_location(v_transfer.to_location_id) then raise exception 'You do not have access to the destination location' using errcode = '42501'; end if;
  select * into v_item from public.inventory_items where id = v_transfer.item_id for update;
  if not found or v_item.status <> 'in_transit' then raise exception 'Transferred asset is not in transit' using errcode = '23514'; end if;
  v_status := case when p_condition in ('damaged', 'poor', 'missing_parts') then 'damaged' else 'available' end;
  update public.equipment_transfers set status = 'received', receiver_id = auth.uid(), received_by = auth.uid(), received_at = now(), condition_on_receipt = p_condition, notes = coalesce(p_notes, notes) where id = p_transfer_id;
  update public.inventory_items set location_id = v_transfer.to_location_id, status = v_status, condition = p_condition, updated_at = now() where id = v_item.id;
  insert into public.inventory_transactions(item_id, action, quantity, quantity_before, quantity_after, from_location_id, to_location_id, project_id, employee_name, notes)
  values (v_item.id, 'transfer_received', 1, 1, 1, v_transfer.from_location_id, v_transfer.to_location_id, v_item.project_id, v_transfer.receiver_name, p_notes);
  return p_transfer_id;
end;
$$;

create function public.set_maintenance_status(p_maintenance_id uuid, p_status text, p_condition text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_record public.maintenance_records%rowtype;
  v_item public.inventory_items%rowtype;
  v_next_item_status text;
begin
  if auth.uid() is null or not public.has_inventory_role() then
    raise exception 'Only inventory managers can update maintenance status' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'in_progress', 'completed', 'cancelled') then raise exception 'Invalid maintenance status' using errcode = '22023'; end if;
  if p_status = 'completed' and (p_condition is null or p_condition not in ('good', 'fair', 'poor', 'damaged', 'missing_parts')) then
    raise exception 'A completion condition is required' using errcode = '22023';
  end if;
  select * into v_record from public.maintenance_records where id = p_maintenance_id for update;
  if not found then raise exception 'Maintenance record not found' using errcode = 'P0002'; end if;
  if not (
    (p_status = 'approved' and v_record.status = 'requested')
    or (p_status = 'in_progress' and v_record.status = 'approved')
    or (p_status = 'completed' and v_record.status = 'in_progress')
    or (p_status = 'cancelled' and v_record.status in ('requested', 'approved', 'in_progress'))
  ) then
    raise exception 'Invalid maintenance status transition' using errcode = '23514';
  end if;
  select * into v_item from public.inventory_items where id = v_record.item_id for update;
  if not public.can_access_inventory_scope(v_item.location_id, v_item.project_id) then raise exception 'You do not have access to this asset' using errcode = '42501'; end if;
  if p_status in ('approved', 'in_progress', 'completed') and v_item.status in ('assigned', 'in_transit', 'missing', 'retired') then
    raise exception 'Return or receive the asset before changing its maintenance status' using errcode = '23514';
  end if;
  if p_status in ('approved', 'in_progress') and exists (
    select 1 from public.maintenance_records
    where item_id = v_record.item_id and id <> v_record.id and status in ('approved', 'in_progress')
  ) then
    raise exception 'Another active maintenance request already exists for this asset' using errcode = '23514';
  end if;
  if p_status = 'completed' and exists (
    select 1 from public.maintenance_records
    where item_id = v_record.item_id and id <> v_record.id and status in ('approved', 'in_progress')
  ) then
    raise exception 'Complete other active maintenance work before returning this asset to service' using errcode = '23514';
  end if;
  update public.maintenance_records
    set status = p_status,
        started_at = case when p_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
        completed_at = case when p_status = 'completed' then now() else completed_at end,
        notes = coalesce(p_notes, notes)
    where id = p_maintenance_id;
  if p_status in ('approved', 'in_progress') then
    update public.inventory_items set status = 'maintenance', updated_at = now() where id = v_item.id;
    insert into public.inventory_transactions(item_id, action, project_id, notes)
    values (v_item.id, 'maintenance_start', v_item.project_id, p_notes);
  elsif p_status = 'completed' then
    v_next_item_status := case when p_condition in ('damaged', 'poor', 'missing_parts') then 'damaged' else 'available' end;
    update public.inventory_items set status = v_next_item_status, condition = p_condition, updated_at = now() where id = v_item.id;
    insert into public.inventory_transactions(item_id, action, project_id, notes)
    values (v_item.id, 'maintenance_complete', v_item.project_id, p_notes);
  elsif p_status = 'cancelled' and v_item.status = 'maintenance' then
    update public.inventory_items
      set status = case when condition in ('damaged', 'poor', 'missing_parts') then 'damaged' else 'available' end,
          updated_at = now()
      where id = v_item.id;
  end if;
  return p_maintenance_id;
end;
$$;

create function public.report_asset_issue(p_item_id uuid, p_status text, p_notes text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_item public.inventory_items%rowtype;
  v_action text;
begin
  if auth.uid() is null or not (public.has_inventory_role() or coalesce(public.current_app_role() in ('site_supervisor', 'equipment_custodian'), false)) then
    raise exception 'You are not authorized to report asset issues' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('damaged', 'missing') then raise exception 'Choose damaged or missing status' using errcode = '22023'; end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  if v_item.tracking_type <> 'asset' or not public.can_access_inventory_scope(v_item.location_id, v_item.project_id) then
    raise exception 'You do not have access to this individually tracked asset' using errcode = '42501';
  end if;
  v_action := case when p_status = 'missing' then 'mark_missing' else 'damage_report' end;
  update public.inventory_items
    set status = p_status,
        condition = case when p_status = 'damaged' then 'damaged' else condition end,
        updated_at = now()
    where id = p_item_id;
  insert into public.inventory_transactions(item_id, action, quantity, quantity_before, quantity_after, from_location_id, project_id, notes)
  values (p_item_id, v_action, 1, 1, 1, v_item.location_id, v_item.project_id, p_notes);
  return p_item_id;
end;
$$;

create function public.retire_asset(p_item_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_item public.inventory_items%rowtype;
begin
  if auth.uid() is null or public.current_app_role() is distinct from 'administrator' then
    raise exception 'Only administrators can retire assets' using errcode = '42501';
  end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  if v_item.tracking_type <> 'asset' then raise exception 'Only an individual asset can be retired' using errcode = '23514'; end if;
  if v_item.status in ('assigned', 'in_transit') then raise exception 'Return or receive the asset before retiring it' using errcode = '23514'; end if;
  update public.inventory_items set status = 'retired', updated_at = now() where id = p_item_id;
  insert into public.inventory_transactions(item_id, action, from_location_id, project_id, notes)
  values (p_item_id, 'retire', v_item.location_id, v_item.project_id, p_notes);
  return p_item_id;
end;
$$;

create function public.audit_access_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_values jsonb;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_values := coalesce(v_new, v_old);
  insert into public.audit_logs(actor_id, action, table_name, record_id, before_value, after_value)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_values ->> 'user_id', '') || ':' || coalesce(v_values ->> 'project_id', v_values ->> 'location_id', ''),
    v_old,
    v_new
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger location_grants_audit after insert or update or delete on public.user_location_access
for each row execute function public.audit_access_change();
create trigger project_grants_audit after insert or update or delete on public.user_project_access
for each row execute function public.audit_access_change();

create function public.prevent_audit_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Audit history is immutable' using errcode = '42501';
end;
$$;
create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function public.prevent_audit_mutation();

alter table public.user_profiles enable row level security;
alter table public.equipment_categories enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.construction_projects enable row level security;
alter table public.user_location_access enable row level security;
alter table public.user_project_access enable row level security;
alter table public.suppliers enable row level security;
alter table public.inventory_items enable row level security;
alter table public.equipment_assignments enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.equipment_transfers enable row level security;
alter table public.equipment_inspections enable row level security;
alter table public.maintenance_records enable row level security;
alter table public.inventory_notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy "Profiles readable by owner or administrator" on public.user_profiles for select
  using (id = (select auth.uid()) or public.current_app_role() = 'administrator');
create policy "Administrators manage profiles" on public.user_profiles for all
  using (public.current_app_role() = 'administrator') with check (public.current_app_role() = 'administrator');

create policy "Authenticated users read categories" on public.equipment_categories for select to authenticated using (true);
create policy "Managers manage categories" on public.equipment_categories for all to authenticated
  using (public.has_inventory_role()) with check (public.has_inventory_role());

create policy "Users read assigned locations" on public.inventory_locations for select to authenticated
  using (public.can_access_location(id));
create policy "Managers manage locations" on public.inventory_locations for all to authenticated
  using (public.has_inventory_role()) with check (public.has_inventory_role());

create policy "Users read assigned projects" on public.construction_projects for select to authenticated
  using (public.can_access_project(id));
create policy "Managers manage projects" on public.construction_projects for all to authenticated
  using (public.has_inventory_role()) with check (public.has_inventory_role());

create policy "Users read their location grants" on public.user_location_access for select to authenticated
  using (user_id = (select auth.uid()) or public.current_app_role() = 'administrator');
create policy "Administrators manage location grants" on public.user_location_access for all to authenticated
  using (public.current_app_role() = 'administrator') with check (public.current_app_role() = 'administrator');
create policy "Users read their project grants" on public.user_project_access for select to authenticated
  using (user_id = (select auth.uid()) or public.current_app_role() = 'administrator');
create policy "Administrators manage project grants" on public.user_project_access for all to authenticated
  using (public.current_app_role() = 'administrator') with check (public.current_app_role() = 'administrator');

create policy "Authenticated users read suppliers" on public.suppliers for select to authenticated using (true);
create policy "Managers manage suppliers" on public.suppliers for all to authenticated
  using (public.has_inventory_role()) with check (public.has_inventory_role());

create policy "Users read inventory in scope" on public.inventory_items for select to authenticated
  using (
    public.can_access_inventory_scope(location_id, project_id)
    or exists (
      select 1 from public.equipment_transfers t
      where t.item_id = inventory_items.id and t.status = 'pending' and public.can_access_location(t.to_location_id)
    )
  );
create policy "Managers create inventory" on public.inventory_items for insert to authenticated
  with check (public.has_inventory_role() and public.can_access_inventory_scope(location_id, project_id));
create policy "Managers update inventory" on public.inventory_items for update to authenticated
  using (public.has_inventory_role()) with check (public.has_inventory_role());
create policy "Users read scoped assignments" on public.equipment_assignments for select to authenticated
  using (exists (select 1 from public.inventory_items i where i.id = equipment_assignments.item_id and public.can_access_inventory_scope(i.location_id, equipment_assignments.project_id)));
create policy "Managers read scoped transactions" on public.inventory_transactions for select to authenticated
  using (
    public.has_inventory_role()
    or (from_location_id is not null and public.can_access_location(from_location_id))
    or (to_location_id is not null and public.can_access_location(to_location_id))
    or (project_id is not null and public.can_access_project(project_id))
  );
create policy "Users read scoped transfers" on public.equipment_transfers for select to authenticated
  using (public.can_access_location(from_location_id) or public.can_access_location(to_location_id));
create policy "Users read scoped inspections" on public.equipment_inspections for select to authenticated
  using (exists (select 1 from public.inventory_items i where i.id = item_id and public.can_access_inventory_scope(i.location_id, i.project_id)));
create policy "Authorized users add inspections" on public.equipment_inspections for insert to authenticated
  with check ((public.has_inventory_role() or public.current_app_role() in ('site_supervisor', 'equipment_custodian')) and exists (select 1 from public.inventory_items i where i.id = item_id and public.can_access_inventory_scope(i.location_id, i.project_id)));
create policy "Users read scoped maintenance" on public.maintenance_records for select to authenticated
  using (exists (select 1 from public.inventory_items i where i.id = item_id and public.can_access_inventory_scope(i.location_id, i.project_id)));
create policy "Authorized users request maintenance" on public.maintenance_records for insert to authenticated
  with check ((public.has_inventory_role() or public.current_app_role() in ('site_supervisor', 'equipment_custodian')) and exists (select 1 from public.inventory_items i where i.id = item_id and public.can_access_inventory_scope(i.location_id, i.project_id)));
create policy "Users read scoped notifications" on public.inventory_notifications for select to authenticated
  using (item_id is null or exists (select 1 from public.inventory_items i where i.id = item_id and public.can_access_inventory_scope(i.location_id, i.project_id)));
create policy "Managers resolve notifications" on public.inventory_notifications for update to authenticated
  using (public.has_inventory_role()) with check (public.has_inventory_role());
create policy "Administrators read audit logs" on public.audit_logs for select to authenticated
  using (public.can_read_audit_record(table_name, before_value, after_value));

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
revoke insert, update, delete on public.inventory_transactions, public.equipment_assignments from anon, authenticated;
revoke insert, update, delete on public.equipment_transfers from anon, authenticated;
revoke update, delete on public.maintenance_records from anon, authenticated;
revoke execute on function public.checkout_asset(uuid, text, text, timestamptz, text) from public, anon;
revoke execute on function public.return_asset(uuid, text, uuid, text) from public, anon;
revoke execute on function public.move_stock(uuid, numeric, text, text) from public, anon;
revoke execute on function public.start_equipment_transfer(uuid, uuid, text, text) from public, anon;
revoke execute on function public.receive_equipment_transfer(uuid, text, text) from public, anon;
revoke execute on function public.set_maintenance_status(uuid, text, text, text) from public, anon;
revoke execute on function public.report_asset_issue(uuid, text, text) from public, anon;
revoke execute on function public.retire_asset(uuid, text) from public, anon;
grant execute on function public.checkout_asset(uuid, text, text, timestamptz, text) to authenticated;
grant execute on function public.return_asset(uuid, text, uuid, text) to authenticated;
grant execute on function public.move_stock(uuid, numeric, text, text) to authenticated;
grant execute on function public.start_equipment_transfer(uuid, uuid, text, text) to authenticated;
grant execute on function public.receive_equipment_transfer(uuid, text, text) to authenticated;
grant execute on function public.set_maintenance_status(uuid, text, text, text) to authenticated;
grant execute on function public.report_asset_issue(uuid, text, text) to authenticated;
grant execute on function public.retire_asset(uuid, text) to authenticated;
