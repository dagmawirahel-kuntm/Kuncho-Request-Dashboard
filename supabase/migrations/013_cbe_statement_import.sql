-- Import CBE bank statement (account: CBE / 1000504664272)
-- Statement period: 01 DEC 2025 – 24 JUN 2026
-- Credits → to_account_id = CBE (inflows)
-- Debits  → from_account_id = CBE (outflows)
-- Matches 388 expense bank_refs against FT-reference codes

DO $$ BEGIN

-- Ensure no duplicate import by checking for a sentinel transfer
IF EXISTS (
  SELECT 1 FROM public.transfers WHERE transfer_id_code = 'CBE-IMPORT-SENTINEL'
) THEN
  RAISE NOTICE 'CBE statement already imported — skipping.';
  RETURN;
END IF;

-- ── CREDITS (inflows into CBE) ─────────────────────────────────────────────

-- Credit 1: PO 168727208 — 897,421.72 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-001-2025-12-04', '2025-12-04', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 897421.72,
        'PO 168727208 (ref: FT25338BNDW4)');

-- Credit 2: 52495 — 138,992.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-002-2025-12-12', '2025-12-12', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 138992.00,
        '52495 (ref: FT2534679Y00)');

-- Credit 3: KUNCHO TRADING P — 141,636.18 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-003-2025-12-12', '2025-12-12', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 141636.18,
        'KUNCHO TRADING P (ref: FT25346KSM1D)');

-- Credit 4: AFCABOOTH — 1,417,920.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-004-2025-12-15', '2025-12-15', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 1417920.00,
        'AFCABOOTH (ref: FT25349LWMKN)');

-- Credit 5: 50702675 — 135,269.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-005-2025-12-15', '2025-12-15', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 135269.00,
        '50702675 (ref: FT2534923JYL)');

-- Credit 6: 67830 — 4,078,406.93 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-006-2025-12-17', '2025-12-17', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 4078406.93,
        '67830 (ref: FT25351JZLQZ)');

-- Credit 7: Marketing — 1,416,132.58 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-007-2025-12-25', '2025-12-25', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 1416132.58,
        'Marketing (ref: FT253599J0LL)');

-- Credit 8: 2512311078945148 — 700,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-008-2025-12-31', '2025-12-31', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 700000.00,
        '2512311078945148 (ref: FT2536519KJ8)');

-- Credit 9: 2601011402222514 — 900,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-009-2026-01-01', '2026-01-01', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 900000.00,
        '2601011402222514 (ref: FT26001SSVL3)');

-- Credit 10: 2601011078950540 — 1,400,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-010-2026-01-01', '2026-01-01', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 1400000.00,
        '2601011078950540 (ref: FT26001010RT)');

-- Credit 11: 48965589 — 973,913.04 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-011-2026-01-03', '2026-01-03', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 973913.04,
        '48965589 (ref: FT26003DVRH8)');

-- Credit 12: 2601061078972223 — 1,500,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-012-2026-01-06', '2026-01-06', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 1500000.00,
        '2601061078972223 (ref: FT26006DG0DT)');

-- Credit 13: 2601121402231237 — 120,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-013-2026-01-12', '2026-01-12', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 120000.00,
        '2601121402231237 (ref: FT260129SC35)');

-- Credit 14: 2601120599719450 — 100,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-014-2026-01-12', '2026-01-12', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 100000.00,
        '2601120599719450 (ref: FT26012SY3S1)');

-- Credit 15: 2601121078990245 — 75,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-015-2026-01-12', '2026-01-12', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 75000.00,
        '2601121078990245 (ref: FT26012ZN1P8)');

-- Credit 16: 2601130599721278 — 500,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-016-2026-01-13', '2026-01-13', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 500000.00,
        '2601130599721278 (ref: FT260138TN4M)');

-- Credit 17: 2601141047717055 — 520,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-017-2026-01-14', '2026-01-14', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 520000.00,
        '2601141047717055 (ref: FT26014G7046)');

-- Credit 18: 2601141078998304 — 140,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-018-2026-01-14', '2026-01-14', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 140000.00,
        '2601141078998304 (ref: FT26014W2H06)');

-- Credit 19: 2601151005723279 — 254,380.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-019-2026-01-15', '2026-01-15', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 254380.00,
        '2601151005723279 (ref: FT26015RX60N)');

-- Credit 20: 2601171119297324 — 4,500,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-020-2026-01-17', '2026-01-17', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 4500000.00,
        '2601171119297324 (ref: FT26017LZMS5)');

-- Credit 21: 2601171047746950 — 400,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-021-2026-01-17', '2026-01-17', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 400000.00,
        '2601171047746950 (ref: FT260176P0W9)');

-- Credit 22: GOT26021KB0BMDJM — 900,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-022-2026-01-21', '2026-01-21', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 900000.00,
        'GOT26021KB0BMDJM (ref: FT260218ZB49)');

-- Credit 23: 2601211116299806 — 500,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-023-2026-01-21', '2026-01-21', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 500000.00,
        '2601211116299806 (ref: FT260216XGLD)');

-- Credit 24: 2601221119301646 — 2,000,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-024-2026-01-22', '2026-01-22', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 2000000.00,
        '2601221119301646 (ref: FT26022R7CT9)');

-- Credit 25: 2601231078121946 — 260,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-025-2026-01-23', '2026-01-23', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 260000.00,
        '2601231078121946 (ref: FT26023N311T)');

-- Credit 26: 2601230373735292 — 60,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-026-2026-01-23', '2026-01-23', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 60000.00,
        '2601230373735292 (ref: FT260237KCDP)');

-- Credit 27: 2601231067239917 — 90,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-027-2026-01-23', '2026-01-23', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 90000.00,
        '2601231067239917 (ref: FT26023444LV)');

-- Credit 28: REFUND — 95,155.20 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-028-2026-01-26', '2026-01-26', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 95155.20,
        'REFUND (ref: FT260265M40Q)');

-- Credit 29: FT26027QY3MN — 200,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-029-2026-01-28', '2026-01-28', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 200000.00,
        'FT26027QY3MN (ref: FT26028H87T3)');

-- Credit 30: EXHIBITION BOOTH — 135,269.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-030-2026-01-28', '2026-01-28', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 135269.00,
        'EXHIBITION BOOTH (ref: FT26028K4WYZ)');

-- Credit 31: 69003 — 5,658,240.80 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-031-2026-01-28', '2026-01-28', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 5658240.80,
        '69003 (ref: FT260289WB61)');

-- Credit 32: DBB/6152/26 — 430,080.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-032-2026-02-03', '2026-02-03', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 430080.00,
        'DBB/6152/26 (ref: FT26034VS6Z1)');

-- Credit 33: SAR26034DMMLJHFH — 2,000,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-033-2026-02-03', '2026-02-03', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 2000000.00,
        'SAR26034DMMLJHFH (ref: FT260349BFRT)');

-- Credit 34: 12632700 — 23,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-034-2026-02-04', '2026-02-04', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 23000.00,
        '12632700 (ref: FT26035P8VKW)');

-- Credit 35: 26425030 — 448,710.50 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-035-2026-02-04', '2026-02-04', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 448710.50,
        '26425030 (ref: FT2603509DZS)');

-- Credit 36: SAR26036DL0HCKBH — 900,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-036-2026-02-05', '2026-02-05', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 900000.00,
        'SAR26036DL0HCKBH (ref: FT26036CW1XX)');

-- Credit 37: 2602071106326493 — 2,500,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-037-2026-02-07', '2026-02-07', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 2500000.00,
        '2602071106326493 (ref: FT260380R4GP)');

-- Credit 38: 2602121112334708 — 400,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-038-2026-02-12', '2026-02-12', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 400000.00,
        '2602121112334708 (ref: FT26043XH15S)');

-- Credit 39: booth cons. — 135,269.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-039-2026-02-14', '2026-02-14', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 135269.00,
        'booth cons. (ref: FT26045F1XPN)');

-- Credit 40: FT26045YVZPX — 1,100,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-040-2026-02-16', '2026-02-16', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 1100000.00,
        'FT26045YVZPX (ref: FT26047X2VWN)');

-- Credit 41: 1948248 — 448,710.87 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-041-2026-02-16', '2026-02-16', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 448710.87,
        '1948248 (ref: FT260475KKMP)');

-- Credit 42: CPV7273 KUNCHO — 20,537,487.60 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-042-2026-02-17', '2026-02-17', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 20537487.60,
        'CPV7273 KUNCHO (ref: FT26048Y13RJ)');

-- Credit 43: 52097051 — 1,120,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-043-2026-02-19', '2026-02-19', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 1120000.00,
        '52097051 (ref: FT260502MBXY)');

-- Credit 44: CPV7288 KUNCHO — 5,351,116.52 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-044-2026-02-19', '2026-02-19', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 5351116.52,
        'CPV7288 KUNCHO (ref: FT26050Q3JH2)');

-- Credit 45: DC48ES7KCW — 30,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-045-2026-03-04', '2026-03-04', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 30000.00,
        'DC48ES7KCW (ref: FT26063KC65G)');

-- Credit 46: KUNCHO TRADING P — 238,896.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-046-2026-03-07', '2026-03-07', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 238896.00,
        'KUNCHO TRADING P (ref: FT26066YWMHP)');

-- Credit 47: BKB26068MFDJHC0G — 100,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-047-2026-03-09', '2026-03-09', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 100000.00,
        'BKB26068MFDJHC0G (ref: FT26068KFCFF)');

-- Credit 48: (blank) — 138,992.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-048-2026-03-13', '2026-03-13', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 138992.00,
        ' (ref: TT26070KMC4J)');

-- Credit 49: 2603141067283158 — 52,220.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-049-2026-03-14', '2026-03-14', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 52220.00,
        '2603141067283158 (ref: FT26073VMSMY)');

-- Credit 50: JR/0574/2026 — 876,764.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-050-2026-03-14', '2026-03-14', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 876764.00,
        'JR/0574/2026 (ref: FT26073959V1)');

-- Credit 51: 2603171314378992 — 390,137.50 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-051-2026-03-17', '2026-03-17', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 390137.50,
        '2603171314378992 (ref: FT26076T2G3R)');

-- Credit 52: FT26078MR6H9 — 700,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-052-2026-03-19', '2026-03-19', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 700000.00,
        'FT26078MR6H9 (ref: FT2607866WGH)');

-- Credit 53: 2603213366446199 — 233,639.75 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-053-2026-03-21', '2026-03-21', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 233639.75,
        '2603213366446199 (ref: FT260808S68R)');

-- Credit 54: (blank) — 262,080.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-054-2026-03-24', '2026-03-24', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 262080.00,
        ' (ref: FT26083T6TTD)');

-- Credit 55: CPV7364 KUNCHO — 347,200.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-055-2026-03-24', '2026-03-24', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 347200.00,
        'CPV7364 KUNCHO (ref: FT2608335FK6)');

-- Credit 56: FT260858Q8HK — 350,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-056-2026-03-26', '2026-03-26', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 350000.00,
        'FT260858Q8HK (ref: FT26085F2HQH)');

-- Credit 57: CPV7372 KUNCH — 593,600.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-057-2026-03-26', '2026-03-26', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 593600.00,
        'CPV7372 KUNCH (ref: FT26085GXNFW)');

-- Credit 58: 52022289 — 138,992.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-058-2026-03-27', '2026-03-27', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 138992.00,
        '52022289 (ref: FT26086SMJ32)');

-- Credit 59: 2603271067294885 — 52,219.76 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-059-2026-03-28', '2026-03-28', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 52219.76,
        '2603271067294885 (ref: FT26087W3Q3D)');

-- Credit 60: 2603311314394292 — 369,782.50 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-060-2026-03-31', '2026-03-31', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 369782.50,
        '2603311314394292 (ref: FT260917H7T5)');

-- Credit 61: 2604021072372993 — 1,500,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-061-2026-04-02', '2026-04-02', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 1500000.00,
        '2604021072372993 (ref: FT26092L3RVG)');

-- Credit 62: 2604041189383312 — 700,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-062-2026-04-04', '2026-04-04', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 700000.00,
        '2604041189383312 (ref: FT260947Y7K0)');

-- Credit 63: 2604060769149205 — 233,639.75 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-063-2026-04-06', '2026-04-06', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 233639.75,
        '2604060769149205 (ref: FT26096XJY3M)');

-- Credit 64: 2604071418304416 — 211,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-064-2026-04-07', '2026-04-07', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 211000.00,
        '2604071418304416 (ref: FT2609773542)');

-- Credit 65: Misc Products do — 89,617.92 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-065-2026-04-07', '2026-04-07', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 89617.92,
        'Misc Products do (ref: FT26097DQX0L)');

-- Credit 66: 2604071097395779 — 300,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-066-2026-04-07', '2026-04-07', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 300000.00,
        '2604071097395779 (ref: FT26097GBQVM)');

-- Credit 67: 51497172 — 2,447,480.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-067-2026-04-07', '2026-04-07', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 2447480.00,
        '51497172 (ref: FT26097LWCD8)');

-- Credit 68: FT260980MGZP — 350,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-068-2026-04-08', '2026-04-08', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 350000.00,
        'FT260980MGZP (ref: FT260989ZMXV)');

-- Credit 69: CPV7417 KUNCHO — 2,500,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-069-2026-04-16', '2026-04-16', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 2500000.00,
        'CPV7417 KUNCHO (ref: FT26106HN3W2)');

-- Credit 70: 2604221161419536 — 1,000,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-070-2026-04-22', '2026-04-22', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 1000000.00,
        '2604221161419536 (ref: FT26112NPM6W)');

-- Credit 71: 26826879 — 3,928,860.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-071-2026-04-23', '2026-04-23', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 3928860.00,
        '26826879 (ref: FT26113G9PF7)');

-- Credit 72: (blank) — 448,710.87 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-072-2026-04-23', '2026-04-23', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 448710.87,
        ' (ref: FT26113YXPKR)');

-- Credit 73: 2604271161425970 — 780,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-073-2026-04-27', '2026-04-27', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 780000.00,
        '2604271161425970 (ref: FT26117GFLDJ)');

-- Credit 74: 2604291145472267 — 480,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-074-2026-04-29', '2026-04-29', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 480000.00,
        '2604291145472267 (ref: FT26119073TB)');

-- Credit 75: CPV7451 KUNCHO — 2,500,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-075-2026-04-30', '2026-04-30', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 2500000.00,
        'CPV7451 KUNCHO (ref: FT26120BRVFX)');

