-- Run this FIRST, then run 060b_logistics_officer_role_and_tax.sql
-- PostgreSQL requires enum values to be committed before they can be used in policies.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'logistics_officer';
