-- 473: Roles in Amharic — every role says what it asks of people in both
-- languages.
--
-- 457 gave roles and levels an Amharic title, but everything a person is
-- actually held to — what the job is for, what each level does, the skills,
-- duties and measures — was English only, and half the role names had no
-- Amharic. Many of the people the job descriptions are handed to read
-- Amharic first.
--
--   • job_descriptions.role_overview_am, reports_to_am
--   • role_levels.summary_am
--   • key_responsibilities.detail_am (title_am exists since 457)
--   • Amharic for the agreed catalogue: role names and level titles still
--     missing, every purpose, level summary, skill, duty and measure.
--     Matched on the English words and written only where the Amharic is
--     empty, so nothing typed since is overwritten. Department heads check
--     the wording when they confirm their roles.

SET search_path TO public;

ALTER TABLE job_descriptions
  ADD COLUMN IF NOT EXISTS role_overview_am text,
  ADD COLUMN IF NOT EXISTS reports_to_am text;
ALTER TABLE role_levels
  ADD COLUMN IF NOT EXISTS summary_am text;
ALTER TABLE key_responsibilities
  ADD COLUMN IF NOT EXISTS detail_am text;

-- ── Role names ───────────────────────────────────────────────────────────
UPDATE job_descriptions j SET role_name_am = v.am
  FROM (VALUES
    ('Plasterer', 'ልስን ሰሪ'),
    ('Chiseler', 'ፈልፋይ'),
    ('Project Manager', 'የፕሮጀክት ማኔጀር'),
    ('Designer', 'ዲዛይነር'),
    ('Finance Officer', 'የፋይናንስ ኦፊሰር'),
    ('Procurement Officer', 'የግዢ ኦፊሰር'),
    ('Stock Manager', 'የስቶክ ማኔጀር'),
    ('HR Officer', 'የሰው ሃብት ኦፊሰር'),
    ('HSE Officer', 'የደህንነት ኦፊሰር'),
    ('Business Development', 'ቢዝነስ ዴቨሎፕመንት')
  ) v(en, am)
 WHERE j.role_name = v.en AND j.role_name_am IS NULL;

-- ── Level titles ─────────────────────────────────────────────────────────
UPDATE role_levels l SET title_am = v.am
  FROM job_descriptions j, (VALUES
    ('Plasterer', 1, 'ረዳት ልስን ሰሪ'),
    ('Plasterer', 2, 'ልስን ሰሪ'),
    ('Plasterer', 3, 'ዋና ልስን ሰሪ'),
    ('Chiseler', 1, 'ፈልፋይ'),
    ('Chiseler', 2, 'ልምድ ያለው ፈልፋይ'),
    ('Chiseler', 3, 'ዋና ፈልፋይ')
  ) v(role, lvl, am)
 WHERE j.id = l.job_description_id AND j.role_name = v.role AND l.level = v.lvl AND l.title_am IS NULL;

