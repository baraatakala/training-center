# Host Address Feature - Testing Checklist

## Pre-Testing Setup

### ✅ 1. Run Database Migrations
Follow the **MIGRATION-EXECUTION-GUIDE.md** to execute all 5 migrations in order:
1. ADD-CAN-HOST-TO-ENROLLMENT.sql
2. ADD-HOST-DATE-TO-ENROLLMENT.sql  
3. ADD-STATUS-CANHOST-CONSTRAINT.sql
4. ADD-EXCUSE-REASON.sql
5. ADD-HOST-ADDRESS-TO-ATTENDANCE.sql

### ✅ 2. Deploy Frontend Build
```bash
npm run build
```
Deploy the built files to your hosting service (or run `npm run dev` for local testing)

---

## Test Scenarios

### Phase 1: Enrollment Setup

#### Test 1.1: Create Enrollments
**Page**: Enrollments (`/enrollments`)
**Steps**:
1. Navigate to Enrollments page
2. Create new enrollments for at least 5 students in a test session
3. Ensure all enrollments have `status = 'active'`

**Expected Result**: ✅ Enrollments created successfully

#### Test 1.2: Mark Students as Hosts
**Page**: Enrollments (`/enrollments`)
**Steps**:
1. Select 3 students to be potential hosts
2. Enable the "Can Host" checkbox for these students
3. Verify checkmark appears next to their names

**Expected Result**: 
- ✅ "Can Host" checkbox can be enabled for active enrollments
- ✅ Database shows `can_host = TRUE` for selected students

#### Test 1.3: Verify Host Constraint (NEGATIVE TEST)
**Page**: Enrollments (`/enrollments`)
**Steps**:
1. Change enrollment status to 'dropped' or 'completed'
2. Try to enable "Can Host" checkbox
3. Check database constraint enforcement

**Expected Result**: 
- ✅ System prevents `can_host = TRUE` when status is not 'active'
- ✅ If checkbox is enabled before status change, it auto-disables when status changes
- ✅ Database constraint `check_can_host_only_active` enforces the rule

#### Test 1.4: Student Addresses Required
**Page**: Students (`/students`)
**Steps**:
1. Verify that students marked as hosts have addresses filled in
2. If missing, edit student profile and add address (e.g., "123 Main St, City, ZIP")

**Expected Result**: ✅ All host students have valid addresses

---

### Phase 2: Host Scheduling

#### Test 2.1: Open Bulk Schedule Table
**Page**: Sessions → Session Details → "Schedule Hosts" button
**Steps**:
1. Navigate to Sessions page
2. Click on a test session
3. Click "Schedule Hosts" button (or similar action that opens BulkScheduleTable)

**Expected Result**: 
- ✅ BulkScheduleTable modal/component opens
- ✅ Shows all dates for the session based on session schedule
- ✅ Shows all students with `can_host = true`
- ✅ Displays student names, addresses, and phone numbers

#### Test 2.2: Assign Host Dates
**Page**: BulkScheduleTable
**Steps**:
1. For each host student, select a specific date from the dropdown
2. Assign different dates to different students (create a rotation)
3. Save the schedule

**Example Schedule**:
- Student A: 2025-12-10
- Student B: 2025-12-12
- Student C: 2025-12-14

**Expected Result**: 
- ✅ Date dropdowns show all available session dates
- ✅ Each student can be assigned a unique date
- ✅ Changes save to database (check `enrollment.host_date` column)

#### Test 2.3: Export Schedule
**Page**: BulkScheduleTable
**Steps**:
1. Click "Export CSV" button
2. Open exported CSV file

**Expected Result**: 
- ✅ CSV contains: Student Name, Address, Phone, Can Host, Host Date
- ✅ All data matches what's displayed in the table

---

### Phase 3: Attendance Marking (CRITICAL - NEW FEATURE)

#### Test 3.1: Date Selection
**Page**: Attendance (`/attendance/:sessionId`)
**Steps**:
1. Navigate to Attendance page for test session
2. Select a date from "Select Date" dropdown

