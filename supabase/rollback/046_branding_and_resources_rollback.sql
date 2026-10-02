-- Reversa de 046. BORRA la tabla de recursos y las columnas de marca.
-- Los archivos de los buckets no se borran aquí.
DROP POLICY IF EXISTS "Branding and resources are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload branding and resources" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update branding and resources" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete branding and resources" ON storage.objects;
DROP FUNCTION IF EXISTS public.account_admin_object_writable(TEXT);
DROP TABLE IF EXISTS resources;
ALTER TABLE accounts
  DROP COLUMN IF EXISTS brand_name,
  DROP COLUMN IF EXISTS brand_logo_url,
  DROP COLUMN IF EXISTS brand_logo_dark_url,
  DROP COLUMN IF EXISTS brand_icon_url,
  DROP COLUMN IF EXISTS brand_icon_dark_url;
