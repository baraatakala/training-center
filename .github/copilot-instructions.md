# Copilot Instructions for AI Coding Agents

## Project Overview
- React 19 + TypeScript 5.9 + Vite 7 application with Supabase (PostgreSQL + Auth + RLS) backend.
- Path alias: `@/*` maps to `./src/*`. Always use `@/` imports.

## First Read For Context
- Read `database/README.md` before proposing SQL or schema changes.
- Treat `database/schema.sql` as the canonical table snapshot and `database/rls-policies.sql` as the canonical RLS source.
- Read `docs/architecture.md` before large refactors; it records the audited architectural debt and target structure.
- Prefer extending existing feature services before adding new query logic.

## Architecture

### Feature Modules (`src/features/`)
The app is organized into 18 feature modules. Each feature contains:
- `pages/` — route-level containers
- `components/` — feature-specific UI components
- `services/` — Supabase data access (the ONLY place to import `supabase`)
- `constants/` — feature-specific constants
- `utils/` — feature-specific utilities

Features: `attendance`, `auth`, `certificates`, `checkin`, `communication`, `courses`, `dashboard`, `data-import`, `enrollments`, `excuses`, `exports`, `feedback`, `scoring`, `sessions`, `specializations`, `students`, `teachers`

### Shared Code (`src/shared/`)
- `components/ui/` — reusable UI primitives
- `hooks/` — custom hooks (e.g., `useIsTeacher`)
- `lib/supabase.ts` — Supabase client initialization
- `services/` — cross-feature services (audit)
- `types/` — TypeScript type definitions
- `utils/` — shared utilities (photo, export)
- `constants/` — app-wide constants

### App Shell (`src/app/`)
- `App.tsx`, `Layout.tsx`, `NotFound.tsx`

## Critical Rules
1. **Service Layer**: NEVER import `supabase` in pages or components. Create service methods instead. ESLint `no-restricted-imports` enforces this.
2. **Error Handling**: Service calls return `{ data, error }`. Always check `error`.
3. **Named Exports**: Use named exports, not default exports.
4. **Type Safety**: Use types from `@/shared/types/` for all data models.
5. **Database Truth Source**: Do not infer schema from archived SQL files when `database/schema.sql`, `database/functions.sql`, or `database/rls-policies.sql` already define it.
6. **Migration Discipline**: New database changes go in `database/migrations/` first, then update consolidated SQL if the change becomes part of the new baseline.
7. **Large Legacy Screens**: `Attendance.tsx` and `BulkScheduleTable.tsx` still contain transitional service facades; prefer extracting narrow service methods rather than expanding page/component query logic.

## Developer Workflows
- `npm run dev` — Start Vite dev server with HMR
- `npm run build` — Production build (`tsc -b && vite build`)
- `npm run lint` — ESLint check
- `npx tsc -b --noEmit` — Type-check only

## Database
- 32 tables with RLS policies. See `database/README.md` for full schema.
- Run order: `schema.sql` → `functions.sql` → `indexes.sql` → `rls-policies.sql` → `storage.sql` → `seed-data.sql`
- Historical migrations in `database/archive/`

## Naming Conventions
- Services: `<entity>Service.ts` (e.g., `studentService.ts`)
- Components: PascalCase (e.g., `EnrollmentForm.tsx`)
- Pages: PascalCase singular (e.g., `Attendance.tsx`)
- Constants: UPPER_SNAKE_CASE

## Data Flow
Services → Context (if global) → Pages → Components

## Examples
```ts
import { studentService } from '@/features/students/services/studentService';
const { data, error } = await studentService.getAll();
```
