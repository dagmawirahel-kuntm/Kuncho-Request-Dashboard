# Kuncho Request Dashboard

A full-stack operations dashboard built from the **KUNCH_10** Airtable base.

## Stack

- **Frontend:** React 18 + Vite + Tailwind CSS v4
- **Routing:** React Router v6
- **Data Fetching:** TanStack Query v5
- **Forms:** React Hook Form + Zod
- **Backend/DB:** Supabase (PostgreSQL + Auth)
- **Auth:** Role-based (admin / manager / finance / staff)

## Modules (25 tables)

| Domain | Modules |
|--------|---------|
| Requests | Expenses, Orders, Transportation Requests, Purchase Allocation |
| Procurement | Vendors, Categories, Vendor Receipt Facilitation |
| Finance | Accounts, Sales, Tax Summary, Batch Payments, CPO Bonds |
| HR | Staff, Payroll, Payroll Taxes, Emergency Payroll, Cash Advances, Timesheet |
| Management | Projects, Products, Locations |

## Getting Started

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com) and create a new project.

### 2. Run the migration

Paste `supabase/migrations/001_initial_schema.sql` into the Supabase SQL editor and run it.

### 3. Configure environment variables

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 4. Install and run

```bash
npm install
npm run dev
```

App runs at `http://localhost:5173`.

## Role Permissions

| Role | Access |
|------|--------|
| `admin` | Full access to all modules |
| `manager` | Read all + write requests, orders, projects, payroll |
| `finance` | Read all + write accounts, transfers, tax, payroll, batch payments |
| `staff` | Own expenses, own transportation requests, own timesheet |
