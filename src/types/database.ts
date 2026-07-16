export type UserRole = 'admin' | 'manager' | 'finance' | 'staff' | 'procurement_officer' | 'hr_officer' | 'project_manager' | 'stock_manager' | 'logistics_officer'
export type OrderItemStatus = 'pending' | 'sourced' | 'partially_sourced' | 'unfulfilled' | 'cancelled'
export type StockItemType = 'raw_material' | 'tool' | 'consumable'
export type StockMainCategory = 'wood_work' | 'electrical' | 'painting' | 'hardware' | 'construction' | 'tools' | 'booth_return'
export type WarehouseZone = 'Zone A' | 'Zone B' | 'Zone C'
export type ToolCondition = 'good' | 'fair' | 'damaged' | 'retired'
export type StockReceiptType = 'purchase' | 'opening_balance' | 'site_return' | 'adjustment'
export type StockIssueType = 'project_use' | 'tool_checkout' | 'damaged' | 'vendor_return' | 'adjustment'
export type StaffType = 'Full Time' | 'Part Time' | 'Contract' | 'Freelance'
export type PaymentStatus = 'pending' | 'processing' | 'paid'
export type OrderStatus = 'pending' | 'approved' | 'rejected' | 'completed'
export type ExpenseApprovalStatus = 'pending' | 'manager_approved' | 'finance_approved' | 'rejected'
export type ExpenseType = 'general' | 'purchase_order' | 'vrf' | 'cpo_bond' | 'fuel'
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
  department: string | null   // null = company-wide
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
  created_at: string
  updated_at: string
}
export type ExpenseInsert = Omit<Expense, 'id' | 'expense_code' | 'created_at' | 'updated_at' | 'manager_approved_by' | 'manager_approved_at' | 'finance_approved_by' | 'finance_approved_at' | 'requires_finance_approval'>

// ── Orders ───────────────────────────────────────────────────────
export type OrderPriority = 'normal' | 'urgent' | 'critical'

export interface Order {
  id: string
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
  created_at: string
  updated_at: string
}
export type TransportationRequestInsert = Omit<TransportationRequest, 'id' | 'created_at' | 'updated_at'>

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
  active: boolean
  created_at: string
  updated_at: string
}
export type VehicleInsert = Omit<Vehicle, 'id' | 'created_at' | 'updated_at'>

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
  sales_description: string
  sales_status: SaleLifecycleStatus | null
  date: string | null
  amount: number | null
  product_or_service: string | null
  payment_method: string | null
  notes: string | null
  client_id: string | null
  project_id: string | null
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
  created_at: string
  updated_at: string
}
export type SaleInsert = Omit<Sale, 'id' | 'created_at' | 'updated_at' | 'manager_approved_by' | 'manager_approved_at' | 'finance_approved_by' | 'finance_approved_at'>

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
  uploaded_by: string | null
  created_at: string
}

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
  payroll_record: string | null
  pay_period: string | null
  start_date: string | null
  end_date: string | null
  payroll_type: string | null
  payment_status: 'pending' | 'processing' | 'paid'
  payment_method: string | null
  notes: string | null
  account_id: string | null
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

// ── Sourcing Bundles ─────────────────────────────────────────────
export type SourcingBundleStatus = 'drafting' | 'submitted' | 'approved' | 'ordered' | 'fulfilled' | 'cancelled'

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
  created_at: string
  updated_at: string
}
export type SourcingBundleInsert = Omit<SourcingBundle, 'id' | 'bundle_code' | 'created_at' | 'updated_at'>

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

export interface GoodsReceivedNoteItem {
  id: string
  grn_id: string
  sourcing_bundle_item_id: string
  quantity_received: number | null
  condition_notes: string | null
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
  created_at: string
  updated_at: string
}
export type BatchPaymentInsert = Omit<BatchPayment, 'id' | 'created_at' | 'updated_at'>

// ── Timesheet ─────────────────────────────────────────────────────
export interface Timesheet {
  id: string
  code: string | null
  date: string | null
  check_in_time: string | null
  check_out_time: string | null
  notes: string | null
  staff_id: string | null
  project_id: string | null
  payroll_id: string | null
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
  notes: string | null
  structure_type: BoothStructureType | null
  source_project_id: string | null
  created_at: string
  updated_at: string
}
export type StockItemInsert = Omit<StockItem, 'id' | 'item_code' | 'created_at' | 'updated_at'>

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
