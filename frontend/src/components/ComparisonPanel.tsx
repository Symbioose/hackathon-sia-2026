import React, { useCallback, useRef, useState } from 'react';
import { BASE_API } from '../config';

// ── Types ──────────────────────────────────────────────────────────────────────

type FileKey = 'infiltration' | 'interrill_erosion' | 'rill_erosion' | 'surface_runoff';

const FILE_SLOTS: { key: FileKey; label: string; icon: string }[] = [
  { key: 'infiltration',      label: 'Infiltration',       icon: '💧' },
  { key: 'interrill_erosion', label: 'Interrill_erosion',    icon: '🌱' },
  { key: 'rill_erosion',      label: 'Rrill_erosion', icon: '🪨' },
  { key: 'surface_runoff',    label: 'Surface_runoff',      icon: '🌊' },
];

type ScenarioFiles = Record<FileKey, File | null>;

const emptyScenario = (): ScenarioFiles =>
  Object.fromEntries(FILE_SLOTS.map((s) => [s.key, null])) as ScenarioFiles;

interface RasterTotal {
  scenario1_sum: number;
  scenario2_sum: number;
  pct_change: number;
}

interface RasterResult {
  label: string;
  parcelles: { id: string; scenario1_sum: number; scenario2_sum: number; pct_change: number }[];
  total: RasterTotal;
}

interface ComparisonResult {
  rasters: Record<string, RasterResult>;
  parcelle_ids: string[];
  bounds_wgs84: { south: number; west: number; north: number; east: number };
  diff_preview_urls: Record<string, string>;
}

// ── DropZone ───────────────────────────────────────────────────────────────────

