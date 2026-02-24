import React, { useCallback, useRef, useState } from 'react';
import { BASE_API } from '../config';

// ── Types ──────────────────────────────────────────────────────────────────────

type FileKey = 'infiltration' | 'surface_runoff' | 'interrill_erosion' | 'rill_erosion';

const FILE_SLOTS: { key: FileKey; label: string; icon: string }[] = [
  { key: 'infiltration',       label: 'Infiltration',      icon: '💧' },
  { key: 'surface_runoff',     label: 'Surface Runoff',    icon: '🌊' },
  { key: 'interrill_erosion',  label: 'Interrill Erosion', icon: '🌱' },
  { key: 'rill_erosion',       label: 'Rill Erosion',      icon: '🪨' },
];

type ScenarioFiles = Record<FileKey, File | null>;

const emptyScenario = (): ScenarioFiles =>
  Object.fromEntries(FILE_SLOTS.map((s) => [s.key, null])) as ScenarioFiles;

interface SynthesisRow {
  metric: string;
  scenario_a: number | null;
  scenario_b: number | null;
  delta: number | null;
  delta_percent: number | null;
}

interface ComparisonResult {
  download_url: string;
  synthesis: SynthesisRow[];
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

  const hasFile = file !== null;

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className="border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all select-none"
      style={{
        borderColor: hasFile ? '#61C299' : dragging ? '#61C299' : '#d1d5db',
        backgroundColor: hasFile ? '#f0faf5' : dragging ? '#f0faf5' : '#f9fafb',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
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
          {hasFile ? (
            <div
              className="text-xs font-medium truncate mt-0.5"
              style={{ color: '#61C299' }}
              title={file.name}
            >
              {file.name}
            </div>
          ) : (
            <div className="text-xs text-gray-400 mt-0.5">Déposer ou cliquer pour importer</div>
          )}
        </div>
        {hasFile && (
          <div
            className="shrink-0 text-xs font-bold"
            style={{ color: '#61C299' }}
          >
            ✓
          </div>
        )}
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
  const filledCount = FILE_SLOTS.filter((s) => files[s.key] !== null).length;

  return (
    <div className="flex-1 bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <h3 className="font-semibold text-gray-800">{label}</h3>
        </div>
        <span className="text-xs text-gray-400">
          {filledCount}/{FILE_SLOTS.length} fichiers
        </span>
      </div>

      {FILE_SLOTS.map((slot) => (
        <DropZone
          key={slot.key}
          icon={slot.icon}
          label={slot.label}
          file={files[slot.key]}
          onFile={(file) => onFile(slot.key, file)}
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

// ── SynthesisTable ─────────────────────────────────────────────────────────────

const SynthesisTable: React.FC<{ rows: SynthesisRow[] }> = ({ rows }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-500 border-b border-gray-100">
          <th className="text-left pb-2 font-semibold">Métrique</th>
          <th className="text-right pb-2 font-semibold">Scénario A</th>
          <th className="text-right pb-2 font-semibold">Scénario B</th>
          <th className="text-right pb-2 font-semibold">Delta</th>
          <th className="text-right pb-2 font-semibold">Δ%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const isNeg = row.delta != null && row.delta < 0;
          const isPos = row.delta != null && row.delta > 0;
          const deltaClass = isNeg ? 'text-green-600' : isPos ? 'text-red-500' : 'text-gray-400';

          return (
            <tr key={i} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
              <td className="py-2 text-gray-700 font-medium">{row.metric}</td>
              <td className="py-2 text-right text-gray-600">{row.scenario_a ?? '—'}</td>
              <td className="py-2 text-right text-gray-600">{row.scenario_b ?? '—'}</td>
              <td className={`py-2 text-right font-semibold ${deltaClass}`}>
                {row.delta != null
                  ? `${row.delta > 0 ? '+' : ''}${row.delta}`
                  : '—'}
              </td>
              <td className={`py-2 text-right font-semibold ${deltaClass}`}>
                {row.delta_percent != null
                  ? `${row.delta_percent > 0 ? '+' : ''}${row.delta_percent}%`
                  : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

// ── ComparisonPanel ────────────────────────────────────────────────────────────

export const ComparisonPanel: React.FC = () => {
  const [scenarioA, setScenarioA] = useState<ScenarioFiles>(emptyScenario());
  const [scenarioB, setScenarioB] = useState<ScenarioFiles>(emptyScenario());
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState<ComparisonResult | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const setFileA = useCallback((key: FileKey, file: File) => {
    setScenarioA((prev) => ({ ...prev, [key]: file }));
  }, []);
  const setFileB = useCallback((key: FileKey, file: File) => {
    setScenarioB((prev) => ({ ...prev, [key]: file }));
  }, []);

  const canCompare =
    FILE_SLOTS.some((s) => scenarioA[s.key] !== null) &&
    FILE_SLOTS.some((s) => scenarioB[s.key] !== null);

  const handleCompare = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      FILE_SLOTS.forEach((slot) => {
        if (scenarioA[slot.key]) formData.append(`scenario_a_${slot.key}`, scenarioA[slot.key]!);
        if (scenarioB[slot.key]) formData.append(`scenario_b_${slot.key}`, scenarioB[slot.key]!);
      });

      const response = await fetch(`${BASE_API}/comparison/compute`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

      const data = (await response.json()) as ComparisonResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la comparaison');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadSynthesis = () => {
    if (!result?.synthesis) return;

    const headers = ['Métrique', 'Scénario A', 'Scénario B', 'Delta', 'Delta (%)'];
    const rows = result.synthesis.map((r) => [
      r.metric,
      r.scenario_a ?? '',
      r.scenario_b ?? '',
      r.delta ?? '',
      r.delta_percent != null ? `${r.delta_percent}%` : '',
    ]);
    const csv = [headers, ...rows].map((r) => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'synthese_comparaison.csv';
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
            Importez les fichiers CSV de chaque scénario et lancez la comparaison.
          </p>
        </div>

        {/* Scenario cards */}
        <div className="flex gap-4">
          <ScenarioCard
            label="Scénario A"
            color="#61C299"
            files={scenarioA}
            onFile={setFileA}
          />
          <ScenarioCard
            label="Scénario B"
            color="#3b82f6"
            files={scenarioB}
            onFile={setFileB}
          />
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
            {/* Download buttons */}
            <div className="flex gap-3">
              <a
                href={`${BASE_API}${result.download_url}`}
                download
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-center border-2 transition hover:bg-green-50"
                style={{ borderColor: '#61C299', color: '#61C299' }}
              >
                ↓ Télécharger le CSV résultat
              </a>
              <button
                onClick={handleDownloadSynthesis}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition hover:bg-green-50"
                style={{ borderColor: '#61C299', color: '#61C299' }}
              >
                ↓ Télécharger la synthèse
              </button>
            </div>

            {/* Synthesis bubble */}
            <div
              className="bg-white border-2 rounded-2xl p-5 shadow-sm"
              style={{ borderColor: '#61C299' }}
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#61C299' }} />
                <h3 className="font-semibold text-gray-800">Synthèse comparative</h3>
                <span className="ml-auto text-xs text-gray-400">
                  {result.synthesis.length} métriques
                </span>
              </div>
              <SynthesisTable rows={result.synthesis} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
