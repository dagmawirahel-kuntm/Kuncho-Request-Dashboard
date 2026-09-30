-- 380 — A chart of accounts with a shape
--
-- The chart was two levels: five headings and 117 accounts, 60-odd of them
-- material names under one "Expense" heading. Nothing separated what a
-- project cost from what the office cost, some balance-sheet things were
-- filed as expenses (Salary Advances, Loan, Personal withdraws), some
-- materials as assets (Aluminum, Steel, Building Materials), and there was
-- nowhere to put VAT, wages owed, depreciation or opening equity.
--
-- ── The new shape ────────────────────────────────────────────────────────────
--
--   1000 Assets            1100 Cash and bank · 1200 Receivables ·
--                          1300 Advances and deposits · 1400 Tax assets ·
--                          1500 Inventory · 1600 Fixed assets
--   2000 Liabilities       2100 Payables · 2200 Taxes payable · 2300 Borrowings
--   3000 Equity
--   4000 Revenue
--   5000 Cost of projects  5100 Materials · 5200 Labour · 5300 Subcontract and
--                          hire · 5400 Transport · 5900 Other project costs
--   6000 Operating expenses 6100 Staff · 6200 Premises and office ·
--                          6300 Finance, tax and government · 6400 Selling and general
--
-- Every account keeps its id, so every journal line already posted stays
-- where it is; only codes, names, headings and natures move. The accounts
-- the database looks up by code keep their codes (1050, 1080, 1085, 1090,
-- 11000, 2010-2030, 3010, 3020, 4010, 4020); the five that move (5010,
-- 51026, 51037, 51057, 51065) are rewritten in the three functions that
-- name them. New code finds accounts by system_key through coa_id().
--
-- Materials are costed to projects when bought (periodic inventory): a
-- year-end stock count moves what is left on the shelf to 1510.
--
-- Control accounts (party_kinds) hold one balance per vendor, client or
-- staff member — their sub-ledgers (381).
--
-- Categories — the "General Ledger" list people pick on an expense — keep
-- their one account each; the account now sits under a ledger group, and
-- a new category gets its account there straight away (it used to get
-- none, and could not post: Jotun Paints, Structural Adhesive, Salary).

SET search_path TO public;

ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS system_key  text,
  ADD COLUMN IF NOT EXISTS party_kinds text[],
  ADD COLUMN IF NOT EXISTS description text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_coa_system_key ON chart_of_accounts (system_key) WHERE system_key IS NOT NULL;
ALTER TABLE chart_of_accounts DROP CONSTRAINT IF EXISTS coa_party_kinds_chk;
ALTER TABLE chart_of_accounts ADD CONSTRAINT coa_party_kinds_chk
  CHECK (party_kinds IS NULL OR (cardinality(party_kinds) > 0 AND party_kinds <@ ARRAY['vendor', 'client', 'staff']));
COMMENT ON COLUMN chart_of_accounts.system_key IS 'Stable name the database finds this account by (coa_id()), whatever its code.';
COMMENT ON COLUMN chart_of_accounts.party_kinds IS 'A control account: every line names who it is for (vendor, client or staff) — its sub-ledger.';

CREATE OR REPLACE FUNCTION public.coa_id(p_key text)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT id FROM chart_of_accounts WHERE system_key = p_key
$$;

-- ── 1. Headings ──────────────────────────────────────────────────────────────
INSERT INTO chart_of_accounts (account_code, account_name, nature, is_postable, active)
SELECT v.code, v.name, v.nature, false, true
FROM (VALUES
  ('1100', 'Cash and bank', 'Asset'), ('1200', 'Receivables', 'Asset'), ('1300', 'Advances and deposits', 'Asset'),
  ('1400', 'Tax assets', 'Asset'), ('1500', 'Inventory', 'Asset'), ('1600', 'Fixed assets', 'Asset'),
  ('2100', 'Payables', 'Liability'), ('2200', 'Taxes payable', 'Liability'), ('2300', 'Borrowings', 'Liability'),
  ('5100', 'Materials', 'Expense'), ('5200', 'Labour', 'Expense'), ('5300', 'Subcontract and hire', 'Expense'),
  ('5400', 'Transport', 'Expense'), ('5900', 'Other project costs', 'Expense'),
  ('6000', 'Operating expenses', 'Expense'), ('6100', 'Staff', 'Expense'), ('6200', 'Premises and office', 'Expense'),
  ('6300', 'Finance, tax and government', 'Expense'), ('6400', 'Selling and general', 'Expense')
) AS v(code, name, nature)
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.account_code = v.code);
UPDATE chart_of_accounts SET account_name = 'Cost of projects' WHERE account_code = '5000';

