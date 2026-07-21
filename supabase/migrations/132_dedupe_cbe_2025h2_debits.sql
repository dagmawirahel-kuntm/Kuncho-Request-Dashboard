-- ============================================================
-- Delete 167 duplicate CBE 2025H2-backfill debit transfers.
--
-- migration 129 was written to insert only 569 of the 736 real
-- pre-Dec-2025 CBE statement rows (83 credits + 486 debits), deliberately
-- excluding 167 debits already reflected via expenses.payment_status/
-- account_id (set by migration 014, back before the 098 payment-lifecycle
-- trigger existed, so it stuck). But what actually got applied to
-- production was the full unfiltered 736-row set — all 167 excluded
-- debits are present as `transfers` rows too, which v_account_balances
-- (130) sums via transfers_out on top of the exact same money already
-- being subtracted via expenses_out. Confirmed live: querying
-- v_account_balances for CBE showed a balance around -14.56M ETB, and
-- -14,560,290.65 + 15,430,681.76 (the total of these 167 duplicate rows)
-- lands almost exactly on 870,391.11 — a plausible real operating
-- balance, not a permanently overdrawn account.
--
-- This deletes exactly those 167 rows (identified by transfer_id_code,
-- the same deterministic CBE-DR-2025-NNN-YYYY-MM-DD sequence numbering
-- migration 129 and the original backfill script both use) and nothing
-- else. Idempotent: if these rows are already gone, this deletes 0 and
-- is a safe no-op. Verified against a local replay that reproduces this
-- exact double-count (all 736 rows + the 167 matching expenses tagged
-- before the lifecycle trigger existed) and confirms the balance
-- corrects to the same single-counted figure the properly-deduped
-- migration 129 produces on a clean run (9,450,554.44 in the sandbox's
-- expenses-light dataset; the real production figure will differ since
-- it has real sales/expenses/payroll/VRF activity this sandbox doesn't).
-- ============================================================

SET search_path TO public;

DELETE FROM transfers
WHERE transfer_id_code IN (
  'CBE-DR-2025-445-2025-10-07',
  'CBE-DR-2025-446-2025-10-07',
  'CBE-DR-2025-447-2025-10-07',
  'CBE-DR-2025-448-2025-10-08',
  'CBE-DR-2025-449-2025-10-08',
  'CBE-DR-2025-450-2025-10-08',
  'CBE-DR-2025-451-2025-10-08',
  'CBE-DR-2025-452-2025-10-08',
  'CBE-DR-2025-453-2025-10-08',
  'CBE-DR-2025-454-2025-10-09',
  'CBE-DR-2025-455-2025-10-09',
  'CBE-DR-2025-456-2025-10-09',
  'CBE-DR-2025-457-2025-10-09',
  'CBE-DR-2025-458-2025-10-09',
  'CBE-DR-2025-467-2025-10-10',
  'CBE-DR-2025-471-2025-10-13',
  'CBE-DR-2025-472-2025-10-13',
  'CBE-DR-2025-473-2025-10-13',
  'CBE-DR-2025-474-2025-10-13',
  'CBE-DR-2025-475-2025-10-13',
  'CBE-DR-2025-476-2025-10-14',
  'CBE-DR-2025-477-2025-10-14',
  'CBE-DR-2025-478-2025-10-14',
  'CBE-DR-2025-479-2025-10-15',
  'CBE-DR-2025-480-2025-10-15',
  'CBE-DR-2025-481-2025-10-15',
  'CBE-DR-2025-482-2025-10-16',
  'CBE-DR-2025-483-2025-10-16',
  'CBE-DR-2025-484-2025-10-16',
  'CBE-DR-2025-485-2025-10-16',
  'CBE-DR-2025-486-2025-10-16',
  'CBE-DR-2025-487-2025-10-16',
  'CBE-DR-2025-488-2025-10-17',
  'CBE-DR-2025-489-2025-10-18',
  'CBE-DR-2025-490-2025-10-18',
  'CBE-DR-2025-491-2025-10-20',
  'CBE-DR-2025-492-2025-10-20',
  'CBE-DR-2025-493-2025-10-20',
  'CBE-DR-2025-494-2025-10-20',
  'CBE-DR-2025-495-2025-10-20',
  'CBE-DR-2025-496-2025-10-20',
  'CBE-DR-2025-497-2025-10-20',
  'CBE-DR-2025-498-2025-10-21',
  'CBE-DR-2025-499-2025-10-21',
  'CBE-DR-2025-500-2025-10-21',
  'CBE-DR-2025-501-2025-10-21',
  'CBE-DR-2025-502-2025-10-21',
  'CBE-DR-2025-503-2025-10-22',
  'CBE-DR-2025-504-2025-10-22',
  'CBE-DR-2025-505-2025-10-22',
  'CBE-DR-2025-506-2025-10-22',
  'CBE-DR-2025-507-2025-10-22',
  'CBE-DR-2025-508-2025-10-22',
  'CBE-DR-2025-510-2025-10-22',
  'CBE-DR-2025-511-2025-10-22',
  'CBE-DR-2025-512-2025-10-22',
  'CBE-DR-2025-513-2025-10-23',
  'CBE-DR-2025-514-2025-10-23',
  'CBE-DR-2025-515-2025-10-23',
  'CBE-DR-2025-516-2025-10-24',
  'CBE-DR-2025-517-2025-10-24',
  'CBE-DR-2025-518-2025-10-24',
  'CBE-DR-2025-519-2025-10-24',
  'CBE-DR-2025-520-2025-10-25',
  'CBE-DR-2025-521-2025-10-25',
  'CBE-DR-2025-522-2025-10-27',
  'CBE-DR-2025-523-2025-10-27',
  'CBE-DR-2025-524-2025-10-27',
  'CBE-DR-2025-525-2025-10-27',
  'CBE-DR-2025-526-2025-10-28',
  'CBE-DR-2025-527-2025-10-28',
  'CBE-DR-2025-528-2025-10-28',
  'CBE-DR-2025-529-2025-10-28',
  'CBE-DR-2025-530-2025-10-28',
  'CBE-DR-2025-531-2025-10-29',
  'CBE-DR-2025-532-2025-10-29',
  'CBE-DR-2025-534-2025-10-29',
  'CBE-DR-2025-535-2025-10-29',
  'CBE-DR-2025-536-2025-10-29',
  'CBE-DR-2025-537-2025-10-30',
  'CBE-DR-2025-538-2025-10-30',
  'CBE-DR-2025-542-2025-11-01',
  'CBE-DR-2025-543-2025-11-01',
  'CBE-DR-2025-544-2025-11-01',
  'CBE-DR-2025-546-2025-11-01',
  'CBE-DR-2025-547-2025-11-01',
  'CBE-DR-2025-548-2025-11-01',
  'CBE-DR-2025-549-2025-11-01',
  'CBE-DR-2025-550-2025-11-01',
  'CBE-DR-2025-551-2025-11-03',
  'CBE-DR-2025-553-2025-11-04',
  'CBE-DR-2025-554-2025-11-04',
  'CBE-DR-2025-555-2025-11-04',
  'CBE-DR-2025-556-2025-11-05',
  'CBE-DR-2025-557-2025-11-06',
  'CBE-DR-2025-558-2025-11-06',
  'CBE-DR-2025-559-2025-11-06',
  'CBE-DR-2025-560-2025-11-07',
  'CBE-DR-2025-561-2025-11-07',
  'CBE-DR-2025-562-2025-11-07',
  'CBE-DR-2025-563-2025-11-08',
  'CBE-DR-2025-564-2025-11-08',
  'CBE-DR-2025-565-2025-11-08',
  'CBE-DR-2025-579-2025-11-12',
  'CBE-DR-2025-581-2025-11-12',
  'CBE-DR-2025-582-2025-11-12',
  'CBE-DR-2025-584-2025-11-13',
  'CBE-DR-2025-585-2025-11-13',
  'CBE-DR-2025-586-2025-11-13',
  'CBE-DR-2025-587-2025-11-13',
  'CBE-DR-2025-588-2025-11-13',
  'CBE-DR-2025-590-2025-11-13',
  'CBE-DR-2025-591-2025-11-14',
  'CBE-DR-2025-593-2025-11-14',
  'CBE-DR-2025-594-2025-11-14',
  'CBE-DR-2025-595-2025-11-14',
  'CBE-DR-2025-596-2025-11-14',
  'CBE-DR-2025-597-2025-11-14',
  'CBE-DR-2025-598-2025-11-14',
  'CBE-DR-2025-599-2025-11-15',
  'CBE-DR-2025-601-2025-11-15',
  'CBE-DR-2025-602-2025-11-15',
  'CBE-DR-2025-603-2025-11-15',
  'CBE-DR-2025-604-2025-11-15',
  'CBE-DR-2025-605-2025-11-15',
  'CBE-DR-2025-606-2025-11-17',
  'CBE-DR-2025-607-2025-11-18',
  'CBE-DR-2025-608-2025-11-18',
  'CBE-DR-2025-609-2025-11-18',
  'CBE-DR-2025-610-2025-11-18',
  'CBE-DR-2025-614-2025-11-19',
  'CBE-DR-2025-615-2025-11-19',
  'CBE-DR-2025-616-2025-11-19',
  'CBE-DR-2025-617-2025-11-20',
  'CBE-DR-2025-618-2025-11-20',
  'CBE-DR-2025-619-2025-11-20',
  'CBE-DR-2025-620-2025-11-20',
  'CBE-DR-2025-621-2025-11-20',
  'CBE-DR-2025-622-2025-11-20',
  'CBE-DR-2025-623-2025-11-20',
  'CBE-DR-2025-624-2025-11-21',
  'CBE-DR-2025-625-2025-11-21',
  'CBE-DR-2025-626-2025-11-21',
  'CBE-DR-2025-627-2025-11-22',
  'CBE-DR-2025-628-2025-11-22',
  'CBE-DR-2025-629-2025-11-24',
  'CBE-DR-2025-630-2025-11-24',
  'CBE-DR-2025-632-2025-11-24',
  'CBE-DR-2025-633-2025-11-24',
  'CBE-DR-2025-634-2025-11-24',
  'CBE-DR-2025-635-2025-11-24',
  'CBE-DR-2025-636-2025-11-24',
  'CBE-DR-2025-637-2025-11-25',
  'CBE-DR-2025-638-2025-11-25',
  'CBE-DR-2025-639-2025-11-25',
  'CBE-DR-2025-640-2025-11-25',
  'CBE-DR-2025-641-2025-11-26',
  'CBE-DR-2025-642-2025-11-26',
  'CBE-DR-2025-643-2025-11-26',
  'CBE-DR-2025-644-2025-11-27',
  'CBE-DR-2025-645-2025-11-27',
  'CBE-DR-2025-646-2025-11-27',
  'CBE-DR-2025-647-2025-11-27',
  'CBE-DR-2025-650-2025-11-28',
  'CBE-DR-2025-651-2025-11-29',
  'CBE-DR-2025-652-2025-11-29',
  'CBE-DR-2025-653-2025-11-29'
);

-- Verify: should now be exactly 569 (83 credits + 486 debits), and the
-- CBE balance should have moved up by roughly 15.4M ETB from wherever
-- it was before this ran.
SELECT count(*) AS cbe_2025h2_rows_after_dedup FROM transfers WHERE transfer_id_code LIKE 'CBE-%R-2025-%';
SELECT id, opening_balance, opening_balance_as_of, balance FROM v_account_balances WHERE id = '890c3473-dc57-4c01-9f39-17518047c463';