-- ── What each role is for ────────────────────────────────────────────────
UPDATE job_descriptions j SET role_overview_am = v.am
  FROM (VALUES
    ('Carpenter', 'በስራ ስዕሉ መሰረት በትዕዛዝ የሚሰሩ የቤት እቃዎችን፣ ካቢኔቶችንና የእንጨት ስራዎችን ይሰራል፣ ይገጣጥማል፣ ቦታው ላይ ይገጥማል።'),
    ('Painter & finisher', 'በሳይትና በቤት እቃዎች ላይ ገጽታዎችን ያዘጋጃል፤ ቀለም፣ ላከርና ማጠናቀቂያ ይቀባል።'),
    ('Upholstery & leather', 'የቤት እቃዎችን — ሶፋዎችን፣ ወንበሮችንና የአልጋ ራስጌዎችን — ስፖንጅ ሞልቶ በጨርቅና በቆዳ ይለብጣል።'),
    ('CNC operator', 'ፓነሎችንና ክፍሎችን ከስዕሉ በትክክል ለመቁረጥ የሲኤንሲ ማሽኑን ያንቀሳቅሳል።'),
    ('Electrician', 'በሳይት የኤሌክትሪክ ስራዎችን ይዘረጋል፣ ይፈትሻል።'),
    ('Mason', 'በስዕሉ መሰረት የብሎኬት ግድግዳዎችንና የበር/የመስኮት ክፍተቶችን ይገነባል።'),
    ('Plasterer', 'ግድግዳዎችንና ኮርኒሶችን ቀጥ ያለና ለስላሳ አድርጎ ይለስናል።'),
    ('Chiseler', 'ለኤሌክትሪክና ለቧንቧ መስመሮች በግድግዳና በወለል ላይ ቦይ ይፈለፍላል።'),
    ('Tiler', 'የግድግዳና የወለል ሴራሚኮችን በሌቭልና በእኩል መጋጠሚያ ያነጥፋል።'),
    ('Labourer & cleaner', 'ቁሳቁሶችን ያጓጉዛል፣ ባለሙያዎችን ይረዳል፣ ሳይቱን ንጹህ ያደርጋል።'),
    ('Site foreman', 'የሳይቱን የዕለት ተዕለት ስራ ይመራል፦ ሰራተኞችን፣ ቁሳቁሶችን፣ የስራ ሂደቱንና ደህንነትን።'),
    ('Driver', 'እቃዎችንና ሰዎችን በጥንቃቄ ያጓጉዛል፤ ተሽከርካሪውንና ሰነዶቹን በስርዓት ይይዛል።'),
    ('Project Manager', 'ለፕሮጀክቱ በጀት፣ የስራ ሂደትና የደረጃ ፍተሻዎች (ስቴጅ ጌት) ኃላፊነት ይወስዳል።'),
    ('Designer', 'ሊሰሩ የሚችሉ ስዕሎችንና የቤት እቃዎች ዝርዝር መግለጫዎችን (FF&E) ያዘጋጃል።'),
    ('Finance Officer', 'ክፍያዎችን ያጸድቃል፣ ይከፍላል፣ ያስታርቃል፤ የሂሳብ መዝገቡ ትክክለኛ እንዲሆን ያደርጋል።'),
    ('Procurement Officer', 'አቅራቢዎችን ያፈላልጋል፣ የግዢ ትዕዛዞችን ያወጣል፤ የአቅራቢዎች መረጃ ትክክለኛ መሆኑን ይጠብቃል።'),
    ('Stock Manager', 'ቁሳቁሶችን ይረከባል፣ ይመዘግባል፣ ወጪ ያደርጋል።'),
    ('HR Officer', 'አዳዲስ ሰራተኞችን ይቀበላል፤ የሰራተኞች መረጃ ወቅታዊ እንዲሆን ያደርጋል።'),
    ('HSE Officer', 'የደህንነት ገለጻዎች (ኢንዳክሽን) ወቅታዊ እንዲሆኑና የተከሰቱ አደጋዎች እንዲዘጉ ያደርጋል።'),
    ('Business Development', 'የስራ እድሎችን ወደ ተሟሉና በትክክል ወደተዘጋጁ ውሎች ይቀይራል።')
  ) v(en, am)
 WHERE j.role_name = v.en AND j.role_overview_am IS NULL;

-- ── Reports to ───────────────────────────────────────────────────────────
UPDATE job_descriptions j SET reports_to_am = v.am
  FROM (VALUES
    ('Lead carpenter / Operations', 'ዋና አናጢ / ኦፕሬሽን'),
    ('Lead painter / Site foreman', 'ዋና ቀለም ቀቢ / ፎርማን'),
    ('Lead upholsterer / Operations', 'ዋና ሶፋ ሰሪ / ኦፕሬሽን'),
    ('Workshop lead / Operations', 'የወርክሾፕ ኃላፊ / ኦፕሬሽን'),
    ('Site foreman', 'ፎርማን'),
    ('Project manager', 'የፕሮጀክት ማኔጀር'),
    ('Procurement & Logistics', 'ግዢና ሎጂስቲክስ')
  ) v(en, am)
 WHERE j.reports_to = v.en AND j.reports_to_am IS NULL;

