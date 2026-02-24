import React, { useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  Rectangle,
  useMap,
  GeoJSON,
  ImageOverlay,
} from 'react-leaflet';
import L from 'leaflet';
import {
  AnalysisDisplayData,
  AnalysisResult,
  AnalysisType,
  GeoJsonFeatureCollection,
  Wgs84Bounds,
  ZoneStats,
} from '../types';

// Fix Leaflet default icon issue with bundlers
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Color scheme per analysis type
const ANALYSIS_COLORS: Record<AnalysisType, string> = {
  mnt: '#795548',
  axe_ruissellement: '#2196F3',
  occupation_sols: '#FF9800',
  culture: '#8BC34A',
  bassin_versant: '#9C27B0',
};

interface MapComponentProps {
  zoneGeoJsonWgs84: GeoJsonFeatureCollection | null;
  paddedBoundsWgs84: Wgs84Bounds | null;
  analysisResults: Record<AnalysisType, AnalysisResult>;
  zoneStats: ZoneStats | null;
  activeAnalysis: AnalysisType | null;
  displayData: AnalysisDisplayData | null;
}

interface ZoneLayersProps {
  zoneGeoJsonWgs84: GeoJsonFeatureCollection | null;
  paddedBoundsWgs84: Wgs84Bounds | null;
  zoneStats: ZoneStats | null;
}

const ZoneLayers: React.FC<ZoneLayersProps> = ({
  zoneGeoJsonWgs84,
  paddedBoundsWgs84,
  zoneStats,
}) => {
  const map = useMap();

  useEffect(() => {
    if (!paddedBoundsWgs84) return;
    const sw = paddedBoundsWgs84.southWest;
    const ne = paddedBoundsWgs84.northEast;
    map.fitBounds(
      [
        [sw.lat, sw.lng],
        [ne.lat, ne.lng],
      ],
      { padding: [20, 20] }
    );
  }, [paddedBoundsWgs84, map]);

  const formatNumber = (n: number) => n.toLocaleString('fr-FR');

  const rectangleBounds: [[number, number], [number, number]] | null =
    paddedBoundsWgs84
      ? [
          [paddedBoundsWgs84.southWest.lat, paddedBoundsWgs84.southWest.lng],
          [paddedBoundsWgs84.northEast.lat, paddedBoundsWgs84.northEast.lng],
        ]
      : null;

  const tooltipContent = zoneStats ? `
    <div style="font-size: 12px; line-height: 1.5; min-width: 200px;">
      <div style="font-weight: bold; margin-bottom: 6px; font-size: 13px; border-bottom: 1px solid #ccc; padding-bottom: 4px;">Zone Information</div>
      <div style="margin-bottom: 3px;"><strong>CRS:</strong> ${zoneStats.crsDetected}</div>
      <div style="margin-top: 6px; font-weight: 600; margin-bottom: 3px;">BBox (Lambert-93) padded:</div>
      <div style="padding-left: 8px; margin-bottom: 2px;">X: ${formatNumber(zoneStats.bboxLambert93Padded.minX)} → ${formatNumber(zoneStats.bboxLambert93Padded.maxX)}</div>
      <div style="padding-left: 8px; margin-bottom: 3px;">Y: ${formatNumber(zoneStats.bboxLambert93Padded.minY)} → ${formatNumber(zoneStats.bboxLambert93Padded.maxY)}</div>
      <div style="margin-top: 6px; margin-bottom: 2px;"><strong>Surface:</strong> ${formatNumber(zoneStats.areaM2)} m² (${formatNumber(zoneStats.areaHa)} ha)</div>
      <div><strong>Périmètre:</strong> ${formatNumber(zoneStats.perimeterM)} m (${formatNumber(zoneStats.perimeterKm)} km)</div>
    </div>
  ` : '';

  return (
    <>
      {zoneGeoJsonWgs84 && (
        <GeoJSON
          key={JSON.stringify(zoneGeoJsonWgs84)}
          data={zoneGeoJsonWgs84 as any}
          style={{ color: '#3388ff', weight: 3, fillOpacity: 0.2 }}
        />
      )}

      {rectangleBounds && zoneStats && (
        <Rectangle
          bounds={rectangleBounds}
          pathOptions={{
            color: '#ff7800',
            weight: 2,
            fillOpacity: 0,
            interactive: true,
          }}
          eventHandlers={{
            mouseover: (e) => {
              const layer = e.target;
              layer.bindTooltip(tooltipContent, {
                permanent: false,
                sticky: true,
                direction: 'top',
                offset: [0, -10],
                className: 'zone-tooltip'
              }).openTooltip();
            },
            mouseout: (e) => {
              const layer = e.target;
              layer.closeTooltip();
            }
          }}
        />
      )}
    </>
  );
};

