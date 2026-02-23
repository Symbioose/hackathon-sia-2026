import React, { useEffect, useRef, useState } from 'react';
import { LatLng, MapType, MapTypeOption, ZonePaddingMeters, ZoneStats } from '../types';
import { SearchBar } from './SearchBar';

interface SidePanelProps {
  mapType: MapType;
  onMapTypeChange: (mapType: MapType) => void;
  onLocationFound: (coords: LatLng, name: string) => void;

  paddingMeters: ZonePaddingMeters;
  onPaddingMetersChange: (padding: ZonePaddingMeters) => void;

  geoJsonFileName: string | null;
  zoneStats: ZoneStats | null;
  zoneError: string | null;
  onGeoJsonFileSelected: (file: File) => void;
  onClearZone: () => void;
  onDownloadZone: () => void;
}

const MAP_TYPES: MapTypeOption[] = [
  {
    value: 'osm',
    label: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    value: 'satellite',
    label: 'Satellite (USGS)',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    attribution: 'USGS',
  },
  {
    value: 'terrain',
    label: 'Terrain',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> contributors',
  },
];

export const SidePanel: React.FC<SidePanelProps> = ({
  mapType,
  onMapTypeChange,
  onLocationFound,
  paddingMeters,
  onPaddingMetersChange,
  geoJsonFileName,
  zoneStats,
  zoneError,
  onGeoJsonFileSelected,
  onClearZone,
  onDownloadZone,
}) => {
  const [selectedType, setSelectedType] = useState<MapType>(mapType);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSelectedType(mapType);
  }, [mapType]);

  const handleMapTypeChange = (value: MapType) => {
    setSelectedType(value);
    onMapTypeChange(value);
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onGeoJsonFileSelected(file);
    // allow re-importing the same file
    e.target.value = '';
  };

  const formatNumber = (n: number) => n.toLocaleString('fr-FR');

  return (
    <div className="w-80 bg-white shadow-lg flex flex-col h-full">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4">
        <h1 className="text-xl font-bold">Zone Selection Tool</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* GeoJSON Zone Section */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2 uppercase">
            Zone (GeoJSON)
          </h2>

          {/* Padding controls */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label htmlFor="paddingX" className="block text-xs text-gray-600">
                Padding X (m)
              </label>
              <input
                id="paddingX"
                type="number"
                value={paddingMeters.padX}
                onChange={(e) =>
                  onPaddingMetersChange({
                    ...paddingMeters,
                    padX: Number(e.target.value),
                  })
                }
                className="mt-1 w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="paddingY" className="block text-xs text-gray-600">
                Padding Y (m)
              </label>
              <input
                id="paddingY"
                type="number"
                value={paddingMeters.padY}
                onChange={(e) =>
                  onPaddingMetersChange({
                    ...paddingMeters,
                    padY: Number(e.target.value),
                  })
                }
                className="mt-1 w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,application/geo+json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="flex gap-2">
            <button
              onClick={openFilePicker}
              className="flex-1 px-3 py-2 bg-blue-600 text-white rounded font-medium text-sm hover:bg-blue-700 transition"
            >
              Import GeoJSON
            </button>
            <button
              onClick={onClearZone}
              disabled={!zoneStats}
              className="px-3 py-2 bg-gray-300 text-gray-800 rounded font-medium text-sm hover:bg-gray-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Remove
            </button>
          </div>

          {zoneError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">
              {zoneError}
            </div>
          )}

          {zoneStats && (
            <div className="mt-3 bg-white border border-gray-200 rounded-lg p-3 space-y-3">
              <div className="text-xs text-gray-600">
                <div className="font-semibold text-gray-800">Imported file</div>
                <div className="truncate">{geoJsonFileName ?? '—'}</div>
                <div className="mt-1">
                  <span className="font-medium">CRS detected:</span> {zoneStats.crsDetected}
                </div>
              </div>

              <div className="text-xs text-gray-700">
                <div className="font-semibold text-gray-800">BBox (Lambert-93) padded</div>
                <div>
                  X: {formatNumber(zoneStats.bboxLambert93Padded.minX)} → {formatNumber(zoneStats.bboxLambert93Padded.maxX)}
                </div>
                <div>
                  Y: {formatNumber(zoneStats.bboxLambert93Padded.minY)} → {formatNumber(zoneStats.bboxLambert93Padded.maxY)}
                </div>
              </div>

              <div className="text-xs text-gray-700">
                <div className="font-semibold text-gray-800">Surface</div>
                <div>
                  {formatNumber(zoneStats.areaM2)} m² ({formatNumber(zoneStats.areaHa)} ha)
                </div>
              </div>

              <div className="text-xs text-gray-700">
                <div className="font-semibold text-gray-800">Périmètre</div>
                <div>
                  {formatNumber(zoneStats.perimeterM)} m ({formatNumber(zoneStats.perimeterKm)} km)
                </div>
              </div>

              <button
                onClick={onDownloadZone}
                className="w-full px-3 py-2 bg-green-600 text-white rounded font-medium text-sm hover:bg-green-700 transition"
              >
                Download GeoJSON (WGS84 + stats)
              </button>
            </div>
          )}
        </div>

        {/* Search Section */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2 uppercase">
            Search Location
          </h2>
          <SearchBar onLocationFound={onLocationFound} />
          <p className="text-xs text-gray-500 mt-2">
            Search for a city or region to center the map
          </p>
        </div>

        {/* Map Type Selection */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase">
            Map Type
          </h2>
          <div className="space-y-2">
            {MAP_TYPES.map((mapTypeOpt) => (
              <label
                key={mapTypeOpt.value}
                className="flex items-center p-2 border rounded-lg cursor-pointer hover:bg-gray-50 transition"
              >
                <input
                  type="radio"
                  name="mapType"
                  value={mapTypeOpt.value}
                  checked={selectedType === mapTypeOpt.value}
                  onChange={(e) =>
                    handleMapTypeChange(e.target.value as MapType)
                  }
                  className="w-4 h-4 text-blue-600"
                />
                <span className="ml-2 text-sm font-medium text-gray-700">
                  {mapTypeOpt.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border-l-4 border-blue-400 p-3">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">
            How to use:
          </h3>
          <ol className="text-xs text-blue-800 space-y-1">
            <li>1. Import a GeoJSON file (Polygon/MultiPolygon)</li>
            <li>2. Adjust padding X/Y (meters in Lambert-93)</li>
            <li>3. The padded rectangle is shown on the map</li>
            <li>4. Download GeoJSON normalized to WGS84 with properties.stats</li>
          </ol>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 p-3 bg-gray-50 text-center text-xs text-gray-500">
        <p>Hackathon SIA 2026</p>
        <p>Zone Selection Tool v1.0</p>
      </div>
    </div>
  );
};
