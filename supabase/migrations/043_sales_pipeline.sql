-- ═══════════════════════════════════════════════════════════════
-- 043: Sales pipeline — invoice numbers, due/payment dates,
--      proformas table, proforma line items
-- ═══════════════════════════════════════════════════════════════

-- ── 1. New fields on sales ────────────────────────────────────────
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS due_date       DATE,
  ADD COLUMN IF NOT EXISTS payment_date  DATE,
  ADD COLUMN IF NOT EXISTS proforma_id   UUID;

-- Backfill invoice_number for all existing sales (INV-YYYY-NNN)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id,
           TO_CHAR(created_at, 'YYYY') AS yr,
           ROW_NUMBER() OVER (
             PARTITION BY TO_CHAR(created_at, 'YYYY')
             ORDER BY created_at, id
           ) AS rn
    FROM sales
    WHERE invoice_number IS NULL
  LOOP
    UPDATE sales
    SET invoice_number = 'INV-' || r.yr || '-' || LPAD(r.rn::TEXT, 3, '0')
    WHERE id = r.id;
  END LOOP;
END $$;

-- Auto-generate invoice_number on INSERT when not supplied
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
  yr       TEXT := TO_CHAR(NOW(), 'YYYY');
  next_seq INT;
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    SELECT COALESCE(MAX(
      CASE WHEN invoice_number ~ ('^INV-' || yr || '-\d+$')
           THEN CAST(SPLIT_PART(invoice_number, '-', 3) AS INT)
           ELSE 0
      END
    ), 0) + 1
    INTO next_seq FROM sales;
    NEW.invoice_number := 'INV-' || yr || '-' || LPAD(next_seq::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_invoice_number ON sales;
CREATE TRIGGER trg_generate_invoice_number
  BEFORE INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION generate_invoice_number();

-- ── 2. Proformas table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proformas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proforma_number  TEXT,
  client_id        UUID REFERENCES clients(id) ON DELETE SET NULL,
  project_id       UUID REFERENCES projects(id) ON DELETE SET NULL,
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  validity_days    INT DEFAULT 30,
  payment_terms    TEXT,
  notes            TEXT,
  subtotal         NUMERIC(12,2) DEFAULT 0,
  vat_amount       NUMERIC(12,2) DEFAULT 0,
  total            NUMERIC(12,2) DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','sent','accepted','converted','expired')),
  converted_sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES user_profiles(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-number proformas (PI-YYYY-NNN)
CREATE OR REPLACE FUNCTION generate_proforma_number()
RETURNS TRIGGER AS $$
DECLARE
  yr       TEXT := TO_CHAR(NOW(), 'YYYY');
  next_seq INT;
BEGIN
  IF NEW.proforma_number IS NULL OR NEW.proforma_number = '' THEN
    SELECT COALESCE(MAX(
      CASE WHEN proforma_number ~ ('^PI-' || yr || '-\d+$')
           THEN CAST(SPLIT_PART(proforma_number, '-', 3) AS INT)
           ELSE 0
      END
    ), 0) + 1
    INTO next_seq FROM proformas;
    NEW.proforma_number := 'PI-' || yr || '-' || LPAD(next_seq::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_proforma_number ON proformas;
CREATE TRIGGER trg_generate_proforma_number
  BEFORE INSERT ON proformas
  FOR EACH ROW EXECUTE FUNCTION generate_proforma_number();

-- ── 3. Proforma line items ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proforma_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proforma_id UUID NOT NULL REFERENCES proformas(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  qty         NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit        TEXT DEFAULT 'pcs',
  unit_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_rate    NUMERIC(5,4) DEFAULT 0.15,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. RLS ────────────────────────────────────────────────────────
ALTER TABLE proformas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE proforma_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proforma_admin"    ON proformas;
DROP POLICY IF EXISTS "proforma_manager"  ON proformas;
DROP POLICY IF EXISTS "proforma_finance"  ON proformas;
DROP POLICY IF EXISTS "proforma_staff"    ON proformas;

CREATE POLICY "proforma_admin"   ON proformas FOR ALL     USING (get_user_role() = 'admin');
CREATE POLICY "proforma_manager" ON proformas FOR ALL     USING (get_user_role() = 'manager');
CREATE POLICY "proforma_finance" ON proformas FOR SELECT  USING (get_user_role() IN ('finance','staff'));
CREATE POLICY "proforma_staff"   ON proformas FOR SELECT  USING (get_user_role() = 'staff');

DROP POLICY IF EXISTS "pi_admin"   ON proforma_items;
DROP POLICY IF EXISTS "pi_manager" ON proforma_items;
DROP POLICY IF EXISTS "pi_finance" ON proforma_items;

CREATE POLICY "pi_admin"   ON proforma_items FOR ALL    USING (get_user_role() = 'admin');
CREATE POLICY "pi_manager" ON proforma_items FOR ALL    USING (get_user_role() = 'manager');
CREATE POLICY "pi_finance" ON proforma_items FOR SELECT USING (get_user_role() IN ('finance','staff'));
