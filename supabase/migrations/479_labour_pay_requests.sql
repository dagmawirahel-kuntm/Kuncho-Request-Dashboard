-- 479: The PM's labour payment request, and finance's labour queue.
--
-- A confirmed pay sheet (LPS, 375) became a pending expense and waited:
-- 23 of 39 were still untouched by finance, because an LPS alone isn't a
-- request to pay — no bank accounts, no proof of attendance, nobody
-- answering for it. Now the PM puts one or more confirmed pay sheets into a
-- payment request (one, or a batch across sites and weeks) and submits it
-- with what finance needs:
--   · every worker's line — days, gross, any cash advance to deduct, the net
--     to send, and the bank account HR verified;
--   · a photo of the signed attendance sheet;
--   · the PM's sign-off ("these people worked these days on these jobs").
-- Finance approves it or sends it back with a reason, then pays it: the
-- approved pay becomes one batch payment.
--
-- Pay for a worker HR hasn't verified (477) is held: on approval their
-- line is split off into its own expense that waits, and the rest of the
-- crew is paid. Once HR verifies them the held expense shows up for the PM
-- to put in the next request.
--
-- A cash advance deducted is netted out of what the bank sends to that
-- worker; when the payment is marked paid, the deducted part is moved from
-- the bank account to Staff advances in the books (the advance it repays).

-- ── Tables ───────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS labour_pay_request_seq;
CREATE TABLE IF NOT EXISTS labour_pay_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'returned', 'approved', 'sent', 'cancelled')),
  note             text,
  attendance_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  signoff_text     text,
  signed_by        uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  signed_by_name   text,
  submitted_at     timestamptz,
  returned_reason  text,
  returned_at      timestamptz,
  returned_by_name text,
  approved_at      timestamptz,
  approved_by      uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  approved_by_name text,
  batch_payment_id uuid REFERENCES batch_payments(id) ON DELETE SET NULL,
  snapshot         jsonb,
  created_by       uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE labour_pay_requests IS 'A PM''s request to finance to pay confirmed labour (479): pay sheets, worker lines with bank and advances, the signed attendance sheet and the PM''s sign-off.';

CREATE TABLE IF NOT EXISTS labour_pay_request_items (
  request_id uuid NOT NULL REFERENCES labour_pay_requests(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  PRIMARY KEY (request_id, expense_id)
);
-- Taken off the request: kept, marked, never deleted.
ALTER TABLE labour_pay_request_items ADD COLUMN IF NOT EXISTS removed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_lpr_items_expense ON labour_pay_request_items (expense_id);

CREATE TABLE IF NOT EXISTS labour_pay_request_deductions (
  request_id uuid NOT NULL REFERENCES labour_pay_requests(id) ON DELETE CASCADE,
  staff_id   uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  amount     numeric NOT NULL CHECK (amount >= 0),
  note       text,
  PRIMARY KEY (request_id, staff_id)
);

-- Held pay: the expense split off for a worker not yet verified.
CREATE TABLE IF NOT EXISTS labour_pay_holds (
  expense_id          uuid PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
  original_expense_id uuid REFERENCES expenses(id) ON DELETE SET NULL,
  request_id          uuid REFERENCES labour_pay_requests(id) ON DELETE SET NULL,
  staff_id            uuid REFERENCES staff(id) ON DELETE SET NULL,
  held_at             timestamptz NOT NULL DEFAULT now()
);
-- Where the held pay came from. The held expense itself carries no request
-- or period: an expense is one per request and period (idx_expense_rollup_unique).
ALTER TABLE labour_pay_holds
  ADD COLUMN IF NOT EXISTS labor_requisition_id uuid REFERENCES labor_requisitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date;

ALTER TABLE labor_expense_workers ADD COLUMN IF NOT EXISTS advance_deducted numeric;
COMMENT ON COLUMN labor_expense_workers.advance_deducted IS 'Cash advance taken off this worker''s pay on a labour payment request (479); the bank sends the rest.';

ALTER TABLE labour_pay_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_pay_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_pay_request_deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_pay_holds ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'labour_pay_requests' AND policyname = 'lpr_read') THEN
    EXECUTE 'CREATE POLICY lpr_read ON labour_pay_requests FOR SELECT TO authenticated USING (true)';
    EXECUTE 'CREATE POLICY lpr_items_read ON labour_pay_request_items FOR SELECT TO authenticated USING (true)';
    EXECUTE 'CREATE POLICY lpr_ded_read ON labour_pay_request_deductions FOR SELECT TO authenticated USING (true)';
    EXECUTE 'CREATE POLICY lpr_holds_read ON labour_pay_holds FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

