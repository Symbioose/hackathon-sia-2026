import React, { useEffect, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Rectangle,
  useMap,
  GeoJSON,
} from 'react-leaflet';
import L from 'leaflet';
import { GeoJsonFeatureCollection, LatLng, MapType, Wgs84Bounds } from '../types';

interface MapComponentProps {
  mapType: MapType;
  searchLocation: { coords: LatLng; name: string } | null;
  zoneGeoJsonWgs84: GeoJsonFeatureCollection | null;
  paddedBoundsWgs84: Wgs84Bounds | null;
}

// Component to handle map movements
interface SearchLocationHandlerProps {
  location: { coords: LatLng; name: string } | null;
}

const SearchLocationHandler: React.FC<SearchLocationHandlerProps> = ({
  location,
}) => {
  const map = useMap();

  useEffect(() => {
    if (location) {
      map.setView([location.coords.lat, location.coords.lng], 11);
    }
  }, [location, map]);

  return null;
};

interface ZoneLayersProps {
  zoneGeoJsonWgs84: GeoJsonFeatureCollection | null;
  paddedBoundsWgs84: Wgs84Bounds | null;
}

const ZoneLayers: React.FC<ZoneLayersProps> = ({
  zoneGeoJsonWgs84,
  paddedBoundsWgs84,
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

  const rectangleBounds: [[number, number], [number, number]] | null =
    paddedBoundsWgs84
      ? [
          [paddedBoundsWgs84.southWest.lat, paddedBoundsWgs84.southWest.lng],
          [paddedBoundsWgs84.northEast.lat, paddedBoundsWgs84.northEast.lng],
        ]
      : null;

  return (
    <>
      {zoneGeoJsonWgs84 && (
        <GeoJSON
          data={zoneGeoJsonWgs84 as any}
        />
      )}

      {rectangleBounds && (
        <Rectangle bounds={rectangleBounds} weight={2} />
      )}
    </>
  );
};

// Map tile configurations
const TILE_CONFIGS: Record<
  MapType,
  { url: string; attribution: string; maxZoom: number }
> = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    attribution: 'USGS',
    maxZoom: 16,
  },
  terrain: {
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> contributors',
    maxZoom: 17,
  },
};

export const MapComponent: React.FC<MapComponentProps> = ({
  mapType,
  searchLocation,
  zoneGeoJsonWgs84,
  paddedBoundsWgs84,
}) => {
  const mapRef = useRef<L.Map | null>(null);

  const tileConfig = TILE_CONFIGS[mapType];

  const searchMarkerIcon = new L.Icon({
    iconUrl:
      'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });

  return (
    <MapContainer
      center={[48.8566, 2.3522]} // Paris as default
      zoom={6}
      style={{ height: '100%', width: '100%' }}
      ref={mapRef}
    >
      <TileLayer
        key={mapType}
        url={tileConfig.url}
        attribution={tileConfig.attribution}
        maxZoom={tileConfig.maxZoom}
      />

      <SearchLocationHandler location={searchLocation} />

      <ZoneLayers
        zoneGeoJsonWgs84={zoneGeoJsonWgs84}
        paddedBoundsWgs84={paddedBoundsWgs84}
      />

      {/* Search result marker */}
      {searchLocation && (
        <Marker
          position={[searchLocation.coords.lat, searchLocation.coords.lng]}
          icon={searchMarkerIcon}
        >
          <Popup>{searchLocation.name}</Popup>
        </Marker>
      )}
    </MapContainer>
  );
};
