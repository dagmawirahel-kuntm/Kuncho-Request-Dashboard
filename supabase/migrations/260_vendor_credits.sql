-- 260 — Vendor Credits: a real record for post-order vendor discounts
--
-- Follows the PO-2026-0082 wire-pricing discount, which was handled by
-- hand: reduce the open advance's amount_etb and leave a note explaining
-- why. That worked (the advance later closed correctly at the discounted
-- total, leaving the difference behind in Vendor Advances), but the credit
-- itself only existed as free text — nothing tracked that a balance was
-- owed, or made it findable when a future order with that vendor came up.
--
-- Scope (v1, deliberately narrow): a vendor credit can only be created
-- against a still-open advance (payment_state = 'advance') and can only be
-- applied to another still-open advance for the same vendor. This needs no
-- new ledger posting in either direction — the money is already sitting in
-- the Vendor Advances account either way; a credit just changes how much
-- of it an advance closes for, and applying a credit does the same to a
-- different advance. Closed/fully-paid POs are out of scope for now (that
-- would require a real new journal entry to bring a vendor claim onto the
-- books) — extend then if it's needed.
--
-- Mutations only via the two SECURITY DEFINER RPCs below (create_vendor_credit
-- / apply_vendor_credit); the tables themselves are read-only via RLS, same
-- pattern as close_vendor_advance() and friends.

CREATE TABLE public.vendor_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  amount_etb numeric NOT NULL CHECK (amount_etb > 0),
  source_expense_id uuid NOT NULL REFERENCES expenses(id),
  source_sourcing_bundle_id uuid REFERENCES sourcing_bundles(id),
  reason text NOT NULL CHECK (trim(reason) <> ''),
  notes text,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vendor_credit_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_credit_id uuid NOT NULL REFERENCES vendor_credits(id),
  applied_to_expense_id uuid NOT NULL REFERENCES expenses(id),
  amount_etb numeric NOT NULL CHECK (amount_etb > 0),
  applied_by uuid REFERENCES user_profiles(id),
  applied_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX idx_vendor_credits_vendor ON vendor_credits(vendor_id);
CREATE INDEX idx_vendor_credit_applications_credit ON vendor_credit_applications(vendor_credit_id);
CREATE INDEX idx_vendor_credit_applications_target ON vendor_credit_applications(applied_to_expense_id);

ALTER TABLE public.vendor_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_credit_applications ENABLE ROW LEVEL SECURITY;

-- Read-only via RLS; every mutation goes through the SECURITY DEFINER RPCs
-- below (create_vendor_credit / apply_vendor_credit), which re-check the
-- role and enforce the business rules server-side.
CREATE POLICY vendor_credits_select ON vendor_credits FOR SELECT
  USING (get_user_role() IN ('admin', 'executive', 'finance'));
CREATE POLICY vendor_credit_applications_select ON vendor_credit_applications FOR SELECT
  USING (get_user_role() IN ('admin', 'executive', 'finance'));

COMMENT ON TABLE public.vendor_credits IS
  'A credit owed back by a vendor (e.g. a post-order discount), created against a still-open advance (payment_state=advance) so no new ledger posting is needed — the amount is simply subtracted from that advance before it closes, leaving the difference as an unclaimed balance in the Vendor Advances account. Tracked here so it can be found and applied to a future order with the same vendor instead of being lost in a note.';
COMMENT ON TABLE public.vendor_credit_applications IS
  'Each time an open vendor_credits balance is applied against a future order — reduces that order''s open advance by the applied amount, same mechanism as the original discount.';

CREATE VIEW public.v_vendor_credits
WITH (security_invoker = true) AS
SELECT
  vc.id, vc.vendor_id, v.vendor_name,
  vc.amount_etb,
  vc.source_expense_id, e.expense_code AS source_expense_code,
  vc.source_sourcing_bundle_id, sb.bundle_code AS source_bundle_code,
  vc.reason, vc.notes, vc.created_by, vc.created_at,
  COALESCE(app.applied_total, 0) AS applied_total,
  vc.amount_etb - COALESCE(app.applied_total, 0) AS remaining_amount_etb,
  CASE
    WHEN vc.amount_etb - COALESCE(app.applied_total, 0) <= 0.01 THEN 'closed'
    WHEN COALESCE(app.applied_total, 0) > 0 THEN 'partially_applied'
    ELSE 'open'
  END AS status
FROM vendor_credits vc
JOIN vendors v ON v.id = vc.vendor_id
LEFT JOIN expenses e ON e.id = vc.source_expense_id
LEFT JOIN sourcing_bundles sb ON sb.id = vc.source_sourcing_bundle_id
LEFT JOIN (
  SELECT vendor_credit_id, SUM(amount_etb) AS applied_total
  FROM vendor_credit_applications
  GROUP BY vendor_credit_id
) app ON app.vendor_credit_id = vc.id;

COMMENT ON VIEW public.v_vendor_credits IS
  'Vendor credits with computed remaining balance and status (open / partially_applied / closed), for the Vendor Credits page.';