-- ── Who may act ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.labour_pay_request_can_edit(p_request uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false) OR is_ops_manager()
      OR NOT EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
                      WHERE i.request_id = p_request AND i.removed_at IS NULL AND NOT manages_project(e.project_id));
$function$;

-- ── What a PM can ask to be paid ─────────────────────────────────────
-- Labour expenses from confirmed pay sheets (or held pay now released),
-- not yet approved, not in an open request, on sites this person runs.
CREATE OR REPLACE FUNCTION public.labour_payable_drafts()
RETURNS TABLE (expense_id uuid, expense_code text, project_id uuid, project_name text, what text,
  period_start date, period_end date, amount numeric, workers integer, unverified integer, held boolean, pay_sheet_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT e.id, e.expense_code, e.project_id, p.project_name,
         COALESCE(r.role_needed, e.item_service_description), COALESCE(e.rollup_period_start, h.period_start), COALESCE(e.rollup_period_end, h.period_end), e.amount_etb,
         (SELECT count(*)::int FROM labor_expense_workers w WHERE w.expense_id = e.id),
         (SELECT count(*)::int FROM labor_expense_workers w JOIN staff s ON s.id = w.staff_id
           WHERE w.expense_id = e.id AND s.verified_at IS NULL AND e.vendor_id IS NULL),
         h.expense_id IS NOT NULL, ps.code
    FROM expenses e
    LEFT JOIN labour_pay_sheets ps ON ps.expense_id = e.id
    LEFT JOIN labour_pay_holds h ON h.expense_id = e.id
    LEFT JOIN labor_requisitions r ON r.id = COALESCE(e.rolled_up_from_requisition_id, h.labor_requisition_id)
    LEFT JOIN projects p ON p.id = e.project_id
   WHERE (ps.id IS NOT NULL OR h.expense_id IS NOT NULL)
     AND e.approval_status = 'pending' AND COALESCE(e.payment_state, 'unpaid') = 'unpaid'
     AND NOT COALESCE(e.is_archived, false)
     AND NOT EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN labour_pay_requests q ON q.id = i.request_id
                      WHERE i.expense_id = e.id AND i.removed_at IS NULL AND q.status NOT IN ('cancelled'))
     AND (manages_project(e.project_id) OR COALESCE(get_user_role()::text IN ('admin', 'operations_manager', 'finance'), false) OR is_ops_manager())
   ORDER BY p.project_name, COALESCE(e.rollup_period_end, h.period_end);
$function$;

