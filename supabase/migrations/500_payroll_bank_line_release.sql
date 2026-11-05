-- 500: undoing a salary line's match frees the people it paid (499) and
-- reverses its posting with an adjusting entry, so the books keep the trail.
-- A removed bank line does the same.

CREATE OR REPLACE FUNCTION public.release_payroll_bank_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE payroll_staff SET bank_line_id = NULL WHERE bank_line_id = OLD.id;
    PERFORM ledger_sync('payroll_bank_line', OLD.id, OLD.value_date, 'Salaries paid: bank line removed', '[]'::jsonb);
  ELSIF OLD.matched_payroll_id IS NOT NULL AND NEW.matched_payroll_id IS DISTINCT FROM OLD.matched_payroll_id THEN
    UPDATE payroll_staff SET bank_line_id = NULL WHERE bank_line_id = OLD.id;
    PERFORM post_payroll_bank_line(OLD.id);
  END IF;
  RETURN NULL;
END $f$;

CREATE OR REPLACE TRIGGER trg_release_payroll_bank_line
  AFTER UPDATE OF matched_payroll_id OR DELETE ON bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION release_payroll_bank_line();
