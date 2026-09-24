-- Demera and Meskel 2026 on the company calendar.
--
-- Two company-wide entries so the week's board and the calendar page show
-- them alongside the seasonal treatment in the app (src/lib/seasons.ts):
--   Demera  Saturday 26 September 2026 (Meskerem 16), from 18:00
--   Meskel  Sunday 27 September 2026 (Meskerem 17, 2019 E.C.) — public holiday
--
-- calendar_holidays is deliberately left alone: it feeds project schedule
-- working-day calculations, is empty today, and Meskel falls on a Sunday.
-- Whether to start keeping public holidays there is a scheduling decision.
--
-- Idempotent: each row is only added when no entry with that title exists
-- on that date.

SET search_path TO public;

INSERT INTO company_events (title, description, event_date, start_time, event_type, department)
SELECT 'Demera', 'ደመራ · መስከረም ፲፮ — the Demera is lit on the eve of Meskel.',
       DATE '2026-09-26', TIME '18:00', 'event', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM company_events WHERE event_date = DATE '2026-09-26' AND title = 'Demera'
);

INSERT INTO company_events (title, description, event_date, event_type, department)
SELECT 'Meskel', 'መስቀል · መስከረም ፲፯ ፳፻፲፱ ዓ.ም. — Finding of the True Cross. Public holiday.',
       DATE '2026-09-27', 'holiday', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM company_events WHERE event_date = DATE '2026-09-27' AND title = 'Meskel'
);
