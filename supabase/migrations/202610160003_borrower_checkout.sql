alter table public.equipment_assignments
  add column if not exists borrower_contact text;

create or replace function public.can_access_inventory_scope(p_location_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_inventory_role()
    or (p_location_id is not null and public.can_access_location(p_location_id))
    or (p_project_id is not null and public.can_access_project(p_project_id))
$$;

create policy "Users read borrower assignments in item scope"
  on public.equipment_assignments for select to authenticated
  using (
    exists (
      select 1
      from public.inventory_items i
      where i.id = equipment_assignments.item_id
        and public.can_access_inventory_scope(i.location_id, i.project_id)
    )
  );

create or replace function public.checkout_asset_to_borrower(
  p_item_id uuid,
  p_borrower_name text,
  p_borrower_contact text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_items%rowtype;
  v_assignment_id uuid;
begin
  if auth.uid() is null
    or not (
      public.has_inventory_role()
      or coalesce(public.current_app_role() in ('site_supervisor', 'equipment_custodian'), false)
    ) then
    raise exception 'You are not authorized to check out equipment' using errcode = '42501';
  end if;

  if nullif(trim(p_borrower_name), '') is null then
    raise exception 'Borrower name is required' using errcode = '22023';
  end if;
  if p_borrower_contact is not null and length(trim(p_borrower_contact)) > 255 then
    raise exception 'Borrower contact must be 255 characters or fewer' using errcode = '22023';
  end if;

  select *
  into v_item
  from public.inventory_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'Inventory item not found' using errcode = 'P0002';
  end if;
  if v_item.tracking_type <> 'asset' or v_item.status <> 'available' then
    raise exception 'Only available individual assets can be checked out' using errcode = '23514';
  end if;
  if not public.can_access_inventory_scope(v_item.location_id, v_item.project_id)
    or (v_item.location_id is not null and not public.can_access_location(v_item.location_id)) then
    raise exception 'You do not have access to this asset location' using errcode = '42501';
  end if;

  insert into public.equipment_assignments (
    item_id, employee_name, borrower_contact, notes
  )
  values (
    p_item_id, trim(p_borrower_name), nullif(trim(p_borrower_contact), ''), p_notes
  )
  returning id into v_assignment_id;

  update public.inventory_items
  set status = 'assigned', updated_at = now()
  where id = p_item_id;

  insert into public.inventory_transactions (
    item_id, action, from_location_id, employee_name, notes
  )
  values (
    p_item_id, 'checkout', v_item.location_id, trim(p_borrower_name), p_notes
  );

  return v_assignment_id;
end;
$$;

revoke all on function public.checkout_asset_to_borrower(uuid, text, text, text) from public, anon;
grant execute on function public.checkout_asset_to_borrower(uuid, text, text, text) to authenticated;
