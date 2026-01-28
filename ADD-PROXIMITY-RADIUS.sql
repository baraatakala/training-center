-- Migration: Add proximity_radius to session table for location-based attendance validation
-- Date: 2026-01-28

-- Add proximity_radius column to session table (default 50 meters)
ALTER TABLE session 
ADD COLUMN IF NOT EXISTS proximity_radius INTEGER DEFAULT 50;

-- Add comment for documentation
COMMENT ON COLUMN session.proximity_radius IS 'Maximum distance in meters for student check-in validation (GPS-based). Default 50m ensures physical presence.';

-- Create function to calculate distance between two GPS coordinates (Haversine formula)
CREATE OR REPLACE FUNCTION calculate_gps_distance(
  lat1 DOUBLE PRECISION,
  lon1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION,
  lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  earth_radius CONSTANT DOUBLE PRECISION := 6371000; -- Earth radius in meters
  dlat DOUBLE PRECISION;
  dlon DOUBLE PRECISION;
  a DOUBLE PRECISION;
  c DOUBLE PRECISION;
BEGIN
  -- Handle NULL values
  IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN
    RETURN NULL;
  END IF;

  -- Convert degrees to radians
  dlat := radians(lat2 - lat1);
  dlon := radians(lon2 - lon1);
  
  -- Haversine formula
  a := sin(dlat/2) * sin(dlat/2) + 
       cos(radians(lat1)) * cos(radians(lat2)) * 
       sin(dlon/2) * sin(dlon/2);
  c := 2 * atan2(sqrt(a), sqrt(1-a));
  
  -- Return distance in meters
  RETURN earth_radius * c;
END;
$$;

COMMENT ON FUNCTION calculate_gps_distance IS 'Calculate distance in meters between two GPS coordinates using Haversine formula';

-- Verification query
SELECT column_name, data_type, column_default, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'session' AND column_name = 'proximity_radius';

-- Test function with example coordinates (Baghdad to Erbil ~350km)
SELECT calculate_gps_distance(33.3152, 44.3661, 36.1911, 44.0091) as distance_meters;
