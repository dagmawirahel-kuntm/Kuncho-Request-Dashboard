-- Run this FIRST, then run 022b_stock_schema.sql
-- PostgreSQL requires enum values to be committed before they can be used in policies.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'stock_manager';
