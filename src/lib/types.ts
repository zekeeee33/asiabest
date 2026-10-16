export type InventoryStatus = 'available' | 'assigned' | 'in_transit' | 'maintenance' | 'damaged' | 'missing' | 'retired'
type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Profile = {
  id: string
  full_name: string
  role: 'administrator' | 'inventory_manager' | 'site_supervisor' | 'equipment_custodian' | 'viewer_auditor'
}

export type InventoryItem = {
  id: string
  name: string
  tracking_type: 'asset' | 'stock'
  asset_tag: string | null
  serial_number: string | null
  status: InventoryStatus
  quantity: number
  unit: string | null
  purchase_cost: number | null
  minimum_stock: number
  created_at: string
  updated_at: string
  location: { name: string } | null
  category: { name: string } | null
}

type TableShape<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      user_profiles: TableShape<Profile>
      equipment_categories: TableShape<{ id: string; name: string }>
      inventory_locations: TableShape<{ id: string; name: string; location_type: string; active: boolean }>
      construction_projects: TableShape<{ id: string; name: string; code: string; active: boolean }>
      inventory_items: TableShape<{
        id: string
        name: string
        tracking_type: 'asset' | 'stock'
        asset_tag: string | null
        serial_number: string | null
        status: InventoryStatus
        quantity: number
        unit: string | null
        purchase_cost: number | null
        purchase_date: string | null
        warranty_expires_on: string | null
        brand: string | null
        model: string | null
        description: string | null
        minimum_stock: number
        category_id: string | null
        location_id: string | null
        project_id: string | null
        created_at: string
        updated_at: string
      }>
      inventory_transactions: TableShape<{ id: string; item_id: string; action: string; quantity: number; quantity_before: number | null; quantity_after: number | null; employee_name: string | null; notes: string | null; created_at: string; performed_by: string | null }>
      equipment_transfers: TableShape<{ id: string; item_id: string; from_location_id: string; to_location_id: string; receiver_name: string; sent_at: string; status: string }>
      maintenance_records: TableShape<{ id: string; item_id: string; issue_description: string; priority: string; status: string; created_at: string }>
      audit_logs: TableShape<{ id: number; actor_id: string | null; action: string; table_name: string; record_id: string; before_value: Json | null; after_value: Json | null; created_at: string }>
    }

    Views: Record<string, never>
    Functions: {
      checkout_asset: { Args: { p_item_id: string; p_employee_name: string; p_project_name: string; p_expected_return_at: string | null; p_notes: string | null }; Returns: string }
      return_asset: { Args: { p_item_id: string; p_condition: string; p_location_id: string | null; p_notes: string | null }; Returns: string }
      move_stock: { Args: { p_item_id: string; p_quantity: number; p_action: string; p_notes: string | null }; Returns: string }
      start_equipment_transfer: { Args: { p_item_id: string; p_to_location_id: string; p_receiver_name: string; p_notes: string | null }; Returns: string }
      receive_equipment_transfer: { Args: { p_transfer_id: string; p_condition: string; p_notes: string | null }; Returns: string }
      set_maintenance_status: { Args: { p_maintenance_id: string; p_status: string; p_condition: string | null; p_notes: string | null }; Returns: string }
      report_asset_issue: { Args: { p_item_id: string; p_status: string; p_notes: string | null }; Returns: string }
      retire_asset: { Args: { p_item_id: string; p_notes: string | null }; Returns: string }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
