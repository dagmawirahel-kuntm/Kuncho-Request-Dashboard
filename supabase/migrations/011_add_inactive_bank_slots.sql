-- Add inactive placeholder slots for every Ethiopian commercial bank
-- that does not already have an account entry.
-- Idempotent: skips any bank whose name already appears (case-insensitive) in accounts.

DO $$
DECLARE
  banks TEXT[] := ARRAY[
    'Dashen Bank',
    'Wegagen Bank',
    'Hibret Bank',
    'Nib International Bank',
    'Oromia Bank',
    'Bunna International Bank',
    'Berhan International Bank',
    'Enat Bank',
    'Anbesa Bank',
    'Addis Bank S.C.',
    'Global Bank Ethiopia',
    'Ahadu Bank',
    'Tsedey Bank',
    'Gadaa Bank',
    'ZamZam Bank',
    'Hijra Bank',
    'Siinqee Bank',
    'Shabelle Bank',
    'Goh Betoch Bank',
    'Rammis Bank'
  ];
  b TEXT;
BEGIN
  FOREACH b IN ARRAY banks LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.accounts
      WHERE LOWER(account_name) = LOWER(b)
    ) THEN
      INSERT INTO public.accounts (id, account_name, type, status, created_at, updated_at)
      VALUES (gen_random_uuid(), b, 'Bank Account', 'inactive', NOW(), NOW());
    END IF;
  END LOOP;
END $$;