-- Credit 76: 2605081161442755 — 270,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-076-2026-05-08', '2026-05-08', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 270000.00,
        '2605081161442755 (ref: FT261280XNM4)');

-- Credit 77: DE82OP56O8 — 121,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-077-2026-05-08', '2026-05-08', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 121000.00,
        'DE82OP56O8 (ref: FT26128NW12P)');

-- Credit 78: A2A TRANSFER — 3,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-078-2026-05-12', '2026-05-12', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 3000.00,
        'A2A TRANSFER (ref: FT26132YH66S)');

-- Credit 79: 50496733 — 486,956.52 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-079-2026-05-12', '2026-05-12', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 486956.52,
        '50496733 (ref: FT26132DR21B)');

-- Credit 80: 12720120 — 200,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-080-2026-05-14', '2026-05-14', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 200000.00,
        '12720120 (ref: FT26134XH0JK)');

-- Credit 81: 0001TRA1351953 — 17,931,290.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-081-2026-05-15', '2026-05-15', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 17931290.00,
        '0001TRA1351953 (ref: FT261357MZ7G)');

-- Credit 82: TRANSFER — 500,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-082-2026-05-15', '2026-05-15', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 500000.00,
        'TRANSFER (ref: FT261354ZPM0)');

-- Credit 83: MR03850/2026 — 665,517.48 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-083-2026-05-30', '2026-05-30', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 665517.48,
        'MR03850/2026 (ref: FT26150PCMKH)');

-- Credit 84: 2606097610630021 — 200,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-084-2026-06-09', '2026-06-09', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 200000.00,
        '2606097610630021 (ref: FT26160056QX)');

-- Credit 85: 54510911 — 269,854.03 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-085-2026-06-11', '2026-06-11', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 269854.03,
        '54510911 (ref: FT261623HY1X)');

-- Credit 86: 50616245 — 2,941,700.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-086-2026-06-13', '2026-06-13', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 2941700.00,
        '50616245 (ref: FT26164MXLNY)');

-- Credit 87: 2606131161489133 — 3,000,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-087-2026-06-13', '2026-06-13', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 3000000.00,
        '2606131161489133 (ref: FT261640TQ8L)');

-- Credit 88: FT261732VWVF — 168,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-088-2026-06-22', '2026-06-22', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 168000.00,
        'FT261732VWVF (ref: FT26173QSHYT)');

-- Credit 89: 2606231145642413 — 1,500,000.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-CR-089-2026-06-23', '2026-06-23', NULL,
        '890c3473-dc57-4c01-9f39-17518047c463', 1500000.00,
        '2606231145642413 (ref: FT26174D1B8G)');

-- ── SIGNIFICANT DEBITS > 500,000 ETB (outflows from CBE) ─────────────────────
-- (Debits matched to expense records are handled in the UPDATE section below)

-- Significant debit 1: 251203ET — 1,266,092.71 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-001-2025-12-03', '2025-12-03',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1266092.71,
        '251203ET (ref: FT25337VHG2D)');

-- Significant debit 2: 251203TY — 1,199,087.49 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-002-2025-12-04', '2025-12-04',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1199087.49,
        '251203TY (ref: FT253386NSJH)');

-- Significant debit 3: 251203CZA — 705,605.75 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-003-2025-12-04', '2025-12-04',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 705605.75,
        '251203CZA (ref: FT25338QW7VS)');

-- Significant debit 4: 251209NUM — 1,413,703.97 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-004-2025-12-09', '2025-12-09',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1413703.97,
        '251209NUM (ref: FT253435VBH1)');

-- Significant debit 5: 251216HUS — 523,805.75 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-005-2025-12-16', '2025-12-16',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 523805.75,
        '251216HUS (ref: FT25350QD79X)');

-- Significant debit 6: 251226ADO — 1,266,092.71 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-006-2025-12-26', '2025-12-26',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1266092.71,
        '251226ADO (ref: FT25360YJPXH)');

-- Significant debit 7: 260102ZAM — 1,624,505.75 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-007-2026-01-02', '2026-01-02',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1624505.75,
        '260102ZAM (ref: FT26002MT9N4)');

-- Significant debit 8: 260113HER — 633,049.23 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-008-2026-01-13', '2026-01-13',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 633049.23,
        '260113HER (ref: FT26013507G3)');

-- Significant debit 9: 260117ZAM — 1,120,005.75 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-009-2026-01-17', '2026-01-17',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1120005.75,
        '260117ZAM (ref: FT2601735MN3)');

-- Significant debit 10: KUNCHO TRADING — 3,407,363.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-010-2026-01-21', '2026-01-21',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 3407363.00,
        'KUNCHO TRADING (ref: FT26021CQ8BL)');

-- Significant debit 11: BATCHONESTOP — 700,005.75 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-011-2026-01-22', '2026-01-22',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 700005.75,
        'BATCHONESTOP (ref: FT26022KWLWV)');

-- Significant debit 12: BATCH Payment — 984,286.10 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-012-2026-01-29', '2026-01-29',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 984286.10,
        'BATCH Payment (ref: FT26029PRFCX)');

-- Significant debit 13: 260207ET — 1,947,831.84 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-013-2026-02-07', '2026-02-07',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1947831.84,
        '260207ET (ref: FT2603839P5R)');

-- Significant debit 14: 260224ARE — 801,929.32 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-014-2026-02-24', '2026-02-24',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 801929.32,
        '260224ARE (ref: FT26055G8L9J)');

-- Significant debit 15: 260228ET — 1,477,577.20 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-015-2026-02-28', '2026-02-28',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1477577.20,
        '260228ET (ref: FT260599BPCG)');

-- Significant debit 16: 260228ETH — 2,475,137.83 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-016-2026-02-28', '2026-02-28',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 2475137.83,
        '260228ETH (ref: FT26059QF351)');

-- Significant debit 17: 260304IVE — 6,833,006.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-017-2026-03-05', '2026-03-05',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 6833006.00,
        '260304IVE (ref: FT26064NKTMF)');

-- Significant debit 18: 260306ET — 1,000,006.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-018-2026-03-06', '2026-03-06',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1000006.00,
        '260306ET (ref: FT26065Z6VGP)');

-- Significant debit 19: 260306ET — 1,577,855.28 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-019-2026-03-07', '2026-03-07',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1577855.28,
        '260306ET (ref: FT26066N10B7)');

-- Significant debit 20: BATCHONESTOP — 701,756.36 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-020-2026-04-08', '2026-04-08',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 701756.36,
        'BATCHONESTOP (ref: FT26098F0T0Y)');

-- Significant debit 21: 260408UNI — 981,710.35 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-021-2026-04-08', '2026-04-08',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 981710.35,
        '260408UNI (ref: FT26098TC7SC)');

-- Significant debit 22: 260430YOM — 715,832.09 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-022-2026-04-30', '2026-04-30',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 715832.09,
        '260430YOM (ref: FT26120ZX8VH)');

-- Significant debit 23: 260504SHU — 500,006.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-023-2026-05-04', '2026-05-04',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 500006.00,
        '260504SHU (ref: FT261249XGT6)');

-- Significant debit 24: 260516TY — 737,751.13 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-024-2026-05-16', '2026-05-16',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 737751.13,
        '260516TY (ref: FT26136SL8WT)');

-- Significant debit 25: 260516TY — 737,745.13 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-025-2026-05-16', '2026-05-16',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 737745.13,
        '260516TY (ref: FT26136ZNB7J)');

-- Significant debit 26: BATCHHANAN — 618,771.22 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-026-2026-05-18', '2026-05-18',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 618771.22,
        'BATCHHANAN (ref: FT261382Z42V)');

-- Significant debit 27: 260519TY — 1,123,706.87 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-027-2026-05-19', '2026-05-19',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1123706.87,
        '260519TY (ref: FT261394FS7X)');

-- Significant debit 28: 260519ABI — 973,919.04 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-028-2026-05-19', '2026-05-19',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 973919.04,
        '260519ABI (ref: FT26139H6ZP3)');

-- Significant debit 29: 260520ET — 1,507,310.96 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-029-2026-05-20', '2026-05-20',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1507310.96,
        '260520ET (ref: FT261409CNFY)');

-- Significant debit 30: 260520MER — 760,052.13 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-030-2026-05-20', '2026-05-20',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 760052.13,
        '260520MER (ref: FT26140NV9G3)');

-- Significant debit 31: 260523SHU — 600,006.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-031-2026-05-23', '2026-05-23',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 600006.00,
        '260523SHU (ref: FT26143K8B9H)');

-- Significant debit 32: 260526SHU — 600,006.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-032-2026-05-26', '2026-05-26',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 600006.00,
        '260526SHU (ref: FT261469JPWN)');

-- Significant debit 33: FT261491XJ0L — 1,523,365.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-033-2026-05-29', '2026-05-29',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 1523365.00,
        'FT261491XJ0L (ref: FT261491XJ0L)');

-- Significant debit 34: 260605ET — 681,798.00 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-034-2026-06-06', '2026-06-06',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 681798.00,
        '260605ET (ref: FT26157RGNL0)');

-- Significant debit 35: 260613ABI — 973,919.04 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-035-2026-06-13', '2026-06-13',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 973919.04,
        '260613ABI (ref: FT26164SK8PX)');

-- Significant debit 36: BATCHPAYMENT — 671,399.53 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SIG-036-2026-06-16', '2026-06-16',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 671399.53,
        'BATCHPAYMENT (ref: FT261676V9G1)');

-- ── NAMED SPECIAL DEBITS (batch payments, salary, etc.) ─────────────────────

-- Special debit 1: OneStop — 53,768.90 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SPEC-001-2025-12-04', '2025-12-04',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 53768.90,
        'OneStop (ref: FT25338MH04Q)');

-- Special debit 2: OneStop Credit — 402,070.37 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SPEC-002-2025-12-04', '2025-12-04',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 402070.37,
        'OneStop Credit (ref: FT25338M9ZDL)');

-- Special debit 3: Batch Payment — 270,002.62 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SPEC-003-2026-01-31', '2026-01-31',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 270002.62,
        'Batch Payment (ref: FT26031KN7PQ)');

-- Special debit 4: FETBATCH — 119,699.91 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SPEC-004-2026-04-08', '2026-04-08',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 119699.91,
        'FETBATCH (ref: FT26098D8DYR)');

-- Special debit 5: BATCHONE — 407,853.23 ETB
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-DR-SPEC-005-2026-04-23', '2026-04-23',
        '890c3473-dc57-4c01-9f39-17518047c463', NULL, 407853.23,
        'BATCHONE (ref: FT261131P3ZW)');

-- ── SENTINEL (prevents double-import) ──────────────────────────────────────
INSERT INTO public.transfers (id, transfer_id_code, date, from_account_id, to_account_id, amount, notes)
VALUES (gen_random_uuid(), 'CBE-IMPORT-SENTINEL', '2026-06-24', NULL, NULL, 0,
        'Import sentinel — CBE account 1000504664272, statement 01 DEC 2025–24 JUN 2026');

END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- B. UPDATE EXPENSES — mark matched ones as paid via CBE
-- ══════════════════════════════════════════════════════════════════════════

-- Deduplicated updates: one UPDATE per unique Airtable bank_ref
-- 388 total matches; grouped by bank_ref to avoid duplicate statements

-- bank_ref: FT25335W1MDN | CBE ref: FT25335W1MDN | date: 2025-12-01 | CBE amount: 23,379.66
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25335W1MDN',
  paid_date      = '2025-12-01T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25335W1MDN';

-- bank_ref: FT25335RT3LJ | CBE ref: FT25335RT3LJ | date: 2025-12-01 | CBE amount: 16,805.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25335RT3LJ',
  paid_date      = '2025-12-01T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25335RT3LJ';

-- bank_ref: FT25336H5RMZ | CBE ref: FT25336H5RMZ | date: 2025-12-02 | CBE amount: 89,469.40
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25336H5RMZ',
  paid_date      = '2025-12-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25336H5RMZ';

-- bank_ref: FT253383ND05 | CBE ref: FT253383ND05 | date: 2025-12-04 | CBE amount: 2,505.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253383ND05',
  paid_date      = '2025-12-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253383ND05';

-- bank_ref: FT25338Y5PTD | CBE ref: FT25338Y5PTD | date: 2025-12-04 | CBE amount: 3,905.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25338Y5PTD',
  paid_date      = '2025-12-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25338Y5PTD';

-- bank_ref: FT25338L4Q98 | CBE ref: FT25338L4Q98 | date: 2025-12-04 | CBE amount: 181,313.44
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25338L4Q98',
  paid_date      = '2025-12-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25338L4Q98';

-- bank_ref: FT253386N2FZ | CBE ref: FT253386N2FZ | date: 2025-12-04 | CBE amount: 36,527.49
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253386N2FZ',
  paid_date      = '2025-12-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253386N2FZ';

-- bank_ref: FT25339ZV0V7 | CBE ref: FT25339ZV0V7 | date: 2025-12-05 | CBE amount: 24,840.53
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25339ZV0V7',
  paid_date      = '2025-12-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25339ZV0V7';

-- bank_ref: FT25339969FW | CBE ref: FT25339969FW | date: 2025-12-05 | CBE amount: 5,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25339969FW',
  paid_date      = '2025-12-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25339969FW';

-- bank_ref: FT25339YYM6V | CBE ref: FT25339YYM6V | date: 2025-12-05 | CBE amount: 84,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25339YYM6V',
  paid_date      = '2025-12-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25339YYM6V';

-- bank_ref: FT25340N6Y4B | CBE ref: FT25340N6Y4B | date: 2025-12-06 | CBE amount: 22,955.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25340N6Y4B',
  paid_date      = '2025-12-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25340N6Y4B';

-- bank_ref: FT25340RT74F | CBE ref: FT25340RT74F | date: 2025-12-06 | CBE amount: 72,708.36
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25340RT74F',
  paid_date      = '2025-12-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25340RT74F';

-- bank_ref: FT253423H12V | CBE ref: FT253423H12V | date: 2025-12-08 | CBE amount: 46,169.23
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253423H12V',
  paid_date      = '2025-12-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253423H12V';

-- bank_ref: FT2534289GZJ | CBE ref: FT2534289GZJ | date: 2025-12-08 | CBE amount: 1,168,701.40
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2534289GZJ',
  paid_date      = '2025-12-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2534289GZJ';

