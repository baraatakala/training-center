/**
 * Geocoding Service
 * Provides utilities for converting addresses to GPS coordinates
 * and validating proximity between two locations
 */

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * @param lat1 Latitude of point 1
 * @param lon1 Longitude of point 1
 * @param lat2 Latitude of point 2
 * @param lon2 Longitude of point 2
 * @returns Distance in meters
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Check if a point is within the allowed radius of a target location
 * @param userLat User's latitude
 * @param userLon User's longitude
 * @param targetLat Target latitude (session host location)
 * @param targetLon Target longitude (session host location)
 * @param radiusMeters Allowed radius in meters
 * @returns Object with isWithinRadius boolean and distance in meters
 */
export function isWithinProximity(
  userLat: number,
  userLon: number,
  targetLat: number,
  targetLon: number,
  radiusMeters: number
): { isWithinRadius: boolean; distance: number } {
  const distance = calculateDistance(userLat, userLon, targetLat, targetLon);
  return {
    isWithinRadius: distance <= radiusMeters,
    distance: Math.round(distance),
  };
}

/**
 * Validate coordinate values
 * @param lat Latitude (-90 to 90)
 * @param lon Longitude (-180 to 180)
 * @returns true if valid, false otherwise
 */
export function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Parse GPS coordinates from a string
 * Supports formats: "lat,lon" or "lat, lon"
 * @param coordString String containing coordinates
 * @returns Object with lat and lon, or null if invalid
 */
export function parseCoordinates(coordString: string): { lat: number; lon: number } | null {
  if (!coordString || typeof coordString !== 'string') return null;
  
  const parts = coordString.split(',').map(p => p.trim());
  if (parts.length !== 2) return null;
  
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  
  if (!isValidCoordinate(lat, lon)) return null;
  
  return { lat, lon };
}

/**
 * Format distance for display
 * @param meters Distance in meters
 * @returns Formatted string (e.g., "50m" or "1.2km")
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * FUTURE: Geocode an address using a geocoding API
 * NOTE: This requires an external service (Google Maps, OpenStreetMap, etc.)
 * For now, coordinates must be entered manually
 * 
 * @param _address Address string (unused, for future implementation)
 * @returns Promise with coordinates or null
 */
export async function geocodeAddress(
  _address: string
): Promise<{ lat: number; lon: number } | null> {
  // TODO: Implement with geocoding service
  // Options:
  // 1. Google Maps Geocoding API (requires API key)
  // 2. OpenStreetMap Nominatim (free but rate-limited)
  // 3. Mapbox Geocoding (requires API key)
  
  console.warn('Geocoding not yet implemented. Please enter coordinates manually.');
  return null;
}

/**
 * Get user's current GPS location from browser
 * @returns Promise with coordinates and accuracy, or null if denied/unavailable
 */
export function getCurrentLocation(): Promise<{
  latitude: number;
  longitude: number;
  accuracy: number;
} | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.error('Geolocation not supported by browser');
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        console.error('Geolocation error:', error);
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  });
}
