-- 423 — Merge the Airtable expenses still missing for 10 Jul – 15 Aug 2026
--
-- (Applied to the database as 418_merge_airtable_expenses_jul10_aug15; renumbered
-- here because 418 was already taken on main.)
--
-- The system went live on 10 Jul, but most of the spending from then to
-- mid-August was only ever entered in Airtable. Of Airtable's 99 expenses
-- dated 10 Jul – 19 Aug, 7 were already here. The CBE statement (imported
-- in 286) shows the rest plainly: 47 outgoing lines in the window that pay
-- nothing in the system. Each Airtable bank reference is one of those lines,
-- and the amounts tie exactly: bank debit = amount less withholding + the
-- transfer charge (6 birr, or 290 on an outward MT103).
--
-- What this records, each through the normal triggers so the ledger posts
-- the way it would from the app:
--
--   * 39 bank-paid expenses (3.63M), matched to their CBE line by reference.
--     Withholding is read off the bank line, not Airtable's estimate. Two
--     Airtable records had no reference but their bank line is on the
--     statement (Wesenu Lemma 19,000 → FT26206F3NYX, Jemal Faris 17,070 →
--     FT26213S4ZKV). Meriam Nasir's three July purchases (54,000 + 750 +
--     3,600) went out in one transfer and are merged as one expense of
--     58,350. Surafel Getiye's 17 Jul MDF was paid by bank at 321,660, as
--     Airtable's own note totals it; its 4,500 transport line is a separate
--     cash expense.
--   * 5 VRF transfers (3.00M receipt value): Atalay Liway, TY Wood ×2,
--     Shukran ×2. They go in as VRFs, approved and marked sent against their
--     bank line. Airtable never recorded who facilitated them, the
--     commission or the money returned, so each is flagged for review.
--   * 19 cash payments (0.65M) — fuel, LADA, small suppliers and site labour
--     with no bank trace — recorded as paid in cash.
--   * 22 weekly site labour sheets (1.58M) that the owner paid personally
--     (Airtable vendor "KUN-Paid From Personal"). They are paid from a new
--     account, "Owner — paid personally", whose ledger account is a
--     liability (2032 Owed to the owner), so the books show what the company
--     owes the owner rather than cash it spent.
--   * GEN-PROP-20260810-01 (Hussain Awal, workshop rent 540,000) was already
--     here but dated 10 Aug and never matched; the bank paid it on 11 Jul
--     (FT26192VFJVP, 3% WHT withheld). Re-dated, matched and marked paid.
--
-- Left out on purpose: one labour sheet entered twice in Airtable
-- (recxyatHNmwrMGCiT), one purchase entered twice (recU7eMLF6tIWnJ2E, the
-- bank-paid copy is merged), Fetiya Mehdi's 17,500 of 10 Jul
-- (recgH8JtZKiF74nQe; the same items are itemised in her 107,500 bank-paid
-- purchase), pickup fuel on 12 Aug that is most likely GEN-FUEL-20260814-01
-- (recj6ApZLzxfFePYB), and one record dated 19 Aug.
--
-- Every merged row's notes carry its Airtable record id, which also makes
-- the migration safe to re-run. Approval and payment are recorded as the
-- admin (approver) and the finance user (payer), as with the earlier 10 Aug
-- catch-up entries; the run acts as the admin.

SET search_path TO public;

CREATE TEMP TABLE _at_merge (
  rid text, at_code text, d date, amount numeric, vendor text, project text,
  category text, etype text, grp text, bank_ref text, descr text, note text
) ON COMMIT DROP;

