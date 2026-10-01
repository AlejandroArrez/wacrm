-- Reversa de 045: quita las fichas de modelos. BORRA los datos de la tabla.
-- Los archivos del bucket no se borran aquí (se quitan desde el panel de Supabase si hace falta).
DROP POLICY IF EXISTS "Model cards are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload model card files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update model card files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete model card files" ON storage.objects;
DROP FUNCTION IF EXISTS public.model_card_object_writable(TEXT);
DROP TABLE IF EXISTS model_cards;
