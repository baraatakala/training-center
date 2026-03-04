/**
 * Excuse Request Service
 * 
 * Handles CRUD operations for student absence excuse requests.
 * Students submit requests → Teachers/Admins approve/reject.
 * On approval, the corresponding attendance record is updated to 'excused'.
 */

import { supabase } from '../lib/supabase';

export interface ExcuseRequest {
  request_id: string;
  student_id: string;
  session_id: string;
  attendance_date: string;
  reason: string;
  description: string | null;
  supporting_doc_url: string | null;
  supporting_doc_name: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  student?: { student_id: string; name: string; email: string; phone: string | null };
  session?: { 
    session_id: string; 
    course_id: string;
    course?: { course_name: string };
    teacher?: { teacher_id: string; name: string };
  };
}

export interface CreateExcuseRequest {
  student_id: string;
  session_id: string;
  attendance_date: string;
  reason: string;
  description?: string;
  supporting_doc_url?: string;
  supporting_doc_name?: string;
}

export interface ReviewExcuseRequest {
  status: 'approved' | 'rejected';
  reviewed_by: string;
  review_note?: string;
}

export const EXCUSE_REASONS = [
  { value: 'sick', label: 'Sick / Medical', labelAr: 'مرض / طبي', icon: '🏥' },
  { value: 'abroad', label: 'Abroad / Travel', labelAr: 'سفر', icon: '✈️' },
  { value: 'working', label: 'Work / Employment', labelAr: 'عمل', icon: '💼' },
  { value: 'family', label: 'Family Emergency', labelAr: 'طوارئ عائلية', icon: '👨‍👩‍👧' },
  { value: 'emergency', label: 'Personal Emergency', labelAr: 'طوارئ شخصية', icon: '🚨' },
  { value: 'other', label: 'Other', labelAr: 'أخرى', icon: '📝' },
] as const;

class ExcuseRequestService {
  /**
   * Get all excuse requests (with student and session info)
   * Teachers see their session requests, admins see all
   */
  async getAll(filters?: { 
    status?: string; 
    session_id?: string; 
    student_id?: string;
    course_id?: string;
  }) {
    let query = supabase
      .from('excuse_request')
      .select(`
        *,
        student:student_id(student_id, name, email, phone),
        session:session_id(
          session_id, 
          course_id,
          course:course_id(course_name),
          teacher:teacher_id(teacher_id, name)
        )
      `)
      .order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.session_id) query = query.eq('session_id', filters.session_id);
    if (filters?.student_id) query = query.eq('student_id', filters.student_id);
    if (filters?.course_id) {
      // Filter by course through session join
      query = query.eq('session.course_id', filters.course_id);
    }

    const { data, error } = await query;
    return { data: data as ExcuseRequest[] | null, error };
  }

  /**
   * Get requests for a specific student
   */
  async getByStudent(studentId: string) {
    const { data, error } = await supabase
      .from('excuse_request')
      .select(`
        *,
        session:session_id(
          session_id,
          course_id, 
          course:course_id(course_name),
          teacher:teacher_id(teacher_id, name)
        )
      `)
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    return { data: data as ExcuseRequest[] | null, error };
  }

  /**
   * Get pending request count (for badge display)
   */
  async getPendingCount() {
    const { count, error } = await supabase
      .from('excuse_request')
      .select('request_id', { count: 'exact', head: true })
      .eq('status', 'pending');

    return { count: count || 0, error };
  }

  /**
   * Submit a new excuse request (student action)
   */
  async create(request: CreateExcuseRequest) {
    const { data, error } = await supabase
      .from('excuse_request')
      .insert({
        student_id: request.student_id,
        session_id: request.session_id,
        attendance_date: request.attendance_date,
        reason: request.reason,
        description: request.description || null,
        supporting_doc_url: request.supporting_doc_url || null,
        supporting_doc_name: request.supporting_doc_name || null,
        status: 'pending',
      })
      .select()
      .single();

    if (!error && data) {
      // Log to audit
      await supabase.from('audit_log').insert({
        table_name: 'excuse_request',
        record_id: data.request_id,
        operation: 'INSERT',
        new_data: data,
      });
    }

    return { data, error };
  }

  /**
   * Review (approve/reject) an excuse request (teacher/admin action)
   * On approval, also updates the attendance record to 'excused'
   */
  async review(requestId: string, review: ReviewExcuseRequest) {
    // 1. Get the request details first
    const { data: request, error: fetchError } = await supabase
      .from('excuse_request')
      .select('*')
      .eq('request_id', requestId)
      .single();

    if (fetchError || !request) {
      return { data: null, error: fetchError || new Error('Request not found') };
    }

    // 2. Update the request status
    const { data: updated, error: updateError } = await supabase
      .from('excuse_request')
      .update({
        status: review.status,
        reviewed_by: review.reviewed_by,
        reviewed_at: new Date().toISOString(),
        review_note: review.review_note || null,
      })
      .eq('request_id', requestId)
      .select()
      .single();

    if (updateError) return { data: null, error: updateError };

    // 3. If approved, update the attendance record to 'excused'
    if (review.status === 'approved') {
      const { error: attendanceError } = await supabase
        .from('attendance')
        .update({
          status: 'excused',
          excuse_reason: request.reason,
        })
        .eq('student_id', request.student_id)
        .eq('session_id', request.session_id)
        .eq('attendance_date', request.attendance_date);

      if (attendanceError) {
        console.error('Failed to update attendance on approval:', attendanceError);
        // Don't fail the whole operation — request is approved
      }
    }

    // 4. Audit log
    await supabase.from('audit_log').insert({
      table_name: 'excuse_request',
      record_id: requestId,
      operation: 'UPDATE',
      old_data: request,
      new_data: updated,
    });

    return { data: updated, error: null };
  }

  /**
   * Cancel a pending request (student action)
   */
  async cancel(requestId: string) {
    const { data, error } = await supabase
      .from('excuse_request')
      .update({ status: 'cancelled' })
      .eq('request_id', requestId)
      .eq('status', 'pending') // Only cancel pending requests
      .select()
      .single();

    return { data, error };
  }

  /**
   * Delete a request (admin only)
   */
  async delete(requestId: string) {
    const { data: existing } = await supabase
      .from('excuse_request')
      .select('*')
      .eq('request_id', requestId)
      .single();

    const { error } = await supabase
      .from('excuse_request')
      .delete()
      .eq('request_id', requestId);

    if (!error && existing) {
      await supabase.from('audit_log').insert({
        table_name: 'excuse_request',
        record_id: requestId,
        operation: 'DELETE',
        old_data: existing,
      });
    }

    return { error };
  }

  /**
   * Upload supporting document to Supabase Storage
   */
  async uploadDocument(file: File, studentId: string): Promise<{ url: string | null; error: Error | null }> {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${studentId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('excuse-documents')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        // If bucket doesn't exist, log helpful message
        console.error('Upload error (ensure "excuse-documents" bucket exists in Supabase Storage):', uploadError);
        return { url: null, error: uploadError as unknown as Error };
      }

      const { data: urlData } = supabase.storage
        .from('excuse-documents')
        .getPublicUrl(fileName);

      return { url: urlData.publicUrl, error: null };
    } catch (err) {
      return { url: null, error: err as Error };
    }
  }
}

export const excuseRequestService = new ExcuseRequestService();