-- ── What each level does ─────────────────────────────────────────────────
UPDATE role_levels l SET summary_am = v.am
  FROM (VALUES
    ('Works under a carpenter; prepares and cuts parts.', 'በአናጢ ስር ይሰራል፤ ክፍሎችን ያዘጋጃል፣ ይቆርጣል።'),
    ('Builds and installs pieces from drawings on their own.', 'ከስዕል በመነሳት እቃዎችን ራሱን ችሎ ይሰራል፣ ይገጥማል።'),
    ('Plans jobs, checks others’ work and trains.', 'ስራዎችን ያቅዳል፣ የሌሎችን ስራ ይፈትሻል፣ ያሰለጥናል።'),
    ('Prepares surfaces and mixes materials.', 'ገጽታዎችን ያዘጋጃል፣ ቁሳቁሶችን ያቀላቅላል።'),
    ('Applies finishes evenly on their own.', 'ማጠናቀቂያ ቀለሞችን ራሱን ችሎ እኩል ይቀባል።'),
    ('Colour work, spray booth, quality and training.', 'የቀለም ማዛመድ፣ የስፕሬይ ክፍል፣ ጥራትና ስልጠና።'),
    ('Prepares frames, foam and simple stitching.', 'ፍሬሞችንና ስፖንጅ ያዘጋጃል፤ ቀላል ስፌት ይሰፋል።'),
    ('Patterns, cuts and covers pieces on their own.', 'ራሱን ችሎ ልክ ያወጣል፣ ይቆርጣል፣ ይለብጣል።'),
    ('Custom work, costing and training.', 'ልዩ ትዕዛዝ ስራዎች፣ የወጪ ግምትና ስልጠና።'),
    ('Runs prepared programs safely.', 'የተዘጋጁ ፕሮግራሞችን በጥንቃቄ ያስኬዳል።'),
    ('Prepares toolpaths and nests parts.', 'የመቁረጫ መንገዶችን (ቱልፓዝ) ያዘጋጃል፤ ክፍሎችን በሉሁ ላይ ያደራጃል።'),
    ('Maintains the machine, optimises and trains.', 'ማሽኑን ይንከባከባል፣ ስራውን ያሻሽላል፣ ያሰለጥናል።'),
    ('Conduit, boxes and cable pulling.', 'ቱቦ (ኮንዲዩት)፣ ሳጥኖችና ገመድ መሳብ።'),
    ('Wires and tests circuits on their own.', 'ሰርኪቶችን ራሱን ችሎ ያገናኛል፣ ይፈትሻል።'),
    ('Plans circuits, commissions and supervises.', 'ሰርኪቶችን ያቅዳል፣ ስራ ያስጀምራል፣ ይቆጣጠራል።'),
    ('Mixes mortar and lays under guidance.', 'ሞርታር ያቀላቅላል፤ በመመሪያ ስር ብሎኬት ይደረድራል።'),
    ('Lays walls plumb and level on their own.', 'ግድግዳዎችን ራሱን ችሎ ቀጥና በሌቭል ይገነባል።'),
    ('Leads a gang, estimates and checks.', 'ቡድን ይመራል፣ ይገምታል፣ ይፈትሻል።'),
    ('Prepares surfaces and mixes plaster.', 'ገጽታዎችን ያዘጋጃል፣ ልስን ያቀላቅላል።'),
    ('Plasters flat to a straight edge on their own.', 'በቀጥተኛ መለኪያ ራሱን ችሎ ቀጥ አድርጎ ይለስናል።'),
    ('Gypsum and decorative work, leads a gang.', 'የጂፕሰምና የጌጥ ስራዎች፤ ቡድን ይመራል።'),
    ('Cuts marked chases safely.', 'ምልክት የተደረገባቸውን ቦዮች በጥንቃቄ ይፈለፍላል።'),
    ('Cuts to depth and line, makes good.', 'በትክክለኛ ጥልቀትና መስመር ይፈለፍላል፤ መልሶ ያስተካክላል።'),
    ('Marks routes from the layout, leads.', 'ከንድፉ መስመሮችን ምልክት ያደርጋል፤ ይመራል።'),
    ('Prepares surfaces, mixes and cuts.', 'ገጽታዎችን ያዘጋጃል፣ ማጣበቂያ ያቀላቅላል፣ ይቆርጣል።'),
    ('Sets and grouts tiles on their own.', 'ሴራሚኮችን ራሱን ችሎ ያነጥፋል፣ መጋጠሚያዎቹን ይሞላል።'),
    ('Patterns, large format, waterproofing.', 'ንድፍ ያላቸው ስራዎች፣ ትልልቅ ሴራሚኮች፣ ውሃ መከላከያ።'),
    ('Carries materials and cleans.', 'ቁሳቁሶችን ይሸከማል፣ ያጸዳል።'),
    ('Assists the trades and does handover cleaning.', 'ባለሙያዎችን ይረዳል፤ የርክክብ ጽዳት ይሰራል።'),
    ('Leads a gang and organises material movement.', 'ቡድን ይመራል፤ የቁሳቁስ እንቅስቃሴን ያደራጃል።'),
    ('Runs a site.', 'ሳይት ይመራል።'),
    ('Drives and delivers.', 'ያሽከረክራል፣ ያደርሳል።')
  ) v(en, am)
 WHERE l.summary = v.en AND l.summary_am IS NULL;

