import type { sessionService } from '@/features/sessions/services/sessionService';

export type SessionWithDetails = {
  session_id: string;
  course_id: string;
  teacher_id: string;
  start_date: string;
  end_date: string;
  day: string | null;
  time: string | null;
  location: string | null;
  grace_period_minutes?: number;
  learning_method?: 'face_to_face' | 'online' | 'hybrid';
  virtual_provider?: 'zoom' | 'google_meet' | 'microsoft_teams' | 'other' | null;
  virtual_meeting_link?: string | null;
  requires_recording?: boolean;
  default_recording_visibility?: 'private_staff' | 'course_staff' | 'enrolled_students' | 'organization' | 'public_link' | null;
  feedback_enabled?: boolean;
  feedback_anonymous_allowed?: boolean;
  teacher_can_host?: boolean;
  course: {
    course_name: string;
    category: string;
  };
  teacher: {
    name: string;
  };
};

export type ScheduleConflicts = Awaited<ReturnType<typeof sessionService.checkScheduleConflicts>>['data'];

export const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
