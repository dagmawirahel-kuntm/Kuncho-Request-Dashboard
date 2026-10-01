-- 396 — Which vendor a typed-in name probably is
--
-- 77 expenses this year name the payee in free text. The fixer (395)
-- offers the closest vendors for each name, so linking them is a click.

SET search_path TO public;

-- A typed name often carries the payee's bank account in front of it
-- ("1000603750358 Talamos Bezabeh"): the digits are dropped before matching.
CREATE OR REPLACE FUNCTION public.suggest_vendors(p_name text, p_limit int DEFAULT 3)
RETURNS TABLE (id uuid, vendor_name text, score real)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH n AS (SELECT lower(btrim(regexp_replace(regexp_replace(COALESCE(p_name, ''), '[0-9]+', '', 'g'), '\s+', ' ', 'g'))) AS q)
  SELECT v.id, v.vendor_name, similarity(lower(v.vendor_name), n.q) AS score
    FROM vendors v CROSS JOIN n
   WHERE v.active AND length(n.q) >= 3
     AND (similarity(lower(v.vendor_name), n.q) > 0.3
          OR lower(v.vendor_name) LIKE '%' || n.q || '%'
          OR n.q LIKE '%' || lower(v.vendor_name) || '%')
   ORDER BY score DESC, v.vendor_name
   LIMIT p_limit
$$;
REVOKE EXECUTE ON FUNCTION suggest_vendors(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION suggest_vendors(text, int) TO authenticated;
