import React, { useEffect, useState } from 'react';
import {
  AnalysisDisplayData,
  AnalysisResult,
  AnalysisStatus,
  AnalysisType,
  GeoJsonFeatureCollection,
  ZonePadding,
  ZoneStats,
} from './types';
import { MapComponent } from './components/MapComponent';
import { SidePanel } from './components/SidePanel';
import { ScenarioPage } from './components/ScenarioPage';
import {
  buildZoneFromGeoJson,
  GeoJsonZoneError,
} from './utils/geoJsonZone';
import { BASE_API } from './config';
import './App.css';


function App(): React.ReactNode {
  type RawGeoJson = Record<string, unknown>;

  // API configuration for each analysis type
  interface ApiConfig {
    endpoint: string;
    layerParam?: string;
  }

  const ANALYSIS_API_CONFIG: Record<AnalysisType, ApiConfig> = {
    mnt: { endpoint: '/mtn/download' },
    axe_ruissellement: { endpoint: '/bdtopage/download', layerParam: 'BDTOPO_V3:troncon_hydrographique' },
    occupation_sols: { endpoint: '/bdtopo/download', layerParam: 'BDTOPO_V3:batiment,BDTOPO_V3:cimetiere,BDTOPO_V3:haie,BDTOPO_V3:surface_hydrographique,BDTOPO_V3:terrain_de_sport,BDTOPO_V3:troncon_de_route,BDTOPO_V3:zone_de_vegetation' },
    culture: { endpoint: '/rpg/download', layerParam: 'RPG.LATEST:parcelles_graphiques' },
    bassin_versant: { endpoint: '/bdtopage/download', layerParam: 'BDTOPO_V3:bassin_versant_topographique' },
    pluie: { endpoint: '/marianne/rainfall/monthly-average' },
  };

  const ANALYSIS_OPTIONS: Array<{ type: AnalysisType; label: string }> = [
    { type: 'mnt', label: 'MNT' },
    { type: 'axe_ruissellement', label: 'Axe de ruissellement' },
    { type: 'occupation_sols', label: 'Occupation des sols' },
    { type: 'culture', label: 'Culture' },
    { type: 'bassin_versant', label: 'Bassin versant' },
    { type: 'pluie', label: 'Données de pluie' },
  ];

  // Initialize state from localStorage or defaults
  const getInitialState = () => {
    try {
      const saved = localStorage.getItem('hackathon-app-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          paddingMeters: parsed.paddingMeters || { buffer: 0 },
          rawGeoJson: parsed.rawGeoJson || null,
          geoJsonFileName: parsed.geoJsonFileName || null,
          selectedAnalyses: parsed.selectedAnalyses || {
            mnt: false,
            axe_ruissellement: false,
            occupation_sols: false,
            culture: false,
            bassin_versant: false,
            pluie: false,
          },
          analysisResults: parsed.analysisResults || {
            mnt: { type: 'mnt', label: 'MNT', status: 'idle' },
            axe_ruissellement: { type: 'axe_ruissellement', label: 'Axe de ruissellement', status: 'idle' },
            occupation_sols: { type: 'occupation_sols', label: 'Occupation des sols', status: 'idle' },
            culture: { type: 'culture', label: 'Culture', status: 'idle' },
            bassin_versant: { type: 'bassin_versant', label: 'Bassin versant', status: 'idle' },
            pluie: { type: 'pluie', label: 'Données de pluie', status: 'idle' },
          },
        };
      }
    } catch (error) {
      console.error('Error loading state from localStorage:', error);
    }
    return {
      paddingMeters: { buffer: 0 },
      rawGeoJson: null,
      geoJsonFileName: null,
      selectedAnalyses: {
        mnt: false,
        axe_ruissellement: false,
        occupation_sols: false,
        culture: false,
        bassin_versant: false,
        pluie: false,
      },
      analysisResults: {
        mnt: { type: 'mnt', label: 'MNT', status: 'idle' },
        axe_ruissellement: { type: 'axe_ruissellement', label: 'Axe de ruissellement', status: 'idle' },
        occupation_sols: { type: 'occupation_sols', label: 'Occupation des sols', status: 'idle' },
        culture: { type: 'culture', label: 'Culture', status: 'idle' },
        bassin_versant: { type: 'bassin_versant', label: 'Bassin versant', status: 'idle' },
        pluie: { type: 'pluie', label: 'Données de pluie', status: 'idle' },
      },
    };
  };

  const initialState = getInitialState();

  const [paddingMeters, setPaddingMeters] = useState<ZonePadding>(initialState.paddingMeters);
  const [rawGeoJson, setRawGeoJson] = useState<RawGeoJson | null>(initialState.rawGeoJson);
  const [geoJsonFileName, setGeoJsonFileName] = useState<string | null>(initialState.geoJsonFileName);
  const [zoneError, setZoneError] = useState<string | null>(null);

  const [zone, setZone] = useState<
    { geoJsonWgs84: GeoJsonFeatureCollection; stats: ZoneStats } | null
  >(null);

  const [selectedAnalyses, setSelectedAnalyses] = useState<
    Record<AnalysisType, boolean>
  >(initialState.selectedAnalyses);

  const [analysisResults, setAnalysisResults] = useState<
    Record<AnalysisType, AnalysisResult>
  >(initialState.analysisResults);

  const [displayLayers, setDisplayLayers] = useState<Record<string, AnalysisDisplayData>>({});
  const [displayLoading, setDisplayLoading] = useState<AnalysisType | null>(null);
  const [currentPage, setCurrentPage] = useState<'analysis' | 'scenarios'>('analysis');

  // Save state to localStorage whenever key states change
  useEffect(() => {
    try {
      const stateToSave = {
        paddingMeters,
        rawGeoJson,
        geoJsonFileName,
        selectedAnalyses,
        analysisResults,
      };
      localStorage.setItem('hackathon-app-state', JSON.stringify(stateToSave));
    } catch (error) {
      console.error('Error saving state to localStorage:', error);
    }
  }, [paddingMeters, rawGeoJson, geoJsonFileName, selectedAnalyses, analysisResults]);

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

  const handleToggleAnalysisDisplay = async (type: AnalysisType) => {
    // Skip display for CSV files (rainfall data)
    if (type === 'pluie') {
      return;
    }

    // Toggle off if already displayed
    if (displayLayers[type]) {
      setDisplayLayers((prev) => {
        const next = { ...prev };
        delete next[type];
        return next;
      });
      return;
    }

    const result = analysisResults[type];
    if (result.status !== 'success' || !result.url) return;

    setDisplayLoading(type);

    try {
      if (type === 'mnt') {
        const tifPath = result.url;
        const resp = await fetch(
          `${BASE_API}/mtn/preview?tif_path=${encodeURIComponent(tifPath)}`
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        setDisplayLayers((prev) => ({
          ...prev,
          [type]: {
            kind: 'raster',
            png_url: `${BASE_API}${data.png_url}`,
            bounds: data.bounds,
            stats: data.stats,
          },
        }));
      } else {
        const zipUrl = result.url;
        const resp = await fetch(
          `${BASE_API}/shapefile/geojson?zip_url=${encodeURIComponent(zipUrl)}&analysis_type=${encodeURIComponent(type)}`
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        setDisplayLayers((prev) => ({
          ...prev,
          [type]: {
            kind: 'vector',
            geojson: data.geojson,
            stats: data.stats,
            layer_name: data.layer_name,
          },
        }));
      }
    } catch (err) {
      console.error('Failed to load preview:', err);
    } finally {
      setDisplayLoading(null);
    }
  };

  const handleClearZone = () => {
    setRawGeoJson(null);
    setGeoJsonFileName(null);
    setZoneError(null);
    setZone(null);
    setDisplayLayers({});
    setDisplayLoading(null);
    setAnalysisResults((prev) => {
      const reset: Record<AnalysisType, AnalysisResult> = { ...prev };
      ANALYSIS_OPTIONS.forEach((opt) => {
        reset[opt.type] = { type: opt.type, label: opt.label, status: 'idle' };
      });
      return reset;
    });
    // Clear localStorage when zone is removed
    try {
      localStorage.removeItem('hackathon-app-state');
    } catch (error) {
      console.error('Error clearing localStorage:', error);
    }
  };

  const handleGeoJsonFileSelected = async (file: File) => {
    setZoneError(null);
    setGeoJsonFileName(file.name);
    setDisplayLayers({});
    setDisplayLoading(null);

    // Reset analysis results when a new GeoJSON is uploaded
    setAnalysisResults({
      mnt: { type: 'mnt', label: 'MNT', status: 'idle' },
      axe_ruissellement: { type: 'axe_ruissellement', label: 'Axe de ruissellement', status: 'idle' },
      occupation_sols: { type: 'occupation_sols', label: 'Occupation des sols', status: 'idle' },
      culture: { type: 'culture', label: 'Culture', status: 'idle' },
      bassin_versant: { type: 'bassin_versant', label: 'Bassin versant', status: 'idle' },
      pluie: { type: 'pluie', label: 'Données de pluie', status: 'idle' },
    });

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

  const updateAnalysisStatus = (
    type: AnalysisType,
    status: AnalysisStatus,
    data?: { url?: string; error?: string }
  ) => {
    setAnalysisResults((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        status,
        url: data?.url,
        error: data?.error,
      },
    }));
  };

  const runSelectedAnalyses = async () => {
    if (!zone || !rawGeoJson) return;

    const selected = ANALYSIS_OPTIONS.filter((opt) => selectedAnalyses[opt.type]);
    if (selected.length === 0) return;

    // Send the raw (Lambert93) GeoJSON — the backend expects EPSG:2154
    const zoneJsonString = JSON.stringify(rawGeoJson);

    await Promise.all(
      selected.map(async (opt) => {
        updateAnalysisStatus(opt.type, 'pending');
        try {
          const config = ANALYSIS_API_CONFIG[opt.type];
          const formData = new FormData();

          // Create fresh blob for each request
          const zoneFileBlob = new Blob([zoneJsonString], {
            type: 'application/geo+json',
          });

          // Append zone file
          formData.append('zone_file', zoneFileBlob, 'zone.geojson');

          // Append buffer (will be converted to int by FastAPI)
          const bufferValue = Math.round(paddingMeters.buffer);
          formData.append('buffer', bufferValue.toString());

          // Append layer parameters if specified
          if (config.layerParam) {
            if (opt.type === 'culture') {
              formData.append('layer_name', config.layerParam);
            } else {
              formData.append('layer_names', config.layerParam);
            }
          }

          const response = await fetch(`${BASE_API}${config.endpoint}`, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `HTTP ${response.status}: ${errorText || 'Bad request'}`
            );
          }

          const data = (await response.json()) as Record<string, unknown>;

          // Extract download URL based on response structure
          let url: string | undefined;

          if (typeof data.download_url === 'string') {
            // Direct download_url (MNT, RPG)
            url = data.download_url;
          } else if (data.layers && typeof data.layers === 'object') {
            // Multiple layers response (BDTOPAGE, BDTOPO)
            // Get the first layer's download_url
            const layers = data.layers as Record<string, unknown>;
            const firstLayer = Object.values(layers)[0] as
              | Record<string, unknown>
              | undefined;
            if (firstLayer && typeof firstLayer.download_url === 'string') {
              url = firstLayer.download_url;
            }
          }

          if (!url) {
            throw new Error('Missing URL in response');
          }

          updateAnalysisStatus(opt.type, 'success', { url });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Request failed';
          updateAnalysisStatus(opt.type, 'error', { error: message });
        }
      })
    );
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Sliding container */}
      <div
        className="flex h-full transition-transform duration-500 ease-in-out"
        style={{
          width: '200vw',
          transform: currentPage === 'scenarios' ? 'translateX(-100vw)' : 'translateX(0)',
        }}
      >
        {/* Page 1: Analysis */}
        <div className="w-screen h-full flex bg-gray-100 flex-shrink-0">
          <SidePanel
            paddingMeters={paddingMeters}
            onPaddingMetersChange={setPaddingMeters}
            geoJsonFileName={geoJsonFileName}
            zoneStats={zone?.stats ?? null}
            zoneError={zoneError}
            onGeoJsonFileSelected={handleGeoJsonFileSelected}
            onClearZone={handleClearZone}
            analysisOptions={ANALYSIS_OPTIONS}
            selectedAnalyses={selectedAnalyses}
            onSelectedAnalysesChange={setSelectedAnalyses}
            analysisResults={analysisResults}
            onRunSelectedAnalyses={runSelectedAnalyses}
            displayLayers={displayLayers}
            displayLoading={displayLoading}
            onToggleAnalysisDisplay={handleToggleAnalysisDisplay}
            onNavigateToScenarios={() => setCurrentPage('scenarios')}
          />
          <div className="flex-1 relative bg-gray-200">
            <MapComponent
              zoneGeoJsonWgs84={zone?.geoJsonWgs84 ?? null}
              paddedBoundsWgs84={zone?.stats.bboxWgs84Padded ?? null}
              analysisResults={analysisResults}
              zoneStats={zone?.stats ?? null}
              displayLayers={displayLayers}
            />
          </div>
        </div>

        {/* Page 2: Scenario Comparison */}
        <div className="w-screen h-full flex-shrink-0">
          <ScenarioPage
            rawGeoJson={rawGeoJson}
            zone={zone}
            onBack={() => setCurrentPage('analysis')}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