-- ── The request's worker lines ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.labour_pay_request_lines(p_request uuid)
RETURNS TABLE (staff_id uuid, name text, payee text, crew_leader boolean, days numeric, gross numeric, deduction numeric,
  deduction_note text, net numeric, bank text, account_number text, account_holder text, verified boolean, held boolean, expense_codes text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH x AS (
    SELECT e.id AS expense_id, e.expense_code, e.vendor_id, v.vendor_name, w.staff_id, w.days_worked, w.subtotal
      FROM labour_pay_request_items i
      JOIN expenses e ON e.id = i.expense_id
      LEFT JOIN vendors v ON v.id = e.vendor_id
      JOIN labor_expense_workers w ON w.expense_id = e.id
     WHERE i.request_id = p_request AND i.removed_at IS NULL
  ), g AS (
    SELECT CASE WHEN vendor_id IS NOT NULL THEN NULL ELSE staff_id END AS staff_id, vendor_name,
           sum(days_worked) AS days, sum(subtotal) AS gross, string_agg(DISTINCT expense_code, ', ') AS codes
      FROM x GROUP BY 1, 2
  )
  SELECT g.staff_id, COALESCE(s.employee_name, g.vendor_name, 'Crew'),
         COALESCE(g.vendor_name, s.employee_name), g.vendor_name IS NOT NULL,
         g.days, round(g.gross, 2), COALESCE(d.amount, 0), d.note,
         round(g.gross - COALESCE(d.amount, 0), 2),
         a.account_name, b.account_number, b.account_holder,
         g.vendor_name IS NOT NULL OR s.verified_at IS NOT NULL,
         g.vendor_name IS NULL AND worker_pay_held(g.staff_id),
         g.codes
    FROM g
    LEFT JOIN staff s ON s.id = g.staff_id
    LEFT JOIN labour_pay_request_deductions d ON d.request_id = p_request AND d.staff_id = g.staff_id
    LEFT JOIN LATERAL (SELECT * FROM staff_bank_accounts b WHERE b.staff_id = g.staff_id AND b.is_active
                        ORDER BY b.is_primary DESC, b.created_at DESC LIMIT 1) b ON true
    LEFT JOIN accounts a ON a.id = b.bank_id
   ORDER BY (g.vendor_name IS NOT NULL), 2;
$function$;

-- ── PM: make, fill, submit ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_labour_pay_request(p_expense_ids uuid[], p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid; v_ok int;
BEGIN
  IF p_expense_ids IS NULL OR cardinality(p_expense_ids) = 0 THEN RAISE EXCEPTION 'Pick at least one confirmed pay sheet'; END IF;
  SELECT count(*) INTO v_ok FROM labour_payable_drafts() d WHERE d.expense_id = ANY (p_expense_ids);
  IF v_ok <> cardinality(p_expense_ids) THEN
    RAISE EXCEPTION 'Some of these are not waiting to be requested (already in a request, approved, or not on your sites)';
  END IF;
  INSERT INTO labour_pay_requests (code, note, created_by, created_by_name)
  VALUES ('LPR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('labour_pay_request_seq')::text, 4, '0'),
          NULLIF(btrim(p_note), ''), auth.uid(), (SELECT full_name FROM user_profiles WHERE id = auth.uid()))
  RETURNING id INTO v_id;
  INSERT INTO labour_pay_request_items (request_id, expense_id) SELECT v_id, unnest(p_expense_ids);
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.set_labour_pay_request_items(p_request uuid, p_expense_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE q labour_pay_requests%ROWTYPE; v_ok int;
BEGIN
  SELECT * INTO q FROM labour_pay_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR q.status NOT IN ('draft', 'returned') THEN RAISE EXCEPTION 'Only a draft or returned request can be changed'; END IF;
  IF NOT labour_pay_request_can_edit(p_request) THEN RAISE EXCEPTION 'Only the project manager can change this request'; END IF;
  IF cardinality(p_expense_ids) = 0 THEN RAISE EXCEPTION 'A request needs at least one pay sheet — cancel it instead'; END IF;
  SELECT count(*) INTO v_ok FROM unnest(p_expense_ids) x(id)
   WHERE EXISTS (SELECT 1 FROM labour_pay_request_items i WHERE i.request_id = p_request AND i.expense_id = x.id AND i.removed_at IS NULL)
      OR EXISTS (SELECT 1 FROM labour_payable_drafts() d WHERE d.expense_id = x.id);
  IF v_ok <> cardinality(p_expense_ids) THEN RAISE EXCEPTION 'Some of these cannot be added to this request'; END IF;
  UPDATE labour_pay_request_items SET removed_at = now()
   WHERE request_id = p_request AND removed_at IS NULL AND NOT (expense_id = ANY (p_expense_ids));
  INSERT INTO labour_pay_request_items (request_id, expense_id) SELECT p_request, unnest(p_expense_ids)
  ON CONFLICT (request_id, expense_id) DO UPDATE SET removed_at = NULL;
  -- Advances for workers no longer on the request: cleared.
  UPDATE labour_pay_request_deductions d SET amount = 0 WHERE d.request_id = p_request AND d.amount > 0
     AND NOT EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN labor_expense_workers w ON w.expense_id = i.expense_id
                      WHERE i.request_id = p_request AND i.removed_at IS NULL AND w.staff_id = d.staff_id);
  UPDATE labour_pay_requests SET updated_at = now() WHERE id = p_request;
END $function$;

CREATE OR REPLACE FUNCTION public.set_labour_pay_deduction(p_request uuid, p_staff uuid, p_amount numeric, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE q labour_pay_requests%ROWTYPE; v_gross numeric;
BEGIN
  SELECT * INTO q FROM labour_pay_requests WHERE id = p_request;
  IF NOT FOUND OR q.status NOT IN ('draft', 'returned') THEN RAISE EXCEPTION 'Only a draft or returned request can be changed'; END IF;
  IF NOT labour_pay_request_can_edit(p_request) THEN RAISE EXCEPTION 'Only the project manager can change this request'; END IF;
  SELECT gross INTO v_gross FROM labour_pay_request_lines(p_request) l WHERE l.staff_id = p_staff;
  IF v_gross IS NULL THEN RAISE EXCEPTION 'That worker is not on this request'; END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    UPDATE labour_pay_request_deductions SET amount = 0, note = NULL WHERE request_id = p_request AND staff_id = p_staff;
  ELSE
    IF p_amount > v_gross THEN RAISE EXCEPTION 'The advance (%) is more than their pay (%)', p_amount, v_gross; END IF;
    INSERT INTO labour_pay_request_deductions (request_id, staff_id, amount, note) VALUES (p_request, p_staff, p_amount, NULLIF(btrim(p_note), ''))
    ON CONFLICT (request_id, staff_id) DO UPDATE SET amount = EXCLUDED.amount, note = EXCLUDED.note;
  END IF;
  UPDATE labour_pay_requests SET updated_at = now() WHERE id = p_request;
END $function$;

CREATE OR REPLACE FUNCTION public.submit_labour_pay_request(p_request uuid, p_photos jsonb, p_signoff text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE q labour_pay_requests%ROWTYPE;
BEGIN
  SELECT * INTO q FROM labour_pay_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR q.status NOT IN ('draft', 'returned') THEN RAISE EXCEPTION 'Only a draft or returned request can be submitted'; END IF;
  IF NOT labour_pay_request_can_edit(p_request) THEN RAISE EXCEPTION 'Only the project manager submits this request'; END IF;
  IF jsonb_array_length(COALESCE(p_photos, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Attach a photo of the signed attendance sheet'; END IF;
  IF NULLIF(btrim(p_signoff), '') IS NULL THEN RAISE EXCEPTION 'Sign off the request'; END IF;
  UPDATE labour_pay_requests SET status = 'submitted', attendance_photos = p_photos, signoff_text = btrim(p_signoff),
         signed_by = auth.uid(), signed_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid()),
         submitted_at = now(), note = COALESCE(NULLIF(btrim(p_note), ''), note), returned_reason = NULL,
         snapshot = (SELECT jsonb_agg(to_jsonb(l)) FROM labour_pay_request_lines(p_request) l), updated_at = now()
   WHERE id = p_request;
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_labour_pay_request(p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE q labour_pay_requests%ROWTYPE;
BEGIN
  SELECT * INTO q FROM labour_pay_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR q.status NOT IN ('draft', 'returned', 'submitted') THEN RAISE EXCEPTION 'An approved request can''t be cancelled'; END IF;
  IF NOT (labour_pay_request_can_edit(p_request) OR COALESCE(get_user_role()::text IN ('finance', 'admin'), false)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE labour_pay_requests SET status = 'cancelled', updated_at = now() WHERE id = p_request;
END $function$;

-- ── Finance: return, approve, pay ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.return_labour_pay_request(p_request uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('finance', 'admin') THEN RAISE EXCEPTION 'Finance returns requests'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say what needs fixing'; END IF;
  UPDATE labour_pay_requests SET status = 'returned', returned_reason = btrim(p_reason), returned_at = now(),
         returned_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid()), updated_at = now()
   WHERE id = p_request AND status = 'submitted';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a submitted request can be returned'; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.approve_labour_pay_request(p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  q labour_pay_requests%ROWTYPE; it record; w record; e expenses%ROWTYPE;
  v_new uuid; v_held numeric := 0; v_held_n int := 0; v_ok int := 0; v_total numeric := 0;
  v_n_held int; v_n_free int; v_sum_held numeric; v_one uuid;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('finance', 'admin') THEN RAISE EXCEPTION 'Finance approves requests'; END IF;
  SELECT * INTO q FROM labour_pay_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR q.status <> 'submitted' THEN RAISE EXCEPTION 'Only a submitted request can be approved'; END IF;

  FOR it IN SELECT i.expense_id FROM labour_pay_request_items i WHERE i.request_id = p_request AND i.removed_at IS NULL LOOP
    SELECT * INTO e FROM expenses WHERE id = it.expense_id FOR UPDATE;
    -- Hold the lines of workers HR hasn't verified (not crew-leader pay).
    IF e.vendor_id IS NULL THEN
      SELECT count(*) FILTER (WHERE worker_pay_held(x.staff_id)), count(*) FILTER (WHERE NOT worker_pay_held(x.staff_id)),
             COALESCE(sum(x.subtotal) FILTER (WHERE worker_pay_held(x.staff_id)), 0),
             (array_agg(x.staff_id) FILTER (WHERE worker_pay_held(x.staff_id)))[1]
        INTO v_n_held, v_n_free, v_sum_held, v_one
        FROM labor_expense_workers x WHERE x.expense_id = e.id;
      -- Everyone on it is held: keep the whole payable back as it is, for a later request.
      IF v_n_held > 0 AND (v_n_free = 0 OR v_sum_held >= e.amount_etb) THEN
        INSERT INTO labour_pay_holds (expense_id, request_id, staff_id, labor_requisition_id, period_start, period_end)
        VALUES (e.id, p_request, CASE WHEN v_n_held = 1 THEN v_one END, e.rolled_up_from_requisition_id, e.rollup_period_start, e.rollup_period_end)
        ON CONFLICT (expense_id) DO UPDATE SET request_id = EXCLUDED.request_id, held_at = now();
        UPDATE labour_pay_request_items SET removed_at = now() WHERE request_id = p_request AND expense_id = e.id;
        v_held := v_held + e.amount_etb; v_held_n := v_held_n + v_n_held;
        CONTINUE;
      END IF;
      FOR w IN SELECT x.id, x.staff_id, x.subtotal, s.employee_name FROM labor_expense_workers x JOIN staff s ON s.id = x.staff_id
                WHERE x.expense_id = e.id AND worker_pay_held(x.staff_id) LOOP
        INSERT INTO expenses (item_service_description, amount_etb, expense_type, category_id, project_id, date,
          paid_to_staff_id, approval_status, payment_state)
        VALUES (format('Held for HR verification — %s · from %s', w.employee_name, COALESCE(e.expense_code, 'a labour payable')),
          w.subtotal, e.expense_type, e.category_id, e.project_id, e.date, w.staff_id, 'pending', 'unpaid')
        RETURNING id INTO v_new;
        UPDATE labor_expense_workers SET expense_id = v_new WHERE id = w.id;
        INSERT INTO labour_pay_holds (expense_id, original_expense_id, request_id, staff_id, labor_requisition_id, period_start, period_end)
        VALUES (v_new, e.id, p_request, w.staff_id, e.rolled_up_from_requisition_id, e.rollup_period_start, e.rollup_period_end);
        UPDATE expenses SET amount_etb = amount_etb - w.subtotal WHERE id = e.id;
        v_held := v_held + w.subtotal; v_held_n := v_held_n + 1;
      END LOOP;
    END IF;
    -- Advances: on each worker's line, so the bank sends the rest.
    UPDATE labor_expense_workers x SET advance_deducted = round(d.amount * x.subtotal / NULLIF(t.total, 0), 2)
      FROM labour_pay_request_deductions d,
           LATERAL (SELECT sum(y.subtotal) AS total FROM labor_expense_workers y JOIN labour_pay_request_items i2 ON i2.expense_id = y.expense_id
                     WHERE i2.request_id = p_request AND i2.removed_at IS NULL AND y.staff_id = d.staff_id) t
     WHERE d.request_id = p_request AND d.amount > 0 AND x.staff_id = d.staff_id AND x.expense_id = e.id;
    SELECT * INTO e FROM expenses WHERE id = e.id;
    IF e.amount_etb > 0 THEN
      UPDATE expenses SET approval_status = 'finance_approved' WHERE id = e.id;
      v_ok := v_ok + 1; v_total := v_total + e.amount_etb;
    ELSE
      UPDATE labour_pay_request_items SET removed_at = now() WHERE request_id = p_request AND expense_id = e.id;
    END IF;
  END LOOP;

  UPDATE labour_pay_requests SET status = 'approved', approved_at = now(), approved_by = auth.uid(),
         approved_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid()), updated_at = now()
   WHERE id = p_request;
  RETURN jsonb_build_object('approved', v_ok, 'total', v_total, 'held_workers', v_held_n, 'held_amount', v_held);
END $function$;

CREATE OR REPLACE FUNCTION public.pay_labour_pay_request(p_request uuid, p_assignee uuid, p_account uuid, p_method text DEFAULT 'batch_wire')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE q labour_pay_requests%ROWTYPE; v_ids uuid[]; v_batch uuid;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('finance', 'admin') THEN RAISE EXCEPTION 'Finance pays requests'; END IF;
  SELECT * INTO q FROM labour_pay_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR q.status <> 'approved' THEN RAISE EXCEPTION 'Approve the request first'; END IF;
  SELECT array_agg(i.expense_id) INTO v_ids FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
   WHERE i.request_id = p_request AND i.removed_at IS NULL AND e.payment_state = 'approved_to_pay';
  IF v_ids IS NULL THEN RAISE EXCEPTION 'Nothing on this request is waiting to be paid'; END IF;
  v_batch := create_batch_payment(v_ids, p_assignee, p_account, p_method, q.code,
               'Labour payment request ' || q.code || COALESCE(' — ' || q.note, ''));
  UPDATE labour_pay_requests SET status = 'sent', batch_payment_id = v_batch, updated_at = now() WHERE id = p_request;
  RETURN v_batch;
END $function$;

-- ── The books: an advance deducted repays the advance ────────────────
-- The payment posting credits the bank for the whole bill; the bank sent
-- less by the advances deducted. This moves that part from the bank
-- account to Staff advances, worker by worker.
CREATE OR REPLACE FUNCTION public.trg_labour_advance_recovery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_cash uuid; v_lines jsonb;
BEGIN
  IF NEW.payment_state <> 'paid' OR OLD.payment_state IS NOT DISTINCT FROM 'paid' THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM labor_expense_workers WHERE expense_id = NEW.id AND COALESCE(advance_deducted, 0) > 0) THEN RETURN NULL; END IF;
  SELECT coa.id INTO v_cash FROM chart_of_accounts coa WHERE coa.linked_account_id = NEW.account_id;
  IF v_cash IS NULL THEN
    PERFORM log_posting_failure('expenses', NEW.id, 'Advances deducted, but no bank account on the payment to post them against');
    RETURN NULL;
  END IF;
  SELECT jsonb_build_array(ledger_line(v_cash, sum(w.advance_deducted), 'Advances deducted from labour pay — the bank sent less', NEW.project_id, NULL, NULL, NULL))
         || COALESCE(jsonb_agg(ledger_line(coa_id('staff_advances'), -w.advance_deducted, 'Advance repaid from labour pay', NEW.project_id, NULL, NULL, w.staff_id)), '[]'::jsonb)
    INTO v_lines
    FROM labor_expense_workers w WHERE w.expense_id = NEW.id AND COALESCE(w.advance_deducted, 0) > 0;
  PERFORM ledger_sync('labour_advance_recovery', NEW.id, COALESCE(NEW.bank_date, NEW.paid_date::date, CURRENT_DATE),
                      'Advances deducted from labour pay: ' || COALESCE(NEW.expense_code, NEW.id::text), v_lines, 'operational');
  RETURN NULL;
END $function$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_zz_labour_advance_recovery') THEN
    EXECUTE 'CREATE TRIGGER trg_zz_labour_advance_recovery AFTER UPDATE OF payment_state ON public.expenses
             FOR EACH ROW EXECUTE FUNCTION trg_labour_advance_recovery()';
  END IF;
END $$;

-- ── Lists ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.labour_pay_request_list(p_scope text DEFAULT 'mine')
RETURNS TABLE (id uuid, code text, status text, created_by_name text, created_at timestamptz, submitted_at timestamptz,
  approved_at timestamptz, returned_reason text, projects text, sheets integer, workers integer, gross numeric, deductions numeric,
  net numeric, unverified integer, batch_payment_id uuid, batch_code text, batch_paid boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT q.id, q.code, q.status, q.created_by_name, q.created_at, q.submitted_at, q.approved_at, q.returned_reason,
         (SELECT string_agg(DISTINCT p.project_name, ', ') FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id JOIN projects p ON p.id = e.project_id WHERE i.request_id = q.id AND i.removed_at IS NULL),
         (SELECT count(*)::int FROM labour_pay_request_items i WHERE i.request_id = q.id AND i.removed_at IS NULL),
         l.workers, l.gross, l.deductions, l.net, l.unverified,
         q.batch_payment_id, b.payment_code,
         (q.batch_payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM labour_pay_request_items i JOIN expenses e ON e.id = i.expense_id
                                                         WHERE i.request_id = q.id AND i.removed_at IS NULL AND e.payment_state <> 'paid'))
    FROM labour_pay_requests q
    LEFT JOIN batch_payments b ON b.id = q.batch_payment_id
    LEFT JOIN LATERAL (SELECT count(*)::int AS workers, sum(x.gross) AS gross, sum(x.deduction) AS deductions, sum(x.net) AS net,
                              count(*) FILTER (WHERE NOT x.verified)::int AS unverified
                         FROM labour_pay_request_lines(q.id) x) l ON true
   WHERE q.status <> 'cancelled'
     AND CASE p_scope
           WHEN 'finance' THEN q.status IN ('submitted', 'approved', 'sent') AND COALESCE(get_user_role()::text IN ('finance', 'admin', 'executive'), false)
           ELSE q.created_by = auth.uid() OR labour_pay_request_can_edit(q.id) END
   ORDER BY CASE q.status WHEN 'returned' THEN 0 WHEN 'draft' THEN 1 WHEN 'submitted' THEN 2 WHEN 'approved' THEN 3 ELSE 4 END, q.created_at DESC
   LIMIT 200;
$function$;

GRANT EXECUTE ON FUNCTION labour_payable_drafts(), labour_pay_request_lines(uuid), create_labour_pay_request(uuid[], text),
  set_labour_pay_request_items(uuid, uuid[]), set_labour_pay_deduction(uuid, uuid, numeric, text),
  submit_labour_pay_request(uuid, jsonb, text, text), cancel_labour_pay_request(uuid), return_labour_pay_request(uuid, text),
  approve_labour_pay_request(uuid), pay_labour_pay_request(uuid, uuid, uuid, text), labour_pay_request_list(text),
  labour_pay_request_can_edit(uuid) TO authenticated;
