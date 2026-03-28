import { supabase } from '@/shared/lib/supabase';

// Image upload helper
export const uploadAnnouncementImage = async (file: File): Promise<string | null> => {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `announcements/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('announcement-images')
      .upload(filePath, file, { cacheControl: '3600', upsert: false });

    if (uploadError) {
      // If bucket doesn't exist, try 'student-photos' bucket as fallback
      const { error: fallbackError } = await supabase.storage
        .from('student-photos')
        .upload(`announcements/${fileName}`, file, { cacheControl: '3600', upsert: false });
      
      if (fallbackError) {
        console.error('Upload failed:', fallbackError);
        return null;
      }
      return `announcements/${fileName}`;
    }
    return filePath;
  } catch (err) {
    console.error('Image upload error:', err);
    return null;
  }
};

export const getAnnouncementImageUrl = async (filePath: string): Promise<string | null> => {
  if (!filePath) return null;
  if (filePath.startsWith('http')) return filePath;

  // Try announcement-images bucket first
  const { data, error: imgErr } = await supabase.storage
    .from('announcement-images')
    .createSignedUrl(filePath, 60 * 60);
  
  if (data?.signedUrl) return data.signedUrl;

  // Fallback to student-photos bucket
  const { data: fallback, error: fallbackErr } = await supabase.storage
    .from('student-photos')
    .createSignedUrl(filePath, 60 * 60);
  
  if (!fallback?.signedUrl && (imgErr || fallbackErr)) {
    console.error('Failed to get image URL:', imgErr?.message || fallbackErr?.message);
  }
  return fallback?.signedUrl || null;
};
