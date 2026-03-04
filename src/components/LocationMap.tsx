import { useState, useMemo } from 'react';
import { calculateDistance, formatDistance } from '../services/geocodingService';

interface LocationPoint {
  label: string;
  lat: number;
  lon: number;
  count?: number;
  dates?: string[];
}

interface LocationMapProps {
  /** Array of location points to display */
  locations: LocationPoint[];
  /** Title for the map section */
  title?: string;
  /** Whether to show the embedded map (OpenStreetMap iframe) */
  showEmbed?: boolean;
  /** Default zoom level (1-18) */
  zoom?: number;
  /** Whether to show distance matrix between locations */
  showDistanceMatrix?: boolean;
  /** Compact mode - single location display */
  compact?: boolean;
}

/**
 * LocationMap Component
 * Provides location visualization using OpenStreetMap embed (no external packages)
 * and Google Maps links for navigation/directions
 */
export function LocationMap({
  locations,
  title,
  showEmbed = true,
  zoom = 13,
  showDistanceMatrix = false,
  compact = false,
}: LocationMapProps) {
  const [selectedLocation, setSelectedLocation] = useState<number>(0);
  const [showMatrix, setShowMatrix] = useState(false);

  // Calculate distance matrix
  const distanceMatrix = useMemo(() => {
    if (!showDistanceMatrix || locations.length < 2) return null;
    const matrix: { from: string; to: string; distance: number }[] = [];
    for (let i = 0; i < locations.length; i++) {
      for (let j = i + 1; j < locations.length; j++) {
        matrix.push({
          from: locations[i].label,
          to: locations[j].label,
          distance: calculateDistance(
            locations[i].lat, locations[i].lon,
            locations[j].lat, locations[j].lon
          ),
        });
      }
    }
    return matrix.sort((a, b) => a.distance - b.distance);
  }, [locations, showDistanceMatrix]);

  if (locations.length === 0) return null;

  const currentLoc = locations[selectedLocation] || locations[0];

  // OpenStreetMap embed URL with marker
  const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${currentLoc.lon - 0.005},${currentLoc.lat - 0.003},${currentLoc.lon + 0.005},${currentLoc.lat + 0.003}&layer=mapnik&marker=${currentLoc.lat},${currentLoc.lon}`;

  // Google Maps link for directions
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${currentLoc.lat},${currentLoc.lon}`;

  // Google Maps directions URL (from current location)
  const googleMapsDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${currentLoc.lat},${currentLoc.lon}`;

  // OpenStreetMap link
  const osmUrl = `https://www.openstreetmap.org/?mlat=${currentLoc.lat}&mlon=${currentLoc.lon}#map=${zoom}/${currentLoc.lat}/${currentLoc.lon}`;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          title="Open in Google Maps"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Map
        </a>
        <a
          href={googleMapsDirectionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
          title="Get Directions"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          Directions
        </a>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {title && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
          <h3 className="text-sm font-semibold dark:text-white flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {title}
          </h3>
        </div>
      )}

      {/* Location selector (when multiple locations) */}
      {locations.length > 1 && (
        <div className="p-3 border-b dark:border-gray-600 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {locations.map((loc, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedLocation(idx)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                  selectedLocation === idx
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                📍 {loc.label}
                {loc.count && <span className="ml-1 opacity-75">({loc.count}×)</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Map embed */}
      {showEmbed && (
        <div className="relative">
          <iframe
            title={`Map: ${currentLoc.label}`}
            src={osmEmbedUrl}
            className="w-full h-[250px] border-0"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <div className="absolute bottom-2 right-2 flex gap-1">
            <a
              href={osmUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 bg-white/90 dark:bg-gray-800/90 rounded text-[10px] font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 shadow-sm border border-gray-200 dark:border-gray-600"
            >
              🗺️ Full Map
            </a>
          </div>
        </div>
      )}

      {/* Location details */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium dark:text-white">{currentLoc.label}</p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              {currentLoc.lat.toFixed(6)}, {currentLoc.lon.toFixed(6)}
              {currentLoc.count && ` • ${currentLoc.count} session${currentLoc.count > 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Google Maps
            </a>
            <a
              href={googleMapsDirectionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              Directions
            </a>
          </div>
        </div>

        {/* Dates hosted */}
        {currentLoc.dates && currentLoc.dates.length > 0 && (
          <div className="text-[10px] text-gray-500 dark:text-gray-400">
            <span className="font-medium">Sessions: </span>
            {currentLoc.dates.join(', ')}
          </div>
        )}
      </div>

      {/* Distance Matrix */}
      {showDistanceMatrix && distanceMatrix && distanceMatrix.length > 0 && (
        <div className="border-t dark:border-gray-600">
          <button
            onClick={() => setShowMatrix(prev => !prev)}
            className="w-full px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-1 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
            {showMatrix ? 'Hide' : 'Show'} Distance Matrix ({distanceMatrix.length} pairs)
          </button>
          {showMatrix && (
            <div className="px-3 pb-3 space-y-1">
              {distanceMatrix.map((pair, idx) => (
                <div key={idx} className="flex items-center justify-between text-[10px] py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <span className="text-gray-600 dark:text-gray-400">
                    📍 {pair.from} → {pair.to}
                  </span>
                  <span className={`font-mono font-medium ${pair.distance < 1000 ? 'text-green-600 dark:text-green-400' : pair.distance < 5000 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                    {formatDistance(pair.distance)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
