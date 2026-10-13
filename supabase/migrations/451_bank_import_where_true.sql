-- 451: Bank statement import — "UPDATE requires a WHERE clause".
--
-- The API's database role loads Supabase's safeupdate guard, which rejects
-- any UPDATE or DELETE without a WHERE — inside functions too. The import
-- (344, then 346) stamps every staged line with its fingerprint in one
-- WHERE-less UPDATE of the temp table _stmt, so every import from the app,
-- the check as well as the real one, failed on that line. Run from the SQL
-- editor the guard isn't loaded, which is why it never showed there.
--
-- Only that line changes: it gets "WHERE true". The live definition is
-- patched in place, and the patch refuses to run if the line isn't found.

SET search_path TO public;

DO $$
DECLARE
  v_old constant text := 'UPDATE _stmt SET fingerprint = bank_line_fingerprint(value_date, debit_amount, credit_amount, running_balance, reference_code, narration);';
  v_new constant text := 'UPDATE _stmt SET fingerprint = bank_line_fingerprint(value_date, debit_amount, credit_amount, running_balance, reference_code, narration) WHERE true;';
  d text;
BEGIN
  d := pg_get_functiondef('import_bank_statement(uuid,text,text,numeric,numeric,jsonb,boolean)'::regprocedure);
  IF position(v_new IN d) > 0 THEN RETURN; END IF;  -- already patched
  IF position(v_old IN d) = 0 THEN
    RAISE EXCEPTION 'import_bank_statement: the fingerprint UPDATE was not found; patch by hand';
  END IF;
  EXECUTE replace(d, v_old, v_new);
END $$;
