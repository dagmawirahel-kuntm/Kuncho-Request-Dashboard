-- 173 — VRF Phase 2: VAT receipt line items + accumulation
--
-- A VRF engagement carries a proper VAT receipt whose lines each represent a
-- good or a service (with an accounting nature via its category), for an amount,
-- with any withholding. Recording those lines lets us see what a receipt claims
-- to represent and — across engagements — how much VRF has piled up for the same
-- good/service over a period.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS vrf_receipt_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vrf_id           uuid NOT NULL REFERENCES vendor_receipt_facilitation(id) ON DELETE CASCADE,
  item_description text,
  category_id      uuid REFERENCES categories(id),
  quantity         numeric(14,2),
  uom              text,
  amount           numeric(14,2) NOT NULL,
  wht_amount       numeric(14,2),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vrf_receipt_items_vrf ON vrf_receipt_items(vrf_id);
CREATE INDEX IF NOT EXISTS idx_vrf_receipt_items_category ON vrf_receipt_items(category_id);

ALTER TABLE vrf_receipt_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vrf_items_admin ON vrf_receipt_items;
CREATE POLICY vrf_items_admin ON vrf_receipt_items FOR ALL
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS vrf_items_executive ON vrf_receipt_items;
CREATE POLICY vrf_items_executive ON vrf_receipt_items FOR ALL
  USING (get_user_role() = 'executive') WITH CHECK (get_user_role() = 'executive');
DROP POLICY IF EXISTS vrf_items_finance_badge ON vrf_receipt_items;
CREATE POLICY vrf_items_finance_badge ON vrf_receipt_items FOR ALL
  USING (get_user_role() = 'finance' AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true))
  WITH CHECK (get_user_role() = 'finance' AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true));
GRANT SELECT, INSERT, UPDATE, DELETE ON vrf_receipt_items TO authenticated;

-- Accumulation per good/service per month, across all VRF engagements.
CREATE OR REPLACE VIEW v_vrf_item_accumulation
WITH (security_invoker = true) AS
SELECT
  date_trunc('month', f.trxn_date)::date AS period_month,
  i.category_id,
  COALESCE(c.category_name, 'Uncategorized') AS category_name,
  c.nature,
  COUNT(*)                 AS line_count,
  COUNT(DISTINCT i.vrf_id) AS vrf_count,
  SUM(i.amount)            AS total_amount,
  SUM(COALESCE(i.wht_amount,0)) AS total_wht
FROM vrf_receipt_items i
JOIN vendor_receipt_facilitation f ON f.id = i.vrf_id
LEFT JOIN categories c ON c.id = i.category_id
GROUP BY 1, 2, 3, 4;
GRANT SELECT ON v_vrf_item_accumulation TO authenticated;
