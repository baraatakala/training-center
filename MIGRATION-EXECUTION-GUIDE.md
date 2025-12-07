# Database Migration Execution Guide

## Overview
This guide provides the correct order for executing all database migrations to enable the Host Address tracking feature for the Training Center application.

## Prerequisites
- Access to Supabase SQL Editor
- Database backup recommended before running migrations

## Migration Execution Order

Execute these SQL files **in the exact order shown below** in your Supabase SQL Editor:

### 1. ADD-CAN-HOST-TO-ENROLLMENT.sql ⭐ NEW
**Purpose**: Adds `can_host` BOOLEAN column to enrollment table
**What it does**:
- Adds `can_host BOOLEAN NOT NULL DEFAULT FALSE` to enrollment table
- Creates sparse index `idx_enrollment_can_host` for better query performance
- Enables students to opt-in to hosting sessions at their homes

**Run this file**: `ADD-CAN-HOST-TO-ENROLLMENT.sql`

**Verification**:
```sql
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'enrollment' AND column_name = 'can_host';
```

Expected result: Shows can_host column exists with type boolean, NOT NULL, default FALSE

---

### 2. ADD-HOST-DATE-TO-ENROLLMENT.sql ✅ EXISTS
**Purpose**: Adds `host_date` DATE column to enrollment table
**What it does**:
- Adds `host_date DATE` (nullable) to enrollment table
- Creates partial index `idx_enrollment_host_date` for scheduled hosts
- Stores when a student is scheduled to host a session

**Run this file**: `ADD-HOST-DATE-TO-ENROLLMENT.sql`

**Verification**:
```sql
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'enrollment' AND column_name = 'host_date';
```

Expected result: Shows host_date column exists with type date, IS NULLABLE

---

### 3. ADD-STATUS-CANHOST-CONSTRAINT.sql ✅ EXISTS
**Purpose**: Enforces business rule that only active enrollments can host
**What it does**:
- Creates trigger function `fn_enforce_can_host_on_status_change()`
- Creates BEFORE INSERT/UPDATE trigger to auto-correct violations
- Adds CHECK constraint `check_can_host_only_active`
- Ensures data integrity: `can_host = TRUE` ONLY when `status = 'active'`

**Run this file**: `ADD-STATUS-CANHOST-CONSTRAINT.sql`

**Verification**:
```sql
SELECT conname, contype, pg_get_constraintdef(oid) as definition
FROM pg_constraint 
WHERE conrelid = 'enrollment'::regclass
AND conname = 'check_can_host_only_active';
```

Expected result: Shows constraint exists with definition checking can_host and status relationship

---

### 4. ADD-EXCUSE-REASON.sql ✅ EXISTS
**Purpose**: Adds excuse reason tracking for excused absences
**What it does**:
- Adds `excuse_reason VARCHAR(100)` to attendance table
- Creates indexes for filtering and querying by excuse reason
- Adds CHECK constraint ensuring excuse_reason is provided when status='excused'

**Run this file**: `ADD-EXCUSE-REASON.sql`

**Verification**:
```sql
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns 
WHERE table_name = 'attendance' AND column_name = 'excuse_reason';
```

Expected result: Shows excuse_reason column exists with type character varying(100)

---

### 5. ADD-HOST-ADDRESS-TO-ATTENDANCE.sql ⭐ NEW
**Purpose**: Adds host address tracking to attendance records
**What it does**:
- Adds `host_address TEXT` to attendance table
- Creates sparse index `idx_attendance_host_address` for records with addresses
- Creates composite index `idx_attendance_date_address` for date+address queries
- Enables tracking of physical location where each session took place

**Run this file**: `ADD-HOST-ADDRESS-TO-ATTENDANCE.sql`

**Verification**:
```sql
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'attendance' AND column_name = 'host_address';

SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'attendance' 
AND indexname IN ('idx_attendance_host_address', 'idx_attendance_date_address');
```

Expected result: 
- Column exists as TEXT, IS NULLABLE
- Both indexes exist with proper definitions

---

## Post-Migration Verification

After running all migrations, verify the complete schema:

```sql
-- Check enrollment columns
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'enrollment' 
AND column_name IN ('can_host', 'host_date')
ORDER BY column_name;

-- Check attendance columns
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'attendance' 
AND column_name IN ('excuse_reason', 'host_address')
ORDER BY column_name;

-- Check constraints
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid IN ('enrollment'::regclass, 'attendance'::regclass)
AND conname IN ('check_can_host_only_active', 'check_excuse_reason_when_excused');

-- Check indexes
SELECT tablename, indexname 
FROM pg_indexes 
WHERE tablename IN ('enrollment', 'attendance')
AND indexname LIKE '%can_host%' OR indexname LIKE '%host_%' OR indexname LIKE '%excuse%';
```

## Feature Flow After Migrations

Once all migrations are complete, the system will work as follows:

