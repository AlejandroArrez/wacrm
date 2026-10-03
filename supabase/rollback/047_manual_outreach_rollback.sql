-- Rollback de 047_manual_outreach. Borra plantillas e historial de
-- contactos manuales (las notas que dejaron en las fichas se quedan).
DROP VIEW IF EXISTS public.outreach_queue;
DROP TABLE IF EXISTS outreach_attempts;
DROP TABLE IF EXISTS outreach_templates;
DROP FUNCTION IF EXISTS public.outreach_attempts_note();
DROP FUNCTION IF EXISTS public.outreach_attempts_before_update();
DROP FUNCTION IF EXISTS public.outreach_attempts_before_insert();
DROP FUNCTION IF EXISTS public.outreach_result_label(TEXT);
DROP FUNCTION IF EXISTS public.outreach_my_quota(UUID);
DROP FUNCTION IF EXISTS public.outreach_day_start();
ALTER TABLE profiles DROP COLUMN IF EXISTS whatsapp_phone;
ALTER TABLE accounts DROP COLUMN IF EXISTS outreach_daily_limit;
