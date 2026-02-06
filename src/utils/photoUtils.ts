import { supabase } from '../lib/supabase';

// Helper function to get signed URL from file path
export async function getSignedPhotoUrl(filePath: string): Promise<string | null> {
  if (!filePath) return null;
  
  // If it's already a full URL (legacy), try to use it
  if (filePath.startsWith('http')) {
    return filePath;
  }
  
  const { data, error } = await supabase.storage
    .from('student-photos')
    .createSignedUrl(filePath, 60 * 60); // 1 hour validity
    
  if (error || !data?.signedUrl) {
    console.error('Failed to get signed URL:', error);
    return null;
  }
  
  return data.signedUrl;
}
