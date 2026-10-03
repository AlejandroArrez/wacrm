-- ============================================================
-- Reversa de 048 · El Plan. Correr en el SQL Editor de Supabase
-- solo si se quiere retirar El Plan. Borra metas, premios y toda la
-- actividad registrada; las notas que ya quedaron en las fichas se
-- conservan.
-- ============================================================
BEGIN;
DROP TRIGGER IF EXISTS plan_from_outreach ON outreach_attempts;
DROP TRIGGER IF EXISTS plan_from_deal ON deals;
DROP TRIGGER IF EXISTS plan_from_message ON messages;
DROP TRIGGER IF EXISTS plan_from_contact ON contacts;
DROP TRIGGER IF EXISTS profiles_plan_track_guard ON profiles;
DROP FUNCTION IF EXISTS public.plan_from_outreach();
DROP FUNCTION IF EXISTS public.plan_from_deal();
DROP FUNCTION IF EXISTS public.plan_from_message();
DROP FUNCTION IF EXISTS public.plan_from_contact();
DROP FUNCTION IF EXISTS public.profiles_plan_track_guard();
DROP FUNCTION IF EXISTS public.set_member_plan_track(UUID, TEXT);
DROP FUNCTION IF EXISTS public.plan_counts(UUID, DATE, DATE);
DROP TABLE IF EXISTS plan_activities;
DROP TABLE IF EXISTS plan_prizes;
DROP TABLE IF EXISTS plan_goals;
DROP FUNCTION IF EXISTS public.plan_record(UUID, UUID, TEXT, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.plan_activities_note();
DROP FUNCTION IF EXISTS public.plan_activities_before_insert();
DROP FUNCTION IF EXISTS public.plan_metric_label(TEXT);
ALTER TABLE profiles DROP COLUMN IF EXISTS plan_track, DROP COLUMN IF EXISTS plan_opt_in;
ALTER TABLE accounts DROP COLUMN IF EXISTS plan_week_days_required,
  DROP COLUMN IF EXISTS plan_month_weeks_required,
  DROP COLUMN IF EXISTS plan_workdays,
  DROP COLUMN IF EXISTS plan_followup_days;
COMMIT;
