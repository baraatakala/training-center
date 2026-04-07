/**
 * Certificate Generator Service
 * 
 * Manages certificate templates + issuance.
 * Supports template placeholders: {{name}}, {{course}}, {{date}}, {{score}}, {{attendance}}, {{teacher}}
 */

import { supabase } from '@/shared/lib/supabase';

// =====================================================
// TYPES
// =====================================================

export interface CertificateTemplate {
  template_id: string;
  name: string;
  description: string | null;
  template_type: 'completion' | 'attendance' | 'achievement' | 'participation';
  min_score: number;
  min_attendance: number;
  style_config: StyleConfig;
  body_template: string;
  signature_name: string | null;
  signature_title: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StyleConfig {
  background_color: string;
  accent_color: string;
  font_family: string;
  border_style: 'classic' | 'modern' | 'minimal' | 'ornate';
  orientation: 'landscape' | 'portrait';
  logo_url?: string;
}

export interface IssuedCertificate {
  certificate_id: string;
  template_id: string;
  student_id: string;
  session_id: string | null;
  course_id: string | null;
  signer_teacher_id: string | null;
  signer_source: 'teacher_specialization' | 'template_default' | 'manual_override';
  signer_title_snapshot: string | null;
  certificate_number: string;
  verification_code: string;
  final_score: number | null;
  attendance_rate: number | null;
  status: 'draft' | 'issued' | 'revoked';
  issued_by: string | null;
  issued_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  resolved_body: string | null;
  signature_name: string | null;
  signature_title: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  template?: CertificateTemplate;
  student?: { student_id: string; name: string; email: string; photo_url?: string | null };
  session?: { session_id: string; course?: { course_name: string }; teacher?: { name: string } };
  course?: { course_id: string; course_name: string };
}

export interface CreateCertificateTemplate {
  name: string;
  description?: string;
  template_type: string;
  min_score?: number;
  min_attendance?: number;
  style_config?: Partial<StyleConfig>;
  body_template?: string;
  signature_name?: string;
  signature_title?: string;
}

export interface IssueCertificatePayload {
  template_id: string;
  student_id: string;
  session_id?: string;
  course_id?: string;
  signer_teacher_id?: string;
  final_score?: number;
  attendance_rate?: number;
  issued_by: string;
  signature_name?: string;
  signature_title?: string;
}

// =====================================================
// HELPERS
// =====================================================

/** Generate a short alphanumeric verification code */
function generateVerificationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** Generate a sequential certificate number: CERT-YYYYMMDD-XXXX */
function generateCertificateNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `CERT-${dateStr}-${rand}`;
}

/** Fill placeholders in template body */
export function resolveTemplate(
  template: string,
  data: {
    name?: string;
    course?: string;
    date?: string;
    score?: string | number;
    attendance?: string | number;
    teacher?: string;
  }
): string {
  let result = template;
  result = result.replace(/\{\{name\}\}/g, data.name || '—');
  result = result.replace(/\{\{course\}\}/g, data.course || '—');
  result = result.replace(/\{\{date\}\}/g, data.date || new Date().toLocaleDateString());
  result = result.replace(/\{\{score\}\}/g, String(data.score ?? '—'));
  result = result.replace(/\{\{attendance\}\}/g, String(data.attendance ?? '—'));
  result = result.replace(/\{\{teacher\}\}/g, data.teacher || '—');
  return result;
}

// =====================================================
// SERVICE
// =====================================================

class CertificateService {
  // ── Templates ──────────────────────────────────────

  async getTemplates(activeOnly = false) {
    let query = supabase
      .from('certificate_template')
      .select('*')
      .order('created_at', { ascending: false });

    if (activeOnly) query = query.eq('is_active', true);

    const { data, error } = await query;
    return { data: data as CertificateTemplate[] | null, error };
  }

  async getTemplate(id: string) {
    const { data, error } = await supabase
      .from('certificate_template')
      .select('*')
      .eq('template_id', id)
      .single();

    return { data: data as CertificateTemplate | null, error };
  }

  async createTemplate(payload: CreateCertificateTemplate) {
    const { data, error } = await supabase
      .from('certificate_template')
      .insert({
        name: payload.name,
        description: payload.description || null,
        template_type: payload.template_type,
        min_score: payload.min_score || 0,
        min_attendance: payload.min_attendance || 0,
        style_config: payload.style_config || {},
        body_template: payload.body_template || '',
        signature_name: payload.signature_name || null,
        signature_title: payload.signature_title || null,
      })
      .select()
      .single();

    return { data: data as CertificateTemplate | null, error };
  }

