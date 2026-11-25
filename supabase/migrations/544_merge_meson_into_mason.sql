-- 544 — "meson" was mason misspelled: one trade, Mason
--
-- Workers and labour requests on "meson" move to "mason"; workers still
-- carrying meson's name (ድንጋይ ጠራቢ) take Mason's. Then "meson" is removed from
-- the trade list.

UPDATE public.staff s
   SET trade_tag = 'mason',
       codename_amharic = CASE WHEN btrim(s.codename_amharic) = btrim(o.codename_amharic) THEN n.codename_amharic ELSE s.codename_amharic END,
       codename_english = CASE WHEN btrim(s.codename_english) = btrim(o.codename_english) THEN n.codename_english ELSE s.codename_english END
  FROM public.tier2_trade_roster o, public.tier2_trade_roster n
 WHERE s.trade_tag = 'meson' AND o.trade_tag = 'meson' AND n.trade_tag = 'mason';

UPDATE public.candidates SET trade_tag = 'mason' WHERE trade_tag = 'meson';
UPDATE public.labor_requisitions SET trade_tag = 'mason' WHERE trade_tag = 'meson';

-- A crew request asking for both: one line, the two counts added.
UPDATE public.labour_day_request_lines k SET headcount = k.headcount + d.headcount
  FROM public.labour_day_request_lines d
 WHERE k.trade_tag = 'mason' AND d.trade_tag = 'meson' AND d.request_id = k.request_id;
DELETE FROM public.labour_day_request_lines d
 WHERE d.trade_tag = 'meson' AND EXISTS (SELECT 1 FROM public.labour_day_request_lines k WHERE k.request_id = d.request_id AND k.trade_tag = 'mason');
UPDATE public.labour_day_request_lines SET trade_tag = 'mason' WHERE trade_tag = 'meson';

DELETE FROM public.tier2_trade_roster WHERE trade_tag = 'meson';