CREATE OR REPLACE FUNCTION public.create_vendor_credit(
  p_source_expense_id uuid, p_amount_etb numeric, p_reason text, p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expense RECORD;
  v_credit_id uuid;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'finance') THEN
    RAISE EXCEPTION 'Only admin, executive, or finance can record a vendor credit';
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_source_expense_id;
  IF v_expense.id IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF v_expense.payment_state <> 'advance' THEN
    RAISE EXCEPTION 'Vendor credits can only be recorded against an open advance (payment_state = advance) — this expense is %', v_expense.payment_state;
  END IF;
  IF v_expense.vendor_id IS NULL THEN
    RAISE EXCEPTION 'This expense has no vendor linked — cannot record a vendor credit against it';
  END IF;
  IF p_amount_etb IS NULL OR p_amount_etb <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be positive';
  END IF;
  IF p_amount_etb >= v_expense.amount_etb THEN
    RAISE EXCEPTION 'Credit (%) must be less than the advance''s current amount (%) — it would zero it out or go negative', p_amount_etb, v_expense.amount_etb;
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  -- Nothing to post to the ledger: the full advance is already sitting in
  -- Vendor Advances. Simply reducing what it'll close for leaves the
  -- credited amount behind as an unclaimed balance in that same account —
  -- exactly the reserve this credit represents.
  UPDATE expenses SET amount_etb = amount_etb - p_amount_etb WHERE id = p_source_expense_id;

  INSERT INTO vendor_credits (vendor_id, amount_etb, source_expense_id, source_sourcing_bundle_id, reason, notes, created_by)
  VALUES (v_expense.vendor_id, p_amount_etb, p_source_expense_id, v_expense.sourcing_bundle_id, p_reason, p_notes, auth.uid())
  RETURNING id INTO v_credit_id;

  RETURN v_credit_id;
END;
$function$;

COMMENT ON FUNCTION public.create_vendor_credit IS
  'Records a vendor credit against a still-open advance, reducing that advance''s amount by the credit — no ledger posting needed since the money is already in Vendor Advances. admin/executive/finance only.';

CREATE OR REPLACE FUNCTION public.apply_vendor_credit(
  p_vendor_credit_id uuid, p_target_expense_id uuid, p_amount_etb numeric, p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_credit RECORD;
  v_target RECORD;
  v_applied_so_far numeric;
  v_remaining numeric;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'finance') THEN
    RAISE EXCEPTION 'Only admin, executive, or finance can apply a vendor credit';
  END IF;

  SELECT * INTO v_credit FROM vendor_credits WHERE id = p_vendor_credit_id;
  IF v_credit.id IS NULL THEN
    RAISE EXCEPTION 'Vendor credit not found';
  END IF;

  SELECT COALESCE(SUM(amount_etb), 0) INTO v_applied_so_far FROM vendor_credit_applications WHERE vendor_credit_id = p_vendor_credit_id;
  v_remaining := v_credit.amount_etb - v_applied_so_far;

  IF p_amount_etb IS NULL OR p_amount_etb <= 0 THEN
    RAISE EXCEPTION 'Amount to apply must be positive';
  END IF;
  IF p_amount_etb > v_remaining THEN
    RAISE EXCEPTION 'Only % ETB remains on this credit (requested %)', v_remaining, p_amount_etb;
  END IF;

  SELECT * INTO v_target FROM expenses WHERE id = p_target_expense_id;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'Target expense not found';
  END IF;
  IF v_target.vendor_id IS DISTINCT FROM v_credit.vendor_id THEN
    RAISE EXCEPTION 'This credit belongs to a different vendor than the target expense';
  END IF;
  IF v_target.payment_state <> 'advance' THEN
    RAISE EXCEPTION 'A vendor credit can only be applied to an open advance (payment_state = advance) — the target expense is %', v_target.payment_state;
  END IF;
  IF p_amount_etb >= v_target.amount_etb THEN
    RAISE EXCEPTION 'Cannot apply % — it would zero out or exceed the target advance''s current amount (%)', p_amount_etb, v_target.amount_etb;
  END IF;

  UPDATE expenses SET amount_etb = amount_etb - p_amount_etb WHERE id = p_target_expense_id;

  INSERT INTO vendor_credit_applications (vendor_credit_id, applied_to_expense_id, amount_etb, applied_by, notes)
  VALUES (p_vendor_credit_id, p_target_expense_id, p_amount_etb, auth.uid(), p_notes);
END;
$function$;

COMMENT ON FUNCTION public.apply_vendor_credit IS
  'Applies (all or part of) an open vendor credit to a different open advance for the same vendor, reducing that advance by the applied amount. admin/executive/finance only.';

-- One-time backfill: the PO-2026-0082 discount was applied by hand before
-- this feature existed (amount_etb was already reduced directly, and the
-- advance has since closed at the discounted total) — this just gives that
-- credit a proper record instead of leaving it as a note. Guarded so a
-- re-run of this migration doesn't insert it twice.
INSERT INTO vendor_credits (vendor_id, amount_etb, source_expense_id, source_sourcing_bundle_id, reason, notes, created_by)
SELECT '4a8e95e1-a102-4f37-8ac7-1b4648e72c7d', 63391.32, '33365a21-5e65-4159-b160-c0d910595681',
       '9b4b5f90-19fb-4230-abf1-a8dcba43242f',
       'Vendor discount on wire pricing agreed post-order',
       'Backfilled: recorded manually before the Vendor Credits feature existed. Wire 1.5 (15 rolls) 9,565.22 -> 7,826.09/roll; Wire 2.5 (9 rolls) 14,782.61 -> 12,608.70/roll; Wire 4 (6 rolls) 21,739.13 -> 18,782.60/roll. Advance already closed at the discounted total (488,478.14); this 63,391.32 balance is what remains unclaimed in Vendor Advances for this vendor.',
       NULL
WHERE NOT EXISTS (
  SELECT 1 FROM vendor_credits WHERE source_expense_id = '33365a21-5e65-4159-b160-c0d910595681'
);
