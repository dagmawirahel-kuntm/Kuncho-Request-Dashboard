-- Finance approves a purchase before the cashier pays it, and the vendor's
-- account travels on the PO.
--
-- Until now a purchaser walked an approved PO to a cashier, who paid it, and
-- finance approved the bill days later — so money left before anyone in
-- finance had approved it, and the payment was only recorded once a payment
-- request went round afterwards. Purchases stayed open for weeks.
--
-- From here:
--  * Pay to. When a PO is approved, the vendor's bank and account are copied
--    onto it from the vendor record (never typed on the PO). That is the
--    account finance approved.
--  * Finance clears the payment. A PO approved by finance or an admin, with
--    the general ledger picked as they approve it, clears its bill for
--    payment when the bill is made. A PO approved by procurement
--    or operations within their limit still needs finance to approve the
--    payment (po_approve_payment) before anyone can pay it.
--  * Pay from the PO. The cashier records the payment on the PO (po_pay): the
--    bill must be cleared, the cashier must not be the person who cleared it,
--    and a bank payment must go to the account on the PO.
--  * Account guard. A bank payment on a PO bill, by any route (the PO, To pay,
--    a batch), is refused if the vendor's account no longer matches the PO.
--    Finance checks the new account and approves it on the PO
--    (po_approve_pay_to) before it can be paid.

ALTER TABLE sourcing_bundles
  ADD COLUMN IF NOT EXISTS pay_to_bank_id uuid REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS pay_to_account text,
  ADD COLUMN IF NOT EXISTS pay_to_name text,
  ADD COLUMN IF NOT EXISTS pay_to_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS pay_to_set_by uuid,
  ADD COLUMN IF NOT EXISTS ledger_category_id uuid REFERENCES categories(id);

COMMENT ON COLUMN sourcing_bundles.ledger_category_id IS
  'The general ledger finance picked when approving the PO; its bill takes it so the payment is cleared at once (538).';

COMMENT ON COLUMN sourcing_bundles.pay_to_account IS
  'The vendor account finance approved for this PO, copied from the vendor record at approval (538).';

-- 1. Pay to: copied from the vendor when the PO is approved.
CREATE OR REPLACE FUNCTION public.trg_po_pay_to_on_approve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status::text = 'approved' AND OLD.status::text = 'submitted' AND NEW.vendor_id IS NOT NULL THEN
    SELECT v.bank_id, v.bank_account, v.vendor_name, now(), auth.uid()
      INTO NEW.pay_to_bank_id, NEW.pay_to_account, NEW.pay_to_name, NEW.pay_to_set_at, NEW.pay_to_set_by
      FROM vendors v WHERE v.id = NEW.vendor_id;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE TRIGGER trg_a_po_pay_to_on_approve BEFORE UPDATE OF status ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION trg_po_pay_to_on_approve();

-- POs approved and not yet paid take their vendor's account now.
UPDATE sourcing_bundles b
   SET pay_to_bank_id = v.bank_id, pay_to_account = v.bank_account, pay_to_name = v.vendor_name, pay_to_set_at = now()
  FROM vendors v
 WHERE v.id = b.vendor_id AND b.pay_to_set_at IS NULL
   AND b.status::text IN ('approved', 'ordered', 'fulfilled')
   AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = b.expense_id AND e.payment_state IN ('sent', 'paid', 'advance', 'void'));

