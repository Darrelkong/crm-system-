-- Migration: add customer_type, phone_country_code, sales_stage to customers
ALTER TABLE customers ADD COLUMN customer_type TEXT NOT NULL DEFAULT 'individual';
ALTER TABLE customers ADD COLUMN phone_country_code TEXT NOT NULL DEFAULT '+86';
ALTER TABLE customers ADD COLUMN sales_stage TEXT NOT NULL DEFAULT 'new_lead';