-- ── 2. New accounts ──────────────────────────────────────────────────────────
INSERT INTO chart_of_accounts (account_code, account_name, nature, is_postable, active, cash_flow_section)
SELECT v.code, v.name, v.nature, true, true, v.cfs
FROM (VALUES
  ('1150', 'Petty cash floats', 'Asset', 'cash'),
  ('1220', 'Other receivables', 'Asset', 'operating'),
  ('1410', 'Input VAT', 'Asset', 'operating'),
  ('1510', 'Workshop stock', 'Asset', 'operating'),
  ('1690', 'Accumulated depreciation', 'Asset', 'investing'),
  ('2015', 'Wages payable', 'Liability', 'operating'),
  ('2040', 'VAT payable', 'Liability', 'operating'),
  ('2050', 'Client advances', 'Liability', 'operating'),
  ('3090', 'Opening balance equity', 'Equity', 'financing'),
  ('5115', 'Jotun Paints', 'Expense', 'operating'),
  ('5130', 'Structural Adhesive', 'Expense', 'operating'),
  ('6900', 'Depreciation', 'Expense', 'operating')
) AS v(code, name, nature, cfs)
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.account_code = v.code);

-- ── 3. Every account: code, name, heading, nature, flow, key, party ─────────
CREATE TEMP TABLE coa_plan (
  old_code text, new_code text, name text, nature text, parent text, cfs text, skey text, parties text[]
) ON COMMIT DROP;
INSERT INTO coa_plan VALUES
  -- Cash and bank
  ('11000', '11000', NULL, 'Asset', '1100', 'cash', 'cash_on_hand', NULL),
  ('1150',  '1150',  NULL, 'Asset', '1100', 'cash', 'petty_cash', ARRAY['staff']),
  -- Receivables
  ('1050',  '1050',  'Accounts receivable', 'Asset', '1200', 'operating', 'ar', ARRAY['client']),
  ('1090',  '1090',  'Withholding tax receivable', 'Asset', '1200', 'operating', 'wht_receivable', NULL),
  ('51046', '1210',  'Staff advances', 'Asset', '1200', 'operating', 'staff_advances', ARRAY['staff']),
  ('1220',  '1220',  NULL, 'Asset', '1200', 'operating', 'other_receivables', NULL),
  -- Advances and deposits
  ('1080',  '1080',  'Vendor advances', 'Asset', '1300', 'operating', 'vendor_advances', ARRAY['vendor']),
  ('1085',  '1085',  'VRF funds in transit', 'Asset', '1300', 'operating', 'vrf_in_transit', NULL),
  ('12002', '1310',  'Bonds and deposits', 'Asset', '1300', 'operating', 'bonds', NULL),
  ('51005', '1320',  'CPO and bid bonds', 'Asset', '1300', 'operating', NULL, NULL),
  -- Tax, stock, fixed assets
  ('1410',  '1410',  NULL, 'Asset', '1400', 'operating', 'input_vat', NULL),
  ('1510',  '1510',  NULL, 'Asset', '1500', 'operating', 'stock', NULL),
  ('12004', '1610',  'Property, plant and equipment', 'Asset', '1600', 'investing', 'ppe', NULL),
  ('1690',  '1690',  NULL, 'Asset', '1600', 'investing', 'acc_depreciation', NULL),
  -- Liabilities
  ('2010',  '2010',  'Accounts payable', 'Liability', '2100', 'operating', 'ap', ARRAY['vendor', 'staff']),
  ('2015',  '2015',  NULL, 'Liability', '2100', 'operating', 'wages_payable', ARRAY['staff', 'vendor']),
  ('2050',  '2050',  NULL, 'Liability', '2100', 'operating', 'client_advances', ARRAY['client']),
  ('2020',  '2020',  'Payroll taxes payable', 'Liability', '2200', 'operating', 'payroll_taxes', NULL),
  ('2025',  '2025',  'Withholding tax payable', 'Liability', '2200', 'operating', 'wht_payable', NULL),
  ('2040',  '2040',  NULL, 'Liability', '2200', 'operating', 'vat_payable', NULL),
  ('2030',  '2030',  'Loans payable', 'Liability', '2300', 'financing', 'loans', NULL),
  ('51022', '2031',  'Other loans', 'Liability', '2300', 'financing', NULL, NULL),
  -- Equity
  ('3010',  '3010',  NULL, 'Equity', '3000', 'financing', 'retained_earnings', NULL),
  ('3020',  '3020',  NULL, 'Equity', '3000', 'financing', 'owner_contributions', NULL),
  ('51037', '3030',  'Owner drawings', 'Equity', '3000', 'financing', 'owner_drawings', NULL),
  ('3090',  '3090',  NULL, 'Equity', '3000', 'financing', 'opening_equity', NULL),
  -- Revenue
  ('4010',  '4010',  NULL, 'Revenue', '4000', 'operating', 'sales', NULL),
  ('4020',  '4020',  NULL, 'Revenue', '4000', 'operating', 'other_income', NULL),
  -- Materials
  ('12001', '5101', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('12003', '5102', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51001', '5103', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51002', '5104', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51003', '5105', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51061', '5106', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51004', '5107', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51006', '5108', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51007', '5109', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51062', '5110', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51011', '5111', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51014', '5112', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51016', '5113', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51017', '5114', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('5115',  '5115', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51021', '5116', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51063', '5117', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51025', '5118', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51029', '5119', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51035', '5120', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51039', '5121', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51042', '5122', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51043', '5123', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51045', '5124', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51047', '5125', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51048', '5126', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51049', '5127', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51064', '5128', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51050', '5129', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('5130',  '5130', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51052', '5131', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51055', '5132', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51056', '5133', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51058', '5134', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51060', '5135', NULL, 'Expense', '5100', 'operating', NULL, NULL),
  ('51019', '5138', 'Stock items used', 'Expense', '5100', 'operating', NULL, NULL),
  ('51028', '5139', 'Mixed materials (Multiple)', 'Expense', '5100', 'operating', 'mixed_materials', NULL),
  -- Labour, subcontract, transport, other project costs
  ('51020', '5201', NULL, 'Expense', '5200', 'operating', 'labour', NULL),
  ('51051', '5301', 'Subcontractors', 'Expense', '5300', 'operating', NULL, NULL),
  ('51034', '5302', NULL, 'Expense', '5300', 'operating', NULL, NULL),
  ('51040', '5303', NULL, 'Expense', '5300', 'operating', NULL, NULL),
  ('51009', '5304', NULL, 'Expense', '5300', 'operating', NULL, NULL),
  ('51023', '5305', NULL, 'Expense', '5300', 'operating', NULL, NULL),
  ('51054', '5401', NULL, 'Expense', '5400', 'operating', NULL, NULL),
  ('51012', '5402', NULL, 'Expense', '5400', 'operating', NULL, NULL),
  ('51027', '5901', NULL, 'Expense', '5900', 'operating', NULL, NULL),
  ('51026', '5902', NULL, 'Expense', '5900', 'operating', 'misc_project', NULL),
  ('51010', '5903', NULL, 'Expense', '5900', 'operating', NULL, NULL),
  -- Operating expenses
  ('5010',  '6101', NULL, 'Expense', '6100', 'operating', 'salaries', NULL),
  ('51041', '6201', NULL, 'Expense', '6200', 'operating', NULL, NULL),
  ('51033', '6202', NULL, 'Expense', '6200', 'operating', NULL, NULL),
  ('51030', '6203', NULL, 'Expense', '6200', 'operating', NULL, NULL),
  ('51031', '6204', NULL, 'Expense', '6200', 'operating', NULL, NULL),
  ('51032', '6205', NULL, 'Expense', '6200', 'operating', NULL, NULL),
  ('51059', '6206', NULL, 'Expense', '6200', 'operating', NULL, NULL),
  ('51053', '6207', NULL, 'Expense', '6200', 'operating', NULL, NULL),
  ('51038', '6208', 'Petty cash expenses', 'Expense', '6200', 'operating', 'petty_cash_expense', NULL),
  ('51065', '6301', NULL, 'Expense', '6300', 'operating', 'bank_charges', NULL),
  ('51015', '6302', NULL, 'Expense', '6300', 'operating', NULL, NULL),
  ('51036', '6303', NULL, 'Expense', '6300', 'operating', NULL, NULL),
  ('51018', '6304', 'Insurance', 'Expense', '6300', 'operating', NULL, NULL),
  ('51013', '6305', NULL, 'Expense', '6300', 'operating', NULL, NULL),
  ('51057', '6306', NULL, 'Expense', '6300', 'operating', 'vrf_commission', NULL),
  ('51024', '6401', NULL, 'Expense', '6400', 'operating', NULL, NULL),
  ('51008', '6402', NULL, 'Expense', '6400', 'operating', NULL, NULL),
  ('51044', '6403', NULL, 'Expense', '6400', 'operating', NULL, NULL),
  ('6900',  '6900', NULL, 'Expense', '6000', 'operating', 'depreciation', NULL);

-- Every postable account and heading is in the plan, and nothing is planned twice.
DO $$
DECLARE v_missing text; v_dupes text;
BEGIN
  SELECT string_agg(account_code || ' ' || account_name, ', ') INTO v_missing
  FROM chart_of_accounts c
  WHERE c.is_postable AND c.linked_account_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM coa_plan p WHERE p.old_code = c.account_code);
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'Accounts with no place in the new chart: %', v_missing; END IF;
  SELECT string_agg(new_code, ', ') INTO v_dupes FROM (SELECT new_code FROM coa_plan GROUP BY 1 HAVING count(*) > 1) d;
  IF v_dupes IS NOT NULL THEN RAISE EXCEPTION 'Planned twice: %', v_dupes; END IF;
END $$;

-- Bank accounts sit under Cash and bank as they are.
UPDATE chart_of_accounts c
   SET parent_account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1100'), cash_flow_section = 'cash'
 WHERE c.linked_account_id IS NOT NULL;

UPDATE chart_of_accounts c
   SET account_code      = p.new_code,
       account_name      = COALESCE(p.name, c.account_name),
       nature            = p.nature,
       parent_account_id = (SELECT id FROM chart_of_accounts h WHERE h.account_code = p.parent),
       cash_flow_section = p.cfs,
       system_key        = p.skey,
       party_kinds       = p.parties,
       is_postable       = true
  FROM coa_plan p
 WHERE c.account_code = p.old_code;

-- Headings under headings.
UPDATE chart_of_accounts c SET parent_account_id = (SELECT id FROM chart_of_accounts WHERE account_code = v.parent)
FROM (VALUES
  ('1100', '1000'), ('1200', '1000'), ('1300', '1000'), ('1400', '1000'), ('1500', '1000'), ('1600', '1000'),
  ('2100', '2000'), ('2200', '2000'), ('2300', '2000'),
  ('5100', '5000'), ('5200', '5000'), ('5300', '5000'), ('5400', '5000'), ('5900', '5000'),
  ('6100', '6000'), ('6200', '6000'), ('6300', '6000'), ('6400', '6000')
) AS v(code, parent)
WHERE c.account_code = v.code;
UPDATE chart_of_accounts SET cash_flow_section = NULL WHERE NOT is_postable;

-- ── 4. Categories and their accounts ─────────────────────────────────────────
-- The "Miscellaneous" category tied to the Bank Charges account is named for it.
UPDATE categories SET category_name = 'Bank Charges'
 WHERE id = (SELECT category_id FROM chart_of_accounts WHERE system_key = 'bank_charges')
   AND btrim(category_name) = 'Miscellaneous';

UPDATE chart_of_accounts SET category_id = (SELECT id FROM categories WHERE btrim(category_name) = 'Jotun Paints' LIMIT 1)
 WHERE account_code = '5115' AND category_id IS NULL;
UPDATE chart_of_accounts SET category_id = (SELECT id FROM categories WHERE btrim(category_name) = 'Structural Adhesive' LIMIT 1)
 WHERE account_code = '5130' AND category_id IS NULL;
UPDATE chart_of_accounts SET category_id = (SELECT id FROM categories WHERE btrim(category_name) = 'Salary' LIMIT 1)
 WHERE system_key = 'salaries' AND category_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM chart_of_accounts x WHERE x.category_id = (SELECT id FROM categories WHERE btrim(category_name) = 'Salary' LIMIT 1));

-- A category's ledger group is the heading its account sits under.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS ledger_group_id uuid REFERENCES chart_of_accounts(id);
COMMENT ON COLUMN categories.ledger_group_id IS 'The chart heading this category''s account sits under (380): its account moves with it.';
UPDATE categories cat SET ledger_group_id = c.parent_account_id
  FROM chart_of_accounts c WHERE c.category_id = cat.id;

-- The account's nature follows the chart, not the category form (it used to
-- follow categories.nature, which filed Aluminum and Steel as assets).
DROP TRIGGER IF EXISTS trg_sync_coa_nature ON categories;

-- A new category gets its account at once, under its group; moving the
-- category to another group moves the account (and its nature with it).
CREATE OR REPLACE FUNCTION public.category_ledger_group_default()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  -- Default group: by the category's cost group, else Other project costs.
  IF NEW.ledger_group_id IS NULL THEN
    NEW.ledger_group_id := (SELECT id FROM chart_of_accounts WHERE account_code =
      CASE (SELECT name FROM cost_groups WHERE id = NEW.cost_group_id)
        WHEN 'Materials' THEN '5100' WHEN 'Labor' THEN '5200' WHEN 'Subcontract' THEN '5300'
        WHEN 'Transport' THEN '5400' WHEN 'Overhead' THEN '6200' ELSE '5900' END);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE id = NEW.ledger_group_id AND NOT is_postable) THEN
    RAISE EXCEPTION 'Pick a ledger group (a heading in the chart of accounts) for this category';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.category_ledger_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_group chart_of_accounts%ROWTYPE;
  v_code  text;
  v_acct  chart_of_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_group FROM chart_of_accounts WHERE id = NEW.ledger_group_id;
  SELECT * INTO v_acct FROM chart_of_accounts WHERE category_id = NEW.id;
  IF v_acct.id IS NULL THEN
    -- Next free code in the group: 5100 → 5101, 5102…
    SELECT (max(account_code::int) + 1)::text INTO v_code
      FROM chart_of_accounts WHERE parent_account_id = v_group.id AND account_code ~ '^[0-9]{4}$';
    v_code := COALESCE(v_code, (v_group.account_code::int + 1)::text);
    WHILE EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = v_code) LOOP
      v_code := (v_code::int + 1)::text;
    END LOOP;
    INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, category_id, cash_flow_section)
    VALUES (v_code, btrim(NEW.category_name), v_group.nature, v_group.id, true, true, NEW.id,
            CASE WHEN v_group.account_code = '1600' THEN 'investing'
                 WHEN v_group.nature = 'Equity' OR v_group.account_code = '2300' THEN 'financing'
                 ELSE 'operating' END);
  ELSE
    UPDATE chart_of_accounts
       SET parent_account_id = v_group.id,
           nature = v_group.nature,
           account_name = CASE WHEN TG_OP = 'UPDATE' AND account_name = btrim(OLD.category_name) THEN btrim(NEW.category_name) ELSE account_name END
     WHERE id = v_acct.id;
  END IF;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_category_ledger_group ON categories;