  async updateTemplate(id: string, updates: Partial<CreateCertificateTemplate>) {
    const { data, error } = await supabase
      .from('certificate_template')
      .update(updates)
      .eq('template_id', id)
      .select()
      .single();

    return { data: data as CertificateTemplate | null, error };
  }

  async deleteTemplate(id: string) {
    const { error } = await supabase
      .from('certificate_template')
      .delete()
      .eq('template_id', id);

    return { error };
  }

  // ── Issued Certificates ────────────────────────────

  async getIssuedCertificates(filters?: { student_id?: string; session_id?: string; status?: string }) {
    let query = supabase
      .from('issued_certificate')
      .select(`
        *,
        template:template_id(*),
        student:student_id(student_id, name, email, photo_url),
        session:session_id(
          session_id,
          course:course_id(course_name),
          teacher:teacher_id(name)
        ),
        course:course_id(course_id, course_name)
      `)
      .order('created_at', { ascending: false });

    if (filters?.student_id) query = query.eq('student_id', filters.student_id);
    if (filters?.session_id) query = query.eq('session_id', filters.session_id);
    if (filters?.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    return { data: data as IssuedCertificate[] | null, error };
  }

  /** Verify a certificate by its verification code */
  async verifyCertificate(code: string) {
    const { data, error } = await supabase
      .from('issued_certificate')
      .select(`
        *,
        template:template_id(*),
        student:student_id(student_id, name, email, photo_url),
        session:session_id(
          session_id,
          course:course_id(course_name),
          teacher:teacher_id(name)
        ),
        course:course_id(course_id, course_name)
      `)
      .eq('verification_code', code.toUpperCase())
      .maybeSingle();

    return { data: data as IssuedCertificate | null, error };
  }

  /** Issue a certificate to a student */
  async issueCertificate(payload: IssueCertificatePayload) {
    // Get the template
    const { data: template, error: tmplErr } = await this.getTemplate(payload.template_id);
    if (tmplErr || !template) {
      return { data: null, error: tmplErr || new Error('Template not found') };
    }

    // Get student name
    const { data: student } = await supabase
      .from('student')
      .select('name')
      .eq('student_id', payload.student_id)
      .single();

    // Get course + teacher info
    let courseName = '';
    let teacherName = '';
    let teacherId = payload.signer_teacher_id || null;
    let teacherSpecialization = '';
    if (payload.session_id) {
      const { data: session } = await supabase
        .from('session')
        .select('course:course_id(course_name), teacher:teacher_id(teacher_id, name, specialization)')
        .eq('session_id', payload.session_id)
        .single();
      if (session) {
        const s = session as Record<string, unknown>;
        courseName = (s.course as Record<string, string> | null)?.course_name || '';
        const teacher = s.teacher as Record<string, string> | null;
        teacherName = teacher?.name || '';
        teacherId = teacherId || teacher?.teacher_id || null;
        teacherSpecialization = teacher?.specialization || '';
      }
    } else if (payload.course_id) {
      // Resolve course name + teacher from course_id when no session selected
      const { data: course } = await supabase
        .from('course')
        .select('course_name, teacher:teacher_id(teacher_id, name, specialization)')
        .eq('course_id', payload.course_id)
        .single();
      if (course) {
        const c = course as Record<string, unknown>;
        courseName = (c.course_name as string) || '';
        const teacher = c.teacher as Record<string, string> | null;
        teacherName = teacher?.name || '';
        teacherId = teacherId || teacher?.teacher_id || null;
        teacherSpecialization = teacher?.specialization || '';
      }
    }

    if (teacherId && (!teacherName || !teacherSpecialization)) {
      const { data: teacher } = await supabase
        .from('teacher')
        .select('teacher_id, name, specialization')
        .eq('teacher_id', teacherId)
        .maybeSingle();

      if (teacher) {
        teacherName = teacherName || teacher.name || '';
        teacherSpecialization = teacherSpecialization || teacher.specialization || '';
      }
    }

    const resolvedSignatureName = payload.signature_name || teacherName || template.signature_name || null;
    const resolvedSignatureTitle = payload.signature_title || teacherSpecialization || template.signature_title || null;
    const signerSource = payload.signature_title
      ? 'manual_override'
      : teacherSpecialization
        ? 'teacher_specialization'
        : 'template_default';

    // Resolve template body
    const resolvedBody = resolveTemplate(template.body_template, {
      name: student?.name || '',
      course: courseName,
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      score: payload.final_score,
      attendance: payload.attendance_rate,
      teacher: teacherName,
    });

    const { data, error } = await supabase
      .from('issued_certificate')
      .insert({
        template_id: payload.template_id,
        student_id: payload.student_id,
        session_id: payload.session_id || null,
        course_id: payload.course_id || null,
        certificate_number: generateCertificateNumber(),
        verification_code: generateVerificationCode(),
        final_score: payload.final_score || null,
        attendance_rate: payload.attendance_rate || null,
        status: 'issued',
        issued_by: payload.issued_by,
        issued_at: new Date().toISOString(),
        resolved_body: resolvedBody,
        signature_name: resolvedSignatureName,
        signature_title: resolvedSignatureTitle,
        signer_teacher_id: teacherId,
        signer_source: signerSource,
        signer_title_snapshot: resolvedSignatureTitle,
      })
      .select()
      .single();

    if (!error && data) {
      await supabase.from('audit_log').insert({
        table_name: 'issued_certificate',
        record_id: data.certificate_id,
        operation: 'INSERT',
        new_data: data,
      });
    }

    return { data: data as IssuedCertificate | null, error };
  }

  /** Bulk-issue certificates to all qualifying students in a session */
  async bulkIssue(
    templateId: string,
    sessionId: string,
    studentScores: Array<{ student_id: string; final_score: number; attendance_rate: number }>,
    issuedBy: string
  ) {
    const { data: template, error: tmplErr } = await this.getTemplate(templateId);
    if (tmplErr || !template) {
      return { issued: 0, skipped: 0, errors: ['Template not found'] };
    }

    let issued = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const student of studentScores) {
      // Check qualifications
      if (student.final_score < template.min_score || student.attendance_rate < template.min_attendance) {
        skipped++;
        continue;
      }

      // Check if already issued
      const { data: existing } = await supabase
        .from('issued_certificate')
        .select('certificate_id')
        .eq('template_id', templateId)
        .eq('student_id', student.student_id)
        .eq('session_id', sessionId)
        .eq('status', 'issued')
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      const { error } = await this.issueCertificate({
        template_id: templateId,
        student_id: student.student_id,
        session_id: sessionId,
        final_score: student.final_score,
        attendance_rate: student.attendance_rate,
        issued_by: issuedBy,
      });

      if (error) {
        errors.push(`Student ${student.student_id}: ${error.message}`);
      } else {
        issued++;
      }
    }

    return { issued, skipped, errors };
  }

