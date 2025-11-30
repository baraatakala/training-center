-- SQL CONSTRAINT ANALYSIS: Status-CanHost Logic Validation
-- ========================================================

-- ISSUE: Enrollment status and can_host field should have a dependency
-- RULE: Only 'active' enrollments can have can_host = TRUE
--       All non-active enrollments (pending, completed, dropped) must have can_host = FALSE

-- IMPLEMENTATION LAYERS (Defense in Depth):
-- ==========================================

-- LAYER 1: TRIGGER FUNCTION (Application Logic)
-- Purpose: Auto-correct violations and provide immediate feedback
-- Behavior: 
--   - If status changes to non-active → auto-set can_host = FALSE
--   - If can_host set to TRUE but status is not active → RAISE EXCEPTION
-- Advantage: User gets immediate error message, consistent behavior

-- LAYER 2: CHECK CONSTRAINT (Database Constraint)
-- Purpose: Final enforcement, prevents any application bypasses
-- Syntax: CHECK (can_host = FALSE OR status = 'active')
-- This means: can_host can only be TRUE when status = 'active'
-- Advantage: Protects data integrity even if app layer is bypassed

-- LAYER 3: DATA CLEANUP (Initial Migration)
-- Purpose: Fix any existing data that violates the new rule
-- Statement: UPDATE enrollment SET can_host = FALSE 
--            WHERE can_host = TRUE AND status != 'active'
-- Advantage: Ensures clean state before constraints are applied

-- VERIFICATION QUERY:
-- Check that all can_host=TRUE records have status='active'
SELECT enrollment_id, status, can_host 
FROM public.enrollment 
WHERE can_host = TRUE;
-- Expected result: All rows show status = 'active'

-- EXPECTED BEHAVIOR AFTER IMPLEMENTATION:
-- ========================================

-- ✓ VALID: User enrolls student (status='active', can_host=FALSE) → Allowed
-- ✓ VALID: User marks can_host=TRUE for active enrollment → Allowed
-- ✓ VALID: User changes status to 'completed' with can_host=TRUE → Auto-corrects to can_host=FALSE
-- ✗ INVALID: User tries to set can_host=TRUE with status='dropped' → EXCEPTION raised
-- ✗ INVALID: Direct SQL INSERT with can_host=TRUE, status='pending' → Constraint violation

-- FRONTEND COORDINATION:
-- =====================
-- EnrollmentForm.tsx: 
--   - Disables can_host checkbox when status != 'active'
--   - Auto-clears can_host when status changes to non-active
--   - Shows helper text: "(only for active enrollments)"

-- Enrollments.tsx:
--   - Uses new service method: updateStatusWithCanHost()
--   - Visual feedback: ✓ (green) for can_host=TRUE, ✕ (gray) for blocked by status

-- enrollmentService.ts:
--   - New method: updateStatusWithCanHost()
--   - Enforces rule on update: if status != 'active' → set can_host = FALSE
