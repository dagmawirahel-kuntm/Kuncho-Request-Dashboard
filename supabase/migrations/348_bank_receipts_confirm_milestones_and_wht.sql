-- 348 — A client's bank credit settles the invoice, the milestone and the WHT
--
-- Matching a credit to a sale marked the sale paid and nothing else:
--   * the milestone the invoice was raised for (through its payment request)
--     still had to be confirmed by hand, with the amount retyped;
--   * when the client paid less than the invoice — withholding — nothing
--     recorded what was kept back, so the WHT tracker could only guess from
--     the contract whether a certificate was owed.
--
-- Now match_sale_to_transfer():
--   1. records what the bank received (sales.amount_received) and what the
--      client kept back (sales.withheld_by_client, when more than 1 birr);
--   2. confirms the payment milestone the sale's payment request was for, at
--      the amount received, with a note giving the bank reference and any
--      withholding. A milestone that isn't ready to confirm is left alone.
-- The client page counts a sale with money withheld as owing a WHT
-- certificate for that amount.

SET search_path TO public;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_received numeric;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS withheld_by_client numeric;

CREATE OR REPLACE FUNCTION match_sale_to_transfer(p_sale_id uuid, p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_to_account_id uuid; v_transfer_date date; v_received numeric; v_ref text;
  v_sale sales%ROWTYPE; v_withheld numeric; v_ms uuid; v_note text;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match a sale to a bank line';
  END IF;
  SELECT to_account_id, date, amount, transfer_id_code INTO v_to_account_id, v_transfer_date, v_received, v_ref
    FROM transfers WHERE id = p_transfer_id;
  IF v_to_account_id IS NULL AND v_transfer_date IS NULL THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  v_withheld := CASE WHEN v_sale.amount - v_received > 1 THEN round(v_sale.amount - v_received, 2) ELSE 0 END;

  UPDATE sales
     SET sales_status  = 'Paid',
         transfer_id   = p_transfer_id,
         account_id    = COALESCE(account_id, v_to_account_id),
         payment_date  = COALESCE(payment_date, v_transfer_date),
         amount_received = v_received,
         withheld_by_client = v_withheld
   WHERE id = p_sale_id;

  -- The milestone this invoice was requested for is now received.
  SELECT r.milestone_id INTO v_ms FROM client_payment_requests r
    WHERE r.sale_id = p_sale_id AND r.milestone_id IS NOT NULL LIMIT 1;
  IF v_ms IS NOT NULL THEN
    v_note := 'Received by bank transfer' || COALESCE(' ' || v_ref, '') || ' on ' || to_char(v_transfer_date, 'DD Mon YYYY')
      || CASE WHEN v_withheld > 0 THEN '; the client withheld ' || to_char(v_withheld, 'FM999,999,999,990.00') ELSE '' END || '.';
    BEGIN
      PERFORM confirm_milestone_payment(v_ms, v_received, v_transfer_date, v_note);
    EXCEPTION WHEN OTHERS THEN NULL;  -- not ready to confirm (already confirmed, or not requested yet)
    END;
  END IF;
END $$;
REVOKE ALL ON FUNCTION match_sale_to_transfer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION match_sale_to_transfer(uuid, uuid) TO authenticated;

-- Sales already matched: what their bank line brought in.
UPDATE sales s SET amount_received = t.amount,
  withheld_by_client = CASE WHEN s.amount - t.amount > 1 THEN round(s.amount - t.amount, 2) ELSE 0 END
FROM transfers t
WHERE t.id = s.transfer_id AND s.amount_received IS NULL;
