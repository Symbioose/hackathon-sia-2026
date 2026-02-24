import proj4 from 'proj4';
import { LatLng, Lambert93Coords } from '../types';

// LAMBERT-93 projection definition (EPSG:2154)
const LAMBERT93_PROJ =
  '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

// WGS84 projection (standard geographic coordinates)
const WGS84_PROJ = 'WGS84';

// Register projection if not already registered
if (!proj4.defs('EPSG:2154')) {
  proj4.defs('EPSG:2154', LAMBERT93_PROJ);
}

/**
 * Convert WGS84 (latitude, longitude) to LAMBERT-93 (x, y)
 * @param lat - Latitude in decimal degrees
 * @param lng - Longitude in decimal degrees
 * @returns Lambert93Coords with x and y in meters
 */
export function wgs84ToLambert93(lat: number, lng: number): Lambert93Coords {
  const [x, y] = proj4(WGS84_PROJ, 'EPSG:2154', [lng, lat]);
  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
  };
}

/**
 * Convert LAMBERT-93 (x, y) to WGS84 (latitude, longitude)
 * @param x - X coordinate in meters (LAMBERT-93)
 * @param y - Y coordinate in meters (LAMBERT-93)
 * @returns LatLng with lat and lng in decimal degrees
 */
export function lambert93ToWgs84(x: number, y: number): LatLng {
  const [lng, lat] = proj4('EPSG:2154', WGS84_PROJ, [x, y]);
  return {
    lat: Math.round(lat * 100000) / 100000,
    lng: Math.round(lng * 100000) / 100000,
  };
}

/**
 * Format LAMBERT-93 coordinates for display
 * @param coords - Lambert93Coords object
 * @returns Formatted string representation
 */
export function formatLambert93(coords: Lambert93Coords): string {
  return `X: ${coords.x.toLocaleString('fr-FR')}, Y: ${coords.y.toLocaleString('fr-FR')}`;
}

/**
 * Format WGS84 coordinates for display
 * @param coords - LatLng object
 * @returns Formatted string representation
 */
export function formatWgs84(coords: LatLng): string {
  return `${coords.lat.toFixed(5)}°, ${coords.lng.toFixed(5)}°`;
}
