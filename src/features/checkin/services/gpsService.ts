/**
 * GPS Location Service
 * Provides precise location tracking with validation and offline buffer support
 */

export interface GPSCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: Date;
}

export interface LocationZone {
  zone_id: string;
  zone_name: string;
  center_latitude: number;
  center_longitude: number;
  radius_meters: number;
  is_active: boolean;
}

class GPSLocationService {
  private offlineBuffer: GPSCoordinates[] = [];
  private watchId: number | null = null;

  /**
   * Get current GPS position with high accuracy
   */
  async getCurrentPosition(): Promise<GPSCoordinates> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords: GPSCoordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: new Date(position.timestamp)
          };
          
          // Store in offline buffer
          this.offlineBuffer.push(coords);
          if (this.offlineBuffer.length > 100) {
            this.offlineBuffer.shift(); // Keep last 100 readings
          }
          
          resolve(coords);
        },
        (error) => {
          // If online fetch fails but we have buffered data, return latest
          if (this.offlineBuffer.length > 0) {
            resolve(this.offlineBuffer[this.offlineBuffer.length - 1]);
          } else {
            reject(new Error(`GPS Error: ${error.message}`));
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  }

  /**
   * Start watching position changes
   */
  startWatching(callback: (coords: GPSCoordinates) => void): void {
    if (!navigator.geolocation) {
      throw new Error('Geolocation is not supported');
    }

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const coords: GPSCoordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date(position.timestamp)
        };
        
        this.offlineBuffer.push(coords);
        if (this.offlineBuffer.length > 100) {
          this.offlineBuffer.shift();
        }
        
        callback(coords);
      },
      (error) => {
        console.error('GPS watch error:', error);
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 1000
      }
    );
  }

  /**
   * Stop watching position changes
   */
  stopWatching(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  /**
   * Calculate distance between two GPS coordinates (Haversine formula)
   * Returns distance in meters
   */
  calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371e3; // Earth's radius in meters
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
   * Validate if current position is within a location zone
   */
  validateLocation(
    currentCoords: GPSCoordinates,
    zone: LocationZone
  ): { isValid: boolean; distance: number; message: string } {
    const distance = this.calculateDistance(
      currentCoords.latitude,
      currentCoords.longitude,
      zone.center_latitude,
      zone.center_longitude
    );

    const isValid = distance <= zone.radius_meters;

    return {
      isValid,
      distance: Math.round(distance),
      message: isValid
        ? `Within zone (${Math.round(distance)}m from center)`
        : `Outside zone (${Math.round(distance)}m from center, max ${zone.radius_meters}m)`
    };
  }

  /**
   * Check if GPS accuracy is acceptable (sub-meter to few meters)
   */
  isAccuracyAcceptable(coords: GPSCoordinates): { acceptable: boolean; message: string } {
    if (coords.accuracy <= 5) {
      return { acceptable: true, message: `Excellent accuracy (±${coords.accuracy}m)` };
    } else if (coords.accuracy <= 15) {
      return { acceptable: true, message: `Good accuracy (±${coords.accuracy}m)` };
    } else if (coords.accuracy <= 30) {
      return { acceptable: true, message: `Fair accuracy (±${coords.accuracy}m)` };
    } else {
      return { acceptable: false, message: `Poor accuracy (±${coords.accuracy}m). Please wait for better signal.` };
    }
  }

  /**
   * Get offline buffer for debugging
   */
  getOfflineBuffer(): GPSCoordinates[] {
    return [...this.offlineBuffer];
  }

  /**
   * Clear offline buffer
   */
  clearOfflineBuffer(): void {
    this.offlineBuffer = [];
  }

  /**
   * Check if geolocation is available
   */
  isAvailable(): boolean {
    return 'geolocation' in navigator;
  }

  /**
   * Request location permission
   */
  async requestPermission(): Promise<PermissionState> {
    if (!navigator.permissions) {
      throw new Error('Permissions API not supported');
    }
    
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      return result.state;
    } catch (error) {
      console.error('Permission query failed:', error);
      return 'prompt';
    }
  }
}

export const gpsService = new GPSLocationService();
