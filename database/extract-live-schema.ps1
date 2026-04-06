## Extract Live Schema from Supabase via Management API
## Usage: .\database\extract-live-schema.ps1

$token = $env:SUPABASE_ACCESS_TOKEN
if (-not $token) { throw "Set SUPABASE_ACCESS_TOKEN environment variable before running this script." }
$ref = "qrznvvjlzqzoqsmzljvk"
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }
$outDir = "database"

function Run-Query($sql) {
    $body = @{ query = $sql } | ConvertTo-Json -Depth 1
    $resp = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Method Post -Headers $headers -Body $body
    return $resp
}

Write-Host "=== Extracting live schema from Supabase ($ref) ===" -ForegroundColor Cyan

# 1. Tables + Columns
Write-Host "[1/8] Tables & columns..." -ForegroundColor Yellow
$tables = Run-Query @"
SELECT 
  t.table_name,
  c.column_name,
  c.ordinal_position,
  c.data_type,
  c.udt_name,
  c.column_default,
  c.is_nullable,
  c.character_maximum_length,
  c.numeric_precision,
  c.numeric_scale
FROM information_schema.tables t
JOIN information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name, c.ordinal_position
"@
$tables | ConvertTo-Json -Depth 5 | Set-Content "$outDir/live-tables-columns.json" -Encoding UTF8

# 2. Constraints (PK, FK, UNIQUE, CHECK)
Write-Host "[2/8] Constraints..." -ForegroundColor Yellow
$constraints = Run-Query @"
SELECT 
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu 
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu 
  ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
WHERE tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name
"@
$constraints | ConvertTo-Json -Depth 5 | Set-Content "$outDir/live-constraints.json" -Encoding UTF8

# 3. Indexes
Write-Host "[3/8] Indexes..." -ForegroundColor Yellow
$indexes = Run-Query @"
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes 
WHERE schemaname = 'public'
ORDER BY tablename, indexname
"@
$indexes | ConvertTo-Json -Depth 5 | Set-Content "$outDir/live-indexes.json" -Encoding UTF8

# 4. Functions / Stored Procedures
Write-Host "[4/8] Functions..." -ForegroundColor Yellow
$functions = Run-Query @"
SELECT 
  p.proname AS function_name,
  pg_get_functiondef(p.oid) AS function_def,
  p.provolatile,
  p.prosecdef AS security_definer,
  l.lanname AS language,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_language l ON p.prolang = l.oid
WHERE n.nspname = 'public'
ORDER BY p.proname
"@
$functions | ConvertTo-Json -Depth 5 | Set-Content "$outDir/live-functions.json" -Encoding UTF8

# 5. RLS Policies
Write-Host "[5/8] RLS policies..." -ForegroundColor Yellow
$policies = Run-Query @"
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname
"@
$policies | ConvertTo-Json -Depth 5 | Set-Content "$outDir/live-rls-policies.json" -Encoding UTF8

# 6. Triggers
Write-Host "[6/8] Triggers..." -ForegroundColor Yellow
$triggers = Run-Query @"
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_timing,
  action_statement,
  action_orientation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name
"@
$triggers | ConvertTo-Json -Depth 5 | Set-Content "$outDir/live-triggers.json" -Encoding UTF8

# 7. Enums / Custom Types
Write-Host "[7/8] Enums & custom types..." -ForegroundColor Yellow
$enums = Run-Query @"
SELECT 
  t.typname AS enum_name,
  e.enumlabel AS enum_value,
  e.enumsortorder
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY t.typname, e.enumsortorder
"@
$enums | ConvertTo-Json -Depth 5 | Set-Content "$outDir/live-enums.json" -Encoding UTF8

# 8. RLS enabled status per table
Write-Host "[8/8] RLS status..." -ForegroundColor Yellow
$rls = Run-Query @"
SELECT 
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname
"@
$rls | ConvertTo-Json -Depth 5 | Set-Content "$outDir/live-rls-status.json" -Encoding UTF8

Write-Host "`n=== Schema extraction complete! ===" -ForegroundColor Green
Write-Host "Files saved to $outDir/live-*.json"
