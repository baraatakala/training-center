# Database

Consolidated SQL files for the Training Center Supabase database.

## Run Order (Fresh Deployment)

| # | File | Description |
|---|------|-------------|
| 1 | `schema.sql` | All 34 table definitions in dependency order |
| 2 | `functions.sql` | Helper functions, trigger functions, and trigger bindings |
| 3 | `indexes.sql` | All performance indexes (~80 indexes) |
| 4 | `rls-policies.sql` | Row Level Security policies for all tables (~107 policies) |
| 5 | `storage.sql` | Supabase storage bucket configuration |
| 6 | `seed-data.sql` | Essential seed data (admin user, specializations, late brackets, feedback template) |

## Architecture

- **Roles**: Admin (full access), Teacher (read + insert), Student (scoped read)
- **Auth**: Policies use `is_admin()`, `is_teacher()`, `get_my_student_id()` helper functions
- **Timestamps**: Most tables have `updated_at` triggers via `update_updated_at_column()`
- **Validation**: Business-logic triggers enforce data integrity (e.g., excuse date must match session day)

## Archive

The `archive/` directory contains the original 75 incremental migration files for historical reference. These are superseded by the consolidated files above.
