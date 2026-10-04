-- 416 — A vendor's materials in sections, and vendors like them
--
-- The vendor page listed everything ever bought from a vendor in one flat
-- table — 133 rows for the busiest — so what a vendor actually supplies
-- was hard to see. Only 354 of 891 purchase-order lines are linked to a
-- stock item (with its main category); the rest are free-text names like
-- "2.5 cable bale 3", "ppr elbow ¾" or "laminted white #18 mdf".
--
--   material_section(name, main_category)
--       the section an item belongs to, read from its name (English and
--       the Amharic words buyers type: kelem paint, medosha hammer, kacha
--       gypsum fibre, fero iron, milach scraper). When the name says
--       nothing, the stock item's main category — too coarse to go first:
--       the catalogue files sandpaper and silicone as hardware. Sections:
--         electrical  Electrical & lighting      plumbing  Plumbing & sanitary
--         board       Boards, wood & finishes    aluminium Aluminium, profiles & glass
--         hardware    Hardware & fittings        paint     Paint, adhesives & consumables
--         tools       Tools & equipment          construction  Stone, ceramic & construction
--         decor       Furniture & décor          other     Other
--   v_vendor_items_bought  gains a section column (appended)
--   similar_vendors(vendor)  vendors that sell the same items (with how
--       their prices compare on them), the same kinds of material, or are
--       in the same category — ranked, with the reason in words

SET search_path TO public;

CREATE OR REPLACE FUNCTION material_section(p_name text, p_main text DEFAULT NULL)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
      WHEN by_name <> 'other' THEN by_name
      WHEN p_main = 'electrical' THEN 'electrical'
      WHEN p_main = 'hardware' THEN 'hardware'
      WHEN p_main = 'construction' THEN 'construction'
      WHEN p_main = 'wood_work' THEN 'board'
      WHEN p_main = 'painting' THEN 'paint'
      WHEN p_main = 'tools' THEN 'tools'
      ELSE 'other' END
  FROM (SELECT CASE
      WHEN n ~ '(ingco|inco\M|drill|grinder|\msaw\M|saw by|jig ?saw|holesaw|\mdisc|\mdisk|compressor|router|battry|battery|makit|punta|medosha|milach|e?squadra|matefya|wuha lik|mortar mixer|measuring|meter tape)' THEN 'tools'
      WHEN n ~ '(\mppr|upvc|\mpvc|elbow|\mtee\M|valve|pipe|drain|siphon|cifone|\mtrap\M|\mtap\M|mixer|shower|shwer|\mwc\M|sink|\munion\M|reduc[ae]r|teflon|y branch|hand ?was?he?|floor jali|o-clamp|male adapter|female|bridge|socket ?(1|3/4|¾|25))' THEN 'plumbing'
      WHEN n ~ '(cable|wire|socket|soket|switch|breaker|insulation tape|nastro|light(?! ?(gr[ae]y|brown|blue|green|oak|walnut))|\mlamp|\mled\M|power supply|contactor|capacitor|rj ?45|\mdata\M|conduit|condiut|guroro|(?<!wall )\mplug\M|\mbell\M|push b|remote|speaker|\mhdd|12v|cat ?6|^\d+ ?a$)' THEN 'electrical'
      WHEN n ~ '(screw|hinge|\mnail|fis?c?her|wall plug)' THEN 'hardware'
      WHEN n ~ '(paint|jotun|primer|sealer|lacquer|stuc+o|stuuco|silic?on|silcon|glue|giue|foam _?spray|mastish|thinner|sand ?paper|brush|putty|postish|scotch|scoth|\mtape\M|marker|kraft|^(1153|4224|4403)|\m2k\M|birchiko|wereket|filler|colla|kelem|dul+entin|^espresso bale)' THEN 'paint'
      WHEN n ~ '(mdf|veneer|lamin|lamn|board|\mspc|skirting|plywood|\mwood|\muv\M|melamine|chipboard|morale)' THEN 'board'
      WHEN n ~ '(screw|fisher|hinge|hingr|handle|handel|\mlock|locker|\mpin\M|roller|wheel|whell|\mhook|\mkey\M|mismar|spacer|stopper|ferma|bracket|bolt|\mnut\M|\mnail|staple|slider\M|slider bale)' THEN 'hardware'
      WHEN n ~ '(cement|ceramic|cermaic|granite|marble|gypsum|ceiling|stone|adhesive|\msand\M|aggregate|rebar|metal|steel|\mriga\M|tile|\mshebo|ad+it+ional|\mcross\M|runner|kacha|\mfero|estko)' THEN 'construction'
      WHEN n ~ '(alum|almun|profile|cladd|\mtrack|connector|pc sheet|glass|galss|\mslid|shatter|frame|c channel|omega|angel|angle|midrail|luover|louver|spider|^(l|t|z|regular [lz]|lcorner|l [a-z_ ]+|t_silver|l_ silver)$)' THEN 'aluminium'
      WHEN n ~ '(carpet|curtain|planter|table|chair|hanger|\mdoors?\M|sofa|tv mount|sticker|logo|banner|\mmica\M|foam|^\d+ ?x ?\d+ ?x ?\d+$)' THEN 'decor'
      ELSE 'other' END AS by_name
    FROM (SELECT lower(btrim(COALESCE(p_name, ''))) AS n) x) y;
