-- Transport payments (TransportPaymentFormPage) have been posting as
-- expense_type = 'general' ever since that page existed, which loses
-- them in the "GEN-MISC" catch-all bucket and means the printed
-- Payment Request document has nothing type-specific to show — no
-- route, vehicle, or driver, since none of that lives on `expenses`.
--
-- Run this FIRST, then run 261 — a new enum value can't be referenced
-- (e.g. from expense_type_ledger_defaults) in the same transaction it's
-- added in. Same two-step pattern as 062a/062b for 'fuel'.
ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'transportation';