-- bank_ref: FT25342W5C27 | CBE ref: FT25342W5C27 | date: 2025-12-08 | CBE amount: 57,953.58
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25342W5C27',
  paid_date      = '2025-12-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25342W5C27';

-- bank_ref: FT25342MXZV9 | CBE ref: FT25342MXZV9 | date: 2025-12-08 | CBE amount: 173,539.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25342MXZV9',
  paid_date      = '2025-12-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25342MXZV9';

-- bank_ref: FT25342211Q1 | CBE ref: FT25342211Q1 | date: 2025-12-08 | CBE amount: 16,450.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25342211Q1',
  paid_date      = '2025-12-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25342211Q1';

-- bank_ref: FT25343FHYFQ | CBE ref: FT25343FHYFQ | date: 2025-12-09 | CBE amount: 46,060.15
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25343FHYFQ',
  paid_date      = '2025-12-09T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25343FHYFQ';

-- bank_ref: FT253448DDZV | CBE ref: FT253448DDZV | date: 2025-12-10 | CBE amount: 6,545.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253448DDZV',
  paid_date      = '2025-12-10T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253448DDZV';

-- bank_ref: FT25344HQ9N0 | CBE ref: FT25344HQ9N0 | date: 2025-12-10 | CBE amount: 41,333.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25344HQ9N0',
  paid_date      = '2025-12-10T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25344HQ9N0';

-- bank_ref: FT25344BF21W | CBE ref: FT25344BF21W | date: 2025-12-10 | CBE amount: 49,675.32
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25344BF21W',
  paid_date      = '2025-12-10T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25344BF21W';

-- bank_ref: FT25344PBQLK | CBE ref: FT25344PBQLK | date: 2025-12-10 | CBE amount: 12,115.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25344PBQLK',
  paid_date      = '2025-12-10T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25344PBQLK';

-- bank_ref: FT25345SBD2Y | CBE ref: FT25345SBD2Y | date: 2025-12-11 | CBE amount: 4,817.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25345SBD2Y',
  paid_date      = '2025-12-11T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25345SBD2Y';

-- bank_ref: FT25345CQGTQ | CBE ref: FT25345CQGTQ | date: 2025-12-11 | CBE amount: 12,930.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25345CQGTQ',
  paid_date      = '2025-12-11T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25345CQGTQ';

-- bank_ref: FT25346SBTTN | CBE ref: FT25346SBTTN | date: 2025-12-12 | CBE amount: 1,830.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25346SBTTN',
  paid_date      = '2025-12-12T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25346SBTTN';

-- bank_ref: FT2534717ZNC | CBE ref: FT2534717ZNC | date: 2025-12-13 | CBE amount: 3,225.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2534717ZNC',
  paid_date      = '2025-12-13T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2534717ZNC';

-- bank_ref: FT25347J8ZH3 | CBE ref: FT25347J8ZH3 | date: 2025-12-13 | CBE amount: 26,593.58
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25347J8ZH3',
  paid_date      = '2025-12-13T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25347J8ZH3';

-- bank_ref: FT25347FLJDS | CBE ref: FT25347FLJDS | date: 2025-12-13 | CBE amount: 5,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25347FLJDS',
  paid_date      = '2025-12-13T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25347FLJDS';

-- bank_ref: FT253490XBQC | CBE ref: FT253490XBQC | date: 2025-12-15 | CBE amount: 62,336.18
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253490XBQC',
  paid_date      = '2025-12-15T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253490XBQC';

-- bank_ref: FT25349LLQX0 | CBE ref: FT25349LLQX0 | date: 2025-12-15 | CBE amount: 120,331.73
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25349LLQX0',
  paid_date      = '2025-12-15T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25349LLQX0';

-- bank_ref: FT2535042K23 | CBE ref: FT2535042K23 | date: 2025-12-16 | CBE amount: 230,954.47
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2535042K23',
  paid_date      = '2025-12-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2535042K23';

-- bank_ref: FT25350C4HLW | CBE ref: FT25350C4HLW | date: 2025-12-16 | CBE amount: 4,595.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25350C4HLW',
  paid_date      = '2025-12-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25350C4HLW';

-- bank_ref: FT25350CYQZ2 | CBE ref: FT25350CYQZ2 | date: 2025-12-16 | CBE amount: 177,257.92
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25350CYQZ2',
  paid_date      = '2025-12-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25350CYQZ2';

-- bank_ref: FT253506QJW4 | CBE ref: FT253506QJW4 | date: 2025-12-16 | CBE amount: 57,807.49
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253506QJW4',
  paid_date      = '2025-12-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253506QJW4';

-- bank_ref: FT25351W9HNH | CBE ref: FT25351W9HNH | date: 2025-12-17 | CBE amount: 44,708.36
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25351W9HNH',
  paid_date      = '2025-12-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25351W9HNH';

-- bank_ref: FT25351Y4CDX | CBE ref: FT25351Y4CDX | date: 2025-12-17 | CBE amount: 24,840.53
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25351Y4CDX',
  paid_date      = '2025-12-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25351Y4CDX';

-- bank_ref: FT253513348B | CBE ref: FT253513348B | date: 2025-12-17 | CBE amount: 2,789.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253513348B',
  paid_date      = '2025-12-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253513348B';

-- bank_ref: FT25351T9BMV | CBE ref: FT25351T9BMV | date: 2025-12-17 | CBE amount: 19,085.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25351T9BMV',
  paid_date      = '2025-12-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25351T9BMV';

-- bank_ref: FT25352MLYQW | CBE ref: FT25352MLYQW | date: 2025-12-18 | CBE amount: 171,326.79
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25352MLYQW',
  paid_date      = '2025-12-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25352MLYQW';

-- bank_ref: FT253523VPKR | CBE ref: FT253523VPKR | date: 2025-12-18 | CBE amount: 11,351.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253523VPKR',
  paid_date      = '2025-12-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253523VPKR';

-- bank_ref: FT25352FPQQD | CBE ref: FT25352FPQQD | date: 2025-12-18 | CBE amount: 12,505.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25352FPQQD',
  paid_date      = '2025-12-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25352FPQQD';

-- bank_ref: FT25353MYJJ0 | CBE ref: FT25353MYJJ0 | date: 2025-12-19 | CBE amount: 29,708.15
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25353MYJJ0',
  paid_date      = '2025-12-19T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25353MYJJ0';

-- bank_ref: FT25354T6MPP | CBE ref: FT25354T6MPP | date: 2025-12-20 | CBE amount: 87,950.10
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25354T6MPP',
  paid_date      = '2025-12-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25354T6MPP';

-- bank_ref: FT253541TH2V | CBE ref: FT253541TH2V | date: 2025-12-20 | CBE amount: 29,223.14
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253541TH2V',
  paid_date      = '2025-12-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253541TH2V';

-- bank_ref: FT253568RP76 | CBE ref: FT253568RP76 | date: 2025-12-22 | CBE amount: 29,953.58
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253568RP76',
  paid_date      = '2025-12-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253568RP76';

-- bank_ref: FT25356YBLZ0 | CBE ref: FT25356YBLZ0 | date: 2025-12-22 | CBE amount: 9,765.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25356YBLZ0',
  paid_date      = '2025-12-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25356YBLZ0';

-- bank_ref: FT253566JHN0 | CBE ref: FT253566JHN0 | date: 2025-12-22 | CBE amount: 15,254.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253566JHN0',
  paid_date      = '2025-12-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253566JHN0';

-- bank_ref: FT25356N2J8F | CBE ref: FT25356N2J8F | date: 2025-12-22 | CBE amount: 4,117.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25356N2J8F',
  paid_date      = '2025-12-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25356N2J8F';

-- bank_ref: FT253571S15B | CBE ref: FT253571S15B | date: 2025-12-23 | CBE amount: 456,128.18
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253571S15B',
  paid_date      = '2025-12-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253571S15B';

-- bank_ref: FT25357WT3BV | CBE ref: FT25357WT3BV | date: 2025-12-23 | CBE amount: 1,040.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25357WT3BV',
  paid_date      = '2025-12-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25357WT3BV';

-- bank_ref: FT253574QX7S | CBE ref: FT253574QX7S | date: 2025-12-23 | CBE amount: 40,988.01
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253574QX7S',
  paid_date      = '2025-12-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253574QX7S';

-- bank_ref: FT253572PL1K | CBE ref: FT253572PL1K | date: 2025-12-23 | CBE amount: 2,140.15
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253572PL1K',
  paid_date      = '2025-12-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253572PL1K';

-- bank_ref: FT25357V5Y9S | CBE ref: FT25357V5Y9S | date: 2025-12-23 | CBE amount: 109,424.88
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25357V5Y9S',
  paid_date      = '2025-12-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25357V5Y9S';

-- bank_ref: FT25358KSGVP | CBE ref: FT25358KSGVP | date: 2025-12-24 | CBE amount: 29,223.14
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25358KSGVP',
  paid_date      = '2025-12-24T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25358KSGVP';

-- bank_ref: FT253587WFD0 | CBE ref: FT253587WFD0 | date: 2025-12-24 | CBE amount: 134,639.49
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253587WFD0',
  paid_date      = '2025-12-24T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253587WFD0';

-- bank_ref: FT253580LPTZ | CBE ref: FT253580LPTZ | date: 2025-12-24 | CBE amount: 5,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253580LPTZ',
  paid_date      = '2025-12-24T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253580LPTZ';

-- bank_ref: FT25358MR4S3 | CBE ref: FT25358MR4S3 | date: 2025-12-24 | CBE amount: 52,858.55
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25358MR4S3',
  paid_date      = '2025-12-24T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25358MR4S3';

-- bank_ref: FT25359ZP6PL | CBE ref: FT25359ZP6PL | date: 2025-12-25 | CBE amount: 64,235.32
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25359ZP6PL',
  paid_date      = '2025-12-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25359ZP6PL';

-- bank_ref: FT25360G7R4J | CBE ref: FT25360G7R4J | date: 2025-12-26 | CBE amount: 1,109.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25360G7R4J',
  paid_date      = '2025-12-26T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25360G7R4J';

-- bank_ref: FT25361T9YC5 | CBE ref: FT25361T9YC5 | date: 2025-12-27 | CBE amount: 459,908.66
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25361T9YC5',
  paid_date      = '2025-12-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25361T9YC5';

-- bank_ref: FT25361FSKQF | CBE ref: FT25361FSKQF | date: 2025-12-27 | CBE amount: 32,437.05
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25361FSKQF',
  paid_date      = '2025-12-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25361FSKQF';

-- bank_ref: FT25361XBYVF | CBE ref: FT25361XBYVF | date: 2025-12-27 | CBE amount: 344,527.49
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25361XBYVF',
  paid_date      = '2025-12-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25361XBYVF';

-- bank_ref: FT25361490SJ | CBE ref: FT25361490SJ | date: 2025-12-27 | CBE amount: 166,885.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25361490SJ',
  paid_date      = '2025-12-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25361490SJ';

-- bank_ref: FT253613DJQG | CBE ref: FT253613DJQG | date: 2025-12-27 | CBE amount: 32,943.49
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253613DJQG',
  paid_date      = '2025-12-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253613DJQG';

-- bank_ref: FT25361X1HCX | CBE ref: FT25361X1HCX | date: 2025-12-27 | CBE amount: 35,456.18
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25361X1HCX',
  paid_date      = '2025-12-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25361X1HCX';

-- bank_ref: FT25361S6BQR | CBE ref: FT25361S6BQR | date: 2025-12-27 | CBE amount: 411,431.03
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25361S6BQR',
  paid_date      = '2025-12-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25361S6BQR';

-- bank_ref: FT25361YJ1PM | CBE ref: FT25361YJ1PM | date: 2025-12-27 | CBE amount: 51,623.14
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25361YJ1PM',
  paid_date      = '2025-12-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25361YJ1PM';

-- bank_ref: FT25363NB5RQ | CBE ref: FT25363NB5RQ | date: 2025-12-29 | CBE amount: 42,397.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25363NB5RQ',
  paid_date      = '2025-12-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25363NB5RQ';

-- bank_ref: FT25363HXP7L | CBE ref: FT25363HXP7L | date: 2025-12-29 | CBE amount: 57,573.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25363HXP7L',
  paid_date      = '2025-12-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25363HXP7L';

-- bank_ref: FT2536474JVQ | CBE ref: FT2536474JVQ | date: 2025-12-30 | CBE amount: 100,139.59
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2536474JVQ',
  paid_date      = '2025-12-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2536474JVQ';

-- bank_ref: FT25364LTG8P | CBE ref: FT25364LTG8P | date: 2025-12-30 | CBE amount: 4,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25364LTG8P',
  paid_date      = '2025-12-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25364LTG8P';

-- bank_ref: FT25364QZBL6 | CBE ref: FT25364QZBL6 | date: 2025-12-30 | CBE amount: 7,545.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25364QZBL6',
  paid_date      = '2025-12-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25364QZBL6';

-- bank_ref: FT25364T0WSC | CBE ref: FT25364T0WSC | date: 2025-12-30 | CBE amount: 36,527.49
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25364T0WSC',
  paid_date      = '2025-12-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25364T0WSC';

-- bank_ref: FT25364R0W1W | CBE ref: FT25364R0W1W | date: 2025-12-30 | CBE amount: 2,855.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25364R0W1W',
  paid_date      = '2025-12-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25364R0W1W';

-- bank_ref: FT25364NJ1ZN | CBE ref: FT25364NJ1ZN | date: 2025-12-30 | CBE amount: 42,565.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25364NJ1ZN',
  paid_date      = '2025-12-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25364NJ1ZN';

-- bank_ref: FT25365HQPN9 | CBE ref: FT25365HQPN9 | date: 2025-12-31 | CBE amount: 17,405.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25365HQPN9',
  paid_date      = '2025-12-31T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25365HQPN9';

-- bank_ref: FT25365Z3WW5 | CBE ref: FT25365Z3WW5 | date: 2025-12-31 | CBE amount: 48,701.40
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25365Z3WW5',
  paid_date      = '2025-12-31T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25365Z3WW5';

-- bank_ref: FT25365VXHVH | CBE ref: FT25365VXHVH | date: 2025-12-31 | CBE amount: 33,435.32
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25365VXHVH',
  paid_date      = '2025-12-31T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25365VXHVH';

-- bank_ref: FT25365C0WL3 | CBE ref: FT25365C0WL3 | date: 2025-12-31 | CBE amount: 6,905.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25365C0WL3',
  paid_date      = '2025-12-31T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25365C0WL3';

