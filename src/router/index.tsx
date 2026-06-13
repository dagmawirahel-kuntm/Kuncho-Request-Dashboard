import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { AppShell } from '@/components/layout/AppShell'
import LoginPage from '@/pages/auth/LoginPage'
import DashboardPage from '@/pages/dashboard/DashboardPage'
import ExpensesPage from '@/pages/expenses/ExpensesPage'
import OrdersPage from '@/pages/orders/OrdersPage'
import TransportationPage from '@/pages/transportation/TransportationPage'
import StaffPage from '@/pages/staff/StaffPage'
import PayrollPage from '@/pages/payroll/PayrollPage'
import VendorsPage from '@/pages/vendors/VendorsPage'
import ProjectsPage from '@/pages/projects/ProjectsPage'
import AccountsPage from '@/pages/accounts/AccountsPage'
import SalesPage from '@/pages/sales/SalesPage'
import CategoriesPage from '@/pages/categories/CategoriesPage'
import PurchaseAllocationPage from '@/pages/purchase-allocation/PurchaseAllocationPage'
import TimesheetPage from '@/pages/timesheet/TimesheetPage'
import CashAdvancesPage from '@/pages/cash-advances/CashAdvancesPage'
import TaxSummaryPage from '@/pages/tax-summary/TaxSummaryPage'
import BatchPaymentsPage from '@/pages/batch-payments/BatchPaymentsPage'
import CpoBondsPage from '@/pages/cpo-bonds/CpoBondsPage'
import ProductsPage from '@/pages/products/ProductsPage'
import PayrollTaxesPage from '@/pages/payroll-taxes/PayrollTaxesPage'
import EmergencyPayrollPage from '@/pages/emergency-payroll/EmergencyPayrollPage'
import VendorReceiptsPage from '@/pages/vendor-receipts/VendorReceiptsPage'
import LocationsPage from '@/pages/locations/LocationsPage'

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
          { path: 'expenses', element: <ExpensesPage /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'transportation', element: <TransportationPage /> },
          { path: 'purchase-allocation', element: <PurchaseAllocationPage /> },
          { path: 'vendors', element: <VendorsPage /> },
          { path: 'categories', element: <CategoriesPage /> },
          { path: 'vendor-receipts', element: <VendorReceiptsPage /> },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance']} />,
            children: [
              { path: 'accounts', element: <AccountsPage /> },
              { path: 'sales', element: <SalesPage /> },
              { path: 'tax-summary', element: <TaxSummaryPage /> },
              { path: 'batch-payments', element: <BatchPaymentsPage /> },
              { path: 'cpo-bonds', element: <CpoBondsPage /> },
              { path: 'transfers', element: <AccountsPage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance']} />,
            children: [
              { path: 'staff', element: <StaffPage /> },
              { path: 'payroll', element: <PayrollPage /> },
              { path: 'payroll-taxes', element: <PayrollTaxesPage /> },
              { path: 'emergency-payroll', element: <EmergencyPayrollPage /> },
              { path: 'cash-advances', element: <CashAdvancesPage /> },
              { path: 'timesheet', element: <TimesheetPage /> },
            ],
          },
          {
            element: <ProtectedRoute allowedRoles={['admin', 'manager', 'finance']} />,
            children: [
              { path: 'projects', element: <ProjectsPage /> },
              { path: 'products', element: <ProductsPage /> },
              { path: 'locations', element: <LocationsPage /> },
            ],
          },
        ],
      },
    ],
  },
])
