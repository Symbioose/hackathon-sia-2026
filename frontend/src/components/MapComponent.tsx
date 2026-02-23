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
import { AnalysisResult, AnalysisType, GeoJsonFeatureCollection, Wgs84Bounds, ZoneStats } from '../types';

// Fix Leaflet default icon issue with bundlers
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});


interface MapComponentProps {
  zoneGeoJsonWgs84: GeoJsonFeatureCollection | null;
  paddedBoundsWgs84: Wgs84Bounds | null;
  analysisResults: Record<AnalysisType, AnalysisResult>;
  zoneStats: ZoneStats | null;
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
}) => {
  return (
    <MapContainer
      center={[48.8566, 2.3522]} // Paris as default
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

      {paddedBoundsWgs84 &&
        Object.values(analysisResults)
          .filter((item) => item.status === 'success' && item.url)
          .map((item) => (
            <ImageOverlay
              key={item.type}
              url={item.url as string}
              bounds={[
                [paddedBoundsWgs84.southWest.lat, paddedBoundsWgs84.southWest.lng],
                [paddedBoundsWgs84.northEast.lat, paddedBoundsWgs84.northEast.lng],
              ]}
              opacity={0.7}
            />
          ))}
    </MapContainer>
  );
};
