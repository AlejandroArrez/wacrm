-- ============================================================
-- 047 · Respuesta manual (contacto por WhatsApp desde el teléfono
--       de cada asesor)
--
-- El CRM no envía estos mensajes. Arma el texto con una plantilla y
-- abre WhatsApp (wa.me) en el teléfono o la computadora del asesor;
-- el mensaje sale de su propio número. Aquí solo se registra quién
-- contactó a quién, con qué texto, desde qué número y qué pasó.
--
--   1. `accounts.outreach_daily_limit`: tope de contactos manuales
--      por asesor por día (hora de Ciudad de México). Protege los
--      números de bloqueos por spam.
--   2. `profiles.whatsapp_phone`: número desde el que escribe cada
--      miembro. Lo edita cada quien en su perfil.
--   3. `outreach_templates`: plantillas por segmento o campaña.
--      Las ve todo el equipo; solo admin u owner las editan.
--   4. `outreach_attempts`: cada contacto manual y su resultado.
--      Cada intento deja una nota en la ficha del prospecto, y esa
--      nota cuenta como actividad del dueño (regla de 60 días, 043).
--   5. Vista `outreach_queue` (security_invoker): los prospectos que
--      el usuario ya puede ver, con su último intento y si ya
--      escribieron por WhatsApp al número del CRM.
--
-- Solo agrega. No borra ni renombra nada, y todo se crea solo si
-- falta: se puede correr varias veces (la conexión de Supabase
-- cancela cualquier migración que borre algo).
-- ============================================================

-- ------------------------------------------------------------
-- 1 · Columnas
-- ------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS outreach_daily_limit INTEGER NOT NULL DEFAULT 20
    CHECK (outreach_daily_limit BETWEEN 1 AND 500);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT
    CHECK (whatsapp_phone IS NULL OR whatsapp_phone ~ '^\+?[0-9][0-9 ()-]{6,22}$');

-- ------------------------------------------------------------
-- 2 · Plantillas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  body          TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  -- NULL = sirve para cualquier segmento.
  segment       TEXT CHECK (segment IS NULL OR segment IN
                  ('residente', 'inversionista', 'joven', 'diaspora', 'patrimonio')),
  -- Etiqueta de campaña del prospecto (p. ej. "campaña:feria"); NULL = cualquiera.
  campaign_tag  TEXT CHECK (campaign_tag IS NULL OR char_length(btrim(campaign_tag)) BETWEEN 1 AND 60),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outreach_templates_account_idx
  ON outreach_templates (account_id, sort_order);

