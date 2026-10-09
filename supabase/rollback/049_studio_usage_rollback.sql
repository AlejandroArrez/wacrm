-- ============================================================
-- Reversa de 049 · Generador de contenido. Correr en el SQL Editor de
-- Supabase solo si se retira el generador. Borra los registros de
-- consumo del generador (modo 'studio') y la columna user_id; el resto
-- de la bitácora se conserva. El depósito `studio` se vacía y se borra
-- desde Storage en el panel de Supabase (la API de Storage no permite
-- borrar objetos con SQL).
-- ============================================================
BEGIN;
DELETE FROM ai_usage_log WHERE mode = 'studio';
DROP INDEX IF EXISTS idx_ai_usage_log_account_user_created;
ALTER TABLE ai_usage_log DROP COLUMN IF EXISTS user_id;
ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft'));
COMMIT;