-- bank_ref: FT253651Z54H | CBE ref: FT253651Z54H | date: 2025-12-31 | CBE amount: 14,465.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT253651Z54H',
  paid_date      = '2025-12-31T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT253651Z54H';

-- bank_ref: FT25365NG0XX | CBE ref: FT25365NG0XX | date: 2025-12-31 | CBE amount: 39,644.01
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT25365NG0XX',
  paid_date      = '2025-12-31T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT25365NG0XX';

-- bank_ref: FT26001X3584 | CBE ref: FT26001X3584 | date: 2026-01-01 | CBE amount: 307,129.23
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26001X3584',
  paid_date      = '2026-01-01T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26001X3584';

-- bank_ref: FT26001WWXL9 | CBE ref: FT26001WWXL9 | date: 2026-01-01 | CBE amount: 4,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26001WWXL9',
  paid_date      = '2026-01-01T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26001WWXL9';

-- bank_ref: FT260012F9H4 | CBE ref: FT260012F9H4 | date: 2026-01-01 | CBE amount: 10,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260012F9H4',
  paid_date      = '2026-01-01T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260012F9H4';

-- bank_ref: FT26001GBLW1 | CBE ref: FT26001GBLW1 | date: 2026-01-01 | CBE amount: 52,597.05
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26001GBLW1',
  paid_date      = '2026-01-01T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26001GBLW1';

-- bank_ref: FT260018BYLL | CBE ref: FT260018BYLL | date: 2026-01-01 | CBE amount: 29,708.15
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260018BYLL',
  paid_date      = '2026-01-01T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260018BYLL';

-- bank_ref: FT26002JQKJ6 | CBE ref: FT26002JQKJ6 | date: 2026-01-02 | CBE amount: 2,205.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26002JQKJ6',
  paid_date      = '2026-01-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26002JQKJ6';

-- bank_ref: FT26002Q915B | CBE ref: FT26002Q915B | date: 2026-01-02 | CBE amount: 22,600.53
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26002Q915B',
  paid_date      = '2026-01-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26002Q915B';

-- bank_ref: FT26002PNB88 | CBE ref: FT26002PNB88 | date: 2026-01-02 | CBE amount: 26,652.01
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26002PNB88',
  paid_date      = '2026-01-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26002PNB88';

-- bank_ref: FT26003VMCN7 | CBE ref: FT26003VMCN7 | date: 2026-01-03 | CBE amount: 28,054.45
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26003VMCN7',
  paid_date      = '2026-01-03T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26003VMCN7';

-- bank_ref: FT260030KW3K | CBE ref: FT260030KW3K | date: 2026-01-03 | CBE amount: 21,455.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260030KW3K',
  paid_date      = '2026-01-03T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260030KW3K';

-- bank_ref: FT260053T3TF | CBE ref: FT260053T3TF | date: 2026-01-05 | CBE amount: 99,637.05
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260053T3TF',
  paid_date      = '2026-01-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260053T3TF';

-- bank_ref: FT260060R5BJ | CBE ref: FT260060R5BJ | date: 2026-01-06 | CBE amount: 8,055.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260060R5BJ',
  paid_date      = '2026-01-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260060R5BJ';

-- bank_ref: FT26006B9HTK | CBE ref: FT26006B9HTK | date: 2026-01-06 | CBE amount: 11,605.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26006B9HTK',
  paid_date      = '2026-01-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26006B9HTK';

-- bank_ref: FT260064750D | CBE ref: FT260064750D | date: 2026-01-06 | CBE amount: 26,505.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260064750D',
  paid_date      = '2026-01-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260064750D';

-- bank_ref: FT26008SZC9H | CBE ref: FT26008SZC9H | date: 2026-01-08 | CBE amount: 5,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26008SZC9H',
  paid_date      = '2026-01-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26008SZC9H';

-- bank_ref: FT26008CH1M1 | CBE ref: FT26008CH1M1 | date: 2026-01-08 | CBE amount: 62,482.27
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26008CH1M1',
  paid_date      = '2026-01-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26008CH1M1';

-- bank_ref: FT26008WXD01 | CBE ref: FT26008WXD01 | date: 2026-01-08 | CBE amount: 3,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26008WXD01',
  paid_date      = '2026-01-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26008WXD01';

-- bank_ref: FT260091M150 | CBE ref: FT260091M150 | date: 2026-01-09 | CBE amount: 13,505.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260091M150',
  paid_date      = '2026-01-09T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260091M150';

-- bank_ref: FT2601077D4K | CBE ref: FT2601077D4K | date: 2026-01-10 | CBE amount: 77,918.79
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2601077D4K',
  paid_date      = '2026-01-10T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2601077D4K';

-- bank_ref: FT26010ND9RH | CBE ref: FT26010ND9RH | date: 2026-01-10 | CBE amount: 33,274.62
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26010ND9RH',
  paid_date      = '2026-01-10T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26010ND9RH';

-- bank_ref: FT26010Y50JT | CBE ref: FT26010Y50JT | date: 2026-01-10 | CBE amount: 61,066.20
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26010Y50JT',
  paid_date      = '2026-01-10T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26010Y50JT';

-- bank_ref: FT26014RGLSC | CBE ref: FT26014RGLSC | date: 2026-01-14 | CBE amount: 116,422.99
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26014RGLSC',
  paid_date      = '2026-01-14T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26014RGLSC';

-- bank_ref: FT260148S3TX | CBE ref: FT260148S3TX | date: 2026-01-14 | CBE amount: 29,607.84
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260148S3TX',
  paid_date      = '2026-01-14T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260148S3TX';

-- bank_ref: FT26015JYFTW | CBE ref: FT26015JYFTW | date: 2026-01-15 | CBE amount: 29,708.15
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26015JYFTW',
  paid_date      = '2026-01-15T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26015JYFTW';

-- bank_ref: FT260168TV88 | CBE ref: FT260168TV88 | date: 2026-01-16 | CBE amount: 2,705.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260168TV88',
  paid_date      = '2026-01-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260168TV88';

-- bank_ref: FT26017F8Y2Y | CBE ref: FT26017F8Y2Y | date: 2026-01-17 | CBE amount: 39,205.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26017F8Y2Y',
  paid_date      = '2026-01-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26017F8Y2Y';

-- bank_ref: FT26017NPQD4 | CBE ref: FT26017NPQD4 | date: 2026-01-17 | CBE amount: 19,755.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26017NPQD4',
  paid_date      = '2026-01-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26017NPQD4';

-- bank_ref: FT26017WST6Y | CBE ref: FT26017WST6Y | date: 2026-01-17 | CBE amount: 166,544.88
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26017WST6Y',
  paid_date      = '2026-01-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26017WST6Y';

-- bank_ref: FT26017CN2ZW | CBE ref: FT26017CN2ZW | date: 2026-01-17 | CBE amount: 23,363.15
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26017CN2ZW',
  paid_date      = '2026-01-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26017CN2ZW';

-- bank_ref: FT26017XC23X | CBE ref: FT26017XC23X | date: 2026-01-17 | CBE amount: 22,775.84
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26017XC23X',
  paid_date      = '2026-01-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26017XC23X';

-- bank_ref: FT26017LVMWS | CBE ref: FT26017LVMWS | date: 2026-01-17 | CBE amount: 1,085,431.84
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26017LVMWS',
  paid_date      = '2026-01-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26017LVMWS';

-- bank_ref: FT26022FXYG3 | CBE ref: FT26022FXYG3 | date: 2026-01-22 | CBE amount: 1,194,552.95
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26022FXYG3',
  paid_date      = '2026-01-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26022FXYG3';

-- bank_ref: FT26022NPZRX | CBE ref: FT26022NPZRX | date: 2026-01-22 | CBE amount: 8,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26022NPZRX',
  paid_date      = '2026-01-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26022NPZRX';

-- bank_ref: FT26022HHBNB | CBE ref: FT26022HHBNB | date: 2026-01-22 | CBE amount: 12,310.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26022HHBNB',
  paid_date      = '2026-01-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26022HHBNB';

-- bank_ref: FT26022ZKVCK | CBE ref: FT26022ZKVCK | date: 2026-01-22 | CBE amount: 2,880.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26022ZKVCK',
  paid_date      = '2026-01-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26022ZKVCK';

-- bank_ref: FT26023XBZQD | CBE ref: FT26023XBZQD | date: 2026-01-23 | CBE amount: 20,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26023XBZQD',
  paid_date      = '2026-01-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26023XBZQD';

-- bank_ref: FT26023KPKQL | CBE ref: FT26023KPKQL | date: 2026-01-23 | CBE amount: 95,160.95
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26023KPKQL',
  paid_date      = '2026-01-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26023KPKQL';

-- bank_ref: FT260236V2HC | CBE ref: FT260236V2HC | date: 2026-01-23 | CBE amount: 57,262.10
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260236V2HC',
  paid_date      = '2026-01-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260236V2HC';

-- bank_ref: FT26023KVYGN | CBE ref: FT26023KVYGN | date: 2026-01-23 | CBE amount: 81,354.53
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26023KVYGN',
  paid_date      = '2026-01-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26023KVYGN';

-- bank_ref: FT26023H7BKN | CBE ref: FT26023H7BKN | date: 2026-01-23 | CBE amount: 11,405.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26023H7BKN',
  paid_date      = '2026-01-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26023H7BKN';

-- bank_ref: FT26027K1FWT | CBE ref: FT26027K1FWT | date: 2026-01-27 | CBE amount: 49,231.21
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26027K1FWT',
  paid_date      = '2026-01-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26027K1FWT';

-- bank_ref: FT260273JYLT | CBE ref: FT260273JYLT | date: 2026-01-27 | CBE amount: 18,290.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260273JYLT',
  paid_date      = '2026-01-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260273JYLT';

-- bank_ref: FT26027JJH4X | CBE ref: FT26027JJH4X | date: 2026-01-27 | CBE amount: 2,805.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26027JJH4X',
  paid_date      = '2026-01-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26027JJH4X';

-- bank_ref: FT26027V1PLS | CBE ref: FT26027V1PLS | date: 2026-01-27 | CBE amount: 2,919.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26027V1PLS',
  paid_date      = '2026-01-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26027V1PLS';

-- bank_ref: FT2602895D2N | CBE ref: FT2602895D2N | date: 2026-01-28 | CBE amount: 110,350.10
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2602895D2N',
  paid_date      = '2026-01-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2602895D2N';

-- bank_ref: FT2602965QSZ | CBE ref: FT2602965QSZ | date: 2026-01-29 | CBE amount: 13,505.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2602965QSZ',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2602965QSZ';

-- bank_ref: FT260298BYPG | CBE ref: FT260298BYPG | date: 2026-01-29 | CBE amount: 6,674.59
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260298BYPG',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260298BYPG';

-- bank_ref: FT26029F2RRR | CBE ref: FT26029F2RRR | date: 2026-01-29 | CBE amount: 21,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26029F2RRR',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26029F2RRR';

-- bank_ref: FT2602955KTJ | CBE ref: FT2602955KTJ | date: 2026-01-29 | CBE amount: 28,730.34
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2602955KTJ',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2602955KTJ';

-- bank_ref: FT26029Y77B8 | CBE ref: FT26029Y77B8 | date: 2026-01-29 | CBE amount: 38,818.13
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26029Y77B8',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26029Y77B8';

-- bank_ref: FT26029DKN10 | CBE ref: FT26029DKN10 | date: 2026-01-29 | CBE amount: 14,412.95
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26029DKN10',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26029DKN10';

-- bank_ref: FT26029J73XV | CBE ref: FT26029J73XV | date: 2026-01-29 | CBE amount: 75,961.91
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26029J73XV',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26029J73XV';

-- bank_ref: FT26029V3DHC | CBE ref: FT26029V3DHC | date: 2026-01-29 | CBE amount: 112,979.66
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26029V3DHC',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26029V3DHC';

-- bank_ref: FT2602904RCX | CBE ref: FT2602904RCX | date: 2026-01-29 | CBE amount: 20,805.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2602904RCX',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2602904RCX';

-- bank_ref: FT26029N8N1C | CBE ref: FT26029N8N1C | date: 2026-01-29 | CBE amount: 103,240.53
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26029N8N1C',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26029N8N1C';

-- bank_ref: FT26029S7SZY | CBE ref: FT26029S7SZY | date: 2026-01-29 | CBE amount: 22,955.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26029S7SZY',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26029S7SZY';

-- bank_ref: FT26029P44JY | CBE ref: FT26029P44JY | date: 2026-01-29 | CBE amount: 50,186.62
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26029P44JY',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26029P44JY';

-- bank_ref: FT2602970Y19 | CBE ref: FT2602970Y19 | date: 2026-01-29 | CBE amount: 198,684.01
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2602970Y19',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2602970Y19';

-- bank_ref: FT26029TWPJ6 | CBE ref: FT26029TWPJ6 | date: 2026-01-29 | CBE amount: 1,194,552.95
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26029TWPJ6',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26029TWPJ6';

-- bank_ref: FT26029ZT7VC | CBE ref: FT26029ZT7VC | date: 2026-01-29 | CBE amount: 18,655.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26029ZT7VC',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26029ZT7VC';

-- bank_ref: FT260295LR4T | CBE ref: FT260295LR4T | date: 2026-01-29 | CBE amount: 43,517.26
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260295LR4T',
  paid_date      = '2026-01-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260295LR4T';

-- bank_ref: FT26030NX9KY | CBE ref: FT26030NX9KY | date: 2026-01-30 | CBE amount: 1,405.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26030NX9KY',
  paid_date      = '2026-01-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26030NX9KY';

-- bank_ref: FT2603063SDB | CBE ref: FT2603063SDB | date: 2026-01-30 | CBE amount: 3,455.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2603063SDB',
  paid_date      = '2026-01-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2603063SDB';

-- bank_ref: FT26030TZ845 | CBE ref: FT26030TZ845 | date: 2026-01-30 | CBE amount: 33,216.18
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26030TZ845',
  paid_date      = '2026-01-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26030TZ845';

-- bank_ref: FT260301FN26 | CBE ref: FT260301FN26 | date: 2026-01-30 | CBE amount: 23,993.23
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260301FN26',
  paid_date      = '2026-01-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260301FN26';

-- bank_ref: FT26031HH1DX | CBE ref: FT26031HH1DX | date: 2026-01-31 | CBE amount: 29,320.53
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26031HH1DX',
  paid_date      = '2026-01-31T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26031HH1DX';