$fn$;
GRANT EXECUTE ON FUNCTION material_section(text, text) TO authenticated;

-- The same view as before with the section appended (CREATE OR REPLACE
-- may only add columns at the end).
CREATE OR REPLACE VIEW v_vendor_items_bought WITH (security_invoker = true) AS
 SELECT b.vendor_id,
    COALESCE((oi.stock_item_id)::text, ('name:'::text || stock_name_key(oi.item_name))) AS item_key,
    oi.stock_item_id,
    (array_agg(COALESCE(si.item_name, oi.item_name) ORDER BY COALESCE(b.ordered_at, b.created_at) DESC))[1] AS item_name,
    (array_agg(oi.unit ORDER BY COALESCE(b.ordered_at, b.created_at) DESC))[1] AS unit,
    count(DISTINCT b.id) AS times_bought,
    sum((sbi.quantity_actual)) AS total_qty,
    sum((sbi.quantity_actual * sbi.unit_price_actual)) AS total_value,
    (array_agg(sbi.unit_price_actual ORDER BY COALESCE(b.ordered_at, b.created_at) DESC))[1] AS last_price,
    min(sbi.unit_price_actual) AS min_price,
    max(sbi.unit_price_actual) AS max_price,
    (max(COALESCE(b.ordered_at, b.created_at)))::date AS last_bought_on,
    (array_agg(material_section(COALESCE(si.item_name, oi.item_name), si.main_category) ORDER BY COALESCE(b.ordered_at, b.created_at) DESC))[1] AS section
   FROM (((sourcing_bundle_items sbi
     JOIN sourcing_bundles b ON ((b.id = sbi.bundle_id)))
     JOIN order_items oi ON ((oi.id = sbi.order_item_id)))
     LEFT JOIN stock_items si ON ((si.id = oi.stock_item_id)))
  WHERE ((b.vendor_id IS NOT NULL) AND ((b.status)::text <> ALL (ARRAY['drafting'::text, 'cancelled'::text])) AND (sbi.unit_price_actual > (0)::numeric))
  GROUP BY b.vendor_id, COALESCE((oi.stock_item_id)::text, ('name:'::text || stock_name_key(oi.item_name))), oi.stock_item_id;

