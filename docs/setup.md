# Training Center Attendance System Setup Guide

This guide will help you set up your training center attendance management system using Supabase, Vite, React, and TypeScript.

## Prerequisites

- Node.js 18+ installed
- A Supabase account (free tier is fine)
- Git (optional)

## Step 1: Set Up Supabase Project

### 1.1 Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up or log in
3. Click "New Project"
4. Fill in:
   - Project name: `training-center`
   - Database password: (create a strong password and save it)
   - Region: (choose closest to you)
5. Click "Create new project" and wait for setup to complete

### 1.2 Run Database Schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Open the file `supabase-schema.sql` from your project
3. Copy all contents and paste into the SQL Editor
4. Click **Run** to execute the schema
5. Verify all tables were created by going to **Table Editor**

### 1.3 (Optional) Add Sample Data

1. In SQL Editor, open `sample-data.sql`
2. Copy and paste the contents
3. Click **Run** to insert sample data

### 1.4 Get API Credentials

1. Go to **Project Settings** > **API**
2. Copy the following values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public** key (the public anonymous key)

## Step 2: Configure Your Application

### 2.1 Create Environment File

1. In your project root, create a `.env` file:
   ```bash
   copy .env.example .env
   ```

2. Open `.env` and add your Supabase credentials:
   ```
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

### 2.2 Install Dependencies

Dependencies are already installed. If you need to reinstall:
```bash
npm install
```

## Step 3: Understanding the Database Structure

### Core Entities

1. **Teacher** - Instructors who teach courses
2. **Student** - Students enrolled in the training center
3. **Course** - Available courses (e.g., Web Development, React)
4. **Location** - Physical or virtual locations for classes
5. **Session** - Scheduled course instances with dates and times
6. **Session Location** - Specific meeting details (date, time, location)
7. **Enrollment** - Student enrollments in sessions
8. **Attendance** - Tracks student presence at each session location

### Key Relationships

```
Teacher → Courses (1:Many)
Teacher → Students (1:Many - assigned teacher)
Teacher → Sessions (1:Many)

Course → Sessions (1:Many)

Session → Enrollments (1:Many)
Session → Session Locations (1:Many)

Student → Enrollments (1:Many)
Student → Attendance (1:Many)

Enrollment → Attendance (1:Many)
Session Location → Attendance (1:Many)

Location → Session Locations (1:Many)
```

## Step 4: Using the Services

The application includes pre-built service modules for database operations:

### Available Services

- `attendanceService` - Manage attendance records
- `studentService` - Manage students
- `enrollmentService` - Manage enrollments

### Example Usage

```typescript
import { attendanceService } from './services/attendanceService';
import { studentService } from './services/studentService';

// Get all students
const { data: students, error } = await studentService.getAll();

// Get attendance for a session location
const { data: attendance } = await attendanceService.getBySessionLocation('session-location-id');

// Mark student as present
await attendanceService.markPresent('attendance-id');

// Get student attendance rate
const { data: stats } = await attendanceService.getStudentAttendanceRate(
  'student-id',
  'session-id'
);
```

## Step 5: Run the Application

### Development Mode

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
npm run preview
```

## Step 6: Configure Authentication (Optional but Recommended)

### Enable Email Authentication

1. In Supabase Dashboard, go to **Authentication** > **Providers**
2. Enable **Email** provider
3. Configure email templates if needed

### Update RLS Policies

The current RLS policies allow all authenticated users full access. You should customize these based on your needs:

**Example: Students can only view their own data**

```sql
-- Drop the default policy
DROP POLICY "Enable read access for authenticated users" ON student;

-- Create restrictive policy
CREATE POLICY "Students can view own records" ON student
    FOR SELECT TO authenticated 
    USING (auth.uid() = student_id::text OR auth.jwt()->>'role' = 'admin');
```

**Example: Only teachers can mark attendance**

```sql
-- Update attendance policy
CREATE POLICY "Teachers can manage attendance" ON attendance
    FOR ALL TO authenticated 
    USING (
        auth.jwt()->>'role' IN ('teacher', 'admin')
    );
```

## Step 7: Next Steps

### Build Your UI

1. Create components for:
   - Student list/detail pages
   - Session management
   - Attendance marking interface
   - Attendance reports and statistics

2. Add routing (recommend React Router):
   ```bash
   npm install react-router-dom
   ```

3. Add UI library (optional):
   ```bash
   # Tailwind CSS (recommended)
   npm install -D tailwindcss postcss autoprefixer
   npx tailwindcss init -p
   
   # Or Material-UI
   npm install @mui/material @emotion/react @emotion/styled
   
   # Or shadcn/ui
   # Follow: https://ui.shadcn.com/docs/installation/vite
   ```

### Additional Features to Implement

- [ ] Dashboard with statistics
- [ ] QR code check-in system
- [ ] Email notifications for absences
- [ ] Export attendance reports (PDF/Excel)
- [ ] Mobile-responsive attendance marking
- [ ] Real-time attendance updates using Supabase subscriptions
- [ ] Student/Teacher portals with role-based access

### Real-time Updates Example

```typescript
// Subscribe to attendance changes
const channel = supabase
  .channel('attendance-changes')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'attendance'
    },
    (payload) => {
      console.log('Attendance updated:', payload);
      // Update your UI here
    }
  )
  .subscribe();

// Cleanup
return () => {
  supabase.removeChannel(channel);
};
```

## Troubleshooting

### Can't connect to Supabase
- Check that your `.env` file has the correct credentials
- Verify the environment variables are loaded (restart dev server)
- Check Supabase project is active and not paused

### RLS Policy Errors
- Make sure you're authenticated when making requests
- Check that RLS policies match your use case
- Temporarily disable RLS to test (not recommended for production)

### Type Errors
- Make sure `@supabase/supabase-js` is installed
- Check TypeScript configuration in `tsconfig.json`
- Regenerate types if you modified the database schema

## Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Vite Documentation](https://vitejs.dev)
- [React Documentation](https://react.dev)
- [TypeScript Documentation](https://www.typescriptlang.org/docs)

## Support

For issues or questions:
1. Check the `DATABASE_DOCUMENTATION.md` for schema details
2. Review the service files in `src/services/`
3. Check Supabase logs in the dashboard
4. Review browser console for errors

---

**Your training center attendance system is now ready to use! Start building your UI and customize the features to match your specific needs.**
