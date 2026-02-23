import React, { useEffect, useState } from 'react';
import {
  GeoJsonFeatureCollection,
  LatLng,
  MapType,
  ZonePaddingMeters,
  ZoneStats,
} from './types';
import { MapComponent } from './components/MapComponent';
import { SidePanel } from './components/SidePanel';
import {
  buildZoneFromGeoJson,
  GeoJsonZoneError,
  withStatsOnFeatures,
} from './utils/geoJsonZone';
import './App.css';

function App(): React.ReactNode {
  type RawGeoJson = Record<string, unknown>;

  const [mapType, setMapType] = useState<MapType>('osm');
  const [searchLocation, setSearchLocation] = useState<{
    coords: LatLng;
    name: string;
  } | null>(null);

  const [paddingMeters, setPaddingMeters] = useState<ZonePaddingMeters>({
    padX: 0,
    padY: 0,
  });

  const [rawGeoJson, setRawGeoJson] = useState<RawGeoJson | null>(null);
  const [geoJsonFileName, setGeoJsonFileName] = useState<string | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);

  const [zone, setZone] = useState<
    { geoJsonWgs84: GeoJsonFeatureCollection; stats: ZoneStats } | null
  >(null);

  useEffect(() => {
    const getErrorMessage = (err: unknown): string => {
      if (err instanceof GeoJsonZoneError) return err.message;
      if (err instanceof Error) return err.message;
      return 'Failed to parse GeoJSON';
    };

    if (rawGeoJson === null) {
      setZone(null);
      setZoneError(null);
      return;
    }

    try {
      const computed = buildZoneFromGeoJson(rawGeoJson, paddingMeters);
      setZone(computed);
      setZoneError(null);
    } catch (err) {
      const message = getErrorMessage(err);
      setZone(null);
      setZoneError(message);
    }
  }, [rawGeoJson, paddingMeters]);

  const handleClearZone = () => {
    setRawGeoJson(null);
    setGeoJsonFileName(null);
    setZoneError(null);
    setZone(null);
  };

  const handleGeoJsonFileSelected = async (file: File) => {
    setZoneError(null);
    setGeoJsonFileName(file.name);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Invalid GeoJSON: root must be an object');
      }
      setRawGeoJson(parsed as RawGeoJson);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read GeoJSON file';
      setZoneError(message);
      setRawGeoJson(null);
    }
  };

  const handleDownloadZone = () => {
    if (!zone) return;

    const fcWithStats = withStatsOnFeatures(zone.geoJsonWgs84, zone.stats);

    const geojsonText = JSON.stringify(fcWithStats, null, 2);
    const blob = new Blob([geojsonText], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = geoJsonFileName ? geoJsonFileName.replace(/\.[^.]+$/, '') : 'zone';
    a.download = `${baseName}_wgs84_with_stats.geojson`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleLocationFound = (coords: LatLng, name: string) => {
    setSearchLocation({ coords, name });
  };

  return (
    <div className="flex h-screen w-screen bg-gray-100">
      {/* Side Panel */}
      <SidePanel
        mapType={mapType}
        onMapTypeChange={setMapType}
        onLocationFound={handleLocationFound}
        paddingMeters={paddingMeters}
        onPaddingMetersChange={setPaddingMeters}
        geoJsonFileName={geoJsonFileName}
        zoneStats={zone?.stats ?? null}
        zoneError={zoneError}
        onGeoJsonFileSelected={handleGeoJsonFileSelected}
        onClearZone={handleClearZone}
        onDownloadZone={handleDownloadZone}
      />

      {/* Main Map Area */}
      <div className="flex-1 relative bg-gray-200">
        <MapComponent
          mapType={mapType}
          searchLocation={searchLocation}
          zoneGeoJsonWgs84={zone?.geoJsonWgs84 ?? null}
          paddedBoundsWgs84={zone?.stats.bboxWgs84Padded ?? null}
        />
      </div>
    </div>
  );
}

export default App;
