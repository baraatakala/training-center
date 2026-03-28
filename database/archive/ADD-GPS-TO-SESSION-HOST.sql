-- Migration: Add GPS coordinates to session_date_host table
-- Purpose: Enable proximity validation for attendance check-ins
-- Date: 2026-01-29
-- Impact: GAME CHANGER FEATURE - Prevents remote check-ins and verifies physical presence

-- Add latitude and longitude columns to session_date_host table
ALTER TABLE public.session_date_host 
ADD COLUMN IF NOT EXISTS host_latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS host_longitude DECIMAL(11, 8);

-- Add comments for documentation
COMMENT ON COLUMN public.session_date_host.host_latitude IS 
'Latitude coordinate of the host address. Used for proximity validation during check-in (range: -90 to 90)';

COMMENT ON COLUMN public.session_date_host.host_longitude IS 
'Longitude coordinate of the host address. Used for proximity validation during check-in (range: -180 to 180)';

-- Add check constraints to ensure valid coordinates
ALTER TABLE public.session_date_host
ADD CONSTRAINT check_valid_latitude CHECK (host_latitude IS NULL OR (host_latitude >= -90 AND host_latitude <= 90));

ALTER TABLE public.session_date_host
ADD CONSTRAINT check_valid_longitude CHECK (host_longitude IS NULL OR (host_longitude >= -180 AND host_longitude <= 180));

-- Create index for spatial queries (optional but improves performance)
CREATE INDEX IF NOT EXISTS idx_session_date_host_coordinates 
ON public.session_date_host(host_latitude, host_longitude) 
WHERE host_latitude IS NOT NULL AND host_longitude IS NOT NULL;

-- IMPORTANT: Coordinates must be manually entered or obtained via geocoding service
-- The system will:
-- 1. Allow teachers to manually enter coordinates when selecting a host
-- 2. Validate student location is within proximity_radius (from session table) when checking in
-- 3. Reject check-ins if student is outside the allowed radius

-- Example: Update coordinates for a specific host address
-- UPDATE public.session_date_host 
-- SET host_latitude = 33.5138, host_longitude = 36.2765 
-- WHERE host_address = '123 Main St, Damascus';

-- Verification queries:
-- 1. Check columns were added
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'session_date_host' 
-- AND column_name IN ('host_latitude', 'host_longitude');

-- 2. Check how many hosts have coordinates
-- SELECT 
--   COUNT(*) as total_hosts,
--   COUNT(host_latitude) as hosts_with_coordinates,
--   ROUND(COUNT(host_latitude)::numeric / NULLIF(COUNT(*), 0) * 100, 2) as percentage_complete
-- FROM session_date_host;

-- 3. List hosts without coordinates (need to be geocoded)
-- SELECT id, host_address, attendance_date
-- FROM session_date_host
-- WHERE host_latitude IS NULL OR host_longitude IS NULL
-- ORDER BY attendance_date DESC
-- LIMIT 20;
