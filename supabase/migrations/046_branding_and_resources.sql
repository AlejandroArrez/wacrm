-- ============================================================
-- 046 · Marca personalizable y biblioteca de recursos
--
--   1. Marca por cuenta: nombre del CRM, logo e isotipo, cada uno en
--      versión para modo claro y oscuro. Las URL pueden ser completas
--      o rutas servidas por la app (`/branding/...`). Editar `accounts`
--      ya exige admin (migración 017), así que no hacen falta reglas
--      nuevas en la tabla.
--   2. `resources`: imágenes y videos aprobados que los asesores
--      descargan para redes sociales. Cualquier miembro los ve; solo
--      admin u owner los crea, edita o borra.
--   3. Buckets públicos `branding` y `resources`. Públicos porque el
--      logo se muestra antes de iniciar sesión y los recursos se
--      descargan con un enlace directo. Escribir exige ser admin u
--      owner de la cuenta dueña de la carpeta `account-<account_id>/…`.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Marca
-- ------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS brand_name TEXT
    CHECK (brand_name IS NULL OR char_length(btrim(brand_name)) BETWEEN 1 AND 40),
  ADD COLUMN IF NOT EXISTS brand_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS brand_logo_dark_url TEXT,
  ADD COLUMN IF NOT EXISTS brand_icon_url TEXT,
  ADD COLUMN IF NOT EXISTS brand_icon_dark_url TEXT;

-- ------------------------------------------------------------
-- 2. Recursos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  -- Texto sugerido para la publicación (2,200 = tope de Instagram).
  caption      TEXT CHECK (caption IS NULL OR char_length(caption) <= 2200),
  kind         TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  format       TEXT NOT NULL DEFAULT 'post'
                 CHECK (format IN ('post', 'story', 'reel', 'other')),
  -- Clave de la ficha del modelo (`model_cards.slug`); NULL = general.
  model_slug   TEXT CHECK (model_slug IS NULL OR model_slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  segment      TEXT CHECK (segment IS NULL OR segment IN
                 ('residente', 'inversionista', 'joven', 'diaspora', 'patrimonio')),
  -- Archivo en el bucket `resources`, o enlace externo (Drive, etc.)
  -- para videos que exceden el límite del bucket.
  file_url     TEXT,
  external_url TEXT CHECK (external_url IS NULL OR external_url ~* '^https?://'),
  file_name    TEXT CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  file_size    BIGINT CHECK (file_size IS NULL OR file_size >= 0),
  mime_type    TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (file_url IS NOT NULL OR external_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS resources_account_idx
  ON resources (account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON resources;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON resources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resources_select ON resources;
CREATE POLICY resources_select ON resources FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS resources_insert ON resources;
CREATE POLICY resources_insert ON resources FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS resources_update ON resources;
CREATE POLICY resources_update ON resources FOR UPDATE
  USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS resources_delete ON resources;
CREATE POLICY resources_delete ON resources FOR DELETE
  USING (is_account_member(account_id, 'admin'::account_role_enum));

-- ------------------------------------------------------------
-- 3. Buckets
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('branding', 'branding', TRUE, 2097152, -- 2 MB
   ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('resources', 'resources', TRUE, 52428800, -- 50 MB
   ARRAY['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Admin u owner de la cuenta dueña de la carpeta. Misma regla que
-- `model_card_object_writable` (045), con nombre genérico.
CREATE OR REPLACE FUNCTION public.account_admin_object_writable(p_name TEXT)
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

DROP POLICY IF EXISTS "Branding and resources are publicly readable" ON storage.objects;
CREATE POLICY "Branding and resources are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id IN ('branding', 'resources'));

DROP POLICY IF EXISTS "Admins can upload branding and resources" ON storage.objects;
CREATE POLICY "Admins can upload branding and resources"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id IN ('branding', 'resources')
              AND public.account_admin_object_writable(name));

DROP POLICY IF EXISTS "Admins can update branding and resources" ON storage.objects;
CREATE POLICY "Admins can update branding and resources"
  ON storage.objects FOR UPDATE
  USING (bucket_id IN ('branding', 'resources')
         AND public.account_admin_object_writable(name));

DROP POLICY IF EXISTS "Admins can delete branding and resources" ON storage.objects;
CREATE POLICY "Admins can delete branding and resources"
  ON storage.objects FOR DELETE
  USING (bucket_id IN ('branding', 'resources')
         AND public.account_admin_object_writable(name));
