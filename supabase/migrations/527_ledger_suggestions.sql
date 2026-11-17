-- 527: Suggest the ledger for an item — suggest, confirm, learn.
--
-- When a GRN line's item has no ledger yet, the receiver is asked for one.
-- Instead of a bare list of ~45 ledgers, the app now suggests, in layers:
--
--   1. item      the item list already has this name (and unit) with a ledger
--   2. rule      the name plainly says what it is (ledger_category_for_name,
--                521: discs → site consumables, elbows → plumbing, …)
--   2b. request  the purchase request line was given a sub-ledger
--   3. similar   the most similar names in the item list (trigram match),
--                e.g. "castel whell" → Components, like "Castle wheel 5*2"
--   4. supplier  what this supplier's items usually are (SADOR Aluminium →
--                Aluminum)
--
-- Each layer proposes a ledger with a confidence; where layers agree the
-- confidence rises. The top three come back with a one-line reason.
-- Tested before building: hiding each of 838 classified items' ledger and
-- guessing it back, a close name match was right 79% of the time and the
-- supplier 56%.
--
--   6. learn     the chosen ledger is saved on the item (521: the first
--                receipt classifies it), so next time layer 1 answers and
--                layer 3 has one more example. Every suggestion shown at a
--                GRN is logged with what was chosen (ledger_suggestion_log),
--                so finance can see how often suggestions are taken.
--
-- Also: item_ledger_second_opinion() — items whose ledger was not set by
-- finance and whose look-alikes or name say something else, for review.

SET search_path TO public;

CREATE INDEX IF NOT EXISTS stock_items_item_name_trgm ON stock_items USING gin (lower(item_name) gin_trgm_ops);

-- The account and group a ledger (category) posts to.
CREATE OR REPLACE FUNCTION public.ledger_category_label(p_cat uuid)
RETURNS TABLE (category_name text, group_name text, account_code text)
LANGUAGE sql STABLE SET search_path TO public AS $f$
  SELECT btrim(cat.category_name), g.account_name, a.account_code
    FROM categories cat
    JOIN LATERAL (SELECT * FROM chart_of_accounts a WHERE a.category_id = cat.id AND a.is_postable ORDER BY a.account_code LIMIT 1) a ON true
    LEFT JOIN chart_of_accounts g ON g.id = a.parent_account_id
   WHERE cat.id = p_cat
$f$;

CREATE OR REPLACE FUNCTION public.suggest_item_ledgers(
  p_name text, p_unit text DEFAULT NULL, p_vendor uuid DEFAULT NULL,
  p_hint uuid DEFAULT NULL, p_exclude_item uuid DEFAULT NULL)
RETURNS TABLE (category_id uuid, category_name text, group_name text, account_code text,
               source text, reason text, confidence numeric)
