-- Link purchase requests to the user profile of whoever submitted them.
-- staff_id is repurposed as the assigned procurement officer.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS requested_by_user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL;