const DropZone: React.FC<{
  icon: string;
  label: string;
  file: File | null;
  onFile: (file: File) => void;
}> = ({ icon, label, file, onFile }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className="border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all select-none"
      style={{
        borderColor: file ? '#61C299' : dragging ? '#61C299' : '#d1d5db',
        backgroundColor: file ? '#f0faf5' : dragging ? '#f0faf5' : '#f9fafb',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".sg-grd-z,.zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <div className="flex items-center gap-3">
        <span className="text-xl">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-gray-600">{label}</div>
          {file ? (
            <div className="text-xs font-medium truncate mt-0.5" style={{ color: '#61C299' }} title={file.name}>
              {file.name}
            </div>
          ) : (
            <div className="text-xs text-gray-400 mt-0.5">Déposer .sg-grd-z ou cliquer</div>
          )}
        </div>
        {file && <span className="text-xs font-bold shrink-0" style={{ color: '#61C299' }}>✓</span>}
      </div>
    </div>
  );
};

// ── ScenarioCard ───────────────────────────────────────────────────────────────

const ScenarioCard: React.FC<{
  label: string;
  color: string;
  files: ScenarioFiles;
  onFile: (key: FileKey, file: File) => void;
}> = ({ label, color, files, onFile }) => {
  const filled = FILE_SLOTS.filter((s) => files[s.key] !== null).length;
  return (
    <div className="flex-1 bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <h3 className="font-semibold text-gray-800">{label}</h3>
        </div>
        <span className="text-xs text-gray-400">{filled}/{FILE_SLOTS.length} fichiers</span>
      </div>
      {FILE_SLOTS.map((slot) => (
        <DropZone
          key={slot.key}
          icon={slot.icon}
          label={slot.label}
          file={files[slot.key]}
          onFile={(f) => onFile(slot.key, f)}
        />
      ))}
    </div>
  );
};

// ── Spinner ────────────────────────────────────────────────────────────────────

const Spinner: React.FC = () => (
  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ── ComparisonPanel ────────────────────────────────────────────────────────────

export const ComparisonPanel: React.FC<{
  rawGeoJson: Record<string, unknown> | null;
}> = ({ rawGeoJson }) => {
  const [scenarioA, setScenarioA] = useState<ScenarioFiles>(emptyScenario());
  const [scenarioB, setScenarioB] = useState<ScenarioFiles>(emptyScenario());
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState<ComparisonResult | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const setFileA = useCallback((key: FileKey, file: File) => setScenarioA((p) => ({ ...p, [key]: file })), []);
  const setFileB = useCallback((key: FileKey, file: File) => setScenarioB((p) => ({ ...p, [key]: file })), []);

  const canCompare =
    FILE_SLOTS.every((s) => scenarioA[s.key] !== null) &&
    FILE_SLOTS.every((s) => scenarioB[s.key] !== null);

  const handleCompare = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();

      // Optional zone file from tab 1
      if (rawGeoJson) {
        formData.append(
          'zone_file',
          new Blob([JSON.stringify(rawGeoJson)], { type: 'application/geo+json' }),
          'zone.geojson',
        );
      }

      // 4 raster files per scenario
      FILE_SLOTS.forEach((slot) => {
        formData.append(`scenario1_${slot.key}`, scenarioA[slot.key]!);
        formData.append(`scenario2_${slot.key}`, scenarioB[slot.key]!);
      });

      const response = await fetch(`${BASE_API}/scenarios/compare`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      setResult((await response.json()) as ComparisonResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la comparaison');
    } finally {
      setLoading(false);
    }
  };

  const fmtNum = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 5 });
  const fmtPct = (n: number) => `${n > 0 ? '+' : ''}${n}%`;

  const handleDownloadSynthesis = () => {
    if (!result) return;
    const headers = ['Variable', 'ID Parcelle/Point', 'Scenario 1', 'Scenario 2', 'Différence'];
    const rows: string[][] = [];

    Object.values(result.rasters).forEach((r) => {
      r.parcelles.forEach((p, i) => {
        rows.push([
          i === 0 ? r.label : '',   // Variable only on first row
          p.id || '—',
          fmtNum(p.scenario1_sum),
          fmtNum(p.scenario2_sum),
          fmtPct(p.pct_change),
        ]);
      });
      // Total surface row
      rows.push(['', 'Total surface', fmtNum(r.total.scenario1_sum), fmtNum(r.total.scenario2_sum), fmtPct(r.total.pct_change)]);
      rows.push([]); // blank separator between variables
    });

    const csv = [headers, ...rows].map((r) => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'comparaison_detaillee.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Title */}
        <div>
          <h2 className="text-lg font-bold text-gray-800">Comparaison de scénarios</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Importez les fichiers SAGA (.sg-grd-z) de chaque scénario et lancez la comparaison.
            {rawGeoJson
              ? ' La zone de l\'onglet Analyse sera utilisée pour le masquage.'
              : ' Chargez une zone dans l\'onglet Analyse pour obtenir des statistiques par parcelle.'}
          </p>
        </div>

        {/* Scenario cards */}
        <div className="flex gap-4">
          <ScenarioCard label="Scénario 1" color="#61C299" files={scenarioA} onFile={setFileA} />
          <ScenarioCard label="Scénario 2" color="#3b82f6" files={scenarioB} onFile={setFileB} />
        </div>

        {/* Compare button */}
        <button
          onClick={handleCompare}
          disabled={!canCompare || loading}
          className="w-full py-3 rounded-xl text-white font-semibold text-sm transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: '#61C299' }}
        >
          {loading && <Spinner />}
          {loading ? 'Calcul en cours…' : 'Comparer les scénarios'}
        </button>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-xl">
            {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">

            {/* Diff preview images */}
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(result.diff_preview_urls).map(([name, url]) => {
                const label = result.rasters[name]?.label ?? name;
                return (
                  <div key={name} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-700">
                      {label}
                    </div>
                    <img
                      src={`${BASE_API}${url}`}
                      alt={label}
                      className="w-full object-contain"
                      style={{ maxHeight: '180px' }}
                    />
                    <div className="px-3 py-1.5 flex justify-between text-xs text-gray-500">
                      <span className="text-blue-500">■ Augmentation</span>
                      <span className="text-red-500">■ Diminution</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Synthesis bubble */}
            <div className="bg-white border-2 rounded-2xl p-5 shadow-sm" style={{ borderColor: '#61C299' }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#61C299' }} />
                  <h3 className="font-semibold text-gray-800">Synthèse comparative</h3>
                </div>
                <button
                  onClick={handleDownloadSynthesis}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border-2 transition hover:bg-green-50"
                  style={{ borderColor: '#61C299', color: '#61C299' }}
                >
                  ↓ Télécharger CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b-2 border-gray-200">
                      <th className="text-left py-2 pr-4 font-semibold">Variable</th>
                      <th className="text-left py-2 pr-4 font-semibold">ID Parcelle/Point</th>
                      <th className="text-right py-2 pr-4 font-semibold">Scénario 1</th>
                      <th className="text-right py-2 pr-4 font-semibold">Scénario 2</th>
                      <th className="text-right py-2 font-semibold">Différence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.rasters).map(([key, r]) => {
                      const parcelleRows = r.parcelles;
                      const rowCount = parcelleRows.length + 1; // parcelles + total
                      return (
                        <>
                          {parcelleRows.map((p, i) => (
                            <tr key={`${key}-${p.id}`} className="border-t border-gray-100 hover:bg-gray-50">
                              {i === 0 && (
                                <td
                                  rowSpan={rowCount}
                                  className="py-1.5 pr-4 font-bold text-gray-800 align-top pt-2"
                                  style={{ borderTop: i === 0 ? '2px solid #e5e7eb' : undefined }}
                                >
                                  {r.label}
                                </td>
                              )}
                              <td className="py-1.5 pr-4 text-gray-600">{p.id || '—'}</td>
                              <td className="py-1.5 pr-4 text-right text-gray-600">{fmtNum(p.scenario1_sum)}</td>
                              <td className="py-1.5 pr-4 text-right text-gray-600">{fmtNum(p.scenario2_sum)}</td>
                              <td className={`py-1.5 text-right ${p.pct_change < 0 ? 'text-green-600' : p.pct_change > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                {fmtPct(p.pct_change)}
                              </td>
                            </tr>
                          ))}
                          {/* Total surface row */}
                          <tr key={`${key}-total`} className="border-t border-gray-200">
                            <td className="py-1.5 pr-4 text-gray-500 italic">Total surface</td>
                            <td className="py-1.5 pr-4 text-right font-bold text-gray-800">{fmtNum(r.total.scenario1_sum)}</td>
                            <td className="py-1.5 pr-4 text-right font-bold text-gray-800">{fmtNum(r.total.scenario2_sum)}</td>
                            <td className={`py-1.5 text-right font-bold ${r.total.pct_change < 0 ? 'text-green-600' : r.total.pct_change > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                              {fmtPct(r.total.pct_change)}
                            </td>
                          </tr>
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