  /** Revoke a certificate */
  async revokeCertificate(certificateId: string, reason: string) {
    const { data, error } = await supabase
      .from('issued_certificate')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoke_reason: reason,
      })
      .eq('certificate_id', certificateId)
      .select()
      .single();

    return { data: data as IssuedCertificate | null, error };
  }

  // Lookups for IssueModal cascading dropdowns
  async getTeachersLookup() {
    return await supabase.from('teacher').select('teacher_id, name, specialization').order('name');
  }

  async getCoursesByTeacher(teacherId: string) {
    return await supabase
      .from('session')
      .select('course_id, course:course_id(course_id, course_name)')
      .eq('teacher_id', teacherId);
  }

  async getSessionsByTeacherAndCourse(teacherId: string, courseId: string) {
    return await supabase
      .from('session')
      .select('session_id, day, time, start_date')
      .eq('teacher_id', teacherId)
      .eq('course_id', courseId)
      .order('start_date', { ascending: false });
  }

  async getEnrolledStudents(sessionId: string) {
    return await supabase
      .from('enrollment')
      .select('student:student_id(student_id, name)')
      .eq('session_id', sessionId)
      .eq('status', 'active');
  }

  async getSessionIdsByTeacherAndCourse(teacherId: string, courseId: string) {
    return await supabase
      .from('session')
      .select('session_id')
      .eq('course_id', courseId)
      .eq('teacher_id', teacherId);
  }
}

export const certificateService = new CertificateService();
