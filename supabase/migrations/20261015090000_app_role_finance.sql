-- Finance role (bookkeeper). Its own file: a new enum value can't be used in
-- the same transaction that adds it, and role_permissions seeds it next.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'finance';