-- bank_ref: FT26033TXMB2 | CBE ref: FT26033TXMB2 | date: 2026-02-02 | CBE amount: 5,305.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26033TXMB2',
  paid_date      = '2026-02-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26033TXMB2';

-- bank_ref: FT26033C9SRH | CBE ref: FT26033C9SRH | date: 2026-02-02 | CBE amount: 19,205.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26033C9SRH',
  paid_date      = '2026-02-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26033C9SRH';

-- bank_ref: FT260330VMW8 | CBE ref: FT260330VMW8 | date: 2026-02-02 | CBE amount: 90,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260330VMW8',
  paid_date      = '2026-02-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260330VMW8';

-- bank_ref: FT26033RGF1J | CBE ref: FT26033RGF1J | date: 2026-02-02 | CBE amount: 42,857.92
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26033RGF1J',
  paid_date      = '2026-02-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26033RGF1J';

-- bank_ref: FT260338V8V6 | CBE ref: FT260338V8V6 | date: 2026-02-02 | CBE amount: 50,923.48
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260338V8V6',
  paid_date      = '2026-02-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260338V8V6';

-- bank_ref: FT260339GLSV | CBE ref: FT260339GLSV | date: 2026-02-02 | CBE amount: 12,452.21
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260339GLSV',
  paid_date      = '2026-02-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260339GLSV';

-- bank_ref: FT26034NLSC6 | CBE ref: FT26034NLSC6 | date: 2026-02-03 | CBE amount: 35,487.35
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26034NLSC6',
  paid_date      = '2026-02-03T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26034NLSC6';

-- bank_ref: FT26034BLJ3M | CBE ref: FT26034BLJ3M | date: 2026-02-03 | CBE amount: 151,236.52
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26034BLJ3M',
  paid_date      = '2026-02-03T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26034BLJ3M';

-- bank_ref: FT260346M3DB | CBE ref: FT260346M3DB | date: 2026-02-03 | CBE amount: 55,031.84
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260346M3DB',
  paid_date      = '2026-02-03T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260346M3DB';

-- bank_ref: FT26034G8674 | CBE ref: FT26034G8674 | date: 2026-02-03 | CBE amount: 15,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26034G8674',
  paid_date      = '2026-02-03T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26034G8674';

-- bank_ref: FT26034SG0CF | CBE ref: FT26034SG0CF | date: 2026-02-03 | CBE amount: 36,430.10
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26034SG0CF',
  paid_date      = '2026-02-03T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26034SG0CF';

-- bank_ref: FT26034GS3BS | CBE ref: FT26034GS3BS | date: 2026-02-03 | CBE amount: 32,875.32
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26034GS3BS',
  paid_date      = '2026-02-03T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26034GS3BS';

-- bank_ref: FT260349MJW9 | CBE ref: FT260349MJW9 | date: 2026-02-03 | CBE amount: 1,194,552.95
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260349MJW9',
  paid_date      = '2026-02-03T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260349MJW9';

-- bank_ref: FT26035HLT4S | CBE ref: FT26035HLT4S | date: 2026-02-04 | CBE amount: 20,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26035HLT4S',
  paid_date      = '2026-02-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26035HLT4S';

-- bank_ref: FT260357L74P | CBE ref: FT260357L74P | date: 2026-02-04 | CBE amount: 252,523.48
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260357L74P',
  paid_date      = '2026-02-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260357L74P';

-- bank_ref: FT260358J2S7 | CBE ref: FT260358J2S7 | date: 2026-02-04 | CBE amount: 14,555.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260358J2S7',
  paid_date      = '2026-02-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260358J2S7';

-- bank_ref: FT2603509X9Z | CBE ref: FT2603509X9Z | date: 2026-02-04 | CBE amount: 527,671.84
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2603509X9Z',
  paid_date      = '2026-02-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2603509X9Z';

-- bank_ref: FT26036Z5RWN | CBE ref: FT26036Z5RWN | date: 2026-02-05 | CBE amount: 14,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26036Z5RWN',
  paid_date      = '2026-02-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26036Z5RWN';

-- bank_ref: FT260363QV2M | CBE ref: FT260363QV2M | date: 2026-02-05 | CBE amount: 392,685.13
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260363QV2M',
  paid_date      = '2026-02-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260363QV2M';

-- bank_ref: FT260370M3B0 | CBE ref: FT260370M3B0 | date: 2026-02-06 | CBE amount: 367,701.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260370M3B0',
  paid_date      = '2026-02-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260370M3B0';

-- bank_ref: FT260375TT7J | CBE ref: FT260375TT7J | date: 2026-02-06 | CBE amount: 2,905.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260375TT7J',
  paid_date      = '2026-02-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260375TT7J';

-- bank_ref: FT26038HJ1CH | CBE ref: FT26038HJ1CH | date: 2026-02-07 | CBE amount: 83,975.73
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26038HJ1CH',
  paid_date      = '2026-02-07T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26038HJ1CH';

-- bank_ref: FT26038H5C5B | CBE ref: FT26038H5C5B | date: 2026-02-07 | CBE amount: 8,998.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26038H5C5B',
  paid_date      = '2026-02-07T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26038H5C5B';

-- bank_ref: FT26038NRKXX | CBE ref: FT26038NRKXX | date: 2026-02-07 | CBE amount: 58,635.32
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26038NRKXX',
  paid_date      = '2026-02-07T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26038NRKXX';

-- bank_ref: FT26040NG1HR | CBE ref: FT26040NG1HR | date: 2026-02-09 | CBE amount: 67,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26040NG1HR',
  paid_date      = '2026-02-09T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26040NG1HR';

-- bank_ref: FT26040XF9SP | CBE ref: FT26040XF9SP | date: 2026-02-09 | CBE amount: 34,705.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26040XF9SP',
  paid_date      = '2026-02-09T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26040XF9SP';

-- bank_ref: FT26041P8ZG6 | CBE ref: FT26041P8ZG6 | date: 2026-02-10 | CBE amount: 28,404.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26041P8ZG6',
  paid_date      = '2026-02-10T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26041P8ZG6';

-- bank_ref: FT260436WF8K | CBE ref: FT260436WF8K | date: 2026-02-12 | CBE amount: 4,505.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260436WF8K',
  paid_date      = '2026-02-12T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260436WF8K';

-- bank_ref: FT26043GN9CX | CBE ref: FT26043GN9CX | date: 2026-02-12 | CBE amount: 139,762.27
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26043GN9CX',
  paid_date      = '2026-02-12T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26043GN9CX';

-- bank_ref: FT260479JJYW | CBE ref: FT260479JJYW | date: 2026-02-16 | CBE amount: 1,327,449.23
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260479JJYW',
  paid_date      = '2026-02-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260479JJYW';

-- bank_ref: FT2604720CQ5 | CBE ref: FT2604720CQ5 | date: 2026-02-16 | CBE amount: 23,605.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2604720CQ5',
  paid_date      = '2026-02-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2604720CQ5';

-- bank_ref: FT26047T6CQG | CBE ref: FT26047T6CQG | date: 2026-02-16 | CBE amount: 225,005.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26047T6CQG',
  paid_date      = '2026-02-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26047T6CQG';

-- bank_ref: FT26047HBZ8Q | CBE ref: FT26047HBZ8Q | date: 2026-02-16 | CBE amount: 8,745.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26047HBZ8Q',
  paid_date      = '2026-02-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26047HBZ8Q';

-- bank_ref: FT260497PW7M | CBE ref: FT260497PW7M | date: 2026-02-18 | CBE amount: 161,081.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260497PW7M',
  paid_date      = '2026-02-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260497PW7M';

-- bank_ref: FT260499KDCG | CBE ref: FT260499KDCG | date: 2026-02-18 | CBE amount: 427,445.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260499KDCG',
  paid_date      = '2026-02-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260499KDCG';

-- bank_ref: FT26049N36D6 | CBE ref: FT26049N36D6 | date: 2026-02-18 | CBE amount: 1,357,153.58
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26049N36D6',
  paid_date      = '2026-02-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26049N36D6';

-- bank_ref: FT26050FQBBG | CBE ref: FT26050FQBBG | date: 2026-02-19 | CBE amount: 44,505.75
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26050FQBBG',
  paid_date      = '2026-02-19T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26050FQBBG';

-- bank_ref: FT26050QBR49 | CBE ref: FT26050QBR49 | date: 2026-02-19 | CBE amount: 464,226.27
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26050QBR49',
  paid_date      = '2026-02-19T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26050QBR49';

-- bank_ref: FT26054P9PCT | CBE ref: FT26054P9PCT | date: 2026-02-23 | CBE amount: 1,352,284.26
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26054P9PCT',
  paid_date      = '2026-02-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26054P9PCT';

-- bank_ref: FT26055WQ5WC | CBE ref: FT26055WQ5WC | date: 2026-02-24 | CBE amount: 6,965.59
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26055WQ5WC',
  paid_date      = '2026-02-24T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26055WQ5WC';

-- bank_ref: FT26056TD53C | CBE ref: FT26056TD53C | date: 2026-02-25 | CBE amount: 16,106.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26056TD53C',
  paid_date      = '2026-02-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26056TD53C';

-- bank_ref: FT260560X622 | CBE ref: FT260560X622 | date: 2026-02-25 | CBE amount: 51,064.93
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260560X622',
  paid_date      = '2026-02-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260560X622';

-- bank_ref: FT260567K23L | CBE ref: FT260567K23L | date: 2026-02-25 | CBE amount: 180,812.96
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260567K23L',
  paid_date      = '2026-02-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260567K23L';

-- bank_ref: FT260568NH2M | CBE ref: FT260568NH2M | date: 2026-02-25 | CBE amount: 42,631.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260568NH2M',
  paid_date      = '2026-02-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260568NH2M';

-- bank_ref: FT26057MKQVB | CBE ref: FT26057MKQVB | date: 2026-02-26 | CBE amount: 32,375.95
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26057MKQVB',
  paid_date      = '2026-02-26T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26057MKQVB';

-- bank_ref: FT26057284S6 | CBE ref: FT26057284S6 | date: 2026-02-26 | CBE amount: 15,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26057284S6',
  paid_date      = '2026-02-26T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26057284S6';

-- bank_ref: FT26057L04K9 | CBE ref: FT26057L04K9 | date: 2026-02-26 | CBE amount: 5,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26057L04K9',
  paid_date      = '2026-02-26T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26057L04K9';

-- bank_ref: FT26058G8X06 | CBE ref: FT26058G8X06 | date: 2026-02-27 | CBE amount: 4,646.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26058G8X06',
  paid_date      = '2026-02-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26058G8X06';

-- bank_ref: FT26058HYTV2 | CBE ref: FT26058HYTV2 | date: 2026-02-27 | CBE amount: 5,306.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26058HYTV2',
  paid_date      = '2026-02-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26058HYTV2';

-- bank_ref: FT26058K2SQL | CBE ref: FT26058K2SQL | date: 2026-02-27 | CBE amount: 160,117.30
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26058K2SQL',
  paid_date      = '2026-02-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26058K2SQL';

-- bank_ref: FT26059BLRHN | CBE ref: FT26059BLRHN | date: 2026-02-28 | CBE amount: 22,715.15
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26059BLRHN',
  paid_date      = '2026-02-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26059BLRHN';

-- bank_ref: FT260594BV5R | CBE ref: FT260594BV5R | date: 2026-02-28 | CBE amount: 14,406.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260594BV5R',
  paid_date      = '2026-02-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260594BV5R';

-- bank_ref: FT260594QX80 | CBE ref: FT260594QX80 | date: 2026-02-28 | CBE amount: 16,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260594QX80',
  paid_date      = '2026-02-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260594QX80';

-- bank_ref: FT26059VHPNV | CBE ref: FT26059VHPNV | date: 2026-02-28 | CBE amount: 57,170.80
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26059VHPNV',
  paid_date      = '2026-02-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26059VHPNV';

-- bank_ref: FT26059B6DL7 | CBE ref: FT26059B6DL7 | date: 2026-02-28 | CBE amount: 58,440.78
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26059B6DL7',
  paid_date      = '2026-02-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26059B6DL7';

-- bank_ref: FT26059J60R6 | CBE ref: FT26059J60R6 | date: 2026-02-28 | CBE amount: 14,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26059J60R6',
  paid_date      = '2026-02-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26059J60R6';

-- bank_ref: FT26059DQ5D2 | CBE ref: FT26059DQ5D2 | date: 2026-02-28 | CBE amount: 416,378.17
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26059DQ5D2',
  paid_date      = '2026-02-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26059DQ5D2';

-- bank_ref: FT260593SXWV | CBE ref: FT260593SXWV | date: 2026-02-28 | CBE amount: 162,649.48
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260593SXWV',
  paid_date      = '2026-02-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260593SXWV';

-- bank_ref: FT26062PPY8T | CBE ref: FT26062PPY8T | date: 2026-03-03 | CBE amount: 28,249.48
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26062PPY8T',
  paid_date      = '2026-03-03T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26062PPY8T';

-- bank_ref: FT26063BTVQK | CBE ref: FT26063BTVQK | date: 2026-03-04 | CBE amount: 1,386.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26063BTVQK',
  paid_date      = '2026-03-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26063BTVQK';

-- bank_ref: FT26063ZGQGF | CBE ref: FT26063ZGQGF | date: 2026-03-04 | CBE amount: 2,406.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26063ZGQGF',
  paid_date      = '2026-03-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26063ZGQGF';

-- bank_ref: FT26063D8PVS | CBE ref: FT26063D8PVS | date: 2026-03-04 | CBE amount: 2,306.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26063D8PVS',
  paid_date      = '2026-03-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26063D8PVS';

-- bank_ref: FT26063978XC | CBE ref: FT26063978XC | date: 2026-03-04 | CBE amount: 33,119.04
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26063978XC',
  paid_date      = '2026-03-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26063978XC';

-- bank_ref: FT260637WBKW | CBE ref: FT260637WBKW | date: 2026-03-04 | CBE amount: 22,986.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260637WBKW',
  paid_date      = '2026-03-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260637WBKW';

-- bank_ref: FT26063RBPNK | CBE ref: FT26063RBPNK | date: 2026-03-04 | CBE amount: 14,151.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26063RBPNK',
  paid_date      = '2026-03-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26063RBPNK';

