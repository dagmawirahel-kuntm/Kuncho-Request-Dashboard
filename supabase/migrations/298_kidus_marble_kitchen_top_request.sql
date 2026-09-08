-- 298 — urgent purchase request: Kidus Green Imported Marble kitchen top
--
-- Raised from a Kidus Granite & Marble proforma dated 07 Sep 2026 for the
-- kitchen top at Girma's Home. Entered here rather than through the form
-- because the proforma arrived as a photo.
--
-- What the proforma says, and what was checked against it:
--   10 cut pieces of Kidus Green imported marble, 2 cm thick, all at
--   28,000.00 ETB/m² (rate confirmed against lines 1, 4, 6, 9 and 10).
--   The 10 line extensions sum to 329,518.00, which is 11.7685 m² at that
--   rate. Cutting is a separate 9,000.00 lump sum. 329,518.00 + 9,000.00
--   = 338,518.00; VAT at 15% = 50,777.70; grand total 389,295.70 — the
--   figure printed on the proforma. The document is internally consistent.
--
-- The ten pieces are entered as one line carrying the total area, not ten
-- lines: the per-piece dimensions are on the proforma itself, and the rate
-- is uniform, so the aggregate carries the supplier's total without this
-- migration restating measurements it would be guessing at.
--
-- order_items.quantity is numeric(10,2), so 11.7685 m² stores as 11.77 and
-- the line estimate comes out 329,560.00 — 42.00 over the proforma. Kept
-- that way rather than backing into a fudged unit price: unit_price_est is
-- explicitly an estimate, but the rate is the negotiated fact, it is what
-- procurement bargains against, and auto_log_market_price_from_po copies it
-- into the market price history once a PO is approved. A wrong rate there
-- would outlive this request. The exact 329,518.00 is stated in the notes
-- and on the line's own specifications.
--
-- staff_id is the request's procurement officer — that is the column the
-- order form's "Assign Procurement Officer" field writes — so Mengistu
-- Gudeta goes there. requested_by_user_id is Natnael Yohannes Teshager.
--
-- recommended_vendor_id is left null: there is no Kidus Granite & Marble
-- vendor record, and creating one would mean inventing payment terms and
-- contacts the proforma does not carry. The supplier is named in
-- vendor_recommendation with its VAT number and phones so procurement can
-- register it properly when the request is approved.
--
-- required_by_date is 10 Sep 2026 — the proforma's own 3-day validity, not
-- a delivery date. The supplier quotes 5 working days to deliver in Addis
-- Ababa after the order is placed. The validity is what makes this urgent:
-- past it the 28,000/m² rate is no longer held.

DO $$
DECLARE
  v_order_id uuid;
  v_items    integer;
BEGIN
  INSERT INTO orders (
    order_name, order_date, required_by_date, priority, status, approval_status,
    project_id, staff_id, requested_by_user_id,
    item_service_description, vendor_recommendation, is_new_item, notes
  ) VALUES (
    'Kitchen Top — Kidus Green Imported Marble',
    DATE '2026-09-08',
    DATE '2026-09-10',
    'urgent',
    'pending',
    'pending',
    'bba28280-a6b1-4920-b91a-f9cfa6c73d59',  -- Girma's Home
    'cdb37c8b-8e7f-4858-a8a1-03e294c7b054',  -- Mengistu Gudeta, procurement officer
    '5acb69b8-5d1e-420b-86fb-59b952697f0a',  -- Natnael Yohannes Teshager, requested by
    'Kidus Green imported marble kitchen top — 10 cut pieces, 2 cm thick, '
      || '11.7685 m² total, plus cutting.',
    'Kidus Granite & Marble — proforma 07 Sep 2026. VAT 0106238276. '
      || 'Urael branch, 0911531668 / 0911727638. Attn: Selam (prepared), '
      || 'Hiwot Tafese, Sales Manager (approved). No vendor record yet.',
    true,
    'From the Kidus Granite & Marble proforma dated 07 Sep 2026, addressed to '
      || '"Ato Nati" (0911465435).' || chr(10) || chr(10)
      || 'Material: Kidus Green imported marble, polished, 2 cm thick, cut to '
      || '10 pieces for the kitchen top. Per-piece dimensions are on the '
      || 'proforma; they total 11.7685 m² at a uniform 28,000.00 ETB/m².'
      || chr(10) || chr(10)
      || 'Marble        11.7685 m² x 28,000.00 = 329,518.00' || chr(10)
      || 'Cutting                    lump sum =   9,000.00' || chr(10)
      || 'Subtotal                             = 338,518.00' || chr(10)
      || 'VAT 15%                              =  50,777.70' || chr(10)
      || 'Grand total                          = 389,295.70' || chr(10) || chr(10)
      || 'Validity: 3 days from 07 Sep 2026 — the rate is not held past '
      || '10 Sep. Delivery: 5 working days, Addis Ababa. Estimates on the '
      || 'line items are VAT-exclusive, as the proforma states them.'
  )
  RETURNING id INTO v_order_id;

  INSERT INTO order_items (
    order_id, item_name, specifications, quantity, unit, unit_price_est,
    status, sort_order
  ) VALUES
    (v_order_id,
     'Kidus Green Imported Marble — kitchen top',
     '10 pieces cut to size, polished, 2 cm thick. 11.7685 m² total across '
       || 'the ten pieces, all at the proforma rate of 28,000.00 ETB/m², for '
       || '329,518.00. The quantity column holds two decimals, so it shows '
       || '11.77 m² and the line estimate reads 329,560.00 — 42.00 above the '
       || 'proforma. The rate is the exact figure; the 329,518.00 in the '
       || 'notes is the one to pay against.',
     11.7685, 'm2', 28000.00, 'pending', 0),
    (v_order_id,
     'Marble cutting',
     'Cutting charge for the ten pieces above — lump sum on the proforma, '
       || 'not a per-m² rate.',
     1, 'service', 9000.00, 'pending', 1);

  GET DIAGNOSTICS v_items = ROW_COUNT;
  IF v_items <> 2 THEN
    RAISE EXCEPTION 'expected 2 order_items, inserted %', v_items;
  END IF;

  RAISE NOTICE 'created order % (%)', v_order_id,
    (SELECT request_code FROM orders WHERE id = v_order_id);
END $$;
