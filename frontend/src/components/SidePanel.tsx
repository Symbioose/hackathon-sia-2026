import React, { useRef } from 'react';
import {
  AnalysisResult,
  AnalysisType,
  LatLng,
  ZonePadding,
  ZoneStats,
} from '../types';
import { SearchBar } from './SearchBar';

interface SidePanelProps {
  onLocationFound: (coords: LatLng, name: string) => void;

  paddingMeters: ZonePadding;
  onPaddingMetersChange: (padding: ZonePadding) => void;

  geoJsonFileName: string | null;
  zoneStats: ZoneStats | null;
  zoneError: string | null;
  onGeoJsonFileSelected: (file: File) => void;
  onClearZone: () => void;
  onDownloadZone: () => void;

  analysisOptions: Array<{ type: AnalysisType; label: string }>;
  selectedAnalyses: Record<AnalysisType, boolean>;
  onSelectedAnalysesChange: (next: Record<AnalysisType, boolean>) => void;
  analysisResults: Record<AnalysisType, AnalysisResult>;
  onRunSelectedAnalyses: () => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  onLocationFound,
  paddingMeters,
  onPaddingMetersChange,
  geoJsonFileName,
  zoneStats,
  zoneError,
  onGeoJsonFileSelected,
  onClearZone,
  onDownloadZone,
  analysisOptions,
  selectedAnalyses,
  onSelectedAnalysesChange,
  analysisResults,
  onRunSelectedAnalyses,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const selectedCount = analysisOptions.filter((opt) => selectedAnalyses[opt.type]).length;
  const progressItems = analysisOptions.filter((opt) => selectedAnalyses[opt.type]);
  const doneCount = progressItems.filter(
    (opt) => analysisResults[opt.type].status === 'success'
  ).length;
  const errorCount = progressItems.filter(
    (opt) => analysisResults[opt.type].status === 'error'
  ).length;
  const progressTotal = progressItems.length;
  let progressPercent = 0;
  if (progressTotal > 0) {
    progressPercent = Math.round((doneCount + errorCount) / progressTotal * 100);
  }

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
          <div className="mb-3">
            <div>
              <label htmlFor="padding" className="block text-xs text-gray-600">
                Padding (m)
              </label>
              <input
                id="padding"
                type="number"
                value={paddingMeters.buffer}
                onChange={(e) =>
                  onPaddingMetersChange({
                    buffer: Number(e.target.value),
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

        {/* Analysis Selection & Progress */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2 uppercase">
            Analyses
          </h2>
          <div className="space-y-2">
            {analysisOptions.map((opt) => (
              <label
                key={opt.type}
                className="flex items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  checked={selectedAnalyses[opt.type]}
                  onChange={(e) =>
                    onSelectedAnalysesChange({
                      ...selectedAnalyses,
                      [opt.type]: e.target.checked,
                    })
                  }
                  className="h-4 w-4 text-blue-600"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>

          <button
            onClick={onRunSelectedAnalyses}
            disabled={selectedCount === 0 || !zoneStats}
            className="mt-3 w-full px-3 py-2 bg-blue-600 text-white rounded font-medium text-sm hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Run Selected ({selectedCount})
          </button>

          <div className="mt-3">
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>Progress</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded">
              <div
                className="h-2 bg-blue-600 rounded"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {progressItems.map((opt) => {
              const item = analysisResults[opt.type];
              const statusLabelMap: Record<typeof item.status, string> = {
                idle: 'Idle',
                pending: 'En cours',
                success: 'Terminé',
                error: 'Erreur',
              };
              const statusLabel = statusLabelMap[item.status];

              return (
                <div
                  key={opt.type}
                  className="text-xs text-gray-700 flex items-center justify-between"
                >
                  <span>{item.label}</span>
                  <span className="text-gray-500">{statusLabel}</span>
                </div>
              );
            })}
          </div>
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

        {/* Instructions */}
        <div className="bg-blue-50 border-l-4 border-blue-400 p-3">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">
            How to use:
          </h3>
          <ol className="text-xs text-blue-800 space-y-1">
            <li>1. Import a GeoJSON file (Polygon/MultiPolygon)</li>
            <li>2. Adjust padding (meters in Lambert-93)</li>
            <li>3. Select analyses and run the requests</li>
            <li>4. The padded rectangle and raster layers are shown on the map</li>
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