-- bank_ref: FT26063Z567J | CBE ref: FT26063Z567J | date: 2026-03-04 | CBE amount: 21,346.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26063Z567J',
  paid_date      = '2026-03-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26063Z567J';

-- bank_ref: FT26064WP3HF | CBE ref: FT26064WP3HF | date: 2026-03-05 | CBE amount: 4,000,699.20
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26064WP3HF',
  paid_date      = '2026-03-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26064WP3HF';

-- bank_ref: FT260641143S | CBE ref: FT260641143S | date: 2026-03-05 | CBE amount: 25,230.35
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260641143S',
  paid_date      = '2026-03-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260641143S';

-- bank_ref: FT26064LHWNZ | CBE ref: FT26064LHWNZ | date: 2026-03-05 | CBE amount: 61,265.13
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26064LHWNZ',
  paid_date      = '2026-03-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26064LHWNZ';

-- bank_ref: FT26064W0J0K | CBE ref: FT26064W0J0K | date: 2026-03-05 | CBE amount: 22,779.09
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26064W0J0K',
  paid_date      = '2026-03-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26064W0J0K';

-- bank_ref: FT26064ZLWBW | CBE ref: FT26064ZLWBW | date: 2026-03-05 | CBE amount: 76,255.60
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26064ZLWBW',
  paid_date      = '2026-03-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26064ZLWBW';

-- bank_ref: FT26064JG2Y8 | CBE ref: FT26064JG2Y8 | date: 2026-03-05 | CBE amount: 68,341.89
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26064JG2Y8',
  paid_date      = '2026-03-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26064JG2Y8';

-- bank_ref: FT26064VRBMJ | CBE ref: FT26064VRBMJ | date: 2026-03-05 | CBE amount: 5,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26064VRBMJ',
  paid_date      = '2026-03-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26064VRBMJ';

-- bank_ref: FT26064D9HQ3 | CBE ref: FT26064D9HQ3 | date: 2026-03-05 | CBE amount: 8,976.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26064D9HQ3',
  paid_date      = '2026-03-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26064D9HQ3';

-- bank_ref: FT26064LS83M | CBE ref: FT26064LS83M | date: 2026-03-05 | CBE amount: 34,054.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26064LS83M',
  paid_date      = '2026-03-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26064LS83M';

-- bank_ref: FT26065PL6D8 | CBE ref: FT26065PL6D8 | date: 2026-03-06 | CBE amount: 8,956.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26065PL6D8',
  paid_date      = '2026-03-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26065PL6D8';

-- bank_ref: FT260666647K | CBE ref: FT260666647K | date: 2026-03-07 | CBE amount: 51,121.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260666647K',
  paid_date      = '2026-03-07T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260666647K';

-- bank_ref: FT26066P41GN | CBE ref: FT26066P41GN | date: 2026-03-07 | CBE amount: 3,606.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26066P41GN',
  paid_date      = '2026-03-07T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26066P41GN';

-- bank_ref: FT26066JLRVB | CBE ref: FT26066JLRVB | date: 2026-03-07 | CBE amount: 9,997.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26066JLRVB',
  paid_date      = '2026-03-07T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26066JLRVB';

-- bank_ref: FT26066B3MK8 | CBE ref: FT26066B3MK8 | date: 2026-03-07 | CBE amount: 158,063.91
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26066B3MK8',
  paid_date      = '2026-03-07T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26066B3MK8';

-- bank_ref: FT26068Z9N6G | CBE ref: FT26068Z9N6G | date: 2026-03-09 | CBE amount: 37,306.04
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26068Z9N6G',
  paid_date      = '2026-03-09T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26068Z9N6G';

-- bank_ref: FT26068L2VVK | CBE ref: FT26068L2VVK | date: 2026-03-09 | CBE amount: 24,353.83
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26068L2VVK',
  paid_date      = '2026-03-09T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26068L2VVK';

-- bank_ref: FT26068CH5R8 | CBE ref: FT26068CH5R8 | date: 2026-03-09 | CBE amount: 150,962.52
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26068CH5R8',
  paid_date      = '2026-03-09T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26068CH5R8';

-- bank_ref: FT26069Y7TSD | CBE ref: FT26069Y7TSD | date: 2026-03-10 | CBE amount: 50,649.48
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26069Y7TSD',
  paid_date      = '2026-03-10T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26069Y7TSD';

-- bank_ref: FT26069GQPZC | CBE ref: FT26069GQPZC | date: 2026-03-10 | CBE amount: 29,924.61
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26069GQPZC',
  paid_date      = '2026-03-10T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26069GQPZC';

-- bank_ref: FT26070NWZ57 | CBE ref: FT26070NWZ57 | date: 2026-03-11 | CBE amount: 9,804.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26070NWZ57',
  paid_date      = '2026-03-11T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26070NWZ57';

-- bank_ref: FT2607022SDQ | CBE ref: FT2607022SDQ | date: 2026-03-11 | CBE amount: 1,366.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2607022SDQ',
  paid_date      = '2026-03-11T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2607022SDQ';

-- bank_ref: FT26070CTN5M | CBE ref: FT26070CTN5M | date: 2026-03-11 | CBE amount: 5,406.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26070CTN5M',
  paid_date      = '2026-03-11T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26070CTN5M';

-- bank_ref: FT26071MC3MT | CBE ref: FT26071MC3MT | date: 2026-03-12 | CBE amount: 5,117.50
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26071MC3MT',
  paid_date      = '2026-03-12T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26071MC3MT';

-- bank_ref: FT26071TYFXH | CBE ref: FT26071TYFXH | date: 2026-03-12 | CBE amount: 6,906.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26071TYFXH',
  paid_date      = '2026-03-12T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26071TYFXH';

-- bank_ref: FT26071GLT01 | CBE ref: FT26071GLT01 | date: 2026-03-12 | CBE amount: 5,181.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26071GLT01',
  paid_date      = '2026-03-12T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26071GLT01';

-- bank_ref: FT26072VTY7Z | CBE ref: FT26072VTY7Z | date: 2026-03-13 | CBE amount: 34,853.10
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26072VTY7Z',
  paid_date      = '2026-03-13T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26072VTY7Z';

-- bank_ref: FT26072HJ6QS | CBE ref: FT26072HJ6QS | date: 2026-03-13 | CBE amount: 17,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26072HJ6QS',
  paid_date      = '2026-03-13T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26072HJ6QS';

-- bank_ref: FT260720VS9K | CBE ref: FT260720VS9K | date: 2026-03-13 | CBE amount: 39,706.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260720VS9K',
  paid_date      = '2026-03-13T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260720VS9K';

-- bank_ref: FT26073N8HM8 | CBE ref: FT26073N8HM8 | date: 2026-03-14 | CBE amount: 9,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26073N8HM8',
  paid_date      = '2026-03-14T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26073N8HM8';

-- bank_ref: FT260733PHR7 | CBE ref: FT260733PHR7 | date: 2026-03-14 | CBE amount: 4,406.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260733PHR7',
  paid_date      = '2026-03-14T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260733PHR7';

-- bank_ref: FT26073X6B3J | CBE ref: FT26073X6B3J | date: 2026-03-14 | CBE amount: 23,526.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26073X6B3J',
  paid_date      = '2026-03-14T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26073X6B3J';

-- bank_ref: FT26073269BR | CBE ref: FT26073269BR | date: 2026-03-14 | CBE amount: 26,206.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26073269BR',
  paid_date      = '2026-03-14T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26073269BR';

-- bank_ref: FT260756K2FD | CBE ref: FT260756K2FD | date: 2026-03-16 | CBE amount: 29,223.39
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260756K2FD',
  paid_date      = '2026-03-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260756K2FD';

-- bank_ref: FT26075P169H | CBE ref: FT26075P169H | date: 2026-03-16 | CBE amount: 207,111.64
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26075P169H',
  paid_date      = '2026-03-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26075P169H';

-- bank_ref: FT260755T5K2 | CBE ref: FT260755T5K2 | date: 2026-03-16 | CBE amount: 3,111.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260755T5K2',
  paid_date      = '2026-03-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260755T5K2';

-- bank_ref: FT26075G9VK2 | CBE ref: FT26075G9VK2 | date: 2026-03-16 | CBE amount: 12,598.30
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26075G9VK2',
  paid_date      = '2026-03-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26075G9VK2';

-- bank_ref: FT26076G8909 | CBE ref: FT26076G8909 | date: 2026-03-17 | CBE amount: 13,231.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26076G8909',
  paid_date      = '2026-03-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26076G8909';

-- bank_ref: FT26076Q1TJ4 | CBE ref: FT26076Q1TJ4 | date: 2026-03-17 | CBE amount: 52,881.30
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26076Q1TJ4',
  paid_date      = '2026-03-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26076Q1TJ4';

-- bank_ref: FT26076NGPCN | CBE ref: FT26076NGPCN | date: 2026-03-17 | CBE amount: 34,083.22
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26076NGPCN',
  paid_date      = '2026-03-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26076NGPCN';

-- bank_ref: FT260761SQWS | CBE ref: FT260761SQWS | date: 2026-03-17 | CBE amount: 11,733.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260761SQWS',
  paid_date      = '2026-03-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260761SQWS';

-- bank_ref: FT26076QGVJF | CBE ref: FT26076QGVJF | date: 2026-03-17 | CBE amount: 13,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26076QGVJF',
  paid_date      = '2026-03-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26076QGVJF';

-- bank_ref: FT26076W0F4Z | CBE ref: FT26076W0F4Z | date: 2026-03-17 | CBE amount: 12,849.28
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26076W0F4Z',
  paid_date      = '2026-03-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26076W0F4Z';

-- bank_ref: FT2607721W14 | CBE ref: FT2607721W14 | date: 2026-03-18 | CBE amount: 29,457.13
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2607721W14',
  paid_date      = '2026-03-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2607721W14';

-- bank_ref: FT26078MT807 | CBE ref: FT26078MT807 | date: 2026-03-19 | CBE amount: 13,606.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26078MT807',
  paid_date      = '2026-03-19T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26078MT807';

-- bank_ref: FT2607855HZS | CBE ref: FT2607855HZS | date: 2026-03-19 | CBE amount: 81,522.52
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2607855HZS',
  paid_date      = '2026-03-19T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2607855HZS';

-- bank_ref: FT26080DJ9QX | CBE ref: FT26080DJ9QX | date: 2026-03-21 | CBE amount: 2,996.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26080DJ9QX',
  paid_date      = '2026-03-21T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26080DJ9QX';

-- bank_ref: FT26080LM405 | CBE ref: FT26080LM405 | date: 2026-03-21 | CBE amount: 292,179.91
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26080LM405',
  paid_date      = '2026-03-21T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26080LM405';

-- bank_ref: FT2608216VMG | CBE ref: FT2608216VMG | date: 2026-03-23 | CBE amount: 3,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2608216VMG',
  paid_date      = '2026-03-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2608216VMG';

-- bank_ref: FT26084FR3NS | CBE ref: FT26084FR3NS | date: 2026-03-25 | CBE amount: 13,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26084FR3NS',
  paid_date      = '2026-03-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26084FR3NS';

-- bank_ref: FT26084C3J3S | CBE ref: FT26084C3J3S | date: 2026-03-25 | CBE amount: 7,596.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26084C3J3S',
  paid_date      = '2026-03-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26084C3J3S';

-- bank_ref: FT260840J2G7 | CBE ref: FT260840J2G7 | date: 2026-03-25 | CBE amount: 26,399.04
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260840J2G7',
  paid_date      = '2026-03-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260840J2G7';

-- bank_ref: FT26084PYN65 | CBE ref: FT26084PYN65 | date: 2026-03-25 | CBE amount: 109,368.26
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26084PYN65',
  paid_date      = '2026-03-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26084PYN65';

-- bank_ref: FT26084DX6K5 | CBE ref: FT26084DX6K5 | date: 2026-03-25 | CBE amount: 3,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26084DX6K5',
  paid_date      = '2026-03-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26084DX6K5';

-- bank_ref: FT260853SV4Q | CBE ref: FT260853SV4Q | date: 2026-03-26 | CBE amount: 5,286.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260853SV4Q',
  paid_date      = '2026-03-26T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260853SV4Q';

-- bank_ref: FT26085DR7K1 | CBE ref: FT26085DR7K1 | date: 2026-03-26 | CBE amount: 19,556.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26085DR7K1',
  paid_date      = '2026-03-26T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26085DR7K1';

-- bank_ref: FT260859MKYX | CBE ref: FT260859MKYX | date: 2026-03-26 | CBE amount: 292,179.91
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260859MKYX',
  paid_date      = '2026-03-26T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260859MKYX';

-- bank_ref: FT2608618076 | CBE ref: FT2608618076 | date: 2026-03-27 | CBE amount: 60,288.30
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2608618076',
  paid_date      = '2026-03-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2608618076';

-- bank_ref: FT2608633HZ0 | CBE ref: FT2608633HZ0 | date: 2026-03-27 | CBE amount: 286,336.43
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2608633HZ0',
  paid_date      = '2026-03-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2608633HZ0';

-- bank_ref: FT26086Z3B1D | CBE ref: FT26086Z3B1D | date: 2026-03-27 | CBE amount: 189,432.09
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26086Z3B1D',
  paid_date      = '2026-03-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26086Z3B1D';

-- bank_ref: FT26087Q7T3H | CBE ref: FT26087Q7T3H | date: 2026-03-28 | CBE amount: 22,486.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26087Q7T3H',
  paid_date      = '2026-03-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26087Q7T3H';

-- bank_ref: FT26089KQ5JF | CBE ref: FT26089KQ5JF | date: 2026-03-30 | CBE amount: 3,417.05
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26089KQ5JF',
  paid_date      = '2026-03-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26089KQ5JF';

-- bank_ref: FT2609170L4J | CBE ref: FT2609170L4J | date: 2026-04-01 | CBE amount: 6,406.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2609170L4J',
  paid_date      = '2026-04-01T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2609170L4J';

-- bank_ref: FT26091K736V | CBE ref: FT26091K736V | date: 2026-04-01 | CBE amount: 34,579.91
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26091K736V',
  paid_date      = '2026-04-01T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26091K736V';

-- bank_ref: FT26092TTLXX | CBE ref: FT26092TTLXX | date: 2026-04-02 | CBE amount: 5,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26092TTLXX',
  paid_date      = '2026-04-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26092TTLXX';

