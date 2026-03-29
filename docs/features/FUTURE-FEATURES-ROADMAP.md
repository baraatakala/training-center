# Training Center — Future Features Roadmap

> Living document. Prioritized by impact and feasibility.
> Last updated: 2026-03-23

---

## Phase 1: Core Platform Hardening (Next Sprint)

### 1.1 Automated Attendance Workflows
- **Auto-mark absent**: Trigger function that runs at session end time — any enrolled student without a record gets marked absent automatically.
- **Scheduled session-not-held**: Allow teachers to pre-mark a future date as "not held" so the system auto-excuses in advance.
- **Late auto-calculation**: When check-in time is recorded, auto-calculate `late_minutes` based on session schedule (no manual entry).
- **Grace period enforcement**: Use `scoring_config.grace_period_minutes` to automatically categorize late vs on-time at check-in.

### 1.2 Notification System
- **Email notifications via Supabase Edge Functions**:
  - Excuse request submitted → notify teacher
  - Excuse approved/rejected → notify student
  - Announcement published → notify enrolled students
  - Certificate issued → notify student
- **In-app notification bell**: Real-time notifications using Supabase Realtime subscriptions.
- **WhatsApp integration via Twilio/360dialog**: Send attendance alerts and reminders through WhatsApp Business API.

### 1.3 Student Self-Service Portal
- **My Dashboard**: Personalized view showing attendance rate, upcoming sessions, recent announcements, certificates.
- **Attendance history chart**: Visual timeline of presence/absence per session.
- **Excuse request tracking**: Status timeline (submitted → under review → approved/rejected).
- **Certificate download**: Direct PDF download from the portal.
- **Profile management**: Update phone, address, photo.

---

## Phase 2: Analytics & Intelligence

### 2.1 Advanced Attendance Analytics
- **Trend analysis dashboard**: Weekly/monthly attendance trends per session, course, teacher.
- **Predictive risk scoring**: ML-based prediction of students likely to drop out (based on attendance patterns, engagement score, trend direction).
- **Heatmaps**: Day-of-week and time-of-day heatmaps showing when absences are most common.
- **Cohort comparison**: Compare attendance rates across different sessions of the same course.
- **Teacher effectiveness metrics**: Correlation between teacher and attendance rates.

### 2.2 Feedback Intelligence
- **Sentiment analysis**: NLP on open-text feedback to detect sentiment trends.
- **Question effectiveness scoring**: Analytics on which feedback questions produce actionable insights.
- **Auto-generated feedback summaries**: AI-summarized reports per session/teacher.
- **Comparative feedback dashboard**: Side-by-side comparison across sessions, teachers, time periods.
- **Student satisfaction index**: Computed metric from weighted feedback dimensions.

### 2.3 Reporting Engine
- **Scheduled report generation**: Auto-generate weekly/monthly PDF reports and email them.
- **Custom report builder**: Drag-and-drop report designer with configurable sections.
- **Government/ministry reports**: Pre-formatted templates for regulatory compliance reporting.
- **Attendance certificates**: Auto-generate attendance verification letters.
- **Financial reports**: If tuition tracking is added, revenue/enrollment financial summaries.

---

## Phase 3: Operational Expansion

### 3.1 Scheduling System
- **Academic calendar**: Define terms, holidays, exam periods.
- **Session scheduling wizard**: Create recurring sessions with automatic date generation.
- **Room/venue management**: Track available rooms, capacity, equipment.
- **Schedule conflict detection**: Prevent double-booking of teachers, rooms, or students.
- **Timetable view**: Weekly/monthly calendar view with drag-and-drop rescheduling.

### 3.2 Financial Module
- **Tuition fees management**: Define fee structures per course/session.
- **Payment tracking**: Record payments, generate receipts.
- **Installment plans**: Support payment in installments with reminders.
- **Scholarship management**: Track scholarship recipients and amounts.
- **Financial dashboard**: Revenue tracking, outstanding balances, payment trends.
- **Invoice generation**: Automated PDF invoices.

### 3.3 Examination & Grading
- **Exam scheduling**: Create exam events linked to sessions.
- **Grade book**: Record and manage grades per student per assessment.
- **Grade scales**: Configurable grading scales (percentage, letter, GPA).
- **Transcript generation**: Auto-generate official transcripts.
- **Grade analytics**: Distribution charts, pass rates, performance trends.