LANGUAGE sql STABLE SET search_path TO public AS $f$
  WITH q AS (SELECT lower(btrim(COALESCE(p_name, ''))) AS nm),
  by_item AS (
    SELECT si.ledger_category_id AS cat, 'item'::text AS src, 'Set on the item “' || si.item_name || '”' AS why, 1.0::numeric AS conf
      FROM stock_items si
     WHERE si.id = stock_item_for_name(p_name, p_unit) AND si.id IS DISTINCT FROM p_exclude_item
       AND si.ledger_category_id IS NOT NULL
  ),
  by_rule AS (
    SELECT ledger_category_for_name(p_name) AS cat, 'rule'::text, 'From the name'::text, 0.9::numeric
     WHERE ledger_category_for_name(p_name) IS NOT NULL
  ),
  by_request AS (
    SELECT p_hint, 'request'::text, 'From the purchase request'::text, 0.7::numeric WHERE p_hint IS NOT NULL
  ),
  by_similar AS (
    SELECT DISTINCT ON (si.ledger_category_id) si.ledger_category_id AS cat, 'similar'::text,
           'Like “' || si.item_name || '”' AS why,
           round((similarity(lower(si.item_name), (SELECT nm FROM q)) * 0.95)::numeric, 2) AS conf
      FROM stock_items si
     WHERE si.ledger_category_id IS NOT NULL AND si.id IS DISTINCT FROM p_exclude_item
       AND length((SELECT nm FROM q)) >= 3
       AND lower(si.item_name) % (SELECT nm FROM q)
     ORDER BY si.ledger_category_id, similarity(lower(si.item_name), (SELECT nm FROM q)) DESC
  ),
  by_supplier AS (
    SELECT x.cat, 'supplier'::text,
           x.n || ' of ' || x.total || ' items from this supplier' AS why,
           round((0.55 * x.n / x.total)::numeric, 2) AS conf
      FROM (
        SELECT si.ledger_category_id AS cat, count(DISTINCT si.id) AS n,
               sum(count(DISTINCT si.id)) OVER () AS total
          FROM sourcing_bundles sb
          JOIN sourcing_bundle_items sbi ON sbi.bundle_id = sb.id
          JOIN order_items oi ON oi.id = sbi.order_item_id
          JOIN stock_items si ON si.id = oi.stock_item_id
         WHERE p_vendor IS NOT NULL AND sb.vendor_id = p_vendor AND si.ledger_category_id IS NOT NULL
           AND si.id IS DISTINCT FROM p_exclude_item
         GROUP BY si.ledger_category_id
      ) x
     WHERE x.total >= 3
  ),
  allv AS (
    SELECT * FROM by_item UNION ALL SELECT * FROM by_rule UNION ALL SELECT * FROM by_request
    UNION ALL SELECT * FROM by_similar UNION ALL SELECT * FROM by_supplier
  ),
  ranked AS (
    -- Best layer per ledger, plus 0.1 for each other layer that agrees.
    SELECT a.cat,
           (array_agg(a.src ORDER BY a.conf DESC))[1] AS src,
           (array_agg(a.why ORDER BY a.conf DESC))[1] AS why,
           LEAST(0.99, max(a.conf) + 0.1 * (count(*) - 1)) AS conf
      FROM allv a
     WHERE ledger_category_usable(a.cat)
     GROUP BY a.cat
  )
  SELECT r.cat, l.category_name, l.group_name, l.account_code, r.src, r.why,
         CASE WHEN r.src = 'item' THEN 1.0 ELSE round(r.conf, 2) END
    FROM ranked r CROSS JOIN LATERAL ledger_category_label(r.cat) l
   ORDER BY CASE WHEN r.src = 'item' THEN 1.0 ELSE r.conf END DESC
   LIMIT 3
$f$;

-- Suggestions for every line of an order whose item has no ledger yet.
CREATE OR REPLACE FUNCTION public.suggest_bundle_ledgers(p_bundle uuid)
RETURNS TABLE (bundle_item_id uuid, rank int, category_id uuid, category_name text, group_name text,
               account_code text, source text, reason text, confidence numeric)
LANGUAGE sql STABLE SET search_path TO public AS $f$
  SELECT sbi.id, (row_number() OVER (PARTITION BY sbi.id ORDER BY s.confidence DESC))::int,
         s.category_id, s.category_name, s.group_name, s.account_code, s.source, s.reason, s.confidence
    FROM sourcing_bundle_items sbi
    JOIN sourcing_bundles sb ON sb.id = sbi.bundle_id
    JOIN order_items oi ON oi.id = sbi.order_item_id
    LEFT JOIN stock_items si ON si.id = oi.stock_item_id
    LEFT JOIN sub_categories sc ON sc.id = oi.sub_category_id
    CROSS JOIN LATERAL suggest_item_ledgers(oi.item_name, oi.unit, sb.vendor_id,
                                            CASE WHEN ledger_category_usable(sc.parent_category_id) THEN sc.parent_category_id END,
                                            NULL) s
   WHERE sbi.bundle_id = p_bundle
     AND si.ledger_category_id IS NULL
$f$;

-- Layer 6: what was suggested and what was chosen.
CREATE TABLE IF NOT EXISTS public.ledger_suggestion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context text NOT NULL DEFAULT 'grn',
  ref_id uuid,
  stock_item_id uuid REFERENCES stock_items(id),
  item_name text,
  suggested_category_id uuid REFERENCES categories(id),
  suggested_source text,
  suggested_confidence numeric,
  chosen_category_id uuid REFERENCES categories(id),
  accepted boolean GENERATED ALWAYS AS (suggested_category_id IS NOT NULL AND suggested_category_id = chosen_category_id) STORED,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ledger_suggestion_log ENABLE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'ledger_suggestion_log insert' AND polrelid = 'ledger_suggestion_log'::regclass) THEN
    CREATE POLICY "ledger_suggestion_log insert" ON public.ledger_suggestion_log FOR INSERT TO authenticated WITH CHECK (created_by = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'ledger_suggestion_log read' AND polrelid = 'ledger_suggestion_log'::regclass) THEN
    CREATE POLICY "ledger_suggestion_log read" ON public.ledger_suggestion_log FOR SELECT TO authenticated USING (true);
  END IF;