-- ── Skills, duties and measures ──────────────────────────────────────────
UPDATE key_responsibilities k SET title_am = v.am
  FROM (VALUES
    -- Carpenter
    ('Measures and marks cuts from a cutting list', 'ከመቁረጫ ዝርዝሩ ልኬት ወስዶ የሚቆረጠውን ምልክት ያደርጋል'),
    ('Runs the panel saw, edge bander and drill safely', 'የፓነል መጋዝን፣ የጠርዝ መለጠፊያን (ኤጅ ባንደር) እና መሰርሰሪያን በጥንቃቄ ይጠቀማል'),
    ('Sands and prepares parts for finishing', 'ክፍሎችን በአሸዋ ወረቀት ያለሰልሳል፤ ለቀለም ያዘጋጃል'),
    ('Keeps tools and bench clean; follows workshop safety', 'መሳሪያዎችንና የስራ ጠረጴዛውን ንጹህ ያደርጋል፤ የወርክሾፕ ደህንነት ደንቦችን ይከተላል'),
    ('Reads shop drawings and works out the cutting list', 'የስራ ስዕሎችን ያነባል፤ የመቁረጫ ዝርዝሩን ያወጣል'),
    ('Joinery: dowel, mortise and tenon, biscuit, knock-down fittings', 'መገጣጠሚያዎች፦ ዶዌል፣ ሞርቲስና ቴነን፣ ቢስኩት፣ የሚፈታቱ ፊቲንጎች'),
    ('Assembles carcasses square and true', 'የካቢኔ አካላትን በትክክለኛ ማዕዘንና ቀጥ አድርጎ ይገጣጥማል'),
    ('Fits hinges, runners, handles and locks', 'ማጠፊያዎችን፣ የመሳቢያ ሀዲዶችን፣ እጀታዎችንና ቁልፎችን ይገጥማል'),
    ('Installs on site: levels, scribes to walls, fixes to wall and floor', 'በሳይት ይገጥማል፦ በሌቭል ያስተካክላል፣ ከግድግዳ ጋር ያጣጥማል፣ በግድግዳና በወለል ላይ ያጠብቃል'),
    ('Plans a job’s sequence and materials; flags drawing problems before cutting', 'የስራውን ቅደም ተከተልና ቁሳቁስ ያቅዳል፤ ከመቁረጥ በፊት የስዕል ችግሮችን ያሳውቃል'),
    ('Solid wood, veneer, curved and custom pieces', 'የጠጣር እንጨት፣ የቬኒየር፣ የተጠማዘዙና ልዩ ትዕዛዝ እቃዎች'),
    ('Checks work against the drawing before it leaves the workshop', 'ስራው ከወርክሾፕ ከመውጣቱ በፊት ከስዕሉ ጋር ያመሳክራል'),
    ('Trains assistant carpenters', 'ረዳት አናጢዎችን ያሰለጥናል'),
    -- Painter & finisher
    ('Surface prep: sanding, filling, masking', 'የገጽታ ዝግጅት፦ ማለስለስ፣ መሙላት፣ መሸፈን (ማስኪንግ)'),
    ('Mixes paint and lacquer to the right ratio', 'ቀለምና ላከርን በትክክለኛው መጠን ያቀላቅላል'),
    ('Cleans tools and protects floors and fittings', 'መሳሪያዎችን ያጸዳል፤ ወለሎችንና የተገጠሙ እቃዎችን ይከላከላል'),
    ('Applies primer and coats evenly by brush and roller', 'ፕራይመርንና ቀለምን በብሩሽና በሮለር እኩል ይቀባል'),
    ('Putty and skim coat to a smooth, flat finish', 'ፑቲና ስኪም ኮት ቀብቶ ለስላሳና ቀጥ ያለ ገጽታ ያወጣል'),
    ('Spray-applies lacquer / PU on furniture without runs', 'ላከር / ፒዩ በቤት እቃዎች ላይ ሳይፈስ በስፕሬይ ይቀባል'),
    ('Colour matching, stains and special finishes', 'ቀለም ማዛመድ፣ ስቴይንና ልዩ ማጠናቀቂያዎች'),
    ('Sets up the spray booth and maintains the gun', 'የስፕሬይ ክፍሉን ያዘጋጃል፤ የስፕሬይ መሳሪያውን ይንከባከባል'),
    ('Checks finish quality and trains painters', 'የማጠናቀቂያ ጥራትን ይፈትሻል፤ ቀለም ቀቢዎችን ያሰለጥናል'),
    -- Upholstery & leather
    ('Strips old covers and prepares frames', 'አሮጌ ልባሶችን ያነሳል፤ ፍሬሞችን ያዘጋጃል'),
    ('Cuts foam and padding to template', 'ስፖንጅና ሙሌትን በቅጹ (ቴምፕሌት) መሰረት ይቆርጣል'),
    ('Basic hand stitching', 'መሰረታዊ የእጅ ስፌት'),
    ('Patterns and cuts fabric and leather with little waste', 'ጨርቅና ቆዳን በትንሽ ብክነት ልክ አውጥቶ ይቆርጣል'),
    ('Machine stitching and piping', 'የማሽን ስፌትና የጠርዝ ስራ (ፓይፒንግ)'),
    ('Covers seats, backs and headboards with tight, even tension', 'መቀመጫዎችን፣ መደገፊያዎችንና የአልጋ ራስጌዎችን ጥብቅና እኩል አድርጎ ይለብጣል'),
    ('Buttoning, tufting, channels and custom shapes', 'ቁልፍ መስፋት፣ ታፍቲንግ፣ ቻናሎችና ልዩ ቅርጾች'),
    ('Works out the material a piece needs', 'አንድ እቃ የሚያስፈልገውን ቁሳቁስ ያሰላል'),
    ('Trains upholsterers', 'ሶፋ ሰሪዎችን ያሰለጥናል'),
    -- CNC operator
    ('Loads sheets, sets zero and runs a prepared program', 'ሉሆችን ይጭናል፣ ዜሮ ያስተካክላል፣ የተዘጋጀ ፕሮግራም ያስኬዳል'),
    ('Changes and checks tools', 'መቁረጫዎችን ይቀይራል፣ ይፈትሻል'),
    ('Daily machine cleaning and safety checks', 'የዕለት የማሽን ጽዳትና የደህንነት ፍተሻ'),
    ('Prepares toolpaths from drawings (CAM)', 'ከስዕሎች የመቁረጫ መንገዶችን (ቱልፓዝ) ያዘጋጃል (CAM)'),
    ('Nests parts to cut waste', 'ብክነትን ለመቀነስ ክፍሎችን በሉሁ ላይ ያደራጃል'),
    ('Labels parts for assembly', 'ለመገጣጠም ክፍሎችን ምልክት (ሌብል) ያደርጋል'),
    ('Troubleshoots and maintains the machine', 'የማሽኑን ችግሮች ይለያል፤ ማሽኑን ይንከባከባል'),
    ('Sets feeds and speeds for each material', 'ለእያንዳንዱ ቁሳቁስ የፍጥነትና የፊድ መጠን ያስተካክላል'),
    ('Trains operators', 'ኦፕሬተሮችን ያሰለጥናል'),
    -- Electrician
    ('Fixes conduit and boxes to line and level', 'ቱቦዎችንና ሳጥኖችን በመስመርና በሌቭል ይገጥማል'),
    ('Pulls cable without damage', 'ገመድ ሳይጎዳ ይስባል'),
    ('Isolates power safely before work', 'ከስራ በፊት ኃይልን በጥንቃቄ ያቋርጣል'),
    ('Wires sockets, switches, lights and distribution boards', 'ሶኬቶችን፣ ማብሪያ ማጥፊያዎችን፣ መብራቶችንና የማከፋፈያ ሰሌዳዎችን ያገናኛል'),
    ('Tests circuits: continuity and insulation', 'ሰርኪቶችን ይፈትሻል፦ ቀጣይነትና ኢንሱሌሽን'),
    ('Reads electrical drawings', 'የኤሌክትሪክ ስዕሎችን ያነባል'),
    ('Plans small circuits and balances loads', 'አነስተኛ ሰርኪቶችን ያቅዳል፤ ጭነትን ያመጣጥናል'),
    ('Commissions and hands over with a test record', 'ስራውን ያስጀምራል፤ ከፍተሻ መዝገብ ጋር ያስረክባል'),
    ('Supervises helpers', 'ረዳቶችን ይቆጣጠራል'),
    -- Mason
    ('Mixes mortar to the right mix', 'ሞርታርን በትክክለኛው ቅልቅል ያዘጋጃል'),
    ('Carries, stacks and lays blocks under guidance', 'በመመሪያ ስር ብሎኬቶችን ይሸከማል፣ ይደረድራል፣ ይገነባል'),
    ('Sets out walls from the drawing', 'ከስዕሉ በመነሳት የግድግዳዎችን ቦታ ያወጣል'),
    ('Lays block walls plumb, level and in line', 'የብሎኬት ግድግዳዎችን ቀጥ፣ በሌቭልና በመስመር ይገነባል'),
    ('Forms openings and lintels', 'የበርና የመስኮት ክፍተቶችንና ሊንተሎችን ይሰራል'),
    ('Estimates blocks, cement and sand for a wall', 'ለአንድ ግድግዳ የሚያስፈልገውን ብሎኬት፣ ሲሚንቶና አሸዋ ይገምታል'),
    ('Leads a gang and checks their work', 'ቡድን ይመራል፤ ስራቸውን ይፈትሻል'),
    -- Plasterer
    ('Prepares and wets surfaces', 'ገጽታዎችን ያዘጋጃል፣ ውሃ ያርሳል'),
    ('Mixes plaster to the right mix', 'ልስንን በትክክለኛው ቅልቅል ያዘጋጃል'),
    ('Plasters walls and ceilings flat to a straight edge', 'ግድግዳዎችንና ኮርኒሶችን በቀጥተኛ መለኪያ ቀጥ አድርጎ ይለስናል'),
    ('Forms corners and fixes beads', 'ማዕዘኖችን ይሰራል፤ የማዕዘን ብረቶችን (ቢድ) ይገጥማል'),
    ('Gypsum and decorative plaster work', 'የጂፕሰምና የጌጥ ልስን ስራ'),
    ('Leads a gang and checks flatness', 'ቡድን ይመራል፤ የገጽታውን ቀጥተኝነት ይፈትሻል'),
    -- Chiseler
    ('Cuts marked chases with power tools safely', 'ምልክት የተደረገባቸውን ቦዮች በኤሌክትሪክ መሳሪያዎች በጥንቃቄ ይፈለፍላል'),
    ('Uses dust and eye protection', 'የአቧራና የዓይን መከላከያ ይጠቀማል'),
    ('Cuts to depth and line without damaging the wall', 'ግድግዳውን ሳይጎዳ በትክክለኛ ጥልቀትና መስመር ይፈለፍላል'),
    ('Makes good after services are in', 'መስመሮቹ ከገቡ በኋላ ቦታውን መልሶ ይጠግናል'),
    ('Marks routes from the electrical / plumbing layout', 'ከኤሌክትሪክ / ቧንቧ ንድፉ መስመሮችን ምልክት ያደርጋል'),
    ('Leads a gang', 'ቡድን ይመራል'),
    -- Tiler
    ('Prepares surfaces and mixes adhesive', 'ገጽታዎችን ያዘጋጃል፤ ማጣበቂያ ያቀላቅላል'),
    ('Cuts tiles cleanly', 'ሴራሚኮችን በንጽህና ይቆርጣል'),
    ('Sets wall and floor tiles level with even joints', 'የግድግዳና የወለል ሴራሚኮችን በሌቭልና በእኩል መጋጠሚያ ያነጥፋል'),
    ('Grouts and cleans to a finish', 'መጋጠሚያዎቹን ይሞላል (ግራውት)፤ አጽድቶ ያጠናቅቃል'),
    ('Patterns and large-format tiles', 'ንድፍ ያላቸውና ትልልቅ ሴራሚኮች'),
    ('Waterproofing in wet areas', 'እርጥብ ቦታዎችን ውሃ እንዳያሳልፉ ማድረግ (ዋተርፕሩፊንግ)'),
    -- Labourer & cleaner
    ('Carries and stacks materials safely', 'ቁሳቁሶችን በጥንቃቄ ይሸከማል፣ ይደረድራል'),
    ('Keeps the site clean and clear every day', 'ሳይቱን በየቀኑ ንጹህና ክፍት ያደርጋል'),
    ('Wears PPE and follows site rules', 'የደህንነት አልባሳትን (PPE) ይለብሳል፤ የሳይት ደንቦችን ይከተላል'),
    ('Assists the trades: mixing, scaffolding, tools', 'ባለሙያዎችን ይረዳል፦ ማቀላቀል፣ ስካፎልዲንግ፣ መሳሪያዎች'),
    ('Final cleaning to handover standard', 'ለርክክብ በሚመጥን ደረጃ የመጨረሻ ጽዳት'),
    ('Leads a gang and plans material movement', 'ቡድን ይመራል፤ የቁሳቁስ እንቅስቃሴን ያቅዳል'),
    -- Site foreman
    ('Work orders updated as work moves', 'ስራው ሲራመድ የስራ ትዕዛዞች (ወርክ ኦርደር) ይሻሻላሉ'),
    ('Labour attendance recorded daily', 'የሰራተኞች መገኘት በየቀኑ ይመዘገባል'),
    ('Materials received and checked against delivery notes', 'ቁሳቁሶች ተረክበው ከማስረከቢያ ሰነዶቹ ጋር ይመሳከራሉ'),
    ('Toolbox talk and PPE every day', 'በየቀኑ የደህንነት ገለጻ (ቱልቦክስ ቶክ) እና PPE'),
    ('Daily report every working day', 'በእያንዳንዱ የስራ ቀን ዕለታዊ ሪፖርት'),
    -- Driver
    ('Valid licence and daily vehicle check', 'የሚሰራ መንጃ ፍቃድና የዕለት የተሽከርካሪ ፍተሻ'),
    ('Loads secured; delivers with a signed delivery note', 'ጭነቱን አጥብቆ ያስራል፤ በተፈረመ የማስረከቢያ ሰነድ ያደርሳል'),
    ('Keeps the trip and fuel log', 'የጉዞና የነዳጅ መዝገብ ይይዛል'),
    ('Drives safely; no incidents', 'በጥንቃቄ ያሽከረክራል፤ ያለ አደጋ'),
    -- Project manager
    ('Budget variance control', 'የበጀት ልዩነት ቁጥጥር'),
    ('Progress vs spend accuracy', 'የስራ ሂደትና ወጪ መጣጣም'),
    ('Stage-gate discipline', 'የደረጃ ፍተሻ (ስቴጅ ጌት) ስርዓትን መጠበቅ'),
    ('Site delivery confirmation', 'ወደ ሳይት የደረሱ እቃዎችን ማረጋገጥ'),
    ('Work orders kept up to date', 'የስራ ትዕዛዞች ወቅታዊ ሆነው ይቀመጣሉ'),
    -- Designer
    ('Drawing completeness at sign-off', 'በማጽደቂያ ጊዜ የስዕሎች ሙሉነት'),
    ('FF&E spec accuracy', 'የቤት እቃዎች ዝርዝር መግለጫ (FF&E) ትክክለኛነት'),
    ('Revision volume after sign-off', 'ከማጽደቂያ በኋላ የሚደረጉ ማሻሻያዎች ብዛት'),
    ('Client approval turnaround', 'የደንበኛ ማጽደቂያ የሚወስደው ጊዜ'),
    -- Finance officer
    ('WHT applied correctly', 'ዊዝሆልዲንግ ታክስ (WHT) በትክክል መተግበሩ'),
    ('Budget-check discipline', 'በጀት የማረጋገጥ ስርዓትን መጠበቅ'),
    ('Ledger posting integrity', 'የሂሳብ መዝገብ ምዝገባ ትክክለኛነት'),
    ('Approval turnaround', 'የማጽደቂያ ፍጥነት'),
    ('Payment confirmation turnaround', 'የክፍያ ማረጋገጫ ፍጥነት'),
    ('Bank lines explained', 'የባንክ እንቅስቃሴዎች መገለጻቸው'),
    -- Procurement officer
    ('Competitive sourcing', 'ተወዳዳሪ ዋጋ ማፈላለግ'),
    ('PO accuracy', 'የግዢ ትዕዛዝ (PO) ትክክለኛነት'),
    ('Vendor record quality', 'የአቅራቢዎች መረጃ ጥራት'),
    ('PR to PO turnaround', 'ከግዢ ጥያቄ (PR) እስከ ግዢ ትዕዛዝ (PO) የሚወስደው ጊዜ'),
    ('Advance-payment handling', 'የቅድሚያ ክፍያ አያያዝ'),
    -- Stock manager
    ('Catalogue quality', 'የእቃዎች ካታሎግ ጥራት'),
    ('Stock accuracy vs physical count', 'የስቶክ መረጃ ከቆጠራ ጋር መመሳሰሉ'),
    ('Receipts recorded on time', 'የገቡ እቃዎች በወቅቱ መመዝገባቸው'),
    -- HR officer
    ('Onboarding completeness', 'የአዲስ ሰራተኛ ቅበላ ሙሉነት'),
    ('Leave processing turnaround', 'የፈቃድ ጥያቄ ምላሽ ፍጥነት'),
    ('Staff records complete', 'የሰራተኞች መረጃ ሙሉ መሆኑ'),
    -- HSE officer
    ('Induction coverage', 'የደህንነት ገለጻ (ኢንዳክሽን) ሽፋን'),
    ('Incident logging timeliness', 'አደጋዎች በወቅቱ መመዝገባቸው'),
    ('Incidents closed', 'የተዘጉ የአደጋ ሪፖርቶች'),
    -- Business development
    ('Contract completeness', 'የውል ሙሉነት'),
    ('Project linkage discipline', 'ውሎችን ከፕሮጀክት ጋር የማገናኘት ስርዓት'),
    ('Quote-to-win conversion', 'ከዋጋ ማቅረቢያ ወደ ስራ የመቀየር መጠን'),
    ('CPO handling', 'የሲፒኦ (CPO) አያያዝ')
  ) v(en, am)
 WHERE k.responsibility_title = v.en AND k.title_am IS NULL;

UPDATE key_responsibilities SET detail_am = 'ገና አይለካም፦ የግዢ ጥያቄዎች በሲስተሙ ውስጥ ከ"በመጠባበቅ ላይ" አያልፉም።'
 WHERE responsibility_title = 'PR to PO turnaround' AND responsibility_detail IS NOT NULL AND detail_am IS NULL;
