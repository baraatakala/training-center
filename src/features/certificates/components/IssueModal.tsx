import { useState, useEffect } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { toast } from '@/shared/components/ui/toastUtils';
import {
  certificateService,
  type CertificateTemplate,
} from '@/features/certificates/services/certificateService';
import { attendanceService } from '@/features/attendance/services/attendanceService';

export function IssueModal({
  templates,
  onClose,
  onIssued,
  userEmail,
}: {
  templates: CertificateTemplate[];
  onClose: () => void;
  onIssued: () => void;
  userEmail: string;
}) {
  const [templateId, setTemplateId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [score, setScore] = useState(0);
  const [attendance, setAttendance] = useState(0);
  const [issuing, setIssuing] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [belowThresholdAcknowledged, setBelowThresholdAcknowledged] = useState(false);

  // Loaded data
  const [teachers, setTeachers] = useState<Array<{ teacher_id: string; name: string; specialization: string | null }>>([]);
  const [courses, setCourses] = useState<Array<{ course_id: string; course_name: string; teacher_id: string }>>([]);
  const [sessions, setSessions] = useState<Array<{ session_id: string; label: string }>>([]);
  const [students, setStudents] = useState<Array<{ student_id: string; name: string }>>([]);

  // Load teachers on mount
  useEffect(() => {
    const load = async () => {
      const { data, error } = await certificateService.getTeachersLookup();
      if (error) {
        toast.error('Failed to load teachers: ' + error.message);
        return;
      }
      if (data) setTeachers(data);
    };
    load();
  }, []);

  // Load courses when teacher changes
  useEffect(() => {
    setCourseId('');
    setSessionId('');
    setStudentId('');
    setCourses([]);
    setSessions([]);
    setStudents([]);
    if (!teacherId) return;
    const load = async () => {
      const { data, error } = await certificateService.getCoursesByTeacher(teacherId);
      if (error) {
        toast.error('Failed to load courses: ' + error.message);
        return;
      }
      if (data) {
        const unique = new Map<string, { course_id: string; course_name: string; teacher_id: string }>();
        for (const s of data) {
          const c = (Array.isArray(s.course) ? s.course[0] : s.course) as { course_id: string; course_name: string } | null;
          if (c && !unique.has(c.course_id)) {
            unique.set(c.course_id, { course_id: c.course_id, course_name: c.course_name, teacher_id: teacherId });
          }
        }
        setCourses(Array.from(unique.values()).sort((a, b) => a.course_name.localeCompare(b.course_name)));
      }
    };
    load();
    // Auto-fill signer metadata from teacher
    const t = teachers.find(t => t.teacher_id === teacherId);
    if (t && !signerName) setSignerName(t.name);
    if (t && !signerTitle && t.specialization) setSignerTitle(t.specialization);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId]);

  // Load sessions + enrolled students when course changes
  useEffect(() => {
    setSessionId('');
    setStudentId('');
    setSessions([]);
    setStudents([]);
    if (!courseId || !teacherId) return;
    const load = async () => {
      const { data: sessData, error: sessError } = await certificateService.getSessionsByTeacherAndCourse(teacherId, courseId);
      if (sessError) {
        toast.error('Failed to load sessions: ' + sessError.message);
        return;
      }
      if (sessData) {
        setSessions(sessData.map(s => {
          const parts: string[] = [];
          if (s.day) parts.push(s.day);
          if (s.time) parts.push(`@ ${s.time}`);
          if (s.start_date) parts.push(`(${s.start_date})`);
          return { session_id: s.session_id, label: parts.join(' ') || s.session_id };
        }));

        // Get enrolled students across ALL sessions for this course+teacher
        const sessionIds = sessData.map(s => s.session_id);
        if (sessionIds.length > 0) {
          const allStudents = await Promise.all(
            sessionIds.map(async (currentSessionId) => certificateService.getEnrolledStudents(currentSessionId))
          );
          const enrollError = allStudents.find((result) => result.error)?.error;
          const enrollData = allStudents.flatMap((result) => result.data || []);
          if (enrollError) {
            toast.error('Failed to load students: ' + enrollError.message);
            return;
          }
          if (enrollData) {
            const unique = new Map<string, { student_id: string; name: string }>();
            for (const e of enrollData) {
              const stu = (Array.isArray(e.student) ? e.student[0] : e.student) as { student_id: string; name: string } | null;
              if (stu && !unique.has(stu.student_id)) {
                unique.set(stu.student_id, { student_id: stu.student_id, name: stu.name });
              }
            }
            setStudents(Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name)));
          }
        }
      }
    };
    load();
  }, [courseId, teacherId]);

  // Re-filter students when a specific session is selected
  useEffect(() => {
    if (!sessionId || !courseId || !teacherId) return;
    setStudentId('');
    const load = async () => {
      const { data: enrollData, error: enrollError } = await certificateService.getEnrolledStudents(sessionId);
      if (enrollError) {
        toast.error('Failed to load students: ' + enrollError.message);
        return;
      }
      if (enrollData) {
        const unique = new Map<string, { student_id: string; name: string }>();
        for (const e of enrollData) {
          const stu = (Array.isArray(e.student) ? e.student[0] : e.student) as { student_id: string; name: string } | null;
          if (stu && !unique.has(stu.student_id)) {
            unique.set(stu.student_id, { student_id: stu.student_id, name: stu.name });
          }
        }
        setStudents(Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name)));
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Auto-fetch attendance stats when student + course selected
  useEffect(() => {
    if (!studentId || !courseId || !teacherId) return;
    const fetchStats = async () => {
      setLoadingStats(true);
      try {
        const { data: sessData, error: sessErr } = await certificateService.getSessionIdsByTeacherAndCourse(teacherId, courseId);
        if (sessErr) {
          toast.error('Failed to load attendance data');
          setLoadingStats(false);
          return;
        }
        const sessionIds = sessData?.map(s => s.session_id) || [];
        if (sessionIds.length === 0) { setLoadingStats(false); return; }

        // If a specific session is selected, use only that one
        const idsToQuery = sessionId ? [sessionId] : sessionIds;

        const { data: summary } = await attendanceService.getStudentAttendanceSummary(studentId, idsToQuery);
        if (summary) {
          setAttendance(summary.rate);
          setScore(summary.qualityRate);
        } else {
          setAttendance(0);
          setScore(0);
        }
      } catch { /* non-critical */ }
      setLoadingStats(false);
    };
    fetchStats();
  }, [studentId, courseId, teacherId, sessionId]);

  // Reset threshold acknowledgment when key form values change
  useEffect(() => {
    setBelowThresholdAcknowledged(false);
  }, [templateId, studentId, score, attendance]);

  // Computed: selected template and threshold status
  const selectedTemplate = templates.find(t => t.template_id === templateId);
  const belowMinScore = selectedTemplate && selectedTemplate.min_score > 0 && score < selectedTemplate.min_score;
  const belowMinAttendance = selectedTemplate && selectedTemplate.min_attendance > 0 && attendance < selectedTemplate.min_attendance;
  const hasThresholdWarning = !!(belowMinScore || belowMinAttendance);

  const handleIssue = async () => {
    if (!templateId || !studentId) {
      toast.error('Select a template and student');
      return;
    }
    // Threshold check \u2014 warn but allow override
    const selectedTemplate = templates.find(t => t.template_id === templateId);
    if (selectedTemplate && !belowThresholdAcknowledged) {
      const belowScore = selectedTemplate.min_score > 0 && score < selectedTemplate.min_score;
      const belowAttendance = selectedTemplate.min_attendance > 0 && attendance < selectedTemplate.min_attendance;
      if (belowScore || belowAttendance) {
        setBelowThresholdAcknowledged(true);
        toast.warning(
          `Student does not meet template requirements (${belowScore ? `Score: ${score}% < ${selectedTemplate.min_score}%` : ''}${belowScore && belowAttendance ? ', ' : ''}${belowAttendance ? `Attendance: ${attendance}% < ${selectedTemplate.min_attendance}%` : ''}). Click "Issue Anyway" to confirm.`
        );
        return;
      }
    }
    setIssuing(true);
    try {
      const { error } = await certificateService.issueCertificate({
        template_id: templateId,
        student_id: studentId,
        session_id: sessionId || undefined,
        course_id: courseId || undefined,
        signer_teacher_id: teacherId || undefined,
        final_score: score,
        attendance_rate: attendance,
        issued_by: userEmail,
        signature_name: signerName.trim() || undefined,
        signature_title: signerTitle.trim() || undefined,
      });
      if (error) {
        toast.error('Failed to issue certificate: ' + error.message);
      } else {
        toast.success('Certificate issued!');
        onIssued();
      }
    } finally {
      setIssuing(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Issue Certificate" size="lg">
      <div className="space-y-4">
        {/* Template */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Template <span className="text-red-500">*</span></label>
          <select
            value={templateId}
            onChange={e => setTemplateId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          >
            <option value="">Select template...</option>
            {templates.map(t => (
              <option key={t.template_id} value={t.template_id}>{t.name} ({t.template_type})</option>
            ))}
          </select>
        </div>

        {/* Teacher */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Teacher</label>
          <select
            value={teacherId}
            onChange={e => setTeacherId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          >
            <option value="">Select teacher...</option>
            {teachers.map(t => (
              <option key={t.teacher_id} value={t.teacher_id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Course */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course <span className="text-red-500">*</span></label>
          <select
            value={courseId}
            onChange={e => setCourseId(e.target.value)}
            disabled={!teacherId}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm disabled:opacity-50"
          >
            <option value="">{teacherId ? 'Select course...' : 'Select a teacher first'}</option>
            {courses.map(c => (
              <option key={c.course_id} value={c.course_id}>{c.course_name}</option>
            ))}
          </select>
        </div>

        {/* Session (optional) */}
        {sessions.length > 1 && courseId && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Session <span className="text-xs text-gray-400">(optional {'\u2014'} defaults to all sessions)</span>
            </label>
            <select
              value={sessionId}
              onChange={e => setSessionId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            >
              <option value="">All sessions (combined stats)</option>
              {sessions.map(s => (
                <option key={s.session_id} value={s.session_id}>{s.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Student */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Student <span className="text-red-500">*</span></label>
          <select
            value={studentId}
            onChange={e => setStudentId(e.target.value)}
            disabled={!courseId}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm disabled:opacity-50"
          >
            <option value="">{courseId ? `Select student... (${students.length} enrolled)` : 'Select a course first'}</option>
            {students.map(s => (
              <option key={s.student_id} value={s.student_id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Scores */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Final Score (%) {loadingStats && <span className="text-xs text-blue-500">loading...</span>}
            </label>
            <input
              type="number"
              value={score}
              onChange={e => setScore(Number(e.target.value))}
              min={0}
              max={100}
              step={0.1}
              className={`w-full px-3 py-2 rounded-lg border text-sm ${belowMinScore ? 'border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-600' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'}`}
            />
            {belowMinScore && (
              <p className="text-xs text-red-500 mt-1 font-medium">{'\u26A0'} Below minimum {selectedTemplate!.min_score}%</p>
            )}
            {studentId && courseId && !loadingStats && !belowMinScore && <p className="text-xs text-gray-400 mt-1">Auto-filled from attendance records</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Attendance Rate (%) {loadingStats && <span className="text-xs text-blue-500">loading...</span>}
            </label>
            <input
              type="number"
              value={attendance}
              onChange={e => setAttendance(Number(e.target.value))}
              min={0}
              max={100}
              step={0.1}
              className={`w-full px-3 py-2 rounded-lg border text-sm ${belowMinAttendance ? 'border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-600' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'}`}
            />
            {belowMinAttendance && (
              <p className="text-xs text-red-500 mt-1 font-medium">{'\u26A0'} Below minimum {selectedTemplate!.min_attendance}%</p>
            )}
          </div>
        </div>

        {/* Signer Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Signer Name</label>
            <input
              type="text"
              value={signerName}
              onChange={e => setSignerName(e.target.value)}
              placeholder="e.g. Dr. Ahmad"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            />
            {teacherId && !signerName && (
              <button
                type="button"
                onClick={() => {
                  const t = teachers.find(t => t.teacher_id === teacherId);
                  if (t) setSignerName(t.name);
                }}
                className="text-xs text-blue-500 hover:text-blue-700 mt-1"
              >
                Use teacher name
              </button>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Signer Title</label>
            <input
              type="text"
              value={signerTitle}
              onChange={e => setSignerTitle(e.target.value)}
              placeholder="e.g. Mathematics"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            />
            {teacherId && !signerTitle && (
              <button
                type="button"
                onClick={() => {
                  const t = teachers.find(t => t.teacher_id === teacherId);
                  if (t?.specialization) setSignerTitle(t.specialization);
                }}
                className="text-xs text-blue-500 hover:text-blue-700 mt-1"
              >
                Use teacher specialization
              </button>
            )}
          </div>
        </div>

        {/* Threshold requirements indicator */}
        {selectedTemplate && (selectedTemplate.min_score > 0 || selectedTemplate.min_attendance > 0) && (
          <div className={`p-3 rounded-lg border text-xs ${
            hasThresholdWarning
              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'
              : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
          }`}>
            <div className="font-semibold mb-1">{hasThresholdWarning ? '\u26A0 Template Requirements Not Met' : '\u2705 Template Requirements Met'}</div>
            <div className="flex gap-4">
              {selectedTemplate.min_score > 0 && (
                <span>Score: <strong>{score}%</strong> / {selectedTemplate.min_score}% min {score >= selectedTemplate.min_score ? '\u2713' : '\u2717'}</span>
              )}
              {selectedTemplate.min_attendance > 0 && (
                <span>Attendance: <strong>{attendance}%</strong> / {selectedTemplate.min_attendance}% min {attendance >= selectedTemplate.min_attendance ? '\u2713' : '\u2717'}</span>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleIssue}
            disabled={issuing || !templateId || !studentId}
            className={hasThresholdWarning && !belowThresholdAcknowledged ? '' : hasThresholdWarning && belowThresholdAcknowledged ? 'bg-amber-600 hover:bg-amber-700' : ''}
          >
            {issuing ? 'Issuing...' : hasThresholdWarning && !belowThresholdAcknowledged ? '\u26A0 Check Requirements' : hasThresholdWarning && belowThresholdAcknowledged ? '\u26A0 Issue Anyway' : '\u{1F393} Issue Certificate'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
