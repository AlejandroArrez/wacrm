-- ============================================================
-- 045 · Fichas de modelos
--
-- Una ficha por modelo (tipología) que el agente de IA manda por
-- WhatsApp: imagen, superficie, terraza, recámaras, baños, pisos,
-- texto corto y brochure en PDF, con botones de respuesta.
--
--   1. Tabla `model_cards`, por cuenta. Cualquier miembro la lee; solo
--      admin u owner la crea, edita o borra (mismo criterio que la 044).
--   2. Bucket público `model-cards` para la imagen y el PDF. Público
--      porque Meta descarga el archivo por URL al enviarlo. Escribir
--      exige ser admin u owner de la cuenta dueña de la carpeta
--      `account-<account_id>/…`.
--
-- `image_url` acepta una URL completa o una ruta servida por la propia
-- app (`/fichas/porta-magna/atrium.jpg`); el envío la completa con
-- NEXT_PUBLIC_SITE_URL.
--
-- Aplicada en producción el 1 oct 2026. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS model_cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name              TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  image_url         TEXT,
  area_m2           NUMERIC(8,2) CHECK (area_m2 IS NULL OR area_m2 > 0),
  terrace_m2        NUMERIC(8,2) CHECK (terrace_m2 IS NULL OR terrace_m2 >= 0),
  bedrooms          NUMERIC(3,1) CHECK (bedrooms IS NULL OR bedrooms >= 0),
  bathrooms         NUMERIC(3,1) CHECK (bathrooms IS NULL OR bathrooms >= 0),
  floors_text       TEXT CHECK (floors_text IS NULL OR char_length(floors_text) <= 60),
  description       TEXT CHECK (description IS NULL OR char_length(description) <= 600),
  brochure_url      TEXT,
  brochure_filename TEXT CHECK (brochure_filename IS NULL OR char_length(brochure_filename) <= 120),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, slug)
);

CREATE INDEX IF NOT EXISTS model_cards_account_idx
  ON model_cards (account_id, sort_order);

DROP TRIGGER IF EXISTS set_updated_at ON model_cards;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON model_cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE model_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS model_cards_select ON model_cards;
CREATE POLICY model_cards_select ON model_cards FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS model_cards_insert ON model_cards;
CREATE POLICY model_cards_insert ON model_cards FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS model_cards_update ON model_cards;
CREATE POLICY model_cards_update ON model_cards FOR UPDATE
  USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS model_cards_delete ON model_cards;
CREATE POLICY model_cards_delete ON model_cards FOR DELETE
  USING (is_account_member(account_id, 'admin'::account_role_enum));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'model-cards',
  'model-cards',
  TRUE,
  16777216,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.model_card_object_writable(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.user_id = auth.uid()
       AND p.account_role IN ('owner', 'admin')
       AND ('account-' || p.account_id::text) = (storage.foldername(p_name))[1]
  );
$$;

DROP POLICY IF EXISTS "Model cards are publicly readable" ON storage.objects;
CREATE POLICY "Model cards are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'model-cards');

DROP POLICY IF EXISTS "Admins can upload model card files" ON storage.objects;
CREATE POLICY "Admins can upload model card files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'model-cards' AND public.model_card_object_writable(name));

DROP POLICY IF EXISTS "Admins can update model card files" ON storage.objects;
CREATE POLICY "Admins can update model card files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'model-cards' AND public.model_card_object_writable(name));

DROP POLICY IF EXISTS "Admins can delete model card files" ON storage.objects;
CREATE POLICY "Admins can delete model card files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'model-cards' AND public.model_card_object_writable(name));
