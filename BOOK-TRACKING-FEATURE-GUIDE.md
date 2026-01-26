# Book Progress Tracking Feature - Implementation Guide

## Overview
This feature allows you to track what topics and pages from a textbook are covered in each session. The information is displayed prominently in the attendance system and exported in reports.

## What's Been Added

### 1. Database Changes
Added three new columns to the `session` table:
- `book_topic` (TEXT): The topic, chapter, or lesson name covered
- `book_start_page` (INTEGER): Starting page number
- `book_end_page` (INTEGER): Ending page number

### 2. UI Enhancements

#### Session Form (Create/Edit Sessions)
- New "Book Progress" section with fields for:
  - Topic/Chapter Name
  - Start Page
  - End Page
- Shows automatic page count calculation
- All fields are optional

#### Attendance Page
- Displays book progress info at the top when marking attendance
- Shows topic name and page range in a blue highlighted box
- Helps teachers track what material should be covered in each session

#### Attendance Records (By Date View)
- New "Book Progress" column in the date analytics table
- Shows topic and page range for each session date
- Included in Excel and PDF exports

## Installation Steps

### Step 1: Run Database Migration
You need to execute the SQL migration to add the new columns to your database.

**Option A: Using Supabase Dashboard**
1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy the contents of `supabase/migrations/20260126_add_book_tracking_to_sessions.sql`
4. Paste and run the SQL

**Option B: Using Supabase CLI** (if you have it set up)
```bash
supabase db push
```

**Option C: Manual SQL Execution**
Run this SQL in your database:
```sql
ALTER TABLE session
ADD COLUMN IF NOT EXISTS book_topic TEXT,
ADD COLUMN IF NOT EXISTS book_start_page INTEGER,
ADD COLUMN IF NOT EXISTS book_end_page INTEGER;

ALTER TABLE session
ADD CONSTRAINT book_pages_valid 
CHECK (
  (book_start_page IS NULL AND book_end_page IS NULL) OR
  (book_start_page IS NOT NULL AND book_end_page IS NOT NULL AND book_end_page >= book_start_page)
);
```

### Step 2: Verify the Installation
After running the migration, verify it worked:
```sql
-- Check if columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'session' 
AND column_name IN ('book_topic', 'book_start_page', 'book_end_page');
```

You should see three rows returned.

### Step 3: Restart Your Development Server
If your app is running, restart it to pick up the new changes:
```bash
npm run dev
```

## How to Use the Feature

### Adding Book Information to a Session

1. **Navigate to Sessions page**
2. **Click "Create Session" or edit an existing session**
3. **Scroll down to the "Book Progress" section**
4. **Fill in the optional fields:**
   - **Topic/Chapter Name**: e.g., "Chapter 3: Advanced Functions"
   - **Start Page**: e.g., 45
   - **End Page**: e.g., 67
5. **Save the session**

### Viewing Book Progress

#### In Attendance Page:
- When marking attendance, the book progress appears at the top in a blue box
- Shows: "📚 [Topic Name] - Pages X-Y (Z pages)"

#### In Attendance Records:
- Switch to "Show Analytics" mode
- View the "Attendance by Date" table
- The "Book Progress" column shows what was covered each day

#### In Reports:
- **Excel Export**: Book information is included in separate columns (Topic, Pages)
- **PDF Export**: Book progress appears in the date analytics table

## Example Use Cases

### Use Case 1: Language Course
```
Topic: "Unit 5: Past Tense Verbs"
Start Page: 78
End Page: 92
```

### Use Case 2: Math Course
```
Topic: "Chapter 12: Trigonometry"
Start Page: 245
End Page: 268
```

### Use Case 3: Programming Course
```
Topic: "Lesson 7: Object-Oriented Programming"
Start Page: 120
End Page: 145
```

## Benefits

1. **Better Planning**: Teachers can plan exactly what to cover each session
2. **Progress Tracking**: Easy to see how far you've progressed through the textbook
3. **Student Reference**: Students can see what pages to review after each session
4. **Reporting**: Book progress is automatically included in all attendance reports
5. **Historical Records**: Track what material was covered on specific dates

## Notes

- **Optional Feature**: You don't have to fill in book information - it's completely optional
- **Session-Level**: Book progress is tied to sessions, not courses, because different sessions of the same course might cover different material
- **Validation**: The system ensures end page is always >= start page
- **Display**: If no book information is entered, a "-" is shown in reports

## Troubleshooting

### Migration Fails
If the migration fails saying columns already exist:
```sql
-- Remove existing columns and recreate
ALTER TABLE session DROP COLUMN IF EXISTS book_topic CASCADE;
ALTER TABLE session DROP COLUMN IF EXISTS book_start_page CASCADE;
ALTER TABLE session DROP COLUMN IF EXISTS book_end_page CASCADE;

-- Then run the main migration again
```

### Book Info Not Showing
1. Verify the migration ran successfully
2. Clear your browser cache
3. Restart your development server
4. Check browser console for any TypeScript errors

### Pages Validation Error
Make sure:
- Both start and end pages are filled (or both are empty)
- End page is greater than or equal to start page
- Pages are positive integers

## Future Enhancements (Optional)

If you want to extend this feature further, you could:
1. Add a course-level "textbook" field to track which book is being used
2. Calculate total pages covered across all sessions
3. Show progress bar (pages covered / total pages)
4. Add chapter/section numbering
5. Link to digital textbook resources

---

**Need Help?**
If you encounter any issues or have questions about this feature, feel free to ask!