END $p$;
GRANT SELECT, INSERT ON public.ledger_suggestion_log TO authenticated;

-- Items whose ledger finance has not confirmed and whose name or look-alikes
-- point somewhere else.
CREATE OR REPLACE FUNCTION public.item_ledger_second_opinion()
RETURNS TABLE (stock_item_id uuid, category_id uuid, category_name text, group_name text,
               source text, reason text, confidence numeric)
LANGUAGE sql STABLE SET search_path TO public AS $f$
  SELECT si.id, s.category_id, s.category_name, s.group_name, s.source, s.reason, s.confidence
    FROM stock_items si
    CROSS JOIN LATERAL (
      SELECT * FROM suggest_item_ledgers(si.item_name, NULL, NULL, NULL, si.id) x
       WHERE x.source IN ('rule', 'similar') ORDER BY x.confidence DESC LIMIT 1
    ) s
   WHERE si.ledger_category_id IS NOT NULL
     AND si.ledger_source IS DISTINCT FROM 'finance'
     AND s.category_id IS DISTINCT FROM si.ledger_category_id
     AND s.confidence >= 0.6
$f$;

GRANT EXECUTE ON FUNCTION public.ledger_category_label(uuid), public.suggest_item_ledgers(text, text, uuid, uuid, uuid),
  public.suggest_bundle_ledgers(uuid), public.item_ledger_second_opinion() TO authenticated;

-- Name rules, tightened after trying the suggester: "roller" alone caught
-- aluminium sliding-window rollers as site consumables (paint rollers only
-- now), and showers, siphons, WCs, P-traps and hand-wash fittings are
-- plumbing.
CREATE OR REPLACE FUNCTION public.ledger_category_for_name(p_name text, p_is_tool boolean DEFAULT false)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO public AS $f$
  SELECT id FROM categories WHERE category_name = (
    CASE
      WHEN p_name ~* '(pressure switch|carbon brush|spare part)' THEN 'Workshop Overhead'
      WHEN p_name ~* '(hard ?disk|\mhdd\M|\mssd\M|flash ?disk)' THEN 'Office Supplies'
      WHEN p_name ~* 'zipper' THEN 'Fabric'
      WHEN p_name ~* 'measuring tape' THEN 'Small Tools'
      WHEN p_name ~* '(sliding roller|s\.roller|window roller|door roller)' THEN 'Aluminum'
      WHEN p_name ~* '(elbow|teflon|\mpvc\M|u ?pvc|robnato|\msink\M|faucet|\mpipe\M|valve|\mtap\M|shower|siphon|cifone|\mwc\M|p ?trap|hand ?wash)' THEN 'Sanitary Material'
      WHEN p_name ~* '(helmet|\mvest\M|glove|safety boot|goggle|\mmask\M|first aid)' THEN 'Safety Gear & First Aid'
      WHEN p_name ~* '(\mpen\M|\ma4\M|file box|printer|toner|metereziya)' THEN 'Office Supplies'
      WHEN p_name ~* '(\mdis[ck]\M|grinding|birchi[qk]o|sand ?paper|\mbrush|\mroll?o\M|paint ?roller|scotch|\mtape\M|staple wire|mekurecha|blade|\mbit\M|electrode|melach|milach|router face)' THEN 'Site Consumables'
      WHEN p_is_tool OR p_name ~* '(grinder|jigsaw|\mdrill\M|\msander\M|laser level|mortar mixer|\mrouter\M|charger|alen ?key|\mmeter\M|medosha)' THEN 'Small Tools'
      WHEN p_name ~* '(aluminu?i?um profile|teletafi)' THEN 'Aluminum'
      WHEN p_name ~* '(\msand\M|ashewa|aggregate|gravel)' THEN 'Building Materials'
    END)
$f$;

-- "s.roller" (SADOR Aluminium, a sliding-window roller) was put under site
-- consumables by the old rule.
UPDATE stock_items SET ledger_category_id = (SELECT id FROM categories WHERE category_name = 'Aluminum'), ledger_source = 'name', ledger_set_at = now()
 WHERE item_name = 's.roller' AND ledger_source = 'name';
