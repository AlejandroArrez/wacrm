-- ============================================================
-- 049 · Generador de contenido: consumo de IA por usuario
--
--   1. `ai_usage_log.mode` acepta 'studio' (Copy Mágico del generador).
--   2. `ai_usage_log.user_id`: quién hizo la consulta. Queda vacío en
--      las respuestas automáticas del bot y en los registros anteriores.
--   3. Índice por cuenta, usuario y fecha para medir el consumo por
--      persona.
--   4. Depósito privado `studio` de Storage para el archivo del
--      generador (generador.html). No va en el repositorio porque lleva
--      precios de lista y fuentes con licencia. Solo el servidor lo lee,
--      con la llave de servicio; no hay políticas para usuarios.
--
-- Solo agrega. No cambia ni borra registros existentes.
-- Idempotente: se puede correr más de una vez.
-- ============================================================
BEGIN;

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'studio'));

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_account_user_created
  ON ai_usage_log(account_id, user_id, created_at DESC);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('studio', 'studio', FALSE, 10485760, ARRAY['text/html']) -- 10 MB
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
