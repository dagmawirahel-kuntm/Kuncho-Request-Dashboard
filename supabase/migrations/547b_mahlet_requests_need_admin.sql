-- Mahlet Tsegaye raises the workshop's purchase requests from finance. For the
-- time being an admin approves them before anything on them is bought (547).
-- Applied once the app can show and approve held requests.
UPDATE user_profiles SET requests_need_admin_approval = true
 WHERE id = 'dd9d3d8c-cc78-47dc-ab26-cf24ee1d99e9';
