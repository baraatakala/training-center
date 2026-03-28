-- ============================================================================
-- Training Center — Storage Buckets & Policies
-- ============================================================================
-- Run order: 5 of 6 (after rls-policies.sql)
-- Supabase storage bucket configuration for file uploads.
-- ============================================================================

-- ============================================================================
-- 1. EXCUSE DOCUMENTS BUCKET
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'excuse-documents',
  'excuse-documents',
  true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Students can upload excuse documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'excuse-documents');

CREATE POLICY "Public read access for excuse documents"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'excuse-documents');

CREATE POLICY "Users can delete own excuse documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'excuse-documents');

-- ============================================================================
-- 2. ANNOUNCEMENT IMAGES BUCKET
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'announcement-images',
  'announcement-images',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload announcement images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'announcement-images');

CREATE POLICY "Authenticated users can read announcement images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'announcement-images');

CREATE POLICY "Teachers can delete announcement images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'announcement-images');
