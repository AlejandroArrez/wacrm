-- ============================================================
-- 048 · El Plan: metas diarias, semanales, mensuales y
--       trimestrales por liga, con registro de actividad
--
--   1. `plan_goals`: metas por liga (asesor, bróker, director),
--      periodo y métrica. Las configura dirección.
--   2. `plan_activities`: cada acción que suma a una meta. El asesor
--      registra las que pasan fuera del CRM (llamadas, presentaciones,
--      publicaciones…), siempre ligadas a un prospecto cuando aplica.
--      Las que el CRM ya ve se registran solas:
--        · Respuesta manual (047): intento nuevo, conversación, cita;
--        · Embudo: negocio que llega a Cita, Presentado, Apartado o
--          Vendido;
--        · Bandeja: mensajes del asesor (un seguimiento por prospecto
--          por día);
--        · Contactos: prospecto que el propio asesor o bróker registra.
--      Cada acción manual con prospecto deja nota en su ficha y cuenta
--      como actividad para la regla de 60 días (043).
--   3. `plan_prizes`: premio de cada nivel por liga, editable.
--   4. Perfil: liga de cada miembro (`plan_track`) y participación
--      voluntaria (`plan_opt_in`, pensada para brókers).
--   5. `plan_counts()`: conteos por día y métrica. Cada quien ve los
--      suyos; dirección ve los de todo el equipo.
--
-- Solo agrega y todo se crea solo si falta: se puede correr varias
-- veces. (La conexión de Supabase cancela migraciones que borran.)
-- ============================================================

-- ------------------------------------------------------------
-- 1 · Columnas
-- ------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS plan_week_days_required INTEGER NOT NULL DEFAULT 5
    CHECK (plan_week_days_required BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS plan_month_weeks_required INTEGER NOT NULL DEFAULT 3
    CHECK (plan_month_weeks_required BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS plan_workdays INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  ADD COLUMN IF NOT EXISTS plan_followup_days INTEGER NOT NULL DEFAULT 3
    CHECK (plan_followup_days BETWEEN 1 AND 30);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan_track TEXT
    CHECK (plan_track IS NULL OR plan_track IN ('advisor', 'broker', 'director', 'none')),
  ADD COLUMN IF NOT EXISTS plan_opt_in BOOLEAN NOT NULL DEFAULT TRUE;

-- ------------------------------------------------------------
-- 2 · Tablas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  track       TEXT NOT NULL CHECK (track IN ('advisor', 'broker', 'director')),
  period      TEXT NOT NULL CHECK (period IN ('day', 'week', 'month', 'quarter')),
  metric      TEXT NOT NULL CHECK (metric ~ '^[a-z_]{2,40}$'),
  target      INTEGER NOT NULL CHECK (target BETWEEN 1 AND 10000),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, track, period, metric)
);

CREATE TABLE IF NOT EXISTS plan_prizes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  track       TEXT NOT NULL CHECK (track IN ('advisor', 'broker', 'director')),
  level       TEXT NOT NULL CHECK (level IN ('day', 'week', 'month', 'quarter')),
  title       TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 300),
  image_url   TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, track, level)
);

CREATE TABLE IF NOT EXISTS plan_activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric        TEXT NOT NULL CHECK (metric ~ '^[a-z_]{2,40}$'),
  source        TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'outreach', 'deal', 'message', 'contact')),
  -- Registro que la originó (intento, negocio, contacto) para no contar dos veces.
  ref_id        UUID,
  contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- Uno a uno del director: el miembro con quien fue.
  member_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resource_id   UUID REFERENCES resources(id) ON DELETE SET NULL,
  link          TEXT CHECK (link IS NULL OR link ~* '^https?://'),
  outcome       TEXT CHECK (outcome IS NULL OR char_length(outcome) <= 120),
  note          TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  activity_day  DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Mexico_City')::date),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plan_activities_user_day_idx
  ON plan_activities (account_id, user_id, activity_day);
