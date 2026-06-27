-- Add unique item_code to stock_items + per-category sequences

-- Sequences per category prefix
CREATE SEQUENCE IF NOT EXISTS stock_seq_ww;  -- wood_work
CREATE SEQUENCE IF NOT EXISTS stock_seq_el;  -- electrical
CREATE SEQUENCE IF NOT EXISTS stock_seq_pt;  -- painting
CREATE SEQUENCE IF NOT EXISTS stock_seq_hw;  -- hardware
CREATE SEQUENCE IF NOT EXISTS stock_seq_cm;  -- construction
CREATE SEQUENCE IF NOT EXISTS stock_seq_tl;  -- tools
CREATE SEQUENCE IF NOT EXISTS stock_seq_br;  -- booth_return
CREATE SEQUENCE IF NOT EXISTS stock_seq_stk; -- fallback

ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS item_code TEXT;

-- Generator function
CREATE OR REPLACE FUNCTION generate_stock_item_code()
RETURNS TRIGGER AS $$
DECLARE
  prefix TEXT;
  seq_name TEXT;
  seq_num BIGINT;
BEGIN
  prefix   := CASE NEW.main_category
    WHEN 'wood_work'    THEN 'WW'
    WHEN 'electrical'   THEN 'EL'
    WHEN 'painting'     THEN 'PT'
    WHEN 'hardware'     THEN 'HW'
    WHEN 'construction' THEN 'CM'
    WHEN 'tools'        THEN 'TL'
    WHEN 'booth_return' THEN 'BR'
    ELSE 'STK'
  END;
  seq_name := CASE NEW.main_category
    WHEN 'wood_work'    THEN 'stock_seq_ww'
    WHEN 'electrical'   THEN 'stock_seq_el'
    WHEN 'painting'     THEN 'stock_seq_pt'
    WHEN 'hardware'     THEN 'stock_seq_hw'
    WHEN 'construction' THEN 'stock_seq_cm'
    WHEN 'tools'        THEN 'stock_seq_tl'
    WHEN 'booth_return' THEN 'stock_seq_br'
    ELSE 'stock_seq_stk'
  END;
  seq_num := nextval(seq_name);
  NEW.item_code := prefix || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_item_code ON stock_items;
CREATE TRIGGER trg_stock_item_code
  BEFORE INSERT ON stock_items
  FOR EACH ROW
  WHEN (NEW.item_code IS NULL)
  EXECUTE FUNCTION generate_stock_item_code();

-- Backfill existing rows (ordered by main_category + created_at)
-- Uses a temporary per-category counter to keep codes deterministic
DO $$
DECLARE
  r         RECORD;
  prefix    TEXT;
  seq_name  TEXT;
  seq_num   BIGINT;
BEGIN
  FOR r IN
    SELECT id, main_category
    FROM   stock_items
    WHERE  item_code IS NULL
    ORDER  BY main_category, created_at, id
  LOOP
    prefix   := CASE r.main_category
      WHEN 'wood_work'    THEN 'WW'
      WHEN 'electrical'   THEN 'EL'
      WHEN 'painting'     THEN 'PT'
      WHEN 'hardware'     THEN 'HW'
      WHEN 'construction' THEN 'CM'
      WHEN 'tools'        THEN 'TL'
      WHEN 'booth_return' THEN 'BR'
      ELSE 'STK'
    END;
    seq_name := CASE r.main_category
      WHEN 'wood_work'    THEN 'stock_seq_ww'
      WHEN 'electrical'   THEN 'stock_seq_el'
      WHEN 'painting'     THEN 'stock_seq_pt'
      WHEN 'hardware'     THEN 'stock_seq_hw'
      WHEN 'construction' THEN 'stock_seq_cm'
      WHEN 'tools'        THEN 'stock_seq_tl'
      WHEN 'booth_return' THEN 'stock_seq_br'
      ELSE 'stock_seq_stk'
    END;
    seq_num := nextval(seq_name);
    UPDATE stock_items
    SET    item_code = prefix || '-' || LPAD(seq_num::TEXT, 3, '0')
    WHERE  id = r.id;
  END LOOP;
END $$;

-- Make item_code unique and not null after backfill
ALTER TABLE stock_items
  ALTER COLUMN item_code SET NOT NULL,
  ADD CONSTRAINT stock_items_item_code_key UNIQUE (item_code);
