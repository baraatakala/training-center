# Software Engineering: From Vibe Coder to Professional
## A Self-Contained Curriculum Built Around Your Training Center Project

> **Philosophy**: You don't need a course. You need the mental model that makes all code
> make sense. This document gives you that mental model, anchored to code you can open right now.

---

## PART 1 - HOW COMPUTERS AND PROGRAMS WORK

### 1.1 What Happens When You Type a URL

When you go to your app in the browser:

```
Browser -> DNS -> Web Server -> Your React App (HTML+JS bundle)
                                       |
                User Actions -> React renders UI
                                       |
                Data needed -> HTTPS to Supabase API
                                       |
                Supabase -> PostgreSQL database -> rows -> JSON back to browser
```

Your app is **three separate systems**:
1. **Frontend** (React HTML/JS/CSS) - runs in the user's browser
2. **API** (Supabase REST/GraphQL) - runs on Supabase's servers
3. **Database** (PostgreSQL) - stores all the actual data

Nothing is magic. Every piece of data you see had to travel this path.

---

### 1.2 What a Program Actually Is

A program is a list of instructions that the CPU executes one at a time. But you don't write
CPU instructions - you write in **TypeScript**, which is:

```
TypeScript source (.ts)
      |
      v  tsc (TypeScript Compiler)
JavaScript (.js)
      |
      v  Browser V8 engine
Machine code (CPU executes this)
```

TypeScript just adds a **layer of safety checking** on top of JavaScript. It forces you to
declare what type of data you're working with. The types are checked at **compile time**
(before running) and then erased - the browser never sees them.

---

### 1.3 How the Web Works (HTTP)

Every piece of data, every image, every API call uses HTTP:

```
Request:
  POST /rest/v1/attendance
  Authorization: Bearer <token>
  Content-Type: application/json
  Body: { "student_id": "abc", "status": "late", "late_minutes": 4 }

Response:
  HTTP 200 OK
  Body: { "attendance_id": "xyz", "created_at": "..." }
```

When you write `supabase.from('attendance').insert(...)`, the Supabase library translates
that into this exact HTTP request. Understanding this means you can **debug in the browser's
Network tab**: every failed database operation shows up as a failed HTTP request with a real
error message.

---

## PART 2 - SQL FROM ZERO TO PROFESSIONAL

SQL is the language that talks to the database. It is the most important thing a developer
can know after their primary programming language. Every app you build will use it.

### 2.1 The Relational Model (Why Tables)

A **relational database** stores data in tables. Every row has a unique ID. Relationships
between tables are expressed through these IDs:

```
student table:
+------------------+--------------+------------------------+
| student_id (PK)  | name         | email                  |
+------------------+--------------+------------------------+
| abc-111          | Ahmed Ali    | ahmed@example.com      |
| def-222          | Sara Hassan  | sara@example.com       |
+------------------+--------------+------------------------+

enrollment table:
+--------------------+-----------------+------------------+
| enrollment_id (PK) | student_id (FK) | session_id (FK)  |
+--------------------+-----------------+------------------+
| enr-001            | abc-111         | ses-789          |  <- Ahmed in session
| enr-002            | def-222         | ses-789          |  <- Sara in session
+--------------------+-----------------+------------------+
```

**PK** = Primary Key: uniquely identifies this row.
**FK** = Foreign Key: reference to the PK of another table.

This is the core idea. Everything else in SQL is about: reading, filtering, joining, and
modifying rows in tables.

---

### 2.2 SELECT - Reading Data

```sql
-- Read all columns from student table
SELECT * FROM student;

-- Read specific columns
SELECT student_id, name, email FROM student;

-- Filter with WHERE
SELECT * FROM student WHERE email = 'ahmed@example.com';

-- Filter multiple conditions
SELECT * FROM student WHERE email LIKE '%@example.com' AND age > 18;

-- Sort results
SELECT * FROM student ORDER BY name ASC;
SELECT * FROM student ORDER BY created_at DESC;

-- Limit results (pagination)
SELECT * FROM student ORDER BY name LIMIT 10 OFFSET 20;
-- OFFSET 20 means: skip first 20 rows -> page 3 if page size = 10
```

**Pattern matching with LIKE**:
- `'%ahmed%'` - contains "ahmed" anywhere
- `'ahmed%'` - starts with "ahmed"
- `'%ahmed'` - ends with "ahmed"

---

### 2.3 Aggregate Functions - Counting, Summing, Averaging

```sql
-- How many students?
SELECT COUNT(*) FROM student;

-- How many late attendance records per session?
SELECT session_id, COUNT(*) as late_count
FROM attendance
WHERE status = 'late'
GROUP BY session_id;

-- Attendance rate per student
SELECT
  student_id,
  COUNT(*) as total_days,
  COUNT(*) FILTER (WHERE status IN ('present', 'on time', 'late')) as attended_days,
  ROUND(
    COUNT(*) FILTER (WHERE status IN ('present', 'on time', 'late')) * 100.0 / COUNT(*),
    1
  ) as attendance_pct
FROM attendance
GROUP BY student_id;

-- Only show students with attendance < 75%
SELECT student_id, attendance_pct
FROM (
  -- the query above as a subquery
) sub
WHERE attendance_pct < 75;
```

**Key functions**:
- `COUNT(*)` - number of rows
- `SUM(column)` - total of a numeric column
- `AVG(column)` - average
- `MIN(column)` / `MAX(column)` - smallest / largest
- `ROUND(value, decimals)` - round a number

---

### 2.4 JOIN - Combining Tables

This is the most important SQL concept for your app. Joins let you query related tables:

```sql
-- "Give me all attendance records with the student's name"
SELECT
  a.attendance_date,
  a.status,
  a.late_minutes,
  s.name AS student_name,
  s.email
FROM attendance a
JOIN student s ON s.student_id = a.student_id
WHERE a.session_id = 'ses-789'
ORDER BY a.attendance_date;
```

