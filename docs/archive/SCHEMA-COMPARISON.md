# Database Schema Comparison

## Your Current Database (from schema visualizer)

```sql
attendance:
- session_location_id uuid ❌ SHOULD NOT EXIST
- All other columns are CORRECT ✅

session:
- Missing: location TEXT ❌
- Has: grace_period_minutes ✅

enrollment:
- Has: can_host ✅
- Has: host_date ✅

student:
- Has: location ✅
```

## What the App Expects (Required Schema)

```sql
attendance:
- NO session_location_id ✅
- session_id uuid ✅ (you have this)
- attendance_date date ✅ (you have this)
- gps_* columns ✅ (you have these)
- excuse_reason ✅ (you have this)
- marked_by, marked_at ✅ (you have these)
- host_address ✅ (you have this)

session:
- location TEXT ❌ YOU ARE MISSING THIS
- grace_period_minutes ✅ (you have this)

enrollment:
- can_host boolean ✅ (you have this)
- host_date date ✅ (you have this)
```

## Summary

**Your database is 95% correct!**

You only need to fix **2 small things**:

1. ❌ Remove `attendance.session_location_id` (old column)
2. ❌ Add `session.location` as TEXT field

---

## What to Run

**Option 1: Quick Fix (recommended)**
```sql
-- Run this in Supabase SQL Editor:
-- File: QUICK-FIX-SCHEMA.sql
```

**Option 2: Full Migration (if you want to be thorough)**
```sql
-- Run this in Supabase SQL Editor:
-- File: MIGRATE-TO-CURRENT-SCHEMA.sql
```

Both will work, but QUICK-FIX is faster since your database is already mostly correct.

---

## Why the Confusion?

The old schema used:
- `location` table (separate table)
- `session_location` table (junction table)
- `attendance.session_location_id` (foreign key)

The NEW schema (what app uses now):
- No location tables
- `session.location` (simple TEXT field)
- `attendance.session_id` (direct foreign key to session)
- `attendance.host_address` (stores which student's home was used)

This change was made to simplify the system and support the host rotation feature.