**Expected Result**: 
- ✅ Date dropdown shows all session dates
- ✅ Date can be selected

#### Test 3.2: Smart Address Auto-Selection
**Page**: Attendance
**Steps**:
1. Select a date that matches a student's `host_date` (e.g., 2025-12-10 for Student A)
2. Check the "Host Address" card/section

**Expected Result**: 
- ✅ **Host Address card appears** below the date selector
- ✅ Dropdown is **automatically populated** with Student A's address
- ✅ Label shows: "Student A (Scheduled Host Today) - 123 Main St, City, ZIP"
- ✅ Blue info box displays: "📍 Selected Address: 123 Main St, City, ZIP"

#### Test 3.3: Manual Address Override
**Page**: Attendance
**Steps**:
1. Click the Host Address dropdown
2. Select a different host's address

**Expected Result**: 
- ✅ Dropdown shows all host students' addresses
- ✅ Scheduled host for today is marked with "(Scheduled Host Today)"
- ✅ Other hosts shown without the special label
- ✅ Selected address updates in the blue info box

#### Test 3.4: Mark Single Student Attendance
**Page**: Attendance
**Steps**:
1. Ensure an address is selected in Host Address dropdown
2. Click "On Time" button for one student
3. Check database

**Expected Result**: 
- ✅ Student status updates to "on time" (green badge)
- ✅ Check-in time recorded
- ✅ **Database `attendance.host_address` field contains the selected address**
- ✅ GPS coordinates captured (if geolocation enabled)

#### Test 3.5: Mark Bulk Attendance
**Page**: Attendance
**Steps**:
1. Select multiple students using checkboxes
2. Verify Host Address is selected
3. Click bulk "On Time" button

**Expected Result**: 
- ✅ All selected students marked as "on time"
- ✅ **All records have the same `host_address` value**
- ✅ Bulk operation completes successfully

#### Test 3.6: Excused Absence with Reason
**Page**: Attendance
**Steps**:
1. For one student, select "Excused" status
2. System should prompt for excuse reason
3. Select "Sick" from dropdown
4. Confirm

**Expected Result**: 
- ✅ Excuse reason dropdown appears
- ✅ Options: Sick, Abroad, On Working
- ✅ Database shows `status = 'excused'` AND `excuse_reason = 'sick'`
- ✅ Host address still saved with the record

