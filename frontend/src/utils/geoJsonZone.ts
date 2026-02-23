import {
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  GeoJsonGeometry,
  GeoJsonMultiPolygon,
  GeoJsonPolygon,
  GeoJsonPosition,
  Lambert93Bbox,
  LatLng,
  ZoneCrs,
  ZonePadding,
  ZoneStats,
} from '../types';
import { lambert93ToWgs84, wgs84ToLambert93 } from './coordinateTransform';

export class GeoJsonZoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeoJsonZoneError';
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function clampFiniteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizePadding(padding: ZonePadding): ZonePadding {
  return {
    buffer: clampFiniteNumber(padding.buffer, 0),
  };
}

function pickCrsFromCrsField(input: unknown): ZoneCrs | null {
  // Supports legacy GeoJSON `crs` field
  if (!isRecord(input)) return null;
  const crs = input.crs;
  if (!isRecord(crs)) return null;
  const props = crs.properties;
  if (!isRecord(props)) return null;
  const name = props.name;
  if (typeof name !== 'string') return null;
  const upper = name.toUpperCase();
  if (upper.includes('2154')) return 'EPSG:2154';
  if (upper.includes('4326')) return 'EPSG:4326';
  return null;
}

function guessCrsFromSamplePosition(pos: GeoJsonPosition): ZoneCrs {
  const [x, y] = pos;
  // WGS84 lon/lat should remain within [-180..180], [-90..90]
  // Lambert93 (meters) will be way beyond those ranges.
  if (Math.abs(x) > 180 || Math.abs(y) > 90) return 'EPSG:2154';
  return 'EPSG:4326';
}

function extractFirstPosition(geometry: GeoJsonGeometry): GeoJsonPosition {
  if (geometry.type === 'Polygon') {
    const firstRing = geometry.coordinates[0];
    if (!firstRing || firstRing.length === 0) {
      throw new GeoJsonZoneError('Polygon has no coordinates');
    }
    return firstRing[0];
  }

  const firstPoly = geometry.coordinates[0];
  const firstRing = firstPoly?.[0];
  if (!firstRing || firstRing.length === 0) {
    throw new GeoJsonZoneError('MultiPolygon has no coordinates');
  }
  return firstRing[0];
}

function assertSupportedGeometry(geometry: unknown): asserts geometry is GeoJsonGeometry {
  if (!isRecord(geometry) || typeof geometry.type !== 'string') {
    throw new GeoJsonZoneError('Invalid GeoJSON geometry');
  }
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
    throw new GeoJsonZoneError(
      `Unsupported geometry type: ${String(geometry.type)} (Polygon/MultiPolygon only)`
    );
  }
}

function normalizeToFeatureCollection(input: unknown): GeoJsonFeatureCollection {
  if (!isRecord(input) || typeof input.type !== 'string') {
    throw new GeoJsonZoneError('Invalid GeoJSON: missing type');
  }

  if (input.type === 'FeatureCollection') {
    const features = input.features;
    if (!Array.isArray(features)) {
      throw new GeoJsonZoneError('Invalid FeatureCollection: features is not an array');
    }
    const normalizedFeatures: GeoJsonFeature[] = features.map((f) => {
      if (!isRecord(f) || f.type !== 'Feature') {
        throw new GeoJsonZoneError('Invalid Feature in FeatureCollection');
      }
      assertSupportedGeometry(f.geometry);

      let properties: UnknownRecord | null = {};
      if (f.properties === null) {
        properties = null;
      } else if (isRecord(f.properties)) {
        properties = f.properties;
      }

      return {
        type: 'Feature',
        id: typeof f.id === 'string' || typeof f.id === 'number' ? f.id : undefined,
        geometry: f.geometry,
        properties,
      };
    });

    return {
      type: 'FeatureCollection',
      features: normalizedFeatures,
    };
  }

  if (input.type === 'Feature') {
    assertSupportedGeometry(input.geometry);

    let properties: UnknownRecord | null = {};
    if (input.properties === null) {
      properties = null;
    } else if (isRecord(input.properties)) {
      properties = input.properties;
    }

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: typeof input.id === 'string' || typeof input.id === 'number' ? input.id : undefined,
          geometry: input.geometry,
          properties,
        },
      ],
    };
  }

  // Bare geometry
  if (input.type === 'Polygon' || input.type === 'MultiPolygon') {
    assertSupportedGeometry(input);
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: input,
          properties: {},
        },
      ],
    };
  }

  throw new GeoJsonZoneError(`Unsupported GeoJSON type: ${String(input.type)}`);
}

function mapPolygon(
  polygon: GeoJsonPolygon,
  mapPos: (pos: GeoJsonPosition) => GeoJsonPosition
): GeoJsonPolygon {
  return {
    type: 'Polygon',
    coordinates: polygon.coordinates.map((ring) => ring.map(mapPos)),
  };
}

function mapMultiPolygon(
  multi: GeoJsonMultiPolygon,
  mapPos: (pos: GeoJsonPosition) => GeoJsonPosition
): GeoJsonMultiPolygon {
  return {
    type: 'MultiPolygon',
    coordinates: multi.coordinates.map((poly) => poly.map((ring) => ring.map(mapPos))),
  };
}

function mapGeometry(
  geometry: GeoJsonGeometry,
  mapPos: (pos: GeoJsonPosition) => GeoJsonPosition
): GeoJsonGeometry {
  if (geometry.type === 'Polygon') return mapPolygon(geometry, mapPos);
  return mapMultiPolygon(geometry, mapPos);
}

function mapFeatureCollection(
  fc: GeoJsonFeatureCollection,
  mapPos: (pos: GeoJsonPosition) => GeoJsonPosition
): GeoJsonFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => ({
      ...f,
      geometry: mapGeometry(f.geometry, mapPos),
    })),
  };
}

