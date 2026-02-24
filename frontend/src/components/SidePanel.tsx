import React, { useRef } from 'react';
import JSZip from 'jszip';
import {
  AnalysisDisplayData,
  AnalysisResult,
  AnalysisType,
  ZonePadding,
  ZoneStats,
} from '../types';
import { BASE_API } from '../config';

// Import logos - using Vite absolute paths from project root
const DesignerLogo = '/assets/Designer.png';
const BrandLogo = '/assets/Logo.png';

const Spinner: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

interface SidePanelProps {
  paddingMeters: ZonePadding;
  onPaddingMetersChange: (padding: ZonePadding) => void;

  geoJsonFileName: string | null;
  zoneStats: ZoneStats | null;
  zoneError: string | null;
  onGeoJsonFileSelected: (file: File) => void;
  onClearZone: () => void;

  analysisOptions: Array<{ type: AnalysisType; label: string }>;
  selectedAnalyses: Record<AnalysisType, boolean>;
  onSelectedAnalysesChange: (next: Record<AnalysisType, boolean>) => void;
  analysisResults: Record<AnalysisType, AnalysisResult>;
  onRunSelectedAnalyses: () => void;

  displayLayers: Record<string, AnalysisDisplayData>;
  displayLoading: AnalysisType | null;
  onToggleAnalysisDisplay: (type: AnalysisType) => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  paddingMeters,
  onPaddingMetersChange,
  geoJsonFileName,
  zoneStats,
  zoneError,
  onGeoJsonFileSelected,
  onClearZone,
  analysisOptions,
  selectedAnalyses,
  onSelectedAnalysesChange,
  analysisResults,
  onRunSelectedAnalyses,
  displayLayers,
  displayLoading,
  onToggleAnalysisDisplay,
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