### 3.4 Library & Resources
- **Digital library**: Upload and share course materials (PDFs, videos, links).
- **Book lending system**: Track physical book inventory and borrowing.
- **Resource access control**: Restrict materials to enrolled students.
- **Reading progress tracking**: Extend book reference tracking to student-level progress.

---

## Phase 4: Integration & Automation

### 4.1 External Integrations
- **LMS integration** (Moodle, Canvas): Sync courses, enrollments, grades.
- **Video conferencing** (Zoom, Teams, Google Meet): Auto-create meeting links for sessions.
- **Calendar sync** (Google Calendar, Outlook): Push session schedules to students'/teachers' calendars.
- **Payment gateways** (Stripe, PayPal, local gateways): Online payment processing.
- **SMS gateways** (Twilio, MessageBird): Automated SMS notifications.
- **Government portals**: API integration with ministry/regulatory systems.

### 4.2 Workflow Automation (Triggers)
- **Enrollment triggers**:
  - Student enrolled → auto-add to future attendance dates → send welcome email
  - Student dropped → cancel future attendance → send notification
- **Attendance triggers**:
  - 3 consecutive absences → auto-generate warning notification to student + teacher
  - Attendance rate < 50% → auto-flag enrollment for review
  - Session end time passed → auto-mark unmarked students as absent
- **Certificate triggers**:
  - Session completed + attendance rate ≥ threshold → auto-generate certificate
  - Certificate issued → email notification with download link
- **Feedback triggers**:
  - Session date completed → auto-send feedback request to enrolled students
  - Feedback deadline passed → close feedback form + generate summary
- **Excuse triggers**:
  - Excuse approved → auto-update attendance record → recalculate scoring
  - Excuse rejected → send notification with reason

### 4.3 API Layer
- **REST API**: Public API for external system integration (with API key authentication).
- **Webhook system**: Outbound webhooks for events (enrollment, attendance, certificate).
- **Bulk data API**: Endpoints for mass import/export operations.
- **Mobile API**: Optimized endpoints for mobile app consumption.

---

## Phase 5: Mobile & Accessibility

### 5.1 Mobile Application
- **Student app** (React Native / Flutter):
  - QR code check-in scanner
  - Face recognition check-in
  - View attendance records
  - Submit excuse requests with document upload
  - View and download certificates
  - Receive push notifications
  - View course materials
- **Teacher app**:
  - Take attendance (manual, QR, photo)
  - View session details and enrolled students
  - Approve/reject excuse requests
  - Send announcements
  - View analytics summaries
- **Offline support**: Cache data for areas with poor connectivity.

### 5.2 PWA Enhancement
- **Service worker**: Offline-first architecture for the web app.
- **Push notifications**: Browser-level push notifications.
- **Install prompt**: Add-to-home-screen for mobile browsers.
- **Background sync**: Queue operations when offline, sync when connected.

### 5.3 Accessibility
- **Full WCAG 2.1 AA compliance**: Keyboard navigation, screen reader support, color contrast.
- **RTL layout optimization**: Full right-to-left support for Arabic UI.
- **Multi-language support** (i18n): Arabic, English, French (configurable per user).
- **High contrast mode**: For visually impaired users.
- **Font size controls**: User-adjustable text sizing.

---

## Phase 6: Enterprise Features

### 6.1 Multi-Tenant Architecture
- **Organization management**: Support multiple training centers under one instance.
- **Tenant isolation**: Data separation with shared infrastructure.
- **Custom branding**: Per-tenant logos, colors, domain names.
- **Cross-tenant reporting**: Aggregated analytics for parent organizations.

### 6.2 Advanced RBAC
- **Custom roles**: Define roles beyond admin/teacher/student (coordinator, observer, parent).
- **Granular permissions**: Per-feature, per-action permission matrix.
- **Department/division hierarchy**: Organizational structure with delegated admin rights.
- **Audit trail enhancement**: Track all permission changes and access attempts.

### 6.3 HR & Staff Management
- **Teacher profiles**: Qualifications, certifications, employment history.
- **Leave management**: Teacher leave requests and substitution planning.
- **Performance reviews**: Based on feedback scores and attendance rates.
- **Workload management**: Track teaching hours and session distribution.
- **Payroll integration hooks**: Export teaching hours for payroll processing.