-- ── Vendors like this one ────────────────────────────────────────────
-- Score: 3 per item both sell, up to 5 for selling the same kinds of
-- material (weighted by what we spend on each kind here), 2 for the same
-- category, 1 for the same area. An item only counts as shared when the
-- two last prices are within three times of each other — a "brush" at 2%
-- of the price is a different brush. Runs as the caller.
CREATE OR REPLACE FUNCTION similar_vendors(p_vendor uuid, p_limit int DEFAULT 8)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $fn$
  WITH me AS (SELECT * FROM vendors WHERE id = p_vendor),
  mine AS (SELECT * FROM v_vendor_items_bought WHERE vendor_id = p_vendor),
  my_sections AS (
    SELECT section, sum(total_value) AS spend, sum(sum(total_value)) OVER () AS all_spend
      FROM mine GROUP BY section),
  others AS (SELECT * FROM v_vendor_items_bought WHERE vendor_id <> p_vendor),
  shared AS (
    SELECT o.vendor_id, count(*) AS n,
           (array_agg(m.item_name ORDER BY m.total_value DESC))[1:3] AS sample,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY o.last_price / NULLIF(m.last_price, 0)) AS ratio
      FROM others o JOIN mine m ON m.item_key = o.item_key
     WHERE o.last_price BETWEEN m.last_price / 3 AND m.last_price * 3
     GROUP BY o.vendor_id),
  sect AS (
    SELECT x.vendor_id, array_agg(x.section) AS sections, sum(ms.spend / NULLIF(ms.all_spend, 0)) AS weight
      FROM (SELECT DISTINCT vendor_id, section FROM others WHERE section <> 'other') x
      JOIN my_sections ms ON ms.section = x.section
     GROUP BY x.vendor_id),
  hist AS (SELECT vendor_id, max(last_bought_on) AS last_bought, sum(total_value) AS total FROM others GROUP BY vendor_id),
  cand AS (
    SELECT v.id, v.vendor_name, v.vendor_type, v.category, v.verification_status, v.phone_contact, l.location_name AS area,
           COALESCE(s.n, 0) AS shared_items, s.sample, s.ratio, sc.sections, COALESCE(sc.weight, 0) AS weight,
           (me.category IS NOT NULL AND v.category = me.category) AS same_category,
           (me.location_id IS NOT NULL AND v.location_id = me.location_id) AS same_area,
           h.last_bought, h.total
      FROM vendors v CROSS JOIN me
      LEFT JOIN shared s ON s.vendor_id = v.id
      LEFT JOIN sect sc ON sc.vendor_id = v.id
      LEFT JOIN hist h ON h.vendor_id = v.id
      LEFT JOIN locations l ON l.id = v.location_id
     WHERE v.id <> p_vendor AND COALESCE(v.active, true)
       AND (s.n IS NOT NULL OR sc.sections IS NOT NULL OR (me.category IS NOT NULL AND v.category = me.category)))
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'vendor_id', id, 'vendor_name', vendor_name, 'vendor_type', vendor_type, 'category', category,
           'verification_status', verification_status, 'phone', phone_contact, 'area', area,
           'shared_items', shared_items, 'shared_sample', sample, 'price_ratio', round(ratio::numeric, 2),
           'shared_sections', sections, 'same_category', same_category, 'same_area', same_area,
           'last_bought', last_bought, 'total_bought', round(total),
           'score', round((shared_items * 3 + LEAST(weight, 1) * 5 + CASE WHEN same_category THEN 2 ELSE 0 END + CASE WHEN same_area THEN 1 ELSE 0 END)::numeric, 1))
         ORDER BY shared_items * 3 + LEAST(weight, 1) * 5 + CASE WHEN same_category THEN 2 ELSE 0 END + CASE WHEN same_area THEN 1 ELSE 0 END DESC, total DESC NULLS LAST), '[]'::jsonb)
    FROM (SELECT * FROM cand
           ORDER BY shared_items * 3 + LEAST(weight, 1) * 5 + CASE WHEN same_category THEN 2 ELSE 0 END + CASE WHEN same_area THEN 1 ELSE 0 END DESC, total DESC NULLS LAST
           LIMIT GREATEST(p_limit, 1)) c;
$fn$;
REVOKE ALL ON FUNCTION similar_vendors(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION similar_vendors(uuid, int) TO authenticated;
