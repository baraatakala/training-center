# Copilot Instructions for AI Coding Agents

## Project Overview
- This is a React + TypeScript application using Vite for build and HMR, with Supabase as the backend database.
- The `src/services/` directory contains all data access logic, organized by entity (students, teachers, courses, sessions, enrollments, attendance).
- Each service provides CRUD methods and returns `{ data, error }` objects. Always check for errors after service calls.

## Key Architectural Patterns
- **Service Layer**: All database interactions go through service modules in `src/services/`. Do not access Supabase directly from components.
- **Component Structure**: UI components are in `src/components/` and `src/pages/`. Pages are route-level containers; components are reusable UI blocks.
- **Context**: Authentication and global state are managed via React Context in `src/context/`.
- **Type Safety**: Use TypeScript types from `src/types/` for all data models and API responses.

## Developer Workflows
- **Development**: Use `npm run dev` to start the Vite dev server with HMR.
- **Build**: Use `npm run build` to create a production build.
- **Linting**: Run `npm run lint` to check code quality. ESLint is configured for TypeScript and React.
- **Testing**: (Add details here if/when tests are present.)

## Project-Specific Conventions
- **Error Handling**: Always destructure and check `{ data, error }` from service calls. Log or display errors as appropriate.
- **Naming**: Service files are named `<entity>Service.ts`. Components use PascalCase. Pages use singular nouns (e.g., `Student.tsx`).
- **Data Flow**: Data flows from services → context (if global) → pages → components.
- **Supabase**: All Supabase logic is centralized in `src/lib/supabase.ts`.

## Integration Points
- **Supabase**: Used for authentication and database. See `src/lib/supabase.ts` and service modules.
- **Excel Export**: `src/services/excelExportService.ts` handles data export features.
- **QR Code**: QR code logic is in `src/components/QRCodeModal.tsx` and related attendance pages.

## Examples
- Fetching students: `const { data, error } = await studentService.getAll();`
- Creating a course: `await courseService.create({ name: 'Math 101', ... })`
- Using context: `const { user } = useContext(AuthContext);`

## References
- See `src/services/README.md` for service usage patterns.
- See `README.md` for build and lint instructions.

---

_If any section is unclear or missing, please provide feedback for further refinement._
