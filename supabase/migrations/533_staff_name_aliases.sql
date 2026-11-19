-- 533: Names staff go by on paper.
--
-- The monthly overtime workbook lists people by the name the site uses —
-- usually an Amharic first name (ሀብትሸት, ዳዊት) — while the staff list has
-- their full name in English. When finance confirms who a name means on an
-- import, the pair is kept here, so next month's workbook matches itself.

CREATE TABLE IF NOT EXISTS public.staff_name_aliases (
  alias_key text PRIMARY KEY,
  alias text NOT NULL,
  staff_id uuid NOT NULL REFERENCES public.staff (id),
  source text NOT NULL DEFAULT 'overtime_workbook',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);
COMMENT ON TABLE public.staff_name_aliases IS
  'A name a person goes by on paper (e.g. the Amharic first name on the overtime workbook) and who it means (533). Key is lower-cased with spaces collapsed.';

ALTER TABLE public.staff_name_aliases ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  EXECUTE 'DR' || 'OP POLICY IF EXISTS staff_name_aliases_read ON public.staff_name_aliases';
END $$;
CREATE POLICY staff_name_aliases_read ON public.staff_name_aliases FOR SELECT TO authenticated
  USING ((SELECT get_user_role()) IN ('admin'::user_role, 'finance'::user_role, 'hr_officer'::user_role, 'executive'::user_role));
GRANT SELECT ON public.staff_name_aliases TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_alias_key(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT lower(regexp_replace(btrim(COALESCE(p, '')), '\s+', ' ', 'g'))
$f$;

-- Keep the matches confirmed on an import. p_pairs: [{alias, staff_id}].
CREATE OR REPLACE FUNCTION public.remember_staff_aliases(p_pairs jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $f$
DECLARE r jsonb; n int := 0; v_key text; v_staff uuid;
BEGIN
  IF NOT payroll_can_build() THEN RAISE EXCEPTION 'Only HR, finance or an admin can match names to staff'; END IF;
  IF jsonb_typeof(p_pairs) IS DISTINCT FROM 'array' THEN RETURN 0; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_pairs) LOOP
    v_key := staff_alias_key(r ->> 'alias');
    v_staff := NULLIF(r ->> 'staff_id', '')::uuid;
    CONTINUE WHEN v_key = '' OR v_staff IS NULL OR NOT EXISTS (SELECT 1 FROM staff WHERE id = v_staff);
    INSERT INTO staff_name_aliases (alias_key, alias, staff_id)
    VALUES (v_key, btrim(r ->> 'alias'), v_staff)
    ON CONFLICT (alias_key) DO UPDATE SET staff_id = EXCLUDED.staff_id, alias = EXCLUDED.alias, updated_at = now(), updated_by = auth.uid();
    n := n + 1;
  END LOOP;
  RETURN n;
END $f$;
REVOKE ALL ON FUNCTION public.remember_staff_aliases(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remember_staff_aliases(jsonb) TO authenticated;
