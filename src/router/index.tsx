import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { AppShell } from '@/components/layout/AppShell'
import LoginPage from '@/pages/auth/LoginPage'
import SignupPage from '@/pages/auth/SignupPage'
import UpdatePasswordPage from '@/pages/auth/UpdatePasswordPage'
import DashboardPage from '@/pages/dashboard/DashboardPage'
import MyRequestsDashboardPage from '@/pages/dashboard/MyRequestsDashboardPage'
import RequestsDashboardPage from '@/pages/dashboard/RequestsDashboardPage'
import ProcurementDashboardPage from '@/pages/dashboard/ProcurementDashboardPage'
import FinanceDashboardPage from '@/pages/dashboard/FinanceDashboardPage'
import HRDashboardPage from '@/pages/dashboard/HRDashboardPage'
import ManagementDashboardPage from '@/pages/dashboard/ManagementDashboardPage'
import ExpensesPage from '@/pages/expenses/ExpensesPage'
import ExpenseFormPage from '@/pages/expenses/ExpenseFormPage'
import ExpenseDetailPage from '@/pages/expenses/ExpenseDetailPage'
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
import AccountsPage from '@/pages/accounts/AccountsPage'
import AccountFormPage from '@/pages/accounts/AccountFormPage'
import AccountDetailPage from '@/pages/accounts/AccountDetailPage'
import TransfersPage from '@/pages/transfers/TransfersPage'
import TransferFormPage from '@/pages/transfers/TransferFormPage'
import PLReportPage from '@/pages/reports/PLReportPage'
import BalanceSheetPage from '@/pages/reports/BalanceSheetPage'
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
import SourcingBundlesPage from '@/pages/sourcing/SourcingBundlesPage'
import SourcingBundleFormPage from '@/pages/sourcing/SourcingBundleFormPage'
import PurchaseOrderPage from '@/pages/sourcing/PurchaseOrderPage'

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
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'my-home', element: <MyRequestsDashboardPage /> },
          { path: 'overview', element: <OverviewDashboardPage /> },
          { path: 'requests', element: <RequestsDashboardPage /> },
          { path: 'expenses', element: <ExpensesPage /> },
          { path: 'expenses/new', element: <ExpenseFormPage /> },
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
              { path: 'stock/tools', element: <StockToolsPage /> },
              { path: 'stock/movement/new', element: <StockMovementPage /> },
              { path: 'stock/:id', element: <StockItemDetailPage /> },
              { path: 'stock/:id/edit', element: <StockItemFormPage /> },
            ],
          },
          { path: 'transportation', element: <TransportationPage /> },
          { path: 'transportation/new', element: <TransportFormPage /> },
          { path: 'transportation/:id/edit', element: <TransportFormPage /> },
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
              { path: 'sourcing/:id', element: <PurchaseOrderPage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance']} />,
            children: [
              { path: 'finance', element: <FinanceDashboardPage /> },
              { path: 'accounts', element: <AccountsPage /> },
              { path: 'accounts/new', element: <AccountFormPage /> },
              { path: 'accounts/:id', element: <AccountDetailPage /> },
              { path: 'accounts/:id/edit', element: <AccountFormPage /> },
              { path: 'transfers', element: <TransfersPage /> },
              { path: 'transfers/new', element: <TransferFormPage /> },
              { path: 'transfers/:id/edit', element: <TransferFormPage /> },
              { path: 'sales', element: <SalesPage /> },
              { path: 'sales/new', element: <SaleFormPage /> },
              { path: 'sales/:id', element: <SaleDetailPage /> },
              { path: 'sales/:id/edit', element: <SaleFormPage /> },
              { path: 'proformas', element: <ProformasPage /> },
              { path: 'clients', element: <ClientsPage /> },
              { path: 'clients/new', element: <ClientFormPage /> },
              { path: 'clients/:id', element: <ClientDetailPage /> },
              { path: 'clients/:id/edit', element: <ClientFormPage /> },
              { path: 'clients/:id/proforma', element: <ProformaInvoicePage /> },
              { path: 'clients/:id/payment-request', element: <PaymentRequestPage /> },
              { path: 'tax-summary', element: <TaxSummaryPage /> },
              { path: 'tax-summary/new', element: <TaxSummaryFormPage /> },
              { path: 'tax-summary/:id/edit', element: <TaxSummaryFormPage /> },
              { path: 'batch-payments', element: <BatchPaymentsPage /> },
              { path: 'batch-payments/new', element: <BatchPaymentFormPage /> },
              { path: 'batch-payments/:id/edit', element: <BatchPaymentFormPage /> },
              { path: 'invoices', element: <InvoicesPage /> },
              { path: 'vendor-receipts', element: <VendorReceiptsPage /> },
              { path: 'vendor-receipts/new', element: <VendorReceiptFormPage /> },
              { path: 'vendor-receipts/:id', element: <VendorReceiptDetailPage /> },
              { path: 'vendor-receipts/:id/edit', element: <VendorReceiptFormPage /> },
              { path: 'reports/pl', element: <PLReportPage /> },
              { path: 'reports/balance-sheet', element: <BalanceSheetPage /> },
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
              { path: 'cpo-bonds', element: <CpoBondsPage /> },
              { path: 'cpo-bonds/new', element: <CpoBondFormPage /> },
              { path: 'cpo-bonds/:id/edit', element: <CpoBondFormPage /> },
              { path: 'products', element: <ProductsPage /> },
              { path: 'products/new', element: <ProductFormPage /> },
              { path: 'products/:id/edit', element: <ProductFormPage /> },
              { path: 'locations', element: <LocationsPage /> },
              { path: 'locations/new', element: <LocationFormPage /> },
              { path: 'locations/:id/edit', element: <LocationFormPage /> },
            ],
          },
        ],
      },
    ],
  },
])
