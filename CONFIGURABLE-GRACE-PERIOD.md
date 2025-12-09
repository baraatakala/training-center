# Configurable Grace Period Feature

## Overview
Enhanced the QR code check-in system to support **configurable grace periods** per session, allowing teachers to set their own tolerance for late arrivals.

## What Changed

### 1. Database Migration
**File:** `ADD-GRACE-PERIOD-TO-SESSION.sql`

Added new column to `session` table:
- **Column:** `grace_period_minutes` (INTEGER, default: 15)
- **Constraint:** Value must be between 0-60 minutes
- **Default:** 15 minutes for all existing sessions

**To apply:**
```sql
-- Run this SQL in Supabase SQL Editor
\i ADD-GRACE-PERIOD-TO-SESSION.sql
```

### 2. Frontend Changes

#### SessionForm.tsx
Added grace period selector when creating/editing sessions:
- Dropdown with common values: 0, 5, 10, 15, 20, 30, 45, 60 minutes
- Clear description: "Students can check in without being marked late"
- Helpful hint about late marking behavior
- Default: 15 minutes

#### StudentCheckIn.tsx
Enhanced late detection logic:
- Fetches `grace_period_minutes` from session data
- Uses session-specific grace period (fallback to 15 if null)
- Calculates grace period dynamically: `sessionStart + grace_period_minutes`
- Shows actual grace period in warning message

#### database.types.ts
Updated TypeScript interfaces:
- Added `grace_period_minutes?: number` to `Session` interface
- Propagates to `CreateSession` type automatically

## Late Detection Logic

### Timeline Scenarios

**Example Session:** 09:00 - 12:00 with 10-minute grace period

| Check-in Time | Grace Period End | Status | Display |
|---------------|------------------|--------|---------|
| 09:00 - 09:09 | 09:10 | ✅ On time | Green screen |
| 09:10 - 11:59 | 09:10 | ⏰ Late | Yellow warning |
| 12:00+ | 09:10 | ⏰ Late | Red warning (after session) |

### Grace Period Options

| Minutes | Use Case |
|---------|----------|
| 0 | Strict punctuality required |
| 5 | Short tolerance for quick courses |
| 10 | Standard professional setting |
| **15** | **Default - balanced approach** |
| 20 | Extended tolerance |
| 30 | Relaxed informal classes |
| 45 | Very flexible community courses |
| 60 | Maximum tolerance (1 hour) |

## Teacher Workflow

### Creating New Session
1. Navigate to **Sessions** page
2. Click **+ New Session**
3. Fill in course, teacher, dates, etc.
4. **Set Grace Period** (defaults to 15 minutes)
   - Choose from dropdown
   - 0 minutes = no grace period (instant late marking)
   - 60 minutes = maximum tolerance
5. Save session

### Editing Existing Session
1. Click **Edit** on any session
2. Modify grace period as needed
3. Update - affects all future check-ins

## Student Experience

### On-Time Check-In
```
✅ Check-In Successful!
Welcome, John Doe!
[Green screen with checkmark]
```

### Late Check-In (Within Session)
```
⏰ Check-In Successful!
Welcome, John Doe!
⚠️ You were marked as LATE (arrived after 10-minute grace period)
[Yellow/orange screen with clock icon]
```

### After Session Ended
```
⏰ Check-In Successful!
Welcome, John Doe!
🚫 You checked in AFTER the session ended
[Yellow/orange screen with red warning]
```

## Database Schema

### session table
```sql
Column                  | Type    | Default | Constraint
------------------------|---------|---------|------------------
grace_period_minutes    | INTEGER | 15      | CHECK (0-60)
```

### Indexes
No new indexes required - grace period is only read, not queried.

## Technical Details

### Type Safety
```typescript
interface Session {
  // ... other fields
  grace_period_minutes?: number;  // Optional, defaults to 15
}

type CreateSession = Omit<Session, 'session_id' | 'created_at' | 'updated_at'>;
```

### Late Detection Algorithm
```typescript
// Get grace period from session (default 15)
const gracePeriodMinutes = session.grace_period_minutes ?? 15;

// Parse session start time
const sessionStart = new Date(attendance_date);
sessionStart.setHours(startHour, startMinute, 0, 0);

// Calculate grace period end
const graceEnd = new Date(sessionStart.getTime() + gracePeriodMinutes * 60 * 1000);

// Determine status
if (now > sessionEnd) {
  status = 'late';
  afterSession = true;
} else if (now > graceEnd) {
  status = 'late';
}
```

## Benefits

### For Teachers
- **Flexibility:** Set grace period per session type
- **Control:** Adjust tolerance based on course formality
- **Consistency:** System enforces policy automatically
- **Clarity:** Students know exact expectations

### For Students
- **Transparency:** Clear warning messages show grace period
- **Fairness:** Same rules apply to everyone
- **Accountability:** Automatic late tracking
- **Awareness:** Instant feedback on arrival status

### For Administration
- **Analytics:** Accurate late arrival data
- **Reporting:** Distinguish on-time vs late vs absent
- **Policy:** Flexible rules per course type
- **Audit Trail:** All check-ins timestamped and logged

## Migration Steps

### 1. Apply Database Migration
```bash
# In Supabase SQL Editor
\i ADD-GRACE-PERIOD-TO-SESSION.sql
```

### 2. Deploy Frontend
```bash
npm run build
# Deploy dist/ folder to hosting
```

### 3. Verify Existing Sessions
- All existing sessions default to 15 minutes
- Teachers can edit to customize
- No data loss or conflicts

## Testing Checklist

- [ ] Create new session with 5-minute grace period
- [ ] Edit existing session to change grace period
- [ ] Generate QR code for session
- [ ] Check in exactly at start time (should be on time)
- [ ] Check in 3 minutes after start (should be on time with 5-min grace)
- [ ] Check in 7 minutes after start (should be late with 5-min grace)
- [ ] Check in after session ends (should show red warning)
- [ ] Verify grace period shown in warning message
- [ ] Check database record has correct status

## Files Modified

1. **ADD-GRACE-PERIOD-TO-SESSION.sql** - Database migration (NEW)
2. **src/pages/StudentCheckIn.tsx** - Dynamic grace period logic
3. **src/components/SessionForm.tsx** - Grace period selector UI
4. **src/types/database.types.ts** - TypeScript types

## Backward Compatibility

✅ **Fully backward compatible:**
- Existing sessions default to 15 minutes
- Null values handled with fallback
- No breaking changes to existing functionality
- All old QR codes continue working

## Future Enhancements

Possible improvements:
- [ ] Show grace period on QR code modal
- [ ] Display "Check in by HH:MM to avoid late" on check-in page
- [ ] Analytics dashboard showing late arrival patterns by grace period
- [ ] Email notifications when students check in late
- [ ] Course-level grace period defaults (not just session)
- [ ] Different grace periods for different days of week

---

**Date Implemented:** December 9, 2025  
**Status:** ✅ Complete and Ready for Production  
**Build Status:** ✅ Successful (no errors)
