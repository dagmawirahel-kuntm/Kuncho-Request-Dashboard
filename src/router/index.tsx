import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { LandingRedirect } from './LandingRedirect'
import { AppShell } from '@/components/layout/AppShell'
import LoginPage from '@/pages/auth/LoginPage'
import SignupPage from '@/pages/auth/SignupPage'
import UpdatePasswordPage from '@/pages/auth/UpdatePasswordPage'
import DashboardPage from '@/pages/dashboard/DashboardPage'
import MyRequestsDashboardPage from '@/pages/dashboard/MyRequestsDashboardPage'
import RequestsDashboardPage from '@/pages/dashboard/RequestsDashboardPage'
import ProcurementDashboardPage from '@/pages/dashboard/ProcurementDashboardPage'
import FinanceDashboardPage from '@/pages/dashboard/FinanceDashboardPage'
import PaymentsDashboardPage from '@/pages/dashboard/PaymentsDashboardPage'
import GeneralLedgerPage from '@/pages/dashboard/GeneralLedgerPage'
import HRDashboardPage from '@/pages/dashboard/HRDashboardPage'
import ManagementDashboardPage from '@/pages/dashboard/ManagementDashboardPage'
import ExpensesPage from '@/pages/expenses/ExpensesPage'
import ExpenseFormPage from '@/pages/expenses/ExpenseFormPage'
import ExpenseDetailPage from '@/pages/expenses/ExpenseDetailPage'
import FuelRequestFormPage from '@/pages/expenses/FuelRequestFormPage'
import OrdersPage from '@/pages/orders/OrdersPage'
import OrderFormPage from '@/pages/orders/OrderFormPage'
import OrderDetailPage from '@/pages/orders/OrderDetailPage'
import StockItemsPage from '@/pages/stock/StockItemsPage'
import StockItemFormPage from '@/pages/stock/StockItemFormPage'
import StockItemDetailPage from '@/pages/stock/StockItemDetailPage'
import StockMovementPage from '@/pages/stock/StockMovementPage'
import StockToolsPage from '@/pages/stock/StockToolsPage'
import TransportationPage from '@/pages/transportation/TransportationPage'
import TransportFormPage from '@/pages/transportation/TransportFormPage'
import TransportPaymentFormPage from '@/pages/transportation/TransportPaymentFormPage'
import StaffPage from '@/pages/staff/StaffPage'
import StaffDetailPage from '@/pages/staff/StaffDetailPage'
import StaffFormPage from '@/pages/staff/StaffFormPage'
import PayrollPage from '@/pages/payroll/PayrollPage'
import PayrollFormPage from '@/pages/payroll/PayrollFormPage'
import VendorsPage from '@/pages/vendors/VendorsPage'
import VendorFormPage from '@/pages/vendors/VendorFormPage'
import VendorDetailPage from '@/pages/vendors/VendorDetailPage'
import VendorContractPage from '@/pages/vendors/VendorContractPage'
import ProjectsPage from '@/pages/projects/ProjectsPage'
import ProjectFormPage from '@/pages/projects/ProjectFormPage'
import ProjectWorkspacePage from '@/pages/projects/ProjectWorkspacePage'
import AccountsPage from '@/pages/accounts/AccountsPage'
import AccountFormPage from '@/pages/accounts/AccountFormPage'
import AccountDetailPage from '@/pages/accounts/AccountDetailPage'
import TransfersPage from '@/pages/transfers/TransfersPage'
import TransferFormPage from '@/pages/transfers/TransferFormPage'
import PLReportPage from '@/pages/reports/PLReportPage'
import BalanceSheetPage from '@/pages/reports/BalanceSheetPage'
import HistoricalArchivePage from '@/pages/reports/HistoricalArchivePage'
import SalesPage from '@/pages/sales/SalesPage'
import SaleFormPage from '@/pages/sales/SaleFormPage'
import SaleDetailPage from '@/pages/sales/SaleDetailPage'
import ProformasPage from '@/pages/sales/ProformasPage'
import ClientsPage from '@/pages/clients/ClientsPage'
import ClientDetailPage from '@/pages/clients/ClientDetailPage'
import ClientFormPage from '@/pages/clients/ClientFormPage'
import ProformaInvoicePage from '@/pages/clients/ProformaInvoicePage'
import PaymentRequestPage from '@/pages/clients/PaymentRequestPage'
import InvoicesPage from '@/pages/invoices/InvoicesPage'
import GeneralLedgerDashboardPage from '@/pages/general-ledger/GeneralLedgerDashboardPage'
import GeneralLedgerFormPage from '@/pages/general-ledger/GeneralLedgerFormPage'
import SubLedgerFormPage from '@/pages/general-ledger/SubLedgerFormPage'
import PurchaseAllocationPage from '@/pages/purchase-allocation/PurchaseAllocationPage'
import AllocationFormPage from '@/pages/purchase-allocation/AllocationFormPage'
import TimesheetPage from '@/pages/timesheet/TimesheetPage'
import TimesheetFormPage from '@/pages/timesheet/TimesheetFormPage'
import CashAdvancesPage from '@/pages/cash-advances/CashAdvancesPage'
import CashAdvanceFormPage from '@/pages/cash-advances/CashAdvanceFormPage'
import TaxSummaryPage from '@/pages/tax-summary/TaxSummaryPage'
import TaxSummaryFormPage from '@/pages/tax-summary/TaxSummaryFormPage'
import BatchPaymentsPage from '@/pages/batch-payments/BatchPaymentsPage'
import BatchPaymentFormPage from '@/pages/batch-payments/BatchPaymentFormPage'
import CpoBondsPage from '@/pages/cpo-bonds/CpoBondsPage'
import CpoBondFormPage from '@/pages/cpo-bonds/CpoBondFormPage'
import ProductsPage from '@/pages/products/ProductsPage'
import ProductFormPage from '@/pages/products/ProductFormPage'
import PayrollTaxesPage from '@/pages/payroll-taxes/PayrollTaxesPage'
import PayrollTaxFormPage from '@/pages/payroll-taxes/PayrollTaxFormPage'
import EmergencyPayrollPage from '@/pages/emergency-payroll/EmergencyPayrollPage'
import EmergencyPayrollFormPage from '@/pages/emergency-payroll/EmergencyPayrollFormPage'
import VendorReceiptsPage from '@/pages/vendor-receipts/VendorReceiptsPage'
import VendorReceiptFormPage from '@/pages/vendor-receipts/VendorReceiptFormPage'
import VendorReceiptDetailPage from '@/pages/vendor-receipts/VendorReceiptDetailPage'
import LocationsPage from '@/pages/locations/LocationsPage'
import LocationFormPage from '@/pages/locations/LocationFormPage'
import OverviewDashboardPage from '@/pages/dashboard/OverviewDashboardPage'
import UsersPage from '@/pages/users/UsersPage'
import CalendarPage from '@/pages/calendar/CalendarPage'
import FleetPage from '@/pages/logistics/FleetPage'
import VehicleDetailPage from '@/pages/logistics/VehicleDetailPage'
import LocationsMapPage from '@/pages/locations/LocationsMapPage'
import SourcingBundlesPage from '@/pages/sourcing/SourcingBundlesPage'
import SourcingBundleFormPage from '@/pages/sourcing/SourcingBundleFormPage'
import PurchaseOrderPage from '@/pages/sourcing/PurchaseOrderPage'
import GoodsReceivedNoteFormPage from '@/pages/sourcing/GoodsReceivedNoteFormPage'
import DepartmentsPage from '@/pages/departments/DepartmentsPage'
import DepartmentOrgChartPage from '@/pages/departments/DepartmentOrgChartPage'
import DesignPackagesPage from '@/pages/design/DesignPackagesPage'
import DesignPackageFormPage from '@/pages/design/DesignPackageFormPage'
import DesignPackageDetailPage from '@/pages/design/DesignPackageDetailPage'
import ContractsPage from '@/pages/bd/ContractsPage'
import ContractFormPage from '@/pages/bd/ContractFormPage'
import OpportunitiesPage from '@/pages/bd/OpportunitiesPage'
import OpportunityFormPage from '@/pages/bd/OpportunityFormPage'
import LeaveRequestsPage from '@/pages/leave-requests/LeaveRequestsPage'
import LeaveRequestFormPage from '@/pages/leave-requests/LeaveRequestFormPage'
import MyLeavePage from '@/pages/leave-requests/MyLeavePage'
import PerformanceReviewsPage from '@/pages/performance-reviews/PerformanceReviewsPage'
import PerformanceReviewFormPage from '@/pages/performance-reviews/PerformanceReviewFormPage'
import OnboardingTasksPage from '@/pages/onboarding-tasks/OnboardingTasksPage'
import OnboardingTaskFormPage from '@/pages/onboarding-tasks/OnboardingTaskFormPage'
import DisciplinaryRecordsPage from '@/pages/disciplinary-records/DisciplinaryRecordsPage'
import DisciplinaryRecordFormPage from '@/pages/disciplinary-records/DisciplinaryRecordFormPage'
import HseIncidentsPage from '@/pages/hse-incidents/HseIncidentsPage'
import HseIncidentFormPage from '@/pages/hse-incidents/HseIncidentFormPage'
import HseInductionsPage from '@/pages/hse-inductions/HseInductionsPage'
import HseInductionFormPage from '@/pages/hse-inductions/HseInductionFormPage'
import LaborRequisitionsPage from '@/pages/labor-requisitions/LaborRequisitionsPage'
import PettyCashPage from '@/pages/petty-cash/PettyCashPage'
import PettyCashFloatFormPage from '@/pages/petty-cash/PettyCashFloatFormPage'
import PettyCashDetailPage from '@/pages/petty-cash/PettyCashDetailPage'
import VehicleMaintenancePage from '@/pages/fleet/VehicleMaintenancePage'
import VehicleMaintenanceFormPage from '@/pages/fleet/VehicleMaintenanceFormPage'
import VehiclePenaltiesPage from '@/pages/fleet/VehiclePenaltiesPage'
import VehiclePenaltyFormPage from '@/pages/fleet/VehiclePenaltyFormPage'
import LaborRequisitionFormPage from '@/pages/labor-requisitions/LaborRequisitionFormPage'
import SubcontractsPage from '@/pages/subcontracts/SubcontractsPage'
import SubcontractFormPage from '@/pages/subcontracts/SubcontractFormPage'
import SubcontractDetailPage from '@/pages/subcontracts/SubcontractDetailPage'
import StockPendingSetupPage from '@/pages/stock/StockPendingSetupPage'
import StockDispatchQueuePage from '@/pages/stock/StockDispatchQueuePage'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/update-password', element: <UpdatePasswordPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <LandingRedirect /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'my-home', element: <MyRequestsDashboardPage /> },
          { path: 'my-leave', element: <MyLeavePage /> },
          { path: 'calendar', element: <CalendarPage /> },
          { path: 'overview', element: <OverviewDashboardPage /> },
          { path: 'requests', element: <RequestsDashboardPage /> },
          { path: 'expenses', element: <ExpensesPage /> },
          { path: 'expenses/new', element: <ExpenseFormPage /> },
          { path: 'expenses/fuel/new', element: <FuelRequestFormPage /> },
          { path: 'expenses/:id', element: <ExpenseDetailPage /> },
          { path: 'expenses/:id/edit', element: <ExpenseFormPage /> },
          { path: 'orders', element: <Navigate to="/purchase-requests" replace /> },
          { path: 'orders/new', element: <Navigate to="/purchase-requests/new" replace /> },
          { path: 'orders/:id/edit', element: <Navigate to="/purchase-requests" replace /> },
          { path: 'purchase-requests', element: <OrdersPage /> },
          { path: 'purchase-requests/:id', element: <OrderDetailPage /> },
          {
            // Procurement officers may view requests but cannot create or edit them
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance', 'staff', 'project_manager', 'hr_officer']} />,
            children: [
              { path: 'purchase-requests/new', element: <OrderFormPage /> },
              { path: 'purchase-requests/:id/edit', element: <OrderFormPage /> },
            ],
          },
          { path: 'staff/:id', element: <StaffDetailPage /> },
          {
            // Match RLS: only these roles can write stock tables
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'stock_manager', 'procurement_officer']} />,
            children: [
              { path: 'stock', element: <StockItemsPage /> },
              { path: 'stock/new', element: <StockItemFormPage /> },
              { path: 'stock/pending-setup', element: <StockPendingSetupPage /> },
              { path: 'stock/dispatch-queue', element: <StockDispatchQueuePage /> },
              { path: 'stock/tools', element: <StockToolsPage /> },
              { path: 'stock/movement/new', element: <StockMovementPage /> },
              { path: 'stock/:id', element: <StockItemDetailPage /> },
              { path: 'stock/:id/edit', element: <StockItemFormPage /> },
            ],
          },
          { path: 'transportation', element: <TransportationPage /> },
          { path: 'transportation/new', element: <TransportFormPage /> },
          { path: 'transportation/:id/edit', element: <TransportFormPage /> },
          { path: 'transportation/:id/pay', element: <TransportPaymentFormPage /> },
          { path: 'logistics', element: <FleetPage /> },
          { path: 'logistics/vehicles/:id', element: <VehicleDetailPage /> },
          { path: 'fleet/maintenance', element: <VehicleMaintenancePage /> },
          { path: 'fleet/maintenance/new', element: <VehicleMaintenanceFormPage /> },
          { path: 'fleet/maintenance/:id/edit', element: <VehicleMaintenanceFormPage /> },
          { path: 'fleet/penalties', element: <VehiclePenaltiesPage /> },
          { path: 'fleet/penalties/new', element: <VehiclePenaltyFormPage /> },
          { path: 'fleet/penalties/:id/edit', element: <VehiclePenaltyFormPage /> },
          { path: 'locations/map', element: <LocationsMapPage /> },
          { path: 'purchase-allocation', element: <PurchaseAllocationPage /> },
          { path: 'purchase-allocation/new', element: <AllocationFormPage /> },
          { path: 'purchase-allocation/:id/edit', element: <AllocationFormPage /> },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance', 'procurement_officer']} />,
            children: [
              { path: 'procurement', element: <ProcurementDashboardPage /> },
              { path: 'vendors', element: <VendorsPage /> },
              { path: 'vendors/new', element: <VendorFormPage /> },
              { path: 'vendors/:id', element: <VendorDetailPage /> },
              { path: 'vendors/:id/edit', element: <VendorFormPage /> },
              { path: 'vendors/:id/contract', element: <VendorContractPage /> },
              { path: 'categories', element: <Navigate to="/general-ledger" replace /> },
              { path: 'general-ledger', element: <GeneralLedgerDashboardPage /> },
              { path: 'general-ledger/new', element: <GeneralLedgerFormPage /> },
              { path: 'general-ledger/:id/edit', element: <GeneralLedgerFormPage /> },
              { path: 'general-ledger/sub-ledgers/new', element: <SubLedgerFormPage /> },
              { path: 'general-ledger/sub-ledgers/:id/edit', element: <SubLedgerFormPage /> },
              { path: 'sourcing', element: <SourcingBundlesPage /> },
              { path: 'sourcing/new', element: <SourcingBundleFormPage /> },
              { path: 'sourcing/:id/edit', element: <SourcingBundleFormPage /> },
            ],
          },
          {
            // Stock manager / logistics officer also need this view (and the
            // GRN entry point on it) to receive goods against a PO — they
            // don't get the rest of the procurement module.
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance', 'procurement_officer', 'stock_manager', 'logistics_officer']} />,
            children: [
              { path: 'sourcing/:id', element: <PurchaseOrderPage /> },
              { path: 'sourcing/:id/grn/new', element: <GoodsReceivedNoteFormPage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance']} />,
            children: [
              { path: 'finance', element: <FinanceDashboardPage /> },
              { path: 'finance/payments', element: <PaymentsDashboardPage /> },
              { path: 'finance/ledger', element: <GeneralLedgerPage /> },
              { path: 'accounts', element: <AccountsPage /> },
              { path: 'accounts/:id', element: <AccountDetailPage /> },
              { path: 'transfers', element: <TransfersPage /> },
              { path: 'sales', element: <SalesPage /> },
              { path: 'sales/:id', element: <SaleDetailPage /> },
              // Manager holds a broad UPDATE grant on sales (manager_approve_sales,
              // migration 007) that isn't limited to the approval columns at the
              // RLS layer, so full-field edit is legitimately open to them here —
              // unlike sales/new (INSERT) and the other tables below, where
              // manager's RLS grant is read-only.
              { path: 'sales/:id/edit', element: <SaleFormPage /> },
              { path: 'proformas', element: <ProformasPage /> },
              { path: 'clients', element: <ClientsPage /> },
              { path: 'clients/:id', element: <ClientDetailPage /> },
              { path: 'clients/:id/proforma', element: <ProformaInvoicePage /> },
              { path: 'clients/:id/payment-request', element: <PaymentRequestPage /> },
              { path: 'tax-summary', element: <TaxSummaryPage /> },
              { path: 'batch-payments', element: <BatchPaymentsPage /> },
              { path: 'invoices', element: <InvoicesPage /> },
              { path: 'vendor-receipts', element: <VendorReceiptsPage /> },
              { path: 'vendor-receipts/:id', element: <VendorReceiptDetailPage /> },
              { path: 'reports/pl', element: <PLReportPage /> },
              { path: 'reports/balance-sheet', element: <BalanceSheetPage /> },
              { path: 'reports/archive', element: <HistoricalArchivePage /> },
            ],
          },
          {
            // Money-book writes: RLS (001/047/049) grants manager SELECT only
            // (+ the sales UPDATE above) on these tables — admin/finance own
            // create/edit/delete. Kept as its own block so the read-only
            // paths above stay reachable for manager.
            element: <ProtectedRoute allowedRoles={['admin', 'finance']} />,
            children: [
              { path: 'accounts/new', element: <AccountFormPage /> },
              { path: 'accounts/:id/edit', element: <AccountFormPage /> },
              { path: 'transfers/new', element: <TransferFormPage /> },
              { path: 'transfers/:id/edit', element: <TransferFormPage /> },
              { path: 'sales/new', element: <SaleFormPage /> },
              { path: 'clients/new', element: <ClientFormPage /> },
              { path: 'clients/:id/edit', element: <ClientFormPage /> },
              { path: 'tax-summary/new', element: <TaxSummaryFormPage /> },
              { path: 'tax-summary/:id/edit', element: <TaxSummaryFormPage /> },
              { path: 'batch-payments/new', element: <BatchPaymentFormPage /> },
              { path: 'batch-payments/:id/edit', element: <BatchPaymentFormPage /> },
              { path: 'vendor-receipts/new', element: <VendorReceiptFormPage /> },
              { path: 'vendor-receipts/:id/edit', element: <VendorReceiptFormPage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin']} />,
            children: [
              { path: 'users', element: <UsersPage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance', 'hr_officer']} />,
            children: [
              { path: 'hr', element: <HRDashboardPage /> },
              { path: 'staff', element: <StaffPage /> },
              { path: 'staff/new', element: <StaffFormPage /> },
              { path: 'staff/:id/edit', element: <StaffFormPage /> },
              { path: 'payroll', element: <PayrollPage /> },
              { path: 'payroll/new', element: <PayrollFormPage /> },
              { path: 'payroll/:id/edit', element: <PayrollFormPage /> },
              { path: 'payroll-taxes', element: <PayrollTaxesPage /> },
              { path: 'payroll-taxes/new', element: <PayrollTaxFormPage /> },
              { path: 'payroll-taxes/:id/edit', element: <PayrollTaxFormPage /> },
              { path: 'emergency-payroll', element: <EmergencyPayrollPage /> },
              { path: 'emergency-payroll/new', element: <EmergencyPayrollFormPage /> },
              { path: 'emergency-payroll/:id/edit', element: <EmergencyPayrollFormPage /> },
              { path: 'cash-advances', element: <CashAdvancesPage /> },
              { path: 'cash-advances/new', element: <CashAdvanceFormPage /> },
              { path: 'cash-advances/:id/edit', element: <CashAdvanceFormPage /> },
              { path: 'timesheet', element: <TimesheetPage /> },
              { path: 'timesheet/new', element: <TimesheetFormPage /> },
              { path: 'timesheet/:id/edit', element: <TimesheetFormPage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance', 'project_manager']} />,
            children: [
              { path: 'management', element: <ManagementDashboardPage /> },
              { path: 'projects', element: <ProjectsPage /> },
              { path: 'projects/new', element: <ProjectFormPage /> },
              { path: 'projects/:id/edit', element: <ProjectFormPage /> },
            ],
          },
          {
            // Workspace is also read by procurement (point-of-spend checks
            // reference it) — one step wider than the management CRUD above
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance', 'project_manager', 'procurement_officer']} />,
            children: [
              { path: 'projects/:id', element: <ProjectWorkspacePage /> },
            ],
          },
          {
            // CPO bonds: Finance/manager/PM/admin keep full ownership as
            // before; sales is added so BD can raise a bond request tied
            // to a bid — RLS scopes what a sales user can actually see/do.
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance', 'project_manager', 'sales']} />,
            children: [
              { path: 'cpo-bonds', element: <CpoBondsPage /> },
              { path: 'cpo-bonds/new', element: <CpoBondFormPage /> },
              { path: 'cpo-bonds/:id/edit', element: <CpoBondFormPage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance', 'project_manager']} />,
            children: [
              { path: 'products', element: <ProductsPage /> },
              { path: 'products/new', element: <ProductFormPage /> },
              { path: 'products/:id/edit', element: <ProductFormPage /> },
              { path: 'locations', element: <LocationsPage /> },
              { path: 'locations/new', element: <LocationFormPage /> },
              { path: 'locations/:id/edit', element: <LocationFormPage /> },
            ],
          },
          // ── Departments: read for everyone (matches RLS SELECT-open
          // policy); write is an in-page modal gated to admin/manager
          // inside DepartmentsPage itself, no separate route needed.
          { path: 'departments', element: <DepartmentsPage /> },
          { path: 'departments/:id', element: <DepartmentOrgChartPage /> },
          // ── Design: read for everyone; write (new package / edit
          // package / drawings / FF&E) gated inside the pages themselves
          // AND at the route level for the dedicated new/edit routes,
          // matching the design_packages/design_drawings/ffe_specifications
          // RLS (SELECT open, write restricted to design/admin/manager).
          { path: 'design', element: <DesignPackagesPage /> },
          { path: 'design/:id', element: <DesignPackageDetailPage /> },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'design']} />,
            children: [
              { path: 'design/new', element: <DesignPackageFormPage /> },
              { path: 'design/:id/edit', element: <DesignPackageFormPage /> },
            ],
          },
          // ── Business Development / Sales: read for everyone; write
          // gated to sales/admin/manager, matching contracts/opportunities RLS.
          { path: 'contracts', element: <ContractsPage /> },
          { path: 'opportunities', element: <OpportunitiesPage /> },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'sales']} />,
            children: [
              { path: 'contracts/new', element: <ContractFormPage /> },
              { path: 'contracts/:id/edit', element: <ContractFormPage /> },
              { path: 'opportunities/new', element: <OpportunityFormPage /> },
              { path: 'opportunities/:id/edit', element: <OpportunityFormPage /> },
            ],
          },
          // ── Onboarding tasks: read for everyone (unlike the other HR
          // tables below); write gated to hr_officer/admin/manager,
          // matching onboarding_tasks RLS.
          { path: 'onboarding-tasks', element: <OnboardingTasksPage /> },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'hr_officer']} />,
            children: [
              { path: 'onboarding-tasks/new', element: <OnboardingTaskFormPage /> },
              { path: 'onboarding-tasks/:id/edit', element: <OnboardingTaskFormPage /> },
            ],
          },
          // ── Sensitive HR data: leave_requests, performance_reviews, and
          // disciplinary_records restrict BOTH read and write to
          // hr_officer/admin at the RLS layer (no broader SELECT policy at
          // all) — so unlike every other block here, even the list/detail
          // routes are role-gated, not just new/edit.
          {
            element: <ProtectedRoute allowedRoles={['admin', 'hr_officer']} />,
            children: [
              { path: 'leave-requests', element: <LeaveRequestsPage /> },
              { path: 'leave-requests/new', element: <LeaveRequestFormPage /> },
              { path: 'leave-requests/:id/edit', element: <LeaveRequestFormPage /> },
              { path: 'performance-reviews', element: <PerformanceReviewsPage /> },
              { path: 'performance-reviews/new', element: <PerformanceReviewFormPage /> },
              { path: 'performance-reviews/:id/edit', element: <PerformanceReviewFormPage /> },
              { path: 'disciplinary-records', element: <DisciplinaryRecordsPage /> },
              { path: 'disciplinary-records/new', element: <DisciplinaryRecordFormPage /> },
              { path: 'disciplinary-records/:id/edit', element: <DisciplinaryRecordFormPage /> },
            ],
          },
          // ── HSE: read for everyone; write gated to
          // hse_officer/admin/manager, matching hse_incidents/hse_inductions RLS.
          { path: 'hse-incidents', element: <HseIncidentsPage /> },
          { path: 'hse-inductions', element: <HseInductionsPage /> },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'hse_officer']} />,
            children: [
              { path: 'hse-incidents/new', element: <HseIncidentFormPage /> },
              { path: 'hse-incidents/:id/edit', element: <HseIncidentFormPage /> },
              { path: 'hse-inductions/new', element: <HseInductionFormPage /> },
              { path: 'hse-inductions/:id/edit', element: <HseInductionFormPage /> },
            ],
          },
          // ── Labor Tier 2 (requisitions): read for everyone; request gated
          // to admin/manager/project_manager/operations_manager/hr_officer;
          // approve/reject/delete happen from the list itself (RLS-gated
          // separately to operations_manager/hr_officer/admin, see 094).
          { path: 'labor-requisitions', element: <LaborRequisitionsPage /> },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'project_manager', 'operations_manager', 'hr_officer']} />,
            children: [
              { path: 'labor-requisitions/new', element: <LaborRequisitionFormPage /> },
              { path: 'labor-requisitions/:id/edit', element: <LaborRequisitionFormPage /> },
            ],
          },
          {
            // Petty cash: floats/spend/replenishment management, matching
            // petty_cash_* RLS (admin/manager/finance/project_manager) —
            // see 121. A custodian's own float is separately reachable via
            // RLS row-scoping if a self-service view is added later.
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance', 'project_manager']} />,
            children: [
              { path: 'petty-cash', element: <PettyCashPage /> },
              { path: 'petty-cash/new', element: <PettyCashFloatFormPage /> },
              { path: 'petty-cash/:id', element: <PettyCashDetailPage /> },
              { path: 'petty-cash/:id/edit', element: <PettyCashFloatFormPage /> },
            ],
          },
          // ── Subcontract engagements: read for everyone; write gated to
          // admin/manager/project_manager/procurement_officer, matching
          // subcontractor_engagements/subcontractor_completion_certificates RLS.
          { path: 'subcontracts', element: <SubcontractsPage /> },
          { path: 'subcontracts/:id', element: <SubcontractDetailPage /> },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'project_manager', 'procurement_officer']} />,
            children: [
              { path: 'subcontracts/new', element: <SubcontractFormPage /> },
              { path: 'subcontracts/:id/edit', element: <SubcontractFormPage /> },
            ],
          },
        ],
      },
    ],
  },
])
