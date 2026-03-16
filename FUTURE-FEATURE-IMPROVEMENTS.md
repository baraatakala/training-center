# Future Feature Improvements

## Current Refactor Direction

- Session delivery metadata is now implemented in forms, services, and the main list pages.
- Attendance denominator logic has been centralized for certificate issuance and dashboard analytics.
- AttendanceRecords refactor has started by extracting the main attendance data-loading pipeline into `src/services/attendanceRecordsPageService.ts`.

## Next Refactor Slices

### 1. AttendanceRecords decomposition
- Move filter-option loading into a dedicated service.
- Move analytics aggregation into a dedicated service module.
- Move export field definitions and dataset mapping into export-specific services.
- Keep the page focused on state orchestration and rendering only.

### 2. Session delivery rollout
- Add recording management UI on top of `src/services/sessionRecordingService.ts`.
- Add course/session detail blocks instead of relying only on table rows.
- Add migration-status checks to admin-facing settings or startup diagnostics.

### 3. Database compatibility hardening
- Add explicit startup checks for missing columns required by newly deployed UI.
- Show actionable admin guidance when the frontend is ahead of the database schema.
- Keep additive migrations isolated instead of mutating the live schema snapshot file.

### 4. Export scalability
- Split AttendanceRecords export generation by dataset type instead of one page-owned configuration blob.
- Reuse shared attendance summary services for PDF, Word, and Excel exports.
- Stop coupling export schemas to every visible field on the page.

## Immediate blocker

- The migration file `ADD-SESSION-DELIVERY-RECORDINGS-AND-SPECIALIZATION.sql` must be executed in Supabase before hybrid/online session metadata can be persisted.