CREATE OR REPLACE TRIGGER set_updated_at
  BEFORE UPDATE ON outreach_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE outreach_templates ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 3 · Intentos de contacto
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outreach_attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id       UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  template_id   UUID REFERENCES outreach_templates(id) ON DELETE SET NULL,
  message       TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  -- Número del asesor al momento del contacto (se copia del perfil).
  sender_phone  TEXT,
  result        TEXT NOT NULL DEFAULT 'sent'
                  CHECK (result IN ('sent', 'replied', 'meeting', 'wrong_number', 'not_interested')),
  result_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outreach_attempts_contact_idx
  ON outreach_attempts (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outreach_attempts_user_day_idx
  ON outreach_attempts (user_id, created_at DESC);

CREATE OR REPLACE TRIGGER set_updated_at
  BEFORE UPDATE ON outreach_attempts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE outreach_attempts ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 4 · Políticas (creadas solo si faltan)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'outreach_templates' AND policyname = 'outreach_templates_select') THEN
    CREATE POLICY outreach_templates_select ON outreach_templates FOR SELECT
      USING (is_account_member(account_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'outreach_templates' AND policyname = 'outreach_templates_insert') THEN
    CREATE POLICY outreach_templates_insert ON outreach_templates FOR INSERT
      WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'outreach_templates' AND policyname = 'outreach_templates_update') THEN
    CREATE POLICY outreach_templates_update ON outreach_templates FOR UPDATE
      USING (is_account_member(account_id, 'admin'::account_role_enum))
      WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'outreach_templates' AND policyname = 'outreach_templates_delete') THEN
    CREATE POLICY outreach_templates_delete ON outreach_templates FOR DELETE
      USING (is_account_member(account_id, 'admin'::account_role_enum));
  END IF;

  -- Intentos: se ven si se ve el prospecto. Cada quien registra los
  -- suyos; el resultado lo cambia quien contactó o dirección.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'outreach_attempts' AND policyname = 'outreach_attempts_select') THEN
    CREATE POLICY outreach_attempts_select ON outreach_attempts FOR SELECT
      USING (is_account_member(account_id) AND contact_visible(contact_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'outreach_attempts' AND policyname = 'outreach_attempts_insert') THEN
    CREATE POLICY outreach_attempts_insert ON outreach_attempts FOR INSERT
      WITH CHECK (is_account_member(account_id, 'agent'::account_role_enum)
                  AND contact_visible(contact_id)
                  AND user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'outreach_attempts' AND policyname = 'outreach_attempts_update') THEN
    CREATE POLICY outreach_attempts_update ON outreach_attempts FOR UPDATE
      USING (is_account_member(account_id, 'agent'::account_role_enum)
             AND contact_visible(contact_id)
             AND (user_id = auth.uid() OR sees_all_prospects(account_id)))
      WITH CHECK (is_account_member(account_id, 'agent'::account_role_enum)
                  AND contact_visible(contact_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'outreach_attempts' AND policyname = 'outreach_attempts_delete') THEN
    CREATE POLICY outreach_attempts_delete ON outreach_attempts FOR DELETE
      USING (is_account_member(account_id, 'admin'::account_role_enum));
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 5 · Reglas de los intentos
-- ------------------------------------------------------------

-- Inicio del día de hoy en Ciudad de México, como instante.
CREATE OR REPLACE FUNCTION public.outreach_day_start()
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT (date_trunc('day', now() AT TIME ZONE 'America/Mexico_City'))
         AT TIME ZONE 'America/Mexico_City';
$$;

-- Contactos manuales que el usuario lleva hoy y su tope.
CREATE OR REPLACE FUNCTION public.outreach_my_quota(p_account_id UUID)
RETURNS TABLE (used INTEGER, daily_limit INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    (SELECT count(*)::int FROM outreach_attempts a
      WHERE a.user_id = auth.uid() AND a.account_id = p_account_id
        AND a.created_at >= public.outreach_day_start()),
    (SELECT a.outreach_daily_limit FROM accounts a WHERE a.id = p_account_id);
$$;
ALTER FUNCTION public.outreach_my_quota(UUID) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.outreach_my_quota(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.outreach_my_quota(UUID) TO authenticated, service_role;

-- Antes de registrar: autor, número del asesor y tope diario.
-- Se cuentan los intentos del día, no los prospectos distintos.
CREATE OR REPLACE FUNCTION public.outreach_attempts_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_used INTEGER;
  v_limit INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  IF NEW.sender_phone IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT p.whatsapp_phone INTO NEW.sender_phone
      FROM profiles p WHERE p.user_id = NEW.user_id LIMIT 1;
  END IF;
  NEW.result := 'sent';
  NEW.result_at := NULL;

  IF NEW.user_id IS NOT NULL THEN
    SELECT a.outreach_daily_limit INTO v_limit FROM accounts a WHERE a.id = NEW.account_id;
    SELECT count(*) INTO v_used FROM outreach_attempts o
      WHERE o.user_id = NEW.user_id AND o.account_id = NEW.account_id
        AND o.created_at >= public.outreach_day_start();
    IF v_used >= COALESCE(v_limit, 20) THEN
      RAISE EXCEPTION 'outreach_daily_limit: % de %', v_used, v_limit
        USING ERRCODE = 'P0001', HINT = 'daily_limit';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.outreach_attempts_before_insert() OWNER TO postgres;

CREATE OR REPLACE TRIGGER outreach_attempts_before_insert
  BEFORE INSERT ON outreach_attempts
  FOR EACH ROW EXECUTE FUNCTION public.outreach_attempts_before_insert();

-- Después de un intento cambia solo el resultado. Autor, prospecto,
-- texto y número quedan como se registraron.
CREATE OR REPLACE FUNCTION public.outreach_attempts_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.account_id := OLD.account_id;
  NEW.contact_id := OLD.contact_id;
  NEW.user_id := OLD.user_id;
  NEW.template_id := OLD.template_id;
  NEW.message := OLD.message;
  NEW.sender_phone := OLD.sender_phone;
  NEW.created_at := OLD.created_at;
  IF NEW.result IS DISTINCT FROM OLD.result THEN
    NEW.result_at := now();
  ELSE
    NEW.result_at := OLD.result_at;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.outreach_attempts_before_update() OWNER TO postgres;

CREATE OR REPLACE TRIGGER outreach_attempts_before_update
  BEFORE UPDATE ON outreach_attempts
  FOR EACH ROW EXECUTE FUNCTION public.outreach_attempts_before_update();

-- Texto del resultado para la nota.
CREATE OR REPLACE FUNCTION public.outreach_result_label(p_result TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE p_result
    WHEN 'sent' THEN 'Enviado, sin respuesta'
    WHEN 'replied' THEN 'Respondió'
    WHEN 'meeting' THEN 'Cita agendada'
    WHEN 'wrong_number' THEN 'Número equivocado'
    WHEN 'not_interested' THEN 'No le interesa'
    ELSE p_result
  END;
$$;

-- Cada intento y cada cambio de resultado quedan como nota en la
-- ficha. La nota la escribe quien hizo el cambio, así que si es el
-- dueño del prospecto reinicia su plazo (trigger de notas de la 043).
CREATE OR REPLACE FUNCTION public.outreach_attempts_note()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_author UUID := COALESCE(auth.uid(), NEW.user_id);
  v_text TEXT;
BEGIN
  IF v_author IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_text := 'WhatsApp manual'
      || COALESCE(' desde ' || NEW.sender_phone, '')
      || E':\n' || left(NEW.message, 500);
  ELSIF NEW.result IS DISTINCT FROM OLD.result THEN
    v_text := 'Resultado del WhatsApp manual: ' || public.outreach_result_label(NEW.result);
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO contact_notes (contact_id, user_id, account_id, note_text)
  VALUES (NEW.contact_id, v_author, NEW.account_id, v_text);
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.outreach_attempts_note() OWNER TO postgres;

CREATE OR REPLACE TRIGGER outreach_attempts_note
  AFTER INSERT OR UPDATE ON outreach_attempts
  FOR EACH ROW EXECUTE FUNCTION public.outreach_attempts_note();

-- ------------------------------------------------------------
-- 6 · Bandeja «Por contactar»
-- ------------------------------------------------------------
-- security_invoker: cada quien ve solo los prospectos que ya puede
-- ver por las reglas de la 043.
CREATE OR REPLACE VIEW public.outreach_queue
WITH (security_invoker = true) AS
SELECT
  c.id               AS contact_id,
  c.account_id,
  c.name,
  c.phone,
  c.phone_normalized,
  c.owner_id,
  c.created_at,
  EXISTS (
    SELECT 1 FROM conversations v
      JOIN messages m ON m.conversation_id = v.id
     WHERE v.contact_id = c.id AND m.sender_type = 'customer'
  )                  AS has_chat,
  last_try.id         AS last_attempt_id,
  last_try.created_at AS last_attempt_at,
  last_try.result     AS last_result,
  last_try.user_id    AS last_attempt_by,
  (SELECT count(*)::int FROM outreach_attempts a WHERE a.contact_id = c.id) AS attempts,
  COALESCE((
    SELECT array_agg(t.name ORDER BY t.name)
      FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
     WHERE ct.contact_id = c.id
  ), '{}'::text[])   AS tags
FROM contacts c
LEFT JOIN LATERAL (
  SELECT a.id, a.created_at, a.result, a.user_id
    FROM outreach_attempts a
   WHERE a.contact_id = c.id
   ORDER BY a.created_at DESC
   LIMIT 1
) last_try ON TRUE;

GRANT SELECT ON public.outreach_queue TO authenticated, service_role;