### 1. Enrollment Phase
- Admin creates enrollments for students in sessions
- Admin can mark students as `can_host = true` in Enrollments page
- Only students with `status = 'active'` can be marked as hosts (enforced by constraint)

### 2. Host Scheduling Phase
- Admin uses **BulkScheduleTable** component in Sessions page
- Selects specific dates for each host student (`host_date` field)
- System shows student addresses to help plan the rotation

### 3. Attendance Marking Phase
- Teacher opens **Attendance** page for a session
- Selects a date from dropdown
- System automatically loads all students where `can_host = true`
- **Smart Auto-Selection**: If a student's `host_date` matches the selected date, their address is automatically selected
- Teacher can manually override the address if needed
- When marking attendance (on time/late/absent), the selected `host_address` is saved with each attendance record
- For excused absences, teacher selects an `excuse_reason` (sick/abroad/on working)

### 4. Analytics & Reporting Phase
- Admin/Teacher opens **AttendanceRecords** page
- "Attendance by Date" table displays:
  - Date of session
  - **Host Address** (with purple badge 📍)
  - Attendance counts (on time, late, excused, absent)
  - Student names by status
- Export options include:
  - **CSV/XLSX**: Multi-sheet export with "Attendance by Date" including Host Address column
  - **PDF**: Formatted report with Host Address column in date analytics table

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ ENROLLMENT TABLE                                            │
│ ┌─────────────┬──────────┬─────────────┬───────────────┐   │
│ │ enrollment  │  can_host│  host_date  │    status     │   │
│ │     ID      │ (boolean)│   (date)    │  (varchar)    │   │
│ └─────────────┴──────────┴─────────────┴───────────────┘   │
│                    │              │                          │
│                    ▼              ▼                          │
│         [Constraint: can_host=TRUE only if status='active'] │
└─────────────────────────────────────────────────────────────┘
                     │
                     │ Query: WHERE can_host=TRUE AND host_date IS NOT NULL
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ ATTENDANCE MARKING (Attendance.tsx)                         │
│ - Load available host addresses                             │
│ - Auto-select if host_date matches attendance_date          │
│ - Display dropdown for manual selection                     │
│ - Save host_address with attendance record                  │
└─────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ ATTENDANCE TABLE                                            │
│ ┌─────────────┬──────────────┬──────────────────────────┐  │
│ │ attendance  │ host_address │    excuse_reason         │  │
│ │     ID      │    (text)    │    (varchar)             │  │
│ └─────────────┴──────────────┴──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                     │
                     │ Query: GROUP BY attendance_date
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ ANALYTICS & REPORTS (AttendanceRecords.tsx)                │
│ - Display host address per date                             │
│ - Export to CSV/XLSX/PDF with address column               │
│ - Track location history for each session                   │
└─────────────────────────────────────────────────────────────┘
```

## Rollback Instructions

If you need to rollback any migration, run the rollback scripts **in reverse order**:

1. Rollback ADD-HOST-ADDRESS-TO-ATTENDANCE.sql:
```sql
DROP INDEX IF EXISTS idx_attendance_date_address;
DROP INDEX IF EXISTS idx_attendance_host_address;
ALTER TABLE public.attendance DROP COLUMN IF EXISTS host_address;
```

2. Rollback ADD-EXCUSE-REASON.sql:
```sql
-- See ROLLBACK-ADD-EXCUSE-REASON.sql
```

3. Rollback ADD-STATUS-CANHOST-CONSTRAINT.sql:
```sql
DROP TRIGGER IF EXISTS aaa_enforce_can_host_on_status_change ON public.enrollment;
DROP FUNCTION IF EXISTS public.fn_enforce_can_host_on_status_change();
ALTER TABLE public.enrollment DROP CONSTRAINT IF EXISTS check_can_host_only_active;
```

4. Rollback ADD-HOST-DATE-TO-ENROLLMENT.sql:
```sql
DROP INDEX IF EXISTS idx_enrollment_host_date;
ALTER TABLE public.enrollment DROP COLUMN IF EXISTS host_date;
```

5. Rollback ADD-CAN-HOST-TO-ENROLLMENT.sql:
```sql
DROP INDEX IF EXISTS idx_enrollment_can_host;
ALTER TABLE public.enrollment DROP COLUMN IF EXISTS can_host;
```

## Support

If migrations fail or produce errors:
1. Check that you're running them in the correct order
2. Verify each migration's verification query shows expected results
3. Check Supabase logs for detailed error messages
4. Ensure you have proper permissions to ALTER tables and CREATE indexes

## Summary

- **5 migration files** total
- **2 new migrations** created (can_host, host_address)
- **3 existing migrations** already in project (host_date, constraint, excuse_reason)
- Execute in order 1→2→3→4→5
- Full feature integration across 4 pages (Enrollment, Sessions, Attendance, AttendanceRecords)
- Enterprise-grade implementation with indexes, constraints, and proper data flow
