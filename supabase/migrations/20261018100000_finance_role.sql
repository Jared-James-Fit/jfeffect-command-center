-- Finance: a staff-only bookkeeper role (read the books, record expenses,
-- receipts and tax payments). Its own migration because a new enum value
-- can't be used in the same transaction that adds it.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'finance';