### 6.4 ERP-Like Features
- **Asset management**: Track equipment, materials, and facilities.
- **Procurement**: Purchase requests for course materials.
- **Inventory**: Track consumable supplies.
- **Maintenance scheduling**: Facility and equipment maintenance tracking.

---

## Phase 7: AI & Advanced Technology

### 7.1 AI-Powered Features
- **Smart scheduling**: AI-optimized session scheduling based on room availability, teacher preferences, and student constraints.
- **Chatbot assistant**: AI chatbot for student queries (schedule, grades, policies).
- **Document OCR**: Auto-extract data from uploaded excuse documents.
- **Smart attendance insights**: Natural language queries like "Which students missed more than 3 sessions this month?"
- **Personalized learning paths**: AI-recommended courses based on student history and goals.

### 7.2 Biometric & IoT
- **Fingerprint check-in**: Integration with fingerprint scanners for attendance.
- **RFID/NFC check-in**: Tap-to-check-in with student ID cards.
- **Bluetooth beacon proximity**: Auto-detect student presence in classroom.
- **Smart classroom integration**: Integrate with IoT sensors for room occupancy.

### 7.3 Blockchain
- **Verifiable certificates**: Issue blockchain-anchored certificates that third parties can verify.
- **Immutable attendance records**: Blockchain-logged attendance for regulatory compliance.
- **Credential wallet**: Students carry a portable, verifiable credential portfolio.

---

## Technical Debt & Infrastructure (Ongoing)

### Performance
- [ ] Code-split large chunks (face-recognition 637KB, pdf-libs 417KB, spreadsheet-libs 432KB)
- [ ] Add React.lazy() for route-level components
- [ ] Implement virtual scrolling for large attendance tables
- [ ] Add database connection pooling (Supabase PgBouncer)
- [ ] Implement query result caching (React Query / TanStack Query)
- [ ] Add CDN for static assets

### Testing
- [ ] Unit tests for service methods (Vitest)
- [ ] Component tests for critical UI flows (Testing Library)
- [ ] E2E tests for check-in flows (Playwright)
- [ ] Load testing for concurrent check-in scenarios
- [ ] RLS policy tests (pgTAP)

### DevOps
- [ ] CI/CD pipeline (GitHub Actions): lint → type-check → test → build → deploy
- [ ] Staging environment
- [ ] Database migration automation
- [ ] Error monitoring (Sentry)
- [ ] Performance monitoring (Vercel Analytics / Web Vitals)
- [ ] Automated database backups verification

### Security
- [ ] Rate limiting on auth endpoints
- [ ] CAPTCHA on student self-registration (if added)
- [ ] Content Security Policy headers
- [ ] Regular dependency vulnerability scanning
- [ ] Penetration testing
- [ ] GDPR/data privacy compliance tools (data export, deletion requests)

---

## Quick Wins (Can Be Done in 1-2 Hours Each)

| Feature | Impact | Effort |
|---------|--------|--------|
| Dark mode toggle persistence | UX | 30 min |
| Keyboard shortcuts (Ctrl+S to save, Esc to close modals) | UX | 1 hr |
| Bulk status update in attendance (select multiple → change status) | Productivity | 2 hr |
| Export attendance as CSV from any page | Utility | 1 hr |
| Duplicate session (copy schedule + settings) | Productivity | 1 hr |
| Student photo gallery view | UX | 1 hr |
| Search across all pages (Cmd+K global search) | Navigation | 2 hr |
| Session notes/memo field | Data | 30 min |
| Attendance summary email (weekly digest) | Communication | 2 hr |
| Print-friendly views for all tables | Utility | 1 hr |

---

## Priority Matrix

| Priority | Category | Features |
|----------|----------|----------|
| P0 (Critical) | Core | Auto-mark absent, notification system, student portal |
| P1 (High) | Analytics | Trend dashboard, reporting engine, feedback intelligence |
| P2 (Medium) | Operations | Scheduling, exams, financial module |
| P3 (Low) | Integration | LMS, video conferencing, payment gateways |
| P4 (Future) | Enterprise | Multi-tenant, advanced RBAC, AI features |
