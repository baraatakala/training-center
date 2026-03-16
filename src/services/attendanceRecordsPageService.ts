import { supabase } from '../lib/supabase';

export interface AttendanceRecordsPageRecord {
  attendance_id: string;
  student_id: string;
  student_specialization?: string | null;
  session_id: string;
  attendance_date: string;
  status: 'on time' | 'absent' | 'late' | 'excused' | 'not enrolled';
  excuse_reason?: string | null;
  late_minutes?: number | null;
  early_minutes?: number | null;
  check_in_method?: string | null;
  distance_from_host?: number | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
  gps_timestamp: string | null;
  marked_by: string | null;
  marked_at: string | null;
  student_name: string;
  course_id: string;
  course_name: string;
  teacher_id: string;
  instructor_name: string;
  session_location: string | null;
  host_address: string | null;
  book_topic?: string | null;
  book_start_page?: number | null;
  book_end_page?: number | null;
}

export async function loadAttendanceRecordsPageData(studentIds: string[]) {
  let query = supabase
    .from('attendance')
    .select(`
      attendance_id,
      student_id,
      session_id,
      enrollment_id,
      attendance_date,
      status,
      excuse_reason,
      late_minutes,
      early_minutes,
      check_in_method,
      distance_from_host,
      gps_latitude,
      gps_longitude,
      gps_accuracy,
      gps_timestamp,
      marked_by,
      marked_at,
      host_address,
      student:student_id (name, specialization),
      enrollment:enrollment_id (enrollment_date),
      session:session_id (
        location,
        course_id,
        teacher_id,
        course:course_id (course_name),
        teacher:teacher_id (name)
      )
    `)
    .not('status', 'is', null);

  if (studentIds.length === 1) {
    query = query.eq('student_id', studentIds[0]);
  } else if (studentIds.length > 1) {
    query = query.in('student_id', studentIds);
  }

  const { data, error } = await query
    .order('attendance_date', { ascending: false })
    .order('marked_at', { ascending: false })
    .limit(5000);

  if (error) {
    return { data: null, error, hostGpsLookup: new Map<string, { lat: number; lon: number }>(), warnings: [] as string[] };
  }

  const warnings: string[] = [];
  const sessionDatePairs = [...new Set(data?.map((record) => `${record.session_id}|${record.attendance_date}`) || [])];

  const [coverageRes, hostRes] = await Promise.all([
    sessionDatePairs.length > 0
      ? supabase
          .from('session_book_coverage')
          .select(`
            session_id,
            attendance_date,
            course_book_reference!inner (
              topic,
              start_page,
              end_page
            )
          `)
      : Promise.resolve({ data: null, error: null }),
    sessionDatePairs.length > 0
      ? supabase
          .from('session_date_host')
          .select('session_id, attendance_date, host_address, host_id, host_type, host_latitude, host_longitude')
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (coverageRes.error) warnings.push('Failed to load book coverage data.');
  if (hostRes.error) warnings.push('Failed to load host address data.');

  const bookCoverageMap = new Map<string, { topic: string; start_page: number; end_page: number }>();
  const hostAddressMap = new Map<string, string>();
  const hostGpsLookup = new Map<string, { lat: number; lon: number }>();

  if (coverageRes.data) {
    coverageRes.data.forEach((coverage: { session_id: string; attendance_date: string; course_book_reference: Array<{ topic: string; start_page: number; end_page: number }> }) => {
      const key = `${coverage.session_id}|${coverage.attendance_date}`;
      const ref = Array.isArray(coverage.course_book_reference) ? coverage.course_book_reference[0] : coverage.course_book_reference;
      if (ref) {
        bookCoverageMap.set(key, {
          topic: ref.topic,
          start_page: ref.start_page,
          end_page: ref.end_page,
        });
      }
    });
  }

  if (hostRes.data) {
    const studentHostIds = new Set<string>();
    const teacherHostIds = new Set<string>();
    const hostEntries: Array<{ session_id: string; attendance_date: string; host_address: string; host_id: string | null; host_type: string | null; host_latitude: number | null; host_longitude: number | null }> = hostRes.data;

    hostEntries.forEach((hostEntry) => {
      const key = `${hostEntry.session_id}|${hostEntry.attendance_date}`;
      hostAddressMap.set(key, hostEntry.host_address);
      if (hostEntry.host_latitude != null && hostEntry.host_longitude != null) {
        hostGpsLookup.set(hostEntry.host_address, { lat: hostEntry.host_latitude, lon: hostEntry.host_longitude });
      }
      if (hostEntry.host_id) {
        if (hostEntry.host_type === 'teacher') teacherHostIds.add(hostEntry.host_id);
        else studentHostIds.add(hostEntry.host_id);
      }
    });

    const [studentGpsRes, teacherGpsRes] = await Promise.all([
      studentHostIds.size > 0
        ? supabase.from('student').select('student_id, address_latitude, address_longitude').in('student_id', [...studentHostIds])
        : Promise.resolve({ data: null }),
      teacherHostIds.size > 0
        ? supabase.from('teacher').select('teacher_id, address_latitude, address_longitude').in('teacher_id', [...teacherHostIds])
        : Promise.resolve({ data: null }),
    ]);

    const hostIdGps = new Map<string, { lat: number; lon: number }>();
    if (studentGpsRes.data) {
      studentGpsRes.data.forEach((student: { student_id: string; address_latitude: number | null; address_longitude: number | null }) => {
        if (student.address_latitude != null && student.address_longitude != null) {
          hostIdGps.set(student.student_id, { lat: Number(student.address_latitude), lon: Number(student.address_longitude) });
        }
      });
    }
    if (teacherGpsRes.data) {
      teacherGpsRes.data.forEach((teacher: { teacher_id: string; address_latitude: number | null; address_longitude: number | null }) => {
        if (teacher.address_latitude != null && teacher.address_longitude != null) {
          hostIdGps.set(teacher.teacher_id, { lat: Number(teacher.address_latitude), lon: Number(teacher.address_longitude) });
        }
      });
    }

    hostEntries.forEach((hostEntry) => {
      if (!hostGpsLookup.has(hostEntry.host_address) && hostEntry.host_id) {
        const profileGps = hostIdGps.get(hostEntry.host_id);
        if (profileGps) {
          hostGpsLookup.set(hostEntry.host_address, profileGps);
        }
      }
    });
  }

  const formattedRecords: AttendanceRecordsPageRecord[] = (data || []).map((record: Record<string, unknown>) => {
    const bookKey = `${record.session_id as string}|${record.attendance_date as string}`;
    const bookInfo = bookCoverageMap.get(bookKey);
    const hostAddress = hostAddressMap.get(bookKey) || (record.host_address as string | null) || null;
    const session = (record.session as Record<string, unknown>) || {};
    const student = (record.student as Record<string, unknown>) || {};
    const course = (session.course as Record<string, unknown>) || {};
    const teacher = (session.teacher as Record<string, unknown>) || {};

    let enrollmentDate: string | null = null;
    if (record.enrollment) {
      if (Array.isArray(record.enrollment) && record.enrollment.length > 0) {
        enrollmentDate = (record.enrollment[0] as { enrollment_date?: string }).enrollment_date || null;
      } else if (typeof record.enrollment === 'object') {
        enrollmentDate = ((record.enrollment as { enrollment_date?: string }).enrollment_date) || null;
      }
    }

    let finalStatus = record.status as AttendanceRecordsPageRecord['status'];
    if (enrollmentDate && (record.attendance_date as string) < enrollmentDate) {
      finalStatus = 'not enrolled';
    }

    return {
      attendance_id: record.attendance_id as string,
      student_id: record.student_id as string,
      student_specialization: (student.specialization as string | null) || null,
      session_id: record.session_id as string,
      attendance_date: record.attendance_date as string,
      status: finalStatus,
      excuse_reason: (record.excuse_reason as string | null) || null,
      late_minutes: (record.late_minutes as number | null) || null,
      early_minutes: (record.early_minutes as number | null) || null,
      check_in_method: (record.check_in_method as string | null) || null,
      distance_from_host: (record.distance_from_host as number | null) || null,
      gps_latitude: (record.gps_latitude as number | null) ?? null,
      gps_longitude: (record.gps_longitude as number | null) ?? null,
      gps_accuracy: (record.gps_accuracy as number | null) ?? null,
      gps_timestamp: (record.gps_timestamp as string | null) ?? null,
      marked_by: (record.marked_by as string | null) ?? null,
      marked_at: (record.marked_at as string | null) ?? null,
      host_address: hostAddress,
      student_name: (student.name as string) || 'Unknown',
      course_id: (session.course_id as string) || '',
      course_name: (course.course_name as string) || 'Unknown',
      teacher_id: (session.teacher_id as string) || '',
      instructor_name: (teacher.name as string) || 'Unknown',
      session_location: (session.location as string | null) || null,
      book_topic: bookInfo?.topic || null,
      book_start_page: bookInfo?.start_page || null,
      book_end_page: bookInfo?.end_page || null,
    };
  });

  return { data: formattedRecords, error: null, hostGpsLookup, warnings };
}