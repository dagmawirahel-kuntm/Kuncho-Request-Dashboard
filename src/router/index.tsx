import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { LandingRedirect } from './LandingRedirect'
import { AppShell } from '@/components/layout/AppShell'
import { lazyPage } from './lazyPage'

// Each page loads when it is first opened, so the app starts with only
// the shell (see AppShell's Suspense); lazyPage reloads once after a deploy.
const DailySiteReportPage = lazyPage(() => import('@/pages/site-foreman/DailySiteReportPage'))
const SiteDailyReportsViewerPage = lazyPage(() => import('@/pages/site-foreman/SiteDailyReportsViewerPage'))
const LogMaterialReceiptPage = lazyPage(() => import('@/pages/site-foreman/LogMaterialReceiptPage'))
const SiteFloatRequestPage = lazyPage(() => import('@/pages/site-foreman/SiteFloatRequestPage'))
const FinanceSitePettyCashQueuePage = lazyPage(() => import('@/pages/site-foreman/SitePettyCashQueue').then(m => ({ default: m.FinanceSitePettyCashQueuePage })))
const PMSitePettyCashQueuePage = lazyPage(() => import('@/pages/site-foreman/SitePettyCashQueue').then(m => ({ default: m.PMSitePettyCashQueuePage })))
const PmBoqChangeOrderQueuePage = lazyPage(() => import('@/pages/projects/BoqChangeOrderQueue').then(m => ({ default: m.PmBoqChangeOrderQueuePage })))
const FinanceBoqChangeOrderQueuePage = lazyPage(() => import('@/pages/projects/BoqChangeOrderQueue').then(m => ({ default: m.FinanceBoqChangeOrderQueuePage })))
const ExecBoqChangeOrderQueuePage = lazyPage(() => import('@/pages/projects/BoqChangeOrderQueue').then(m => ({ default: m.ExecBoqChangeOrderQueuePage })))
const MaterialsRequestedPage = lazyPage(() => import('@/pages/site-foreman/ScopedListPages').then(m => ({ default: m.MaterialsRequestedPage })))
const HseLogPage = lazyPage(() => import('@/pages/site-foreman/ScopedListPages').then(m => ({ default: m.HseLogPage })))
const WorkOrdersOnMySitesPage = lazyPage(() => import('@/pages/site-foreman/ScopedListPages').then(m => ({ default: m.WorkOrdersOnMySitesPage })))
const MyProjectsPage = lazyPage(() => import('@/pages/site-foreman/ScopedListPages').then(m => ({ default: m.MyProjectsPage })))
const LoginPage = lazyPage(() => import('@/pages/auth/LoginPage'))
const SignupPage = lazyPage(() => import('@/pages/auth/SignupPage'))
const UpdatePasswordPage = lazyPage(() => import('@/pages/auth/UpdatePasswordPage'))
const DashboardPage = lazyPage(() => import('@/pages/dashboard/DashboardPage'))
const MyDashboardPage = lazyPage(() => import('@/pages/home/MyDashboardPage'))
const OpsHealthPage = lazyPage(() => import('@/pages/ops/OpsHealthPage'))
const MyRequestsDashboardPage = lazyPage(() => import('@/pages/dashboard/MyRequestsDashboardPage'))
const RequestsDashboardPage = lazyPage(() => import('@/pages/dashboard/RequestsDashboardPage'))
const ProcurementDashboardPage = lazyPage(() => import('@/pages/dashboard/ProcurementDashboardPage'))
const FinanceDashboardPage = lazyPage(() => import('@/pages/dashboard/FinanceDashboardPage'))
const PaymentsPage = lazyPage(() => import('@/pages/payments/PaymentsPage'))
const GeneralLedgerPage = lazyPage(() => import('@/pages/dashboard/GeneralLedgerPage'))
const HRDashboardPage = lazyPage(() => import('@/pages/dashboard/HRDashboardPage'))
const ManagementDashboardPage = lazyPage(() => import('@/pages/dashboard/ManagementDashboardPage'))
const ExpensesPage = lazyPage(() => import('@/pages/expenses/ExpensesPage'))
const ExpenseFormPage = lazyPage(() => import('@/pages/expenses/ExpenseFormPage'))
const ExpenseDetailPage = lazyPage(() => import('@/pages/expenses/ExpenseDetailPage'))
const FuelRequestFormPage = lazyPage(() => import('@/pages/expenses/FuelRequestFormPage'))
const ExpenseApprovalQueuePage = lazyPage(() => import('@/pages/expenses/ExpenseApprovalQueuePage'))
const ExpenseFixPage = lazyPage(() => import('@/pages/expenses/ExpenseFixPage'))
const OrdersPage = lazyPage(() => import('@/pages/orders/OrdersPage'))
const OrderFormPage = lazyPage(() => import('@/pages/orders/OrderFormPage'))
const OrderDetailPage = lazyPage(() => import('@/pages/orders/OrderDetailPage'))
const StockItemsPage = lazyPage(() => import('@/pages/stock/StockItemsPage'))
const StockItemFormPage = lazyPage(() => import('@/pages/stock/StockItemFormPage'))
const StockItemDetailPage = lazyPage(() => import('@/pages/stock/StockItemDetailPage'))
const StockMovementPage = lazyPage(() => import('@/pages/stock/StockMovementPage'))
const StockToolsPage = lazyPage(() => import('@/pages/stock/StockToolsPage'))
const TransportationPage = lazyPage(() => import('@/pages/transportation/TransportationPage'))
const VariationsPage = lazyPage(() => import('@/pages/variations/VariationsPage'))
const VariationFormPage = lazyPage(() => import('@/pages/variations/VariationFormPage'))
const VariationDetailPage = lazyPage(() => import('@/pages/variations/VariationDetailPage'))
const TransportFormPage = lazyPage(() => import('@/pages/transportation/TransportFormPage'))
const TransportPaymentFormPage = lazyPage(() => import('@/pages/transportation/TransportPaymentFormPage'))
const PayOutPage = lazyPage(() => import('@/pages/finance/PayOutPage'))
const DriversPage = lazyPage(() => import('@/pages/transportation/DriversPage'))
const TripEstimatorPage = lazyPage(() => import('@/pages/transportation/TripEstimatorPage'))
const StaffPage = lazyPage(() => import('@/pages/staff/StaffPage'))
const StaffDetailPage = lazyPage(() => import('@/pages/staff/StaffDetailPage'))
const StaffFormPage = lazyPage(() => import('@/pages/staff/StaffFormPage'))
const CasualWorkersPage = lazyPage(() => import('@/pages/hr/CasualWorkersPage'))
const WorkerRegisterPage = lazyPage(() => import('@/pages/hr/WorkerRegisterPage'))
const CompetencyHubPage = lazyPage(() => import('@/pages/hr/CompetencyHubPage'))
const LaborExpenseDraftsPage = lazyPage(() => import('@/pages/finance/LaborExpenseDraftsPage'))
const MarketTrendsPage = lazyPage(() => import('@/pages/procurement/MarketTrendsPage'))
const PriceCheckRequestsPage = lazyPage(() => import('@/pages/procurement/PriceCheckRequestsPage'))
const MyPriceCheckRequestsPage = lazyPage(() => import('@/pages/procurement/MyPriceCheckRequestsPage'))
const VolatilitySettingsPage = lazyPage(() => import('@/pages/procurement/VolatilitySettingsPage'))
const ItemBrandsPage = lazyPage(() => import('@/pages/procurement/ItemBrandsPage'))
const PayrollPage = lazyPage(() => import('@/pages/payroll/PayrollPage'))
const PayrollFormPage = lazyPage(() => import('@/pages/payroll/PayrollFormPage'))
const PayrollDetailPage = lazyPage(() => import('@/pages/payroll/PayrollDetailPage'))
const VendorsPage = lazyPage(() => import('@/pages/vendors/VendorsPage'))
const VendorFormPage = lazyPage(() => import('@/pages/vendors/VendorFormPage'))
const VendorDetailPage = lazyPage(() => import('@/pages/vendors/VendorDetailPage'))
const VendorCreditsPage = lazyPage(() => import('@/pages/vendors/VendorCreditsPage'))
const PaymentRequestsPage = lazyPage(() => import('@/pages/finance/PaymentRequestsPage'))
const PaymentRequestDetailPage = lazyPage(() => import('@/pages/finance/PaymentRequestDetailPage'))
const VendorContractPage = lazyPage(() => import('@/pages/vendors/VendorContractPage'))
const VendorReviewPage = lazyPage(() => import('@/pages/vendors/VendorReviewPage'))
const ProjectsPage = lazyPage(() => import('@/pages/projects/ProjectsPage'))
const ProjectFormPage = lazyPage(() => import('@/pages/projects/ProjectFormPage'))
const ProjectWorkspacePage = lazyPage(() => import('@/pages/projects/ProjectWorkspacePage'))
const ProjectsWeekPage = lazyPage(() => import('@/pages/projects/ProjectsWeekPage'))
const AccountsPage = lazyPage(() => import('@/pages/accounts/AccountsPage'))
const AccountFormPage = lazyPage(() => import('@/pages/accounts/AccountFormPage'))
const AccountDetailPage = lazyPage(() => import('@/pages/accounts/AccountDetailPage'))
const TransfersPage = lazyPage(() => import('@/pages/transfers/TransfersPage'))
const TransferFormPage = lazyPage(() => import('@/pages/transfers/TransferFormPage'))
const BankReconciliationPage = lazyPage(() => import('@/pages/bank/BankReconciliationPage'))
const CashForecastPage = lazyPage(() => import('@/pages/finance/CashForecastPage'))
const MonthEndPage = lazyPage(() => import('@/pages/finance/MonthEndPage'))
const PLReportPage = lazyPage(() => import('@/pages/reports/PLReportPage'))
const BalanceSheetPage = lazyPage(() => import('@/pages/reports/BalanceSheetPage'))
const HistoricalArchivePage = lazyPage(() => import('@/pages/reports/HistoricalArchivePage'))
const GovernmentStatementPage = lazyPage(() => import('@/pages/reports/GovernmentStatementPage'))
const SalesPage = lazyPage(() => import('@/pages/sales/SalesPage'))
const PackageReceiptsPage = lazyPage(() => import('@/pages/sales/PackageReceiptsPage'))
const SalesJourneyPage = lazyPage(() => import('@/pages/sales/SalesJourneyPage'))
const ClientHistoryPage = lazyPage(() => import('@/pages/sales/client-history/ClientHistoryPage'))
const SaleFormPage = lazyPage(() => import('@/pages/sales/SaleFormPage'))
const SaleDetailPage = lazyPage(() => import('@/pages/sales/SaleDetailPage'))
const ProformasPage = lazyPage(() => import('@/pages/sales/ProformasPage'))
const ClientsPage = lazyPage(() => import('@/pages/clients/ClientsPage'))
const ClientDetailPage = lazyPage(() => import('@/pages/clients/ClientDetailPage'))
const ClientFormPage = lazyPage(() => import('@/pages/clients/ClientFormPage'))
const ProformaInvoicePage = lazyPage(() => import('@/pages/clients/ProformaInvoicePage'))
const ProformaDetailPage = lazyPage(() => import('@/pages/sales/ProformaDetailPage'))
const InvoiceDocumentPage = lazyPage(() => import('@/pages/invoices/InvoiceDocumentPage'))
const CompanyProfilePage = lazyPage(() => import('@/pages/settings/CompanyProfilePage'))
const VerifyDocumentPage = lazyPage(() => import('@/pages/public/VerifyDocumentPage'))
const PaymentRequestPage = lazyPage(() => import('@/pages/clients/PaymentRequestPage'))
const InvoicesPage = lazyPage(() => import('@/pages/invoices/InvoicesPage'))
const CarriedForwardPage = lazyPage(() => import('@/pages/invoices/CarriedForwardPage'))
const GeneralLedgerDashboardPage = lazyPage(() => import('@/pages/general-ledger/GeneralLedgerDashboardPage'))
const GeneralLedgerFormPage = lazyPage(() => import('@/pages/general-ledger/GeneralLedgerFormPage'))
const SubLedgerFormPage = lazyPage(() => import('@/pages/general-ledger/SubLedgerFormPage'))
const PurchaseAllocationPage = lazyPage(() => import('@/pages/purchase-allocation/PurchaseAllocationPage'))
const AllocationFormPage = lazyPage(() => import('@/pages/purchase-allocation/AllocationFormPage'))
const AttendancePage = lazyPage(() => import('@/pages/attendance/AttendancePage'))
const CashAdvancesPage = lazyPage(() => import('@/pages/cash-advances/CashAdvancesPage'))
const CashAdvanceFormPage = lazyPage(() => import('@/pages/cash-advances/CashAdvanceFormPage'))
const TaxManagementPage = lazyPage(() => import('@/pages/tax-summary/TaxManagementPage'))
const TaxFilingsPage = lazyPage(() => import('@/pages/tax-filings/TaxFilingsPage'))
const TaxPlanPage = lazyPage(() => import('@/pages/tax-plan/TaxPlanPage'))
const TaxImpactPage = lazyPage(() => import('@/pages/tax-plan/TaxImpactPage'))
const TaxReceiptsPage = lazyPage(() => import('@/pages/tax-receipts/TaxReceiptsPage'))
const TaxReceiptFormPage = lazyPage(() => import('@/pages/tax-receipts/TaxReceiptFormPage'))
const VatReceiptTrackerPage = lazyPage(() => import('@/pages/tax-receipts/VatReceiptTrackerPage'))
const SalesReceiptFormPage = lazyPage(() => import('@/pages/tax-receipts/SalesReceiptFormPage'))
const BatchPaymentsPage = lazyPage(() => import('@/pages/batch-payments/BatchPaymentsPage'))
const BatchPaymentFormPage = lazyPage(() => import('@/pages/batch-payments/BatchPaymentFormPage'))
const BatchPaymentDetailPage = lazyPage(() => import('@/pages/batch-payments/BatchPaymentDetailPage'))
const CpoBondsPage = lazyPage(() => import('@/pages/cpo-bonds/CpoBondsPage'))
const CpoBondFormPage = lazyPage(() => import('@/pages/cpo-bonds/CpoBondFormPage'))
const ServicesCatalogPage = lazyPage(() => import('@/pages/catalog/ServicesCatalogPage'))
const EmergencyPayrollPage = lazyPage(() => import('@/pages/emergency-payroll/EmergencyPayrollPage'))
const EmergencyPayrollFormPage = lazyPage(() => import('@/pages/emergency-payroll/EmergencyPayrollFormPage'))
const VendorReceiptsPage = lazyPage(() => import('@/pages/vendor-receipts/VendorReceiptsPage'))
const VendorReceiptFormPage = lazyPage(() => import('@/pages/vendor-receipts/VendorReceiptFormPage'))
const VendorReceiptDetailPage = lazyPage(() => import('@/pages/vendor-receipts/VendorReceiptDetailPage'))
const LocationsPage = lazyPage(() => import('@/pages/locations/LocationsPage'))
const LocationFormPage = lazyPage(() => import('@/pages/locations/LocationFormPage'))
const OverviewDashboardPage = lazyPage(() => import('@/pages/dashboard/OverviewDashboardPage'))
const UsersPage = lazyPage(() => import('@/pages/users/UsersPage'))
const CalendarPage = lazyPage(() => import('@/pages/calendar/CalendarPage'))
const FleetPage = lazyPage(() => import('@/pages/logistics/FleetPage'))
const MyTripsPage = lazyPage(() => import('@/pages/logistics/MyTripsPage'))
const VehicleDetailPage = lazyPage(() => import('@/pages/logistics/VehicleDetailPage'))
const LocationsMapPage = lazyPage(() => import('@/pages/locations/LocationsMapPage'))
const LocationsTidyPage = lazyPage(() => import('@/pages/locations/LocationsTidyPage'))
const TransportInsightsPage = lazyPage(() => import('@/pages/logistics/TransportInsightsPage'))
const SourcingBundlesPage = lazyPage(() => import('@/pages/sourcing/SourcingBundlesPage'))
const SourcingBundleFormPage = lazyPage(() => import('@/pages/sourcing/SourcingBundleFormPage'))
const PurchaseOrderPage = lazyPage(() => import('@/pages/sourcing/PurchaseOrderPage'))
const GoodsReceivedNoteFormPage = lazyPage(() => import('@/pages/sourcing/GoodsReceivedNoteFormPage'))
const GrnRegisterPage = lazyPage(() => import('@/pages/sourcing/GrnRegisterPage'))
const GrnDetailPage = lazyPage(() => import('@/pages/sourcing/GrnDetailPage'))
const ItemVariantsPage = lazyPage(() => import('@/pages/procurement/ItemVariantsPage'))
const SiteDeliveryNoteFormPage = lazyPage(() => import('@/pages/sourcing/SiteDeliveryNoteFormPage'))
const SiteDeliveriesPage = lazyPage(() => import('@/pages/sourcing/SiteDeliveriesPage'))
const SiteDeliveryNotePage = lazyPage(() => import('@/pages/sourcing/SiteDeliveryNotePage'))
const DepartmentsPage = lazyPage(() => import('@/pages/departments/DepartmentsPage'))
const DepartmentOrgChartPage = lazyPage(() => import('@/pages/departments/DepartmentOrgChartPage'))
const DesignPackagesPage = lazyPage(() => import('@/pages/design/DesignPackagesPage'))
const DesignPackageFormPage = lazyPage(() => import('@/pages/design/DesignPackageFormPage'))
const DesignPackageDetailPage = lazyPage(() => import('@/pages/design/DesignPackageDetailPage'))
const FixedAssetsPage = lazyPage(() => import('@/pages/finance/FixedAssetsPage'))
const FixedAssetFormPage = lazyPage(() => import('@/pages/finance/FixedAssetFormPage'))
const ContractsPage = lazyPage(() => import('@/pages/bd/ContractsPage'))
const ContractFormPage = lazyPage(() => import('@/pages/bd/ContractFormPage'))
const OpportunitiesPage = lazyPage(() => import('@/pages/bd/OpportunitiesPage'))
const OpportunityFormPage = lazyPage(() => import('@/pages/bd/OpportunityFormPage'))
const LeaveRequestsPage = lazyPage(() => import('@/pages/leave-requests/LeaveRequestsPage'))
const LeaveRequestFormPage = lazyPage(() => import('@/pages/leave-requests/LeaveRequestFormPage'))
const MyLeavePage = lazyPage(() => import('@/pages/leave-requests/MyLeavePage'))
const PerformanceReviewsPage = lazyPage(() => import('@/pages/performance-reviews/PerformanceReviewsPage'))
const PerformanceReviewFormPage = lazyPage(() => import('@/pages/performance-reviews/PerformanceReviewFormPage'))
const SettingsPage = lazyPage(() => import('@/pages/settings/SettingsPage'))
const NotificationSettingsPage = lazyPage(() => import('@/pages/settings/NotificationSettingsPage'))
const NotificationsPage = lazyPage(() => import('@/pages/notifications/NotificationsPage'))
const OnboardingTasksPage = lazyPage(() => import('@/pages/onboarding-tasks/OnboardingTasksPage'))
const OnboardingTaskFormPage = lazyPage(() => import('@/pages/onboarding-tasks/OnboardingTaskFormPage'))
const DisciplinaryRecordsPage = lazyPage(() => import('@/pages/disciplinary-records/DisciplinaryRecordsPage'))
const DisciplinaryRecordFormPage = lazyPage(() => import('@/pages/disciplinary-records/DisciplinaryRecordFormPage'))
const HseIncidentsPage = lazyPage(() => import('@/pages/hse-incidents/HseIncidentsPage'))
const HseIncidentFormPage = lazyPage(() => import('@/pages/hse-incidents/HseIncidentFormPage'))
const HseInductionsPage = lazyPage(() => import('@/pages/hse-inductions/HseInductionsPage'))
const HseInductionFormPage = lazyPage(() => import('@/pages/hse-inductions/HseInductionFormPage'))
const Tier2CandidatesPage = lazyPage(() => import('@/pages/hr/Tier2CandidatesPage'))
const PettyCashPage = lazyPage(() => import('@/pages/petty-cash/PettyCashPage'))
const PettyCashFloatFormPage = lazyPage(() => import('@/pages/petty-cash/PettyCashFloatFormPage'))
const PettyCashDetailPage = lazyPage(() => import('@/pages/petty-cash/PettyCashDetailPage'))
const VehicleMaintenancePage = lazyPage(() => import('@/pages/fleet/VehicleMaintenancePage'))
const VehicleMaintenanceFormPage = lazyPage(() => import('@/pages/fleet/VehicleMaintenanceFormPage'))
const VehiclePenaltiesPage = lazyPage(() => import('@/pages/fleet/VehiclePenaltiesPage'))
const VehiclePenaltyFormPage = lazyPage(() => import('@/pages/fleet/VehiclePenaltyFormPage'))
const ReceiptPickupQueuePage = lazyPage(() => import('@/pages/logistics/ReceiptPickupQueuePage'))
const LabourHomePage = lazyPage(() => import('@/pages/labour/LabourHomePage'))
const LabourRequestFormPage = lazyPage(() => import('@/pages/labour/LabourRequestFormPage'))
const LabourRequestPage = lazyPage(() => import('@/pages/labour/LabourRequestPage'))
const LabourRecordPage = lazyPage(() => import('@/pages/labour/LabourRecordPage'))
const LabourOvertimePage = lazyPage(() => import('@/pages/labour/LabourOvertimePage'))
const LabourPayPage = lazyPage(() => import('@/pages/labour/LabourPayPage'))
const LabourRedirect = lazyPage(() => import('@/pages/labour/LabourRedirect'))
const LabourPayRequestsPage = lazyPage(() => import('@/pages/labour/LabourPayRequestsPage'))
const LabourWeekPage = lazyPage(() => import('@/pages/labour/LabourWeekPage'))
const LabourWorkersPage = lazyPage(() => import('@/pages/labour/LabourWorkersPage'))
const LabourPayRequestPage = lazyPage(() => import('@/pages/labour/LabourPayRequestPage'))
const SubcontractsPage = lazyPage(() => import('@/pages/subcontracts/SubcontractsPage'))
const SubcontractFormPage = lazyPage(() => import('@/pages/subcontracts/SubcontractFormPage'))
const SubcontractDetailPage = lazyPage(() => import('@/pages/subcontracts/SubcontractDetailPage'))
const StockPendingSetupPage = lazyPage(() => import('@/pages/stock/StockPendingSetupPage'))
const StockDuplicatesPage = lazyPage(() => import('@/pages/stock/StockDuplicatesPage'))
const StockDispatchQueuePage = lazyPage(() => import('@/pages/stock/StockDispatchQueuePage'))
const StockIssuePage = lazyPage(() => import('@/pages/stock/StockIssuePage'))
const StockCountsPage = lazyPage(() => import('@/pages/stock/StockCountsPage'))
const StockCountPage = lazyPage(() => import('@/pages/stock/StockCountPage'))
const ProjectManagerViewPage = lazyPage(() => import('@/pages/views/ProjectManagerViewPage'))
const OperationsManagerViewPage = lazyPage(() => import('@/pages/views/OperationsManagerViewPage'))
const StockManagerViewPage = lazyPage(() => import('@/pages/views/StockManagerViewPage'))
const LogisticsOfficerViewPage = lazyPage(() => import('@/pages/views/LogisticsOfficerViewPage'))
const WorkshopViewPage = lazyPage(() => import('@/pages/views/WorkshopViewPage'))
const DesignViewPage = lazyPage(() => import('@/pages/views/DesignViewPage'))
const BdSalesViewPage = lazyPage(() => import('@/pages/views/BdSalesViewPage'))
const HrPeopleViewPage = lazyPage(() => import('@/pages/views/HrPeopleViewPage'))
const HseViewPage = lazyPage(() => import('@/pages/views/HseViewPage'))
const NoDepartmentPage = lazyPage(() => import('@/pages/dashboard/NoDepartmentPage'))
const RentPage = lazyPage(() => import('@/pages/properties/RentPage'))
const PropertyFormPage = lazyPage(() => import('@/pages/properties/PropertyFormPage'))
const WorkOrdersPage = lazyPage(() => import('@/pages/work-orders/WorkOrdersPage'))
const WorkOrderFormPage = lazyPage(() => import('@/pages/work-orders/WorkOrderFormPage'))
const WorkOrderDetailPage = lazyPage(() => import('@/pages/work-orders/WorkOrderDetailPage'))
const RolesPage = lazyPage(() => import('@/pages/roles/RolesPage'))
const RolePrintPage = lazyPage(() => import('@/pages/roles/RolePrintPage'))
const PersonSkillsPage = lazyPage(() => import('@/pages/roles/PersonSkillsPage'))
const OldSkillsRedirect = lazyPage(() => import('@/pages/roles/OldSkillsRedirect'))
const ExecDashboardPage = lazyPage(() => import('@/pages/exec/ExecDashboardPage'))
const TradeCatalogPage = lazyPage(() => import('@/pages/hr/TradeCatalogPage'))

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/update-password', element: <UpdatePasswordPage /> },
  // The page behind a document's QR code and share link — open to anyone
  // holding the link, no sign-in (verify_document, migration 368).
  { path: '/verify/:token', element: <VerifyDocumentPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <LandingRedirect /> },
          { path: 'home', element: <MyDashboardPage /> },
          { path: 'ops-health', element: <OpsHealthPage /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'my-home', element: <MyRequestsDashboardPage /> },
          { path: 'my-leave', element: <MyLeavePage /> },
          // Staff attendance (migration 400). Open to everyone: each person
          // sees their own day; the page and RLS decide who records whom.
          // Casual labour is recorded under /labour, which pays it.
          { path: 'timesheet', element: <AttendancePage /> },
          { path: 'timesheet/new', element: <Navigate to="/timesheet" replace /> },
          { path: 'timesheet/:id/edit', element: <Navigate to="/timesheet" replace /> },
          { path: 'attendance', element: <Navigate to="/timesheet" replace /> },
          { path: 'calendar', element: <CalendarPage /> },
          { path: 'settings', element: <SettingsPage /> },
          // Notifications (migrations 424–425): open to everyone; RLS keeps each inbox private.
          { path: 'settings/notifications', element: <NotificationSettingsPage /> },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'no-department', element: <NoDepartmentPage /> },
          { path: 'requests', element: <RequestsDashboardPage /> },
          { path: 'expenses', element: <ExpensesPage /> },
          { path: 'expenses/new', element: <ExpenseFormPage /> },
          { path: 'expenses/fuel/new', element: <FuelRequestFormPage /> },
          {
            // Finance's queue and record fixer (395); executive sees both.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance']} />,
            children: [
              { path: 'expenses/approvals', element: <ExpenseApprovalQueuePage /> },
              { path: 'expenses/fix', element: <ExpenseFixPage /> },
            ],
          },
          { path: 'expenses/:id', element: <ExpenseDetailPage /> },
          { path: 'expenses/:id/edit', element: <ExpenseFormPage /> },
          { path: 'orders', element: <Navigate to="/purchase-requests" replace /> },
          { path: 'orders/new', element: <Navigate to="/purchase-requests/new" replace /> },
          { path: 'orders/:id/edit', element: <Navigate to="/purchase-requests" replace /> },
          { path: 'purchase-requests', element: <OrdersPage /> },
          { path: 'purchase-requests/:id', element: <OrderDetailPage /> },
          {
            // Procurement officers may view requests but cannot create or edit them
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'staff', 'technician', 'project_manager', 'hr_officer', 'operations_manager']} />,
            children: [
              { path: 'purchase-requests/new', element: <OrderFormPage /> },
              { path: 'purchase-requests/:id/edit', element: <OrderFormPage /> },
            ],
          },
          { path: 'staff/:id', element: <StaffDetailPage /> },
          {
            // Match RLS: only these roles can write stock tables
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'stock_manager', 'procurement_officer']} />,
            children: [
              { path: 'stock', element: <StockItemsPage /> },
              { path: 'stock/new', element: <StockItemFormPage /> },
              { path: 'stock/pending-setup', element: <StockPendingSetupPage /> },
              { path: 'stock/duplicates', element: <StockDuplicatesPage /> },
              { path: 'stock/dispatch-queue', element: <StockDispatchQueuePage /> },
              { path: 'stock/tools', element: <StockToolsPage /> },
              { path: 'stock/movement/new', element: <StockMovementPage /> },
              { path: 'stock/issue', element: <StockIssuePage /> },
              { path: 'stock/counts', element: <StockCountsPage /> },
              { path: 'stock/counts/:id', element: <StockCountPage /> },
              { path: 'stock/:id', element: <StockItemDetailPage /> },
              { path: 'stock/:id/edit', element: <StockItemFormPage /> },
            ],
          },
          { path: 'transportation', element: <TransportationPage /> },
          { path: 'transportation/new', element: <TransportFormPage /> },
          { path: 'transportation/drivers', element: <DriversPage /> },
          { path: 'transportation/estimate', element: <TripEstimatorPage /> },
          { path: 'transportation/:id/edit', element: <TransportFormPage /> },
          { path: 'transportation/:id/pay', element: <TransportPaymentFormPage /> },
          { path: 'logistics', element: <FleetPage /> },
          { path: 'logistics/insights', element: <TransportInsightsPage /> },
          { path: 'my-trips', element: <MyTripsPage /> },
          { path: 'logistics/vehicles/:id', element: <VehicleDetailPage /> },
          { path: 'fleet/maintenance', element: <VehicleMaintenancePage /> },
          { path: 'fleet/maintenance/new', element: <VehicleMaintenanceFormPage /> },
          { path: 'fleet/maintenance/:id/edit', element: <VehicleMaintenanceFormPage /> },
          { path: 'fleet/penalties', element: <VehiclePenaltiesPage /> },
          { path: 'fleet/penalties/new', element: <VehiclePenaltyFormPage /> },
          { path: 'fleet/penalties/:id/edit', element: <VehiclePenaltyFormPage /> },
          { path: 'receipt-pickups', element: <ReceiptPickupQueuePage /> },
          { path: 'locations/map', element: <LocationsMapPage /> },
          { path: 'purchase-allocation', element: <PurchaseAllocationPage /> },
          { path: 'purchase-allocation/new', element: <AllocationFormPage /> },
          { path: 'purchase-allocation/:id/edit', element: <AllocationFormPage /> },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'procurement_officer']} />,
            children: [
              { path: 'procurement', element: <ProcurementDashboardPage /> },
              // Tax receipts: entry is finance/procurement (whoever collected
              // it), verification is the other department, tax review is the
              // Tax Officer. All three steps are enforced server-side by the
              // maker-checker-reviewer trigger — this route only decides who
              // can reach the page at all.
              { path: 'tax-receipts', element: <TaxReceiptsPage /> },
              { path: 'tax-receipts/new', element: <TaxReceiptFormPage /> },
              // The tracker is the procurement-facing surface: capture a
              // photo, then confirm the paper reached the office. Sales-side
              // presentation is reachable from the same page.
              { path: 'vat-tracker', element: <VatReceiptTrackerPage /> },
              { path: 'sales-receipts/new', element: <SalesReceiptFormPage /> },
              { path: 'vendors', element: <VendorsPage /> },
              { path: 'vendors/new', element: <VendorFormPage /> },
              { path: 'vendors/review', element: <VendorReviewPage /> },
              { path: 'vendors/:id', element: <VendorDetailPage /> },
              { path: 'vendors/:id/edit', element: <VendorFormPage /> },
              { path: 'vendors/:id/contract', element: <VendorContractPage /> },
              { path: 'categories', element: <Navigate to="/general-ledger" replace /> },
              { path: 'general-ledger', element: <GeneralLedgerDashboardPage /> },
              { path: 'general-ledger/new', element: <GeneralLedgerFormPage /> },
              { path: 'general-ledger/:id/edit', element: <GeneralLedgerFormPage /> },
              { path: 'general-ledger/sub-ledgers/new', element: <SubLedgerFormPage /> },
              { path: 'general-ledger/sub-ledgers/:id/edit', element: <SubLedgerFormPage /> },
              { path: 'sourcing/new', element: <SourcingBundleFormPage /> },
              { path: 'sourcing/:id/edit', element: <SourcingBundleFormPage /> },
              { path: 'procurement/market-trends', element: <MarketTrendsPage /> },
              { path: 'procurement/price-check-requests', element: <PriceCheckRequestsPage /> },
              { path: 'procurement/volatility', element: <VolatilitySettingsPage /> },
              { path: 'procurement/item-brands', element: <ItemBrandsPage /> },
              { path: 'procurement/item-variants', element: <ItemVariantsPage /> },
            ],
          },
          {
            // The PO list: procurement's, and the operations manager's, who
            // approves POs up to 500,000 (133). Making POs stays above.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'procurement_officer', 'operations_manager']} />,
            children: [{ path: 'sourcing', element: <SourcingBundlesPage /> }],
          },
          // My requests is visible to any authenticated user (each sees their own)
          { path: 'procurement/my-price-check-requests', element: <MyPriceCheckRequestsPage /> },
          {
            // Stock manager / logistics officer also need this view (and the
            // GRN entry point on it) to receive goods against a PO — they
            // don't get the rest of the procurement module. operations_manager
            // added for the capped (<=500k) approval queue (133) — RLS is
            // what actually enforces the cap, this is just route-level reach.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'procurement_officer', 'stock_manager', 'logistics_officer', 'operations_manager']} />,
            children: [
              { path: 'sourcing/:id', element: <PurchaseOrderPage /> },
              { path: 'sourcing/:id/grn/new', element: <GoodsReceivedNoteFormPage /> },
              // Sending goods to a site (371): procurement or logistics.
              // issue_site_delivery_note() is what enforces who may.
              { path: 'sourcing/:id/sdn/new', element: <SiteDeliveryNoteFormPage /> },
            ],
          },
          {
            // The GRN register — read-only. Project managers see their own
            // projects' deliveries (grn_read_project_manager, 371); grn_read
            // (063) decides the rest, same split as everywhere else.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'procurement_officer', 'stock_manager', 'logistics_officer', 'operations_manager', 'project_manager']} allowAssignedProjectManager allowLogisticsOfficer />,
            children: [
              { path: 'goods-received', element: <GrnRegisterPage /> },
              { path: 'goods-received/:id', element: <GrnDetailPage /> },
            ],
          },
          // Site deliveries (371): the project manager's inbox to sign, and
          // procurement's queue to confirm. Anyone signed in reaches it;
          // sdn_read decides which notes they see.
          { path: 'site-deliveries', element: <SiteDeliveriesPage /> },
          { path: 'site-deliveries/:id', element: <SiteDeliveryNotePage /> },
          {
            // Tax filings sit in their own block rather than the finance one
            // below, because the tax officer is a badge and not a role: the
            // RLS on these tables reads is_tax_officer() alongside
            // admin/finance/executive, and the gate has to match or an
            // officer with some other login role is locked out of the module
            // built for them. Writes are narrower still (tax officer or
            // admin) and are enforced by policy, not by this route.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance']} allowTaxOfficer />,
            children: [
              { path: 'tax-filings', element: <TaxFilingsPage /> },
              { path: 'tax-plan', element: <TaxPlanPage /> },
              { path: 'tax-impact', element: <TaxImpactPage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance']} />,
            children: [
              { path: 'finance', element: <FinanceDashboardPage /> },
              { path: 'finance/payments', element: <PaymentsPage /> },
              { path: 'finance/ledger', element: <GeneralLedgerPage /> },
              { path: 'finance/vendor-credits', element: <VendorCreditsPage /> },
              // The Payment Request register (268). Route reach matches
              // this block; pr_read is what actually filters the rows.
              { path: 'finance/payment-requests', element: <PaymentRequestsPage /> },
              { path: 'finance/payment-requests/:id', element: <PaymentRequestDetailPage /> },
              { path: 'accounts', element: <AccountsPage /> },
              { path: 'accounts/:id', element: <AccountDetailPage /> },
              { path: 'transfers', element: <TransfersPage /> },
              // Manager holds a broad UPDATE grant on sales (manager_approve_sales,
              // migration 007) that isn't limited to the approval columns at the
              // RLS layer, so full-field edit is legitimately open to them here —
              // unlike sales/new (INSERT) and the other tables below, where
              // manager's RLS grant is read-only.
              { path: 'sales/:id/edit', element: <SaleFormPage /> },
              { path: 'proformas', element: <ProformasPage /> },
              { path: 'proformas/:id', element: <ProformaDetailPage /> },
              { path: 'settings/company', element: <CompanyProfilePage /> },
              { path: 'clients', element: <ClientsPage /> },
              { path: 'clients/:id', element: <ClientDetailPage /> },
              { path: 'clients/:id/proforma', element: <ProformaInvoicePage /> },
              { path: 'clients/:id/payment-request', element: <PaymentRequestPage /> },
              // Tax Summary was a Gregorian-month filing-status grid over
              // tax_engagements; Tax Filings replaced it with Ethiopian
              // periods (migration 308). Kept as a redirect for old links.
              { path: 'tax-summary', element: <Navigate to="/tax-filings" replace /> },
              { path: 'tax-management', element: <TaxManagementPage /> },
              { path: 'batch-payments', element: <BatchPaymentsPage /> },
              { path: 'batch-payments/:id', element: <BatchPaymentDetailPage /> },
              { path: 'invoices', element: <InvoicesPage /> },
              { path: 'invoices/carried-forward', element: <CarriedForwardPage /> },
              { path: 'invoices/:id', element: <InvoiceDocumentPage /> },
              { path: 'reports/pl', element: <PLReportPage /> },
              { path: 'reports/balance-sheet', element: <BalanceSheetPage /> },
              { path: 'reports/archive', element: <HistoricalArchivePage /> },
              { path: 'reports/government-statement', element: <GovernmentStatementPage /> },
            ],
          },
          {
            // sales role added here only — read-only, matching the new
            // sales_role_read_sales RLS grant (145). Edit/create stay
            // admin/finance(/manager for the approval-adjacent edit
            // above), unchanged.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'sales']} />,
            children: [
              { path: 'sales', element: <SalesPage /> },
              { path: 'sales/:id', element: <SaleDetailPage /> },
              // Every deal, its money and its documents (migration 331).
              { path: 'sales-journey', element: <SalesJourneyPage /> },
              // One client's whole relationship (migration 334).
              { path: 'sales-journey/clients/:id', element: <ClientHistoryPage /> },
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
              { path: 'bank-statement-import', element: <BankReconciliationPage /> },
              { path: 'cash-forecast', element: <CashForecastPage /> },
              // The cashier paying a driver at the gate (433).
              { path: 'finance/pay-out', element: <PayOutPage /> },
              { path: 'month-end', element: <MonthEndPage /> },
              { path: 'sales/new', element: <SaleFormPage /> },
              // Engagements many clients pay a set package for (455).
              { path: 'package-receipts', element: <PackageReceiptsPage /> },
              { path: 'clients/new', element: <ClientFormPage /> },
              { path: 'clients/:id/edit', element: <ClientFormPage /> },
              // tax_summary was an empty manual monthly rollup; periods now
              // follow from each record's date (migration 314).
              { path: 'tax-summary/new', element: <Navigate to="/tax-filings" replace /> },
              { path: 'tax-summary/:id/edit', element: <Navigate to="/tax-filings" replace /> },
              // Filings are recorded in Tax Filings now; tax_engagements is a
              // read-only archive (migration 308).
              { path: 'tax-management/log', element: <Navigate to="/tax-filings" replace /> },
              { path: 'batch-payments/new', element: <BatchPaymentFormPage /> },
              { path: 'batch-payments/:id/edit', element: <BatchPaymentFormPage /> },
              { path: 'finance/fixed-assets/new', element: <FixedAssetFormPage /> },
              { path: 'finance/fixed-assets/:id/edit', element: <FixedAssetFormPage /> },
            ],
          },
          {
            // VRF is restricted: admin and executive always; finance only with
            // the VRF-manager badge; every other role blocked entirely.
            element: <ProtectedRoute allowedRoles={['admin', 'executive']} allowVrfManager />,
            children: [
              { path: 'vendor-receipts', element: <VendorReceiptsPage /> },
              { path: 'vendor-receipts/:id', element: <VendorReceiptDetailPage /> },
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
            // Site Foreman pages: RLS on every underlying table gates by
            // is_site_foreman_for_project, so route access can be as broad as
            // "any logged-in user"; the queries return zero rows for anyone
            // without a scoped assignment. The Finance/PM queues below are
            // gated by role since they're written-to.
            children: [
              { path: 'site-foreman/daily-report', element: <DailySiteReportPage /> },
              // Log Site Timesheet (Tier1+Tier2 via `timesheet`) and the
              // separate Tier 2-only weekly grid (`timesheet_attendance`)
              // are both folded into WO-owned attendance — old links keep
              // working via redirect rather than 404ing.
              { path: 'site-foreman/timesheet', element: <Navigate to="/labour/record" replace /> },
              { path: 'site-foreman/attendance', element: <Navigate to="/labour/record" replace /> },
              { path: 'site-foreman/log-attendance', element: <Navigate to="/labour/record" replace /> },
              { path: 'site-foreman/log-material-receipt', element: <LogMaterialReceiptPage /> },
              { path: 'site-foreman/float-request', element: <SiteFloatRequestPage /> },
              { path: 'site-foreman/materials', element: <MaterialsRequestedPage /> },
              { path: 'site-foreman/hse', element: <HseLogPage /> },
              { path: 'site-foreman/work-orders', element: <WorkOrdersOnMySitesPage /> },
              { path: 'site-foreman/projects', element: <MyProjectsPage /> },
              // Reports viewer: RLS scopes it (sdr_pm_read = the project's
              // manager whatever their app role, sdr_exec_all = admin/exec).
              { path: 'site-foreman/reports', element: <SiteDailyReportsViewerPage /> },
            ],
          },
          {
            // 'executive' included to match spcfr_exec_read's read grant on
            // the underlying table — otherwise an exec's sidebar link would
            // just bounce them back to "/".
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance']} />,
            children: [
              { path: 'finance/site-petty-cash-requests', element: <FinanceSitePettyCashQueuePage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'project_manager', 'operations_manager']} allowAssignedProjectManager />,
            children: [
              { path: 'pm/site-petty-cash-requests', element: <PMSitePettyCashQueuePage /> },
            ],
          },
          {
            // PR 9a.5 group 2 — matches each RPC's own role check
            // (pm_approve_change_order: admin/PM; finance_approve: admin/
            // finance; exec_approve: admin/executive). 'executive' is added
            // to the PM route too since record_client_signoff and the PM
            // approval step both allow admin/PM only, but boq_change_orders_select
            // grants executive read — without it an exec's link would 404
            // the same way the note above the site-petty-cash route flags.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'project_manager', 'operations_manager']} allowAssignedProjectManager />,
            children: [
              { path: 'pm/boq-change-orders', element: <PmBoqChangeOrderQueuePage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance']} />,
            children: [
              { path: 'finance/boq-change-orders', element: <FinanceBoqChangeOrderQueuePage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive']} />,
            children: [
              { path: 'exec/boq-change-orders', element: <ExecBoqChangeOrderQueuePage /> },
            ],
          },
          {
            // HR-only, per the provision_tier_2_worker_from_candidate RPC's
            // own role check (admin/executive/hr_officer) — narrower than
            // the general HR block below, which also admits finance.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'hr_officer']} />,
            children: [
              { path: 'hr/tier2-candidates', element: <Tier2CandidatesPage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'hr_officer']} />,
            children: [
              { path: 'hr', element: <HRDashboardPage /> },
              { path: 'hr/casual-workers', element: <CasualWorkersPage /> },
              { path: 'hr/worker-register', element: <WorkerRegisterPage /> },
              // Tier 2 trade catalog — HR polishes newly-approved trades'
              // emoji + accent colors. RLS on tier2_trade_roster gates writes
              // to admin per migration 183.
              { path: 'hr/trades', element: <TradeCatalogPage /> },
              { path: 'staff', element: <StaffPage /> },
              { path: 'staff/new', element: <StaffFormPage /> },
              { path: 'staff/:id/edit', element: <StaffFormPage /> },
              { path: 'finance/labor-expense-drafts', element: <LaborExpenseDraftsPage /> },
              { path: 'payroll', element: <PayrollPage /> },
              { path: 'payroll/new', element: <PayrollFormPage /> },
              { path: 'payroll/:id/edit', element: <PayrollFormPage /> },
              { path: 'payroll/:id', element: <PayrollDetailPage /> },
              // Payroll Taxes was manual per-staff entry (empty). PAYE and
              // pension are now computed from payroll and shown on the
              // Schedule A and pension filings (migration 312).
              { path: 'payroll-taxes', element: <Navigate to="/tax-filings" replace /> },
              { path: 'payroll-taxes/new', element: <Navigate to="/tax-filings" replace /> },
              { path: 'payroll-taxes/:id/edit', element: <Navigate to="/tax-filings" replace /> },
              { path: 'emergency-payroll', element: <EmergencyPayrollPage /> },
              { path: 'emergency-payroll/new', element: <EmergencyPayrollFormPage /> },
              { path: 'emergency-payroll/:id/edit', element: <EmergencyPayrollFormPage /> },
              { path: 'cash-advances', element: <CashAdvancesPage /> },
              { path: 'cash-advances/new', element: <CashAdvanceFormPage /> },
              { path: 'cash-advances/:id/edit', element: <CashAdvanceFormPage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'project_manager']} />,
            children: [
              { path: 'projects/new', element: <ProjectFormPage /> },
            ],
          },
          {
            // The operations manager runs every project (447) — reads and
            // edits them, but doesn't open new ones.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'project_manager', 'operations_manager']} />,
            children: [
              { path: 'management', element: <ManagementDashboardPage /> },
              { path: 'projects', element: <ProjectsPage /> },
              { path: 'projects/this-week', element: <ProjectsWeekPage /> },
              { path: 'projects/:id/edit', element: <ProjectFormPage /> },
            ],
          },
          {
            // Variation orders (459): recorded and priced by PMs, operations
            // and executives; read by finance and sales so they're seen long
            // before collection. Writes go through RPCs that check roles.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'project_manager', 'operations_manager', 'sales']} allowAssignedProjectManager />,
            children: [
              { path: 'variations', element: <VariationsPage /> },
              { path: 'variations/new', element: <VariationFormPage /> },
              { path: 'variations/:id', element: <VariationDetailPage /> },
              { path: 'variations/:id/edit', element: <VariationFormPage /> },
            ],
          },
          {
            // Workspace is also read by procurement (point-of-spend checks
            // reference it), plus operations_manager and design — both
            // already read-granted at the RLS layer for BOQ/Schedule (209,
            // 218) but missing here until the Schedule tab needed them.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'project_manager', 'procurement_officer', 'operations_manager', 'design']} allowAssignedProjectManager />,
            children: [
              { path: 'projects/:id', element: <ProjectWorkspacePage /> },
            ],
          },
          {
            // CPO bonds: Finance/manager/PM/admin keep full ownership as
            // before; sales is added so BD can raise a bond request tied
            // to a bid — RLS scopes what a sales user can actually see/do.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'project_manager', 'sales']} />,
            children: [
              { path: 'cpo-bonds', element: <CpoBondsPage /> },
              { path: 'cpo-bonds/new', element: <CpoBondFormPage /> },
              { path: 'cpo-bonds/:id/edit', element: <CpoBondFormPage /> },
            ],
          },
          {
            // What Kuncho sells (migration 337): everyone who builds or
            // prices a quote reads it; RLS decides who sees costs and edits.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'project_manager', 'sales']} />,
            children: [{ path: 'catalog', element: <ServicesCatalogPage /> }],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'project_manager']} />,
            children: [
              // The products list grew into the Services Catalog (migration 337).
              { path: 'products', element: <Navigate to="/catalog" replace /> },
              { path: 'products/new', element: <Navigate to="/catalog" replace /> },
              { path: 'products/:id/edit', element: <Navigate to="/catalog" replace /> },
            ],
          },
          // Saved places (migration 391): everyone can look places up; adding
          // and changing them is for the roles locations' RLS lets write.
          { path: 'locations', element: <LocationsPage /> },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'project_manager', 'logistics_officer', 'operations_manager']} />,
            children: [
              { path: 'locations/new', element: <LocationFormPage /> },
              { path: 'locations/tidy', element: <LocationsTidyPage /> },
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
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'design']} />,
            children: [
              { path: 'design/new', element: <DesignPackageFormPage /> },
              { path: 'design/:id/edit', element: <DesignPackageFormPage /> },
            ],
          },
          // ── Business Development / Sales: read for everyone; write
          // gated to sales/admin/manager, matching contracts/opportunities RLS.
          { path: 'contracts', element: <ContractsPage /> },
          { path: 'opportunities', element: <OpportunitiesPage /> },
          { path: 'finance/fixed-assets', element: <FixedAssetsPage /> },
          {
            // Finance keeps the sales record (migration 330).
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'sales']} />,
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
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'hr_officer']} />,
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
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'hse_officer']} />,
            children: [
              { path: 'hse-incidents/new', element: <HseIncidentFormPage /> },
              { path: 'hse-incidents/:id/edit', element: <HseIncidentFormPage /> },
              { path: 'hse-inductions/new', element: <HseInductionFormPage /> },
              { path: 'hse-inductions/:id/edit', element: <HseInductionFormPage /> },
            ],
          },
          // ── Labour: ask → record → pay (375). Pages are open to anyone
          // signed in; what each person can see and do is decided in the
          // database (can_run_labour_site, approver roles, manages_project).
          { path: 'labour', element: <LabourHomePage /> },
          { path: 'labour/new', element: <LabourRequestFormPage /> },
          { path: 'labour/record', element: <LabourRecordPage /> },
          { path: 'labour/record/week', element: <LabourWeekPage /> },
          { path: 'labour/workers', element: <LabourWorkersPage /> },
          { path: 'labour/pay', element: <LabourPayPage /> },
          { path: 'labour/overtime', element: <LabourOvertimePage /> },
          { path: 'labour/requests', element: <LabourPayRequestsPage /> },
          { path: 'labour/requests/:id', element: <LabourPayRequestPage /> },
          { path: 'labour/:id', element: <LabourRequestPage /> },
          { path: 'labor-requisitions', element: <Navigate to="/labour" replace /> },
          { path: 'labor-requisitions/new', element: <Navigate to="/labour/new" replace /> },
          { path: 'labor-requisitions/:id', element: <LabourRedirect /> },
          { path: 'labor-requisitions/:id/edit', element: <LabourRedirect /> },
          {
            // Petty cash: floats/spend/replenishment management, matching
            // petty_cash_* RLS (admin/manager/finance/project_manager) —
            // see 121. A custodian's own float is separately reachable via
            // RLS row-scoping if a self-service view is added later.
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'project_manager', 'operations_manager']} />,
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
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'project_manager', 'procurement_officer', 'operations_manager']} />,
            children: [
              { path: 'subcontracts/new', element: <SubcontractFormPage /> },
              { path: 'subcontracts/:id/edit', element: <SubcontractFormPage /> },
            ],
          },
          // ── Work orders: read for everyone; write gated to
          // admin/manager/operations_manager/project_manager, matching
          // work_orders/work_order_labor/work_order_materials RLS (128).
          { path: 'work-orders', element: <WorkOrdersPage /> },
          { path: 'work-orders/:id', element: <WorkOrderDetailPage /> },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'operations_manager', 'project_manager']} />,
            children: [
              { path: 'work-orders/new', element: <WorkOrderFormPage /> },
              { path: 'work-orders/:id/edit', element: <WorkOrderFormPage /> },
            ],
          },
          // ── Roles with levels and a person's skills (457): read for
          // everyone; editing roles gated in-page to admin/operations
          // (job_descriptions/role_levels RLS); sign-offs and level changes
          // go through RPCs that check the department head / foreman rule.
          { path: 'roles', element: <RolesPage /> },
          { path: 'hr/competency-hub', element: <CompetencyHubPage /> },
          { path: 'roles/:id/print', element: <RolePrintPage /> },
          { path: 'staff/:id/skills', element: <PersonSkillsPage /> },
          { path: 'ffe-job-descriptions', element: <Navigate to="/roles" replace /> },
          { path: 'staff/:id/ffe-skills', element: <OldSkillsRedirect /> },
          // ── Role-based Operations & Construction views: each role lands
          // on its own composed view (default landing set in
          // LandingRedirect.tsx) instead of a generic department page.
          // admin/manager included for cross-departmental oversight,
          // matching the pattern used everywhere else in this router.
          {
            // allowAssignedProjectManager: PM access follows the
            // assignment, not only the role — a finance/design/whatever
            // user named on projects.project_manager_id reaches their
            // own My Projects view, which the role list alone would
            // never let them do (migration 155).
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'project_manager']} allowAssignedProjectManager />,
            children: [{ path: 'pm-view', element: <ProjectManagerViewPage /> }],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'operations_manager']} />,
            children: [{ path: 'ops-manager-view', element: <OperationsManagerViewPage /> }],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'stock_manager']} />,
            children: [{ path: 'stock-manager-view', element: <StockManagerViewPage /> }],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'logistics_officer']} allowLogisticsOfficer />,
            children: [{ path: 'logistics-view', element: <LogisticsOfficerViewPage /> }],
          },
          // ── Department landing pages: Design, Business Development/
          // Sales, HR & People, HSE (§1 second half — extends the same
          // pattern used for Operations & Construction above). Finance &
          // Admin's landing is the existing Payment Hub (finance/payments);
          // no new page needed there.
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'design']} />,
            children: [{ path: 'design-view', element: <DesignViewPage /> }],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'sales']} />,
            children: [{ path: 'sales-view', element: <BdSalesViewPage /> }],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'hr_officer']} />,
            children: [{ path: 'hr-view', element: <HrPeopleViewPage /> }],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'hse_officer']} />,
            children: [{ path: 'hse-view', element: <HseViewPage /> }],
          },
          // ── Company Overview: cross-departmental executive snapshot —
          // restricted to admin/operations_manager (§0.4, §2). Previously
          // had NO guard at all; any authenticated role could reach it.
          {
            element: <ProtectedRoute allowedRoles={['admin', 'operations_manager']} />,
            children: [{ path: 'overview', element: <OverviewDashboardPage /> }],
          },
          // ── Executive dashboard: read-only situational-awareness page
          // for the CEO — traffic-light per-project cards plus six primary
          // finance/ops gadgets, all served from materialized views. Also
          // gated at the MV layer (mv_project_exec_summary is exec/admin
          // only via role-check RPC in migration 194).
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive']} />,
            children: [{ path: 'exec', element: <ExecDashboardPage /> }],
          },
          // Workshop view: dynamic-access rule (§0.2) only governs the
          // default LANDING page; per confirmed decision, read access
          // here is broader — any Operations & Construction role can
          // open it for oversight, not just a live assigned lead.
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'operations_manager', 'project_manager', 'stock_manager', 'logistics_officer']} allowLogisticsOfficer />,
            children: [{ path: 'workshop-view', element: <WorkshopViewPage /> }],
          },
          // ── Properties & Rent: read matches properties RLS
          // (admin/manager/finance/operations_manager); write (new/edit)
          // further restricted to admin/operations_manager per 135.
          {
            element: <ProtectedRoute allowedRoles={['admin', 'executive', 'finance', 'operations_manager']} />,
            children: [{ path: 'rent', element: <RentPage /> }],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'operations_manager']} />,
            children: [
              { path: 'rent/new', element: <PropertyFormPage /> },
              { path: 'rent/:id/edit', element: <PropertyFormPage /> },
            ],
          },
        ],
      },
    ],
  },
])