// --- Loading Overlay ---
const LoadingOverlay: React.FC<{
  analysisResults: Record<AnalysisType, AnalysisResult>;
}> = ({ analysisResults }) => {
  const pendingItems = Object.values(analysisResults).filter(
    (r) => r.status === 'pending'
  );
  if (pendingItems.length === 0) return null;

  return (
    <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-black/30 pointer-events-none">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-xs w-full pointer-events-auto">
        <div className="flex items-center gap-3 mb-4">
          <svg className="animate-spin h-6 w-6 text-green-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="font-semibold text-gray-800">Analyses en cours...</span>
        </div>
        <ul className="space-y-2">
          {pendingItems.map((item) => (
            <li key={item.type} className="flex items-center gap-2 text-sm text-gray-600">
              <svg className="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

// --- Analysis Layer (rendered inside MapContainer) ---
const AnalysisLayer: React.FC<{
  activeAnalysis: AnalysisType;
  displayData: AnalysisDisplayData;
}> = ({ activeAnalysis, displayData }) => {
  if (displayData.kind === 'raster') {
    const { png_url, bounds } = displayData;
    return (
      <ImageOverlay
        url={png_url}
        bounds={[
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ]}
        opacity={0.7}
      />
    );
  }

  // Vector layer
  const color = ANALYSIS_COLORS[activeAnalysis] || '#3388ff';
  return (
    <GeoJSON
      key={activeAnalysis + JSON.stringify(displayData.stats)}
      data={displayData.geojson as any}
      style={{
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.25,
      }}
      onEachFeature={(feature, layer) => {
        if (feature.properties) {
          const entries = Object.entries(feature.properties).slice(0, 8);
          if (entries.length > 0) {
            const html = entries
              .map(([k, v]) => `<strong>${k}:</strong> ${v ?? '—'}`)
              .join('<br/>');
            layer.bindPopup(`<div style="font-size:12px;max-width:250px">${html}</div>`);
          }
        }
      }}
    />
  );
};

const SATELLITE_TILE = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> | Tiles &copy; <a href="https://www.esri.com/">Esri</a>',
  maxZoom: 18,
};

export const MapComponent: React.FC<MapComponentProps> = ({
  zoneGeoJsonWgs84,
  paddedBoundsWgs84,
  analysisResults,
  zoneStats,
  activeAnalysis,
  displayData,
}) => {
  return (
    <div className="relative w-full h-full">
      <LoadingOverlay analysisResults={analysisResults} />

      <MapContainer
        center={[48.8566, 2.3522]}
        zoom={6}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url={SATELLITE_TILE.url}
          attribution={SATELLITE_TILE.attribution}
          maxZoom={SATELLITE_TILE.maxZoom}
        />

        <ZoneLayers
          zoneGeoJsonWgs84={zoneGeoJsonWgs84}
          paddedBoundsWgs84={paddedBoundsWgs84}
          zoneStats={zoneStats}
        />

        {activeAnalysis && displayData && (
          <AnalysisLayer
            activeAnalysis={activeAnalysis}
            displayData={displayData}
          />
        )}
      </MapContainer>
    </div>
  );
};
