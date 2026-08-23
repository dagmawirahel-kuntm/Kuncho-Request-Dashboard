export type UserRole = 'admin' | 'executive' | 'finance' | 'staff' | 'procurement_officer' | 'hr_officer' | 'project_manager' | 'stock_manager' | 'logistics_officer' | 'design' | 'sales' | 'hse_officer' | 'operations_manager'
export type OrderItemStatus = 'pending' | 'sourced' | 'partially_sourced' | 'unfulfilled' | 'cancelled' | 'stock_fulfilled' | 'stock_pending_dispatch'
export type StockItemType = 'raw_material' | 'tool' | 'consumable'
export type StockMainCategory = 'wood_work' | 'electrical' | 'painting' | 'hardware' | 'construction' | 'tools' | 'booth_return'
// Warehouse location is a real property/workshop name (sourced from the
// rent table), stored as free text — no longer a fixed Zone A–C enum.
export type WarehouseZone = string
export type ToolCondition = 'good' | 'fair' | 'damaged' | 'retired'
export type StockReceiptType = 'purchase' | 'opening_balance' | 'site_return' | 'adjustment'
export type StockIssueType = 'project_use' | 'tool_checkout' | 'damaged' | 'vendor_return' | 'adjustment'
export type StaffType = 'Full Time' | 'Part Time' | 'Contract' | 'Freelance'
export type PaymentStatus = 'pending' | 'processing' | 'paid'
export type OrderStatus = 'pending' | 'approved' | 'rejected' | 'completed'
export type ExpenseApprovalStatus = 'pending' | 'manager_approved' | 'finance_approved' | 'rejected'
export type ExpensePaymentState = 'unpaid' | 'approved_to_pay' | 'sent' | 'paid' | 'void'
export type ExpensePaymentMethod = 'transfer' | 'batch_wire' | 'cpo' | 'cheque' | 'cash' | 'vrf' | 'other'
export type ExpenseType = 'general' | 'purchase_order' | 'vrf' | 'cpo_bond' | 'fuel' | 'subcontract' | 'maintenance' | 'property_rent' | 'labor_payment'
export type OrderApprovalStatus = 'pending' | 'manager_approved' | 'finance_approved' | 'rejected'
export type CashAdvanceApprovalStatus = 'pending' | 'manager_approved' | 'finance_approved' | 'rejected'
export type PayrollApprovalStatus = 'pending' | 'manager_approved' | 'finance_approved' | 'rejected'
export type SaleApprovalStatus = 'pending' | 'manager_approved' | 'finance_approved' | 'rejected'
export type SaleLifecycleStatus = 'Draft' | 'Invoiced' | 'Paid' | 'Cancelled' | 'Refunded'
export type ProformaStatus = 'draft' | 'sent' | 'accepted' | 'converted' | 'expired'
export type DeliveryStatus = 'pending' | 'in_transit' | 'delivered'

export interface Database {
  public: {
    Tables: {
      user_profiles: { Row: UserProfile; Insert: UserProfileInsert; Update: Partial<UserProfileInsert> }
      staff: { Row: Staff; Insert: StaffInsert; Update: Partial<StaffInsert> }
      projects: { Row: Project; Insert: ProjectInsert; Update: Partial<ProjectInsert> }
      vendors: { Row: Vendor; Insert: VendorInsert; Update: Partial<VendorInsert> }
      vendor_attachments: { Row: VendorAttachment; Insert: VendorAttachmentInsert; Update: Partial<VendorAttachmentInsert> }
      categories: { Row: Category; Insert: CategoryInsert; Update: Partial<CategoryInsert> }
      sub_categories: { Row: SubCategory; Insert: SubCategoryInsert; Update: Partial<SubCategoryInsert> }
      expenses: { Row: Expense; Insert: ExpenseInsert; Update: Partial<ExpenseInsert> }
      orders: { Row: Order; Insert: OrderInsert; Update: Partial<OrderInsert> }
      purchase_allocation: { Row: PurchaseAllocation; Insert: PurchaseAllocationInsert; Update: Partial<PurchaseAllocationInsert> }
      transportation_requests: { Row: TransportationRequest; Insert: TransportationRequestInsert; Update: Partial<TransportationRequestInsert> }
      locations: { Row: Location; Insert: LocationInsert; Update: Partial<LocationInsert> }
      accounts: { Row: Account; Insert: AccountInsert; Update: Partial<AccountInsert> }
      transfers: { Row: Transfer; Insert: TransferInsert; Update: Partial<TransferInsert> }
      sales: { Row: Sale; Insert: SaleInsert; Update: Partial<SaleInsert> }
      clients: { Row: Client; Insert: ClientInsert; Update: Partial<ClientInsert> }
      products: { Row: Product; Insert: ProductInsert; Update: Partial<ProductInsert> }
      payroll: { Row: Payroll; Insert: PayrollInsert; Update: Partial<PayrollInsert> }
      emergency_payroll_summary: { Row: EmergencyPayrollSummary; Insert: EmergencyPayrollSummaryInsert; Update: Partial<EmergencyPayrollSummaryInsert> }
      cash_advances: { Row: CashAdvance; Insert: CashAdvanceInsert; Update: Partial<CashAdvanceInsert> }
      vendor_receipt_facilitation: { Row: VendorReceiptFacilitation; Insert: VendorReceiptFacilitationInsert; Update: Partial<VendorReceiptFacilitationInsert> }
      tax_summary: { Row: TaxSummary; Insert: TaxSummaryInsert; Update: Partial<TaxSummaryInsert> }
      tax_obligation_types: { Row: TaxObligationType; Insert: TaxObligationTypeInsert; Update: Partial<TaxObligationTypeInsert> }
      vendor_receipts: { Row: VendorReceipt; Insert: VendorReceiptInsert; Update: Partial<VendorReceipt> }
      tax_engagements: { Row: TaxEngagement; Insert: TaxEngagementInsert; Update: Partial<TaxEngagementInsert> }
      cpo_bonds: { Row: CpoBond; Insert: CpoBondInsert; Update: Partial<CpoBondInsert> }
      payroll_taxes: { Row: PayrollTax; Insert: PayrollTaxInsert; Update: Partial<PayrollTaxInsert> }
      batch_payments: { Row: BatchPayment; Insert: BatchPaymentInsert; Update: Partial<BatchPaymentInsert> }
      timesheet: { Row: Timesheet; Insert: TimesheetInsert; Update: Partial<TimesheetInsert> }
      order_expenses: { Row: OrderExpense; Insert: OrderExpense; Update: Partial<OrderExpense> }
      order_items: { Row: OrderItem; Insert: OrderItemInsert; Update: Partial<OrderItemInsert> }
      expense_order_items: { Row: ExpenseOrderItem; Insert: ExpenseOrderItem; Update: Partial<ExpenseOrderItem> }
      stock_items: { Row: StockItem; Insert: StockItemInsert; Update: Partial<StockItemInsert> }
      stock_receipts: { Row: StockReceipt; Insert: StockReceiptInsert; Update: Partial<StockReceiptInsert> }
      stock_issues: { Row: StockIssue; Insert: StockIssueInsert; Update: Partial<StockIssueInsert> }
      tool_units: { Row: ToolUnit; Insert: ToolUnitInsert; Update: Partial<ToolUnitInsert> }
      tool_checkouts: { Row: ToolCheckout; Insert: ToolCheckoutInsert; Update: Partial<ToolCheckoutInsert> }
      batch_payment_expenses: { Row: BatchPaymentExpense; Insert: BatchPaymentExpense; Update: Partial<BatchPaymentExpense> }
      payroll_staff: { Row: PayrollStaff; Insert: PayrollStaff; Update: Partial<PayrollStaff> }
      cash_advance_expenses: { Row: CashAdvanceExpense; Insert: CashAdvanceExpense; Update: Partial<CashAdvanceExpense> }
    }
  }
}

// ── User Profiles ──────────────────────────────────────────────
export type AccountStatus = 'pending' | 'active' | 'disabled'

export interface UserProfile {
  id: string
  full_name: string
  role: UserRole
  department: string | null
  phone_number: string | null
  account_status: AccountStatus
  is_vrf_manager: boolean
  is_logistics_officer: boolean
  is_ride_hailing_authorized: boolean
  is_tax_officer: boolean
  email: string | null
  trainer_hints_enabled: boolean
  created_at: string
}
export type UserProfileInsert = Omit<UserProfile, 'created_at'>

// ── Staff ──────────────────────────────────────────────────────
export type StaffStatus = 'active' | 'on_leave' | 'terminated'
export type ManagementLevel = 'upper' | 'medium' | 'low'

export interface Staff {
  id: string
  employee_name: string
  staff_type: string | null        // department (Office, Work Shop, Field, etc.) — the bigger group
  employment_type: string | null   // Full Time, Part Time, Contract, Freelance
  role: string | null              // workplace — the employee's specific role/position
  management_level: ManagementLevel | null  // seniority tier: Upper / Medium / Low
  monthly_salary: number | null
  day_rate: number | null
  payment_frequency: string | null
  bank_account: string | null
  starting_date: string | null
  termination_date: string | null
  phone_number: string | null
  email: string | null
  national_id: string | null
  experience: string | null
  status: StaffStatus
  photo_url: string | null
  id_document_url: string | null
  id_document_name: string | null
  user_id: string | null
  department_id: string | null
  sub_team: string | null          // Operations/Construction only: e.g. "Workshop — Carpentry", "Site"
  // Line manager (migration 161). Null is legal — department heads and
  // Executive legitimately have none. Cycles rejected by trigger.
  reports_to_id: string | null
  // Tier 2 casual-labor fields (migration 183/197)
  trade_tag: string | null
  codename_amharic: string | null
  codename_english: string | null
  referred_by_staff_id: string | null
  first_engaged_at: string | null
  last_engaged_at: string | null
  job_description_id: string | null
  created_at: string
  updated_at: string
}
export type StaffInsert = Omit<Staff, 'id' | 'created_at' | 'updated_at'>

// ── Company Events (shared calendar) ─────────────────────────────
export type CompanyEventType = 'announcement' | 'event' | 'task' | 'holiday'

export interface CompanyEvent {
  id: string
  title: string
  description: string | null
  event_date: string
  start_time: string | null
  end_time: string | null
  event_type: CompanyEventType
  department: string | null          // null = company-wide
  recipient_staff_id: string | null  // set = targeted to one person, overrides department
  created_by: string | null
  created_at: string
  updated_at: string
}
export type CompanyEventInsert = Omit<CompanyEvent, 'id' | 'created_at' | 'updated_at'>

// ── Projects ────────────────────────────────────────────────────
export type ProjectHealth = 'On Track' | 'At Risk' | 'Off Track'

// Operations manual §6.1 — seven lifecycle gates, in order. Budget
// baseline locks automatically on the pre_construction_mobilization ->
// procurement_logistics transition (§7.1).
export type ProjectStage =
  | 'business_development'
  | 'design_approvals'
  | 'pre_construction_mobilization'
  | 'procurement_logistics'
  | 'site_execution'
  | 'quality_snagging_handover'
  | 'closeout_final_accounts'

export interface Project {
  id: string
  project_name: string
  department: string | null
  start_date: string | null
  active_for_year: boolean
  project_manager_id: string | null
  finance_contact_id: string | null
  location_id: string | null
  client_id: string | null
  contract_value: number | null
  physical_progress: number | null
  health: ProjectHealth | null
  stage: ProjectStage | null
  target_handover_date: string | null
  budget_baseline_locked_at: string | null
  budget_version: number
  created_at: string
  updated_at: string
}
export type ProjectInsert = Omit<Project, 'id' | 'created_at' | 'updated_at'>

// ── Cost groups & project budgeting ────────────────────────────────
export interface CostGroup {
  id: string
  name: string
  sort_order: number
  created_at: string
}

