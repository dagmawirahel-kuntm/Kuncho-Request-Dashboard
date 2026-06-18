import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { AppShell } from '@/components/layout/AppShell'
import LoginPage from '@/pages/auth/LoginPage'
import DashboardPage from '@/pages/dashboard/DashboardPage'
import RequestsDashboardPage from '@/pages/dashboard/RequestsDashboardPage'
import ProcurementDashboardPage from '@/pages/dashboard/ProcurementDashboardPage'
import FinanceDashboardPage from '@/pages/dashboard/FinanceDashboardPage'
import HRDashboardPage from '@/pages/dashboard/HRDashboardPage'
import ManagementDashboardPage from '@/pages/dashboard/ManagementDashboardPage'
import ExpensesPage from '@/pages/expenses/ExpensesPage'
import ExpenseFormPage from '@/pages/expenses/ExpenseFormPage'
import OrdersPage from '@/pages/orders/OrdersPage'
import OrderFormPage from '@/pages/orders/OrderFormPage'
import TransportationPage from '@/pages/transportation/TransportationPage'
import TransportFormPage from '@/pages/transportation/TransportFormPage'
import StaffPage from '@/pages/staff/StaffPage'
import StaffFormPage from '@/pages/staff/StaffFormPage'
import PayrollPage from '@/pages/payroll/PayrollPage'
import PayrollFormPage from '@/pages/payroll/PayrollFormPage'
import VendorsPage from '@/pages/vendors/VendorsPage'
import VendorFormPage from '@/pages/vendors/VendorFormPage'
import ProjectsPage from '@/pages/projects/ProjectsPage'
import ProjectFormPage from '@/pages/projects/ProjectFormPage'
import AccountsPage from '@/pages/accounts/AccountsPage'
import AccountFormPage from '@/pages/accounts/AccountFormPage'
import SalesPage from '@/pages/sales/SalesPage'
import SaleFormPage from '@/pages/sales/SaleFormPage'
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
import LocationsPage from '@/pages/locations/LocationsPage'
import LocationFormPage from '@/pages/locations/LocationFormPage'
import OverviewDashboardPage from '@/pages/dashboard/OverviewDashboardPage'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'overview', element: <OverviewDashboardPage /> },
          { path: 'requests', element: <RequestsDashboardPage /> },
          { path: 'expenses', element: <ExpensesPage /> },
          { path: 'expenses/new', element: <ExpenseFormPage /> },
          { path: 'expenses/:id/edit', element: <ExpenseFormPage /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'orders/new', element: <OrderFormPage /> },
          { path: 'orders/:id/edit', element: <OrderFormPage /> },
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
              { path: 'vendors/:id/edit', element: <VendorFormPage /> },
              { path: 'categories', element: <Navigate to="/general-ledger" replace /> },
              { path: 'general-ledger', element: <GeneralLedgerDashboardPage /> },
              { path: 'general-ledger/new', element: <GeneralLedgerFormPage /> },
              { path: 'general-ledger/:id/edit', element: <GeneralLedgerFormPage /> },
              { path: 'general-ledger/sub-ledgers/new', element: <SubLedgerFormPage /> },
              { path: 'general-ledger/sub-ledgers/:id/edit', element: <SubLedgerFormPage /> },
              { path: 'vendor-receipts', element: <VendorReceiptsPage /> },
              { path: 'vendor-receipts/new', element: <VendorReceiptFormPage /> },
              { path: 'vendor-receipts/:id/edit', element: <VendorReceiptFormPage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance']} />,
            children: [
              { path: 'finance', element: <FinanceDashboardPage /> },
              { path: 'accounts', element: <AccountsPage /> },
              { path: 'accounts/new', element: <AccountFormPage /> },
              { path: 'accounts/:id/edit', element: <AccountFormPage /> },
              { path: 'sales', element: <SalesPage /> },
              { path: 'sales/new', element: <SaleFormPage /> },
              { path: 'sales/:id/edit', element: <SaleFormPage /> },
              { path: 'tax-summary', element: <TaxSummaryPage /> },
              { path: 'tax-summary/new', element: <TaxSummaryFormPage /> },
              { path: 'tax-summary/:id/edit', element: <TaxSummaryFormPage /> },
              { path: 'batch-payments', element: <BatchPaymentsPage /> },
              { path: 'batch-payments/new', element: <BatchPaymentFormPage /> },
              { path: 'batch-payments/:id/edit', element: <BatchPaymentFormPage /> },
              { path: 'cpo-bonds', element: <CpoBondsPage /> },
              { path: 'cpo-bonds/new', element: <CpoBondFormPage /> },
              { path: 'cpo-bonds/:id/edit', element: <CpoBondFormPage /> },
              { path: 'transfers', element: <AccountsPage /> },
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
