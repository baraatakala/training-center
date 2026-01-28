-- Migration: Add photo_url field to student table for face recognition attendance
-- Date: 2026-01-28

-- Add photo_url column to store the reference photo URL from Supabase Storage
ALTER TABLE student 
ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN student.photo_url IS 'URL to student reference photo stored in Supabase Storage for face recognition attendance';

-- Create storage bucket for student photos (run this in Supabase Dashboard > Storage)
-- Bucket name: student-photos
-- Public: false (authenticated access only)
-- File size limit: 5MB
-- Allowed MIME types: image/jpeg, image/png, image/webp

-- Storage policies (run in SQL Editor):
-- Allow authenticated users to upload their own photo
-- Allow authenticated users to view all photos (for face comparison)

/*
-- Storage Policies to create in Supabase Dashboard:

-- 1. INSERT policy (students can upload their own photo)
CREATE POLICY "Students can upload their own photo"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'student-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- 2. SELECT policy (authenticated users can view photos for comparison)
CREATE POLICY "Authenticated users can view student photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'student-photos');

-- 3. UPDATE policy (students can update their own photo)
CREATE POLICY "Students can update their own photo"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'student-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- 4. DELETE policy (students can delete their own photo)
CREATE POLICY "Students can delete their own photo"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'student-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
*/

-- Verification query
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'student' AND column_name = 'photo_url';
