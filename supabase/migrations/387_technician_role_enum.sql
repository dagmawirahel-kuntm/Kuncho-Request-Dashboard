-- 387 — A login role for the people who do the work with their hands
--
-- Electricians, carpenters, painters, welders, CNC operators. They had no
-- role of their own: the Users page only offered office and management
-- roles for Operations/Construction, so a workshop electrician was signed
-- up as a project manager to be able to ask for parts. The role is set up
-- in 388; a new enum value has to be committed before it is used.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'technician';