CREATE TRIGGER trg_category_ledger_group BEFORE INSERT OR UPDATE OF ledger_group_id, cost_group_id ON categories
  FOR EACH ROW EXECUTE FUNCTION category_ledger_group_default();
DROP TRIGGER IF EXISTS trg_category_ledger_account ON categories;
CREATE TRIGGER trg_category_ledger_account AFTER INSERT OR UPDATE OF ledger_group_id, category_name ON categories
  FOR EACH ROW EXECUTE FUNCTION category_ledger_account();

-- Categories that never had an account get one now.
UPDATE categories SET ledger_group_id = NULL
 WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.category_id = categories.id);

-- ── 5. The three functions that named a moved account by code ────────────────
DO $$
DECLARE f text; d text;
BEGIN
  FOREACH f IN ARRAY ARRAY['bank_classification_coa', 'vrf_sync_ledger', 'post_payroll_payment_to_ledger'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    d := replace(d, '''5010''', '''6101''');
    d := replace(d, '''51026''', '''5902''');
    d := replace(d, '''51037''', '''3030''');
    d := replace(d, '''51057''', '''6306''');
    d := replace(d, '''51065''', '''6301''');
    EXECUTE d;
  END LOOP;
END $$;

-- Nothing still looks an account up by a code that no longer exists.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(DISTINCT p.proname || ':' || m[1], ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL regexp_matches(pg_get_functiondef(p.oid), 'account_code\s*=\s*''([0-9]+)''', 'g') m
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.account_code = m[1]);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Functions still name missing account codes: %', v_bad; END IF;
END $$;