**Types of JOIN**:
```sql
-- INNER JOIN: only rows that match in BOTH tables
SELECT * FROM enrollment e
INNER JOIN student s ON s.student_id = e.student_id;

-- LEFT JOIN: all rows from left table, NULL for right table when no match
SELECT s.name, e.enrollment_id
FROM student s
LEFT JOIN enrollment e ON e.student_id = s.student_id;
-- Shows ALL students, even those not enrolled (enrollment_id = NULL)

-- The difference:
-- INNER JOIN -> only enrolled students
-- LEFT JOIN  -> all students (enrolled: show enrollment, unenrolled: show NULL)
```

**Multi-table join** (what Supabase does under the hood):
```sql
SELECT
  a.attendance_date,
  a.status,
  a.late_minutes,
  s.name AS student_name,
  c.course_name,
  t.name AS teacher_name,
  ses.time AS session_time
FROM attendance a
JOIN student s ON s.student_id = a.student_id
JOIN session ses ON ses.session_id = a.session_id
JOIN course c ON c.course_id = ses.course_id
JOIN teacher t ON t.teacher_id = ses.teacher_id
WHERE a.session_id = 'ses-789';
```

In Supabase, this is what happens when you write:
```typescript
supabase.from('attendance').select(`
  *,
  student:student_id(name),
  session:session_id(
    time,
    course:course_id(course_name),
    teacher:teacher_id(name)
  )
`)
```

---

### 2.5 INSERT, UPDATE, DELETE

```sql
-- INSERT: create a new row
INSERT INTO attendance (enrollment_id, session_id, student_id, attendance_date, status)
VALUES ('enr-001', 'ses-789', 'abc-111', '2026-04-01', 'on time');

-- INSERT and get back the new row
INSERT INTO attendance (...) VALUES (...) RETURNING *;

-- UPDATE: modify existing rows
UPDATE attendance
SET status = 'late', late_minutes = 4
WHERE attendance_id = 'att-xyz';

-- UPDATE multiple rows at once
UPDATE attendance
SET status = 'excused'
WHERE session_id = 'ses-789' AND attendance_date = '2026-04-01';

-- DELETE: remove rows
DELETE FROM attendance WHERE attendance_id = 'att-xyz';

-- UPSERT: INSERT if not exists, UPDATE if exists (your app uses this heavily)
INSERT INTO session_date_host (session_id, attendance_date, override_time)
VALUES ('ses-789', '2026-04-01', '15:15')
ON CONFLICT (session_id, attendance_date)
DO UPDATE SET override_time = EXCLUDED.override_time;
-- EXCLUDED refers to the row you tried to INSERT
```

---

### 2.6 Constraints - Enforcing Data Integrity

Constraints are rules the database enforces so your data can't become corrupted:

```sql
CREATE TABLE attendance (
  attendance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL,
  student_id    UUID NOT NULL REFERENCES student(student_id),   -- FK constraint
  session_id    UUID NOT NULL REFERENCES session(session_id),   -- FK constraint
  status        VARCHAR NOT NULL CHECK (status IN ('on time','late','absent','excused')),
  late_minutes  INTEGER CHECK (late_minutes IS NULL OR late_minutes >= 0),
  attendance_date DATE NOT NULL,

  UNIQUE (enrollment_id, attendance_date)  -- one record per student per date
);
```

**Types of constraints**:
- `NOT NULL` - field must have a value
- `UNIQUE` - value must be unique across all rows
- `PRIMARY KEY` - unique identifier for each row (NOT NULL + UNIQUE)
- `FOREIGN KEY` / `REFERENCES` - value must exist in another table's PK
- `CHECK` - value must satisfy a condition

Why do constraints matter? Without `UNIQUE (enrollment_id, attendance_date)`, you could
accidentally insert two attendance records for the same student on the same day. The database
would happily store both. Your app would show confusing duplicates. The constraint prevents
the bug at the data layer, regardless of what your frontend code does.

---

### 2.7 Indexes - Making Queries Fast

Without an index, PostgreSQL reads every row to find the ones you want. With an index, it
can jump directly to the right rows:

```sql
-- Without index: PostgreSQL reads all 100,000 attendance rows to find the few for this session
SELECT * FROM attendance WHERE session_id = 'ses-789';

-- Create an index: now it jumps directly to matching rows
CREATE INDEX idx_attendance_session ON attendance(session_id);

-- Composite index: for multi-column WHERE clauses
CREATE INDEX idx_attendance_session_date ON attendance(session_id, attendance_date);
-- Optimizes: WHERE session_id = X AND attendance_date = Y

-- Partial index: only index rows matching a condition
CREATE INDEX idx_attendance_late ON attendance(late_minutes) WHERE late_minutes IS NOT NULL;
-- Optimizes: WHERE late_minutes IS NOT NULL (which is most of your late queries)
```

Your project's indexes are in `database/indexes.sql`. Look at it - every index there exists
because a specific query was slow without it.

**Rule of thumb**: Index columns that appear in WHERE, JOIN ON, and ORDER BY clauses for
tables with more than 1000 rows.

---

### 2.8 Transactions - All or Nothing

Imagine you're moving $100 from account A to account B:
```sql
-- BAD: if the INSERT fails after the first UPDATE, money disappears
UPDATE account SET balance = balance - 100 WHERE account_id = 'A';
INSERT INTO transfer (from_id, to_id, amount) VALUES ('A', 'B', 100);
UPDATE account SET balance = balance + 100 WHERE account_id = 'B';

-- GOOD: transaction wraps all 3 operations
BEGIN;
  UPDATE account SET balance = balance - 100 WHERE account_id = 'A';
  INSERT INTO transfer (from_id, to_id, amount) VALUES ('A', 'B', 100);
  UPDATE account SET balance = balance + 100 WHERE account_id = 'B';
COMMIT; -- if ANY step fails, all changes are rolled back automatically
```

In PostgreSQL (and your migrations), a transaction gives you **atomicity**: either all
changes happen, or none do. This prevents your data from getting into an inconsistent
half-updated state.

---

### 2.9 Views - Named Queries

A view is a saved query you can SELECT from like a table:

```sql
-- Create a view that computes attendance rate
CREATE VIEW student_attendance_summary AS
SELECT
  s.student_id,
  s.name,
  s.email,
  ses.session_id,
  c.course_name,
  COUNT(a.attendance_id) AS total_days,
  COUNT(a.attendance_id) FILTER (WHERE a.status IN ('on time','late','present')) AS attended_days,
  ROUND(
    COUNT(a.attendance_id) FILTER (WHERE a.status IN ('on time','late','present')) * 100.0
    / NULLIF(COUNT(a.attendance_id), 0),
    1
  ) AS attendance_rate
FROM student s
JOIN enrollment e ON e.student_id = s.student_id
JOIN session ses ON ses.session_id = e.session_id
JOIN course c ON c.course_id = ses.course_id
LEFT JOIN attendance a ON a.enrollment_id = e.enrollment_id
  AND a.attendance_date BETWEEN ses.start_date AND ses.end_date
GROUP BY s.student_id, s.name, s.email, ses.session_id, c.course_name;

-- Now you can query it like a table:
SELECT * FROM student_attendance_summary WHERE attendance_rate < 75;
```

Views do not store data - they run the query every time you SELECT from them.

---

### 2.10 Row-Level Security (RLS) - Your Database's Permission System

This is where Supabase gets powerful. Instead of having your application code check
"does this user have permission?", the database itself enforces it:

```sql
-- Enable RLS on the table (now no one can access it without a policy)
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

-- Policy: teachers can only see attendance for sessions they teach
CREATE POLICY "teachers_see_own_sessions" ON attendance
  FOR SELECT
  TO authenticated
  USING (
    session_id IN (
      SELECT s.session_id
      FROM session s
      JOIN teacher t ON t.teacher_id = s.teacher_id
      WHERE t.email = (auth.jwt() ->> 'email')  -- current logged-in user's email
    )
  );

-- Policy: students can only see their own attendance
CREATE POLICY "students_see_own" ON attendance
  FOR SELECT
  TO authenticated
  USING (
    student_id IN (
      SELECT student_id FROM student
      WHERE email = (auth.jwt() ->> 'email')
    )
  );
```

**Why this matters**: Without RLS, a bug in your frontend code could let any user query any
row. With RLS, even if your frontend has a bug, the database rejects unauthorized queries at
the server level. This is called **defense in depth** - you have security at multiple layers.

`auth.jwt()` - PostgreSQL function that Supabase provides to read the JWT token of the
currently authenticated user. This is how the database knows who is asking.

The RLS policies for your project are in `database/rls-policies.sql`. Read it. Every policy
there is a real security decision.

---

### 2.11 Functions and Triggers

**Functions**: reusable SQL logic (like functions in any language):
```sql
-- Function: given a late_minutes value, return which scoring bracket it falls in
CREATE OR REPLACE FUNCTION get_late_score_bracket(p_session_id UUID, p_late_minutes INTEGER)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE
  bracket_score NUMERIC;
BEGIN
  IF p_late_minutes IS NULL OR p_late_minutes <= 0 THEN
    RETURN 1.0;  -- on time = full score
  END IF;

  SELECT weight INTO bracket_score
  FROM scoring_config
  WHERE session_id = p_session_id
    AND p_late_minutes >= min_minutes
    AND (max_minutes IS NULL OR p_late_minutes <= max_minutes)
  LIMIT 1;

  RETURN COALESCE(bracket_score, 0.5);  -- default 50% if no bracket matches
END;
$$;
```

**Triggers**: automatically run a function when a table changes:
```sql
-- Automatically update the updated_at timestamp whenever a row is modified
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();
```

Your project's functions and triggers are in `database/functions.sql`. Read the function for
late scoring brackets - it mirrors the client-side `getLateScoreWeight` function in
`AttendanceRecords.tsx`.

---

### 2.12 The Migration Pattern - How Schema Evolves

Every database change is a migration: a script that transforms the database from state A to
state B.

**Why migrations exist**: You can't just edit the database and call it done. Multiple
developers use the same codebase. The production database has real data. You need a record
of every change.

**Your project's discipline** (the rule you asked about):
```
When you need to change the database:
  1. Write a migration file in database/migrations/XXX_name.sql
  2. Update database/schema.sql (the canonical current state)
  3. Update database/rls-policies.sql if new RLS policies added
  4. Update src/shared/types/database.types.ts with new TypeScript interfaces
  5. Update the service layer if new columns need to be queried
```

**Example**: Adding `override_end_time` to `session_date_host`:
- Migration `010_session_date_endtime_override.sql` adds the column to the live DB
- `database/schema.sql` gets the column added in the CREATE TABLE definition
- `SessionDateHost` interface in `database.types.ts` gets `override_end_time?: string | null`
- `sessionService.ts` gets the column in its SELECT and upsert calls

Without step 2, the schema.sql becomes outdated. Without step 4, TypeScript does not know
the column exists and won't catch typos.

---

## PART 3 - TYPESCRIPT FROM ZERO TO PROFESSIONAL

### 3.1 Why TypeScript Exists

In plain JavaScript:
```javascript
function getUserEmail(user) {
  return user.email; // What if user is null? What if email doesn't exist?
}
getUserEmail(null);  // Crashes at runtime! "Cannot read property 'email' of null"
```

In TypeScript:
```typescript
interface User {
  email: string;
  name: string;
}

function getUserEmail(user: User): string {
  return user.email;
}

getUserEmail(null);
// [X] Compile error BEFORE running:
// "Argument of type 'null' is not assignable to parameter of type 'User'"
```