function forEachPosition(geometry: GeoJsonGeometry, visit: (pos: GeoJsonPosition) => void): void {
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach((ring) => ring.forEach(visit));
    return;
  }
  geometry.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(visit)));
}

function computeBboxLambert93FromFeatureCollection(
  fc: GeoJsonFeatureCollection,
  crsDetected: ZoneCrs
): Lambert93Bbox {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const update = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  fc.features.forEach((feature) => {
    forEachPosition(feature.geometry, (pos) => {
      if (crsDetected === 'EPSG:2154') {
        update(pos[0], pos[1]);
      } else {
        const l93 = wgs84ToLambert93(pos[1], pos[0]);
        update(l93.x, l93.y);
      }
    });
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    throw new GeoJsonZoneError('Could not compute bbox (no valid coordinates)');
  }

  return {
    minX: Math.round(minX * 100) / 100,
    minY: Math.round(minY * 100) / 100,
    maxX: Math.round(maxX * 100) / 100,
    maxY: Math.round(maxY * 100) / 100,
  };
}

function ringAreaShoelace(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return sum / 2;
}

function ringPerimeter(points: Array<{ x: number; y: number }>): number {
  if (points.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    sum += Math.hypot(dx, dy);
  }
  return sum;
}

function geometryToLambert93Points(
  geometry: GeoJsonGeometry,
  crsDetected: ZoneCrs
): Array<Array<Array<{ x: number; y: number }>>> {
  // Returns polygons[rings[points]] in Lambert93 meters
  const toPoint = (pos: GeoJsonPosition) => {
    if (crsDetected === 'EPSG:2154') return { x: pos[0], y: pos[1] };
    const l93 = wgs84ToLambert93(pos[1], pos[0]);
    return { x: l93.x, y: l93.y };
  };

  if (geometry.type === 'Polygon') {
    return [geometry.coordinates.map((ring) => ring.map(toPoint))];
  }

  return geometry.coordinates.map((poly) => poly.map((ring) => ring.map(toPoint)));
}

function computeAreaAndPerimeterLambert93(
  fc: GeoJsonFeatureCollection,
  crsDetected: ZoneCrs
): { areaM2: number; perimeterM: number } {
  let areaM2 = 0;
  let perimeterM = 0;

  fc.features.forEach((feature) => {
    const polygons = geometryToLambert93Points(feature.geometry, crsDetected);
    polygons.forEach((rings) => {
      if (rings.length === 0) return;

      const outer = rings[0];
      const outerArea = Math.abs(ringAreaShoelace(outer));
      const holesArea = rings
        .slice(1)
        .map((hole) => Math.abs(ringAreaShoelace(hole)))
        .reduce((acc, v) => acc + v, 0);

      areaM2 += Math.max(0, outerArea - holesArea);

      rings.forEach((ring) => {
        perimeterM += ringPerimeter(ring);
      });
    });
  });

  return {
    areaM2: Math.round(areaM2 * 100) / 100,
    perimeterM: Math.round(perimeterM * 100) / 100,
  };
}

export function buildZoneFromGeoJson(
  rawGeoJson: unknown,
  paddingMeters: ZonePadding
): { geoJsonWgs84: GeoJsonFeatureCollection; stats: ZoneStats } {
  const padding = normalizePadding(paddingMeters);
  const featureCollection = normalizeToFeatureCollection(rawGeoJson);

  const crsFromField = pickCrsFromCrsField(rawGeoJson);
  const firstPos = extractFirstPosition(featureCollection.features[0].geometry);
  const crsDetected: ZoneCrs = crsFromField ?? guessCrsFromSamplePosition(firstPos);

  const geoJsonWgs84 =
    crsDetected === 'EPSG:4326'
      ? featureCollection
      : mapFeatureCollection(featureCollection, (pos) => {
          const wgs = lambert93ToWgs84(pos[0], pos[1]);
          return [wgs.lng, wgs.lat];
        });

  const bboxLambert93 = computeBboxLambert93FromFeatureCollection(featureCollection, crsDetected);

  const bboxLambert93Padded: Lambert93Bbox = {
    minX: Math.round((bboxLambert93.minX - padding.buffer) * 100) / 100,
    minY: Math.round((bboxLambert93.minY - padding.buffer) * 100) / 100,
    maxX: Math.round((bboxLambert93.maxX + padding.buffer) * 100) / 100,
    maxY: Math.round((bboxLambert93.maxY + padding.buffer) * 100) / 100,
  };

  const southWest: LatLng = lambert93ToWgs84(bboxLambert93Padded.minX, bboxLambert93Padded.minY);
  const northEast: LatLng = lambert93ToWgs84(bboxLambert93Padded.maxX, bboxLambert93Padded.maxY);

  const { areaM2, perimeterM } = computeAreaAndPerimeterLambert93(featureCollection, crsDetected);

  const stats: ZoneStats = {
    crsDetected,
    paddingMeters: padding,
    bboxLambert93,
    bboxLambert93Padded,
    bboxWgs84Padded: {
      southWest,
      northEast,
    },
    areaM2,
    areaHa: Math.round((areaM2 / 10000) * 1000) / 1000,
    perimeterM,
    perimeterKm: Math.round((perimeterM / 1000) * 1000) / 1000,
  };

  return { geoJsonWgs84, stats };
}

export function withStatsOnFeatures(
  fc: GeoJsonFeatureCollection,
  stats: ZoneStats
): GeoJsonFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const properties = (f.properties && typeof f.properties === 'object' ? f.properties : {}) as UnknownRecord;
      return {
        ...f,
        properties: {
          ...properties,
          stats,
        },
      };
    }),
  };
}
