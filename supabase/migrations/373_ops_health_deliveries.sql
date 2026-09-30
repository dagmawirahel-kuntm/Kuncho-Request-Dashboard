-- 373 — Operations Health knows about part deliveries and site signatures
--
-- Since 371 an order stays "ordered" until everything has arrived, so a late
-- order that came in part is still late: it no longer drops off the list the
-- moment its first GRN is recorded. And two new kinds of stuck work:
--   * sdn_to_confirm — a site signed for less than was sent (or refused
--     something) and procurement hasn't settled it;
--   * sdn_unsigned  — goods sent to a site, past the day they were expected,
--     and the project manager hasn't signed.

SET search_path TO public;

DO $$
DECLARE
  d      text := pg_get_viewdef('v_ops_health_items'::regclass, true);
  before text;
BEGIN
  IF strpos(d, 'sdn_to_confirm') = 0 THEN
    before := d;
    d := replace(d,
      E'WHERE b.status::text = ''ordered''::text AND b.expected_delivery_date < CURRENT_DATE AND NOT (EXISTS ( SELECT 1\n           FROM goods_received_notes g\n          WHERE g.sourcing_bundle_id = b.id))',
      E'WHERE b.status::text = ''ordered''::text AND b.expected_delivery_date < CURRENT_DATE');
    IF d = before THEN
      RAISE EXCEPTION 'v_ops_health_items changed shape — update 373';
    END IF;
    d := rtrim(rtrim(d), ';') || $sql$
UNION ALL
 SELECT 'sdn_to_confirm'::text AS kind,
    s.id::text AS ref_id,
    (s.sdn_code || ' · '::text) || COALESCE(s.project_name, 'site'::text) AS title,
    ((COALESCE(s.vendor_name, ''::text) || ' · signed by '::text) || COALESCE(s.signed_by_name, 'the site'::text)) || ' with exceptions'::text AS detail,
    NULL::numeric AS amount,
    s.signed_at::date AS since,
    'procurement'::text AS owner_team,
    up.full_name AS owner_name,
    sb.procurement_officer_id AS owner_user_id,
    '/site-deliveries/'::text || s.id AS link,
    false AS urgent
   FROM site_delivery_notes s
     JOIN sourcing_bundles sb ON sb.id = s.sourcing_bundle_id
     LEFT JOIN user_profiles up ON up.id = sb.procurement_officer_id
  WHERE s.status = 'exceptions'::text
UNION ALL
 SELECT 'sdn_unsigned'::text AS kind,
    s.id::text AS ref_id,
    (s.sdn_code || ' · '::text) || COALESCE(s.project_name, 'site'::text) AS title,
    (COALESCE(s.vendor_name, ''::text) || ' · expected '::text) || to_char(COALESCE(s.expected_on, s.issued_at::date)::timestamp with time zone, 'DD Mon'::text) AS detail,
    NULL::numeric AS amount,
    COALESCE(s.expected_on, s.issued_at::date) AS since,
    'project'::text AS owner_team,
    st.employee_name AS owner_name,
    st.user_id AS owner_user_id,
    '/site-deliveries/'::text || s.id AS link,
    COALESCE(s.expected_on, s.issued_at::date) < (CURRENT_DATE - 3) AS urgent
   FROM site_delivery_notes s
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN staff st ON st.id = p.project_manager_id
  WHERE s.status = 'issued'::text AND COALESCE(s.expected_on, s.issued_at::date + 1) < CURRENT_DATE$sql$;
    EXECUTE 'CREATE OR REPLACE VIEW v_ops_health_items WITH (security_invoker = on) AS ' || d;
  END IF;
END $$;
