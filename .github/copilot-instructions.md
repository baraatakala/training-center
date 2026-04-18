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
7. **Post-Migration Sync**: After applying any migration to Supabase, **always** update the corresponding consolidated SQL file (`schema.sql`, `functions.sql`, `indexes.sql`, `rls-policies.sql`) and bump the header sync comment. Also add the migration entry to `database/README.md`.
8. **Large Legacy Screens**: `Attendance.tsx` and `BulkScheduleTable.tsx` still contain transitional service facades; prefer extracting narrow service methods rather than expanding page/component query logic.

## Developer Workflows
- `npm run dev` — Start Vite dev server with HMR
- `npm run build` — Production build (`tsc -b && vite build`)
- `npm run lint` — ESLint check
- `npx tsc -b --noEmit` — Type-check only

## Database
- 38 tables, ~145 RLS policies, 19 functions, ~112 indexes, 48 migrations. See `database/README.md` for full details.
- Run order: `schema.sql` → `functions.sql` → `indexes.sql` → `rls-policies.sql` → `storage.sql` → `seed-data.sql`
- Historical migrations in `database/archive/`
- Active migrations in `database/migrations/` (001–046)

## Supabase MCP (Database Agent Workflow)
Use the Supabase MCP tools **proactively** for all database work — never guess at live state.

### When to use `mcp_supabase_execute_sql`
- **Verify migrations**: After applying a migration, run `SELECT` queries to confirm tables/columns/constraints exist.
- **Test RLS policies**: Query as different roles to confirm policies work (`SET ROLE authenticated; SET request.jwt.claims = '...';`).
- **Diagnose bugs**: When a service returns unexpected data, query the table directly to isolate DB vs code issues.
- **Validate backfills**: After data migrations, count rows, check NULLs, and spot-check values.
- **CRUD smoke-tests**: Insert/select/update/delete test rows to verify constraints, triggers, and RLS.
- **Schema inspection**: `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '...'`.
- **Index/constraint verification**: Query `pg_indexes`, `pg_constraint`, `information_schema.table_constraints`.

### When to use `mcp_supabase_apply_migration`
- **All DDL changes**: CREATE TABLE, ALTER TABLE, CREATE INDEX, CREATE POLICY, CREATE FUNCTION.
- Never use `execute_sql` for DDL — always `apply_migration` so it's tracked in `supabase_migrations.schema_migrations`.

### When to use `mcp_supabase_list_tables`
- Quick schema overview. Use `verbose: true` to see columns, PKs, and FKs.
- Compare live schema against `database/schema.sql` to detect drift.

### When to use `mcp_supabase_list_migrations`
- Verify which migrations have been applied.
- Cross-reference with `database/migrations/` to detect unapplied files.

### Standard verification flow after any migration:
1. `mcp_supabase_list_migrations` — confirm it appears
2. `mcp_supabase_list_tables verbose:true` — confirm schema changes
3. `mcp_supabase_execute_sql` — run SELECT queries to verify data, constraints, RLS
4. Update consolidated SQL files + `database/README.md`

### Test data references (for verification queries):
- Teacher Ahmad: `teacher_id = '18ff66f1-738d-4fb8-9243-2c3af2168f16'`
- Session: `session_id = 'f5e1425a-a78e-4576-8fc3-3a742d2237d1'`
- Student asmaatakala: `student_id = '5e2d1197-2536-4e7b-8f23-2387946c7c81'`

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