#### Test 3.7: Different Dates, Different Addresses
**Page**: Attendance
**Steps**:
1. Mark attendance for date 2025-12-10 (Student A's house) → Save
2. Change date to 2025-12-12 (Student B's house)
3. Verify address auto-changes
4. Mark attendance for different students

**Expected Result**: 
- ✅ Address auto-selects based on host schedule
- ✅ Each date's attendance records have the correct host_address
- ✅ Database shows different `host_address` values for different dates

---

### Phase 4: Analytics & Reporting

#### Test 4.1: View Attendance by Date Table
**Page**: Attendance Records (`/attendance-records`)
**Steps**:
1. Navigate to Attendance Records page
2. Select the test session
3. Scroll to "📅 Attendance by Date" section

**Expected Result**: 
- ✅ Table displays with columns: Date, **Host Address**, On Time, Late, Excused, Absent, Rate, Names...
- ✅ **Host Address column shows purple badge 📍** with address text
- ✅ Each date row shows the address where that session took place
- ✅ Dates without address show "-" in gray

#### Test 4.2: Verify Address Accuracy
**Page**: Attendance Records
**Steps**:
1. Cross-reference the displayed addresses with the host schedule
2. Verify each date shows the correct host's address

**Expected Result**: 
- ✅ 2025-12-10 → Shows Student A's address
- ✅ 2025-12-12 → Shows Student B's address
- ✅ 2025-12-14 → Shows Student C's address
- ✅ Dates without scheduled host show "-"

#### Test 4.3: Export to XLSX
**Page**: Attendance Records
**Steps**:
1. Click "Export" → "Excel (XLSX)"
2. Open the exported file
3. Navigate to "Attendance by Date" sheet

**Expected Result**: 
- ✅ Multi-sheet workbook created
- ✅ "Attendance by Date (English)" sheet exists
- ✅ **Column B header: "Host Address"**
- ✅ Each row shows date and corresponding address
- ✅ "Attendance by Date (Arabic)" sheet also includes address column: "عنوان المضيف"

#### Test 4.4: Export to PDF
**Page**: Attendance Records
**Steps**:
1. Click "Export" → "PDF"
2. Open the exported PDF
3. Find "Attendance by Date" table

**Expected Result**: 
- ✅ PDF generates successfully
- ✅ "Attendance by Date" table includes **Host Address column** (2nd column)
- ✅ Addresses are visible and properly formatted
- ✅ Column widths appropriate (Address column wider than count columns)

#### Test 4.5: Export to CSV
**Page**: Attendance Records
**Steps**:
1. Click "Export" → "CSV"
2. Open the CSV file in Excel/Google Sheets

**Expected Result**: 
- ✅ CSV file contains all analytics data
- ✅ "Attendance by Date" section includes Host Address column
- ✅ Data matches what's shown in the UI

---

### Phase 5: Data Integrity & Edge Cases

#### Test 5.1: No Hosts Scheduled
**Page**: Attendance
**Steps**:
1. Select a date where NO student is scheduled to host
2. Check Host Address section

**Expected Result**: 
- ✅ Host Address card may not appear, OR
- ✅ Dropdown shows all available hosts but none marked as "(Scheduled Host Today)"
- ✅ Teacher can manually select any available address
- ✅ Attendance can still be marked with selected address

#### Test 5.2: No Students Marked as Hosts
**Page**: Attendance
**Steps**:
1. Create a session with enrollments where NO student has `can_host = true`
2. Navigate to Attendance page
3. Select a date

**Expected Result**: 
- ✅ Host Address card does not appear
- ✅ Attendance can still be marked
- ✅ `host_address` field remains NULL in database

#### Test 5.3: Host Drops Out
**Page**: Enrollments → Attendance
**Steps**:
1. Mark attendance for a date using Student A's address
2. Change Student A's enrollment status to 'dropped'
3. Return to attendance for same date
4. Check Host Address dropdown

**Expected Result**: 
- ✅ Previously saved attendance records still show Student A's address in analytics
- ✅ New attendance records on future dates should not auto-select Student A
- ✅ Student A's address removed from available hosts dropdown

#### Test 5.4: Student Address Changes
**Page**: Students → Attendance Records
**Steps**:
1. Mark attendance using Student B's address "123 Oak St"
2. Edit Student B's profile, change address to "456 Pine Ave"
3. View Attendance Records

**Expected Result**: 
- ✅ Historical attendance records still show "123 Oak St" (data integrity preserved)
- ✅ Future attendance will use new address "456 Pine Ave"
- ✅ Analytics report shows historical data unchanged

#### Test 5.5: Multiple Sessions Same Day
**Page**: Attendance
**Steps**:
1. Create two different sessions on the same date
2. Schedule different hosts for each session
3. Mark attendance for both sessions

**Expected Result**: 
- ✅ Each session independently tracks its own host address
- ✅ Session A date 2025-12-10 → Host X's address
- ✅ Session B date 2025-12-10 → Host Y's address
- ✅ Analytics correctly segregate by session

---

## Performance Testing

### Test 6.1: Large Dataset
**Setup**:
- 50+ students enrolled
- 10+ students marked as hosts
- 30+ session dates
- 500+ attendance records

**Expected Result**: 
- ✅ Host Address dropdown loads in < 2 seconds
- ✅ Attendance page responsive when selecting dates
- ✅ Analytics table renders in < 3 seconds
- ✅ Excel export completes in < 5 seconds

### Test 6.2: Database Query Performance
**Steps**:
1. Check Supabase Dashboard → Database → Performance Insights
2. Review query execution times for:
   - `SELECT * FROM enrollment WHERE can_host = TRUE`
   - `SELECT * FROM attendance WHERE attendance_date = '...' AND host_address IS NOT NULL`

**Expected Result**: 
- ✅ Queries using indexes execute in < 50ms
- ✅ No full table scans on large tables
- ✅ Indexes `idx_enrollment_can_host`, `idx_attendance_host_address`, `idx_attendance_date_address` being utilized

---

## Security Testing

### Test 7.1: Row Level Security (RLS)
**Steps**:
1. Verify RLS policies are enabled on enrollment and attendance tables
2. Test access with different user roles (if applicable)

**Expected Result**: 
- ✅ Users can only access data they're authorized to see
- ✅ Host address data properly protected

### Test 7.2: SQL Injection Prevention
**Steps**:
1. Try entering special characters in Host Address dropdown
2. Attempt SQL injection via address field

**Expected Result**: 
- ✅ Supabase parameterized queries prevent injection
- ✅ No SQL errors or unauthorized data access

---

## User Acceptance Testing (UAT)

### Test 8.1: Teacher Workflow
**Persona**: Teacher marking attendance
**Steps**:
1. Teacher receives notification it's time to mark attendance
2. Opens Attendance page on mobile device
3. Sees today's date pre-selected
4. Sees Host Address automatically selected (Student X's house)
5. Marks all students as "On Time" with 2 taps (Select All → On Time)
6. Reviews summary stats

**Expected Result**: 
- ✅ Process takes < 60 seconds
- ✅ Clear visual feedback
- ✅ No confusion about which address to use

### Test 8.2: Administrator Workflow
**Persona**: Admin reviewing attendance reports
**Steps**:
1. Admin opens Attendance Records
2. Filters by date range (last month)
3. Reviews "Attendance by Date" table
4. Notices pattern of hosting rotation
5. Exports to Excel for meeting

**Expected Result**: 
- ✅ Host Address column clearly visible
- ✅ Easy to identify which student hosted each session
- ✅ Export includes all necessary data for reporting

---

## Bug Report Template

If any test fails, document using this format:

```
**Test ID**: [e.g., 3.2]
**Test Name**: [e.g., Smart Address Auto-Selection]
**Date**: [Date of test]
**Tester**: [Your name]

**Steps to Reproduce**:
1. ...
2. ...

**Expected Result**:
- ...

**Actual Result**:
- ...

**Screenshots**: [Attach if applicable]

**Database State**: 
- enrollment.can_host = [value]
- enrollment.host_date = [value]
- attendance.host_address = [value]

**Console Errors**: [Copy/paste any errors]

**Priority**: [Critical / High / Medium / Low]
```

---

## Sign-Off Checklist

Before marking feature as "Ready for Production":

- [ ] All Phase 1 tests passing (Enrollment Setup)
- [ ] All Phase 2 tests passing (Host Scheduling)
- [ ] All Phase 3 tests passing (Attendance Marking - NEW FEATURE)
- [ ] All Phase 4 tests passing (Analytics & Reporting)
- [ ] All Phase 5 tests passing (Data Integrity & Edge Cases)
- [ ] Performance tests meet targets
- [ ] Security tests passing
- [ ] UAT completed successfully
- [ ] All database migrations executed on production
- [ ] Frontend build deployed
- [ ] Documentation updated
- [ ] Training materials created (if needed)
- [ ] Stakeholder approval received

---

## Rollback Plan

If critical bugs discovered in production:

1. **Immediate**: Disable host address feature in UI (comment out Host Address card in Attendance.tsx)
2. **Short-term**: Fix bugs, test in staging
3. **Medium-term**: Re-deploy corrected version
4. **Last resort**: Run database rollback scripts from MIGRATION-EXECUTION-GUIDE.md

---

## Support Contacts

- **Technical Issues**: [Your email/slack]
- **Database Access**: [DBA contact]
- **Supabase Dashboard**: [URL]
- **Documentation**: See MIGRATION-EXECUTION-GUIDE.md

---

**Testing Start Date**: _____________
**Testing Completion Date**: _____________
**Tested By**: _____________
**Approved By**: _____________
