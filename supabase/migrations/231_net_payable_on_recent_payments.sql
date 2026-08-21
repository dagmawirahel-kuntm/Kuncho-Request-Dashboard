-- Surface the net-to-vendor figure everywhere a payment amount is shown,
-- not just on the To-Pay Queue. This Week's Payments (and the "Paid This
-- Week" KPI) were still reading the gross amount_etb, so the net amount —
-- what the vendor actually receives — never appeared once a payment left
-- the queue. Append net_payable + wht_amount to v_recent_payments.
-- Columns go at the end because CREATE OR REPLACE VIEW can only add
-- trailing columns.

SET search_path TO public;

CREATE OR REPLACE VIEW public.v_recent_payments AS
 SELECT e.id,
    e.expense_code,
    e.item_service_description,
    e.amount_etb,
    e.vendor_id,
    v.vendor_name,
    e.payment_state,
    e.payment_method,
    e.disbursed_by,
    e.payment_state_changed_at,
    e.transfer_id,
    t.transfer_id_code,
    t.notes AS transfer_notes,
    bpe.batch_payment_id,
    e.vrf_id,
    vrf.record_name AS vrf_record_name,
    e.net_payable,
    e.wht_amount
   FROM expenses e
     LEFT JOIN vendors v ON v.id = e.vendor_id
     LEFT JOIN transfers t ON t.id = e.transfer_id
     LEFT JOIN vendor_receipt_facilitation vrf ON vrf.id = e.vrf_id
     LEFT JOIN batch_payment_expenses bpe ON bpe.expense_id = e.id
  WHERE (e.payment_state = ANY (ARRAY['sent'::text, 'paid'::text]))
    AND e.payment_state_changed_at >= (now() - '7 days'::interval);
