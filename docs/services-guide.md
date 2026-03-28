# API Services for Training Center Application

This directory contains service modules for interacting with the Supabase database.

## Structure

- `studentService.ts` - CRUD operations for students
- `teacherService.ts` - CRUD operations for teachers
- `courseService.ts` - CRUD operations for courses
- `sessionService.ts` - CRUD operations for sessions
- `enrollmentService.ts` - CRUD operations for enrollments
- `attendanceService.ts` - CRUD operations and queries for attendance tracking

## Usage Example

```typescript
import { studentService } from './services/studentService';

// Get all students
const students = await studentService.getAll();

// Get student by ID
const student = await studentService.getById('student-uuid');

// Create new student
const newStudent = await studentService.create({
  name: 'John Doe',
  email: 'john@example.com',
  // ... other fields
});

// Update student
const updated = await studentService.update('student-uuid', {
  phone: '+1-555-1234',
});

// Delete student
await studentService.delete('student-uuid');
```

## Error Handling

All service methods return a result object with:
- `data`: The result data (if successful)
- `error`: Error object (if failed)

Always check for errors:

```typescript
const { data, error } = await studentService.getAll();
if (error) {
  console.error('Failed to fetch students:', error);
  return;
}
// Use data...
```
