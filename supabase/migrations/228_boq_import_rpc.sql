-- PR 9a.5 group 1: create_boq_from_parsed_tree — the one new RPC this PR
-- adds. Takes a client-parsed BOQ tree (Excel import or manual entry) and
-- inserts it atomically as a draft BOQ.
--
-- Plain SECURITY INVOKER, not DEFINER: boqs_insert and boq_items_write's
-- existing RLS already grant admin/project_manager/operations_manager/
-- design/finance/procurement_officer legitimate insert rights on a fresh
-- draft BOQ (verified live against pg_policies before writing this), so
-- there is no privilege gap to close here the way there was for PR 9c's
-- derive trigger. No new SECURITY DEFINER surface, no NULL-guard needed.
--
-- Atomicity: every INSERT below runs inside this single function call, one
-- transaction. boq_items' existing shape-check constraint and cycle-
-- prevention trigger (both from PR 9a, untouched here) already reject a
-- malformed row outright -- that exception aborts the whole function, and
-- Postgres rolls back everything this call has done so far, including the
-- boqs row itself if this was a fresh create. No explicit rollback logic
-- needed; this is exactly what the mandatory pause-and-verify below is
-- meant to prove empirically, not just assert.

CREATE OR REPLACE FUNCTION create_boq_from_parsed_tree(
  p_project_id uuid,
  p_title text,
  p_tree jsonb,
  p_replace_boq_id uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_boq_id uuid;
  v_boq_project_id uuid;
  v_boq_status text;
  v_next_version int;
  v_node jsonb;
  v_client_key text;
  v_parent_client_key text;
  v_parent_id uuid;
  v_item_id uuid;
BEGIN
  IF p_tree IS NULL OR jsonb_typeof(p_tree) <> 'array' OR jsonb_array_length(p_tree) = 0 THEN
    RAISE EXCEPTION 'A non-empty tree is required';
  END IF;

  IF p_replace_boq_id IS NOT NULL THEN
    SELECT project_id, status INTO v_boq_project_id, v_boq_status
    FROM boqs WHERE id = p_replace_boq_id;

    IF v_boq_project_id IS NULL THEN
      RAISE EXCEPTION 'BOQ % not found', p_replace_boq_id;
    END IF;
    IF v_boq_project_id <> p_project_id THEN
      RAISE EXCEPTION 'BOQ % does not belong to project %', p_replace_boq_id, p_project_id;
    END IF;
    IF v_boq_status NOT IN ('draft', 'internal_review') THEN
      RAISE EXCEPTION 'Only a draft BOQ can be replaced by re-import; an approved BOQ can only be revised via change order';
    END IF;

    v_boq_id := p_replace_boq_id;
    DELETE FROM boq_items WHERE boq_id = v_boq_id;
    UPDATE boqs SET title = p_title, updated_at = now() WHERE id = v_boq_id;
  ELSE
    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
    FROM boqs WHERE project_id = p_project_id;

    INSERT INTO boqs (project_id, version_number, title, status, owner_pm_staff_id, created_by_staff_id)
    VALUES (p_project_id, v_next_version, p_title, 'draft', current_staff_id(), current_staff_id())
    RETURNING id INTO v_boq_id;
  END IF;

  CREATE TEMP TABLE _boq_import_key_map (client_key text PRIMARY KEY, item_id uuid NOT NULL) ON COMMIT DROP;

  FOR v_node IN SELECT * FROM jsonb_array_elements(p_tree)
  LOOP
    v_client_key := v_node->>'client_key';
    v_parent_client_key := v_node->>'parent_client_key';

    IF v_client_key IS NULL OR v_client_key = '' THEN
      RAISE EXCEPTION 'Every tree node needs a client_key';
    END IF;

    v_parent_id := NULL;
    IF v_parent_client_key IS NOT NULL THEN
      SELECT item_id INTO v_parent_id FROM _boq_import_key_map WHERE client_key = v_parent_client_key;
      IF v_parent_id IS NULL THEN
        RAISE EXCEPTION 'Node % references parent % which was not found earlier in the tree -- parents must precede their children', v_client_key, v_parent_client_key;
      END IF;
    END IF;

    INSERT INTO boq_items (
      boq_id, parent_item_id, display_order, node_type, name, notes,
      unit, quantity, unit_rate_etb, total_etb, is_priced_elsewhere
    ) VALUES (
      v_boq_id, v_parent_id, (v_node->>'display_order')::int, v_node->>'node_type', v_node->>'name', v_node->>'notes',
      v_node->>'unit', (v_node->>'quantity')::numeric, (v_node->>'unit_rate_etb')::numeric, (v_node->>'total_etb')::numeric,
      COALESCE((v_node->>'is_priced_elsewhere')::boolean, false)
    )
    RETURNING id INTO v_item_id;

    INSERT INTO _boq_import_key_map (client_key, item_id) VALUES (v_client_key, v_item_id);
  END LOOP;

  RETURN v_boq_id;
END;
$$ LANGUAGE plpgsql;