-- bank_ref: FT260928GQ6M | CBE ref: FT260928GQ6M | date: 2026-04-02 | CBE amount: 15,256.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260928GQ6M',
  paid_date      = '2026-04-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260928GQ6M';

-- bank_ref: FT260926N9D1 | CBE ref: FT260926N9D1 | date: 2026-04-02 | CBE amount: 4,296.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260926N9D1',
  paid_date      = '2026-04-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260926N9D1';

-- bank_ref: FT26092401BR | CBE ref: FT26092401BR | date: 2026-04-02 | CBE amount: 7,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26092401BR',
  paid_date      = '2026-04-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26092401BR';

-- bank_ref: FT26092S3NXT | CBE ref: FT26092S3NXT | date: 2026-04-02 | CBE amount: 127,686.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26092S3NXT',
  paid_date      = '2026-04-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26092S3NXT';

-- bank_ref: FT26092ZVXJK | CBE ref: FT26092ZVXJK | date: 2026-04-02 | CBE amount: 12,806.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26092ZVXJK',
  paid_date      = '2026-04-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26092ZVXJK';

-- bank_ref: FT26092F7HKG | CBE ref: FT26092F7HKG | date: 2026-04-02 | CBE amount: 428,527.74
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26092F7HKG',
  paid_date      = '2026-04-02T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26092F7HKG';

-- bank_ref: FT26094Y37CW | CBE ref: FT26094Y37CW | date: 2026-04-04 | CBE amount: 18,556.35
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26094Y37CW',
  paid_date      = '2026-04-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26094Y37CW';

-- bank_ref: FT26094LJW8B | CBE ref: FT26094LJW8B | date: 2026-04-04 | CBE amount: 29,126.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26094LJW8B',
  paid_date      = '2026-04-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26094LJW8B';

-- bank_ref: FT26094L1YB8 | CBE ref: FT26094L1YB8 | date: 2026-04-04 | CBE amount: 29,126.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26094L1YB8',
  paid_date      = '2026-04-04T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26094L1YB8';

-- bank_ref: FT260967TM5Y | CBE ref: FT260967TM5Y | date: 2026-04-06 | CBE amount: 159,832.92
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260967TM5Y',
  paid_date      = '2026-04-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260967TM5Y';

-- bank_ref: FT26096YHGXD | CBE ref: FT26096YHGXD | date: 2026-04-06 | CBE amount: 15,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26096YHGXD',
  paid_date      = '2026-04-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26096YHGXD';

-- bank_ref: FT26097YLLXW | CBE ref: FT26097YLLXW | date: 2026-04-07 | CBE amount: 16,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26097YLLXW',
  paid_date      = '2026-04-07T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26097YLLXW';

-- bank_ref: FT26098X739H | CBE ref: FT26098X739H | date: 2026-04-08 | CBE amount: 3,456.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26098X739H',
  paid_date      = '2026-04-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26098X739H';

-- bank_ref: FT26098RV1MJ | CBE ref: FT26098RV1MJ | date: 2026-04-08 | CBE amount: 1,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26098RV1MJ',
  paid_date      = '2026-04-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26098RV1MJ';

-- bank_ref: FT26098HR0NL | CBE ref: FT26098HR0NL | date: 2026-04-08 | CBE amount: 38,086.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26098HR0NL',
  paid_date      = '2026-04-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26098HR0NL';

-- bank_ref: FT26098HK035 | CBE ref: FT26098HK035 | date: 2026-04-08 | CBE amount: 133,477.86
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26098HK035',
  paid_date      = '2026-04-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26098HK035';

-- bank_ref: FT260982RYV4 | CBE ref: FT260982RYV4 | date: 2026-04-08 | CBE amount: 87,560.78
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT260982RYV4',
  paid_date      = '2026-04-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT260982RYV4';

-- bank_ref: FT26098JJ5SJ | CBE ref: FT26098JJ5SJ | date: 2026-04-08 | CBE amount: 4,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26098JJ5SJ',
  paid_date      = '2026-04-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26098JJ5SJ';

-- bank_ref: FT261049V1GB | CBE ref: FT261049V1GB | date: 2026-04-14 | CBE amount: 8,456.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261049V1GB',
  paid_date      = '2026-04-14T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261049V1GB';

-- bank_ref: FT26105M9LMC | CBE ref: FT26105M9LMC | date: 2026-04-15 | CBE amount: 350,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26105M9LMC',
  paid_date      = '2026-04-15T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26105M9LMC';

-- bank_ref: FT26106HGTF2 | CBE ref: FT26106HGTF2 | date: 2026-04-16 | CBE amount: 30,986.17
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26106HGTF2',
  paid_date      = '2026-04-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26106HGTF2';

-- bank_ref: FT261074BWPD | CBE ref: FT261074BWPD | date: 2026-04-17 | CBE amount: 19,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261074BWPD',
  paid_date      = '2026-04-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261074BWPD';

-- bank_ref: FT26107CZZF5 | CBE ref: FT26107CZZF5 | date: 2026-04-17 | CBE amount: 12,756.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26107CZZF5',
  paid_date      = '2026-04-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26107CZZF5';

-- bank_ref: FT26107RTNFR | CBE ref: FT26107RTNFR | date: 2026-04-17 | CBE amount: 529,814.70
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26107RTNFR',
  paid_date      = '2026-04-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26107RTNFR';

-- bank_ref: FT261086G075 | CBE ref: FT261086G075 | date: 2026-04-18 | CBE amount: 57,466.87
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261086G075',
  paid_date      = '2026-04-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261086G075';

-- bank_ref: FT261082GV1Z | CBE ref: FT261082GV1Z | date: 2026-04-18 | CBE amount: 646,440.78
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261082GV1Z',
  paid_date      = '2026-04-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261082GV1Z';

-- bank_ref: FT26108LC9LS | CBE ref: FT26108LC9LS | date: 2026-04-18 | CBE amount: 99,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26108LC9LS',
  paid_date      = '2026-04-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26108LC9LS';

-- bank_ref: FT261106TZFT | CBE ref: FT261106TZFT | date: 2026-04-20 | CBE amount: 30,541.26
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261106TZFT',
  paid_date      = '2026-04-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261106TZFT';

-- bank_ref: FT26110Y7RR4 | CBE ref: FT26110Y7RR4 | date: 2026-04-20 | CBE amount: 131,123.84
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26110Y7RR4',
  paid_date      = '2026-04-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26110Y7RR4';

-- bank_ref: FT26110YYS6B | CBE ref: FT26110YYS6B | date: 2026-04-20 | CBE amount: 76,779.57
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26110YYS6B',
  paid_date      = '2026-04-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26110YYS6B';

-- bank_ref: FT26112QGH62 | CBE ref: FT26112QGH62 | date: 2026-04-22 | CBE amount: 67,320.96
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26112QGH62',
  paid_date      = '2026-04-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26112QGH62';

-- bank_ref: FT26112Z6JZ8 | CBE ref: FT26112Z6JZ8 | date: 2026-04-22 | CBE amount: 5,606.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26112Z6JZ8',
  paid_date      = '2026-04-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26112Z6JZ8';

-- bank_ref: FT26112R0L6K | CBE ref: FT26112R0L6K | date: 2026-04-22 | CBE amount: 19,806.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26112R0L6K',
  paid_date      = '2026-04-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26112R0L6K';

-- bank_ref: FT2611242N4Y | CBE ref: FT2611242N4Y | date: 2026-04-22 | CBE amount: 1,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2611242N4Y',
  paid_date      = '2026-04-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2611242N4Y';

-- bank_ref: FT26112XXSFC | CBE ref: FT26112XXSFC | date: 2026-04-22 | CBE amount: 132,360.78
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26112XXSFC',
  paid_date      = '2026-04-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26112XXSFC';

-- bank_ref: FT26112T2B1Y | CBE ref: FT26112T2B1Y | date: 2026-04-22 | CBE amount: 7,806.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26112T2B1Y',
  paid_date      = '2026-04-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26112T2B1Y';

-- bank_ref: FT26113NFP60 | CBE ref: FT26113NFP60 | date: 2026-04-23 | CBE amount: 124,959.04
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26113NFP60',
  paid_date      = '2026-04-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26113NFP60';

-- bank_ref: FT2611355M8J | CBE ref: FT2611355M8J | date: 2026-04-23 | CBE amount: 51,160.95
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2611355M8J',
  paid_date      = '2026-04-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2611355M8J';

-- bank_ref: FT26113ZDX0X | CBE ref: FT26113ZDX0X | date: 2026-04-23 | CBE amount: 139,032.09
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26113ZDX0X',
  paid_date      = '2026-04-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26113ZDX0X';

-- bank_ref: FT26113ST3TR | CBE ref: FT26113ST3TR | date: 2026-04-23 | CBE amount: 45,292.96
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26113ST3TR',
  paid_date      = '2026-04-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26113ST3TR';

-- bank_ref: FT26113RKW2G | CBE ref: FT26113RKW2G | date: 2026-04-23 | CBE amount: 500,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26113RKW2G',
  paid_date      = '2026-04-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26113RKW2G';

-- bank_ref: FT26114PSXYF | CBE ref: FT26114PSXYF | date: 2026-04-24 | CBE amount: 34,109.65
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26114PSXYF',
  paid_date      = '2026-04-24T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26114PSXYF';

-- bank_ref: FT26114513KT | CBE ref: FT26114513KT | date: 2026-04-24 | CBE amount: 199,658.17
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26114513KT',
  paid_date      = '2026-04-24T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26114513KT';

-- bank_ref: FT261159Q6MY | CBE ref: FT261159Q6MY | date: 2026-04-25 | CBE amount: 53,986.88
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261159Q6MY',
  paid_date      = '2026-04-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261159Q6MY';

-- bank_ref: FT26115P7XHL | CBE ref: FT26115P7XHL | date: 2026-04-25 | CBE amount: 30,246.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26115P7XHL',
  paid_date      = '2026-04-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26115P7XHL';

-- bank_ref: FT26115YPRR6 | CBE ref: FT26115YPRR6 | date: 2026-04-25 | CBE amount: 500,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26115YPRR6',
  paid_date      = '2026-04-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26115YPRR6';

-- bank_ref: FT26117C1C2G | CBE ref: FT26117C1C2G | date: 2026-04-27 | CBE amount: 35,427.22
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26117C1C2G',
  paid_date      = '2026-04-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26117C1C2G';

-- bank_ref: FT2611751XF3 | CBE ref: FT2611751XF3 | date: 2026-04-27 | CBE amount: 38,524.26
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2611751XF3',
  paid_date      = '2026-04-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2611751XF3';

-- bank_ref: FT26117TMGJQ | CBE ref: FT26117TMGJQ | date: 2026-04-27 | CBE amount: 486,962.52
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26117TMGJQ',
  paid_date      = '2026-04-27T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26117TMGJQ';

-- bank_ref: FT2611880VG7 | CBE ref: FT2611880VG7 | date: 2026-04-28 | CBE amount: 341,159.57
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2611880VG7',
  paid_date      = '2026-04-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2611880VG7';

-- bank_ref: FT26121Q0S5B | CBE ref: FT26121Q0S5B | date: 2026-05-01 | CBE amount: 407,978.17
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26121Q0S5B',
  paid_date      = '2026-05-01T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26121Q0S5B';

-- bank_ref: FT26125PZVT0 | CBE ref: FT26125PZVT0 | date: 2026-05-05 | CBE amount: 5,456.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26125PZVT0',
  paid_date      = '2026-05-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26125PZVT0';

-- bank_ref: FT26125RX0G8 | CBE ref: FT26125RX0G8 | date: 2026-05-05 | CBE amount: 65,575.17
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26125RX0G8',
  paid_date      = '2026-05-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26125RX0G8';

-- bank_ref: FT26125XZBLH | CBE ref: FT26125XZBLH | date: 2026-05-05 | CBE amount: 41,446.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26125XZBLH',
  paid_date      = '2026-05-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26125XZBLH';

-- bank_ref: FT26125GJ4BT | CBE ref: FT26125GJ4BT | date: 2026-05-05 | CBE amount: 11,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26125GJ4BT',
  paid_date      = '2026-05-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26125GJ4BT';

-- bank_ref: FT2612755YNN | CBE ref: FT2612755YNN | date: 2026-05-07 | CBE amount: 3,870.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2612755YNN',
  paid_date      = '2026-05-07T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2612755YNN';

-- bank_ref: FT261296CHVL | CBE ref: FT261296CHVL | date: 2026-05-09 | CBE amount: 23,606.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261296CHVL',
  paid_date      = '2026-05-09T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261296CHVL';

-- bank_ref: FT26131N0ZSQ | CBE ref: FT26131N0ZSQ | date: 2026-05-11 | CBE amount: 20,256.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26131N0ZSQ',
  paid_date      = '2026-05-11T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26131N0ZSQ';

-- bank_ref: FT26131SWGGQ | CBE ref: FT26131SWGGQ | date: 2026-05-11 | CBE amount: 11,736.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26131SWGGQ',
  paid_date      = '2026-05-11T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26131SWGGQ';

-- bank_ref: FT261358BF5N | CBE ref: FT261358BF5N | date: 2026-05-15 | CBE amount: 95,892.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261358BF5N',
  paid_date      = '2026-05-15T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261358BF5N';

-- bank_ref: FT26135C75Y2 | CBE ref: FT26135C75Y2 | date: 2026-05-15 | CBE amount: 2,806.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26135C75Y2',
  paid_date      = '2026-05-15T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26135C75Y2';

-- bank_ref: FT26135NJ2HJ | CBE ref: FT26135NJ2HJ | date: 2026-05-15 | CBE amount: 7,206.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26135NJ2HJ',
  paid_date      = '2026-05-15T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26135NJ2HJ';

-- bank_ref: FT2613672LCQ | CBE ref: FT2613672LCQ | date: 2026-05-16 | CBE amount: 917,139.91
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2613672LCQ',
  paid_date      = '2026-05-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2613672LCQ';

-- bank_ref: FT26136C511R | CBE ref: FT26136C511R | date: 2026-05-16 | CBE amount: 1,071,310.35
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26136C511R',
  paid_date      = '2026-05-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26136C511R';

-- bank_ref: FT261364DHBH | CBE ref: FT261364DHBH | date: 2026-05-16 | CBE amount: 973,919.04
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261364DHBH',
  paid_date      = '2026-05-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261364DHBH';

