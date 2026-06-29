-- ============================================================
-- Expense seed from Airtable KUNCH_11 (first 200 records sample)
-- Requires migrations 036 + 037 to have been run first
-- Paid expenses imported as finance_approved (no further workflow needed)
-- Upserts on expense_code — safe to re-run
-- NOTE: For all 2825 expenses, run the full migration script instead.
-- ============================================================

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C+-ANO-251110-DAW',
  'Transport',
  17000,
  '2025-11-10',
  true,
  'finance_approved',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Dawit Damessew')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PAI-C+-JOT-SIL-250709-ONE',
  NULL,
  12265.88,
  '2025-07-09',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('One Stop Building and Finishing Materials')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MUL-C-TEM-MEN-250723-FET',
  NULL,
  9440,
  '2025-07-23',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fetiya Mehdi')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-C-ACS-ANO-251110-KUN',
  'Labor',
  3000,
  '2025-11-10',
  false,
  'pending',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ALU-A-MES-DAG-260121-NAY',
  NULL,
  125920,
  '2026-01-21',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Nayad Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C+-ZEM-MEN-250823-JEM',
  NULL,
  13800,
  '2025-08-23',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Jemal Faris Edris')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'VRF-A-ADM-DAG-260608-FET',
  'VRF on Sene from Hamza',
  550000,
  '2026-06-08',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fetiya Kedir Afrah Electric & Cons Materials')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MUL-B+-STA-MEN-260514-FIF',
  '2cmx2cm Black L aluminum profile 34pc×690=23,460
Shooter nail by 3 ... 5pkt×920=4600 birr 
Apel mitre glue 25pc*1495 =37,375 birr

Total = 65,435 birr