TypeScript moves bugs from **runtime** (when users see them) to **compile time** (when
you're writing the code).

---

### 3.2 Types and Interfaces

```typescript
// Primitive types
const name: string = 'Ahmed';
const age: number = 25;
const isEnrolled: boolean = true;
const maybeNull: string | null = null;   // union type: string OR null

// Arrays
const names: string[] = ['Ahmed', 'Sara'];
const ids: string[] = [];

// Interface: describes the shape of an object
interface Student {
  student_id: string;
  name: string;
  email: string;
  phone: string | null;     // exists, but may be empty
  age?: number;             // optional: may not exist at all
  created_at: string;
}

// Inline object type (same idea, less reusable)
const student: { name: string; email: string } = {
  name: 'Ahmed',
  email: 'ahmed@ex.com'
};

// Type alias (another way to name a type)
type Status = 'pending' | 'on time' | 'late' | 'absent' | 'excused';
// This means: a Status value can ONLY be one of these 5 strings
// const s: Status = 'asdf'; -> [X] compile error
```

Your project's complete type definitions are in `src/shared/types/database.types.ts`.
**Read this file** - it's the exact contract between your frontend and your database.

---

### 3.3 Generic Types - Reusable Type Templates

```typescript
// Without generics: you'd need separate functions for each type
function getFirstStudent(arr: Student[]): Student { return arr[0]; }
function getFirstCourse(arr: Course[]): Course { return arr[0]; }

// With generics: one function for any type
function getFirst<T>(arr: T[]): T {
  return arr[0];
}
// T is a placeholder. When you call it:
const first = getFirst<Student>(students); // T = Student
const first2 = getFirst(courses);          // T inferred as Course automatically

// Generic interfaces:
interface Result<T> {
  data: T | null;
  error: string | null;
}

// The Supabase return type is like this:
// { data: Student[] | null, error: PostgrestError | null }
const { data, error } = await studentService.getAll();
// data is Student[] | null
// error is PostgrestError | null
```

`useState<Student[]>([])` - the `<Student[]>` is a generic parameter. It tells React:
"this state holds an array of Student objects."

---

### 3.4 Utility Types - TypeScript's Built-In Tools

```typescript
interface Student {
  student_id: string;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
}

// Omit: remove fields
type CreateStudent = Omit<Student, 'student_id' | 'created_at' | 'updated_at'>;
// Result: { name: string; email: string }
// Useful when inserting - the DB generates id and timestamps automatically

// Partial: make all fields optional
type UpdateStudent = Partial<CreateStudent>;
// Result: { name?: string; email?: string }
// Useful for PATCH updates where you only send changed fields

// Required: make all fields required (opposite of Partial)
type FullStudent = Required<Student>;

// Pick: select only certain fields
type StudentSummary = Pick<Student, 'student_id' | 'name'>;
// Result: { student_id: string; name: string }

// Record: create an object type with specific key and value types
type AttendanceByDate = Record<string, 'on time' | 'late' | 'absent' | 'excused'>;
// Equivalent to: { [date: string]: 'on time' | 'late' | 'absent' | 'excused' }
```

Your project uses these patterns constantly:
```typescript
// In database.types.ts:
export type CreateStudent = Omit<Student, 'student_id' | 'created_at' | 'updated_at'>;
export type UpdateStudent = Partial<CreateStudent>;
```

---

### 3.5 Async/Await and Promises

JavaScript is **single-threaded** - it can only do one thing at a time. But I/O operations
(network requests, disk reads) would block everything if done synchronously.

The solution: Promises (a value that will exist eventually) and async/await:

```typescript
// This is what happens internally:
function fetchStudents(): Promise<Student[]> {
  return new Promise((resolve, reject) => {
    // ... makes HTTP request ...
    // Eventually calls resolve(data) or reject(error)
  });
}

// async/await makes this readable:
async function loadStudents() {
  try {
    const students = await fetchStudents(); // "wait here until Promise resolves"
    console.log(students); // array of Students
  } catch (error) {
    console.error(error);
  }
}
```

**Critical rule**: `await` can only be used inside `async` functions. And `async` functions
always return a Promise, whether you want them to or not.

**Why Supabase returns `{ data, error }` instead of throwing**:
```typescript
// Option 1: throw on error (common in older code)
try {
  const data = await fetchStudents(); // throws if fails
} catch (error) {
  // handle error
}

// Option 2: return error as value (Supabase pattern - safer)
const { data, error } = await supabase.from('student').select('*');
if (error) { /* handle */ return; }
// data is definitely valid here - no try/catch needed
```

The `{ data, error }` pattern eliminates accidentally forgetting the `try/catch`.

---

### 3.6 Type Narrowing - TypeScript's Safety Checks

TypeScript needs you to prove types before using them:

```typescript
function getStudentInfo(studentOrId: Student | string) {
  // We don't know if it's a Student object or just an ID string

  if (typeof studentOrId === 'string') {
    // Inside here, TypeScript knows it's a string
    return `ID: ${studentOrId}`;
  } else {
    // Inside here, TypeScript knows it's a Student
    return `Name: ${studentOrId.name}`;
  }
}

// Nullability narrowing:
function sendEmail(email: string | null) {
  if (email === null) return; // guard: exit if null

  // TypeScript now knows email is definitely a string here
  const domain = email.split('@')[1]; // safe
}

// Optional chaining: the safe alternative to null checks
const domain = email?.split('@')[1];
// Returns undefined instead of crashing if email is null
```

The `?.` operator is everywhere in your codebase. It means: "if this is not null, access
this property, otherwise return undefined."

---

### 3.7 Module System - imports and exports

```typescript
// Named export: exported with a specific name
export function calculate() { /* ... */ }
export interface Student { /* ... */ }
export const MAX_STUDENTS = 50;

// Named import: must use the exact name
import { calculate, Student } from '@/features/students/services/studentService';

// Default export (your project avoids these - use named exports)
export default function App() { /* ... */ }
import App from './App'; // can be named anything on import = harder to track

// Re-export: forward exports from one module through another
// src/shared/components/ui/index.ts:
export { Button } from './Button';
export { Modal } from './Modal';
// Now consumers can: import { Button, Modal } from '@/shared/components/ui';

// Path aliases (@/ = src/):
import { studentService } from '@/features/students/services/studentService';
// Equivalent to:
import { studentService } from '../../features/students/services/studentService';
// Aliases prevent the relative path hell of '../../../'
```

---

## PART 4 - REACT FROM ZERO TO PROFESSIONAL

### 4.1 What React Actually Is

React is a **library for building user interfaces** based on one idea: the UI is a function
of state.

```
UI = f(state)
```

When state changes, React calls your function again (re-renders) and updates only the parts
of the DOM that changed. You never manually write `document.getElementById(...).innerHTML`.
React handles all DOM manipulation.

```typescript
// A React component is a function that returns JSX
function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
}
// Every time you click, setCount changes the state.
// React detects the change and re-renders Counter().
// The DOM updates from "Count: 0" to "Count: 1" automatically.
```

**JSX is not HTML**. It compiles to:
```typescript
React.createElement('div', null,
  React.createElement('p', null, 'Count: ', count),
  React.createElement('button', { onClick: ... }, 'Increment')
)
```

---

### 4.2 The Hook System

Hooks are functions that let you "hook into" React features from inside a function component.

#### useState - Local Component State

```typescript
const [value, setValue] = useState<Type>(initialValue);
//     ^       ^                        ^
//     current  update function          initial value (only used once)

// Examples:
const [students, setStudents] = useState<Student[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [selectedId, setSelectedId] = useState<string | null>(null);

// State update triggers a re-render:
setStudents([...students, newStudent]); // React re-renders, UI shows new student

// NEVER mutate state directly:
students.push(newStudent); // [X] React won't re-render! It doesn't know state changed.
```

#### useEffect - Side Effects

```typescript
useEffect(() => {
  // This code runs AFTER the component renders
  // Use for: data fetching, subscriptions, DOM manipulation

  loadStudents(); // fetch data when component mounts

  // Return a cleanup function (optional):
  return () => {
    // Runs when component is unmounted or before next effect
    // Use for: cancelling requests, removing listeners
  };
}, [dependency1, dependency2]); // dependency array

// Dependency array controls WHEN the effect re-runs:
// []           -> run once, on initial mount only
// [sessionId]  -> run when sessionId changes (and on mount)
// [a, b]       -> run when a OR b changes
// (no array)   -> run after every single render (usually a bug)
```

**Common mistake**: forgetting a dependency
```typescript
// Bug: loadStudents captures old state in a closure but never re-runs
const loadStudents = async () => { /* ... */ };
useEffect(() => { loadStudents(); }, []); // stale closure!

// Fix: use useCallback to stabilize the function reference
const loadStudents = useCallback(async () => { /* ... */ }, []); // stable reference
useEffect(() => { loadStudents(); }, [loadStudents]); // correct
```

#### useMemo - Memoize Expensive Calculations

```typescript
// Bad: filters all 500 students on every render (even unrelated ones)
const filteredStudents = students.filter(s => s.name.includes(query));

// Good: only recalculates when students or query actually change
const filteredStudents = useMemo(() => {
  return students.filter(s => s.name.toLowerCase().includes(query.toLowerCase()));
}, [students, query]);
```

Think of `useMemo` as: "Remember this computed value until the inputs change."

#### useCallback - Memoize Function References

```typescript
// This creates a new function object every render:
const handleSave = async () => { /* ... */ };
// If passed to a child, the child re-renders every time parent renders

// useCallback keeps the same function reference until dependencies change:
const handleSave = useCallback(async () => { /* ... */ }, [dependency]);
// Child gets the same function reference (no unnecessary re-renders)
```

#### useRef - Mutable Values Without Re-renders

```typescript
// A ref is a box that holds a value; changing it doesn't trigger re-render
const chartRef = useRef<HTMLDivElement>(null);

// Use for:
// 1. Accessing DOM elements directly
//    <div ref={chartRef}>...</div>
const element = chartRef.current; // actual DOM element

// 2. Storing values that don't affect the UI
const intervalRef = useRef<NodeJS.Timeout | null>(null);
intervalRef.current = setInterval(() => {}, 1000); // stored without re-rendering
```

#### useContext - Global State Without Prop Drilling

```typescript
// Create a context (in AuthContext.tsx):
const AuthContext = createContext<AuthContextType | null>(null);

// Provide it high in the tree (in App.tsx):
// <AuthContext.Provider value={{ user, isAdmin, logout }}>
//   <App />
// </AuthContext.Provider>

// Consume anywhere deep in the tree:
function DeepComponent() {
  const { user } = useContext(AuthContext)!;
  return <p>Hello {user.name}</p>;
}
// No prop drilling through every intermediate component
```

---

### 4.3 Props Flow and Re-renders

Understanding when React re-renders is critical for performance:

```typescript
function Parent() {
  const [count, setCount] = useState(0);
  const [name, setName] = useState('Ahmed');

  return (
    <div>
      <ChildA count={count} />
      <ChildB name={name} />
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
}
```

When you click the button, `count` changes. React re-renders `Parent`. Because `Parent`
re-renders, ALL children re-render too - even `ChildB` whose `name` prop did not change!

This is usually fine for small apps. For large tables with 200 rows, it becomes a problem.
Solutions:
- `React.memo(ChildB)` - only re-renders if its props actually changed
- `useMemo` for expensive computations
- `useCallback` for functions passed as props

Your app's `AttendanceRecords.tsx` (~7000 lines) has 41 `useState` calls. This is known
architectural debt documented in `docs/architecture.md`.

---

### 4.4 Controlled vs Uncontrolled Forms

```typescript
// CONTROLLED: React controls the value
function Form() {
  const [name, setName] = useState('');

  return (
    <input
      value={name}                               // React owns the value
      onChange={(e) => setName(e.target.value)}  // React updates on each keystroke
    />
  );
}
// Advantage: you always know the current value in React state
// Disadvantage: re-renders on every keystroke

// UNCONTROLLED: DOM controls the value, you read it when needed
function Form() {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const value = inputRef.current?.value; // read when needed
  };

  return <input ref={inputRef} />;
}
// Advantage: no re-renders while typing
// Disadvantage: value not immediately available in state
```

Your app uses controlled forms (with `useState`) for everything. This is typical for forms
where validation needs to happen in real time.

---

### 4.5 Data Flow Architecture

React data flows in ONE direction: top-down through props.

```
App
  AuthProvider (provides user via context)
  Layout
    Sidebar
    Page (e.g., Students)         -- owns data state
      SearchBar                   -- reads searchQuery, calls onSearch
      Modal
        StudentForm               -- calls onSave when submitted
      Table
        StudentRow (x N)          -- reads student data, has action buttons
```

Data goes down (parent -> child via props).
Events and actions go up (child -> parent via callback props).
Global data (auth, user) goes through context.

**The golden rule**: State should live as close to the components that need it as possible,
but no lower than the closest common ancestor of those components.

---

### 4.6 Error Boundaries

```typescript
// Class component (required for error boundaries - no hook equivalent yet)
class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return <div>Something went wrong. Please refresh.</div>;
    }
    return this.props.children;
  }
}

// Usage: wraps any component tree
// <ErrorBoundary>
//   <Suspense fallback={<Spinner />}>
//     <LazyLoadedPage />
//   </Suspense>
// </ErrorBoundary>
```

Your `src/app/App.tsx` wraps every page in `<SafePage>` which combines `ErrorBoundary` +
`Suspense`. This means a crash in one page does not take down the whole app.

---

## PART 5 - SYSTEM DESIGN AND ARCHITECTURE

### 5.1 What Is Software Architecture?

Architecture is **the set of decisions that are hardest to change later**. Good architecture
defers details to the last responsible moment and isolates change.

The four questions of architecture:
1. **Where does data live?** (database schema design)
2. **How does data flow?** (service -> state -> UI)
3. **What are the boundaries?** (modules, packages, feature separation)
4. **How does it scale?** (performance, maintainability)

---

### 5.2 The Architectural Patterns Your App Uses

#### Pattern 1: Feature-Based Modules (Vertical Slices)

Many early codebases organize by technical role:
```
[X] Technical organization (hard to navigate for business logic):
src/
  components/   <- ALL components from every feature mixed together
  services/     <- ALL services mixed together
  types/        <- ALL types mixed together
```

Your app uses **feature modules** (vertical slices):
```
[OK] Feature organization (each feature is self-contained):
src/features/
  students/
    pages/       <- route-level containers
    components/  <- student-specific UI
    services/    <- student data access
  attendance/
    pages/
    components/
    services/
```

**Why this matters**: When a bug is in "attendance", you look in `src/features/attendance/`.
You don't scan 200 files. New developers can work on one feature without understanding
others. You can delete a feature by deleting one folder.

#### Pattern 2: Service Layer (Repository Pattern)

```
UI Component
     |
     v  calls
Service function
     |
     v  calls
Supabase client
     |
     v  HTTP
PostgreSQL database
```

The service is the **only place** that knows about Supabase. If you switched databases
tomorrow, you'd only change service files. The UI does not know or care.

This is a simplified version of the **Repository Pattern**: UI asks for data through an
abstract interface, does not know how it is stored.

#### Pattern 3: One-Way Data Flow

```
User Action -> Event Handler -> Update State -> React Re-Renders UI
```

This is what makes React applications predictable. You can always answer "where does this
data come from?" by tracing backwards through state.

#### Pattern 4: Supabase as Backend (Backend-as-a-Service)

Traditional web app needs:
- Your own server (Node.js/Python/Java)
- Your own auth system
- Your own file storage
- Your own real-time websockets

Supabase provides all of these:
- **PostgreSQL**: full relational database with RLS
- **Auth**: JWT-based auth with email/password, magic links, OAuth
- **Storage**: S3-compatible file storage (for photos)
- **Real-time**: WebSocket connections powered by PostgreSQL LISTEN/NOTIFY

Your app uses Auth + PostgreSQL + Storage (for photos). Real-time is not used yet - it
would allow live attendance updates without page refresh.

---

### 5.3 SOLID Principles (Applied to Your Code)

These are guidelines for writing code that's easy to change:

**S - Single Responsibility**: Each module does ONE thing.
```typescript
// studentService only handles student data.
// Do not put course queries in studentService.
```

**O - Open/Closed**: Open for extension, closed for modification.
```typescript
// When you need to add a new check-in method, add a new handler.
// Don't change the existing QR handler to also handle face recognition.
```

**L - Liskov Substitution**: Subtypes must behave like their parent types.
```typescript
// All services follow the same { data, error } return pattern.
// You can use them interchangeably without knowing the implementation.
```

**I - Interface Segregation**: Don't force clients to depend on interfaces they don't use.
```typescript
// A read-only view doesn't need the service's create/update/delete methods.
// Use a narrower interface: { getAll: () => ..., getById: () => ... }
```

**D - Dependency Inversion**: Depend on abstractions, not concretions.
```typescript
// Components depend on service functions (abstractions).
// Not on supabase directly (concretion).
// This is enforced by the no-restricted-imports ESLint rule.
```

---

### 5.4 Database Design Principles

#### Normalization - Avoiding Duplication

**First Normal Form (1NF)**: Each column has one value (no arrays in a cell).
**Second Normal Form (2NF)**: Non-key columns depend on the whole primary key.
**Third Normal Form (3NF)**: Non-key columns depend only on the primary key.

```sql
-- BAD: student name stored in both student and attendance tables
-- attendance (attendance_id, student_name, student_email, status, ...)
-- If student changes name/email, you must update ALL their attendance rows

-- GOOD: normalized - student data lives once in student table
-- attendance (attendance_id, student_id [FK], status, ...)
-- student (student_id, name, email, ...)
-- Name change? Update ONE row in student table.
```

Your schema is properly normalized. Student data lives in `student`. Course data lives in
`course`. They are connected through foreign keys.

#### When to Denormalize

Sometimes denormalization (intentional data duplication) is justified:
```sql
-- attendance table stores host_address as text, not a FK to session_date_host
-- Why? Because the session location might change AFTER attendance is recorded.
-- We want to preserve what location was used AT THE TIME of check-in.
```

This is a deliberate choice. Denormalization for temporal data (data that should reflect
the past state) is correct.

#### UUID vs Sequential Integer IDs

Your schema uses UUIDs (`gen_random_uuid()`):
```sql
student_id UUID PRIMARY KEY DEFAULT gen_random_uuid()
-- vs: student_id SERIAL PRIMARY KEY (auto-incrementing integer)
```

Pros of UUID:
- Can be generated client-side before writing to DB (no round-trip needed)
- Globally unique across all tables (prevents accidental cross-table ID confusion)
- Safer to expose in URLs (can't enumerate: /students/1, /students/2, /students/3)

Cons of UUID:
- Larger storage (16 bytes vs 4 bytes)
- Slightly slower index performance on very large tables (billions of rows)

For your scale (hundreds to thousands of rows), UUID is the right choice.

---

### 5.5 The N+1 Problem - The Most Common Performance Bug

```typescript
// [X] N+1 PROBLEM:
const { data: sessions } = await supabase.from('session').select('*');
// That's 1 query.

for (const session of sessions) {
  const { data: students } = await supabase
    .from('enrollment')
    .select('student(*)')
    .eq('session_id', session.session_id);
  // That's N more queries (one per session).
  // With 50 sessions = 51 total queries!
}
```

```typescript
// [OK] SOLUTION: Join in one query
const { data: sessions } = await supabase
  .from('session')
  .select(`
    *,
    enrollment(
      student(name, email)
    )
  `);
// 1 query returns everything
```

Every time you write a loop that makes a database call inside it, ask: "Can this be done
in a single query with a JOIN?"

---

### 5.6 Caching - Don't Re-Fetch What You Already Have

```typescript
// Every page load re-fetches all students from DB
function Students() {
  useEffect(() => { loadStudents(); }, []); // always fetches on mount
}

// Better: cache with a short TTL (time-to-live)
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
let studentCache: { data: Student[]; fetchedAt: number } | null = null;

async function getStudentsCached(): Promise<Student[]> {
  const now = Date.now();
  if (studentCache && now - studentCache.fetchedAt < CACHE_TTL) {
    return studentCache.data; // return cached data
  }

  const { data } = await supabase.from('student').select('*');
  studentCache = { data: data!, fetchedAt: now };
  return data!;
}
```

Your current codebase uses `useRefreshOnFocus` - it re-fetches on window focus. For a
multi-user collaborative app, this is actually safer - you always get fresh data.

---

### 5.7 Security in Web Applications

#### The OWASP Top 10 (What Can Go Wrong)

**1. SQL Injection**: Attacker inserts malicious SQL in your input.
```
Search input: "' OR '1'='1" -> breaks your SQL query open
```
**Your protection**: Supabase client uses **parameterized queries** automatically. The
library never concatenates user input into SQL strings.

**2. Broken Authentication**: Weak session management.
**Your protection**: Supabase handles JWT tokens. Tokens expire. RLS enforces row-level
access even with valid tokens.

**3. Broken Access Control**: User sees data they shouldn't.
**Your protection**: RLS policies on every table. Even if frontend code has a bug, the
database enforces access control.

**4. Security Misconfiguration**: Default credentials, exposed debug info.
**Your protection**: Environment variables in `.env` (never committed to Git). Supabase
anon key is NOT a secret - it's designed to be public. The RLS policies are where actual
security lives.

**5. XSS (Cross-Site Scripting)**: Injecting malicious scripts via user input.
**Your protection**: React NEVER renders raw HTML by default. All `{expression}` in JSX
is automatically escaped. The one exception is `dangerouslySetInnerHTML` - search your
codebase for it and ensure it's only used with sanitized input.

```typescript
// React automatically escapes this - safe:
// <div>{userInput}</div>

// This is dangerous - only use with sanitized content:
// <div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
```

**6. Insecure Direct Object References**: Accessing resources by guessing IDs.
**Your protection**: RLS. Even if an attacker guesses `student_id = 'abc-111'`, RLS
prevents them from reading it without the right session.

---

### 5.8 Error Handling Strategy

```typescript
// Layer 1: Database errors (Supabase RLS, constraints)
// -> Caught when { error } is returned from Supabase calls

// Layer 2: Application logic errors
// -> Caught with if (error) { toast.error('...'); return; }

// Layer 3: Unexpected JavaScript errors (null access, etc.)
// -> Caught by ErrorBoundary components wrapping each page

// Layer 4: Network errors (user goes offline)
// -> Caught by useOnlineStatus hook, shown in UI

// Best practice: fail fast and fail clearly
async function createStudent(data: CreateStudent) {
  // Validate at service boundary (not deeper)
  if (!data.email || !data.name) {
    return { data: null, error: { message: 'Name and email are required' } };
  }

  return await supabase.from('student').insert(data).select().single();
}
```

---

## PART 6 - BUILD AND DEPLOYMENT PIPELINE

### 6.1 How Your Build Works

```
npm run dev    -> Vite starts a dev server with Hot Module Replacement (HMR)
               -> Changes save -> browser updates without full refresh

npm run build  -> 1. tsc -b   (TypeScript checks types, produces no output files)
               -> 2. vite build (bundles JS/CSS into dist/ folder)

npm run lint   -> ESLint checks code style and architecture rules
```

**What Vite does at build time**:
1. **Tree shaking**: removes unused code (import a 500KB library, use 2 functions ->
   only those 2 functions are bundled)
2. **Code splitting**: breaks the bundle into chunks (each page is a separate chunk,
   loaded on demand)
3. **Minification**: removes whitespace, shortens variable names
4. **Hashing**: adds content hash to filenames (`index-CbRd28SZ.js`) for cache
   invalidation

**Code splitting (lazy loading)**:
```typescript
// Without code splitting: ALL pages are bundled into one giant file.
// With lazy loading: each page is loaded only when the user navigates to it.

const Students = lazy(() =>
  import('@/features/students/pages/Students').then(m => ({ default: m.Students }))
);
// The Students.tsx code is only downloaded when user visits /students.
// This makes the initial page load much faster.
```

---

### 6.2 Environment Variables

```bash
# .env (never commit this file with real values!)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# In your code:
# const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
# Must start with VITE_ for Vite to expose it to the browser bundle
```

**Never put secrets in `VITE_` variables** - they're bundled into the JavaScript that ALL
users download. For operations that need real secrets (API keys, private keys), use
Supabase Edge Functions (server-side code).

---

### 6.3 Git Workflow

```bash
# Feature branch workflow:
git checkout -b feature/add-attendance-export  # create feature branch
# ... make changes ...
git add -A                                      # stage all changes
git commit -m "feat: add Excel export for attendance"
git push origin feature/add-attendance-export   # push to remote
# Then: create Pull Request -> review -> merge to main

# Your project workflow (currently solo):
git add -A
git commit -m "fix: late minutes calculation uses check_in_time not click time"
git push  # pushes to main directly
```

**Commit message convention** (Conventional Commits):
```
feat:     new feature
fix:      bug fix
chore:    maintenance (deps, config)
refactor: code change (no behavior change)
docs:     documentation only
```

---

## PART 7 - YOUR PROJECT'S SPECIFIC ARCHITECTURE

### 7.1 Data Flow for a Common Operation (Marking Attendance)

```
Step 1: User selects date in Attendance.tsx
        -> selectedDate state changes
        -> useEffect fires -> loadAttendance() called

Step 2: loadAttendance() calls supabase:
        - FROM enrollment JOIN student WHERE session_id = X
        - FROM attendance WHERE session_id = X AND attendance_date = Y
        - FROM session_date_host WHERE session_id = X AND attendance_date = Y (for override)

Step 3: Results merged into attendance[] state
        -> React re-renders the attendance list

Step 4: User clicks "Late" button for a student
        -> updateAttendance(attendanceId, 'late') called
        -> calculateLateMinutes(record.check_in_time) runs:
             reads dateOverrideTime (from override) or session.time (default)
             adds grace_period_minutes
             computes: referenceTime - graceEnd -> rounds to nearest minute
        -> supabase.from('attendance').update({ status: 'late', late_minutes: N })

Step 5: loadAttendance() called again -> UI updates to show new status
```

### 7.2 The QR Check-In Flow (Complete)

```
Step 1: Teacher generates QR code in Attendance.tsx
        -> sessionService.generateQRToken(session_id, attendance_date) called
        -> Token stored in Supabase, QR URL = /checkin/{token}

Step 2: Student scans QR with phone
        -> StudentCheckIn.tsx loads at /checkin/{token}
        -> Fetches session info, validates token
        -> Detects student via face recognition or manual selection

Step 3: Student confirms check-in
        -> StudentCheckIn checks: session start time vs current time
        -> If current_time > session_time + grace_period -> status = 'late'
        -> Calculates late_minutes = Math.round((current_time - grace_end) / 60000)
        -> Upserts attendance record via supabase

Step 4: Teacher sees update next time they load the attendance page
```

### 7.3 The Export Pipeline

```
User choices:
  - Report type (analytics / cross-tab / raw)
  - Columns to include
  - Date range, session filters
  - Layout settings (font size, chart width)
  - Language (Arabic/English)
  - Format (PDF / Excel / Word)
           |
           v
  AttendanceRecords.tsx collects data from loaded state
           |
           v
  Format-specific service called:
    PDF   -> jsPDF + autoTable + html-to-image (for charts)
    Excel -> xlsx library (XLSX.utils.aoa_to_sheet)
    Word  -> docx library (Document, Table, Paragraph)
           |
           v
  Blob generated -> browser download triggered
  URL.createObjectURL(blob) + <a download> click
```

---

## PART 8 - HOW TO GROW FROM HERE

### 8.1 The Learning Ladder (Do These in Order)

**Week 1: Read Your Own Code**
- [ ] Read `database/schema.sql` in full - understand every table and its relationships
- [ ] Read `database/rls-policies.sql` - understand who can access what
- [ ] Read `src/shared/types/database.types.ts` - every interface = one DB table
- [ ] Read `src/features/students/services/studentService.ts` - the service pattern
- [ ] Read `src/features/students/pages/Students.tsx` - the page pattern

**Week 2: Make Changes Without AI**
- [ ] Add a new column to an existing table (write the migration, update schema.sql,
      update interface, update service)
- [ ] Add a new field to StudentForm and save it
- [ ] Create a simple new page with a table and search (copy Students pattern)

**Week 3: SQL Practice**
- [ ] Write a query that shows students with less than 75% attendance for a specific session
- [ ] Write a query that shows the average `late_minutes` per session date
- [ ] Write a query using a JOIN that you haven't seen in the codebase before

**Week 4: TypeScript Practice**
- [ ] Can you explain `Omit`, `Partial`, `Record`, `Pick` from memory?
- [ ] Write a generic function that accepts any array and returns the last N items
- [ ] Add a discriminated union type to one of the form components

**Month 2: Architecture**
- [ ] Read Martin Fowler's "Patterns of Enterprise Application Architecture"
- [ ] Read `docs/architecture.md` (the audit document) - understand the architectural debt
- [ ] Plan how you would break `AttendanceRecords.tsx` into smaller components

**Month 3: System Design**
- [ ] Read "Designing Data-Intensive Applications" by Martin Kleppmann (the best book on
      this topic - available free as PDF online)
- [ ] Plan what the database schema would look like if you had 1000 simultaneous users
- [ ] Research: what is a connection pool? Why does Supabase use PgBouncer?

---

### 8.2 The Mental Model for Reading Any Codebase

When you encounter unfamiliar code:

1. **Start with the entry point** and follow the flow
   - Web app: routing -> page -> components/services
   - CLI tool: main() -> command handlers
   - Library: public API -> implementation

2. **Understand the data shapes** before the logic
   - What type goes in? What type comes out?
   - Check the interfaces/types first

3. **Trust the tests** (when they exist)
   - Tests encode the expected behavior
   - Read tests before implementation

4. **Ask "what changes?"**
   - What state can change?
   - What triggers those changes?
   - What re-renders or re-fetches result?

5. **Ask "what can fail?"**
   - Where is error handling?
   - What happens if the network fails?
   - What happens if the user has no data?

---

### 8.3 Resources (All Free)

| Topic            | Resource                                                  |
|------------------|-----------------------------------------------------------|
| SQL              | postgresql.org/docs/current/tutorial.html                 |
| TypeScript       | typescriptlang.org/docs/handbook/intro.html               |
| React            | react.dev/learn (especially "Thinking in React")          |
| Web fundamentals | web.dev/learn                                             |
| System design    | github.com/donnemartin/system-design-primer               |
| Security         | owasp.org/www-project-top-ten                             |
| Git              | git-scm.com/book/en/v2 (free online)                     |

---

### 8.4 The One Rule That Separates Professionals from Vibe Coders

> **When AI writes code for you, read every line and be able to answer: "Why does this
> line exist, and what would break if I deleted it?"**

If you can't answer that for a line of code in your codebase, you don't own it. You're
just hosting it.

The goal is not to memorize syntax. You'll always have documentation and AI for syntax.
The goal is to build the **intuition** that lets you:
- Predict what will break when you change something
- Debug without guessing
- Design systems instead of assembling them
- Write code that communicates intent to other humans

That intuition comes from understanding - not from copying working code. Every time you
understand ONE concept deeply, you unlock 10 more. The leverage is enormous.
