-- Import Awash Bank statement (account: AWBNK / 013041355816000)
-- Statement period: 08/07/2025 – 07/06/2026
-- NOTE: Statement page 2 of 3 was missing from the PDF —
--       transactions between 01/05/2026 and 04/02/2026 are not included.
--
-- Credits  → to_account_id   = AWBNK
-- Debits   → from_account_id = AWBNK
-- Service charges → small debit entries (165 ETB per FLOWER transfer)

DO $$ BEGIN

-- Ensure no duplicate import by checking for a sentinel transfer
IF EXISTS (
  SELECT 1 FROM public.transfers WHERE transfer_id_code = 'AWB-IMPORT-SENTINEL'
) THEN
  RAISE NOTICE 'Awash statement already imported — skipping.';
  RETURN;
END IF;

-- ── CREDITS (inflows) ─────────────────────────────────────────────────────

-- 1. CPO settlement (opening deposit)
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-07-21-CR1', '2025-07-21', NULL,
        '9e90c20f-882d-4a80-b605-ef46c2266838', 101867.00,
        'CPO Settlement CPO No. 23511970');

-- 2. ABIB508255 credit
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-10-31-CR1', '2025-10-31', NULL,
        '9e90c20f-882d-4a80-b605-ef46c2266838', 142735.00,
        'ABIB508255');

-- 3. abb R136026
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-11-17-CR1', '2025-11-17', NULL,
        '9e90c20f-882d-4a80-b605-ef46c2266838', 70000.00,
        'abb R136026');

-- 4. abh 7713585
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-12-16-CR1', '2025-12-16', NULL,
        '9e90c20f-882d-4a80-b605-ef46c2266838', 140000.00,
        'abh 7713585');

-- 5. abt 13338654 (large inflow — likely sales collection)
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-12-16-CR2', '2025-12-16', NULL,
        '9e90c20f-882d-4a80-b605-ef46c2266838', 2822400.00,
        'abt 13338654');

-- 6. ARF 13338673 (large inflow)
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2026-01-05-CR1', '2026-01-05', NULL,
        '9e90c20f-882d-4a80-b605-ef46c2266838', 2367114.40,
        'ARF 13338673');

-- 7. ABF 13338695 (Apr 2 large inflow — page 3 of statement)
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2026-04-02-CR1', '2026-04-02', NULL,
        '9e90c20f-882d-4a80-b605-ef46c2266838', 2514378.11,
        'ABF 13338695');

-- 8. ABF 110030549 (Apr 7 inflow)
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2026-04-07-CR1', '2026-04-07', NULL,
        '9e90c20f-882d-4a80-b605-ef46c2266838', 284708.38,
        'ABF 110030549');


-- ── DEBITS (outflows) ─────────────────────────────────────────────────────

-- 9. Lidiyage Wubitil – supplier / contractor payment
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-07-21-DR1', '2025-07-21',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 100000.00,
        'Flower – Lidiyage Wubitilgl / OBAL AKABABIG');

INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-07-21-DR2', '2025-07-21',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 165.00,
        'Service charge – Lidiyage Wubitilgl transfer');

-- 10. abiy 10374000 – transfer (possibly payroll/advance)
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-11-03-DR1', '2025-11-03',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 35060.87,
        'abiy 10374000');

-- 11. Atinafush Bassefa – payment via Awash Flower
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-11-19-DR1', '2025-11-19',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 100000.00,
        'Flower – Atinafush Bassefa / Meskel Flower (OR:2511191070788128)');

INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-11-19-DR2', '2025-11-19',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 165.00,
        'Service charge – Atinafush Bassefa transfer');

-- 12. Ethio Steel and Finishing PLC – supplier payment
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-12-31-DR1', '2025-12-31',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 304335.08,
        'Ethio Steel and Finishing PLC');

-- 13. Haymanota Bassefa – large payment via Awash Flower
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-12-31-DR2', '2025-12-31',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 700000.00,
        'Flower – Haymanota Bassefa / Meskel Flower (OR:2512311078945148)');

INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2025-12-31-DR3', '2025-12-31',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 165.00,
        'Service charge – Haymanota Bassefa transfer');

-- 14. Tzerhun Kumerat – very large payment via Awash Flower
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2026-01-01-DR1', '2026-01-01',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 1400000.00,
        'Flower – Tzerhun Kumerat / Meskel Flower (OR:2601011079050540)');

INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2026-01-01-DR2', '2026-01-01',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 165.00,
        'Service charge – Tzerhun Kumerat transfer');

-- 15. Gelans Tolara / Africa Avenue – large payment (Apr, page 3)
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2026-04-02-DR1', '2026-04-02',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 1500000.00,
        'Flower – Gelans Tolara / Africa Avenue (OR:2604021072372993)');

INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2026-04-02-DR2', '2026-04-02',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 165.00,
        'Service charge – Gelans Tolara transfer');

-- 16. Bishart Bizuneh / Afrique – large payment
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2026-04-04-DR1', '2026-04-04',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 790000.00,
        'Flower – Bishart Bizuneh / Afrique (OR:2604041109383312)');

INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2026-04-04-DR2', '2026-04-04',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 165.00,
        'Service charge – Bishart Bizuneh transfer');

-- 17. Solomones Ttarish Alao – payment
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2026-04-07-DR1', '2026-04-07',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 100000.00,
        'Flower – Solomones Ttarish Alao (OR:2604071097395779)');

INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-2026-04-07-DR2', '2026-04-07',
        '9e90c20f-882d-4a80-b605-ef46c2266838', NULL, 165.00,
        'Service charge – Solomones Ttarish Alao transfer');

-- ── SENTINEL (prevents double-import) ─────────────────────────────────────
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'AWB-IMPORT-SENTINEL', '2026-04-07', NULL, NULL, 0,
        'Import sentinel — Awash Bank statement 08/07/2025–07/06/2026 (pages 1 & 3 of 3; page 2 missing)');

END $$;

-- ── Mark Ethio Steel payment expense as paid from Awash ───────────────────
-- The 304,335.08 debit on 12/31/2025 to Ethio Steel and Finishing PLC
-- matches any expense with that vendor or similar amount.
-- Update expenses with vendors_name containing 'steel' or 'finish' and
-- matching amount, marking them paid with account_id = AWBNK.
UPDATE public.expenses
SET
  payment_status     = true,
  account_id         = '9e90c20f-882d-4a80-b605-ef46c2266838',
  bank_ref           = 'AWB-2025-12-31-DR1',
  paid_date          = '2025-12-31T00:00:00+00:00'
WHERE
  payment_status = false
  AND (
    LOWER(vendors_name) LIKE '%steel%'
    OR LOWER(vendors_name) LIKE '%finish%'
    OR LOWER(item_service_description) LIKE '%steel%'
    OR LOWER(item_service_description) LIKE '%finish%'
  )
  AND (
    amount_etb BETWEEN 300000 AND 310000
    OR amount_etb IS NULL
  );
