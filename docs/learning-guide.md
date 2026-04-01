# From Vibe Coder to Junior Software Engineer
## A Practical Learning Guide Using Your Training Center Project

> **Goal**: Transform how you understand code — from "it works because the AI said so" to "I know *why* it works and can build on it myself."

---

## Table of Contents

1. [How Software Architecture Works (The Big Picture)](#1-how-software-architecture-works)
2. [Your Project's Architecture (Concrete Map)](#2-your-projects-architecture)
3. [TypeScript Fundamentals You Actually Use](#3-typescript-fundamentals-you-actually-use)
4. [React Patterns Explained With Your Code](#4-react-patterns-explained-with-your-code)
5. [The Service Layer — Why It Exists](#5-the-service-layer)
6. [Database & Supabase Patterns](#6-database--supabase-patterns)
7. [State Management (useState, useMemo, useCallback)](#7-state-management)
8. [Component Composition](#8-component-composition)
9. [How Exports (PDF/Word/Excel) Work](#9-how-exports-work)
10. [Common Patterns to Recognize](#10-common-patterns-to-recognize)
11. [Debugging Like an Engineer](#11-debugging-like-an-engineer)
12. [What to Learn Next](#12-what-to-learn-next)

---

## 1. How Software Architecture Works

### What is Architecture?

Architecture is **how you organize code so it stays manageable** as it grows. A 500-line project needs no structure. A 40,000-line project (like yours) collapses without it.

Think of it like a building:
- **Foundation** = Database schema (tables, relationships)
- **Plumbing** = Service layer (data flows in/out)
- **Rooms** = Feature modules (attendance, students, courses...)
- **Furniture** = UI components (buttons, tables, modals)
- **Hallways** = Routing (how users navigate between rooms)

### The Three Laws of Good Architecture

1. **Separation of Concerns**: Each file/module does ONE thing
2. **Dependencies flow ONE direction**: UI → Services → Database (never backwards)
3. **Changes are local**: Modifying the student form shouldn't break the attendance page

### Layer Cake Pattern (Your App Uses This)

```
┌─────────────────────────────────┐
│         PAGES (orchestration)    │  ← Assembles components + calls services
├─────────────────────────────────┤
│       COMPONENTS (UI display)    │  ← Renders data, handles user input
├─────────────────────────────────┤
│        SERVICES (data access)    │  ← Talks to Supabase, returns { data, error }
├─────────────────────────────────┤
│     SUPABASE CLIENT (transport)  │  ← Handles HTTP, auth tokens, real-time
├─────────────────────────────────┤
│   POSTGRESQL DATABASE (storage)  │  ← Tables, RLS policies, functions
└─────────────────────────────────┘
```

**Data flows DOWN** (page calls service, service calls database).
**Results flow UP** (database returns rows, service returns `{ data, error }`, page updates state).

---

## 2. Your Project's Architecture

### Folder Structure (Mental Model)

```
src/
├── app/                    ← THE APP SHELL (entry point, layout, routing)
│   ├── App.tsx             ← Routes: which URL → which page
│   ├── Layout.tsx          ← Sidebar + navbar wrapper
│   └── NotFound.tsx        ← 404 page
│
├── features/               ← 18 FEATURE MODULES (the "rooms")
│   ├── students/
│   │   ├── pages/          ← Route-level containers
│   │   ├── components/     ← UI pieces specific to students
│   │   └── services/       ← Data access for students
│   ├── attendance/
│   ├── courses/
│   ├── sessions/
│   └── ... (15 more)
│
├── shared/                 ← CROSS-FEATURE CODE (used everywhere)
│   ├── components/ui/      ← Button, Modal, Table, SearchBar...
│   ├── hooks/              ← useIsTeacher, useDebounce...
│   ├── types/              ← TypeScript interfaces for all tables
│   ├── lib/supabase.ts     ← Single Supabase client instance
│   └── services/           ← Audit logging, auth helpers
│
└── main.tsx                ← React entry point (renders <App />)
```

### Why Features Are Isolated

Each feature folder is **self-contained**. The `students/` folder has everything needed for student management. If you delete `certificates/`, the rest of the app still works.

This matters because:
- You can find related code quickly (all student code is in one folder)
- Changes to certificates can't accidentally break attendance
- New developers can work on one feature without understanding the whole app

### The ONE Rule That Prevents Chaos

> **NEVER import `supabase` in pages or components. Only in services.**

This means your UI code never knows *how* data is fetched. It just calls `studentService.getAll()`. If you switched from Supabase to Firebase tomorrow, you'd only change service files — not a single component.

---

## 3. TypeScript Fundamentals You Actually Use

### Interfaces — Describing Data Shapes

```typescript
// This says: "A Student object MUST have these fields with these types"
export interface Student {
  student_id: string;           // Always a string (UUID)
  name: string;                 // Required text
  phone: string | null;         // Text OR null (optional in database)
  email: string;                // Required text
  photo_url: string | null;     // Optional photo
  created_at: string;           // ISO date string
}
```

**Why this matters**: TypeScript catches bugs at compile time. If you write `student.nmae` (typo), the editor shows a red squiggly BEFORE you run the code.

### Union Types — "This OR That"

```typescript
// This field can only be one of these three strings
learning_method?: 'face_to_face' | 'online' | 'hybrid';

// This can be a string or null
phone: string | null;
```

### Generics — Reusable Type Templates

```typescript
// useState<T> means "this state holds a value of type T"
const [students, setStudents] = useState<Student[]>([]);
//                                       ^^^^^^^^^ T = array of Student

const [loading, setLoading] = useState<boolean>(true);
//                                     ^^^^^^^ T = boolean
```

### The `{ data, error }` Pattern

Every Supabase call returns this shape:

```typescript
const { data, error } = await studentService.getAll();

if (error) {
  // Something went wrong — show message
  toast.error('Failed to load students');
  return;
}

// data is guaranteed to exist here
setStudents(data);
```

**This is called "error-first handling"** — always check for failure before using the result.

---

## 4. React Patterns Explained With Your Code

### Components Are Functions That Return HTML

```typescript
// This is a React component. It's just a function.
export function StudentForm({ student, onSave }: Props) {
  // Logic goes here (state, handlers)
  
  return (
    <form onSubmit={handleSubmit}>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit">Save</button>
    </form>
  );
}
```

The JSX (`<form>`, `<input>`) is NOT HTML — it's syntactic sugar that compiles to `React.createElement()` calls. But you can think of it as "HTML with superpowers."

### Props — Passing Data to Components

```typescript
// Parent (page) passes data DOWN to child (component)
<StudentForm 
  student={editingStudent}     // Data prop
  onSave={() => loadStudents()} // Function prop (callback)
/>

// Child receives and uses them
function StudentForm({ student, onSave }: { student?: Student; onSave: () => void }) {
  // student = the data passed in
  // onSave = function to call when done
}
```

**Props flow DOWN** (parent → child). **Callbacks flow UP** (child calls parent's function).

### State — Data That Changes

```typescript
const [students, setStudents] = useState<Student[]>([]);
//     ^^^^^^^^  ^^^^^^^^^^^                        ^^
//     current   function to                        initial
//     value     update it                          value
```

When you call `setStudents(newArray)`, React **re-renders the component** with the new data. This is the core of React: state changes → UI updates automatically.

### useEffect — "Do Something When X Changes"

```typescript
// "When the component first appears, load students"
useEffect(() => {
  loadStudents();
}, []);  // Empty array = run once on mount

// "When selectedSession changes, reload attendance"
useEffect(() => {
  if (selectedSession) {
    loadAttendance(selectedSession.session_id);
  }
}, [selectedSession]);  // Runs when selectedSession changes
```

**The dependency array `[]`** controls WHEN the effect runs:
- `[]` → once, on mount
- `[x]` → whenever `x` changes
- `[x, y]` → whenever `x` OR `y` changes
- No array → every render (usually a bug!)

### useMemo — "Cache an Expensive Calculation"

```typescript
// Don't re-filter 500 students on every render — only when inputs change
const filteredStudents = useMemo(() => {
  return students.filter(s => s.name.includes(searchQuery));
}, [students, searchQuery]);
```

Without `useMemo`, this filter runs on EVERY render (button clicks, typing, anything). With it, it only runs when `students` or `searchQuery` actually changes.

### useCallback — "Don't Recreate This Function"

```typescript
const loadStudents = useCallback(async () => {
  const { data, error } = await studentService.getAll();
  if (data) setStudents(data);
}, []);
```

This prevents React from creating a new `loadStudents` function every render. It matters when the function is passed to child components or used in `useEffect` dependencies.

---

## 5. The Service Layer

### What It Is

A service is a **plain TypeScript object with methods** that handle database operations:

```typescript
// src/features/students/services/studentService.ts

import { supabase } from '@/shared/lib/supabase';

export const studentService = {
  // READ
  async getAll() {
    return await supabase
      .from('student')
      .select('*')
      .order('name', { ascending: true });
  },

  // CREATE
  async create(student: CreateStudent) {
    return await supabase
      .from('student')
      .insert(student)
      .select()
      .single();
  },

  // UPDATE
  async update(id: string, updates: UpdateStudent) {
    return await supabase
      .from('student')
      .update(updates)
      .eq('student_id', id)
      .select()
      .single();
  },

  // DELETE
  async delete(id: string) {
    return await supabase
      .from('student')
      .delete()
      .eq('student_id', id);
  },
};
```

### Why Not Just Call Supabase Directly in Components?

Imagine you have 15 components that fetch students. If you call `supabase.from('student').select(...)` in each one:
- Change the table name? Edit 15 files.
- Add audit logging? Edit 15 files.
- Fix a query? Edit 15 files.

With a service, you edit ONE file. This is called the **DRY principle**: Don't Repeat Yourself.

### The Supabase Query Builder (Reading It Like English)

```typescript
// "From the student table, select all columns, ordered by name ascending"
supabase.from('student').select('*').order('name', { ascending: true })

// "From enrollment, select all + joined session data, where student_id = X"
supabase
  .from('enrollment')
  .select(`
    *,
    session:session_id(
      *,
      course:course_id(course_name, category),
      teacher:teacher_id(name, email)
    )
  `)
  .eq('student_id', studentId)

// "Insert this object into the student table, return the inserted row"
supabase.from('student').insert(newStudent).select().single()

// "Update student where student_id = X, set these fields"
supabase.from('student').update({ name: 'New Name' }).eq('student_id', id)
```

**Key methods**:
- `.from('table')` — which table
- `.select('columns')` — which columns (use `*` for all)
- `.eq('column', value)` — WHERE column = value
- `.insert(data)` — INSERT
- `.update(data)` — UPDATE
- `.delete()` — DELETE
- `.single()` — expect exactly one result
- `.order('column')` — ORDER BY

---

## 6. Database & Supabase Patterns

### Tables Are Like Spreadsheets

```
student table:
┌─────────────┬──────────────┬──────────────────────┬────────────┐
│ student_id   │ name         │ email                │ phone      │
├─────────────┼──────────────┼──────────────────────┼────────────┤
│ abc-123      │ Ahmed Ali    │ ahmed@example.com    │ 050123...  │
│ def-456      │ Sara Hassan  │ sara@example.com     │ 055456...  │
└─────────────┴──────────────┴──────────────────────┴────────────┘
```

### Foreign Keys = Relationships Between Tables

```
enrollment table:
┌─────────────────┬─────────────┬─────────────┐
│ enrollment_id    │ student_id  │ session_id  │
├─────────────────┼─────────────┼─────────────┤
│ enr-001          │ abc-123     │ ses-789     │  ← "Ahmed is enrolled in session 789"
└─────────────────┴─────────────┴─────────────┘

session table:
┌─────────────┬─────────────┬────────────────┐
│ session_id   │ course_id   │ teacher_id     │
├─────────────┼─────────────┼────────────────┤
│ ses-789      │ crs-456     │ tch-123        │  ← "Session taught by teacher 123"
└─────────────┴─────────────┴────────────────┘
```

The `.select()` with nested syntax follows these relationships:

```typescript
// "Get the enrollment, AND the session, AND the session's course and teacher"
.select(`
  *,
  session:session_id(
    *,
    course:course_id(course_name),
    teacher:teacher_id(name)
  )
`)
```

This returns one object with nested data — no manual joining needed.

### Row-Level Security (RLS)

Supabase uses PostgreSQL policies that run on EVERY query. Even if your frontend code has a bug, the database won't return unauthorized data:

```sql
-- "Teachers can only see students enrolled in their sessions"
CREATE POLICY teacher_view_students ON student
  FOR SELECT
  TO authenticated
  USING (
    student_id IN (
      SELECT e.student_id FROM enrollment e
      JOIN session s ON s.session_id = e.session_id
      JOIN teacher t ON t.teacher_id = s.teacher_id
      WHERE t.email = auth.jwt() ->> 'email'
    )
  );
```

**You don't need to fully understand SQL** to build features, but knowing RLS exists helps you debug "why can't I see this data" issues.

---

## 7. State Management

### Three Types of State in Your App

| Type | Where | Example | Tool |
|------|-------|---------|------|
| **Local** | Single component | Modal open/close, form inputs | `useState` |
| **Page-level** | Shared across components on one page | Selected session, loaded students | `useState` in page, passed as props |
| **Global** | Entire app | Current user, auth status | React Context (`AuthProvider`) |

### When to Use What

```typescript
// LOCAL: Only this component needs it
const [isEditing, setIsEditing] = useState(false);

// PAGE-LEVEL: Multiple components on the page need it
// Defined in page, passed down:
function AttendancePage() {
  const [session, setSession] = useState<Session | null>(null);
  return (
    <>
      <SessionSelector onSelect={setSession} />
      <AttendanceTable session={session} />
      <AttendanceCharts session={session} />
    </>
  );
}

// GLOBAL: The whole app needs it
// Defined in AuthContext, accessed anywhere:
const { user, isAdmin } = useAuth();
```

### State Update Rules

1. **Never mutate state directly**:
   ```typescript
   // ❌ WRONG
   students.push(newStudent);
   
   // ✅ RIGHT
   setStudents([...students, newStudent]);
   ```

2. **State updates are ASYNC** — the new value isn't available until next render:
   ```typescript
   setCount(5);
   console.log(count); // Still the OLD value! Not 5.
   ```

3. **Derived state should be computed, not stored**:
   ```typescript
   // ❌ WRONG: Storing filtered list separately
   const [filteredStudents, setFilteredStudents] = useState([]);
   
   // ✅ RIGHT: Compute it from existing state
   const filteredStudents = useMemo(() => 
     students.filter(s => s.name.includes(query)), 
     [students, query]
   );
   ```

---

## 8. Component Composition

### Building Blocks (Shared UI)

Your app has reusable building blocks in `src/shared/components/ui/`:

```typescript
// These are like LEGO bricks — used everywhere
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/shared/components/ui/Table';
import { SearchBar } from '@/shared/components/ui/SearchBar';
```

### Feature Components (Domain-Specific)

```typescript
// These are specific to one feature
import { StudentForm } from '@/features/students/components/StudentForm';
import { CourseList } from '@/features/courses/components/CourseList';
```

### The Composition Pattern

```typescript
// A page COMPOSES shared UI + feature components
export function Students() {
  return (
    <div>
      {/* Shared UI */}
      <SearchBar value={query} onChange={setQuery} />
      
      {/* Shared UI + Feature Component inside */}
      <Modal isOpen={showForm} onClose={() => setShowForm(false)}>
        <StudentForm onSave={handleSave} />
      </Modal>

      {/* Shared UI (Table) with feature data */}
      <Table>
        <TableBody>
          {students.map(s => (
            <TableRow key={s.student_id}>
              <TableCell>{s.name}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

---

## 9. How Exports Work

Your app exports data to three formats: **PDF** (jsPDF), **Excel** (XLSX), **Word** (docx).

### The Export Pipeline

```
User clicks "Export" button
       ↓
AttendanceRecords.tsx collects data + settings
       ↓
Calls export service (e.g., wordExportService.exportAnalyticsToWordDynamic())
       ↓
Service builds document in memory
       ↓
Triggers browser download
```

### PDF Export (jsPDF)

```typescript
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const doc = new jsPDF({ orientation: 'landscape' });
doc.text('Report Title', 14, 25);

autoTable(doc, {
  head: [['Name', 'Email', 'Attendance %']],
  body: students.map(s => [s.name, s.email, s.attendanceRate]),
  startY: 35,
});

doc.save('report.pdf');
```

### Chart Capture (html-to-image)

Charts are rendered by React (Recharts library) in the browser. To include them in PDF/Word:

```typescript
import { toPng } from 'html-to-image';

// 1. Find the chart DOM element
const chartElement = document.getElementById('attendance-chart');

// 2. Convert it to a PNG image (base64 string)
const imageDataUrl = await toPng(chartElement, { quality: 0.95 });

// 3. Add to PDF
doc.addImage(imageDataUrl, 'PNG', x, y, width, height);
```

### Word Export (docx library)

```typescript
import { Document, Paragraph, Table, TableRow, TableCell, TextRun, Packer } from 'docx';

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({
        children: [new TextRun({ text: 'Report Title', bold: true, size: 32 })],
      }),
      new Table({
        rows: [headerRow, ...dataRows],
      }),
    ],
  }],
});

const blob = await Packer.toBlob(doc);
// Trigger download...
```

---

## 10. Common Patterns to Recognize

### Pattern 1: Load → Display → Error Handle

```typescript
const [data, setData] = useState([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

const load = useCallback(async () => {
  setLoading(true);
  const { data, error } = await someService.getAll();
  if (error) setError('Failed to load');
  else setData(data);
  setLoading(false);
}, []);

useEffect(() => { load(); }, [load]);

// In JSX:
if (loading) return <Skeleton />;
if (error) return <div className="text-red-500">{error}</div>;
return <Table data={data} />;
```

You'll see this in almost every page.

### Pattern 2: Form Submit

```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();  // Don't reload the page
  
  const { error } = editingId
    ? await service.update(editingId, formData)
    : await service.create(formData);
  
  if (error) {
    toast.error('Save failed');
  } else {
    toast.success('Saved!');
    onSave();  // Tell parent to refresh
  }
};
```

### Pattern 3: Conditional Rendering

```typescript
// Show/hide based on state
{isAdmin && <Button>Admin Action</Button>}

// Toggle between views
{isEditing ? (
  <EditForm onCancel={() => setIsEditing(false)} />
) : (
  <DisplayView onEdit={() => setIsEditing(true)} />
)}

// Render a list
{students.map(s => <StudentCard key={s.student_id} student={s} />)}
```

### Pattern 4: Named Exports (Project Convention)

```typescript
// ✅ CORRECT — your project uses named exports
export function Students() { ... }
export const studentService = { ... };

// ❌ WRONG — avoid default exports
export default function Students() { ... }
```

### Pattern 5: Path Aliases

```typescript
// ✅ Use @/ alias (maps to src/)
import { studentService } from '@/features/students/services/studentService';

// ❌ Don't use relative paths for cross-feature imports
import { studentService } from '../../../students/services/studentService';
```

---

## 11. Debugging Like an Engineer

### When Something Breaks

1. **Read the error message** — it usually tells you the file and line number
2. **Check the browser console** (F12 → Console tab) for runtime errors
3. **Check the Network tab** (F12 → Network) for failed API calls
4. **Add `console.log`** to trace data flow:
   ```typescript
   console.log('students loaded:', data);
   console.log('error:', error);
   ```

### Common Error Types

| Error | Meaning | Fix |
|-------|---------|-----|
| `TypeError: Cannot read property 'x' of undefined` | Data is `null/undefined` | Add `?.` optional chaining: `student?.name` |
| `RLS policy violation` | Database rejected the query | Check if user has permission (admin vs teacher) |
| `Type 'X' is not assignable to type 'Y'` | TypeScript type mismatch | Check your interfaces match the data |
| `Module not found: '@/...'` | Wrong import path | Check file exists, path is correct |
| `Too many re-renders` | Infinite loop in state/effect | Check `useEffect` dependencies don't cause loops |

### The `npm run build` Check

Before deploying, ALWAYS run:

```bash
npm run build
```

This catches:
- TypeScript errors (type mismatches)
- Import errors (missing files)
- Unused variables (warnings)

If `npm run build` passes, your code is structurally sound.

---

## 12. What to Learn Next

### Priority 1: Understand What You Have (2 weeks)

- [ ] Read through 3 simple services (studentService, courseService, teacherService)
- [ ] Read through 3 simple pages (Students, Courses, Teachers)
- [ ] Follow a data flow end-to-end: user clicks "Add Student" → form renders → submit → service.create() → toast
- [ ] Change a small thing manually (add a field to the student form) without AI help

### Priority 2: Core React (2 weeks)

- [ ] [React Official Tutorial](https://react.dev/learn) — the "Thinking in React" section
- [ ] Practice: can you explain what `useState`, `useEffect`, `useMemo`, `useCallback` do from memory?
- [ ] Practice: can you trace why a component re-renders?

### Priority 3: TypeScript (1 week)

- [ ] [TypeScript Handbook — The Basics](https://www.typescriptlang.org/docs/handbook/2/basic-types.html)
- [ ] Practice: add a new optional field to the Student interface and update the form

### Priority 4: SQL & Database (1 week)

- [ ] Read `database/schema.sql` — understand how tables relate
- [ ] Read `database/rls-policies.sql` — understand access control
- [ ] Practice: write a Supabase query that joins two tables

### Priority 5: Git (Ongoing)

- [ ] Understand: `git status`, `git add`, `git commit`, `git push`, `git pull`
- [ ] Practice: create a branch, make changes, merge back

### The #1 Rule for Growing as a Developer

> **When AI writes code for you, read it line by line and understand WHY each line exists before moving on.**

Every time you skip understanding, you accumulate "comprehension debt." Eventually the codebase becomes a black box, and you can't debug or extend it. The goal isn't to memorize syntax — it's to understand *patterns* so you can recognize them everywhere.

---

## Quick Reference Card

| I want to... | Where to look |
|---|---|
| Add a new page | `src/features/<feature>/pages/` + add route in `App.tsx` |
| Add a database query | `src/features/<feature>/services/` |
| Add a shared button/modal | `src/shared/components/ui/` |
| Check data types | `src/shared/types/database.types.ts` |
| Check route names | `src/app/App.tsx` |
| Check database tables | `database/schema.sql` |
| Add a database column | Create migration in `database/migrations/` |
| Check permissions | `database/rls-policies.sql` |
| Debug a query | Browser → F12 → Network tab → find the Supabase request |
| Run the app | `npm run dev` |
| Check for errors | `npm run build` |
| Run linter | `npm run lint` |
