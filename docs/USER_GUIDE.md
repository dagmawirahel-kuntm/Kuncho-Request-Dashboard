# Kuncho Operations Dashboard — User Guide

One page per role. Find your role below; it covers your landing page, your
daily tasks, and who to go to when something needs approval.

**Logging in:** open the dashboard link, enter your company email and the
password you were given. If you see "Invalid login credentials," check the
email spelling; if you're still stuck, contact your admin — they can reset
you from **Admin → Users & Roles**.

---

## Staff

**Your landing page** is your personal home: your pay overview, your open
requests, and quick actions. The **My Profile** button shows your full
employment record — salary, bank account, payroll history, cash advances,
and timesheets.

**Daily tasks**

| I want to… | Do this |
|---|---|
| Get money spent for work reimbursed | **+ New Expense** → describe the item, amount, date → Save. It goes to your manager for approval. |
| Request transportation | **+ Transportation Request** → fill route and reason → Save |
| Log my attendance | **+ Timesheet Entry** → date, check-in/out times |
| Check if my expense was approved | Open **Approvals** in the sidebar — the badge shows Pending / Manager Approved / Finance Approved / Rejected |
| See my salary and payment history | **My Profile** → Payroll / Cash Advances tabs |

**Good to know:** you only see your own records — other people's expenses
and requests are invisible to you. If a request is **Rejected**, the reason
appears on it; fix the issue and ask your manager to resubmit.

---

## Manager

**Your landing page** is the main dashboard with pending counts across the
company.

**Your key responsibility: first-step approvals.** Expenses, purchase
requests, payroll runs, cash advances, and sales all wait on you before
finance can settle them.

| I want to… | Do this |
|---|---|
| Approve/reject an expense | Open **Approvals** → click the expense → **Approve** or **Reject** (top-right buttons). Rejections require a reason. |
| Approve a payroll run | **HR → Payroll** → open the run → Approve. Finance gives the final approval after you. |
| Approve a cash advance | **HR → Cash Advances** → open → Approve |
| Approve a sale record | **Finance → Sales** → open the sale → Approve |
| See a staff member's full record | **HR → Staff** → click the name |

**Good to know:** your approval is step 1 of 2 — money only moves after
finance's final approval. You can't approve step 2 yourself (separation of
duties).

---

## Finance

**Your landing page** is the main dashboard; your workspaces are the
**Finance** and **Reports** sections.

**Your key responsibility: final approvals and settlement.** Nothing gets
paid without you.

| I want to… | Do this |
|---|---|
| Give final approval on an expense | Open it from **Approvals** → **Approve** (only available after manager approval) |
| Pay an expense | Open the expense → set payment status to paid, pick the account, add the bank reference |
| Record a sale / issue an invoice | **Finance → Clients** → open client → **Proforma Invoice** → build it → **Save Proforma** → **Convert to Invoice** when accepted |
| Chase unpaid invoices | **Finance → Invoices** — grouped by client, aged, with Send Invoice / Mark Paid buttons |
| Run payroll payment | **HR → Payroll** → open a finance-approved run → set status to **Paid**. The account balance updates automatically. |
| Check company profit | **Reports → P&L Report** — real-time, by month, with expense categories |
| Check account balances | **Finance → Accounts** — balances include sales in, expenses/advances/payroll out, transfers |

**Good to know:** a payroll run can't be marked Paid until you've given it
final approval — the dropdown stays locked. Marking an invoice Paid stamps
the payment date automatically.

---

## HR Officer

**Your landing page** is the HR dashboard.

| I want to… | Do this |
|---|---|
| Add a new employee | **HR → Staff → Add Staff** — fill name, department, role, salary, bank, and **email** (their email is what links their login to their profile) |
| Give an employee app access | Ask an admin to create their login in **Admin → Users & Roles** with the same email as their staff record |
| Run monthly payroll | **HR → Payroll → Add Payroll** → pick period → select employees → the amounts grid pre-fills each salary; adjust deductions → Save. Then it needs manager approval + finance approval before finance can pay it. |
| Record a cash advance | **HR → Cash Advances → Add Record** — needs the same two approvals |
| Record payroll taxes | **HR → Payroll Taxes → Add Record** |
| View/maintain employee records | **HR → Staff** → click a name for the full profile |

**Good to know:** when an employee leaves, edit their staff record — set
Status to **Terminated** and fill the termination date. Don't delete staff
records; history (payroll, advances) hangs off them.

---

## Procurement Officer

**Your landing page** is the Procurement dashboard.

| I want to… | Do this |
|---|---|
| See purchase requests to source | **Requests → Purchase Requests** (you can view, not create) |
| Bundle items for a vendor order | **Procurement → Sourcing Bundles → New** → pick items → submit for approval |
| Maintain vendors | **Procurement → Vendors** — profiles, documents, contracts, receipts |
| Manage stock intake | **Stock → Stock Catalog** |

---

## Project Manager

**Your landing page** is the Management dashboard.

| I want to… | Do this |
|---|---|
| Maintain projects | **Management → Projects** |
| Create purchase requests for a project | **Requests → Purchase Requests → New** |
| Track products, locations, CPO bonds | **Management** section |

---

## Stock Manager

| I want to… | Do this |
|---|---|
| Receive stock | **Stock → Stock Catalog** → item → record receipt |
| Issue stock to a project | **Stock → Movement** |
| Track tools | **Stock → Tools** — checkouts, condition, returns |

---

## Admin

You can do everything above, plus:

| I want to… | Do this |
|---|---|
| Create a login for someone | **Admin → Users & Roles → Add User** — name, email, temporary password, role. They can sign in immediately. |
| Change someone's role | Same page — pick the new role in their row |
| Fix a stuck approval | You can act as both manager and finance in any approval chain |

**Cautions:** don't demote your own account (the page blocks it — keep it
that way). When testing, use a separate test login per role rather than
changing your own; admin bypasses every permission rule, so testing as
admin proves nothing.

---

## The approval chain (everyone)

Money-touching records — expenses, purchase requests, sales, payroll runs,
cash advances — all follow the same two-step chain:

**Submitted (Pending) → Manager approves → Finance approves → Paid/Settled**

- A rejection at either step must include a reason, visible on the record.
- Rejected records can be fixed and resubmitted; the chain restarts.
- Only finance can settle (pay) anything, and only after both approvals.