-- bank_ref: FT26136KCKKB | CBE ref: FT26136KCKKB | date: 2026-05-16 | CBE amount: 22,854.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26136KCKKB',
  paid_date      = '2026-05-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26136KCKKB';

-- bank_ref: FT261367NC7H | CBE ref: FT261367NC7H | date: 2026-05-16 | CBE amount: 63,734.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261367NC7H',
  paid_date      = '2026-05-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261367NC7H';

-- bank_ref: FT2613884SHY | CBE ref: FT2613884SHY | date: 2026-05-18 | CBE amount: 69,446.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2613884SHY',
  paid_date      = '2026-05-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2613884SHY';

-- bank_ref: FT26138B998C | CBE ref: FT26138B998C | date: 2026-05-18 | CBE amount: 31,729.27
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26138B998C',
  paid_date      = '2026-05-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26138B998C';

-- bank_ref: FT261392B5B5 | CBE ref: FT261392B5B5 | date: 2026-05-19 | CBE amount: 25,814.70
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261392B5B5',
  paid_date      = '2026-05-19T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261392B5B5';

-- bank_ref: FT26139KP8G3 | CBE ref: FT26139KP8G3 | date: 2026-05-19 | CBE amount: 68,321.17
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26139KP8G3',
  paid_date      = '2026-05-19T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26139KP8G3';

-- bank_ref: FT261409KXPH | CBE ref: FT261409KXPH | date: 2026-05-20 | CBE amount: 84,736.43
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261409KXPH',
  paid_date      = '2026-05-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261409KXPH';

-- bank_ref: FT26140K8CG6 | CBE ref: FT26140K8CG6 | date: 2026-05-20 | CBE amount: 23,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26140K8CG6',
  paid_date      = '2026-05-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26140K8CG6';

-- bank_ref: FT26140TQ9NM | CBE ref: FT26140TQ9NM | date: 2026-05-20 | CBE amount: 12,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26140TQ9NM',
  paid_date      = '2026-05-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26140TQ9NM';

-- bank_ref: FT26140S77S1 | CBE ref: FT26140S77S1 | date: 2026-05-20 | CBE amount: 29,710.35
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26140S77S1',
  paid_date      = '2026-05-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26140S77S1';

-- bank_ref: FT26140RM978 | CBE ref: FT26140RM978 | date: 2026-05-20 | CBE amount: 12,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26140RM978',
  paid_date      = '2026-05-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26140RM978';

-- bank_ref: FT26140PWVR4 | CBE ref: FT26140PWVR4 | date: 2026-05-20 | CBE amount: 12,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26140PWVR4',
  paid_date      = '2026-05-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26140PWVR4';

-- bank_ref: FT26143QZ6G6 | CBE ref: FT26143QZ6G6 | date: 2026-05-23 | CBE amount: 391,519.04
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26143QZ6G6',
  paid_date      = '2026-05-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26143QZ6G6';

-- bank_ref: FT26143CZ7DS | CBE ref: FT26143CZ7DS | date: 2026-05-23 | CBE amount: 37,224.09
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26143CZ7DS',
  paid_date      = '2026-05-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26143CZ7DS';

-- bank_ref: FT26145756RS | CBE ref: FT26145756RS | date: 2026-05-25 | CBE amount: 292,179.91
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26145756RS',
  paid_date      = '2026-05-25T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26145756RS';

-- bank_ref: FT2614627SYT | CBE ref: FT2614627SYT | date: 2026-05-26 | CBE amount: 5,206.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2614627SYT',
  paid_date      = '2026-05-26T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2614627SYT';

-- bank_ref: FT26146L5WYD | CBE ref: FT26146L5WYD | date: 2026-05-26 | CBE amount: 7,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26146L5WYD',
  paid_date      = '2026-05-26T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26146L5WYD';

-- bank_ref: FT261463SWW5 | CBE ref: FT261463SWW5 | date: 2026-05-26 | CBE amount: 53,306.15
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261463SWW5',
  paid_date      = '2026-05-26T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261463SWW5';

-- bank_ref: FT26148MXX5W | CBE ref: FT26148MXX5W | date: 2026-05-28 | CBE amount: 584,353.81
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26148MXX5W',
  paid_date      = '2026-05-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26148MXX5W';

-- bank_ref: FT261481RZBR | CBE ref: FT261481RZBR | date: 2026-05-28 | CBE amount: 24,110.35
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261481RZBR',
  paid_date      = '2026-05-28T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261481RZBR';

-- bank_ref: FT26149S0PKH | CBE ref: FT26149S0PKH | date: 2026-05-29 | CBE amount: 11,506.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26149S0PKH',
  paid_date      = '2026-05-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26149S0PKH';

-- bank_ref: FT26149NMH6S | CBE ref: FT26149NMH6S | date: 2026-05-29 | CBE amount: 10,346.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26149NMH6S',
  paid_date      = '2026-05-29T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26149NMH6S';

-- bank_ref: FT261505PXM3 | CBE ref: FT261505PXM3 | date: 2026-05-30 | CBE amount: 6,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261505PXM3',
  paid_date      = '2026-05-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261505PXM3';

-- bank_ref: FT26150HWKVS | CBE ref: FT26150HWKVS | date: 2026-05-30 | CBE amount: 612,223.36
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26150HWKVS',
  paid_date      = '2026-05-30T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26150HWKVS';

-- bank_ref: FT26154ST6V8 | CBE ref: FT26154ST6V8 | date: 2026-06-03 | CBE amount: 9,912.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26154ST6V8',
  paid_date      = '2026-06-03T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26154ST6V8';

-- bank_ref: FT26154FQR37 | CBE ref: FT26154FQR37 | date: 2026-06-03 | CBE amount: 3,606.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26154FQR37',
  paid_date      = '2026-06-03T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26154FQR37';

-- bank_ref: FT26156PDXW2 | CBE ref: FT26156PDXW2 | date: 2026-06-05 | CBE amount: 46,956.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26156PDXW2',
  paid_date      = '2026-06-05T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26156PDXW2';

-- bank_ref: FT2615745MWW | CBE ref: FT2615745MWW | date: 2026-06-06 | CBE amount: 400,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2615745MWW',
  paid_date      = '2026-06-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2615745MWW';

-- bank_ref: FT26157PT891 | CBE ref: FT26157PT891 | date: 2026-06-06 | CBE amount: 49,286.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26157PT891',
  paid_date      = '2026-06-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26157PT891';

-- bank_ref: FT2615729QS4 | CBE ref: FT2615729QS4 | date: 2026-06-06 | CBE amount: 129,585.13
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2615729QS4',
  paid_date      = '2026-06-06T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2615729QS4';

-- bank_ref: FT26159XMNDJ | CBE ref: FT26159XMNDJ | date: 2026-06-08 | CBE amount: 550,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26159XMNDJ',
  paid_date      = '2026-06-08T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26159XMNDJ';

-- bank_ref: FT26163J6SGK | CBE ref: FT26163J6SGK | date: 2026-06-12 | CBE amount: 5,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26163J6SGK',
  paid_date      = '2026-06-12T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26163J6SGK';

-- bank_ref: FT26163F6X20 | CBE ref: FT26163F6X20 | date: 2026-06-12 | CBE amount: 15,606.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26163F6X20',
  paid_date      = '2026-06-12T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26163F6X20';

-- bank_ref: FT26164VTSYL | CBE ref: FT26164VTSYL | date: 2026-06-13 | CBE amount: 41,397.30
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26164VTSYL',
  paid_date      = '2026-06-13T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26164VTSYL';

-- bank_ref: FT26166GQ8RX | CBE ref: FT26166GQ8RX | date: 2026-06-15 | CBE amount: 20,006.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26166GQ8RX',
  paid_date      = '2026-06-15T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26166GQ8RX';

-- bank_ref: FT26167D375B | CBE ref: FT26167D375B | date: 2026-06-16 | CBE amount: 54,350.35
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26167D375B',
  paid_date      = '2026-06-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26167D375B';

-- bank_ref: FT26167YQW1C | CBE ref: FT26167YQW1C | date: 2026-06-16 | CBE amount: 10,211.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26167YQW1C',
  paid_date      = '2026-06-16T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26167YQW1C';

-- bank_ref: FT26168HHQ9S | CBE ref: FT26168HHQ9S | date: 2026-06-17 | CBE amount: 1,168,701.65
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26168HHQ9S',
  paid_date      = '2026-06-17T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26168HHQ9S';

-- bank_ref: FT26169KLFTR | CBE ref: FT26169KLFTR | date: 2026-06-18 | CBE amount: 112,979.91
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26169KLFTR',
  paid_date      = '2026-06-18T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26169KLFTR';

-- bank_ref: FT26170VC0T5 | CBE ref: FT26170VC0T5 | date: 2026-06-19 | CBE amount: 61,705.89
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26170VC0T5',
  paid_date      = '2026-06-19T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26170VC0T5';

-- bank_ref: FT26171WLSLF | CBE ref: FT26171WLSLF | date: 2026-06-20 | CBE amount: 111,129.48
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26171WLSLF',
  paid_date      = '2026-06-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26171WLSLF';

-- bank_ref: FT2617181FVZ | CBE ref: FT2617181FVZ | date: 2026-06-20 | CBE amount: 21,286.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT2617181FVZ',
  paid_date      = '2026-06-20T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT2617181FVZ';

-- bank_ref: FT261736RQMW | CBE ref: FT261736RQMW | date: 2026-06-22 | CBE amount: 50,406.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT261736RQMW',
  paid_date      = '2026-06-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT261736RQMW';

-- bank_ref: FT26173C4DV4 | CBE ref: FT26173C4DV4 | date: 2026-06-22 | CBE amount: 748,458.17
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26173C4DV4',
  paid_date      = '2026-06-22T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26173C4DV4';

-- bank_ref: FT26174Y4R0X | CBE ref: FT26174Y4R0X | date: 2026-06-23 | CBE amount: 30,684.26
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26174Y4R0X',
  paid_date      = '2026-06-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26174Y4R0X';

-- bank_ref: FT26174YTSV9 | CBE ref: FT26174YTSV9 | date: 2026-06-23 | CBE amount: 14,106.00
UPDATE public.expenses
SET
  payment_status = true,
  account_id     = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref       = 'FT26174YTSV9',
  paid_date      = '2026-06-23T00:00:00+00:00'
WHERE payment_status = false
  AND bank_ref = 'FT26174YTSV9';

-- ══════════════════════════════════════════════════════════════════════════
-- C. UPDATE SALES — mark credits received into CBE as Paid
-- Note: Airtable sales records are from 2025-03 to 2025-10 (expo season)
-- The large CBE credits (Dec 2025–Jun 2026) are aggregate/bulk payments
-- that do not have 1:1 matches to individual Airtable sales records.
-- Below we update sales by amount+date for the identified key credits.
-- ══════════════════════════════════════════════════════════════════════════

-- Credit: 2025-12-04       897,421.72 ETB — PO 168727208 (ref: FT25338BNDW4)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT25338BNDW4'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 897416.72 AND 897426.72
  AND date BETWEEN '2025-11-27'::date AND '2025-12-11'::date;

-- Credit: 2025-12-12       138,992.00 ETB — 52495 (ref: FT2534679Y00)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT2534679Y00'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 138987.00 AND 138997.00
  AND date BETWEEN '2025-12-05'::date AND '2025-12-19'::date;

-- Credit: 2025-12-15     1,417,920.00 ETB — AFCABOOTH (ref: FT25349LWMKN)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT25349LWMKN'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 1417915.00 AND 1417925.00
  AND date BETWEEN '2025-12-08'::date AND '2025-12-22'::date;

-- Credit: 2025-12-17     4,078,406.93 ETB — 67830 (ref: FT25351JZLQZ)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT25351JZLQZ'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 4078401.93 AND 4078411.93
  AND date BETWEEN '2025-12-10'::date AND '2025-12-24'::date;

-- Credit: 2025-12-25     1,416,132.58 ETB — Marketing (ref: FT253599J0LL)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT253599J0LL'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 1416127.58 AND 1416137.58
  AND date BETWEEN '2025-12-18'::date AND '2026-01-01'::date;

-- Credit: 2026-01-28     5,658,240.80 ETB — 69003 (ref: FT260289WB61)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT260289WB61'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 5658235.80 AND 5658245.80
  AND date BETWEEN '2026-01-21'::date AND '2026-02-04'::date;

-- Credit: 2026-02-17    20,537,487.60 ETB — CPV7273 KUNCHO (ref: FT26048Y13RJ)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT26048Y13RJ'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 20537482.60 AND 20537492.60
  AND date BETWEEN '2026-02-10'::date AND '2026-02-24'::date;

-- Credit: 2026-02-19     5,351,116.52 ETB — CPV7288 KUNCHO (ref: FT26050Q3JH2)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT26050Q3JH2'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 5351111.52 AND 5351121.52
  AND date BETWEEN '2026-02-12'::date AND '2026-02-26'::date;

-- Credit: 2026-03-24       347,200.00 ETB — CPV7364 KUNCHO (ref: FT2608335FK6)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT2608335FK6'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 347195.00 AND 347205.00
  AND date BETWEEN '2026-03-17'::date AND '2026-03-31'::date;

-- Credit: 2026-03-26       593,600.00 ETB — CPV7372 KUNCH (ref: FT26085GXNFW)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT26085GXNFW'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 593595.00 AND 593605.00
  AND date BETWEEN '2026-03-19'::date AND '2026-04-02'::date;

-- Credit: 2026-04-16     2,500,000.00 ETB — CPV7417 KUNCHO (ref: FT26106HN3W2)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT26106HN3W2'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 2499995.00 AND 2500005.00
  AND date BETWEEN '2026-04-09'::date AND '2026-04-23'::date;

-- Credit: 2026-04-30     2,500,000.00 ETB — CPV7451 KUNCHO (ref: FT26120BRVFX)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT26120BRVFX'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 2499995.00 AND 2500005.00
  AND date BETWEEN '2026-04-23'::date AND '2026-05-07'::date;

-- Credit: 2026-05-15    17,931,290.00 ETB — 0001TRA1351953 (ref: FT261357MZ7G)
UPDATE public.sales
SET
  sales_status = 'Paid',
  account_id   = '890c3473-dc57-4c01-9f39-17518047c463',
  bank_ref     = 'FT261357MZ7G'
WHERE sales_status != 'Paid'
  AND amount_etb BETWEEN 17931285.00 AND 17931295.00
  AND date BETWEEN '2026-05-08'::date AND '2026-05-22'::date;
