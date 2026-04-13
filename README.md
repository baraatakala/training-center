# Training Center

A full-featured training center management application built with React, TypeScript, and Supabase.

## Tech Stack

- **Frontend**: React 19 + TypeScript 5.9 + Vite 7
- **Styling**: Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth + Storage + RLS)
- **Path Aliases**: `@/*` maps to `./src/*`

## Getting Started

```bash
npm install
npm run dev       # Start dev server with HMR
npm run build     # Production build (tsc + vite build)
npm run lint      # ESLint check
```

## Project Structure

```
src/
  app/                        # App shell: App.tsx, Layout.tsx, NotFound.tsx
  features/                   # Feature modules (domain-driven)
    attendance/               #   pages/, components/, services/, constants/, utils/
    auth/                     #   AuthContext
    certificates/
    checkin/
    communication/
    courses/
    dashboard/
    data-import/
    enrollments/
    excuses/
    exports/
    feedback/
    scoring/
    sessions/
    specializations/
    students/
    teachers/
  shared/                     # Cross-feature code
    components/ui/            #   Reusable UI primitives
    hooks/                    #   Custom hooks
    lib/                      #   supabase.ts client
    services/                 #   Shared services (audit)
    types/                    #   TypeScript type definitions
    utils/                    #   Utility functions
    constants/                #   App-wide constants
database/
  schema.sql                  # 32 table definitions
  functions.sql               # Functions & triggers
  indexes.sql                 # Performance indexes
  rls-policies.sql            # Row Level Security (~107 policies)
  storage.sql                 # Supabase storage buckets
  seed-data.sql               # Essential seed data
  archive/                    # Historical migration files (75 files)
docs/                         # Project documentation
```

## Architecture Rules

1. **Service Layer**: All Supabase queries go through `services/` modules — never in pages or components. ESLint enforces this with `no-restricted-imports`.
2. **Feature Modules**: Each feature owns its pages, components, services, and constants. Import across features via `@/features/<name>/`.
3. **Shared Code**: Only truly cross-feature code lives in `@/shared/`.
4. **Type Safety**: Use types from `@/shared/types/` for all data models.
5. **Error Handling**: Service calls return `{ data, error }`. Always check errors.

## Database

See [database/README.md](database/README.md) for schema documentation and run order.
