import React from 'react';
import {
  ScenarioComparisonResult,
  ScenarioRasterName,
} from '../types';

const RASTER_ORDER: ScenarioRasterName[] = [
  'infiltration',
  'interrill_erosion',
  'rill_erosion',
  'surface_runoff',
];

const RASTER_UNITS: Record<ScenarioRasterName, string> = {
  infiltration: 'mm',
  interrill_erosion: 'kg',
  rill_erosion: 'kg',
  surface_runoff: 'm\u00B3',
};

const fmt = (n: number) =>
  n.toLocaleString('fr-FR', { maximumFractionDigits: 5 });

const fmtPct = (n: number) => {
  const rounded = Math.round(n);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
};

// For erosion & runoff, negative = good (green). For infiltration, positive = good (green).
const INVERTED_RASTERS: Set<ScenarioRasterName> = new Set([
  'interrill_erosion',
  'rill_erosion',
  'surface_runoff',
]);

const pctColor = (pct: number, rasterName: ScenarioRasterName) => {
  if (pct === 0) return 'text-gray-600';
  const isGood = INVERTED_RASTERS.has(rasterName) ? pct < 0 : pct > 0;
  return isGood ? 'text-green-700' : 'text-red-600';
};

interface Props {
  result: ScenarioComparisonResult;
}

export const ScenarioDashboard: React.FC<Props> = ({ result }) => {
  return (
    <div className="overflow-auto bg-white rounded-lg shadow border border-gray-200">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b-2 border-gray-300">
            <th className="text-left px-4 py-2.5 font-semibold text-gray-700">Variable</th>
            <th className="text-left px-4 py-2.5 font-semibold text-gray-700">ID Parcelle/Point</th>
            <th className="text-right px-4 py-2.5 font-semibold text-gray-700">Scenario 1</th>
            <th className="text-right px-4 py-2.5 font-semibold text-gray-700">Scenario 2</th>
            <th className="text-right px-4 py-2.5 font-semibold text-gray-700">Difference</th>
          </tr>
        </thead>
        <tbody>
          {RASTER_ORDER.map((rasterName) => {
            const group = result.rasters[rasterName];
            if (!group) return null;

            const unit = RASTER_UNITS[rasterName];
            const rowCount = group.parcelles.length + 1; // parcelles + total

            return (
              <React.Fragment key={rasterName}>
                {/* Per-parcelle rows */}
                {group.parcelles.map((p, i) => (
                  <tr
                    key={`${rasterName}-${p.id}`}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    {/* Variable label only on first row, spanning all parcelle rows */}
                    {i === 0 && (
                      <td
                        rowSpan={rowCount}
                        className="px-4 py-2 font-semibold text-gray-800 align-top border-r border-gray-200 bg-gray-50/50"
                      >
                        {group.label} ({unit})
                      </td>
                    )}
                    <td className="px-4 py-1.5 text-gray-600 tabular-nums">{p.id}</td>
                    <td className="text-right px-4 py-1.5 text-gray-700 tabular-nums">{fmt(p.scenario1_sum)}</td>
                    <td className="text-right px-4 py-1.5 text-gray-700 tabular-nums">{fmt(p.scenario2_sum)}</td>
                    <td className={`text-right px-4 py-1.5 tabular-nums font-medium ${pctColor(p.pct_change, rasterName)}`}>
                      {fmtPct(p.pct_change)}
                    </td>
                  </tr>
                ))}

                {/* Total surface row */}
                <tr className="border-b-2 border-gray-300 bg-gray-50 hover:bg-gray-100 transition-colors">
                  <td className="px-4 py-1.5 font-semibold text-gray-700 italic">Total surface</td>
                  <td className="text-right px-4 py-1.5 text-gray-800 tabular-nums font-medium">
                    {fmt(group.total.scenario1_sum)}
                  </td>
                  <td className="text-right px-4 py-1.5 text-gray-800 tabular-nums font-medium">
                    {fmt(group.total.scenario2_sum)}
                  </td>
                  <td
                    className={`text-right px-4 py-1.5 tabular-nums font-bold ${pctColor(group.total.pct_change, rasterName)}`}
                  >
                    {fmtPct(group.total.pct_change)}
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
