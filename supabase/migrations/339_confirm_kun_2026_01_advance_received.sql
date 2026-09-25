-- 339 — Record KUN-2026-01's advance as received
--
-- The 30% advance on KUN-2026-01 (6,813,267.13 gross) was paid on 10 Aug
-- 2026: invoice INV-2026-002, bank transfer FT262228VTL2 into CBE for
-- 6,813,267.12, matched on the sale. The payment milestone still read
-- 'pending' because, until 338, an advance had no route to
-- payment_confirmed — so the project showed 6.8M outstanding that had
-- already arrived, and milestone 2's work orders stayed gated behind it.
--
-- Recorded at what the bank received. The plan expected a net of
-- 6,635,529.73 (gross less 177,737.40 WHT); the client paid the gross and
-- withheld nothing, so the note says so — confirm_milestone_payment
-- requires one for any difference over 1 birr.
--
-- Applied through confirm_milestone_payment(), acting as an admin; replaying
-- it needs an admin or finance identity.

DO $$
DECLARE v_id uuid;
BEGIN
  SELECT pm.id INTO v_id
  FROM payment_milestones pm JOIN contracts c ON c.id = pm.contract_id
  WHERE c.contract_no = 'KUN-2026-01' AND pm.sequence_number = 1 AND pm.status = 'pending';

  IF v_id IS NOT NULL THEN
    PERFORM confirm_milestone_payment(v_id, 6813267.12, '2026-08-10',
      'Received in full by bank transfer FT262228VTL2 on 10 Aug 2026 (invoice INV-2026-002). The client paid the gross advance and withheld no tax, so the amount is the gross, not the planned net of 6,635,529.73.');
  END IF;
END $$;
