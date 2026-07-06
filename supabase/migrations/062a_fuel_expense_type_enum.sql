-- Run this FIRST, then run 062b_vehicle_fuel_requests.sql
-- PostgreSQL requires enum values to be committed before they can be used
-- in trigger functions / policies within the same session.
ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'fuel';
