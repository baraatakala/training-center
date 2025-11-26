-- Add GPS tracking and notes columns to attendance table
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS gps_latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS gps_longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS gps_accuracy DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS gps_timestamp TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS marked_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS marked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create location_zone table for GPS validation zones
CREATE TABLE IF NOT EXISTS location_zone (
    zone_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id UUID NOT NULL REFERENCES location(location_id) ON DELETE CASCADE,
    zone_name VARCHAR(255) NOT NULL,
    center_latitude DECIMAL(10, 8) NOT NULL,
    center_longitude DECIMAL(11, 8) NOT NULL,
    radius_meters INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for location zone queries
CREATE INDEX IF NOT EXISTS idx_location_zone_location ON location_zone(location_id);
CREATE INDEX IF NOT EXISTS idx_location_zone_active ON location_zone(is_active);

-- Create trigger for location_zone updated_at
CREATE OR REPLACE FUNCTION update_location_zone_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_location_zone_updated_at
    BEFORE UPDATE ON location_zone
    FOR EACH ROW
    EXECUTE FUNCTION update_location_zone_updated_at();

-- Create indexes for attendance GPS queries
CREATE INDEX IF NOT EXISTS idx_attendance_gps ON attendance(gps_latitude, gps_longitude) WHERE gps_latitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_marked_at ON attendance(marked_at) WHERE marked_at IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN attendance.gps_latitude IS 'GPS latitude coordinate when attendance was marked';
COMMENT ON COLUMN attendance.gps_longitude IS 'GPS longitude coordinate when attendance was marked';
COMMENT ON COLUMN attendance.gps_accuracy IS 'GPS accuracy in meters';
COMMENT ON COLUMN attendance.gps_timestamp IS 'Timestamp when GPS coordinates were captured';
COMMENT ON COLUMN attendance.notes IS 'Additional notes or comments about the attendance record';
COMMENT ON COLUMN attendance.marked_by IS 'Name or ID of person who marked attendance';
COMMENT ON COLUMN attendance.marked_at IS 'Timestamp when attendance was marked';
COMMENT ON TABLE location_zone IS 'Defines valid GPS zones for attendance validation';