export interface ProjectBudget {
  id: string
  project_id: string
  cost_group_id: string
  budgeted_amount: number
  version: number
  locked_at: string | null
  locked_by: string | null
  created_at: string
  created_by: string | null
}
export type ProjectBudgetInsert = Omit<ProjectBudget, 'id' | 'created_at'>

// Read-only rows from v_project_cost_group_budget / v_project_budget_summary
export interface ProjectCostGroupBudget {
  project_id: string
  cost_group_id: string | null
  cost_group_name: string
  sort_order: number
  budgeted_amount: number
  actual_amount: number
  committed_amount: number
  remaining_amount: number
  over_budget: boolean
  is_provisional: boolean
}

export interface ProjectBudgetSummary {
  project_id: string
  contract_value: number | null
  budget_version: number
  budget_baseline_locked_at: string | null
  total_budget: number
  total_actual_core: number
  total_committed_core: number
  total_actual_with_labor: number
  total_committed_with_labor: number
  any_group_over_budget: boolean
  bid_margin: number | null
  projected_margin_core: number | null
}

// ── Phase 2: budget lock, variations, warn-only checks ─────────────
export interface BudgetCheckMode {
  id: true
  enforcing: boolean
  updated_at: string | null
  updated_by: string | null
}

export type BudgetVariationStatus = 'pending' | 'approved' | 'rejected'

export interface BudgetVariation {
  id: string
  project_id: string
  cost_group_id: string
  requested_by: string | null
  requested_amount_delta: number
  reason: string
  status: BudgetVariationStatus
  approved_by: string | null
  approved_at: string | null
  resulting_version: number | null
  created_at: string
}
export type BudgetVariationInsert = Omit<BudgetVariation, 'id' | 'created_at' | 'approved_by' | 'approved_at' | 'resulting_version' | 'status'>

export type BudgetCheckSource = 'pr' | 'po'
export type BudgetCheckOutcome = 'allow' | 'warn' | 'block' | 'unavailable'
export type BudgetCheckLogMode = 'warn_only' | 'enforcing'

export interface BudgetCheckLog {
  id: string
  created_at: string
  source: BudgetCheckSource
  source_ref: string | null
  project_id: string | null
  cost_group_id: string | null
  requested_amount: number
  remaining_before: number | null
  outcome: BudgetCheckOutcome
  mode: BudgetCheckLogMode
  created_by: string | null
}
export type BudgetCheckLogInsert = Omit<BudgetCheckLog, 'id' | 'created_at'>