1000061070307 
feiruz seid',
  65435,
  '2026-05-14',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fifila Retail Trade Business')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MES-MEN-260317-LAD',
  NULL,
  1500,
  '2026-03-17',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'Mesfin emiru 1000357812667',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('LADA Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PAI-C-TEM-SIL-250729-ONE',
  NULL,
  8523.55,
  '2025-07-29',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('One Stop Building and Finishing Materials')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MES-MEN-250809-MOT',
  NULL,
  500,
  '2025-08-09',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Motorcycle Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TOO-B-WOR-SIL-260509-LEX',
  'Tools',
  23600,
  '2026-05-09',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Lexus Trading One Member PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'B-MES-SIL-260129-ALU',
  NULL,
  44677,
  '2026-01-29',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Aluminum World Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PAI-B-WOR-MEN-251016-GEN',
  NULL,
  24000,
  '2025-10-16',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Genet Desta')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MDF-B-ETH-MEN-260404-ZAK',
  NULL,
  29900,
  '2026-04-04',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'Mubarek',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Zakiya Redwan (Mubarek redwan)')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'GOV-C+-ADM-SEL-260511-BER',
  'Receipt printing',
  20250,
  '2026-05-11',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Berhane ena Selam Printing Enterprise')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MIS-C+-ADM-DAG-251015-KUN',
  NULL,
  20000,
  '2025-10-15',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MUL-C+-MEN-251020-FRE',
  NULL,
  18750,
  '2025-10-20',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Frehiwot Belay')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'C-MES-MEN-260311-MER',
  NULL,
  5400,
  '2026-03-11',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  'Meryem nasir',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Meriam Nasir')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MES-NEB-250801-AGU',
  NULL,
  3500,
  '2025-08-01',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Agumas Addis')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'OTH-C-WOR-SIL-260227-KUN',
  NULL,
  5000,
  '2026-02-27',
  false,
  'pending',
  'general',
  'Single Items',
  'Birk shiferaw',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TOO-C-ACS-SIL-250902-FET',
  NULL,
  1000,
  '2025-09-02',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fetiya Bedri')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'B-FAB-MEN-251231-HAN',
  NULL,
  34325,
  '2025-12-31',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Hanan Aman')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MES-MEN-260406-LAD',
  NULL,
  2000,
  '2026-04-06',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'Mikael mengistu',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('LADA Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-B-MEN-MEN-251220-RIH',
  NULL,
  30000,
  '2025-12-20',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Rihana Asrar')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MES-MEN-251225-LAD',
  NULL,
  3600,
  '2025-12-25',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('LADA Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MEN-MEN-251227-LAD',
  NULL,
  3400,
  '2025-12-27',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('LADA Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-ACS-MEN-250815-ISU',
  NULL,
  4200,
  '2025-08-15',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Isuzu Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'FUE-C+-WOR-SIL-260502-TOT',
  'Fuel',
  12800,
  '2026-05-02',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Total Energies')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-END-MEN-260217-LAD',
  NULL,
  600,
  '2026-02-17',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('LADA Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PAI-B+-ETH-SIL-260519-TAK',
  'Paint',
  70145.04,
  '2026-05-19',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Take Fam PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C+-ADW-NEB-251113-GET',
  NULL,
  18000,
  '2025-11-13',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Getachew Belay')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-GIR-NEB-260122-KUN',
  NULL,
  1200,
  '2026-01-22',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'C+-END-NEB-260411-NEW',
  NULL,
  13700,
  '2026-04-11',
  false,
  'pending',
  'general',
  'Multiple Items',
  'Getu',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('New Vendor')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'FUE-C-SIL-250709-TOT',
  NULL,
  3500,
  '2025-07-09',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Total Energies')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C-END-MEN-251117-KID',
  NULL,
  5600,
  '2025-11-17',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Kidist Minwuyelet')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'OTH-C-SIL-251204-KUN',
  NULL,
  1200,
  '2025-12-04',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'COM-B-ETH-MEN-260605-RAD',
  'Circular planters 2pc*15100 =30,200
rectangular planter 1pc = 16,750

Total =46,950 birr

1000489995038
Radix adis Trading plc',
  46950,
  '2026-06-05',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  'Radix adis Trading plc',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Radix Adis Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'VRF-A-ADM-DAG-260321-TY',
  NULL,
  300000,
  '2026-03-21',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('TY Wood Manufacturing PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ALU-B-MES-MEN-260622-SEI',
  'partition profile 10 pcs*900 =9,000
 track 25 pcs*900 =22,500

Total =31,500 birr

1000443943254
Seida faris',
  31500,
  '2026-06-22',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Seida Faris')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-B+-WOR-MEN-260127-KSH',
  NULL,
  50544,
  '2026-01-27',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Ksh blocket manufacturing')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C+-END-SIL-260205-ALU',
  NULL,
  14000,
  '2026-02-05',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Aluminum World Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-C-ANO-251125-KUN',
  'Labor',
  4100,
  '2025-11-25',
  false,
  'pending',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-B-ANO-251204-KUN',
  'Labor',
  26500,
  '2025-12-04',
  true,
  'finance_approved',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-GIR-NEB-260207-LAD',
  NULL,
  10000,
  '2026-02-07',
  false,
  'pending',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('LADA Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'C-MEN-251227-FET',
  NULL,
  8800,
  '2025-12-27',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fetiya Mehdi')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'COM-C+-BIN-MEN-260620-HEN',
  'Blocket by 10cm 280pc*76birr =21,280 birr

1000550720586
 Henok',
  21280,
  '2026-06-20',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Henok Gedebo')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'B-NEW-NEB-251230-SEA',
  NULL,
  43700,
  '2025-12-30',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Seada Mubarak')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'FUE-C-SIL-251021-KUN',
  NULL,
  3500,
  '2025-10-21',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ENT-B+-STA-NAT-260518-ALE',
  'Catering service',
  71300,
  '2026-05-18',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'Alemtsehay Abrar',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Alemtsehay Abrar')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'VRF-A-ADM-DAG-260516-ABI',
  'VRF on Genbot from Fitsum',
  1000000,
  '2026-05-16',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Abiel Hagos')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'B+-SIL-260114-ONE',
  NULL,
  70840.24,
  '2026-01-14',
  false,
  'pending',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('One Stop Building and Finishing Materials')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'B+-MEN-MEN-260108-FET',
  NULL,
  64150,
  '2026-01-08',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fetiya Mehdi')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'COM-C-ABI-MEN-251216-MAL',
  NULL,
  1000,
  '2025-12-16',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Maleda Foam')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'STE-C-MES-MEN-260325-AMA',
  NULL,
  3500,
  '2026-03-25',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'Amanuel 1000728957941',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Amanuel Berta')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ELE-C-HOR-MEN-260321-WE',
  NULL,
  2990,
  '2026-03-21',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('We Care Lights (Mohammed Worku)')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'STE-C-DEB-MEN-251223-SAD',
  NULL,
  2134.4,
  '2025-12-23',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('SADOR ALUMINIUM')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'COM-C+-GIR-MEN-260204-HOS',
  NULL,
  15200,
  '2026-02-04',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('HOSIE TRADING PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TOO-C+-SOL-MEN-260406-FRE',
  NULL,
  19500,
  '2026-04-06',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Frehiwot Belay')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'VRF-A-DAG-250719-HAN',
  NULL,
  145500,
  '2025-07-19',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Hanan Aman')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ELE-C-DAG-250717-NEJ',
  NULL,
  1500,
  '2025-07-17',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Nejat Kediru')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ELE-C+-SOL-MEN-250902-GOO',
  NULL,
  19350,
  '2025-09-02',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Good Morning Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PAI-C-ACS-SIL-250909-FET',
  NULL,
  5200,
  '2025-09-09',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fetiya Mehdi')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PEN-C-SIL-260205-KUN',
  NULL,
  1500,
  '2026-02-05',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-B+-ADM-DAG-260515-KEN',
  'Ticket for Kenya - For Abel',
  95886,
  '2026-05-15',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'Kenyan Airways',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Kenya Airways')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PAI-B+-WOR-MEN-251013-GEN',
  NULL,
  77000,
  '2025-10-13',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Genet Desta')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-B-MES-MEN-250711-ZAK',
  NULL,
  24150,
  '2025-07-11',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Zakiya Redwan (Mubarek redwan)')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'A-SAM-MEN-260115-HAN',
  NULL,
  397000,
  '2026-01-15',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Hanan Aman')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'VRF-A-ADM-DAG-260516-ET',
  'VRF on Genbot from Hamza',
  1100000,
  '2026-05-16',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('ET Wood Manufacturing PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'FUE-C-WOR-SIL-260302-KUN',
  NULL,
  9500,
  '2026-03-02',
  false,
  'pending',
  'general',
  'Single Items',
  'Sleshi girma',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'C-END-MEN-260126-BEZ',
  NULL,
  2914,
  '2026-01-26',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Bezalel Aluminum Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-A-ET--MEN-260420-FET',
  'Kelem elmohandis  8×6000=48000
Estco 12×2000=24000
Spuruso 24×2000=48000
Gubsm 10×1000=10000
Lama 5×250=1250
Chak bilawa 4×300=1200
Kelebet = 700
gypsum 6pc*1600 =9,600

Total = 142,750 birr

1000470487317
Fetya mehdi',
  142750,
  '2026-04-20',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fetiya Mehdi')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'SAN-C-MES-ANO-260318-KUN',
  '3 p3s safa',
  1050,
  '2026-03-18',
  true,
  'finance_approved',
  'general',
  NULL,
  'Ayatu sheraffa 1000452058026',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ELE-C-TEM-MEN-250724-MES',
  NULL,
  5000,
  '2025-07-24',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Mesfin Hailemariam')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PUT-B-MEN-MEN-251219-GRA',
  NULL,
  30498,
  '2025-12-19',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Grasel Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-TEM-MEN-250709-RID',
  NULL,
  229,
  '2025-07-09',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('RIDE Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'VRF-A-DAG-250804-HAN',
  NULL,
  322500,
  '2025-08-04',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Hanan Aman')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'INV-C+-WOR-MEN-260512-YIB',
  'Birdlibs 6pc*2,400 =14,400 birr

1000355672267 
Yibgeta Wake turi',
  14400,
  '2026-05-12',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Yibgeta Wake')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MUL-C+-MEN-MEN-251113-FRE',
  NULL,
  18300,
  '2025-11-13',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Frehiwot Belay')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'COM-C+-GIR-MEN-260203-TEN',
  NULL,
  20000,
  '2026-02-03',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Tenaye Takele')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'C+-MEN-260124-ETH',
  NULL,
  15860,
  '2026-01-24',
  false,
  'pending',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Ethio Steel')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'VRF-A-ADM-DAG-260417-BRI',
  'VRF On Miyaziya',
  544000,
  '2026-04-17',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Bridge Wood & Metal Work PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MES-MEN-250721-PIC',
  NULL,
  4000,
  '2025-07-21',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Pickup Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'B-SIL-251210-ONE',
  NULL,
  42435,
  '2025-12-10',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('One Stop Building and Finishing Materials')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'COM-C+-MEN-MEN-260210-FED',
  NULL,
  10500,
  '2026-02-10',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fedila Reshad')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MAC-C-JR -ANO-251101-KUN',
  'Rental',
  1000,
  '2025-11-01',
  false,
  'pending',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ALU-B+-ET--MEN-260425-SAL',
  'Black aluminum profile for clading. 
L =24pc*1,259.7 =
T =20pc* 1,259.7 = 

Total = 55,426.8birr

SELHADIN ELIAS 
1000598916628
Meskel Gebeya branch',
  55426.8,
  '2026-04-25',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Salhadin Eliyas')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'B-GIR-MEN-260130-ETH',
  NULL,
  24630,
  '2026-01-30',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Ethio Steel')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'FUE-C+-WOR-SIL-260403-TOT',
  NULL,
  12800,
  '2026-04-03',
  false,
  'pending',
  'general',
  'Single Items',
  'Sleshi girma 1000311511851',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Total Energies')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MDF-B+-MES-DAG-251230-HAN',
  NULL,
  79655,
  '2025-12-30',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Hanan Aman')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ELE-B-END-MEN-260307-TFE',
  NULL,
  27000,
  '2026-03-07',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'T.f.e',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('TFE Import & Export')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MUL-B-WOR-MEN-260523-FIF',
  'Foam 10pc×1265=12,650
Sand paper 80m 200pcs×46=9200
Screw head 20pc ×172.50=3450 
Sand paper A4 90pcs×143.50=12,915

Total amount =38,215 birr',
  38215,
  '2026-05-23',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fifila Retail Trade Business')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'OFF-C-OFF-MEN-260224-KUN',
  NULL,
  1000,
  '2026-02-24',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'Yohannes Mengistu',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'CEM-B+-MEN-MEN-251113-AMA',
  NULL,
  50600,
  '2025-11-13',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Amare Tiruneh')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'B-SAM-MEN-251229-FIF',
  NULL,
  43527.5,
  '2025-12-29',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fifila Retail Trade Business')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-C-ACS-NEB-250825-KUN',
  'Labour and masatefiya',
  600,
  '2025-08-25',
  true,
  'finance_approved',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-C+-ZEM-DAG-251012-KUN',
  NULL,
  15000,
  '2025-10-12',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-B-ACS-DAG-251006-DAW',
  NULL,
  28000,
  '2025-10-06',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Dawit Damessew')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-END-MEN-251117-NEW',
  NULL,
  1200,
  '2025-11-17',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('New Vendor')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-TEM-MEN-250808-ENK',
  NULL,
  1200,
  '2025-08-08',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Enkuneh')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PAI-B+-ET--SIL-260422-TAK',
  'Paint',
  67314.96,
  '2026-04-22',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'Take fam p l c',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Take Fam PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C-END-MEN-251211-FIF',
  NULL,
  4812,
  '2025-12-11',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fifila Retail Trade Business')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-END-MEN--NEW',
  NULL,
  1000,
  NULL,
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('New Vendor')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C-TEM-MEN-250717-ABD',
  NULL,
  7700,
  '2025-07-17',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Abdel Semed')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PAI-B-ACS-SIL-250901-ONE',
  NULL,
  38415.05,
  '2025-09-01',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('One Stop Building and Finishing Materials')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ELE-C-TEM-MEN-250724-NEB',
  NULL,
  4650,
  '2025-07-24',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Nebiyat')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PAI-C-JR -SIL-251024-ONE',
  NULL,
  4485,
  '2025-10-24',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('One Stop Building and Finishing Materials')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-A-SOL-260523-KUN',
  'Lober &chake&cleaner&chezzeler &ceramic
Purchase',
  391000,
  '2026-05-23',
  false,
  'pending',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'FOA-C+-ACS-ANO-250829-KUN',
  'Kangaroo 200 meter, roll price 64=12800',
  12800,
  '2025-08-29',
  true,
  'finance_approved',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'VRF-A-ADM-DAG-251008-TY',
  NULL,
  1098000,
  '2025-10-08',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('TY Wood Manufacturing PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'VRF-A-DAG-250808-HAN',
  NULL,
  455000,
  '2025-08-08',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Hanan Aman')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'GLA-C+-ACS-SIL-250905-ABR',
  NULL,
  15500,
  '2025-09-05',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Abrham Mekuriya')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'C-BIS-MEN-260105-ZER',
  NULL,
  8050,
  '2026-01-05',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Zerihun Abiy')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'VRF-A-ADM-DAG-260216-TY',
  NULL,
  1363000,
  '2026-02-16',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('TY Wood Manufacturing PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'FUE-C-SIL-251205-KUN',
  NULL,
  3500,
  '2025-12-05',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C-MEN-MEN-251205-ABD',
  NULL,
  5000,
  '2025-12-05',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Abdulkadir Yassin (Abdulsemed lale)')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C-WOR-MEN-251022-SUR',
  NULL,
  4250,
  '2025-10-22',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Surafel Zelalem (Robel Melese)')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'FUE-C+-WOR-SIL-260605-TOT',
  'Paint',
  14800,
  '2026-06-05',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Total Energies')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'FUE-C-SIL-251210-KUN',
  NULL,
  3500,
  '2025-12-10',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TOO-C-MES-MEN-260122-NEW',
  NULL,
  340,
  '2026-01-22',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('New Vendor')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C-MEN-250709-FET',
  NULL,
  990,
  '2025-07-09',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fetiya Mehdi')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'WOO-C+-ZEM-SIL-250913-FET',
  NULL,
  13000,
  '2025-09-13',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fetiya Mehdi')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'C+-END-SIL-260317-ALU',
  NULL,
  12843.28,
  '2026-03-17',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Aluminum World Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'STE-B-END-MEN-260203-ALP',
  NULL,
  33750,
  '2026-02-03',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Alpha Steel Factory')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-END-MEN-250808-DAN',
  NULL,
  1500,
  '2025-08-08',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Daniel Zewde')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'B+-WOR-MEN-260110-ROM',
  NULL,
  62696,
  '2026-01-10',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Romel General Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PAI-B-WOR-MEN-251201-GEN',
  NULL,
  24000,
  '2025-12-01',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Genet Desta')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MES-MEN-260321-PIC',
  NULL,
  2200,
  '2026-03-21',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'Sewunet',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Pickup Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MEN-MEN-251204-NEW',
  NULL,
  600,
  '2025-12-04',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('New Vendor')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TOO-C-WOR-SIL-260310-BEL',
  NULL,
  1500,
  '2026-03-10',
  false,
  'pending',
  'general',
  'Single Items',
  'Belaynesh tad 1000679449347',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Belaynesh Tad')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'OFF-C-ANO-250729-KUN',
  'Haron',
  2800,
  '2025-07-29',
  true,
  'finance_approved',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ELE-A-BIN-MEN-260619-ABD',
  'Wire 4.00 (euro) =2roll x 25,000 =50,000
Wire 2.5 (euro) =2roll x 18,000 =36,000
Wire 1.5 (euro) =2roll x11,000 =22,000
Guroro condiut 16=2roll x 2600 =5,200
nastro=10 x 90 =900

Total =114,100 birr

Screw head 10pkt*1,600 =16,000 birr

1000714599651
Abduselam Murad Retail trade of electrical equipment',
  114100,
  '2026-06-19',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Abduselam murad retail trade of electrical equipment')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-B+-MES-260502-KUN',
  'Putty 
Melkamu minyichil ( 1000750254978  ) 4500 birrr 
Getahun Danghaw( 140662534 ) =7500 birr 

Kurkuaro 
Mulusew Aynalem ( 73672732 ) = 5200 birr
Kautimar Kassa  ( 1000500757675) = 3900 birr 


(Labor)  Jornata 
Adimasu Mola ( 1000436905754 ) = 4800 birr
Asirat Hariso ( 1000534247862 ) = 4200 birr


Board team 

Board work Nigusu Fantahun ( 1000426758125) = 60,000birr 


Total = 90,100 birr',
  90100,
  '2026-05-02',
  false,
  'pending',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-C+-ANO-260206-KUN',
  'Labor payment',
  14000,
  '2026-02-06',
  false,
  'pending',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'OTH-C+-WOR-ANO-250712-KUN',
  'Lenafta=2000.     Lecompreser maseriya 4500.          Wode bulbula yehidebet kene masworeja 3500     lekelem 850      lekoshasha mansha 2500. Lebret masatefiya 2000',
  15350,
  '2025-07-12',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MUL-C-ACS-MEN-250827-FIF',
  NULL,
  7492,
  '2025-08-27',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fifila Retail Trade Business')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MES-ANO-251021-KUN',
  'Transport',
  1400,
  '2025-10-21',
  true,
  'finance_approved',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'C-MEN-251222-TIZ',
  NULL,
  9760,
  '2025-12-22',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Tizta habtu')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C+-WOR-MEN-260402-OF',
  NULL,
  12800,
  '2026-04-02',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'Of General trading',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('OF General Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-CAR-ANO-251104-LAD',
  'Transport',
  4500,
  '2025-11-04',
  true,
  'finance_approved',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('LADA Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PRO-B-ADM-DAG-250804-FIK',
  NULL,
  30000,
  '2025-08-04',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fiker Getachew (Kidus Tamiru)')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PAI-C+-SOL-SIL-250811-ONE',
  NULL,
  17047,
  '2025-08-11',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('One Stop Building and Finishing Materials')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'C-WOR-MEN-260216-FIF',
  NULL,
  8740,
  '2026-02-16',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fifila Retail Trade Business')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ELE-C+-WOR-MEN-260512-FRE',
  'electrode 8pkt*1500 =12,000 birr

1000042940128  
Frehiwot belay',
  12000,
  '2026-05-12',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Frehiwot Belay')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C-MES-MEN-250816-FIF',
  NULL,
  2580,
  '2025-08-16',
  false,
  'pending',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fifila Retail Trade Business')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MES-260327-LAD',
  NULL,
  1000,
  '2026-03-27',
  false,
  'pending',
  'general',
  'Single Items',
  'Tadesse Abera',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('LADA Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MUL-C-CAR-MEN-250814-ZAK',
  NULL,
  8200,
  '2025-08-14',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Zakiya Redwan (Mubarek redwan)')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'OTH-C-AFC-SIL-250822-KUN',
  NULL,
  7000,
  '2025-08-22',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C+-JR -MEN-251023-NEI',
  NULL,
  10500,
  '2025-10-23',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Neima Umer')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'FUE-C+-WOR-SIL-260512-TOT',
  'Fuel',
  14800,
  '2026-05-12',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Total Energies')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'OFF-C-OFF-DAG-260223-HEL',
  NULL,
  4300,
  '2026-02-23',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Heldana Lakew')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-C+-SAM-ANO-260322-KUN',
  NULL,
  13500,
  '2026-03-22',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'b͟e͟s͟u͟f͟e͟k͟a͟d͟ f͟i͟k͟r͟u͟ 1000426100073',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'C+-AFC-MEN-260129-PEA',
  NULL,
  14407.2,
  '2026-01-29',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Peace Way Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'COM-A-ACS-DAG-250906-ANW',
  NULL,
  234000,
  '2025-09-06',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Anwar Seid Adem')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-END-NEB-260313-KUN',
  NULL,
  400,
  '2026-03-13',
  false,
  'pending',
  'general',
  'Single Items',
  'Eyayu 1000200023416',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-WOR-ANO-251227-KUN',
  'Transport',
  2100,
  '2025-12-27',
  true,
  'finance_approved',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MES-MEN-260404-PIC',
  NULL,
  4500,
  '2026-04-04',
  false,
  'pending',
  'general',
  'Single Items',
  'Fasil teketel',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Pickup Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C+-ETH-MEN-260616-FIF',
  'Wirecap 4pcs×75=300
Holsaw 60mm 1pcs×2070=2070
Adapter 1pcs×1875 =1875

Vinner for machine 2roll*2980 =5,960 birr

1000061070307 
feiruz seid"
Total amount =10,205',
  10205,
  '2026-06-16',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fifila Retail Trade Business')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C+-HOR-DAG-260325-DAW',
  NULL,
  18000,
  '2026-03-25',
  false,
  'pending',
  'general',
  'Single Items',
  'Dawit demsew',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Dawit Damessew')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C-TEM-MEN-250718-ETH',
  NULL,
  1800,
  '2025-07-18',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Ethio Steel')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PRO-A-DAG-250811-TES',
  NULL,
  900000,
  '2025-08-11',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Tesfahun G/Mariyam')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'A-SIL-260205-ONE',
  NULL,
  137730.97,
  '2026-02-05',
  false,
  'pending',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('One Stop Building and Finishing Materials')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-B-ETH-MEN-260528-AYA',
  'Spc skirting 15pc*1650 = 24,750 birr

1000168673381
Ayele moges',
  24750,
  '2026-05-28',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Ayale Moges')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'OFF-C-WOR-SIL-260526-RAS',
  'Maintenance',
  7000,
  '2026-05-26',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('RasTec Computer Solution PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PUT-C-MES-MEN-260209-MEK',
  NULL,
  3700,
  '2026-02-09',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Mekuriya Kore')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-WOR-MEN-260129-ISU',
  NULL,
  5832,
  '2026-01-29',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Isuzu Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'VRF-A-ADM-DAG-250910-TY',
  NULL,
  499000,
  '2025-09-10',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('TY Wood Manufacturing PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ELE-B-MEN-MEN-260101-ROM',
  NULL,
  25000,
  '2026-01-01',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Romel General Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LEA-C+-ZEM-ANO-250822-KUN',
  NULL,
  17850,
  '2025-08-22',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'BUI-C+-WOR-MEN-251014-OF',
  NULL,
  12800,
  '2025-10-14',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('OF General Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'C-WOR-MEN-260307-FIF',
  NULL,
  9991,
  '2026-03-07',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  'Feiruz seid',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fifila Retail Trade Business')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-GIR-MEN-260110-LAD',
  NULL,
  1600,
  '2026-01-10',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('LADA Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-A-ACS-DAG-250827-KUN',
  NULL,
  220000,
  '2025-08-27',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ELE-C-GIR-MEN-250729-WE',
  NULL,
  5800,
  '2025-07-29',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('We Care Lights (Mohammed Worku)')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-JOT-MEN-250809-LAD',
  NULL,
  500,
  '2025-08-09',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('LADA Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'VRF-A-ADM-DAG-260326-TY',
  NULL,
  300000,
  '2026-03-26',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('TY Wood Manufacturing PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-TEM-ANO-250809-KUN',
  'Ride from semmit pot',
  759,
  '2025-08-09',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'SUB-A-HOR-NAT-260408-FUS',
  '138000 - 20602 = 117397.89 birr for 10 tables (Fabb)
19650 birr (abel) sheet metal and rhs cutting
Total 137047 birr',
  137047,
  '2026-04-08',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fusion Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'C-MEN-251231-NEW',
  NULL,
  6500,
  '2025-12-31',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('New Vendor')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PET-C-END-NEB-260411-KUN',
  NULL,
  10000,
  '2026-04-11',
  false,
  'pending',
  'general',
  'Single Items',
  'Nebil',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MOR-B-ACS-MEN-250825-HAY',
  NULL,
  41040,
  '2025-08-25',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Haysem Payen General Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'A-MEN-260115-HAN',
  NULL,
  349125,
  '2026-01-15',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Hanan Aman')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-B-MES-ANT-250723-KUN',
  NULL,
  25000,
  '2025-07-23',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-END-MEN-260314-LAD',
  NULL,
  1300,
  '2026-03-14',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'Enkuneh 1000212501461',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('LADA Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'MUL-B+-JR -MEN-251021-HAN',
  NULL,
  94000,
  '2025-10-21',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Hanan Aman')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'PAI-C-FLA-SIL-251013-ONE',
  NULL,
  3141.67,
  '2025-10-13',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('One Stop Building and Finishing Materials')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'ELE-B-TEM-MEN-250723-WE',
  NULL,
  28063,
  '2025-07-23',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('We Care Lights (Mohammed Worku)')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-GIR-ANO-250723-PIC',
  NULL,
  3500,
  '2025-07-23',
  true,
  'finance_approved',
  'general',
  NULL,
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Pickup Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'B+-ITA-MEN-260209-ASS',
  NULL,
  67000,
  '2026-02-09',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Assewodaf')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'B-MEN-251205-FET',
  NULL,
  25500,
  '2025-12-05',
  true,
  'finance_approved',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Fetiya Mehdi')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'WOO-A-ACS-MEN-250823-HAY',
  NULL,
  108000,
  '2025-08-23',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Haysem Payen General Trading PLC')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'STE-C+-PER-DAG-260529-TAM',
  'Metal Decoration',
  10340,
  '2026-05-29',
  true,
  'finance_approved',
  'general',
  'Single Items',
  'Tamirat',
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Tamirat Demisse')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-A-MAD-260511-ROB',
  'Carpenter labor payment for made in ethiopia',
  257830,
  '2026-05-11',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Robel Hachalu')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'LAB-C+-MES-DAG-260613-KUN',
  'Contractual  worker 
1000539886049  ( Nega Mare ) 

Granite stair work  27.25 meter * 300 = 8,175 birr 
Skirting ( zokolo ) 40.8 meter * 300  = 12,240 birr 

Total = 20,415 birr',
  20415,
  '2026-06-13',
  false,
  'pending',
  'general',
  'Multiple Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('KUN-Paid From Personal')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'CEM-C+-MEN-MEN-260105-AMA',
  NULL,
  11600,
  '2026-01-05',
  true,
  'finance_approved',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Amare Tiruneh')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;

INSERT INTO expenses (expense_code, item_service_description, amount_etb, date, payment_status, approval_status, expense_type, purchase_type, vendors_name, notes, vendor_id)
VALUES (
  'TRA-C-MES-MEN-260101-PIC',
  NULL,
  4000,
  '2026-01-01',
  false,
  'pending',
  'general',
  'Single Items',
  NULL,
  NULL,
  (SELECT id FROM vendors WHERE lower(trim(vendor_name)) = lower(trim('Pickup Driver')) LIMIT 1)
)
ON CONFLICT (expense_code) DO UPDATE SET
  vendor_id       = EXCLUDED.vendor_id,
  payment_status  = EXCLUDED.payment_status,
  approval_status = EXCLUDED.approval_status;
