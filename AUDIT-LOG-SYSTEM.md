# Audit Log System Documentation

## Overview
The audit log system automatically tracks all delete operations across the application, creating a permanent record of what was deleted, when, and by whom.

## Setup Instructions

### 1. Create the Audit Log Table
Run the SQL script in your Supabase SQL Editor:
```bash
CREATE-AUDIT-LOG-TABLE.sql
```

This creates:
- `audit_log` table with all necessary columns
- Indexes for fast queries
- Row Level Security (RLS) policies

### 2. Table Structure
```sql
audit_log (
  audit_id uuid PRIMARY KEY,
  table_name text,          -- Which table (e.g., 'student', 'course', 'session')
  record_id text,            -- ID of the deleted record
  operation text,            -- 'DELETE', 'UPDATE', or 'INSERT'
  old_data jsonb,            -- Complete record data before deletion
  new_data jsonb,            -- New data for UPDATE operations
  deleted_by text,           -- Email of user who performed the action
  deleted_at timestamp,      -- When the deletion occurred
  reason text               -- Optional reason for deletion
)
```

## What Gets Logged

Every delete operation now captures:
- ✅ **Students** - Full student record including name, email, address, etc.
- ✅ **Teachers** - Teacher details before deletion
- ✅ **Courses** - Course information with teacher association
- ✅ **Sessions** - Session schedule and details
- ✅ **Enrollments** - Student-session enrollment records
- ✅ **Attendance** - Attendance records with GPS data

## How It Works

### Automatic Logging
When you delete any record through the application, it:
1. Fetches the complete record data
2. Saves it to `audit_log` with user email and timestamp
3. Proceeds with the actual deletion

### Example
```typescript
// When you delete a student:
await studentService.delete(studentId);

// Behind the scenes:
// 1. Fetches: { student_id: '123', name: 'John Doe', email: 'john@example.com', ... }
// 2. Logs to audit_log:
//    - table_name: 'student'
//    - record_id: '123'
//    - old_data: { full student object }
//    - deleted_by: 'teacher@example.com'
//    - deleted_at: '2025-12-10T10:30:00Z'
// 3. Deletes the student
```

## Viewing Audit Logs

### Using Supabase Dashboard
1. Go to **Table Editor** → **audit_log**
2. View all deletion records
3. Filter by:
   - `table_name` - See deletions from specific table
   - `deleted_by` - See who deleted what
   - `deleted_at` - Date range

### Using SQL Queries

**All deletions today:**
```sql
SELECT *
FROM audit_log
WHERE deleted_at::date = CURRENT_DATE
  AND operation = 'DELETE'
ORDER BY deleted_at DESC;
```

**Student deletions:**
```sql
SELECT 
  deleted_at,
  deleted_by,
  old_data->>'name' as student_name,
  old_data->>'email' as student_email
FROM audit_log
WHERE table_name = 'student'
  AND operation = 'DELETE'
ORDER BY deleted_at DESC;
```

**Deletions by specific user:**
```sql
SELECT *
FROM audit_log
WHERE deleted_by = 'teacher@example.com'
ORDER BY deleted_at DESC;
```

**Restore deleted data (view JSON):**
```sql
SELECT 
  table_name,
  record_id,
  old_data,
  deleted_at,
  deleted_by
FROM audit_log
WHERE record_id = 'specific-id-here';
```

## Using the Audit Service (Optional)

The `auditService.ts` provides functions to query audit logs programmatically:

```typescript
import { getAuditLogs } from '../services/auditService';

// Get all deletions
const allDeletions = await getAuditLogs({ operation: 'DELETE' });

// Get student deletions from last 7 days
const recentStudentDeletions = await getAuditLogs({
  tableName: 'student',
  operation: 'DELETE',
  startDate: '2025-12-03',
  endDate: '2025-12-10',
  limit: 50
});

// Get deletions by specific user
const userDeletions = await getAuditLogs({
  deletedBy: 'teacher@example.com',
  operation: 'DELETE'
});
```

## Benefits

1. **Accountability** - Know who deleted what and when
2. **Recovery** - Complete data available for restoration if needed
3. **Compliance** - Audit trail for data protection regulations
4. **Security** - Detect unauthorized deletions
5. **Analysis** - Understand data lifecycle patterns

## Data Retention

The audit log grows over time. Consider:
- Archive old logs periodically (e.g., after 1 year)
- Set up automated backups
- Monitor table size

**Archive old logs (>1 year):**
```sql
DELETE FROM audit_log
WHERE deleted_at < NOW() - INTERVAL '1 year';
```

## Security

- ✅ RLS enabled - Only authenticated users can read/write
- ✅ Non-blocking - Audit failures don't block deletions
- ✅ Immutable - No update/delete policies (append-only)

## Files Modified

- `src/services/auditService.ts` - Audit logging functions
- `src/services/studentService.ts` - Added logging
- `src/services/teacherService.ts` - Added logging
- `src/services/courseService.ts` - Added logging
- `src/services/enrollmentService.ts` - Added logging
- `src/services/attendanceService.ts` - Added logging
- `src/pages/Sessions.tsx` - Added logging
- `CREATE-AUDIT-LOG-TABLE.sql` - Database setup

## Next Steps

After deploying, you can:
1. Run the SQL script to create the audit_log table
2. Test by deleting a record and viewing the audit_log
3. (Optional) Create an admin UI page to browse audit logs
4. (Optional) Add email notifications for deletions