  const handleDownloadAll = async () => {
    const successfulResults = Object.values(analysisResults).filter(
      (result) => result.status === 'success' && result.url
    );

    if (successfulResults.length === 0) return;

    const zip = new JSZip();

    try {
      // Fetch all files and add them to the ZIP
      await Promise.all(
        successfulResults.map(async (result) => {
          const response = await fetch(`${BASE_API}${result.url}`);
          const blob = await response.blob();
          // Extract filename from URL path
          const urlParts = result?.url?.split('/');
          const fileName = urlParts && urlParts.length > 0 ? urlParts.at(-1) ?? 'result' : 'result';
          zip.file(fileName, blob);
        })
      );

      // Generate the combined ZIP
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'analyses_results.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error creating ZIP:', error);
    }
  };

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
      <div style={{ backgroundColor: '#61C299' }} className="text-white p-4">
        <div className="flex gap-3 mb-2">
          <img src={DesignerLogo} alt="OSAI Logo" className="w-1/4 object-contain" />
          <div className="flex flex-col justify-center">
            <h1 className="text-2xl font-bold">OSAI</h1>
            <p className="text-sm opacity-90">Ombrea Soil Analytics AI</p>
          </div>
        </div>
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
                className="mt-1 w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': '#61C299' } as React.CSSProperties}
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
              style={{ backgroundColor: '#61C299' }}
              className="flex-1 px-3 py-2 text-white rounded font-medium text-sm hover:opacity-90 transition"
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
            <div className="mt-3 bg-white border border-gray-200 rounded-lg p-3">
              <div className="text-xs text-gray-600">
                <div className="font-semibold text-gray-800">Imported file</div>
                <div className="truncate">{geoJsonFileName ?? '—'}</div>
              </div>

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
                  className="h-4 w-4"
                  style={{ accentColor: '#61C299' }}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>

          <button
            onClick={onRunSelectedAnalyses}
            disabled={selectedCount === 0 || !zoneStats}
            style={{ backgroundColor: selectedCount === 0 || !zoneStats ? undefined : '#61C299' }}
            className="mt-3 w-full px-3 py-2 bg-blue-600 text-white rounded font-medium text-sm hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="h-2 rounded"
                style={{ width: `${progressPercent}%`, backgroundColor: '#61C299' }}
              />
            </div>
          </div>

          {/* Analysis result rows — clickable when completed */}
          <div className="mt-3 space-y-2">
            {progressItems.map((opt) => {
              const item = analysisResults[opt.type];
              const isActive = !!displayLayers[opt.type];
              const isSuccess = item.status === 'success';
              const isPending = item.status === 'pending';
              const isLoadingThis = displayLoading === opt.type;
              const isDownloadOnly = opt.type === 'pluie'; // CSV files are download-only

              const statusLabelMap: Record<typeof item.status, string> = {
                idle: 'Idle',
                pending: 'En cours...',
                success: isDownloadOnly
                  ? 'Prêt à télécharger'
                  : (isActive ? 'Affiché' : 'Cliquer pour afficher'),
                error: 'Erreur',
              };
              const statusLabel = statusLabelMap[item.status];

              return (
                <div
                  key={opt.type}
                  onClick={isSuccess && !isDownloadOnly ? () => onToggleAnalysisDisplay(opt.type) : undefined}
                  className={`border rounded p-2 transition-all ${
                    isActive
                      ? 'border-green-400 bg-green-50 shadow-sm'
                      : isSuccess && !isDownloadOnly
                        ? 'border-gray-200 hover:shadow-md hover:border-gray-300 cursor-pointer'
                        : 'border-gray-200'
                  }`}
                  style={isActive ? { borderColor: '#61C299' } : undefined}
                >
                  <div className="text-xs text-gray-700 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {isActive && (
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: '#61C299' }}
                        />
                      )}
                      <span className={isActive ? 'font-semibold' : ''}>{item.label}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isPending && <Spinner className="h-3 w-3 text-gray-400" />}
                      {isLoadingThis && <Spinner className="h-3 w-3 text-green-500" />}
                      <span className={`${
                        isActive ? 'text-green-600 font-medium' :
                        isSuccess ? 'text-green-600' :
                        item.status === 'error' ? 'text-red-500' :
                        'text-gray-500'
                      }`}>
                        {isLoadingThis ? 'Chargement...' : statusLabel}
                      </span>
                    </div>
                  </div>
                  {item.status === 'error' && item.error && (
                    <div className="text-xs text-red-600 mt-1">{item.error}</div>
                  )}
                </div>
              );
            })}
          </div>

          {doneCount > 0 && (
            <button
              onClick={handleDownloadAll}
              className="mt-3 w-full px-3 py-2 bg-green-600 text-white rounded font-medium text-sm hover:bg-green-700 transition"
            >
              Download All ({doneCount} {doneCount === 1 ? 'file' : 'files'})
            </button>
          )}
        </div>

        {/* Statistics Panels — one card per active layer */}
        {Object.entries(displayLayers).map(([type, layerData]) => {
          const label = analysisOptions.find((o) => o.type === type)?.label ?? type;
          return (
            <div key={type} className="border rounded-lg p-3" style={{ borderColor: '#61C299' }}>
              <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: '#61C299' }}
                  />
                  {label}
                </span>
                <button
                  onClick={() => onToggleAnalysisDisplay(type as AnalysisType)}
                  className="text-gray-400 hover:text-gray-600 text-xs"
                  title="Masquer"
                >
                  ✕
                </button>
              </h3>

              {layerData.kind === 'raster' && (
                <div className="text-xs text-gray-700 space-y-1">
                  <div className="flex justify-between">
                    <span>Altitude min</span>
                    <span className="font-medium">{layerData.stats.alt_min} m</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Altitude max</span>
                    <span className="font-medium">{layerData.stats.alt_max} m</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Altitude moyenne</span>
                    <span className="font-medium">{layerData.stats.alt_mean} m</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Résolution</span>
                    <span className="font-medium">{layerData.stats.resolution_m} m</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Dimensions</span>
                    <span className="font-medium">{layerData.stats.width_px} × {layerData.stats.height_px} px</span>
                  </div>
                </div>
              )}

              {layerData.kind === 'vector' && (
                <div className="text-xs text-gray-700 space-y-1">
                  <div className="flex justify-between">
                    <span>Entités</span>
                    <span className="font-medium">{layerData.stats.feature_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Type géométrie</span>
                    <span className="font-medium">{layerData.stats.geometry_type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Couche</span>
                    <span className="font-medium">{layerData.layer_name}</span>
                  </div>
                  {layerData.stats.total_area_ha != null && (
                    <div className="flex justify-between">
                      <span>Surface totale</span>
                      <span className="font-medium">{layerData.stats.total_area_ha.toLocaleString('fr-FR')} ha</span>
                    </div>
                  )}
                  {layerData.stats.total_length_km != null && (
                    <div className="flex justify-between">
                      <span>Longueur totale</span>
                      <span className="font-medium">{layerData.stats.total_length_km.toLocaleString('fr-FR')} km</span>
                    </div>
                  )}
                  {layerData.stats.distribution && Object.keys(layerData.stats.distribution).length > 0 && (
                    <div className="mt-2">
                      <span className="text-gray-500 font-medium">Distribution :</span>
                      <div className="mt-1 max-h-32 overflow-y-auto">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="text-gray-500">
                              <th className="text-left font-medium pb-0.5">Type</th>
                              <th className="text-right font-medium pb-0.5">Nb</th>
                              {Object.values(layerData.stats.distribution).some((v) => v.area_ha != null) && (
                                <th className="text-right font-medium pb-0.5">Ha</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(layerData.stats.distribution).map(([key, val]) => (
                              <tr key={key} className="border-t border-gray-100">
                                <td className="py-0.5 truncate max-w-[100px]" title={key}>{key}</td>
                                <td className="text-right py-0.5">{val.count}</td>
                                {val.area_ha != null && (
                                  <td className="text-right py-0.5">{val.area_ha.toLocaleString('fr-FR')}</td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {layerData.stats.extra && Object.keys(layerData.stats.extra).length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {Object.entries(layerData.stats.extra).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span>{k}</span>
                          <span className="font-medium">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Instructions */}
        <div className="bg-green-50 border-l-4 p-3" style={{ borderColor: '#61C299' }}>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">
            How to use:
          </h3>
          <ol className="text-xs text-gray-700 space-y-1">
            <li>1. Import a GeoJSON file (Polygon/MultiPolygon)</li>
            <li>2. Adjust padding (meters in Lambert-93)</li>
            <li>3. Select analyses and run the requests</li>
            <li>4. Click a completed analysis to display it on the map</li>
            <li>5. Download the generated files</li>
          </ol>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 p-4 bg-gray-50">
        <div className="flex justify-center mb-3">
          <img src={BrandLogo} alt="Brand Logo" className="h-8 object-contain" />
        </div>
        <div className="text-center text-xs text-gray-500">
          <p>Hackathon SIA 2026</p>
          <p className="mt-1">OSAI v1.0</p>
        </div>
      </div>
    </div>
  );
};
