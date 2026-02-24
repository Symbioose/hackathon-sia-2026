import React, { useState } from 'react';
import {
  GeoJsonFeatureCollection,
  ScenarioComparisonResult,
  ScenarioComparisonStatus,
  ZoneStats,
} from '../types';
import { ScenarioDashboard } from './ScenarioDashboard';
import { BASE_API } from '../config';

const DesignerLogo = '/assets/Designer.png';

interface ScenarioPageProps {
  rawGeoJson: Record<string, unknown> | null;
  zone: { geoJsonWgs84: GeoJsonFeatureCollection; stats: ZoneStats } | null;
  onBack: () => void;
}

export const ScenarioPage: React.FC<ScenarioPageProps> = ({
  rawGeoJson,
  zone,
  onBack,
}) => {
  const [status, setStatus] = useState<ScenarioComparisonStatus>('idle');
  const [result, setResult] = useState<ScenarioComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunComparison = async () => {
    if (!rawGeoJson) return;

    setStatus('loading');
    setError(null);

    try {
      const formData = new FormData();
      const zoneBlob = new Blob([JSON.stringify(rawGeoJson)], {
        type: 'application/geo+json',
      });
      formData.append('zone_file', zoneBlob, 'zone.geojson');

      const response = await fetch(`${BASE_API}/scenarios/compare`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as ScenarioComparisonResult;
      setResult(data);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      setStatus('error');
    }
  };

  return (
    <div className="flex h-screen w-screen bg-gray-100">
      {/* ---- Side Panel ---- */}
      <div className="w-80 bg-white shadow-lg flex flex-col h-full flex-shrink-0">
        {/* Header */}
        <div style={{ backgroundColor: '#61C299' }} className="text-white p-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm mb-2 opacity-90 hover:opacity-100 transition"
          >
            <span className="text-lg leading-none">&larr;</span> Retour
          </button>
          <div className="flex gap-3">
            <img src={DesignerLogo} alt="OSAI Logo" className="w-1/4 object-contain" />
            <div className="flex flex-col justify-center">
              <h1 className="text-xl font-bold">OSAI</h1>
              <p className="text-xs opacity-90">Comparaison de scenarios</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Scenario labels */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-2 uppercase">Scenarios</h2>
            <div className="space-y-1 text-xs text-gray-600">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-orange-400" />
                <span className="font-medium">S1</span> &mdash; Scenario de reference
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-blue-500" />
                <span className="font-medium">S2</span> &mdash; Scenario alternatif
              </div>
            </div>
          </div>

          {/* Run button */}
          <button
            onClick={handleRunComparison}
            disabled={!rawGeoJson || status === 'loading'}
            style={{
              backgroundColor:
                !rawGeoJson || status === 'loading' ? undefined : '#4A90D9',
            }}
            className="w-full px-3 py-2.5 text-white rounded font-medium text-sm hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {status === 'loading' ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Calcul en cours...
              </span>
            ) : (
              'Lancer la comparaison'
            )}
          </button>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">
              {error}
            </div>
          )}

          {/* Zone info */}
          {zone && (
            <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
              <h3 className="font-semibold text-gray-700 mb-1 uppercase text-[11px]">Zone d'etude</h3>
              <div className="flex justify-between">
                <span>Surface</span>
                <span className="font-medium">{zone.stats.areaHa.toLocaleString('fr-FR')} ha</span>
              </div>
              <div className="flex justify-between">
                <span>Parcelles</span>
                <span className="font-medium">{result?.parcelle_ids?.length ?? '—'}</span>
              </div>
            </div>
          )}

          {/* Summary per variable */}
          {result && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-2 uppercase">Resume</h2>
              <div className="space-y-2">
                {(['infiltration', 'interrill_erosion', 'rill_erosion', 'surface_runoff'] as const).map((name) => {
                  const group = result.rasters[name];
                  if (!group) return null;
                  const pct = group.total.pct_change;
                  const inverted = name !== 'infiltration';
                  const isGood = inverted ? pct < 0 : pct > 0;
                  const color = pct === 0 ? 'text-gray-600' : isGood ? 'text-green-700' : 'text-red-600';
                  return (
                    <div key={name} className="flex justify-between text-xs">
                      <span className="text-gray-700">{group.label}</span>
                      <span className={`font-semibold tabular-nums ${color}`}>
                        {pct > 0 ? '+' : ''}{Math.round(pct)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---- Main Content: Dashboard ---- */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* Loading overlay */}
        {status === 'loading' && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20">
            <div className="bg-white rounded-xl shadow-2xl p-6 max-w-xs w-full">
              <div className="flex items-center gap-3">
                <svg className="animate-spin h-6 w-6 text-blue-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <div>
                  <div className="font-semibold text-gray-800">Comparaison en cours...</div>
                  <div className="text-xs text-gray-500 mt-1">Lecture des rasters et calcul des differences</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Idle state */}
        {status === 'idle' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-400 max-w-sm">
              <div className="text-5xl mb-4">&#x1f4ca;</div>
              <p className="text-lg font-medium text-gray-500">Aucune comparaison lancee</p>
              <p className="text-sm mt-2">
                Cliquez sur &laquo; Lancer la comparaison &raquo; pour comparer les deux scenarios sur votre zone d'etude.
              </p>
            </div>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && !result && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-red-400 max-w-sm">
              <div className="text-5xl mb-4">&#x26a0;</div>
              <p className="text-lg font-medium text-red-500">Erreur</p>
              <p className="text-sm mt-2 text-red-400">{error}</p>
            </div>
          </div>
        )}

        {/* Results dashboard */}
        {result && (
          <div className="flex-1 overflow-auto p-6">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-gray-800">Tableau comparatif</h2>
              <p className="text-sm text-gray-500">
                Sommes par parcelle entre Scenario 1 et Scenario 2
              </p>
            </div>
            <ScenarioDashboard result={result} />
          </div>
        )}
      </div>
    </div>
  );
};
