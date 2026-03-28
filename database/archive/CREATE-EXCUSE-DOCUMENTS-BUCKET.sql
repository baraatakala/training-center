-- Create the "excuse-documents" storage bucket in Supabase
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Required for: excuse request document uploads (ExcuseRequests.tsx)

-- 1. Create the bucket (public so documents can be viewed by teachers)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'excuse-documents',
  'excuse-documents',
  true,
  5242880,  -- 5 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Allow authenticated users to upload to their own folder
CREATE POLICY "Students can upload excuse documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'excuse-documents');

-- 3. Allow anyone to view/download excuse documents (public bucket)
CREATE POLICY "Public read access for excuse documents"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'excuse-documents');

-- 4. Allow authenticated users to delete their own documents
CREATE POLICY "Users can delete own excuse documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'excuse-documents');