// ── Vendors ─────────────────────────────────────────────────────
export interface Vendor {
  id: string
  vendor_name: string
  vendor_type: string | null
  tin: string | null
  bank_account: string | null
  phone_contact: string | null
  email: string | null
  category: string | null
  wth_eligible: boolean
  /** Vendor releases goods only against proof of payment — bank payments should carry a certificate. */
  requires_payment_confirmation: boolean
  active: boolean
  location: string | null
  address: string | null
  contact_person: string | null
  payment_terms: string | null
  website: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
export type VendorInsert = Omit<Vendor, 'id' | 'created_at' | 'updated_at'>

// ── Vendor Attachments ────────────────────────────────────────────
export type VendorAttachmentCategory =
  | 'business_license'
  | 'trade_registration'
  | 'tin_certificate'
  | 'vat_certificate'
  | 'contract'
  | 'insurance'
  | 'other'

export interface VendorAttachment {
  id: string
  vendor_id: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  category: VendorAttachmentCategory
  notes: string | null
  expiry_date: string | null
  uploaded_by: string | null
  created_at: string
}
export type VendorAttachmentInsert = Omit<VendorAttachment, 'id' | 'created_at'>

// ── Categories (General Ledgers) ──────────────────────────────────
// `nature` classifies the ledger per the accounting equation
// Assets = Liabilities + Owner's Equity: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense'
export type AssetClass = 'Inventory' | 'Fixed Assets' | 'Current Assets' | 'Other'

export interface Category {
  id: string
  category_name: string
  nature: string | null
  parent_type: string | null
  asset_class: AssetClass | null
  cost_group_id: string | null
  created_at: string
  updated_at: string
}
export type CategoryInsert = Omit<Category, 'id' | 'created_at' | 'updated_at'>

// ── Sub-Categories ──────────────────────────────────────────────
export interface SubCategory {
  id: string
  item_name: string
  parent_category_id: string | null
  description: string | null
  active: boolean
  created_at: string
  updated_at: string
}
export type SubCategoryInsert = Omit<SubCategory, 'id' | 'created_at' | 'updated_at'>

// ── Expenses ─────────────────────────────────────────────────────
export interface Expense {
  id: string
  /** Pre-FY2026/27 row from the Airtable import — hidden from lists and aggregates, still fetchable by id. */
  is_archived: boolean
  expense_code: string | null
  item_service_description: string | null
  amount_etb: number | null
  payment_status: boolean
  requested: boolean
  partially_paid: boolean
  bank_ref: string | null
  purchase_type: string | null
  date: string | null
  quantity: number | null
  uom: string | null
  receipt_available: string | null
  expense_type: ExpenseType
  notes: string | null
  proposed_item_name: string | null
  project_name: string | null
  vendors_name: string | null
  vendors_bank_account: string | null
  delivery_status: string[] | null
  delivery_notes: string | null
  contacted: boolean
  verify_wht: boolean
  wht_handling_method: string | null
  wht_fund: string | null
  wht_amount: number | null
  net_payable: number | null
  wht_receipt_prepared: boolean
  wht_receipt_url: string | null
  wht_receipt_name: string | null
  is_new_item: boolean
  description_of_item: string | null
  is_allocated: boolean
  receipt_delivered: boolean
  partial_paid_amount: number | null
  partial_payment_notes: string | null
  total_payment_date: string | null
  partial_payment_date: string | null
  completion_percentage: number | null
  paid_date: string | null
  vendors_location: string | null
  category_id: string | null
  vendor_id: string | null
  project_id: string | null
  staff_id: string | null
  purchaser_user_id: string | null
  sub_category_id: string | null
  account_id: string | null
  vendor_receipt_facilitation_id: string | null
  cpo_bond_id: string | null
  sourcing_bundle_id: string | null
  transfer_id: string | null
  vrf_id: string | null
  tax_summary_id: string | null
  location_id: string | null
  vehicle_id: string | null
  fuel_liters: number | null
  approval_status: ExpenseApprovalStatus
  rejection_reason: string | null
  manager_approved_by: string | null
  manager_approved_at: string | null
  finance_approved_by: string | null
  finance_approved_at: string | null
  requires_finance_approval: boolean
  receipt_url: string | null
  receipt_name: string | null
  subcontractor_engagement_id: string | null
  subcontract_cert_override_by: string | null
  subcontract_cert_override_at: string | null
  payment_state: ExpensePaymentState
  disbursed_by: string | null
  payment_method: ExpensePaymentMethod | null
  payment_state_changed_at: string | null
  property_id: string | null
  rent_payment_request_id: string | null
  paid_to_staff_id: string | null
  rolled_up_from_requisition_id: string | null
  rollup_period_start: string | null
  rollup_period_end: string | null
  created_at: string
  updated_at: string
}
export type ExpenseInsert = Omit<Expense, 'id' | 'expense_code' | 'created_at' | 'updated_at' | 'manager_approved_by' | 'manager_approved_at' | 'finance_approved_by' | 'finance_approved_at' | 'requires_finance_approval' | 'subcontract_cert_override_by' | 'subcontract_cert_override_at' | 'payment_state_changed_at' | 'net_payable'>

// ── Properties & Rent ────────────────────────────────────────────
export interface Property {
  id: string
  property_name: string
  property_type: string | null
  purpose: string | null
  address: string | null
  landlord_vendor_id: string | null
  monthly_rent_amount: number | null
  lease_start_date: string | null
  lease_end_date: string | null
  deposit_amount: number | null
  renewal_notice_days: number | null
  payment_interval_months: number
  latitude: number | null
  longitude: number | null
  status: 'active' | 'vacated'
  notes: string | null
  created_at: string
  updated_at: string
}
export type PropertyInsert = Omit<Property, 'id' | 'created_at' | 'updated_at'>

export type RentPaymentRequestStatus = 'pending' | 'approved' | 'rejected' | 'paid'
export interface RentPaymentRequest {
  id: string
  property_id: string
  period_start: string
  period_end: string
  amount: number
  status: RentPaymentRequestStatus
  requested_by: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
}
export type RentPaymentRequestInsert = Omit<RentPaymentRequest, 'id' | 'created_at' | 'status' | 'approved_by' | 'approved_at'>

// ── Orders ───────────────────────────────────────────────────────
export type OrderPriority = 'normal' | 'urgent' | 'critical'

export interface Order {
  id: string
  is_archived: boolean
  request_code: string | null
  order_name: string | null
  order_date: string | null
  item_service_description: string | null
  quantity: number | null
  status: OrderStatus | null
  notes: string | null
  vendor_recommendation: string | null
  project_id: string | null
  staff_id: string | null
  category_id: string | null
  recommended_vendor_id: string | null
  approval_status: OrderApprovalStatus
  rejection_reason: string | null
  manager_approved_by: string | null
  manager_approved_at: string | null
  finance_approved_by: string | null
  finance_approved_at: string | null
  // procurement fields (migrations 019-020)
  sub_category_id: string | null
  unit: string | null
  unit_price_estimate: number | null
  required_by_date: string | null
  priority: OrderPriority | null
  is_new_item: boolean
  // migration 023: submitter identity; staff_id repurposed as procurement officer
  requested_by_user_id: string | null
  created_at: string
  updated_at: string
}
export type OrderInsert = Omit<Order, 'id' | 'created_at' | 'updated_at' | 'manager_approved_by' | 'manager_approved_at' | 'finance_approved_by' | 'finance_approved_at'>

// ── Purchase Allocation ──────────────────────────────────────────
export interface PurchaseAllocation {
  id: string
  allocation_name: string | null
  parent_purchase_id: string | null
  sub_category_id: string | null
  quantity: number | null
  uom: string | null
  unit_price_vat_status: string | null
  unit_price: number | null
  project_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
export type PurchaseAllocationInsert = Omit<PurchaseAllocation, 'id' | 'allocation_name' | 'created_at' | 'updated_at'>

// ── Transportation Requests ──────────────────────────────────────
export type TransportJobType = 'material_move' | 'purchase_pickup' | 'document_courier' | 'people_move'
export type TransportMode = 'own_fleet' | 'ride_hailing' | 'hired'
export type HiredVehicleClass = 'lada' | 'mini_isuzu' | 'isuzu' | 'toyota_carryon' | 'other'
export type TransportJobStatus = 'requested' | 'assigned' | 'in_progress' | 'completed' | 'cancelled'

export interface TransportationRequest {
  id: string
  request_name: string | null
  requested_date: string | null
  payment_status: boolean
  requested: boolean
  amount: number | null
  bank_ref: string | null
  delivery_status: string | null
  vehicle_type: string | null
  driver_name: string | null
  expected_delivery_date: string | null
  actual_delivery_date: string | null
  pickup_location_text: string | null
  dropoff_location_text: string | null
  vendor_name: string | null
  vendor_bank_account: string | null
  notes: string | null
  requested_by_id: string | null
  project_id: string | null
  expense_id: string | null
  sourcing_bundle_id: string | null
  pickup_location_id: string | null
  dropoff_location_id: string | null
  vendor_id: string | null
  job_type: TransportJobType
  transport_mode: TransportMode
  vehicle_id: string | null
  hired_vehicle_class: HiredVehicleClass | null
  assigned_staff_id: string | null
  job_status: TransportJobStatus
  priority: 'normal' | 'urgent' | 'critical'
  /** How long this job occupies the vehicle. Feeds the per-vehicle queue ETA — distinct from expected_delivery_date. */
  expected_duration_minutes: number | null
  cargo_size_estimate: VehicleCapacityClass | null
  expected_duration_hours: number | null
  completed_at: string | null
  created_at: string
  updated_at: string
}
export type TransportationRequestInsert = Omit<TransportationRequest, 'id' | 'created_at' | 'updated_at' | 'completed_at'>

/** v_transport_vehicle_queue — chained ETA per vehicle, own_fleet jobs only. */
export interface TransportVehicleQueueRow {
  id: string
  vehicle_id: string
  vehicle_name: string
  request_name: string | null
  job_type: TransportJobType
  job_status: TransportJobStatus
  priority: 'normal' | 'urgent' | 'critical'
  queue_position: number
  expected_duration_minutes: number | null
  estimated_start: string | null
  estimated_finish: string | null
  chain_intact: boolean
}

// ── Locations ────────────────────────────────────────────────────
export type LocationKind = 'site' | 'vendor_shop' | 'office' | 'workshop' | 'warehouse' | 'client' | 'other'

export interface Location {
  id: string
  location_name: string
  location_type: string | null
  notes: string | null
  latitude: number | null
  longitude: number | null
  kind: LocationKind
  project_id: string | null
  vendor_id: string | null
  created_at: string
}
export type LocationInsert = Omit<Location, 'id' | 'created_at'>

// ── Vehicles (owned fleet) ────────────────────────────────────────
export type VehicleStatus = 'available' | 'on_job' | 'maintenance' | 'offline'
export type VehicleCapacityClass = 'motorbike' | 'light' | 'medium' | 'heavy'

export interface Vehicle {
  id: string
  name: string
  vehicle_type: 'truck' | 'pickup' | 'motorbike' | 'van' | 'other'
  plate_number: string | null
  recognized_in_books: boolean
  status: VehicleStatus
  purpose_notes: string | null
  image_url: string | null
  fuel_tank_liters: number | null
  energy_type: 'fuel' | 'electric'
  capacity_class: VehicleCapacityClass | null
  assigned_driver_id: string | null
  active: boolean
  /** Set once this vehicle is registered on the fixed asset register — its purchase cost, depreciation, and schedule then live on that fixed_assets row instead. */
  fixed_asset_id: string | null
  created_at: string
  updated_at: string
}
export type VehicleInsert = Omit<Vehicle, 'id' | 'created_at' | 'updated_at'>

export interface VehicleEnergyLog {
  id: string
  vehicle_id: string
  logged_by: string | null
  reading_at: string
  energy_type: 'fuel' | 'electric'
  fuel_liters: number | null
  charge_percent: number | null
  transportation_request_id: string | null
  note: string | null
  created_at: string
}
export type VehicleEnergyLogInsert = Pick<VehicleEnergyLog, 'vehicle_id' | 'energy_type'>
  & Partial<Pick<VehicleEnergyLog, 'fuel_liters' | 'charge_percent' | 'transportation_request_id' | 'note' | 'reading_at'>>

/** v_vehicle_energy_current — latest reading + depletion per vehicle. */
export interface VehicleEnergyCurrent {
  vehicle_id: string
  vehicle_name: string
  energy_type: 'fuel' | 'electric'
  fuel_tank_liters: number | null
  reading_at: string | null
  fuel_liters: number | null
  charge_percent: number | null
  logged_by: string | null
  note: string | null
  percent_remaining: number | null
  depleted: number | null
}

// ── Transportation: overdue/on-time derivation and driver KPI ──────
export interface TransportationPickupStatus {
  id: string
  request_name: string | null
  job_type: TransportJobType
  job_status: TransportJobStatus
  priority: 'normal' | 'urgent' | 'critical'
  assigned_staff_id: string | null
  vehicle_id: string | null
  sourcing_bundle_id: string | null
  created_at: string
  expected_duration_hours: number | null
  completed_at: string | null
  expected_by: string | null
  is_overdue: boolean
  completed_on_time: boolean | null
}

export interface LogisticsTransportTurnaroundKpi {
  staff_id: string
  jobs_with_target_completed: number
  jobs_on_time: number
  jobs_late: number
  on_time_pct: number | null
}

export interface SuggestedVehicle {
  vehicle_id: string
  name: string
  vehicle_type: string
  capacity_class: VehicleCapacityClass | null
  status: VehicleStatus
  fit_rank: number
}

// ── Accounts ─────────────────────────────────────────────────────
export interface Account {
  id: string
  account_name: string
  type: string | null
  account_number: string | null
  notes: string | null
  status: string | null
  created_at: string
  updated_at: string
}
export type AccountInsert = Omit<Account, 'id' | 'created_at' | 'updated_at'>

// ── Transfers ────────────────────────────────────────────────────
export interface Transfer {
  id: string
  is_archived: boolean
  transfer_id_code: string | null
  date: string | null
  from_account_id: string | null
  to_account_id: string | null
  amount: number | null
  notes: string | null
  created_at: string
}
export type TransferInsert = Omit<Transfer, 'id' | 'created_at'>

// ── Sales ────────────────────────────────────────────────────────
export interface Sale {
  id: string
  is_archived: boolean
  sales_description: string
  sales_status: SaleLifecycleStatus | null
  date: string | null
  amount: number | null
  product_or_service: string | null
  payment_method: string | null
  notes: string | null
  client_id: string | null
  project_id: string | null
  is_project_funded: boolean
  fiscal_period_id: string | null
  account_id: string | null
  tax_summary_id: string | null
  invoice_number: string | null
  due_date: string | null
  payment_date: string | null
  proforma_id: string | null
  approval_status: SaleApprovalStatus
  rejection_reason: string | null
  manager_approved_by: string | null
  manager_approved_at: string | null
  finance_approved_by: string | null
  finance_approved_at: string | null
  transfer_id: string | null
  contract_id: string | null
  is_final_payment: boolean
  created_at: string
  updated_at: string
}
export type SaleInsert = Omit<Sale, 'id' | 'created_at' | 'updated_at' | 'manager_approved_by' | 'manager_approved_at' | 'finance_approved_by' | 'finance_approved_at' | 'transfer_id'>

// ── Proformas ─────────────────────────────────────────────────────
export interface Proforma {
  id: string
  proforma_number: string | null
  client_id: string | null
  project_id: string | null
  date: string
  validity_days: number | null
  payment_terms: string | null
  notes: string | null
  subtotal: number | null
  vat_amount: number | null
  total: number | null
  status: ProformaStatus
  converted_sale_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}
export type ProformaInsert = Omit<Proforma, 'id' | 'created_at' | 'updated_at'>

export interface ProformaItem {
  id: string
  proforma_id: string
  description: string
  qty: number
  unit: string | null
  unit_price: number
  vat_rate: number | null
  sort_order: number | null
  created_at: string
}
export type ProformaItemInsert = Omit<ProformaItem, 'id' | 'created_at'>

// ── Clients ──────────────────────────────────────────────────────
export interface Client {
  id: string
  client_name: string
  phone_number: string | null
  email: string | null
  additional_email: string | null
  business_type: string | null
  address: string | null
  notes: string | null
  receipt_vouched: boolean
  logo_url: string | null
  created_at: string
  updated_at: string
}
export type ClientInsert = Omit<Client, 'id' | 'created_at' | 'updated_at'>

// ── Client attachments ────────────────────────────────────────────
export type AttachmentCategory = 'receipt' | 'contract' | 'wht_receipt' | 'other'
export interface ClientAttachment {
  id: string
  client_id: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  category: AttachmentCategory
  notes: string | null
  amount: number | null
  sale_id: string | null
  /** Stamped server-side on insert — this is the presenter for receipt categories. */
  uploaded_by: string | null
  created_at: string
  // ── Tax workflow (migration 158). Set only for receipt/wht_receipt;
  // null on contracts and other, where the workflow doesn't apply.
  project_id: string | null
  receipt_no: string | null
  receipt_date: string | null
  vat_amount: number | null
  tax_status: ClientReceiptTaxStatus | null
  tax_reviewed_by: string | null
  tax_reviewed_at: string | null
  tax_review_note: string | null
  tax_rejection_reason: string | null
  physical_received_at: string | null
  physical_received_by: string | null
  physical_note: string | null
}
export type ClientReceiptInsert = Pick<ClientAttachment,
  'client_id' | 'file_name' | 'file_path' | 'category' | 'sale_id'>
  & Partial<Pick<ClientAttachment,
    'file_size' | 'mime_type' | 'notes' | 'amount' | 'project_id'
    | 'receipt_no' | 'receipt_date' | 'vat_amount'>>

// ── Products ─────────────────────────────────────────────────────
export interface Product {
  id: string
  product_name: string
  category: string | null
  unit_price: number | null
  active: boolean
  description: string | null
  created_at: string
  updated_at: string
}
export type ProductInsert = Omit<Product, 'id' | 'created_at' | 'updated_at'>

// ── Payroll ──────────────────────────────────────────────────────
export interface Payroll {
  id: string
  is_archived: boolean
  payroll_record: string | null
  pay_period: string | null
  start_date: string | null
  end_date: string | null
  payroll_type: string | null
  payment_status: 'pending' | 'processing' | 'paid'
  payment_method: string | null
  notes: string | null
  account_id: string | null
  transfer_id: string | null
  vrf_id: string | null
  approval_status: PayrollApprovalStatus
  rejection_reason: string | null
  manager_approved_by: string | null
  manager_approved_at: string | null
  finance_approved_by: string | null
  finance_approved_at: string | null
  created_at: string
  updated_at: string
}
export type PayrollInsert = Omit<Payroll, 'id' | 'payroll_record' | 'created_at' | 'updated_at' | 'approval_status' | 'manager_approved_by' | 'manager_approved_at' | 'finance_approved_by' | 'finance_approved_at' | 'rejection_reason'>

// ── Emergency Payroll Summary ─────────────────────────────────────
export interface EmergencyPayrollSummary {
  id: string
  record_name: string | null
  payroll_month: string | null
  days_worked: number | null
  total_ot_days: number | null
  total_bonus: number | null
  advance_taken: number | null
  payment_status: string | null
  payment_date: string | null
  notes: string | null
  staff_id: string | null
  payroll_id: string | null
  created_at: string
  updated_at: string
}
export type EmergencyPayrollSummaryInsert = Omit<EmergencyPayrollSummary, 'id' | 'record_name' | 'created_at' | 'updated_at'>

// ── Cash Advances ─────────────────────────────────────────────────
export interface CashAdvance {
  id: string
  is_archived: boolean
  advance_id_code: string | null
  amount_advanced: number | null
  date_given: string | null
  notes: string | null
  staff_id: string | null
  account_used_id: string | null
  payroll_id: string | null
  approval_status: CashAdvanceApprovalStatus
  rejection_reason: string | null
  manager_approved_by: string | null
  manager_approved_at: string | null
  finance_approved_by: string | null
  finance_approved_at: string | null
  created_at: string
  updated_at: string
}
export type CashAdvanceInsert = Omit<CashAdvance, 'id' | 'created_at' | 'updated_at' | 'manager_approved_by' | 'manager_approved_at' | 'finance_approved_by' | 'finance_approved_at'>

// ── Vendor Receipt Facilitation ───────────────────────────────────
export type VrfStatus = 'open' | 'partial' | 'settled'
export interface VendorReceiptFacilitation {
  id: string
  is_archived: boolean
  record_name: string | null
  amount_transferred: number | null
  money_returned: number | null
  notes: string | null
  net_facilitation_cost: number | null
  commission_rate: number | null
  commission_amount: number | null
  facilitator_name: string | null
  status: VrfStatus
  trxn_date: string | null
  initial_account_id: string | null
  return_account_id: string | null
  created_at: string
  updated_at: string
}
export type VendorReceiptFacilitationInsert = Omit<VendorReceiptFacilitation, 'id' | 'record_name' | 'created_at' | 'updated_at'>

// ── Cash / VRF Payment Receipts ────────────────────────────────────
export interface CashPaymentReceipt {
  id: string
  expense_id: string | null
  payroll_id: string | null
  photo_url: string
  uploaded_by: string | null
  uploaded_at: string
  notes: string | null
}
export type CashPaymentReceiptInsert = Omit<CashPaymentReceipt, 'id' | 'uploaded_at'>

// ── Bank Statement Import ──────────────────────────────────────────
export type BankStatementImportStatus = 'draft' | 'committed'
export interface BankStatementImport {
  id: string
  account_id: string
  file_name: string | null
  period_start: string | null
  period_end: string | null
  starting_balance: number | null
  ending_balance: number | null
  status: BankStatementImportStatus
  uploaded_by: string | null
  uploaded_at: string
  committed_at: string | null
  notes: string | null
}
export type BankStatementImportInsert = Omit<BankStatementImport, 'id' | 'uploaded_at' | 'committed_at' | 'status'>

export type BankStatementLineMatchStatus = 'unmatched' | 'matched_expense' | 'matched_sale' | 'duplicate' | 'manual'
export interface BankStatementLine {
  id: string
  import_id: string
  line_no: number
  value_date: string | null
  post_date: string | null
  transaction_type: string | null
  narration: string | null
  debit_amount: number | null
  credit_amount: number | null
  running_balance: number | null
  reference: string | null
  reference_code: string | null
  matched_expense_id: string | null
  matched_sale_id: string | null
  transfer_id: string | null
  match_status: BankStatementLineMatchStatus
  // Recorded at match time (migration 154), not derived on read — the
  // expense's amount can be edited later, and what the reconciliation
  // record needs is what the two sides were when they were matched.
  matched_expense_amount: number | null
  // Statement line amount minus matched expense amount. Negative = the
  // line only partly offsets the expense, positive = it exceeds it.
  variance_amount: number | null
  // Set when a non-sale incoming credit is classified and booked to the
  // ledger (migration 233): owner_injection / loan_received /
  // vendor_refund / inter_account_transfer / other_income.
  credit_classification: string | null
  created_at: string
}
export type BankStatementLineInsert = Omit<BankStatementLine, 'id' | 'created_at' | 'matched_expense_id' | 'matched_sale_id' | 'transfer_id' | 'match_status' | 'matched_expense_amount' | 'variance_amount' | 'credit_classification'>

// ── Sourcing Bundles ─────────────────────────────────────────────
export type SourcingBundleStatus = 'drafting' | 'submitted' | 'approved' | 'ordered' | 'fulfilled' | 'cancelled'

export type SourcingBundlePaymentPattern = 'pay_on_delivery' | 'pay_in_advance'

export interface SourcingBundle {
  id: string
  bundle_code: string
  vendor_id: string | null
  vendor_name: string | null
  status: SourcingBundleStatus
  procurement_officer_id: string | null
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  ordered_at: string | null
  fulfilled_at: string | null
  expected_delivery_date: string | null
  notes: string | null
  finance_notes: string | null
  expense_id: string | null
  total_value: number
  payment_pattern: SourcingBundlePaymentPattern
  created_at: string
  updated_at: string
}
export type SourcingBundleInsert = Omit<SourcingBundle, 'id' | 'bundle_code' | 'created_at' | 'updated_at' | 'total_value'>

// ── Finance sourcing review (the "should we pursue this" gate between
// stock check and sourcing bundle creation) ────────────────────────
export type FinanceSourcingReviewStatus = 'pending' | 'approved' | 'rejected' | 'exempt'
export interface FinanceSourcingReview {
  id: string
  order_item_id: string
  status: FinanceSourcingReviewStatus
  reviewed_by: string | null
  reviewed_at: string | null
  notes: string | null
  created_at: string
}

export interface SourcingBundleItem {
  id: string
  bundle_id: string
  order_item_id: string
  quantity_actual: number | null
  unit_price_actual: number | null
  notes: string | null
  sort_order: number
  created_at: string
}
export type SourcingBundleItemInsert = Omit<SourcingBundleItem, 'id' | 'created_at'>

// ── Goods Received Notes (GRN) ──────────────────────────────────────
export interface GoodsReceivedNote {
  id: string
  grn_code: string
  sourcing_bundle_id: string
  transportation_request_id: string | null
  received_by: string | null
  received_at: string
  category_id: string | null
  notes: string | null
  photo_url: string | null
  photo_name: string | null
  created_at: string
}
export type GoodsReceivedNoteInsert = Omit<GoodsReceivedNote, 'id' | 'grn_code' | 'created_at'>

// Per-line quality verdict at receipt (migration 159). 'damaged' still
// enters stock — the material is physically on site and has to be
// accounted for; 'rejected' was refused at the door and does not.
export type GrnQualityStatus = 'accepted' | 'damaged' | 'rejected'

export interface GoodsReceivedNoteItem {
  id: string
  grn_id: string
  sourcing_bundle_item_id: string
  quantity_received: number | null
  condition_notes: string | null
  // Per-line, because one bundle can mix ledgers. Supersedes the
  // header-level goods_received_notes.category_id.
  category_id: string | null
  quality_status: GrnQualityStatus
  created_at: string
}
export type GoodsReceivedNoteItemInsert = Omit<GoodsReceivedNoteItem, 'id' | 'created_at'>

// ── Tax Summary ───────────────────────────────────────────────────
export interface TaxSummary {
  id: string
  month: string
  vat_from_expenses: number | null
  vat_from_sales: number | null
  wht_from_expenses: number | null
  wht_deducted_by_client: number | null
  created_at: string
}
export type TaxSummaryInsert = Omit<TaxSummary, 'id' | 'created_at'>

// ── Tax Obligation Types / Engagements ───────────────────────────────
export interface TaxObligationType {
  id: string
  tax_type: 'VAT' | 'WHT' | 'payroll_tax' | 'other'
  name: string
  frequency: 'monthly' | 'quarterly' | 'annual'
  due_day_of_month: number | null
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}
export type TaxObligationTypeInsert = Omit<TaxObligationType, 'id' | 'created_at' | 'updated_at'>

export interface TaxEngagement {
  id: string
  obligation_type_id: string
  period_month: string
  due_date: string | null
  filed_date: string | null
  reference_number: string | null
  document_url: string | null
  filed_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
export type TaxEngagementInsert = Omit<TaxEngagement, 'id' | 'created_at' | 'updated_at'>

export interface TaxEngagementView {
  id: string
  period_month: string
  due_date: string | null
  filed_date: string | null
  reference_number: string | null
  document_url: string | null
  notes: string | null
  obligation_type_id: string
  tax_type: string
  obligation_name: string
  filed_by_name: string | null
  status: 'filed' | 'pending' | 'overdue'
}

export interface NextTaxObligation {
  obligation_type_id: string
  tax_type: string
  name: string
  due_day_of_month: number | null
  next_period_month: string
  suggested_due_date: string | null
}

export interface TaxLiabilityRow {
  category: string
  period: string
  amount: number
}

// ── Vendor Receipts (the tax document — NOT vendor_receipt_facilitation,
// which is the separate cost of paying a facilitator to obtain one) ──
export type VendorReceiptStatus = 'pending_verification' | 'verified' | 'tax_reviewed' | 'rejected'

export interface VendorReceipt {
  id: string
  expense_id: string | null
  grn_id: string | null
  vendor_id: string | null
  project_id: string | null
  receipt_no: string | null
  receipt_date: string | null
  vat_amount: number | null
  withholding_amount: number | null
  vendor_tin_on_receipt: string | null
  document_url: string | null
  document_name: string | null
  /** The same document filed under the vendor (vendor_attachments, category tax_receipt). */
  vendor_attachment_id: string | null
  notes: string | null
  status: VendorReceiptStatus
  entered_by: string | null
  entered_at: string | null
  verified_by: string | null
  verified_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  tax_review_note: string | null
  rejection_reason: string | null
  /** Physical custody — orthogonal to the review chain, not a fourth status. */
  physical_received_at: string | null
  physical_received_by: string | null
  physical_note: string | null
  created_at: string
  updated_at: string
}
export type VendorReceiptInsert = Omit<VendorReceipt,
  'id' | 'status' | 'entered_by' | 'entered_at' | 'verified_by' | 'verified_at'
  | 'reviewed_by' | 'reviewed_at' | 'physical_received_at' | 'physical_received_by'
  | 'created_at' | 'updated_at'>

export interface ReceiptAwaitingTaxReview {
  id: string
  receipt_no: string | null
  receipt_date: string | null
  vat_amount: number | null
  withholding_amount: number | null
  vendor_tin_on_receipt: string | null
  document_url: string | null
  vendor_name: string | null
  project_id: string | null
  project_name: string | null
  expense_code: string | null
  entered_by_name: string | null
  verified_by_name: string | null
  verified_at: string | null
}

// ── Client receipts live on client_attachments (migration 158) ───────
// There is deliberately no sales_receipts table: client_attachments has
// carried category='receipt' + sale_id since 018, so a separate table
// was a second home for the same document. The tax workflow columns
// below are set only for receipt/wht_receipt categories; uploaded_by is
// the presenter.
export type ClientReceiptTaxStatus = 'pending_review' | 'tax_reviewed' | 'rejected'

export interface SalesReceiptOutstanding {
  sale_id: string
  invoice_number: string | null
  date: string | null
  gross_amount: number | null
  sales_status: string | null
  is_vat_exempt: boolean
  expected_vat: number | null
  project_id: string | null
  project_name: string | null
  client_id: string | null
  client_name: string | null
  receipt_status: string
}

export interface TaxPositionRow {
  month: string
  output_vat: number
  input_vat_reclaimable: number
  net_vat: number
  position: 'payable' | 'reclaimable'
  sale_count: number
  reviewed_receipt_count: number
}

/** v_vendor_tax_receipts — the vendor page's own Tax Receipts section. */
export interface VendorTaxReceipt {
  id: string
  vendor_id: string | null
  receipt_no: string | null
  receipt_date: string | null
  vat_amount: number | null
  withholding_amount: number | null
  vendor_tin_on_receipt: string | null
  status: VendorReceiptStatus
  physical_received_at: string | null
  document_path: string | null
  document_bucket: string
  document_name: string | null
  project_id: string | null
  project_name: string | null
  expense_code: string | null
  expense_id: string | null
  grn_id: string | null
  entered_by_name: string | null
  verified_by_name: string | null
  reviewed_by_name: string | null
  entered_at: string | null
  verified_at: string | null
  reviewed_at: string | null
}

export interface ReceiptOutstanding {
  expense_id: string
  expense_code: string | null
  date: string | null
  amount_etb: number | null
  project_id: string | null
  project_name: string | null
  vendor_id: string | null
  vendor_name: string | null
  vendor_tin: string | null
  receipt_status: string
}

// ── CPO Bonds ─────────────────────────────────────────────────────
export interface CpoBond {
  id: string
  bond_id_ref: string | null
  project: string | null
  total_bond_amount: number | null
  bond_status: string | null
  notes: string | null
  vendor_id: string | null
  paid_from_id: string | null
  related_expense_id: string | null
  opportunity_id: string | null
  requested_by: string | null
  created_at: string
  updated_at: string
}
export type CpoBondInsert = Omit<CpoBond, 'id' | 'created_at' | 'updated_at'>

// ── Payroll Taxes ─────────────────────────────────────────────────
export interface PayrollTax {
  id: string
  record_name: string | null
  payroll_month: string | null
  gross_salary: number | null
  tax_amount: number | null
  taxable: string | null
  staff_id: string | null
  payroll_id: string | null
  created_at: string
  updated_at: string
}
export type PayrollTaxInsert = Omit<PayrollTax, 'id' | 'record_name' | 'created_at' | 'updated_at'>

// ── Batch Payments ────────────────────────────────────────────────
export interface BatchPayment {
  id: string
  payment_code: string | null
  notes: string | null
  assignee_id: string | null
  transfer_id: string | null
  created_at: string
  updated_at: string
}
export type BatchPaymentInsert = Omit<BatchPayment, 'id' | 'created_at' | 'updated_at'>

// ── Finance dashboard views (migration 100) ────────────────────────
export interface ToPayQueueRow {
  id: string
  expense_code: string | null
  item_service_description: string | null
  amount_etb: number | null
  vendor_id: string | null
  vendor_name: string | null
  project_id: string | null
  project_name: string | null
  cost_group_id: string | null
  cost_group_name: string | null
  verify_wht: boolean
  finance_approved_by: string | null
  finance_approved_at: string | null
  days_since_approval: number | null
  sourcing_bundle_id: string | null
  payment_pattern: SourcingBundlePaymentPattern | null
  // Net actually leaving the bank (VAT in, WHT withheld) — the figure on
  // the PO. Equals amount_etb when there's no WHT. Added in migration 230.
  net_payable: number | null
  wht_amount: number | null
}

export interface OpenVendorAdvanceRow {
  id: string
  expense_code: string | null
  item_service_description: string | null
  amount_etb: number | null
  vendor_id: string | null
  vendor_name: string | null
  sourcing_bundle_id: string | null
  bundle_code: string | null
  disbursed_by: string | null
  payment_state_changed_at: string | null
  days_open: number | null
}

export interface FinancePendingApprovalRow {
  id: string
  expense_code: string | null
  item_service_description: string | null
  amount_etb: number | null
  vendor_id: string | null
  vendor_name: string | null
  project_id: string | null
  project_name: string | null
  approval_status: ExpenseApprovalStatus
  manager_approved_by: string | null
  manager_approved_at: string | null
  created_at: string
}

export interface AccountCashPositionRow {
  account_id: string
  account_name: string
  total_credits: number
  total_debits: number
  cash_position: number
}

// Every sent bank-method payment still awaiting a matched statement
// line, at any age (migration 232) — the confirmation surface that
// isn't time-boxed to the last 7 days.
export interface AwaitingBankConfirmationRow {
  id: string
  expense_code: string | null
  item_service_description: string | null
  vendor_id: string | null
  vendor_name: string | null
  amount_etb: number | null
  net_payable: number | null
  payment_method: ExpensePaymentMethod | null
  account_id: string | null
  account_name: string | null
  payment_state_changed_at: string | null
  days_waiting: number | null
  batch_payment_id: string | null
}

// Per-account statement reconciliation state (migration 232) — feeds
// the cash board's expandable insight.
export interface AccountStatementSummaryRow {
  account_id: string
  last_import_at: string | null
  committed_lines: number
  unmatched_lines: number
  matched_lines: number
}

// The minimal shape MatchTransferModal needs — satisfied by both a
// recent payment and an awaiting-confirmation row.
export interface MatchableRow {
  id: string
  amount_etb: number | null
  batch_payment_id: string | null
}

export interface RecentPaymentRow {
  id: string
  expense_code: string | null
  item_service_description: string | null
  amount_etb: number | null
  vendor_id: string | null
  vendor_name: string | null
  payment_state: ExpensePaymentState
  payment_method: ExpensePaymentMethod | null
  disbursed_by: string | null
  payment_state_changed_at: string | null
  transfer_id: string | null
  transfer_id_code: string | null
  transfer_notes: string | null
  vrf_id: string | null
  vrf_record_name: string | null
  batch_payment_id: string | null
  net_payable: number | null
  wht_amount: number | null
}

// ── Timesheet ─────────────────────────────────────────────────────
export interface Timesheet {
  id: string
  is_archived: boolean
  code: string | null
  date: string | null
  check_in_time: string | null
  check_out_time: string | null
  notes: string | null
  staff_id: string | null
  project_id: string | null
  payroll_id: string | null
  labor_tier: number | null
  labor_allocation_id: string | null
  labor_requisition_id: string | null
  casual_worker_name: string | null
  day_rate: number | null
  days_worked: number | null
  created_at: string
  updated_at: string
}
export type TimesheetInsert = Omit<Timesheet, 'id' | 'code' | 'created_at' | 'updated_at'>

// ── Junction Tables (many-to-many) ────────────────────────────────
export interface OrderExpense {
  order_id: string
  expense_id: string
}

export interface BatchPaymentExpense {
  batch_payment_id: string
  expense_id: string
}

export interface PayrollStaff {
  payroll_id: string
  staff_id: string
  gross_amount: number | null
  deductions: number | null
  net_amount: number | null
}

export interface CashAdvanceExpense {
  cash_advance_id: string
  expense_id: string
}

// ── Order Items ───────────────────────────────────────────────────
export interface OrderItem {
  id: string
  order_id: string
  sub_category_id: string | null
  stock_item_id: string | null
  item_name: string
  specifications: string | null
  quantity: number | null
  unit: string | null
  unit_price_est: number | null
  needs_market_check: boolean
  propose_new_stock_item: boolean
  status: OrderItemStatus
  fulfillment_notes: string | null
  sort_order: number
  created_at: string
  updated_at: string
}
export type OrderItemInsert = Omit<OrderItem, 'id' | 'created_at' | 'updated_at'>

export interface ExpenseOrderItem {
  expense_id: string
  order_item_id: string
  quantity_covered: number | null
  notes: string | null
}

// ── Stock Items ───────────────────────────────────────────────────
export type BoothStructureType = 'fixed_part' | 'standalone'

export type StockCatalogStatus = 'pending_setup' | 'active' | 'inactive'

export interface StockItem {
  id: string
  item_code: string | null
  item_name: string
  amharic_name: string | null
  sub_category_id: string | null
  main_category: StockMainCategory | null
  item_type: StockItemType
  quality_grade: string | null
  unit: string
  warehouse_zone: WarehouseZone | null
  reorder_level: number | null
  is_tool: boolean
  active: boolean
  catalog_status: StockCatalogStatus
  notes: string | null
  structure_type: BoothStructureType | null
  source_project_id: string | null
  created_at: string
  updated_at: string
}

export interface StockOnHand {
  stock_item_id: string
  item_name: string
  warehouse_zone: WarehouseZone | null
  unit: string
  reorder_level: number | null
  active: boolean
  catalog_status: StockCatalogStatus
  qty_on_hand: number
  avg_unit_cost: number | null
}
export type StockItemInsert = Omit<StockItem, 'id' | 'item_code' | 'created_at' | 'updated_at'>

// ── Stock dispatch queue (migration 115) ────────────────────────────
export interface StockPendingDispatchRow {
  order_item_id: string
  item_name: string
  requested_qty: number | null
  proposed_qty: number | null
  unit: string | null
  stock_item_id: string
  stock_item_name: string
  warehouse_zone: WarehouseZone | null
  current_on_hand: number
  order_id: string
  order_name: string | null
  project_id: string | null
  project_name: string | null
  requested_by_user_id: string | null
}

// ── Stock Receipts ────────────────────────────────────────────────
export interface StockReceipt {
  id: string
  stock_item_id: string
  quantity: number
  unit_price: number | null
  receipt_type: StockReceiptType
  destination: 'warehouse' | 'site'
  warehouse_zone: WarehouseZone | null
  project_id: string | null
  expense_id: string | null
  order_item_id: string | null
  transport_request_id: string | null
  received_date: string
  received_by_staff_id: string | null
  notes: string | null
  created_at: string
}
export type StockReceiptInsert = Omit<StockReceipt, 'id' | 'created_at'>

// ── Stock Issues ──────────────────────────────────────────────────
export interface StockIssue {
  id: string
  stock_item_id: string
  quantity: number
  issue_type: StockIssueType
  project_id: string | null
  issued_to_staff_id: string | null
  issued_by_staff_id: string | null
  order_item_id: string | null
  issued_date: string
  notes: string | null
  created_at: string
}
export type StockIssueInsert = Omit<StockIssue, 'id' | 'created_at'>

// ── Site delivery confirmation + return to stock (148) ──────────────
export interface StockDeliveryConfirmation {
  id: string
  stock_issue_id: string
  quantity_confirmed: number
  condition_notes: string | null
  confirmed_by: string | null
  confirmed_at: string
  created_at: string
}
export type StockDeliveryConfirmationInsert = Pick<StockDeliveryConfirmation, 'stock_issue_id' | 'quantity_confirmed' | 'condition_notes'>

export interface StockDeliveryConfirmationRow {
  stock_issue_id: string
  stock_item_id: string
  stock_item_name: string
  project_id: string | null
  project_name: string | null
  quantity_dispatched: number
  issued_date: string
  transport_request_id: string | null
  confirmation_id: string | null
  quantity_confirmed: number | null
  condition_notes: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  is_confirmed: boolean
  has_discrepancy: boolean
  // Migration 160. Same vocabulary as the GRN's own per-line verdict, so
  // a vendor delivery and a site-to-site transfer read identically.
  quality_status: GrnQualityStatus | null
  stock_return_request_id: string | null
  // 'project_transfer' means it came off another site rather than out of
  // the warehouse; source_project_* names where from.
  source_kind: 'warehouse_dispatch' | 'project_transfer'
  source_project_id: string | null
  source_project_name: string | null
}

// One row per GRN with its worst line verdict — the register that lets
// "what did we receive, and was any of it rejected" be answered without
// opening each purchase order (migration 160).
export interface GrnRegisterRow {
  id: string
  grn_code: string | null
  received_at: string
  sourcing_bundle_id: string
  bundle_code: string | null
  vendor_name: string | null
  received_by: string | null
  received_by_name: string | null
  photo_url: string | null
  notes: string | null
  line_count: number
  total_quantity_received: number
  damaged_lines: number
  rejected_lines: number
  worst_quality: GrnQualityStatus
  ledgers: string | null
}

export type StockReturnRequestStatus = 'pending' | 'received' | 'rejected'
export interface StockReturnRequest {
  id: string
  stock_item_id: string
  project_id: string | null
  quantity_requested: number
  quantity_received: number | null
  status: StockReturnRequestStatus
  notes: string | null
  requested_by: string | null
  requested_at: string
  confirmed_by: string | null
  confirmed_at: string | null
  stock_receipt_id: string | null
  // NULL returns the material to the warehouse; set transfers it
  // straight to another project, with no warehouse leg (migration 159).
  destination_project_id: string | null
  created_at: string
}
export type StockReturnRequestInsert =
  Pick<StockReturnRequest, 'stock_item_id' | 'project_id' | 'quantity_requested' | 'notes'>
  & Partial<Pick<StockReturnRequest, 'destination_project_id'>>

// What a project physically still holds: issued to it, less what has
// already gone back or is awaiting confirmation (migration 159).
export interface ProjectMaterialBalance {
  project_id: string
  project_name: string | null
  stock_item_id: string
  item_name: string
  unit: string | null
  qty_issued: number
  qty_returned: number
  qty_pending: number
  qty_available_to_return: number
}

// ── Tool Units ────────────────────────────────────────────────────
export interface ToolUnit {
  id: string
  stock_item_id: string
  asset_code: string
  serial_number: string | null
  barcode: string | null
  condition: ToolCondition
  current_holder_id: string | null
  checked_out_since: string | null
  purchase_date: string | null
  expense_id: string | null
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
}
export type ToolUnitInsert = Omit<ToolUnit, 'id' | 'created_at' | 'updated_at'>

// ── Tool Checkouts ────────────────────────────────────────────────
export interface ToolCheckout {
  id: string
  tool_unit_id: string
  issued_to_staff_id: string
  issued_by_staff_id: string | null
  project_id: string | null
  issue_date: string
  expected_return_date: string | null
  actual_return_date: string | null
  condition_on_issue: string | null
  condition_on_return: string | null
  returned: boolean
  notes: string | null
  created_at: string
}
export type ToolCheckoutInsert = Omit<ToolCheckout, 'id' | 'created_at'>

// ── Departments ───────────────────────────────────────────────────
export interface Department {
  id: string
  name: string
  mandate: string | null
  head_staff_id: string | null
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}
export type DepartmentInsert = Omit<Department, 'id' | 'created_at' | 'updated_at'>

// ── Design ────────────────────────────────────────────────────────
export type DesignPackageStatus = 'brief' | 'concept' | 'detailed' | 'client_review' | 'signed_off'
export interface DesignPackage {
  id: string
  project_id: string
  title: string
  brief: string | null
  status: DesignPackageStatus
  signed_off_by: string | null
  signed_off_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
export type DesignPackageInsert = Omit<DesignPackage, 'id' | 'signed_off_by' | 'signed_off_at' | 'created_at' | 'updated_at'>

export type DesignDrawingStatus = 'draft' | 'issued' | 'approved' | 'superseded'
export interface DesignDrawing {
  id: string
  design_package_id: string
  drawing_no: string | null
  title: string
  discipline: string | null
  revision: string | null
  status: DesignDrawingStatus
  file_url: string | null
  file_name: string | null
  issued_at: string | null
  created_at: string
}
export type DesignDrawingInsert = Omit<DesignDrawing, 'id' | 'created_at'>

export interface FfeSpecification {
  id: string
  design_package_id: string
  area_room: string | null
  item_name: string
  specification: string | null
  quantity: number | null
  unit: string | null
  notes: string | null
  created_at: string
}
export type FfeSpecificationInsert = Omit<FfeSpecification, 'id' | 'created_at'>

// ── Business Development / Sales ─────────────────────────────────
export type ContractStatus = 'draft' | 'signed' | 'active' | 'completed' | 'terminated'
export interface Contract {
  id: string
  contract_no: string | null
  client_id: string
  project_id: string | null
  opportunity_id: string | null
  contract_value: number | null
  signed_date: string | null
  scope_of_work: string | null
  completion_date: string | null
  payment_terms: string | null
  wht_rate: number | null
  retention_percent: number | null
  status: ContractStatus
  document_url: string | null
  document_name: string | null
  notes: string | null
  // per_payment (default): every qualifying sale needs its own WHT
  // receipt. final_only: WHT is deducted once, on the sale flagged
  // is_final_payment, computed on the full contract_value.
  wht_deduction_mode: 'per_payment' | 'final_only'
  created_at: string
  updated_at: string
}
export type ContractInsert = Omit<Contract, 'id' | 'created_at' | 'updated_at'>

export type OpportunityStage = 'lead' | 'qualified' | 'quoted' | 'won' | 'lost'
export interface Opportunity {
  id: string
  title: string
  client_id: string | null
  prospect_name: string | null
  estimated_value: number | null
  stage: OpportunityStage
  owner_staff_id: string | null
  expected_close_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
export type OpportunityInsert = Omit<Opportunity, 'id' | 'created_at' | 'updated_at'>

// ── HR & People ───────────────────────────────────────────────────
export type LeaveType = 'annual' | 'sick' | 'unpaid' | 'maternity' | 'compassionate' | 'other'
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export interface LeaveRequest {
  id: string
  staff_id: string
  leave_type: LeaveType
  start_date: string
  end_date: string
  days: number | null
  reason: string | null
  status: LeaveStatus
  approved_by: string | null
  approved_at: string | null
  // Migration 161. Resolved at submission and stored, because who should
  // have decided is a fact about that moment — recomputing it later would
  // silently re-route history every time someone's manager changed.
  assigned_approver_id: string | null
  routing_basis: LeaveRoutingBasis | null
  created_at: string
}

// Which tier of the fallback chain answered: line manager, then primary
// department head, then HR, then admin as the terminal tier.
export type LeaveRoutingBasis = 'line_manager' | 'department_head' | 'hr_officer' | 'admin' | 'unresolved'

// Secondary (hybrid) department membership — descriptive only, grants no
// authority. staff.department_id remains the primary (migration 161).
export interface StaffDepartmentMembership {
  id: string
  staff_id: string
  department_id: string
  note: string | null
  created_at: string
}

export interface OrgStructureGaps {
  staff_without_manager: number
  staff_without_department: number
  departments_without_head: number
  staff_without_login: number
}
export type LeaveRequestInsert = Omit<LeaveRequest, 'id' | 'approved_by' | 'approved_at' | 'created_at'>

export interface PerformanceReview {
  id: string
  staff_id: string
  review_period: string | null
  reviewer_staff_id: string | null
  overall_rating: string | null
  strengths: string | null
  improvements: string | null
  summary: string | null
  review_date: string | null
  created_at: string
}
export type PerformanceReviewInsert = Omit<PerformanceReview, 'id' | 'created_at'>

export interface OnboardingTask {
  id: string
  staff_id: string
  task: string
  is_done: boolean
  done_at: string | null
  notes: string | null
  created_at: string
}
export type OnboardingTaskInsert = Omit<OnboardingTask, 'id' | 'done_at' | 'created_at'>

export type DisciplinaryCategory = 'verbal_warning' | 'written_warning' | 'suspension' | 'dismissal' | 'other'
export interface DisciplinaryRecord {
  id: string
  staff_id: string
  incident_date: string
  category: DisciplinaryCategory
  description: string | null
  action_taken: string | null
  recorded_by: string | null
  created_at: string
}
export type DisciplinaryRecordInsert = Omit<DisciplinaryRecord, 'id' | 'recorded_by' | 'created_at'>

// ── HSE ───────────────────────────────────────────────────────────
export type HseIncidentType = 'near_miss' | 'first_aid' | 'injury' | 'property_damage' | 'environmental' | 'other'
export type HseSeverity = 'low' | 'medium' | 'high' | 'critical'
export type HseIncidentStatus = 'open' | 'investigating' | 'closed'
export interface HseIncident {
  id: string
  project_id: string | null
  location_id: string | null
  incident_date: string
  incident_type: HseIncidentType
  severity: HseSeverity
  description: string | null
  immediate_action: string | null
  reported_by: string | null
  status: HseIncidentStatus
  created_at: string
  updated_at: string
}
export type HseIncidentInsert = Omit<HseIncident, 'id' | 'reported_by' | 'created_at' | 'updated_at'>

export interface HseInduction {
  id: string
  staff_id: string | null
  person_name: string | null
  project_id: string | null
  induction_date: string
  inducted_by_staff_id: string | null
  valid_until: string | null
  notes: string | null
  created_at: string
}
export type HseInductionInsert = Omit<HseInduction, 'id' | 'created_at'>

// ── Labor: Tier 1 (routine allocation, no approval) ────────────────
export type LaborAllocationStatus = 'planned' | 'active' | 'completed' | 'cancelled'
export interface LaborAllocation {
  id: string
  staff_id: string
  project_id: string
  start_date: string
  end_date: string | null
  day_rate_snapshot: number | null
  status: LaborAllocationStatus
  assigned_by: string | null
  notes: string | null
  labor_requisition_id: string | null
  created_at: string
}
export type LaborAllocationInsert = Omit<LaborAllocation, 'id' | 'day_rate_snapshot' | 'created_at'>

// ── Labor: Tier 2 (new/casual labor requisition, single approval) ──
export type LaborRequisitionStatus = 'pending' | 'approved' | 'rejected'
export type LaborRequisitionPaymentModel = 'individual' | 'gang_leader'
export type LaborRequisitionPayCycle = 'weekly' | 'engagement_end'
export type LaborRequisitionPaymentBasis = 'per_day' | 'per_volume'
export type RequisitionSlotsStatus = 'open' | 'partial' | 'filled'
export interface LaborRequisition {
  id: string
  project_id: string
  role_needed: string
  headcount: number
  is_casual_or_new: boolean
  start_date: string
  end_date: string | null
  estimated_day_rate: number | null
  estimated_days: number | null
  estimated_total_cost: number
  requested_by: string | null
  status: LaborRequisitionStatus
  approved_by: string | null
  approved_at: string | null
  notes: string | null
  payment_model: LaborRequisitionPaymentModel
  gang_leader_vendor_id: string | null
  pay_cycle: LaborRequisitionPayCycle
  specific_staff_id: string | null
  payment_basis: LaborRequisitionPaymentBasis
  volume_unit: string | null
  unit_rate: number | null
  candidate_id: string | null
  trade_tag: string | null
  proposed_trade_amharic: string | null
  proposed_trade_english: string | null
  estimated_total_volume: number | null
  slots_filled: number
  slots_status: RequisitionSlotsStatus
  work_order_id: string | null
  created_at: string
}
export type LaborRequisitionInsert = Omit<LaborRequisition, 'id' | 'estimated_total_cost' | 'status' | 'approved_by' | 'approved_at' | 'slots_filled' | 'slots_status' | 'created_at'>

// ── Subcontract ──────────────────────────────────────────────────
export type SubcontractorEngagementStatus = 'drafting' | 'agreed' | 'in_progress' | 'completed' | 'terminated'
export interface SubcontractorEngagement {
  id: string
  vendor_id: string
  project_id: string
  cost_group_id: string | null
  scope_of_work: string | null
  agreed_amount: number
  start_date: string | null
  target_completion_date: string | null
  percent_complete: number
  status: SubcontractorEngagementStatus
  approved_by: string | null
  approved_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
export type SubcontractorEngagementInsert = Omit<SubcontractorEngagement, 'id' | 'approved_by' | 'approved_at' | 'created_at' | 'updated_at'>

export interface SubcontractorCompletionCertificate {
  id: string
  engagement_id: string
  certified_amount: number
  percent_of_scope_at_cert: number | null
  certified_by: string | null
  certified_at: string
  notes: string | null
  created_at: string
}
export type SubcontractorCompletionCertificateInsert = Omit<SubcontractorCompletionCertificate, 'id' | 'certified_at' | 'created_at'>

// ── General Ledger (migrations 103-108) ────────────────────────────
export type ChartOfAccountsNature = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense'

export interface ChartOfAccounts {
  id: string
  account_code: string
  account_name: string
  nature: ChartOfAccountsNature
  category_id: string | null
  linked_account_id: string | null
  parent_account_id: string | null
  is_postable: boolean
  active: boolean
  created_at: string
}

export type JournalEntryType = 'operational' | 'opening_balance' | 'closing' | 'adjusting'

export interface JournalEntry {
  id: string
  entry_date: string
  fiscal_period_id: string | null
  entry_type: JournalEntryType
  source_table: string | null
  source_id: string | null
  description: string | null
  created_by: string | null
  created_at: string
}

export interface JournalLine {
  id: string
  journal_entry_id: string
  account_id: string
  debit: number
  credit: number
  notes: string | null
}

export interface OpeningBalance {
  id: string
  chart_of_accounts_id: string
  amount: number
  side: 'debit' | 'credit'
  source: string
  entered_by: string | null
  entered_at: string
  notes: string | null
}
export type OpeningBalanceInsert = Omit<OpeningBalance, 'id' | 'entered_by' | 'entered_at'>

export interface BankBalanceAnchor {
  id: string
  account_id: string
  as_of_date: string
  balance: number
  source: string
  transfer_id: string | null
  created_at: string
}

export interface LedgerPostingFailure {
  id: string
  source_table: string
  source_id: string
  error_message: string
  attempted_at: string
  resolved: boolean
  resolved_at: string | null
  resolved_by: string | null
}

// ── Default general ledger per engagement type (migration 154) ─────
// Auto-posting needs an expense-side account to debit, which comes from
// expenses.category_id. This is the default applied when an expense has
// none of its own — never an override of one a person chose.
export interface ExpenseTypeLedgerDefault {
  expense_type: ExpenseType
  category_id: string
  notes: string | null
  updated_at: string
}

// ── General Ledger reporting views/functions (migration 107) ──────
export interface TrialBalanceRow {
  chart_of_accounts_id: string
  account_code: string
  account_name: string
  nature: ChartOfAccountsNature
  fiscal_period_id: string | null
  fiscal_period_label: string | null
  total_debit: number
  total_credit: number
  balance: number
}

export interface PlLedgerPreviewRow {
  account_code: string
  account_name: string
  nature: ChartOfAccountsNature
  amount: number
}

export interface BalanceSheetLedgerPreviewRow {
  account_code: string
  account_name: string
  nature: ChartOfAccountsNature
  balance: number
}

export interface CashReconciliationCheckRow {
  account_id: string
  account_name: string
  anchor_date: string
  anchor_balance: number
  movement_since_anchor: number
  implied_balance_today: number
  erca_opening_amount: number | null
  erca_opening_side: 'debit' | 'credit' | null
  gap_vs_erca_figure: string
}

// ── Petty Cash ───────────────────────────────────────────────────
export interface PettyCashFloat {
  id: string
  custodian_staff_id: string
  project_id: string | null
  float_amount: number
  current_balance: number
  active: boolean
  created_at: string
}
export type PettyCashFloatInsert = Omit<PettyCashFloat, 'id' | 'created_at'>

export interface PettyCashTransaction {
  id: string
  float_id: string
  amount: number
  purpose: string
  receipt_attached: boolean
  recorded_by: string | null
  created_at: string
}
export type PettyCashTransactionInsert = Omit<PettyCashTransaction, 'id' | 'created_at'>

export type PettyCashReplenishmentStatus = 'pending' | 'approved' | 'rejected'
export interface PettyCashReplenishment {
  id: string
  float_id: string
  amount_requested: number
  requires_pm_approval: boolean
  requested_by: string | null
  status: PettyCashReplenishmentStatus
  approved_by: string | null
  approved_at: string | null
  created_at: string
}
export type PettyCashReplenishmentInsert = Omit<PettyCashReplenishment, 'id' | 'requires_pm_approval' | 'approved_by' | 'approved_at' | 'created_at'>

// ── Fleet: Maintenance & Penalties ───────────────────────────────
export type VehicleMaintenanceStatus = 'pending' | 'approved' | 'rejected' | 'completed'
export interface VehicleMaintenanceRequest {
  id: string
  vehicle_id: string
  requested_by: string | null
  issue_description: string
  estimated_cost: number | null
  status: VehicleMaintenanceStatus
  approved_by: string | null
  approved_at: string | null
  actual_cost: number | null
  completed_at: string | null
  expense_id: string | null
  created_at: string
}
export type VehicleMaintenanceRequestInsert = Omit<VehicleMaintenanceRequest, 'id' | 'approved_by' | 'approved_at' | 'expense_id' | 'created_at'>

export interface VehiclePenalty {
  id: string
  vehicle_id: string
  driver_staff_id: string | null
  penalty_date: string
  amount: number
  reason: string | null
  paid: boolean
  notes: string | null
  created_at: string
}
export type VehiclePenaltyInsert = Omit<VehiclePenalty, 'id' | 'created_at'>

// ── Org chart: safe-columns-only staff directory (v_staff_directory) ──
export interface StaffDirectoryRow {
  id: string
  employee_name: string
  role: string | null
  staff_type: string | null
  department_id: string | null
  sub_team: string | null
  phone_number: string | null
  photo_url: string | null
  reports_to_id: string | null
  status: StaffStatus
}

// ── Work orders ───────────────────────────────────────────────────
export type WorkOrderType = 'workshop' | 'site'
export type WorkOrderStatus = 'requested' | 'in_progress' | 'completed' | 'cancelled'
export interface WorkOrder {
  id: string
  project_id: string
  work_type: WorkOrderType
  scope_of_work: string
  requested_by: string | null
  assigned_lead_staff_id: string | null
  status: WorkOrderStatus
  target_completion_date: string | null
  property_id: string | null
  current_progress_pct: number
  created_at: string
  updated_at: string
}
export type WorkOrderInsert = Omit<WorkOrder, 'id' | 'created_at' | 'updated_at' | 'current_progress_pct'>

export interface WorkOrderLabor {
  id: string
  work_order_id: string
  labor_allocation_id: string
  created_at: string
}

// ── Work order crew (assignment layer, additive alongside work_order_labor) ──
export interface WorkOrderCrew {
  id: string
  work_order_id: string
  staff_id: string
  role_on_wo: string | null
  assigned_by_staff_id: string | null
  assigned_at: string
  removed_at: string | null
  removed_by_staff_id: string | null
}
export type WorkOrderCrewInsert = Omit<WorkOrderCrew, 'id' | 'assigned_at' | 'removed_at' | 'removed_by_staff_id'>

// ── WO-owned daily attendance (Tier 1 + Tier 2 site staff) ──────────
export interface WoAttendanceLog {
  id: string
  work_order_id: string | null
  project_id: string
  staff_id: string
  log_date: string
  hours_logged: number | null
  volume_completed: number | null
  gang_size: number | null
  gang_member_staff_ids: string[] | null
  overtime_hours: number | null
  overtime_amount: number | null
  labor_requisition_id: string | null
  is_unallocated: boolean
  notes: string | null
  logged_by_staff_id: string
  synced_timesheet_id: string | null
  created_at: string
  updated_at: string
}
export type WoAttendanceLogInsert = Omit<WoAttendanceLog, 'id' | 'project_id' | 'synced_timesheet_id' | 'created_at' | 'updated_at'> & { project_id?: string }

// ── Direct-to-site material receipts (never touches stock_items) ────
export interface SiteMaterialReceipt {
  id: string
  project_id: string
  work_order_id: string | null
  purchase_order_id: string | null
  item_description: string
  stock_item_id: string | null
  quantity: number
  unit: string
  received_by_staff_id: string
  received_at: string
  vendor_id: string | null
  photo_evidence: string[] | null
  notes: string | null
  created_at: string
}
export type SiteMaterialReceiptInsert = Omit<SiteMaterialReceipt, 'id' | 'received_at' | 'created_at'>

// ── WO progress updates ──────────────────────────────────────────────
export interface WoProgressUpdate {
  id: string
  work_order_id: string
  progress_pct: number
  note: string | null
  photos: string[] | null
  updated_by_staff_id: string
  created_at: string
}
export type WoProgressUpdateInsert = Omit<WoProgressUpdate, 'id' | 'created_at'>

// ── Candidates (Competency Hub external assessments + Tier 2 HR queue) ──
export type CandidateOutcome = 'pending' | 'hired' | 'rejected' | 'withdrawn'
export type CandidateType = 'salaried_or_subcontractor' | 'tier_2_casual'
export interface Candidate {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  assessed_for_role_id: string | null
  outcome: CandidateOutcome
  outcome_notes: string | null
  assessed_by_dept_head_staff_id: string | null
  created_by: string | null
  candidate_type: CandidateType
  trade_tag: string | null
  labor_requisition_id: string | null
  hr_approved_by_staff_id: string | null
  hr_approved_at: string | null
  provisioned_staff_id: string | null
  created_at: string
  updated_at: string
}
export type CandidateInsert = Omit<Candidate, 'id' | 'outcome' | 'hr_approved_by_staff_id' | 'hr_approved_at' | 'provisioned_staff_id' | 'created_at' | 'updated_at'>


export interface WorkOrderMaterial {
  id: string
  work_order_id: string
  stock_issue_id: string
  created_at: string
}

export interface WorkOrderCostRow {
  work_order_id: string
  labor_cost: number
  labor_cost_estimated: number
  materials_cost: number
  total_cost: number
  total_cost_estimated: number
}

// ── FF&E job descriptions & computed skill levels ──────────────────
// Named FfeJobDescription for continuity, but the table is now
// job_descriptions and covers every department (migration 162) — the
// five FF&E fabrication roles are simply Operations/Construction rows.
export interface FfeJobDescription {
  id: string
  role_name: string
  role_overview: string | null
  // Which department this role belongs to. Null only for a role created
  // before the framework was generalized.
  department_id: string | null
  sort_order: number
  // Drafts are seeded inactive: visible for a department head to review
  // and confirm, not usable for assessment until activated.
  active: boolean
  created_at: string
  updated_at: string
}
export type FfeJobDescriptionInsert = Omit<FfeJobDescription, 'id' | 'created_at' | 'updated_at'>

export type FfeResponsibilityTier = 'foundational' | 'differentiator'
export interface FfeKeyResponsibility {
  id: string
  job_description_id: string
  responsibility_title: string
  responsibility_detail: string | null
  tier: FfeResponsibilityTier
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}
export type FfeKeyResponsibilityInsert = Omit<FfeKeyResponsibility, 'id' | 'created_at' | 'updated_at'>

export interface StaffFfeChecklistRow {
  id: string
  staff_id: string
  responsibility_id: string
  is_checked: boolean
  checked_by: string | null
  checked_at: string | null
}

export type FfeSkillLevel = 'Beginner' | 'Intermediate' | 'Advanced'
export interface StaffFfeSkillLevelRow {
  staff_id: string
  job_description_id: string
  role_name: string
  foundational_checked: number
  foundational_total: number
  differentiator_checked: number
  differentiator_total: number
  skill_level: FfeSkillLevel
}

// ── FF&E 0-5 scored rating history (140) ───────────────────────────
export interface StaffFfeSkillRating {
  id: string
  staff_id: string
  responsibility_id: string
  score: number
  rated_by: string | null
  rated_at: string
  notes: string | null
}
export type StaffFfeSkillRatingInsert = Omit<StaffFfeSkillRating, 'id' | 'rated_at'>

export interface StaffFfeCurrentScoreRow {
  staff_id: string
  responsibility_id: string
  score: number
  rated_at: string
  rated_by: string | null
}

export interface StaffFfeRoleSummaryRow {
  staff_id: string
  job_description_id: string
  role_name: string
  avg_score: number
  rated_responsibility_count: number
  total_active_responsibilities: number
}

// ── Site Foreman: petty cash float requests + daily reports ──────
export type SitePettyCashRequestStatus =
  | 'pending_finance' | 'pending_pm' | 'approved' | 'rejected' | 'opened'

export interface SitePettyCashFloatRequest {
  id: string
  project_id: string
  requested_by_staff_id: string
  requested_amount: number
  purpose: string | null
  status: SitePettyCashRequestStatus
  finance_reviewed_by: string | null
  finance_reviewed_at: string | null
  pm_reviewed_by: string | null
  pm_reviewed_at: string | null
  rejection_reason: string | null
  resulting_float_id: string | null
  created_at: string
  updated_at: string
}

export interface SitePettyCashRequestContext {
  request_id: string
  project_id: string
  requested_amount: number
  status: SitePettyCashRequestStatus
  requested_by_staff_id: string
  purpose: string | null
  created_at: string
  project_name: string
  requested_by_name: string | null
  total_budget: number | null
  total_actual_with_labor: number | null
  total_committed_with_labor: number | null
  budget_headroom: number | null
  any_group_over_budget: boolean | null
}

export type SiteReportWeather = 'sunny' | 'cloudy' | 'rain' | 'heavy_rain'
export type SiteAccessible = 'yes' | 'partial' | 'no'

export interface SiteDailyReport {
  id: string
  project_id: string
  foreman_staff_id: string
  report_date: string
  progress_percent_after: number | null
  weather: SiteReportWeather | null
  site_accessible: SiteAccessible | null
  progress_notes: string | null
  photos: { url: string; name?: string }[]
  headcount_override: number | null
  materials_notes: string | null
  hse_near_miss_notes: string | null
  tomorrow_plan: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
}

// ── Fixed Asset Register ─────────────────────────────────────────
// Everything owned that isn't a vehicle (`vehicles`) or a tool
// (`tool_units`) — those keep their own specialized lifecycle tables.
export type FixedAssetCategory = 'it_equipment' | 'office_furniture' | 'site_equipment' | 'workshop_machinery' | 'vehicle'
export type DepreciationMethod = 'straight_line' | 'declining_balance' | 'units_of_production' | 'sum_of_years'
export type FixedAssetCondition = 'new' | 'good' | 'fair' | 'poor' | 'under_repair' | 'retired'
export type FixedAssetDisposalMethod = 'sold' | 'scrapped' | 'donated' | 'lost'

export interface FixedAssetAttachment {
  url: string
  name: string
}

export interface FixedAsset {
  id: string
  asset_code: string
  asset_name: string
  category: FixedAssetCategory
  serial_number: string | null
  manufacturer: string | null
  model: string | null
  purchase_date: string
  purchase_cost_etb: number
  purchase_expense_id: string | null
  purchase_vendor_id: string | null
  useful_life_years: number
  depreciation_method: DepreciationMethod
  declining_balance_rate: number | null
  total_expected_units: number | null
  salvage_value_etb: number
  depreciation_start_date: string
  location_id: string | null
  custodian_staff_id: string | null
  condition: FixedAssetCondition
  last_verified_at: string | null
  last_verified_by_staff_id: string | null
  disposal_date: string | null
  disposal_method: FixedAssetDisposalMethod | null
  disposal_value_etb: number | null
  disposal_notes: string | null
  notes: string | null
  attachments: FixedAssetAttachment[]
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}
export type FixedAssetInsert = Omit<FixedAsset,
  'id' | 'asset_code' | 'last_verified_at' | 'last_verified_by_staff_id' | 'created_by' | 'created_at' | 'updated_at'>

export interface FixedAssetCurrent extends FixedAsset {
  years_elapsed: number
  accumulated_depreciation: number
  current_book_value: number
  remaining_useful_life_years: number
  annual_depreciation_this_year: number
  monthly_depreciation: number
}

export interface FixedAssetUsageLog {
  id: string
  fixed_asset_id: string
  period_start_date: string
  period_end_date: string
  units_produced: number
  logged_by_staff_id: string | null
  notes: string | null
  created_at: string
}
export type FixedAssetUsageLogInsert = Omit<FixedAssetUsageLog, 'id' | 'created_at'>

export type FixedAssetMovementType = 'custodian_change' | 'location_change' | 'condition_change' | 'note'

export interface FixedAssetMovement {
  id: string
  fixed_asset_id: string
  movement_type: FixedAssetMovementType
  from_custodian_staff_id: string | null
  to_custodian_staff_id: string | null
  from_location_id: string | null
  to_location_id: string | null
  from_condition: string | null
  to_condition: string | null
  note: string | null
  moved_by_staff_id: string | null
  moved_at: string
}

export interface DepreciationScheduleRow {
  year_number: number
  year_end_date: string
  yearly_depreciation: number
  cumulative_depreciation: number
  book_value: number
}

export interface FixedAssetRegisterSummaryByCategory {
  category: FixedAssetCategory
  assets_count: number
  original_cost: number
  accumulated_depreciation: number
  current_book_value: number
}

export interface FixedAssetRegisterSummary {
  total_assets_count: number
  total_original_cost: number
  total_accumulated_depreciation: number
  total_current_book_value: number
  by_category: FixedAssetRegisterSummaryByCategory[]
  assets_due_for_verification: number
  assets_disposed_this_fy_count: number
  assets_disposed_this_fy_value: number
}

export type AssetBaseSource = 'fixed' | 'vehicle' | 'tool'

export interface AssetBaseUnifiedRow {
  asset_source: AssetBaseSource
  id: string
  name: string
  category: string
  original_cost: number | null
  current_book_value: number | null
  condition: string | null
  custodian: string | null
  location: string | null
  is_active: boolean
}

// ── Schedule (PR 9b) ─────────────────────────────────────────────
export type ScheduleStatus = 'draft' | 'approved' | 'completed'
export interface Schedule {
  id: string
  project_id: string
  boq_id: string | null
  title: string
  status: ScheduleStatus
  non_working_weekdays: number[]
  owner_pm_staff_id: string
  baseline_locked_at: string | null
  baseline_locked_by_staff_id: string | null
  created_by_staff_id: string | null
  created_at: string
  updated_at: string
}

export type ScheduleTaskStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked' | 'on_hold'
export interface ScheduleTask {
  id: string
  schedule_id: string
  parent_task_id: string | null
  predecessor_task_id: string | null
  lag_days: number
  display_order: number
  title: string
  notes: string | null
  planned_start_date: string | null
  planned_end_date: string | null
  planned_duration_days: number | null
  current_start_date: string
  current_end_date: string
  current_duration_days: number
  actual_start_date: string | null
  actual_end_date: string | null
  status: ScheduleTaskStatus
  auto_cascade: boolean
  progress_pct: number
  progress_source: 'manual' | 'derived'
  created_by_staff_id: string | null
  created_at: string
  updated_at: string
}
export type ScheduleTaskInsert = Omit<ScheduleTask,
  'id' | 'planned_start_date' | 'planned_end_date' | 'planned_duration_days' | 'current_end_date'
  | 'actual_start_date' | 'actual_end_date' | 'created_at' | 'updated_at' | 'progress_pct' | 'progress_source'
> & { current_end_date?: string }

// v_boq_item_physical_progress (PR 9c)
export interface BoqItemPhysicalProgress {
  item_id: string
  boq_id: string
  project_id: string
  name: string
  node_type: string
  total_etb: number
  progress_pct: number | null
  linked_task_count: number
}

// v_project_physical_progress (PR 9c)
export interface ProjectPhysicalProgress {
  project_id: string
  boq_id: string
  physical_progress_pct: number | null
}

export interface ScheduleTaskBoqItem {
  id: string
  schedule_task_id: string
  boq_item_id: string
  created_at: string
}

// PR 9a.5: BOQ frontend types, against the live boqs/boq_items schema
// (PR 9a shipped these tables in migrations 209-215 but never a frontend).
export type BoqStatus = 'draft' | 'internal_review' | 'approved' | 'superseded'
export type BoqNodeType = 'section' | 'line_item' | 'lump_sum'

export interface Boq {
  id: string
  project_id: string
  version_number: number
  parent_boq_id: string | null
  title: string
  status: BoqStatus
  source_proforma_id: string | null
  owner_pm_staff_id: string
  total_direct_etb: number
  total_lump_sum_etb: number
  grand_total_etb: number
  notes: string | null
  approved_at: string | null
  approved_by_staff_id: string | null
  created_by_staff_id: string | null
  created_at: string
  updated_at: string
}

export interface BoqItem {
  id: string
  boq_id: string
  parent_item_id: string | null
  display_order: number
  node_type: BoqNodeType
  name: string
  notes: string | null
  unit: string | null
  quantity: number | null
  unit_rate_etb: number | null
  total_etb: number | null
  is_priced_elsewhere: boolean
  absorbed_by_item_id: string | null
  source_item_id: string | null
  created_at: string
  updated_at: string
}

// PR 9a.5 group 2: change orders. All RPCs (submit/pm_approve/
// finance_approve/exec_approve/record_client_signoff/reject/finalize)
// already existed live from PR 9a -- only the frontend was missing.
export type BoqChangeOrderStatus =
  | 'pending_pm' | 'pending_finance' | 'pending_exec' | 'pending_client_signoff' | 'approved' | 'rejected'
export type BoqApprovalLevel = 'pm_only' | 'pm_finance' | 'pm_finance_exec'
export type BoqCoItemAction = 'add' | 'modify' | 'remove'

export interface BoqChangeOrder {
  id: string
  boq_id: string
  resulting_boq_id: string | null
  title: string
  description: string | null
  requested_by_client: boolean
  cost_delta_etb: number
  approval_level_required: BoqApprovalLevel
  status: BoqChangeOrderStatus
  pm_reviewed_by: string | null
  pm_reviewed_at: string | null
  finance_reviewed_by: string | null
  finance_reviewed_at: string | null
  exec_reviewed_by: string | null
  exec_reviewed_at: string | null
  client_signoff_at: string | null
  client_signoff_evidence: string | null
  rejection_reason: string | null
  created_by_staff_id: string | null
  created_at: string
  updated_at: string
}

export interface BoqChangeOrderItem {
  id: string
  change_order_id: string
  action: BoqCoItemAction
  existing_item_id: string | null
  parent_item_id: string | null
  new_name: string | null
  new_unit: string | null
  new_quantity: number | null
  new_unit_rate_etb: number | null
  new_notes: string | null
  new_node_type: BoqNodeType | null
  new_display_order: number | null
  new_is_priced_elsewhere: boolean | null
  created_at: string
}

// v_boq_items_flat / v_boq_procurement_spec (PR 9a, group 3 frontend)
export interface BoqFlatRow {
  item_id: string
  boq_id: string
  project_id: string
  version_number: number
  boq_title: string
  room: string | null
  category: string | null
  sub_category: string | null
  name: string
  notes: string | null
  node_type: BoqNodeType
  unit: string | null
  quantity: number | null
  unit_rate_etb: number | null
  total_etb: number
  is_priced_elsewhere: boolean
  absorbed_by_item_id: string | null
}

export interface BoqProcurementSpecRow extends BoqFlatRow {
  absorbed_by_name: string | null
}

// v_boq_tree(p_boq_id) RPC row shape
export interface BoqTreeRow {
  id: string
  boq_id: string
  parent_item_id: string | null
  display_order: number
  node_type: BoqNodeType
  name: string
  notes: string | null
  unit: string | null
  quantity: number | null
  unit_rate_etb: number | null
  total_etb: number
  is_priced_elsewhere: boolean
  absorbed_by_item_id: string | null
  source_item_id: string | null
  depth: number
  path: string
  sort_path: number[]
  weight_pct: number
}

export interface CalendarHoliday {
  id: string
  holiday_date: string
  name: string
  applies_to_project_id: string | null
  created_by_staff_id: string | null
  created_at: string
}

export interface ScheduleBaselineReset {
  id: string
  schedule_id: string
  reason: string
  reset_by_staff_id: string | null
  reset_at: string
}

// v_schedule_task_health
export interface ScheduleTaskHealth {
  task_id: string
  schedule_id: string
  title: string
  status: ScheduleTaskStatus
  current_start_date: string
  current_end_date: string
  planned_start_date: string | null
  planned_end_date: string | null
  days_slipped: number | null
  is_overdue: boolean
  is_on_critical_path: boolean
}

// v_project_schedule_summary
export interface ProjectScheduleSummary {
  project_id: string
  schedule_id: string
  schedule_status: ScheduleStatus
  baseline_locked_at: string | null
  total_tasks: number
  tasks_completed: number
  tasks_overdue: number
  avg_days_slipped_incomplete: number | null
}

// v_schedule_tasks_with_stale_boq_links
export interface StaleScheduleBoqLink {
  schedule_id: string
  project_id: string
  schedule_boq_id: string
  current_approved_boq_id: string | null
  task_id: string
  task_title: string
  stale_boq_item_id: string
  stale_boq_item_name: string | null
}

// v_schedule_gantt_data(p_schedule_id)
export interface ScheduleGanttRow {
  id: string
  title: string
  parent_task_id: string | null
  depth: number
  current_start_date: string
  current_end_date: string
  planned_start_date: string | null
  planned_end_date: string | null
  status: ScheduleTaskStatus
  predecessor_task_id: string | null
  days_slipped: number | null
}
