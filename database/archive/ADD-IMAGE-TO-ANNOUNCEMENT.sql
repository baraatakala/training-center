-- =========================================================
-- ADD IMAGE_URL TO ANNOUNCEMENT TABLE
-- =========================================================
-- Adds photo/image support to announcements.
-- Run this once in Supabase SQL Editor.
-- =========================================================

-- 1. Add the image_url column
ALTER TABLE announcement 
ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;

-- 2. Create storage bucket for announcement images (if not exists)
-- Note: If 'announcement-images' bucket creation fails via SQL,
-- create it manually in Supabase Dashboard > Storage > New Bucket:
--   Name: announcement-images
--   Public: false (use signed URLs)
--   File size limit: 5MB
--   Allowed MIME types: image/jpeg, image/png, image/gif, image/webp

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'announcement-images',
  'announcement-images',
  false,
  5242880,  -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage policies: allow authenticated users to upload and read
CREATE POLICY "Authenticated users can upload announcement images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'announcement-images');

CREATE POLICY "Authenticated users can read announcement images"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'announcement-images');

CREATE POLICY "Teachers can delete announcement images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'announcement-images');

-- Done! The announcement table now supports image_url and
-- the storage bucket is ready for image uploads.
