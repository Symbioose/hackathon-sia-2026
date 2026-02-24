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

export interface ZonePadding {
  buffer: number;
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
  paddingMeters: ZonePadding;
  bboxLambert93: Lambert93Bbox;
  bboxLambert93Padded: Lambert93Bbox;
  bboxWgs84Padded: Wgs84Bounds;
  areaM2: number;
  areaHa: number;
  perimeterM: number;
  perimeterKm: number;
}

export type AnalysisType =
  | 'mnt'
  | 'axe_ruissellement'
  | 'occupation_sols'
  | 'culture'
  | 'bassin_versant'
  | 'pluie';

export type AnalysisStatus = 'idle' | 'pending' | 'success' | 'error';

export interface AnalysisResult {
  type: AnalysisType;
  label: string;
  status: AnalysisStatus;
  url?: string;
  error?: string;
}

// --- Analysis display data (preview on map) ---

export interface MntStats {
  alt_min: number;
  alt_max: number;
  alt_mean: number;
  resolution_m: number;
  width_px: number;
  height_px: number;
}

export interface MntDisplayData {
  kind: 'raster';
  png_url: string;
  bounds: { south: number; west: number; north: number; east: number };
  stats: MntStats;
}

export interface VectorStats {
  feature_count: number;
  geometry_type: string;
  total_area_ha?: number;
  total_length_km?: number;
  distribution?: Record<string, { count: number; area_ha?: number }>;
  extra?: Record<string, string | number>;
}

export interface VectorDisplayData {
  kind: 'vector';
  geojson: GeoJsonFeatureCollection;
  stats: VectorStats;
  layer_name: string;
}

export type AnalysisDisplayData = MntDisplayData | VectorDisplayData;
