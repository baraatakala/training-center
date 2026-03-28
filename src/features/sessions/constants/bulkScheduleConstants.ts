export type EnrollmentRow = {
  enrollment_id: string;
  student_id: string;
  student?: { name: string; address?: string | null; phone?: string | null };
  can_host?: boolean | null;
  host_date?: string | null;
  status?: string;
  is_teacher?: boolean; // Flag to identify teacher row
};

export interface BulkScheduleTableProps {
  sessionId: string;
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd
  // optional comma-separated days from session (e.g. "Monday, Wednesday")
  day?: string | null;
  time?: string | null;
  onClose?: () => void;
}

export type ExportFields = {
  studentName: boolean;
  address: boolean;
  phone: boolean;
  canHost: boolean;
  hostDate: boolean;
  enrollmentStatus: boolean;
  studentId: boolean;
};

export const DEFAULT_EXPORT_FIELDS: ExportFields = {
  studentName: true,
  address: true,
  phone: true,
  canHost: true,
  hostDate: true,
  enrollmentStatus: false,
  studentId: false,
};

// Arabic text (Unicode escapes to avoid encoding issues)
export const AR = {
  STUDENT_NAME: '\u0627\u0633\u0645 \u0627\u0644\u0637\u0627\u0644\u0628',
  ADDRESS: '\u0627\u0644\u0639\u0646\u0648\u0627\u0646',
  PHONE: '\u0627\u0644\u0647\u0627\u062a\u0641',
  CAN_HOST: '\u064a\u0645\u0643\u0646 \u0627\u0644\u0627\u0633\u062a\u0636\u0627\u0641\u0629',
  CAN_HOST_HE: '\u064a\u0645\u0643\u0646\u0647 \u0627\u0644\u0627\u0633\u062a\u0636\u0627\u0641\u0629',
  HOST_DATE: '\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0627\u0633\u062a\u0636\u0627\u0641\u0629',
  STATUS: '\u0627\u0644\u062d\u0627\u0644\u0629',
  STUDENT_ID: '\u0631\u0642\u0645 \u0627\u0644\u0637\u0627\u0644\u0628',
  STUDENT_ID_ALT: '\u0645\u0639\u0631\u0641 \u0627\u0644\u0637\u0627\u0644\u0628',
  YES: '\u0646\u0639\u0645',
  NO: '\u0644\u0627',
  HOST_SCHEDULE: '\u062c\u062f\u0648\u0644 \u0627\u0644\u0627\u0633\u062a\u0636\u0627\u0641\u0629',
  HOST_SCHEDULE_FILE: '\u062c\u062f\u0648\u0644_\u0627\u0644\u0627\u0633\u062a\u0636\u0627\u0641\u0629',
  ARABIC: '\u0639\u0631\u0628\u064a',
} as const;
