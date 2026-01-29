# Host System Architecture Guide

## Overview

The Training Center app has a **session hosting system** where students (or teachers) can host training sessions at their homes. This document explains how all the components work together.

---

## Key Concepts

### 1. **Can Host** (`enrollment.can_host`)
- **Location**: Enrollment table, per student per session
- **Purpose**: Marks whether a student is ELIGIBLE to host sessions for this course
- **Managed In**: 
  - Enrollment Form (when adding/editing enrollment)
  - Host Schedule page (BulkScheduleTable)
- **Rule**: Only students with `can_host = true` AND have an address can appear in the host dropdown

### 2. **Host Date** (`enrollment.host_date` or `teacher_host_schedule.host_date`)
- **Location**: 
  - Students: `enrollment.host_date` (one date per enrollment)
  - Teachers: `teacher_host_schedule` table (one date per teacher per session)
- **Purpose**: Pre-planned date when this person will host the session
- **Managed In**: Host Schedule page (BulkScheduleTable)
- **Usage**: Planning tool for teachers to know who hosts on what date

### 3. **Session Date Host** (`session_date_host` table)
- **Location**: Separate table linking session + date to actual host
- **Purpose**: Records who ACTUALLY hosted the session on a specific date
- **Managed In**: Attendance page (host address dropdown)
- **Fields**:
  - `session_id` - Which session
  - `attendance_date` - Which date
  - `host_id` - Student ID or Teacher ID of the host
  - `host_type` - 'student' or 'teacher'
  - `host_address` - The address where session was held
- **Key**: This is the **single source of truth** for who hosted on each date

### 4. **GPS Coordinates** (`student.address_latitude`, `student.address_longitude`)
- **Location**: Student and Teacher tables (persistent per person)
- **Purpose**: Store GPS coordinates for proximity validation
- **Managed In**: Attendance page (Set GPS Coordinates button)
- **Usage**: Validates students are physically near the host location when checking in

---

## How It All Works Together

### Planning Flow (Teacher Setup)
```
1. Teacher enrolls students in session
2. Teacher marks some students as can_host = true (those who can host)
3. Teacher opens Host Schedule to assign host dates
4. Teacher assigns specific dates to specific hosts (pre-planning)
```

### Attendance Day Flow (Teacher Marking)
```
1. Teacher opens Attendance page for the session
2. Teacher selects today's date
3. Host Address dropdown shows:
   - Teacher (if has address)
   - Enrolled students with can_host = true AND have addresses
4. Teacher selects who is hosting today
5. Selection saves to session_date_host table
6. Teacher can optionally set GPS coordinates (saves to student/teacher table)
7. Teacher opens QR or Face check-in for students
```

### Student Check-In Flow (QR Code or Face Recognition)
```
1. Student opens check-in link
2. System loads host info from session_date_host table
3. Host address is READ-ONLY (student cannot change it)
4. If GPS coordinates are set for host:
   - System captures student's GPS
   - Validates student is within proximity_radius
   - Blocks check-in if too far away
5. Student completes check-in (QR scan or face match)
```

---

## Table Relationships

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     SESSION     │     │   ENROLLMENT    │     │     STUDENT     │
│─────────────────│     │─────────────────│     │─────────────────│
│ session_id (PK) │◄────│ session_id (FK) │     │ student_id (PK) │
│ teacher_id (FK) │     │ student_id (FK) │────►│ name            │
│ proximity_radius│     │ can_host ✓      │     │ address         │
│ start_date      │     │ host_date       │     │ address_latitude│
│ end_date        │     │ status          │     │ address_longitude│
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                              
        │                                              
        ▼                                              
┌─────────────────────────────────┐     ┌─────────────────┐
│      SESSION_DATE_HOST          │     │     TEACHER     │
│─────────────────────────────────│     │─────────────────│
│ session_id + attendance_date(PK)│     │ teacher_id (PK) │
│ host_id (student or teacher)    │     │ name            │
│ host_type ('student'|'teacher') │     │ address         │
│ host_address                    │     │ address_latitude│
└─────────────────────────────────┘     │ address_longitude│
                                        └─────────────────┘
```

---

## Common Confusion Points

### Q: Why do I see `can_host` in the Enrollment form?
**A**: This is to mark which students are eligible to host. A student must have:
1. `can_host = true` in their enrollment
2. An address in their profile
3. Active enrollment status

Only then will they appear in the Attendance page's host dropdown.

### Q: Why doesn't Host Schedule assignment appear in Attendance?
**A**: The Host Schedule (`host_date` field) is for **planning purposes only**. When you're on the Attendance page, you manually select who is hosting today from the dropdown. The system doesn't auto-select based on planned dates.

### Q: Why do I need to set coordinates again for the same student?
**A**: Previously, coordinates were stored per session. Now they're stored per student/teacher profile. Once set, they persist across all sessions. If you're still seeing this issue, run the latest SQL migration.

### Q: What blocks students from checking in remotely?
**A**: Proximity validation requires:
1. Session has `proximity_radius` set (e.g., 100 meters)
2. Host has GPS coordinates saved (address_latitude, address_longitude)
3. Student has GPS enabled on their device
4. Student is within the radius of the host location

---

## Database Migrations Required

1. **ADD-COORDINATES-TO-STUDENT.sql** - Adds address_latitude, address_longitude to student and teacher tables
2. **ADD-CAN-HOST-TO-ENROLLMENT.sql** - Adds can_host column to enrollment table
3. **ADD-SESSION-DATE-HOST-TABLE.sql** - Creates session_date_host table
4. **ADD-PROXIMITY-RADIUS.sql** - Adds proximity_radius to session table

---

## Summary

| Component | Table | Purpose |
|-----------|-------|---------|
| Can Host | `enrollment.can_host` | Who is eligible to host |
| Host Schedule | `enrollment.host_date` / `teacher_host_schedule` | Pre-planned hosting dates |
| Actual Host | `session_date_host` | Who actually hosted each date |
| GPS Coordinates | `student.address_*` / `teacher.address_*` | Proximity validation |
| Proximity Radius | `session.proximity_radius` | Max distance for check-in |
