-- 543 — trades show their plain Amharic name, not a nickname
--
-- The trade list carried nicknames ("ሁሉን አዋቂ" for a general laborer, "ረዳት"
-- for a cleaner, "ለስላሳ እጅ" for a plasterer), and each new worker copied
-- their trade's nickname (183). Both now use the everyday word. A worker whose
-- name was changed by hand keeps it.

WITH m(trade_tag, old_name, new_name) AS (VALUES
  ('carpenter',          'የእንጨት ጌታ',     'አናጺ'),
  ('chiseler',           'ወቃሪ',          'ወቃሪ'),
  ('cleaner',            'ረዳት',          'ጽዳት ሠራተኛ'),
  ('electrician_helper', 'ብልጭታ',         'የኤሌክትሪክ ረዳት'),
  ('general_laborer',    'ሁሉን አዋቂ',      'ሁለገብ ሠራተኛ'),
  ('laborer',            'ላብአደር',        'የቀን ሠራተኛ'),
  ('mason',              'የመሠረት ድንጋይ',   'ግንበኛ'),
  ('meson',              'ድንጋይ ጠራቢ',     'ድንጋይ ጠራቢ'),
  ('painter',            'ቀለም አዋቂ',      'ቀለም ቀቢ'),
  ('plasterer',          'ለስላሳ እጅ',      'ልስን ሠራተኛ'),
  ('plumber_helper',     'ውሃ አዛዥ',       'የቧንቧ ረዳት'),
  ('putty_worker',       'የፑቲ ሠራተኛ ',    'የፑቲ ሠራተኛ'),
  ('steel_fixer',        'ብረት አጣፊ',      'ብረት አስሪ'),
  ('tile_setter',        'ሰቆ ደራቢ',       'ሴራሚክ ነጣፊ')
), r AS (
  UPDATE public.tier2_trade_roster t SET codename_amharic = m.new_name
    FROM m WHERE t.trade_tag = m.trade_tag AND t.codename_amharic IS DISTINCT FROM m.new_name
  RETURNING t.trade_tag
)
UPDATE public.staff s SET codename_amharic = m.new_name
  FROM m
 WHERE s.trade_tag = m.trade_tag AND btrim(s.codename_amharic) = btrim(m.old_name) AND s.codename_amharic IS DISTINCT FROM m.new_name;
