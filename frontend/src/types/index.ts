/**
 * Core type definitions for the map application
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Lambert93Coords {
  x: number;
  y: number;
}

export interface ZoneCorners {
  firstCorner: LatLng | null;
  secondCorner: LatLng | null;
  firstCornerL93: Lambert93Coords | null;
  secondCornerL93: Lambert93Coords | null;
}

export interface SelectionRectangle {
  topLeft: LatLng;
  bottomRight: LatLng;
  topLeftL93: Lambert93Coords;
  bottomRightL93: Lambert93Coords;
}

export interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name: string;
  type: string;
}

export type MapType = 'osm' | 'satellite' | 'terrain';

export interface MapTypeOption {
  value: MapType;
  label: string;
  url: string;
  attribution: string;
}

// --- GeoJSON (minimal types for Polygon/MultiPolygon import) ---

export type GeoJsonPosition = [number, number]; // [x,y] or [lon,lat] depending on CRS

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: GeoJsonPosition[][]; // [ring][pos]
}

export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: GeoJsonPosition[][][]; // [polygon][ring][pos]
}

export type GeoJsonGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

export interface GeoJsonFeature<P = Record<string, unknown>> {
  type: 'Feature';
  geometry: GeoJsonGeometry;
  properties?: P | null;
  id?: string | number;
}

export interface GeoJsonFeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: Array<GeoJsonFeature<P>>;
}

export type ZoneCrs = 'EPSG:4326' | 'EPSG:2154';

export interface ZonePaddingMeters {
  padX: number;
  padY: number;
}

export interface Lambert93Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Wgs84Bounds {
  southWest: LatLng;
  northEast: LatLng;
}

export interface ZoneStats {
  crsDetected: ZoneCrs;
  paddingMeters: ZonePaddingMeters;
  bboxLambert93: Lambert93Bbox;
  bboxLambert93Padded: Lambert93Bbox;
  bboxWgs84Padded: Wgs84Bounds;
  areaM2: number;
  areaHa: number;
  perimeterM: number;
  perimeterKm: number;
}