-- 2. Finance clears the bill: a PO approved by finance or an admin approves
--    its bill when the bill is made, in the PO approver's name. The approval
--    trigger lets this one through (the person making the bill is usually
--    procurement); every other approval still needs finance.
DO $mig$
DECLARE
  v_old text := pg_get_functiondef('public.enforce_expense_approval_transitions()'::regprocedure);
  v_new text := replace(v_old,
    E'  v_role := get_user_role();\n',
    E'  v_role := get_user_role();\n\n'
    || E'  -- A PO finance approved clears its bill (538): already stamped with the PO approver.\n'
    || E'  IF COALESCE(current_setting(''kuncho.po_clearance'', true), '''') = ''on''\n'
    || E'     AND OLD.approval_status = ''pending'' AND NEW.approval_status = ''finance_approved''\n'
    || E'     AND NEW.finance_approved_by IS NOT NULL THEN\n'
    || E'    RETURN NEW;\n'
    || E'  END IF;\n');
BEGIN
  IF v_new = v_old THEN RAISE EXCEPTION 'enforce_expense_approval_transitions: anchor not found'; END IF;
  EXECUTE v_new;
END $mig$;

CREATE OR REPLACE FUNCTION public.trg_po_bill_cleared()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b sourcing_bundles%ROWTYPE;
BEGIN
  IF NEW.sourcing_bundle_id IS NULL OR NEW.approval_status::text <> 'pending' THEN RETURN NULL; END IF;
  SELECT * INTO b FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
  IF b.approved_by IS NULL
     OR (SELECT role::text FROM user_profiles WHERE id = b.approved_by) NOT IN ('finance', 'admin') THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM set_config('kuncho.po_clearance', 'on', true);
    UPDATE expenses SET category_id = COALESCE(category_id, b.ledger_category_id),
           approval_status = 'finance_approved', finance_approved_by = b.approved_by,
           finance_approved_at = COALESCE(b.approved_at, now())
     WHERE id = NEW.id AND approval_status::text = 'pending';
    PERFORM set_config('kuncho.po_clearance', 'off', true);
  EXCEPTION WHEN OTHERS THEN
    -- Missing a project or ledger: the bill waits for finance like any other.
    PERFORM set_config('kuncho.po_clearance', 'off', true);
    RAISE NOTICE 'PO % bill left for finance: %', b.bundle_code, SQLERRM;
  END;
  RETURN NULL;
END $function$;

CREATE OR REPLACE TRIGGER trg_zz_po_bill_cleared AFTER INSERT ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_po_bill_cleared();

-- 3. Account guard: a bank payment on a PO bill goes to the account on the PO.
CREATE OR REPLACE FUNCTION public.trg_po_bill_pays_approved_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b sourcing_bundles%ROWTYPE; v vendors%ROWTYPE;
BEGIN
  IF NEW.sourcing_bundle_id IS NULL
     OR NEW.payment_state NOT IN ('sent', 'paid', 'advance')
     OR OLD.payment_state IN ('sent', 'paid', 'advance')
     OR COALESCE(NEW.payment_method, '') NOT IN ('transfer', 'batch_wire', 'cpo', 'cheque') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO b FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
  IF b.pay_to_set_at IS NULL OR b.vendor_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v FROM vendors WHERE id = b.vendor_id;
  IF b.pay_to_account IS NULL THEN
    RAISE EXCEPTION '% has no vendor account approved on it — add the account to %, then finance approves it on the PO',
      b.bundle_code, v.vendor_name;
  END IF;
  IF COALESCE(v.bank_account, '') <> b.pay_to_account OR v.bank_id IS DISTINCT FROM b.pay_to_bank_id THEN
    RAISE EXCEPTION '%''s account changed after % was approved (approved: %, now: %). Finance checks the new account and approves it on the PO before it is paid',
      v.vendor_name, b.bundle_code, b.pay_to_account, COALESCE(v.bank_account, 'none');
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE TRIGGER trg_po_bill_pays_approved_account BEFORE UPDATE OF payment_state ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_po_bill_pays_approved_account();

-- 4. What the PO page shows: the account approved, the vendor's account now,
--    how far to trust it, and where the payment stands.
CREATE OR REPLACE FUNCTION public.po_payment_status(p_bundle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b sourcing_bundles%ROWTYPE; v vendors%ROWTYPE; e expenses%ROWTYPE;
  v_changed timestamptz; v_role text := COALESCE(get_user_role()::text, '');
BEGIN
  IF v_role NOT IN ('admin', 'finance', 'procurement_officer', 'operations_manager', 'executive') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  SELECT * INTO b FROM sourcing_bundles WHERE id = p_bundle;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  SELECT * INTO v FROM vendors WHERE id = b.vendor_id;
  SELECT * INTO e FROM expenses WHERE id = b.expense_id;
  SELECT max(changed_at) INTO v_changed FROM vendor_detail_changes
   WHERE vendor_id = b.vendor_id AND field IN ('bank_account', 'bank');

  RETURN jsonb_build_object(
    'pay_to', CASE WHEN b.pay_to_set_at IS NOT NULL THEN jsonb_build_object(
        'bank', (SELECT account_name FROM accounts WHERE id = b.pay_to_bank_id),
        'account', b.pay_to_account, 'name', b.pay_to_name, 'set_at', b.pay_to_set_at,
        'set_by', (SELECT full_name FROM user_profiles WHERE id = b.pay_to_set_by)) END,
    'vendor', CASE WHEN v.id IS NOT NULL THEN jsonb_build_object(
        'id', v.id, 'name', v.vendor_name, 'bank', (SELECT account_name FROM accounts WHERE id = v.bank_id),
        'account', v.bank_account, 'phone', v.phone_contact,
        'verified', v.verification_status = 'verified', 'account_changed_at', v_changed) END,
    'matches', b.pay_to_set_at IS NOT NULL AND v.id IS NOT NULL
               AND COALESCE(v.bank_account, '') = COALESCE(b.pay_to_account, '') AND v.bank_id IS NOT DISTINCT FROM b.pay_to_bank_id,
    'needs_call', v.id IS NOT NULL AND (v.verification_status <> 'verified' OR COALESCE(v_changed > now() - interval '30 days', false)),
    'bill', CASE WHEN e.id IS NOT NULL THEN jsonb_build_object(
        'id', e.id, 'code', e.expense_code, 'amount', e.amount_etb, 'wht', COALESCE(e.wht_amount, 0),
        'to_vendor', e.amount_etb - COALESCE(e.wht_amount, 0),
        'approval', e.approval_status, 'state', e.payment_state, 'in_parts', COALESCE(e.in_parts, false),
        'category_id', e.category_id, 'category', (SELECT category_name FROM categories WHERE id = e.category_id),
        'approved_by', (SELECT full_name FROM user_profiles WHERE id = e.finance_approved_by),
        'approved_by_id', e.finance_approved_by, 'approved_at', e.finance_approved_at,
        'paid_by', (SELECT full_name FROM user_profiles WHERE id = e.disbursed_by),
        'paid_date', e.paid_date, 'method', e.payment_method, 'bank_ref', e.bank_ref) END,
    'po_approved_by_finance', (SELECT role::text FROM user_profiles WHERE id = b.approved_by) IN ('finance', 'admin'));
END $function$;

-- 5. Finance approves the payment from the PO (a PO procurement or
--    operations approved within their limit).
CREATE OR REPLACE FUNCTION public.po_approve_payment(p_bundle uuid, p_category uuid DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b sourcing_bundles%ROWTYPE; e expenses%ROWTYPE;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('finance', 'admin') THEN RAISE EXCEPTION 'Finance approves payments'; END IF;
  SELECT * INTO b FROM sourcing_bundles WHERE id = p_bundle FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF b.expense_id IS NULL THEN
    RAISE EXCEPTION 'The bill for % is made when it is ordered (paid in advance) or received (paid on delivery)', b.bundle_code;
  END IF;
  SELECT * INTO e FROM expenses WHERE id = b.expense_id;
  IF e.approval_status::text = 'finance_approved' THEN RAISE EXCEPTION 'This payment is already approved'; END IF;
  IF b.pay_to_set_at IS NULL AND b.vendor_id IS NOT NULL THEN
    UPDATE sourcing_bundles SET (pay_to_bank_id, pay_to_account, pay_to_name, pay_to_set_at, pay_to_set_by) =
      (SELECT v.bank_id, v.bank_account, v.vendor_name, now(), auth.uid() FROM vendors v WHERE v.id = b.vendor_id)
     WHERE id = b.id;
  END IF;
  UPDATE expenses SET category_id = COALESCE(p_category, category_id, b.ledger_category_id),
         approval_status = 'finance_approved' WHERE id = e.id;
END $function$;

-- 6. Finance approves the vendor's new account on the PO.
CREATE OR REPLACE FUNCTION public.po_approve_pay_to(p_bundle uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b sourcing_bundles%ROWTYPE; v vendors%ROWTYPE;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('finance', 'admin') THEN RAISE EXCEPTION 'Finance approves the account a PO is paid to'; END IF;
  SELECT * INTO b FROM sourcing_bundles WHERE id = p_bundle FOR UPDATE;
  IF b.id IS NULL OR b.vendor_id IS NULL THEN RAISE EXCEPTION 'Purchase order or vendor not found'; END IF;
  SELECT * INTO v FROM vendors WHERE id = b.vendor_id;
  IF v.verification_status <> 'verified' THEN
    RAISE EXCEPTION '%''s details are waiting to be checked — verify the vendor first (Vendors → Review)', v.vendor_name;
  END IF;
  IF v.bank_account IS NULL OR v.bank_id IS NULL THEN RAISE EXCEPTION '% has no bank account on file', v.vendor_name; END IF;
  IF EXISTS (SELECT 1 FROM expenses e WHERE e.id = b.expense_id AND e.payment_state IN ('sent', 'paid', 'advance')) THEN
    RAISE EXCEPTION 'This PO is already paid';
  END IF;
  UPDATE sourcing_bundles SET pay_to_bank_id = v.bank_id, pay_to_account = v.bank_account, pay_to_name = v.vendor_name,
         pay_to_set_at = now(), pay_to_set_by = auth.uid()
   WHERE id = b.id;
END $function$;

-- 7. The cashier records the payment on the PO.
CREATE OR REPLACE FUNCTION public.po_pay(p_bundle uuid, p_method text, p_account_id uuid, p_bank_ref text DEFAULT NULL,
  p_paid_date date DEFAULT NULL, p_proof_url text DEFAULT NULL, p_proof_name text DEFAULT NULL, p_called boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b sourcing_bundles%ROWTYPE; e expenses%ROWTYPE; v vendors%ROWTYPE;
  v_bank boolean := p_method IN ('transfer', 'cpo', 'cheque');
  v_ref text := NULLIF(btrim(p_bank_ref), '');
  v_date date := COALESCE(p_paid_date, CURRENT_DATE);
  v_state text; v_me text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
  v_linked boolean := false;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('finance', 'admin') THEN RAISE EXCEPTION 'Finance records payments'; END IF;
  IF p_method NOT IN ('cash', 'transfer', 'cpo', 'cheque', 'other') THEN RAISE EXCEPTION 'Pick how it was paid'; END IF;
  IF p_account_id IS NULL THEN RAISE EXCEPTION 'Pick the account it was paid from'; END IF;
  IF v_date > CURRENT_DATE THEN RAISE EXCEPTION 'The payment date cannot be in the future'; END IF;
  SELECT * INTO b FROM sourcing_bundles WHERE id = p_bundle FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF b.status::text NOT IN ('ordered', 'fulfilled') THEN RAISE EXCEPTION 'Pay % once it is ordered', b.bundle_code; END IF;
  SELECT * INTO e FROM expenses WHERE id = b.expense_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION '% has no bill yet — a PO paid on delivery gets its bill when the goods are received', b.bundle_code; END IF;
  IF e.payment_state IN ('paid', 'advance') THEN RAISE EXCEPTION 'This PO is already paid'; END IF;
  IF e.approval_status::text <> 'finance_approved' OR e.payment_state <> 'approved_to_pay' THEN
    RAISE EXCEPTION 'Finance hasn''t approved this payment yet — it can''t be paid until they do';
  END IF;
  IF COALESCE(e.in_parts, false) THEN RAISE EXCEPTION 'This bill is paid in parts — pay each part from the bill (%)', e.expense_code; END IF;
  IF EXISTS (SELECT 1 FROM batch_payment_expenses x WHERE x.expense_id = e.id) THEN
    RAISE EXCEPTION 'This bill is in a batch payment — pay it with the batch';
  END IF;
  IF e.finance_approved_by = auth.uid() THEN
    RAISE EXCEPTION 'You approved this payment, so someone else in finance pays it';
  END IF;
  IF v_bank THEN
    v_ref := bank_ref_norm(v_ref);
    IF v_ref IS NULL THEN RAISE EXCEPTION 'Type the bank reference (the FT number on the slip)'; END IF;
    SELECT * INTO v FROM vendors WHERE id = b.vendor_id;
    IF v.id IS NOT NULL AND (v.verification_status <> 'verified'
        OR EXISTS (SELECT 1 FROM vendor_detail_changes c WHERE c.vendor_id = v.id AND c.field IN ('bank_account', 'bank')
                    AND c.changed_at > now() - interval '30 days'))
       AND NOT p_called THEN
      RAISE EXCEPTION '%''s account is new or not yet checked — call them on the number on file to confirm it, then tick that you did', v.vendor_name;
    END IF;
  END IF;

  v_state := CASE WHEN b.payment_pattern = 'pay_in_advance' THEN 'advance' ELSE 'paid' END;
  PERFORM set_config('kuncho.ref_autolink', 'off', true);
  UPDATE expenses SET
    payment_method = p_method, disbursed_by = auth.uid(), account_id = p_account_id,
    bank_ref = COALESCE(v_ref, bank_ref), paid_date = v_date::timestamptz, payment_state = v_state,
    payment_certificate_url = COALESCE(p_proof_url, payment_certificate_url),
    payment_certificate_name = COALESCE(p_proof_name, payment_certificate_name),
    payment_confirmed_by = auth.uid(), payment_confirmed_at = now(),
    notes = CASE WHEN v_bank AND p_called
                 THEN concat_ws(E'\n', notes, format('Account confirmed by phone by %s on %s.', COALESCE(v_me, 'the cashier'), to_char(now(), 'DD Mon YYYY')))
                 ELSE notes END
  WHERE id = e.id;
  PERFORM set_config('kuncho.ref_autolink', 'on', true);
  IF v_bank AND v_ref IS NOT NULL THEN v_linked := bank_try_link_reference(v_ref); END IF;
  RETURN jsonb_build_object('state', v_state, 'linked', v_linked, 'expense_code', e.expense_code);
END $function$;

GRANT EXECUTE ON FUNCTION public.po_payment_status(uuid), public.po_approve_payment(uuid, uuid), public.po_approve_pay_to(uuid),
  public.po_pay(uuid, text, uuid, text, date, text, text, boolean) TO authenticated;