CREATE INDEX IF NOT EXISTS plan_activities_contact_idx
  ON plan_activities (contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS plan_activities_ref_uniq
  ON plan_activities (source, metric, ref_id) WHERE ref_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS plan_activities_message_uniq
  ON plan_activities (user_id, contact_id, activity_day) WHERE source = 'message';

CREATE OR REPLACE TRIGGER set_updated_at
  BEFORE UPDATE ON plan_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER set_updated_at
  BEFORE UPDATE ON plan_prizes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE plan_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_activities ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 3 · Políticas (creadas solo si faltan)
-- ------------------------------------------------------------
DO $$
BEGIN
  -- Metas y premios: todo el equipo los ve; dirección los edita.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan_goals' AND policyname = 'plan_goals_select') THEN
    CREATE POLICY plan_goals_select ON plan_goals FOR SELECT USING (is_account_member(account_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan_goals' AND policyname = 'plan_goals_write') THEN
    CREATE POLICY plan_goals_write ON plan_goals FOR ALL
      USING (is_account_member(account_id, 'admin'::account_role_enum))
      WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan_prizes' AND policyname = 'plan_prizes_select') THEN
    CREATE POLICY plan_prizes_select ON plan_prizes FOR SELECT USING (is_account_member(account_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan_prizes' AND policyname = 'plan_prizes_write') THEN
    CREATE POLICY plan_prizes_write ON plan_prizes FOR ALL
      USING (is_account_member(account_id, 'admin'::account_role_enum))
      WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));
  END IF;

  -- Actividad: cada quien ve la suya; dirección ve la de todos.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan_activities' AND policyname = 'plan_activities_select') THEN
    CREATE POLICY plan_activities_select ON plan_activities FOR SELECT
      USING (is_account_member(account_id)
             AND (user_id = auth.uid() OR sees_all_prospects(account_id)));
  END IF;
  -- Solo se registran a mano acciones propias, y con un prospecto que
  -- uno puede ver. Las automáticas las escriben los triggers.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan_activities' AND policyname = 'plan_activities_insert') THEN
    CREATE POLICY plan_activities_insert ON plan_activities FOR INSERT
      WITH CHECK (is_account_member(account_id, 'agent'::account_role_enum)
                  AND user_id = auth.uid()
                  AND source = 'manual'
                  AND (contact_id IS NULL OR contact_visible(contact_id)));
  END IF;
  -- Corregir un error: se borra lo propio y manual de hoy o ayer;
  -- dirección puede borrar cualquier registro.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan_activities' AND policyname = 'plan_activities_delete') THEN
    CREATE POLICY plan_activities_delete ON plan_activities FOR DELETE
      USING (is_account_member(account_id, 'admin'::account_role_enum)
             OR (user_id = auth.uid() AND source = 'manual'
                 AND activity_day >= (now() AT TIME ZONE 'America/Mexico_City')::date - 1));
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 4 · Reglas
-- ------------------------------------------------------------

-- Día de la actividad en hora de Ciudad de México; una acción manual
-- no puede fecharse en el futuro ni más de 7 días atrás.
CREATE OR REPLACE FUNCTION public.plan_activities_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.source = 'manual' THEN
    IF NEW.occurred_at > now() + interval '5 minutes' THEN
      NEW.occurred_at := now();
    ELSIF NEW.occurred_at < now() - interval '7 days' THEN
      RAISE EXCEPTION 'plan_activity_too_old' USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.activity_day := (NEW.occurred_at AT TIME ZONE 'America/Mexico_City')::date;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER plan_activities_before_insert
  BEFORE INSERT ON plan_activities
  FOR EACH ROW EXECUTE FUNCTION public.plan_activities_before_insert();

-- Nombre de cada métrica para las notas de la ficha.
CREATE OR REPLACE FUNCTION public.plan_metric_label(p_metric TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE p_metric
    WHEN 'new_attempts' THEN 'Primer contacto'
    WHEN 'conversations' THEN 'Conversación'
    WHEN 'followups' THEN 'Seguimiento'
    WHEN 'appointments_set' THEN 'Cita agendada'
    WHEN 'presentations' THEN 'Presentación realizada'
    WHEN 'quotes_sent' THEN 'Cotización enviada'
    WHEN 'referrals_asked' THEN 'Referido solicitado'
    WHEN 'accompanied_appointments' THEN 'Cita acompañada por dirección'
    ELSE p_metric
  END;
$$;

-- Una acción manual con prospecto deja nota en su ficha. La escribe
-- el autor, así que si es el dueño reinicia su plazo (043).
CREATE OR REPLACE FUNCTION public.plan_activities_note()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.source <> 'manual' OR NEW.contact_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- «Contestó» registra la llamada y además una conversación, en el
  -- mismo INSERT. La nota la deja solo la llamada.
  IF NEW.metric = 'conversations' AND EXISTS (
    SELECT 1 FROM plan_activities o
     WHERE o.user_id = NEW.user_id AND o.contact_id = NEW.contact_id
       AND o.created_at = NEW.created_at AND o.id <> NEW.id
       AND o.metric <> 'conversations'
  ) THEN
    RETURN NULL;
  END IF;
  INSERT INTO contact_notes (contact_id, user_id, account_id, note_text)
  VALUES (
    NEW.contact_id, NEW.user_id, NEW.account_id,
    'Plan · ' || public.plan_metric_label(NEW.metric)
      || COALESCE(' · ' || NEW.outcome, '')
      || COALESCE(E'\n' || NEW.note, '')
  );
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.plan_activities_note() OWNER TO postgres;

CREATE OR REPLACE TRIGGER plan_activities_note
  AFTER INSERT ON plan_activities
  FOR EACH ROW EXECUTE FUNCTION public.plan_activities_note();

-- Alta automática, sin duplicar.
CREATE OR REPLACE FUNCTION public.plan_record(
  p_account UUID, p_user UUID, p_metric TEXT, p_source TEXT,
  p_ref UUID, p_contact UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_account IS NULL OR p_user IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO plan_activities (account_id, user_id, metric, source, ref_id, contact_id)
  VALUES (p_account, p_user, p_metric, p_source, p_ref, p_contact)
  ON CONFLICT (source, metric, ref_id) WHERE ref_id IS NOT NULL DO NOTHING;
END;
$$;
ALTER FUNCTION public.plan_record(UUID, UUID, TEXT, TEXT, UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.plan_record(UUID, UUID, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- 4.1 Respuesta manual (047): intento nuevo, conversación y cita.
CREATE OR REPLACE FUNCTION public.plan_from_outreach()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.plan_record(NEW.account_id, NEW.user_id, 'new_attempts', 'outreach', NEW.id, NEW.contact_id);
  ELSIF NEW.result IS DISTINCT FROM OLD.result THEN
    IF NEW.result IN ('replied', 'meeting') THEN
      PERFORM public.plan_record(NEW.account_id, NEW.user_id, 'conversations', 'outreach', NEW.id, NEW.contact_id);
    END IF;
    IF NEW.result = 'meeting' THEN
      PERFORM public.plan_record(NEW.account_id, NEW.user_id, 'appointments_set', 'outreach', NEW.id, NEW.contact_id);
    END IF;
  END IF;
  RETURN NULL;
-- El Plan nunca debe frenar la operación: si el conteo falla, la
-- acción original (mensaje, negocio, contacto, intento) sigue.
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.plan_from_outreach() OWNER TO postgres;

CREATE OR REPLACE TRIGGER plan_from_outreach
  AFTER INSERT OR UPDATE OF result ON outreach_attempts
  FOR EACH ROW EXECUTE FUNCTION public.plan_from_outreach();

-- 4.2 Embudo: el negocio llega a Cita, Presentado, Apartado o Vendido.
-- Cuenta para el asesor asignado (o quien lo mueve). Cada negocio
-- cuenta una sola vez por etapa aunque vaya y venga.
CREATE OR REPLACE FUNCTION public.plan_from_deal()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_stage TEXT;
  v_metric TEXT;
  v_user UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NULL;
  END IF;
  SELECT lower(name) INTO v_stage FROM pipeline_stages WHERE id = NEW.stage_id;
  v_metric := CASE
    WHEN v_stage LIKE 'cita%' THEN 'appointments_set'
    WHEN v_stage LIKE 'presentad%' THEN 'presentations'
    WHEN v_stage LIKE 'apartad%' THEN 'reservations'
    WHEN v_stage LIKE 'vendid%' THEN 'sales'
    ELSE NULL END;
  IF v_metric IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT p.user_id INTO v_user FROM profiles p WHERE p.id = NEW.assigned_to;
  v_user := COALESCE(v_user, auth.uid(), NEW.user_id);
  PERFORM public.plan_record(NEW.account_id, v_user, v_metric, 'deal', NEW.id, NEW.contact_id);
  RETURN NULL;
-- El Plan nunca debe frenar la operación: si el conteo falla, la
-- acción original (mensaje, negocio, contacto, intento) sigue.
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.plan_from_deal() OWNER TO postgres;

CREATE OR REPLACE TRIGGER plan_from_deal
  AFTER INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION public.plan_from_deal();

-- 4.3 Bandeja: mensaje del asesor = un seguimiento por prospecto por día.
CREATE OR REPLACE FUNCTION public.plan_from_message()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_contact UUID;
  v_account UUID;
BEGIN
  IF NEW.sender_type <> 'agent' OR NEW.sender_id IS NULL
     OR COALESCE(NEW.ai_generated, false) THEN
    RETURN NULL;
  END IF;
  SELECT contact_id, account_id INTO v_contact, v_account
    FROM conversations WHERE id = NEW.conversation_id;
  IF v_contact IS NULL OR v_account IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO plan_activities (account_id, user_id, metric, source, contact_id)
  VALUES (v_account, NEW.sender_id, 'followups', 'message', v_contact)
  ON CONFLICT (user_id, contact_id, activity_day) WHERE source = 'message' DO NOTHING;
  RETURN NULL;
-- El Plan nunca debe frenar la operación: si el conteo falla, la
-- acción original (mensaje, negocio, contacto, intento) sigue.
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.plan_from_message() OWNER TO postgres;

CREATE OR REPLACE TRIGGER plan_from_message
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.plan_from_message();

-- 4.4 Prospecto registrado por el propio asesor o bróker (o por el
-- conector con su clave). Una asignación de dirección no cuenta.
CREATE OR REPLACE FUNCTION public.plan_from_contact()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
    RETURN NULL;
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> NEW.owner_id THEN
    RETURN NULL;
  END IF;
  PERFORM public.plan_record(NEW.account_id, NEW.owner_id, 'prospects_registered', 'contact', NEW.id, NEW.id);
  RETURN NULL;
-- El Plan nunca debe frenar la operación: si el conteo falla, la
-- acción original (mensaje, negocio, contacto, intento) sigue.
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.plan_from_contact() OWNER TO postgres;

CREATE OR REPLACE TRIGGER plan_from_contact
  AFTER INSERT OR UPDATE OF owner_id ON contacts
  FOR EACH ROW EXECUTE FUNCTION public.plan_from_contact();

-- 4.5 La liga la asigna dirección; la participación voluntaria la
-- decide cada quien.
CREATE OR REPLACE FUNCTION public.profiles_plan_track_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.plan_track IS DISTINCT FROM OLD.plan_track
     AND auth.uid() IS NOT NULL
     AND NOT is_account_member(NEW.account_id, 'admin') THEN
    RAISE EXCEPTION 'Only an admin can change a plan track' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER profiles_plan_track_guard
  BEFORE UPDATE OF plan_track ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_plan_track_guard();

CREATE OR REPLACE FUNCTION public.set_member_plan_track(p_user_id UUID, p_track TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE user_id = p_user_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE = '22023';
  END IF;
  IF NOT is_account_member(v_account, 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher' USING ERRCODE = '42501';
  END IF;
  IF p_track IS NOT NULL AND p_track NOT IN ('advisor', 'broker', 'director', 'none') THEN
    RAISE EXCEPTION 'Invalid plan track' USING ERRCODE = '22023';
  END IF;
  UPDATE profiles SET plan_track = p_track WHERE user_id = p_user_id;
END;
$$;
ALTER FUNCTION public.set_member_plan_track(UUID, TEXT) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.set_member_plan_track(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_plan_track(UUID, TEXT) TO authenticated;

-- 4.6 Conteos por día y métrica. Cada quien los suyos; quien ve todos
-- los prospectos (owner, admin, viewer) ve los de todo el equipo.
CREATE OR REPLACE FUNCTION public.plan_counts(p_account_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (user_id UUID, day DATE, metric TEXT, n INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.user_id, a.activity_day, a.metric, count(*)::int
    FROM plan_activities a
   WHERE a.account_id = p_account_id
     AND is_account_member(p_account_id)
     AND a.activity_day BETWEEN p_from AND p_to
     AND (a.user_id = auth.uid() OR sees_all_prospects(p_account_id))
   GROUP BY a.user_id, a.activity_day, a.metric;
$$;
ALTER FUNCTION public.plan_counts(UUID, DATE, DATE) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.plan_counts(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_counts(UUID, DATE, DATE) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5 · Metas y premios de arranque (escenario medio del plan;
--     dirección los ajusta en Configuración → Plan)
-- ------------------------------------------------------------
INSERT INTO plan_goals (account_id, track, period, metric, target, sort_order)
SELECT a.id, g.track, g.period, g.metric, g.target, g.sort_order
  FROM accounts a
 CROSS JOIN (VALUES
   ('advisor', 'day', 'new_attempts', 10, 1),
   ('advisor', 'day', 'conversations', 3, 2),
   ('advisor', 'day', 'followups', 5, 3),
   ('advisor', 'day', 'social_posts', 1, 4),
   ('advisor', 'week', 'appointments_set', 3, 5),
   ('advisor', 'week', 'presentations', 2, 6),
   ('advisor', 'week', 'quotes_sent', 2, 7),
   ('advisor', 'week', 'referrals_asked', 2, 8),
   ('advisor', 'month', 'presentations', 7, 9),
   ('advisor', 'month', 'reservations', 1, 10),
   ('advisor', 'quarter', 'reservations', 3, 11),
   ('broker', 'month', 'prospects_registered', 8, 1),
   ('broker', 'month', 'appointments_set', 2, 2),
   ('broker', 'quarter', 'reservations', 1, 3),
   ('director', 'week', 'team_meetings', 1, 1),
   ('director', 'week', 'one_on_ones', 2, 2),
   ('director', 'week', 'networking_meetings', 11, 3),
   ('director', 'week', 'broker_contacts', 10, 4),
   ('director', 'week', 'broker_agreements', 3, 5),
   ('director', 'week', 'accompanied_appointments', 1, 6),
   ('director', 'week', 'ads_reviews', 1, 7),
   ('director', 'month', 'partner_reports', 1, 8)
 ) AS g(track, period, metric, target, sort_order)
ON CONFLICT (account_id, track, period, metric) DO NOTHING;

INSERT INTO plan_prizes (account_id, track, level, title, description)
SELECT a.id, p.track, p.level, p.title, p.description
  FROM accounts a
 CROSS JOIN (VALUES
   ('advisor', 'week', 'Prioridad en el reparto de leads', 'La semana siguiente recibes primero los leads nuevos.'),
   ('advisor', 'month', 'Premio del mes', 'Por definir con los socios.'),
   ('advisor', 'quarter', 'Premio mayor', 'iPhone o laptop. Por confirmar con los socios.'),
   ('broker', 'quarter', 'Premio mayor de brókers', 'Por definir con los socios.')
 ) AS p(track, level, title, description)
ON CONFLICT (account_id, track, level) DO NOTHING;