INSERT INTO _at_merge VALUES
('recfM2a7Y6AgoxozI','PET-C-MES-260710-KUN',DATE '2026-07-10',10000,'KUN-Paid From Personal','Meskel Flower','PETTY','general','owner',NULL,'Site petty purchases (skotch, punta, disks, screws, kacha, ride) — total 9,830','Merged from Airtable recfM2a7Y6AgoxozI (PET-C-MES-260710-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('reccUr5FIHPVk6Y4f','LAB-A-SOL-260711-KUN',DATE '2026-07-11',109400,'KUN-Paid From Personal','Solomon Apartment','Labor','labor_payment','owner',NULL,'Lober , ceramic','Merged from Airtable reccUr5FIHPVk6Y4f (LAB-A-SOL-260711-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('rec5PWALAa7IFIxZz','LAB-B-MES-260711-KUN',DATE '2026-07-11',26500,'KUN-Paid From Personal','Meskel Flower','Labor','labor_payment','owner',NULL,'July 6 – July 11 labour fee','Merged from Airtable rec5PWALAa7IFIxZz (LAB-B-MES-260711-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recIdKhukBCi8LhhY','LAB-B-BIN-260711-KUN',DATE '2026-07-11',26100,'KUN-Paid From Personal','Biniyam Residence','Labor','labor_payment','owner',NULL,'Plasterer, daily labour','Merged from Airtable recIdKhukBCi8LhhY (LAB-B-BIN-260711-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('rectHigTcIF1oQ3IM','LAB-B-CHA-260711-KUN',DATE '2026-07-11',26325,'KUN-Paid From Personal','Chalachew Residence','Labor','labor_payment','owner',NULL,'Cheezler, carpenter, daily labour','Merged from Airtable rectHigTcIF1oQ3IM (LAB-B-CHA-260711-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recZn2sUteuEQK0te','PAI-B+-MES-MEN-260714-MER',DATE '2026-07-14',58350,'Meriam Nasir','Meskel Flower','Paints','purchase_order','bank','FT262229ZVTM','60 pcs silicone × 900 = 54,000 (14 Jul); acid 3 L × 250 = 750 (24 Jul); self screws and fishers 3,600 (30 Jul) — paid together, 58,350','Merged from Airtable recZn2sUteuEQK0te (PAI-B+-MES-MEN-260714-MER), recK0Hjn18fNzfUdB (PAI-C-MES-MEN-260724-MER) and recNW5r3no4shAEkI (SCR-C-MES-MEN-260730-MER): one CBE transfer paid all three.'),
('recOpf9tPmR7vKK5S','MUL-A-MES-MEN-260714-FET',DATE '2026-07-14',107500,'Fetiya Mehdi','Meskel Flower','Multiple','purchase_order','bank','FT26203Y695Z','Gypsum Africa 60 × 1,100 (Biniyam residence); filler 15 × 1,600 (Meskel Flower); skotch and shooter nails 17,500 — total 107,500','Merged from Airtable recOpf9tPmR7vKK5S (MUL-A-MES-MEN-260714-FET).'),
('rec2isWEgZ2STuE1v','PAI-C+-JOT-SIL-260715-ALU',DATE '2026-07-15',21735.07,'Aluminum World Trading PLC','Jotun','Paints','purchase_order','bank','FT26196J7CLM','Paint','Merged from Airtable rec2isWEgZ2STuE1v (PAI-C+-JOT-SIL-260715-ALU).'),
('rechhXAmRSE6VQIZl','INV-C-WOR-DAG-260715',DATE '2026-07-15',3500,'Amedo','Workshop','Inventory','purchase_order','bank','FT26196RC7F8','Rain coat','Merged from Airtable rechhXAmRSE6VQIZl (INV-C-WOR-DAG-260715).'),
('recBB8ZKhxobUSWEM','MDF-A-JOT-MEN-260717-SUR',DATE '2026-07-17',321660,'Surafel Getiye','Jotun','MDF','purchase_order','bank','FT26198TM68Q','MDF 6/12/18 mm for Jotun; riga for Biniyam residence; Safarian (personal for Kidus) 7,710 — total 321,660','Merged from Airtable recBB8ZKhxobUSWEM (MDF-A-JOT-MEN-260717-SUR). Airtable has 326,160; the bank paid for 321,660 and the 4,500 transport is recorded separately as cash.'),
('recBB8ZKhxobUSWEM/transport','MDF-A-JOT-MEN-260717-SUR',DATE '2026-07-17',4500,'Surafel Getiye','Jotun','Transportation','transportation','cash',NULL,'Transport with loading for the 17 Jul MDF purchase','Merged from Airtable recBB8ZKhxobUSWEM/transport (MDF-A-JOT-MEN-260717-SUR): the transport line of that purchase, not in the bank transfer; recorded as paid in cash.'),
('recYiY5JXXKjT3APL','PAI-C+-WOR-SIL-260717-ALU',DATE '2026-07-17',22315.57,'Aluminum World Trading PLC','Workshop','Paints','purchase_order','bank','FT261982GJX3','Paint','Merged from Airtable recYiY5JXXKjT3APL (PAI-C+-WOR-SIL-260717-ALU).'),
('recvzwtLo9xDLsIjd','FUE-C-WOR-SIL-260717-TOT',DATE '2026-07-17',10000,'Total Energies','Workshop','Fuel','fuel','cash',NULL,'Fuel for the 2LT pickup','Merged from Airtable recvzwtLo9xDLsIjd (FUE-C-WOR-SIL-260717-TOT). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recEKO26seA1ENuxy','LAB-A-MES-260718-KUN',DATE '2026-07-18',130062.5,'KUN-Paid From Personal','Meskel Flower','Labor','labor_payment','owner',NULL,'July 13 – July 18 labour fee (incl. contractual worker Nega Mare 99,662.5)','Merged from Airtable recEKO26seA1ENuxy (LAB-A-MES-260718-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recjdGeOgw7gupIOQ','FOA-C-PER-MEN-260718-YIB',DATE '2026-07-18',7872,'Yibgeta Wake','Personal Related','Personal withdraws','general','bank','FT26203GF9CL','Fiber 2 bags (for Kidus) and previous remaining payment (Zemen Bank) — total 7,872','Merged from Airtable recjdGeOgw7gupIOQ (FOA-C-PER-MEN-260718-YIB).'),
('recMW3GfLHSPwba2Q','LAB-B+-SOL-260718-KUN',DATE '2026-07-18',54300,'KUN-Paid From Personal','Solomon Apartment','Labor','labor_payment','owner',NULL,'Labor works','Merged from Airtable recMW3GfLHSPwba2Q (LAB-B+-SOL-260718-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recBHopvRy1GHqX19','LAB-C+-BIN-260718-KUN',DATE '2026-07-18',18800,'KUN-Paid From Personal','Biniyam Residence','Labor','labor_payment','owner',NULL,'Chack team, cheezler, daily labour, contractual work','Merged from Airtable recBHopvRy1GHqX19 (LAB-C+-BIN-260718-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recMbXKoo4WLT1ypR','LAB-B-CHA-260718-KUN',DATE '2026-07-18',36050,'KUN-Paid From Personal','Chalachew Residence','Labor','labor_payment','owner',NULL,'Cheezler, chack team, carpenter, daily labour','Merged from Airtable recMbXKoo4WLT1ypR (LAB-B-CHA-260718-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recrrpprdbw81ynwS','FUE-C+-WOR-SIL-260721-TOT',DATE '2026-07-21',11000,'Total Energies','Workshop','Fuel','fuel','cash',NULL,'Fuel for the 2LT pickup','Merged from Airtable recrrpprdbw81ynwS (FUE-C+-WOR-SIL-260721-TOT). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recWWn6NIN80sxxfR','LAB-C-SAM-DAG-260721-NEW',DATE '2026-07-21',7000,'New Vendor','Sami Apartment','Labor','labor_payment','cash',NULL,'Electrical works 4 days × 1,500 and 3 pendant installations 1,000','Merged from Airtable recWWn6NIN80sxxfR (LAB-C-SAM-DAG-260721-NEW). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recmp4FAmZzwebzXU','ELE-C+-BIN-MEN-260722-ABD',DATE '2026-07-22',14470,'Abduselam murad retail trade of electrical equipment','Biniyam Residence','Electrical Materials','purchase_order','bank','FT26222K47BC','Scatola, wire 1.5, nastro, guroro, dish cable — total 14,470','Merged from Airtable recmp4FAmZzwebzXU (ELE-C+-BIN-MEN-260722-ABD).'),
('receUUT3QsYNbZWrf','OFF-B+-OFF-MEN-260722-NEW',DATE '2026-07-22',86000,'New Vendor','Office Materials','Office Inventory','general','cash',NULL,'Fridge 38,525, microwave 40,000, metbesha 7,475 — total 86,000','Merged from Airtable receUUT3QsYNbZWrf (OFF-B+-OFF-MEN-260722-NEW). Payee per Airtable: Amare Lemma. No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recw0bAW0NnoNL4t4','LAB-C-JOT-260722-KAL',DATE '2026-07-22',9000,'Kalush Getachew','Jotun','Labor','labor_payment','cash',NULL,'Jotun Bethel shop electrical installation 7,000 and FIFA light box 2,000','Merged from Airtable recw0bAW0NnoNL4t4 (LAB-C-JOT-260722-KAL). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('rec9UbmkWTWyfB5QX','LAB-B+-CHA-260722-SAM',DATE '2026-07-22',100000,'Samuel Asfaw','Chalachew Residence','Labor','labor_payment','cash',NULL,'Advance payment for board works, Chalachew site','Merged from Airtable rec9UbmkWTWyfB5QX (LAB-B+-CHA-260722-SAM). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('reclaX1hmYron3Ls9','GOV-A-TAX-DAG-260723-ET',DATE '2026-07-23',276959.29,'ET NAAZ E MONEY','Taxes','Government Expense','general','bank','FT262046QXRC','May payroll tax 250,466.70 and pension 26,492.59','Merged from Airtable reclaX1hmYron3Ls9 (GOV-A-TAX-DAG-260723-ET).'),
('rec94JaFt0y5DQKMd','TRA-B+-ADM-DAG-260723-HYB',DATE '2026-07-23',80586.3,'Hybrid Designs PLC','Admin Related Expense','Transportation','transportation','bank','FT262045P7V6','May ride hailing expense','Merged from Airtable rec94JaFt0y5DQKMd (TRA-B+-ADM-DAG-260723-HYB).'),
('recwfYCK0InQD0Hcy','GYP-C+-BIN-MEN-260723-NEW',DATE '2026-07-23',12262,'New Vendor','Biniyam Residence','Gypsum','purchase_order','cash',NULL,'Local board 60 × 175 and samuna frame 35.25 m × 50 — total 12,262','Merged from Airtable recwfYCK0InQD0Hcy (GYP-C+-BIN-MEN-260723-NEW). Payee per Airtable: Sultan Ibrahim. No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recYrNva4ALYKmN74','CEM-B+-BIN-MEN-260723-ETH',DATE '2026-07-23',63000,'Ethio Steel','Biniyam Residence','Cement','purchase_order','bank','FT262055LL18','Cement board 6 × 10,500 = 63,000','Merged from Airtable recYrNva4ALYKmN74 (CEM-B+-BIN-MEN-260723-ETH).'),
('recVhV0nU7B1YiVms','MUL-A-BIN-MEN-260724-FET',DATE '2026-07-24',107200,'Fetiya Mehdi','Biniyam Residence','Multiple','purchase_order','bank','FT262220TTBS','Dullentin, sand paper, lacker, pinsa, shutter (workshop); gypsum, putty, kacha (Biniyam residence) — total 107,200','Merged from Airtable recVhV0nU7B1YiVms (MUL-A-BIN-MEN-260724-FET).'),
('recR06CofgZB69gvF','LAB-B-BIN-260724-KUN',DATE '2026-07-24',29600,'KUN-Paid From Personal','Biniyam Residence','Labor','labor_payment','owner',NULL,'Chack team, plasterer, daily labour, contractual work','Merged from Airtable recR06CofgZB69gvF (LAB-B-BIN-260724-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recR0ZZ6PkM80KpND','LAB-B-CHA-260725-NEW',DATE '2026-07-25',50000,'New Vendor','Chalachew Residence','Labor','labor_payment','cash',NULL,'Screed labour work advance payment','Merged from Airtable recR0ZZ6PkM80KpND (LAB-B-CHA-260725-NEW). Payee per Airtable: screed labour (Nebil Seid). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recLTkfjEtgB2ZQKS','BUI-C+-WOR-MEN-260725-WES',DATE '2026-07-25',19000,'Wesenu Lemma','Workshop','Building Materials','purchase_order','bank','FT26206F3NYX','Blocket 200 × 80 = 16,000 and transport 3,000','Merged from Airtable recLTkfjEtgB2ZQKS (BUI-C+-WOR-MEN-260725-WES).'),
('reckKRY2SfNS9cjDR','LAB-B+-JOT-260725-ABR',DATE '2026-07-25',100000,'Abreham Girma Labor','Jotun','Labor','labor_payment','cash',NULL,'Payment for Jotun shops (remaining paid after the shops are measured)','Merged from Airtable reckKRY2SfNS9cjDR (LAB-B+-JOT-260725-ABR). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recwLJurOMwMQhzya','LAB-B+-MES-260725-KUN',DATE '2026-07-25',63057,'KUN-Paid From Personal','Meskel Flower','Labor','labor_payment','owner',NULL,'July 20 – July 25 labour fee (incl. contractual worker Nega Mare 40,757)','Merged from Airtable recwLJurOMwMQhzya (LAB-B+-MES-260725-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('rec1KL3dXMHSU00k0','LAB-A-SOL-260725-KUN',DATE '2026-07-25',128264.4,'KUN-Paid From Personal','Solomon Apartment','Labor','labor_payment','owner',NULL,'Screed work, cleaning and ceramic','Merged from Airtable rec1KL3dXMHSU00k0 (LAB-A-SOL-260725-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('rec5zWMzKezVIawgq','LAB-B-CHA-260725-KUN',DATE '2026-07-25',35600,'KUN-Paid From Personal','Chalachew Residence','Labor','labor_payment','owner',NULL,'Mason, cheezler, daily labour, chack team','Merged from Airtable rec5zWMzKezVIawgq (LAB-B-CHA-260725-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recVcAAw47Ceocgfl','FOA-C-OFF-MEN-260727-MAL',DATE '2026-07-27',8900,'Maleda Foam','Office Materials','Foam','purchase_order','bank','FT262085RZ31','HD sponge and sponge roll — total 8,900','Merged from Airtable recVcAAw47Ceocgfl (FOA-C-OFF-MEN-260727-MAL).'),
('recK0AUbZK3DNdy3K','PAI-B-PER-DAG-260727-JM',DATE '2026-07-27',24000,'JM Coat importng PLC','Personal Related','Personal withdraws','general','bank','FT26208F3PL2','Personal payment for Auto Clear paint','Merged from Airtable recK0AUbZK3DNdy3K (PAI-B-PER-DAG-260727-JM).'),
('rec9CDJMz0Xk51kQ3','PAI-C+-JOT-NEB-260727-MAS',DATE '2026-07-27',17600,'Master Shade','Jotun','Paints','purchase_order','bank','FT26208HQ9P3','2 gallons mixed paint for Jotun branding','Merged from Airtable rec9CDJMz0Xk51kQ3 (PAI-C+-JOT-NEB-260727-MAS).'),
('recUDOl3CQr02DOtg','TRA-C-OFF-MEN-260727-LAD',DATE '2026-07-27',5500,'LADA Driver','Office Materials','Transportation','transportation','cash',NULL,'LADA trips: Chalachew site 2,000, Biniyam residence 1,500, office 2,000','Merged from Airtable recUDOl3CQr02DOtg (TRA-C-OFF-MEN-260727-LAD). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recVpfrEVDBF2h1yH','FUE-C+-WOR-SIL-260728-TOT',DATE '2026-07-28',11000,'Total Energies','Workshop','Fuel','fuel','cash',NULL,'Fuel for the 2LT pickup','Merged from Airtable recVpfrEVDBF2h1yH (FUE-C+-WOR-SIL-260728-TOT). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recSaQbUvrHNTe202','ALU-A-SOL-MEN-260728-ETH',DATE '2026-07-28',252000,'Ethio Steel','Solomon Apartment','Aluminum','purchase_order','bank','FT26209VLX2C','Armstrong 180 m² × 1,400 = 252,000','Merged from Airtable recSaQbUvrHNTe202 (ALU-A-SOL-MEN-260728-ETH).'),
('reckqo5yDsNfCBBw7','MDF-B+-JOT-MEN-260728-SUR',DATE '2026-07-28',73500,'Surafel Getiye','Jotun','MDF','purchase_order','cash',NULL,'MDF 6 mm 30 × 2,450 = 73,500','Merged from Airtable reckqo5yDsNfCBBw7 (MDF-B+-JOT-MEN-260728-SUR). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recGy9icOFhjkAkCK','BUI-C-MES-MEN-260729-FIF',DATE '2026-07-29',9657,'Fifila Retail Trade Business','MESOB - Science Museum','Building Materials','purchase_order','bank','FT26212PHY0G','Saw 40 teeth 5,229 and lock 4,428','Merged from Airtable recGy9icOFhjkAkCK (BUI-C-MES-MEN-260729-FIF).'),
('recSxxcYvosFp5cQR','MUL-B-WOR-MEN-260730-TEN',DATE '2026-07-30',23800,'Tenaye Takele','Workshop','Multiple','purchase_order','bank','FT26212YZYSS','Sand 2 m³ 16,000 and cement 3 qntl 7,800','Merged from Airtable recSxxcYvosFp5cQR (MUL-B-WOR-MEN-260730-TEN).'),
('recpdT7UXFbpfzUrW','SAN-C+-BIN-MEN-260730-DAN',DATE '2026-07-30',11250,'Daniel Lemma','Biniyam Residence','Sanitary Material','purchase_order','bank','FT26222VWRJ3','PPR and PVC fittings, taps — total 11,250','Merged from Airtable recpdT7UXFbpfzUrW (SAN-C+-BIN-MEN-260730-DAN).'),
('recPcR4heBOnLvVi1','FUE-C-WOR-SIL-260801-TOT',DATE '2026-08-01',10000,'Total Energies','Workshop','Fuel','fuel','cash',NULL,'Fuel for the 2LT pickup','Merged from Airtable recPcR4heBOnLvVi1 (FUE-C-WOR-SIL-260801-TOT). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recV10HIrIFV8Lqyi','LAB-B-BIN-260801-KUN',DATE '2026-08-01',28300,'KUN-Paid From Personal','Biniyam Residence','Labor','labor_payment','owner',NULL,'Chack team, cheezler, daily labour','Merged from Airtable recV10HIrIFV8Lqyi (LAB-B-BIN-260801-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recqllJgTMtJxEfw6','BUI-C+-OFF-MEN-260801-JEM',DATE '2026-08-01',17070,'Jemal Faris Edris','Office Materials','Building Materials','purchase_order','bank','FT26213S4ZKV','Hydraulic and normal slider bale (Jotun and office) — total 17,070','Merged from Airtable recqllJgTMtJxEfw6 (BUI-C+-OFF-MEN-260801-JEM).'),
('recoh8Wd0XuOvJyt7','LAB-B+-MES-260801-KUN',DATE '2026-08-01',65848.8,'KUN-Paid From Personal','Meskel Flower','Labor','labor_payment','owner',NULL,'July 27 – Aug 1 labour fee (incl. contractual worker Nega Mare 38,948.8)','Merged from Airtable recoh8Wd0XuOvJyt7 (LAB-B+-MES-260801-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recJvQoKt7z88QxJd','LAB-C+-WOR-NEB-260801-NEW',DATE '2026-08-01',15500,'New Vendor','Workshop Maintenance','Labor','labor_payment','cash',NULL,'Labour: Belay 5 × 1,500 and Balew 2 people × 5 × 800','Merged from Airtable recJvQoKt7z88QxJd (LAB-C+-WOR-NEB-260801-NEW). Payee per Airtable: Belay and Balew (site labour). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('reczaiNyAhYOLJgCK','LAB-A-SOL-260801-KUN',DATE '2026-08-01',121182.4,'KUN-Paid From Personal','Solomon Apartment','Labor','labor_payment','owner',NULL,'Ceramic, cleaning and screed work','Merged from Airtable reczaiNyAhYOLJgCK (LAB-A-SOL-260801-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recbaKPNm2Muoz6dc','LAB-B-CHA-260802-KUN',DATE '2026-08-02',38150,'KUN-Paid From Personal','Chalachew Residence','Labor','labor_payment','owner',NULL,'Cheezler, chack team, daily labour','Merged from Airtable recbaKPNm2Muoz6dc (LAB-B-CHA-260802-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('rec3uh9IqI4IdoKUX','ELE-B+-MES-MEN-260803-WE',DATE '2026-08-03',69000,'We Care Lights (Mohammed Worku)','MESOB - Science Museum','Electrical Materials','purchase_order','bank','FT262221R368','Magnetic track 3 m, 10 × 6,900 (Mesob Meskel Square)','Merged from Airtable rec3uh9IqI4IdoKUX (ELE-B+-MES-MEN-260803-WE).'),
('recMp1UVE04h29LPV','BUI-B-SOL-MEN-260803-FET',DATE '2026-08-03',40500,'Fetiya Mehdi','Solomon Apartment','Building Materials','purchase_order','bank','FT26222YQ67G','Hooks, galvanized sheet, wire roll — total 40,500','Merged from Airtable recMp1UVE04h29LPV (BUI-B-SOL-MEN-260803-FET).'),
('recZiOPV9M0nnSL33','BUI-B-SOL-MEN-260803-TAM',DATE '2026-08-03',42269.98,'Herod','Solomon Apartment','Building Materials','purchase_order','bank','FT26222X0ZFQ','Fishers, bits, rollers, brushes, ceramic cutter — 36,756.50 + VAT 5,513.48','Merged from Airtable recZiOPV9M0nnSL33 (BUI-B-SOL-MEN-260803-TAM). Payee per Airtable: Tamiru Asfaw (Herod).'),
('recJo9SdQeHscHPSe','MUL-B-MES-MEN-260803-FRE',DATE '2026-08-03',35708,'Frehiwot Belay','MESOB - Science Museum','Multiple','purchase_order','bank','FT262224QFHT','Anchor bolts 25,208 (Meskel Flower) and electrodes 10,500 (Mesob, workshop)','Merged from Airtable recJo9SdQeHscHPSe (MUL-B-MES-MEN-260803-FRE).'),
('recKiBziQ8ufbR10y','ELE-A-MES-MEN-260803-ABD',DATE '2026-08-03',114775,'Abduselam murad retail trade of electrical equipment','MESOB - Science Museum','Electrical Materials','purchase_order','bank','FT26222PDDYN','Aluminium profile, conduit, scatola, cable 2.5 and 1.5, nastro — total 114,775','Merged from Airtable recKiBziQ8ufbR10y (ELE-A-MES-MEN-260803-ABD).'),
('recuuhOl1q929CyYY','MUL-B-OFF-MEN-260803-TAM',DATE '2026-08-03',40980,'Herod','Office Materials','Multiple','purchase_order','bank','FT262221F38G','Trunking, sockets, wire (old office); grinding and cutting discs (Solomon apartment) — total 40,980','Merged from Airtable recuuhOl1q929CyYY (MUL-B-OFF-MEN-260803-TAM). Payee per Airtable: Tamiru Asfaw (Herod).'),
('recA4Xk4m40pzMS3X','PAI-C-JOT-SIL-260803-ALU',DATE '2026-08-03',5116.74,'Aluminum World Trading PLC','Jotun','Paints','purchase_order','bank','FT262152LYNY','Paint','Merged from Airtable recA4Xk4m40pzMS3X (PAI-C-JOT-SIL-260803-ALU).'),
('recNID1PFzHoMh7KM','FOA-C+-MES-MEN-260803-MAL',DATE '2026-08-03',21600,'Maleda Foam','MESOB - Science Museum','Foam','purchase_order','bank','FT26222Z1B8Y','HD sponge 4 × 4,250 and sponge roll 2 × 2,300','Merged from Airtable recNID1PFzHoMh7KM (FOA-C+-MES-MEN-260803-MAL).'),
('recNNR2CmlrVff1yb','FOA-B-MES-MEN-260803-YIB',DATE '2026-08-03',25500,'Yibgeta Wake','MESOB - Science Museum','Foam','purchase_order','bank','FT26222QR9H3','Boded 6 cm 3 × 8,500','Merged from Airtable recNNR2CmlrVff1yb (FOA-B-MES-MEN-260803-YIB).'),
('recmuNsGoBavgepGl','MDF-A-MES-MEN-260803-SUR',DATE '2026-08-03',330775,'Surafel Getiye','MESOB - Science Museum','MDF','purchase_order','bank','FT26222YQYP2','MDF 6/10/12 mm (Jotun and Mesob) and morale 7×5 — total 330,775','Merged from Airtable recmuNsGoBavgepGl (MDF-A-MES-MEN-260803-SUR).'),
('recbthJlMXi2yPV5J','BUI-C-MES-MEN-260804-AMA',DATE '2026-08-04',7900,'Amanuel Berta','MESOB - Science Museum','Building Materials','purchase_order','cash',NULL,'Steel 20×20×6 mm 10 × 550 and anchors 40 × 60 (Mesob airport)','Merged from Airtable recbthJlMXi2yPV5J (BUI-C-MES-MEN-260804-AMA). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recN1gy7H7RKgyyj0','MOR-B-MES-MEN-260804-HAY',DATE '2026-08-04',40250,'Haysem Payen General Trading PLC','MESOB - Science Museum','Morale','purchase_order','bank','FT262224YKRG','Australia morale 4×5, 35 × 1,150 (Mesob Meskel Square and airport)','Merged from Airtable recN1gy7H7RKgyyj0 (MOR-B-MES-MEN-260804-HAY).'),
('recuZh3V6WnropDeT','PAI-A-MES-SIL-260805-ALU',DATE '2026-08-05',103083.15,'Aluminum World Trading PLC','MESOB - Science Museum','Paints','purchase_order','cash',NULL,'Jotun white paint','Merged from Airtable recuZh3V6WnropDeT (PAI-A-MES-SIL-260805-ALU). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('reclXN9eAhn3ubICy','MOR-C+-MES-MEN-260805-ZAK',DATE '2026-08-05',19800,'Zakiya Redwan (Mubarek redwan)','MESOB - Science Museum','Morale','purchase_order','cash',NULL,'Morale 4×5, 18 × 1,100','Merged from Airtable reclXN9eAhn3ubICy (MOR-C+-MES-MEN-260805-ZAK). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('rech1rQ876dLSGfSs','FUE-C+-WOR-SIL-260807-TOT',DATE '2026-08-07',11000,'Total Energies','Workshop','Fuel','fuel','cash',NULL,'Fuel for the 2LT pickup','Merged from Airtable rech1rQ876dLSGfSs (FUE-C+-WOR-SIL-260807-TOT). No bank reference in Airtable or on the CBE statement; recorded as paid in cash.'),
('recadV0n4OAPNc1IX','LAB-A-SOL-260808-KUN',DATE '2026-08-08',273440.03,'KUN-Paid From Personal','Solomon Apartment','Labor','labor_payment','owner',NULL,'Cleaning, ceramic, painting, cheesling and screed works','Merged from Airtable recadV0n4OAPNc1IX (LAB-A-SOL-260808-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recLvP6WSNBoJJHep','LAB-B+-MES-260808-KUN',DATE '2026-08-08',58232,'KUN-Paid From Personal','Meskel Flower','Labor','labor_payment','owner',NULL,'Aug 3 – Aug 8 labour fee (incl. contractual worker Nega Mare 45,832)','Merged from Airtable recLvP6WSNBoJJHep (LAB-B+-MES-260808-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recWZCIkb2s0JZdRa','LAB-C+-BIN-260808-KUN',DATE '2026-08-08',21600,'KUN-Paid From Personal','Biniyam Residence','Labor','labor_payment','owner',NULL,'Daily labour, contractual work','Merged from Airtable recWZCIkb2s0JZdRa (LAB-C+-BIN-260808-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recG6WnPViUzdhBp7','LAB-B-CHA-260808-KUN',DATE '2026-08-08',44800,'KUN-Paid From Personal','Chalachew Residence','Labor','labor_payment','owner',NULL,'Chack team, cheezler, daily labour, carpenter','Merged from Airtable recG6WnPViUzdhBp7 (LAB-B-CHA-260808-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.'),
('recB5zut9vU5McJuP','WOO-A-MES-MEN-260810-SUR',DATE '2026-08-10',443237.5,'Surafel Getiye','MESOB - Science Museum','Wood','purchase_order','bank','FT2622445NM0','Hawasa A, MDF, Safarian and enchet for Mesob airport and Meskel Square — total 443,237.5','Merged from Airtable recB5zut9vU5McJuP (WOO-A-MES-MEN-260810-SUR).'),
('recmoNpLMK7as4nZL','ELE-A-MES-MEN-260812-ABD',DATE '2026-08-12',160150,'Abduselam murad retail trade of electrical equipment','MESOB - Science Museum','Electrical Materials','purchase_order','bank','FT26224JYP96','Aluminium profile, strip and spot lights, cable, breakers (Mesob airport 102,200; Meskel Square 45,750; Biniyam residence 11,200)','Merged from Airtable recmoNpLMK7as4nZL (ELE-A-MES-MEN-260812-ABD).'),
('recP9Yvpu3ZVt1kRu','ALU-A-MES-MEN-260812-SAD',DATE '2026-08-12',293250,'SADOR ALUMINIUM','MESOB - Science Museum','Aluminum','purchase_order','bank','FT2622471DQP','PC sheet 3 × 97,750 (Mesob Meskel Square)','Merged from Airtable recP9Yvpu3ZVt1kRu (ALU-A-MES-MEN-260812-SAD).'),
('recghwLrOtu0Mlv6z','ALU-B+-MES-MEN-260812-END',DATE '2026-08-12',59500,'Endurance Trading PLC','MESOB - Science Museum','Aluminum','purchase_order','bank','FT26224KJW6W','Aluminium cladding (white) 5 × 11,900 (Mesob airport)','Merged from Airtable recghwLrOtu0Mlv6z (ALU-B+-MES-MEN-260812-END).'),
('recU89q45XlVdPJQX','PRI-A-MES-DAG-260812-MER',DATE '2026-08-12',323300,'Meron Printing Trade','Meskel Flower','Printing','general','bank','FT26224XSQVF','Foam board UV print, banners, fabric, mug and UV DTF prints, stickers — 281,130.51 + VAT 42,169.58','Merged from Airtable recU89q45XlVdPJQX (PRI-A-MES-DAG-260812-MER).'),
('reclXzScMXcSJpRwy','ALU-C+-MES-MEN-260812-SAD',DATE '2026-08-12',12364.8,'SADOR ALUMINIUM','MESOB - Science Museum','Aluminum','purchase_order','bank','FT262248JWGN','Weather strip for PC sheet 4 × 3,091.2 (Mesob Meskel Square)','Merged from Airtable reclXzScMXcSJpRwy (ALU-C+-MES-MEN-260812-SAD).'),
('reciX6ZisdIIO6THq','MUL-A-BIN-MEN-260813-SEI',DATE '2026-08-13',100100,'Seida Faris','Biniyam Residence','Multiple','purchase_order','bank','FT262256RJ2P','L frame, C channel, omega (Biniyam residence); china board and verticals (Abay investment) — total 100,100','Merged from Airtable reciX6ZisdIIO6THq (MUL-A-BIN-MEN-260813-SEI).'),
('rec6oKoRntjPMLhtn','LAB-A-SOL-260815-KUN',DATE '2026-08-15',233160,'KUN-Paid From Personal','Solomon Apartment','Labor','labor_payment','owner',NULL,'Cleaning, painting, cheesling and screed works','Merged from Airtable rec6oKoRntjPMLhtn (LAB-A-SOL-260815-KUN). Paid personally by the owner (Airtable: KUN-Paid From Personal); owed to the owner.');

CREATE TEMP TABLE _at_vrf (rid text, at_code text, d date, receipt_amount numeric, vendor text, bank_ref text) ON COMMIT DROP;
INSERT INTO _at_vrf VALUES
('recauyel1TCcumPiq','VRF-A-ADM-DAG-260728-ATA',DATE '2026-07-28',600000,'Atalay Liway','FT26209D9MXD'),
('recSZuicgsCZtNr9x','VRF-A-ADM-DAG-260810-TY',DATE '2026-08-10',727200,'TY Wood Manufacturing PLC','FT262226365S'),
('recJiVtSCLd4QZE2K','VRF-A-ADM-DAG-260810-TY',DATE '2026-08-10',769500,'TY Wood Manufacturing PLC','FT26222F287G'),
('recNBylDeih1bFcHa','VRF-A-ADM-DAG-260812-SHU',DATE '2026-08-12',400000,'Shukran Electric And Cons PLC','FT26224F5T41'),
('recawHjDFCQhRksTP','VRF-A-ADM-DAG-260814-SHU',DATE '2026-08-14',500000,'Shukran Electric And Cons PLC','FT26226YW447');

DO $merge$
DECLARE
  v_admin uuid; v_fin uuid; v_cbe uuid; v_owner uuid;
  r record; t record; v record;
  v_vendor uuid; v_project uuid; v_category uuid; v_wht numeric; v_paid date; v_id uuid; v_name text;
  v_due numeric; v_net numeric; v_fee numeric;
BEGIN
  SELECT id INTO v_admin FROM user_profiles WHERE full_name = 'Dagmawi Rahel' AND role = 'admin';
  SELECT id INTO v_fin   FROM user_profiles WHERE full_name = 'Dagmawi Fitsum' AND role = 'finance';
  SELECT id INTO v_cbe   FROM accounts WHERE account_name = 'Commercial Bank of Ethiopia';
  IF v_admin IS NULL OR v_fin IS NULL OR v_cbe IS NULL THEN
    RAISE EXCEPTION 'Approver, payer or CBE account not found';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- ── The owner's personal funds, as something the company owes ─────────
  SELECT id INTO v_owner FROM accounts WHERE account_name = 'Owner — paid personally';
  IF v_owner IS NULL THEN
    INSERT INTO accounts (account_name, type, status, role, notes)
    VALUES ('Owner — paid personally', 'Owner funds', 'Active', 'other',
            'Company costs the owner paid from personal funds. Its balance is what the company owes the owner, not cash the company holds.')
    RETURNING id INTO v_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE linked_account_id = v_owner) THEN
    INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active,
                                   linked_account_id, cash_flow_section, description)
    SELECT '2032', 'Owed to the owner (paid personally)', 'Liability', parent_account_id, true, true,
           v_owner, 'financing', 'Company costs the owner paid personally, not yet repaid.'
    FROM chart_of_accounts WHERE account_code = '2031';
  END IF;

  -- ── Hussain Awal's rent: paid by the bank on 11 Jul ───────────────────
  UPDATE expenses
     SET expense_code = NULL, date = DATE '2026-07-11', bank_ref = 'FT26192VFJVP',
         wht_amount = 14086.96, payment_method = 'transfer', payment_state = 'paid',
         paid_date = DATE '2026-07-11', disbursed_by = COALESCE(disbursed_by, v_fin),
         notes = concat_ws(' ', notes, 'Matched to CBE FT26192VFJVP (paid 11 Jul, 3% WHT withheld) and re-dated from 10 Aug, per Airtable recVFSB9qDo6kPDdQ.')
   WHERE expense_code = 'GEN-PROP-20260810-01' AND payment_state = 'sent' AND transfer_id IS NULL;

  -- ── The expenses ──────────────────────────────────────────────────────
  FOR r IN SELECT * FROM _at_merge ORDER BY d, rid LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM expenses WHERE notes LIKE '%' || r.rid || '%');

    SELECT id INTO v_vendor FROM vendors WHERE lower(btrim(vendor_name)) = lower(btrim(r.vendor)) LIMIT 1;
    SELECT id INTO v_project FROM projects WHERE lower(btrim(project_name)) = lower(btrim(r.project)) LIMIT 1;
    SELECT id INTO v_category FROM categories WHERE lower(btrim(category_name)) = lower(btrim(r.category)) LIMIT 1;
    IF v_vendor IS NULL OR v_project IS NULL OR v_category IS NULL THEN
      RAISE EXCEPTION '% (%): vendor %, project % or category % not found', r.rid, r.at_code, r.vendor, r.project, r.category;
    END IF;

    v_wht := 0; v_paid := r.d;
    IF r.grp = 'bank' THEN
      SELECT * INTO t FROM transfers WHERE transfer_id_code = r.bank_ref AND from_account_id = v_cbe;
      IF NOT FOUND THEN RAISE EXCEPTION '% (%): bank line % not found', r.rid, r.at_code, r.bank_ref; END IF;
      IF EXISTS (SELECT 1 FROM expenses WHERE transfer_id = t.id) THEN
        RAISE EXCEPTION '% (%): bank line % already pays an expense', r.rid, r.at_code, r.bank_ref;
      END IF;
      -- The bank paid the amount less withholding, plus its 6 birr charge.
      -- The bank paid the bill less any withholding, plus its charge: 6 birr
      -- on a local transfer, 290 on an outward MT103 (see 286). Withholding
      -- is the WHT rate on the pre-VAT amount, both rates read from the
      -- tax tables for the purchase date.
      v_due := round(r.amount / (1 + (tax_rate_note('VAT', r.d) ->> 'standard_rate')::numeric)
                     * (tax_rate_note('WHT', r.d) ->> 'rate')::numeric, 2);
      v_wht := NULL;
      FOREACH v_fee IN ARRAY ARRAY[6, 290]::numeric[] LOOP
        v_net := t.amount - v_fee;
        IF abs(r.amount - v_net) < 1 THEN v_wht := 0; EXIT; END IF;
        IF abs(r.amount - v_due - v_net) < 1 THEN v_wht := v_due; EXIT; END IF;
      END LOOP;
      IF v_wht IS NULL THEN
        RAISE EXCEPTION '% (%): bank line % (%) does not tie to the amount %', r.rid, r.at_code, r.bank_ref, t.amount, r.amount;
      END IF;
      v_paid := t.date;
    END IF;

    INSERT INTO expenses (date, item_service_description, amount_etb, wht_amount, vendor_id, project_id,
                          category_id, expense_type, approval_status, finance_approved_by, finance_approved_at,
                          payment_state, payment_method, bank_ref, account_id, disbursed_by, paid_date, notes)
    VALUES (r.d, r.descr, r.amount, NULLIF(v_wht, 0), v_vendor, v_project,
            v_category, r.etype::expense_category, 'finance_approved', v_admin, now(),
            'paid', CASE r.grp WHEN 'bank' THEN 'transfer' WHEN 'cash' THEN 'cash' ELSE 'other' END,
            r.bank_ref, CASE r.grp WHEN 'bank' THEN v_cbe WHEN 'owner' THEN v_owner END,
            v_fin, v_paid, r.note);
  END LOOP;

  -- ── The VRFs ──────────────────────────────────────────────────────────
  FOR v IN SELECT * FROM _at_vrf ORDER BY d, bank_ref LOOP
    SELECT * INTO t FROM transfers WHERE transfer_id_code = v.bank_ref AND from_account_id = v_cbe;
    IF NOT FOUND THEN RAISE EXCEPTION '% (%): bank line % not found', v.rid, v.at_code, v.bank_ref; END IF;
    CONTINUE WHEN EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE out_transfer_id = t.id);
    SELECT id INTO v_vendor FROM vendors WHERE lower(btrim(vendor_name)) = lower(btrim(v.vendor)) LIMIT 1;
    IF v_vendor IS NULL THEN RAISE EXCEPTION '%: vendor % not found', v.rid, v.vendor; END IF;

    SELECT 'VRF-' || to_char(v.d, 'YYYYMMDD') || '-' || lpad((count(*) + 1)::text, 2, '0') INTO v_name
    FROM vendor_receipt_facilitation WHERE record_name LIKE 'VRF-' || to_char(v.d, 'YYYYMMDD') || '-%';

    INSERT INTO vendor_receipt_facilitation (record_name, facilitator_name, vendor_id, receipt_amount, trxn_date,
                                             supply_kind, commission_basis, commission_amount, initial_account_id,
                                             structured, needs_review, review_notes, notes)
    VALUES (v_name, 'Not recorded in Airtable', v_vendor, v.receipt_amount, v.d,
            'goods', 'fixed', 0, v_cbe, true, true,
            ARRAY['Who facilitated this VRF? Airtable did not record it.',
                  'Record the commission and the money returned.'],
            'Merged from Airtable ' || v.rid || ' (' || v.at_code || '). Sent by CBE transfer ' || v.bank_ref || '.')
    RETURNING id INTO v_id;
    PERFORM approve_vrf_payment(v_id);
    PERFORM mark_vrf_sent(v_id, t.id, NULL);
  END LOOP;
END
$merge$;
