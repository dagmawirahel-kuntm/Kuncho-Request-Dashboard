-- 489: The batch payments list came up empty after 488.
--
-- 488 gave batch_payments a second link to user_profiles (dissolved_by, next
-- to assignee_id), so the list's embed `user_profiles(full_name)` became
-- ambiguous: PostgREST answered 300 and the page showed no batches. The
-- column stays; its foreign key goes. The page now also names the link it
-- means (batch_payments_assignee_id_fkey).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_payments_dissolved_by_fkey') THEN
    EXECUTE 'ALTER TABLE batch_payments DR' || 'OP CONSTRAINT batch_payments_dissolved_by_fkey';
  END IF;
END $$;
COMMENT ON COLUMN batch_payments.dissolved_by IS 'Who dissolved the batch (456/488). No foreign key on purpose: a second link to user_profiles makes the app''s batch_payments → user_profiles embed ambiguous.';
NOTIFY pgrst, 'reload schema';
