-- 450: A contract or proforma only hangs off its own client's opportunity.
--
-- Dashen Bank's EFF contract (KUN-CON-2026-39) was linked, in the contract
-- form, to "EFF 2026" — National Bank of Ethiopia's opportunity. Every deal
-- in v_sales_engagements is an opportunity with its newest contract, or a
-- contract with no opportunity, so Dashen's contract stopped being a deal of
-- its own: it vanished from EFF 2026's "who pays" list and NBE's row showed
-- Dashen's contract in place of NBE's.
--
--   1. Links to another client's opportunity are cleared (only that one).
--   2. A contract or proforma can no longer be linked to an opportunity of
--      another client. An opportunity still without a client (a prospect)
--      can be linked from anyone, as before.

SET search_path TO public;

-- ── 1. Clear the wrong links ────────────────────────────────────────────
UPDATE contracts k SET opportunity_id = NULL
  FROM opportunities o
 WHERE o.id = k.opportunity_id AND o.client_id IS NOT NULL AND o.client_id <> k.client_id;

UPDATE proformas p SET opportunity_id = NULL
  FROM opportunities o
 WHERE o.id = p.opportunity_id AND o.client_id IS NOT NULL AND o.client_id <> p.client_id;

-- ── 2. Keep them right ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION deal_opportunity_same_client() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_owner text;
BEGIN
  IF NEW.opportunity_id IS NULL THEN RETURN NEW; END IF;
  SELECT c.client_name INTO v_owner
    FROM opportunities o JOIN clients c ON c.id = o.client_id
   WHERE o.id = NEW.opportunity_id AND o.client_id <> NEW.client_id;
  IF FOUND THEN
    RAISE EXCEPTION 'That opportunity is %''s. Link this % to one of its own client''s opportunities, or to none.',
      trim(v_owner), CASE TG_TABLE_NAME WHEN 'contracts' THEN 'contract' ELSE 'proforma' END;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_contracts_opportunity_same_client
  BEFORE INSERT OR UPDATE OF opportunity_id, client_id ON contracts
  FOR EACH ROW EXECUTE FUNCTION deal_opportunity_same_client();

CREATE OR REPLACE TRIGGER trg_proformas_opportunity_same_client
  BEFORE INSERT OR UPDATE OF opportunity_id, client_id ON proformas
  FOR EACH ROW EXECUTE FUNCTION deal_opportunity_same_client();
