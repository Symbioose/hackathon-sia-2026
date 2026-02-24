"""Preview generation for analysis results.

- MNT (GeoTIFF) → clean raster-only PNG preview with stats
- Shapefile ZIP → GeoJSON with domain-specific stats
"""

from __future__ import annotations

import datetime
import math
import tempfile
import zipfile
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.cm as cm
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.warp import transform as warp_transform, transform_bounds


def generate_mnt_preview(tif_path: str | Path) -> dict:
    """Read a GeoTIFF MNT, render a clean raster-only PNG, compute stats.

    The PNG is a raw RGBA image (no axes, title, or colorbar) so that
    Leaflet ImageOverlay aligns it exactly to the geo-bounds.

    Returns dict with keys: png_path, bounds_wgs84, stats.
    """
    tif_path = Path(tif_path)
    if not tif_path.exists():
        raise FileNotFoundError(f"TIF not found: {tif_path}")

    with rasterio.open(tif_path) as src:
        data = src.read(1).astype(float)
        src_crs = src.crs
        src_bounds = src.bounds
        res = src.res
        nodata = src.nodata

    # Mask nodata values
    if nodata is not None:
        mask = data == nodata
    else:
        mask = np.isnan(data)
    data = np.where(mask, np.nan, data)

    valid = data[~np.isnan(data)]
    if valid.size == 0:
        alt_min = alt_max = alt_mean = 0.0
    else:
        alt_min = float(np.nanmin(valid))
        alt_max = float(np.nanmax(valid))
        alt_mean = float(np.nanmean(valid))

    stats = {
        "alt_min": round(alt_min, 2),
        "alt_max": round(alt_max, 2),
        "alt_mean": round(alt_mean, 2),
        "resolution_m": round(res[0], 2),
        "width_px": data.shape[1],
        "height_px": data.shape[0],
    }

    # Render clean RGBA image — no figure, no axes, no colorbar
    if alt_max > alt_min:
        normalized = (data - alt_min) / (alt_max - alt_min)
    else:
        normalized = np.zeros_like(data)
    normalized = np.clip(normalized, 0, 1)

    # Apply terrain colormap → RGBA float array (H, W, 4)
    rgba = cm.terrain(normalized)

    # Set nodata pixels to fully transparent
    rgba[mask, 3] = 0.0

    # Convert to uint8 and save with imsave (pixel-perfect, no decorations)
    rgba_uint8 = (rgba * 255).astype(np.uint8)
    png_path = tif_path.parent / "mnt_preview.png"
    plt.imsave(str(png_path), rgba_uint8)

    # Convert bounds to WGS84
    if src_crs and str(src_crs) != "EPSG:4326":
        west, south, east, north = transform_bounds(
            src_crs, "EPSG:4326",
            src_bounds.left, src_bounds.bottom, src_bounds.right, src_bounds.top,
        )
    else:
        west, south, east, north = (
            src_bounds.left, src_bounds.bottom, src_bounds.right, src_bounds.top,
        )

    bounds_wgs84 = {
        "south": round(south, 7),
        "west": round(west, 7),
        "north": round(north, 7),
        "east": round(east, 7),
    }

    return {
        "png_path": str(png_path),
        "bounds_wgs84": bounds_wgs84,
        "stats": stats,
    }


# ---------------------------------------------------------------------------
# Shapefile ZIP → GeoJSON
# ---------------------------------------------------------------------------

def _haversine_length_km(coords: list) -> float:
    """Compute the length of a LineString in km using the haversine formula.

    coords: list of [lon, lat] pairs (WGS84).
    """
    total = 0.0
    R = 6371.0  # Earth radius in km
    for i in range(len(coords) - 1):
        lon1, lat1 = math.radians(coords[i][0]), math.radians(coords[i][1])
        lon2, lat2 = math.radians(coords[i + 1][0]), math.radians(coords[i + 1][1])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        total += 2 * R * math.asin(math.sqrt(a))
    return total


def _polygon_area_ha(coords: list) -> float:
    """Approximate area in hectares for a polygon ring in WGS84 using the shoelace formula.

    This is a rough approximation treating lon/lat as planar at the polygon centroid.
    coords: list of [lon, lat] pairs.
    """
    if len(coords) < 3:
        return 0.0
    # Compute centroid latitude for projection scale
    avg_lat = sum(c[1] for c in coords) / len(coords)
    cos_lat = math.cos(math.radians(avg_lat))
    # Convert to approximate meters
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * cos_lat

    # Shoelace formula in m²
    n = len(coords)
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        x_i = coords[i][0] * m_per_deg_lon
        y_i = coords[i][1] * m_per_deg_lat
        x_j = coords[j][0] * m_per_deg_lon
        y_j = coords[j][1] * m_per_deg_lat
        area += x_i * y_j - x_j * y_i
    area_m2 = abs(area) / 2.0
    return area_m2 / 10000.0  # m² → ha


def _feature_area_ha(geometry: dict) -> float:
    """Compute approximate area in ha for a Polygon or MultiPolygon feature."""
    gtype = geometry.get("type", "")
    coords = geometry.get("coordinates", [])
    if gtype == "Polygon":
        # First ring is exterior, subsequent are holes
        area = _polygon_area_ha(coords[0]) if coords else 0.0
        for hole in coords[1:]:
            area -= _polygon_area_ha(hole)
        return max(area, 0.0)
    elif gtype == "MultiPolygon":
        total = 0.0
        for poly in coords:
            area = _polygon_area_ha(poly[0]) if poly else 0.0
            for hole in poly[1:]:
                area -= _polygon_area_ha(hole)
            total += max(area, 0.0)
        return total
    return 0.0


def _compute_domain_stats(features: list, geom_types: set, analysis_type: str | None) -> dict:
    """Compute domain-specific statistics based on analysis_type."""
    base = {
        "feature_count": len(features),
        "geometry_type": ", ".join(sorted(geom_types)),
    }

    if not analysis_type or not features:
        return base

    if analysis_type == "culture":
        # RPG parcels — crop distribution, total area
        total_area = 0.0
        crop_dist: dict[str, dict] = {}
        for f in features:
            props = f.get("properties") or {}
            # Try surf_parc field first, fallback to geometric computation
            surf = props.get("surf_parc")
            if surf is not None:
                try:
                    area = float(surf)
                except (ValueError, TypeError):
                    area = _feature_area_ha(f["geometry"])
            else:
                area = _feature_area_ha(f["geometry"])
            total_area += area

            code = str(props.get("code_cultu", props.get("CODE_CULTU", "Inconnu")))
            if code not in crop_dist:
                crop_dist[code] = {"count": 0, "area_ha": 0.0}
            crop_dist[code]["count"] += 1
            crop_dist[code]["area_ha"] += area

        # Round areas
        for v in crop_dist.values():
            v["area_ha"] = round(v["area_ha"], 2)
        # Sort by area descending, keep top 10
        sorted_crops = dict(sorted(crop_dist.items(), key=lambda x: x[1]["area_ha"], reverse=True)[:10])

        base["total_area_ha"] = round(total_area, 2)
        base["distribution"] = sorted_crops
        return base

    elif analysis_type == "axe_ruissellement":
        # Hydrography — stream count, total length
        total_length = 0.0
        nature_dist: dict[str, dict] = {}
        for f in features:
            geom = f["geometry"]
            gtype = geom.get("type", "")
            coords = geom.get("coordinates", [])
            if gtype == "LineString":
                total_length += _haversine_length_km(coords)
            elif gtype == "MultiLineString":
                for line in coords:
                    total_length += _haversine_length_km(line)

            props = f.get("properties") or {}
            nature = str(props.get("nature", props.get("NATURE", "Inconnu")))
            if nature not in nature_dist:
                nature_dist[nature] = {"count": 0}
            nature_dist[nature]["count"] += 1

        base["total_length_km"] = round(total_length, 2)
        if nature_dist:
            base["distribution"] = dict(sorted(nature_dist.items(), key=lambda x: x[1]["count"], reverse=True))
        return base

    elif analysis_type == "occupation_sols":
        # BD TOPO occupation — category counts and area
        total_area = 0.0
        cat_dist: dict[str, dict] = {}
        for f in features:
            area = _feature_area_ha(f["geometry"])
            total_area += area
            props = f.get("properties") or {}
            cat = str(props.get("nature", props.get("NATURE", props.get("layer_name", "Inconnu"))))
            if cat not in cat_dist:
                cat_dist[cat] = {"count": 0, "area_ha": 0.0}
            cat_dist[cat]["count"] += 1
            cat_dist[cat]["area_ha"] += area

        for v in cat_dist.values():
            v["area_ha"] = round(v["area_ha"], 2)

        base["total_area_ha"] = round(total_area, 2)
        if cat_dist:
            base["distribution"] = dict(sorted(cat_dist.items(), key=lambda x: x[1]["area_ha"], reverse=True)[:10])
        return base

    elif analysis_type == "bassin_versant":
        # Basins — count and total area
        total_area = 0.0
        for f in features:
            total_area += _feature_area_ha(f["geometry"])
        base["total_area_ha"] = round(total_area, 2)
        return base

    return base


def _json_safe(value: object) -> object:
    """Convert a shapefile attribute value to a JSON-serializable type."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, bytes):
        return value.decode("latin-1", errors="replace")
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    return str(value)


def shapefile_zip_to_geojson(zip_path: str | Path, analysis_type: str | None = None) -> dict:
    """Extract shapefile from ZIP, convert to WGS84 GeoJSON with domain stats.

    Returns dict with keys: geojson, stats, layer_name.
    """
    import shapefile as shp

    zip_path = Path(zip_path)
    if not zip_path.exists():
        raise FileNotFoundError(f"ZIP not found: {zip_path}")

    # Extract to temp dir and find .shp
    tmp_dir = tempfile.mkdtemp(prefix="shp_preview_")
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(tmp_dir)

    shp_files = list(Path(tmp_dir).rglob("*.shp"))
    if not shp_files:
        raise FileNotFoundError("No .shp found in ZIP")
    shp_file = shp_files[0]
    layer_name = shp_file.stem

    # Read shapefile with multi-encoding fallback
    reader = None
    for enc in ("utf-8", "latin-1", "cp1252"):
        try:
            r = shp.Reader(str(shp_file), encoding=enc)
            if r.numRecords > 0:
                _ = r.record(0)
            reader = r
            break
        except Exception:
            continue
    if reader is None:
        raise RuntimeError(f"Cannot open shapefile: {shp_file}")

    # Detect CRS from .prj (default: Lambert-93)
    prj_file = shp_file.with_suffix(".prj")
    src_crs = "EPSG:2154"
    if prj_file.exists():
        prj_text = prj_file.read_text(errors="replace")
        if "4326" in prj_text or "GCS_WGS_1984" in prj_text:
            src_crs = "EPSG:4326"
        elif "Lambert_Conformal_Conic" in prj_text or "2154" in prj_text:
            src_crs = "EPSG:2154"

    need_transform = src_crs != "EPSG:4326"

    def transform_coords(coords: list) -> list:
        """Recursively reproject coordinate arrays to WGS84."""
        if not coords:
            return coords
        if isinstance(coords[0], (int, float)):
            if need_transform:
                xs, ys = warp_transform(src_crs, "EPSG:4326", [coords[0]], [coords[1]])
                return [round(xs[0], 7), round(ys[0], 7)]
            return [round(coords[0], 7), round(coords[1], 7)]
        return [transform_coords(c) for c in coords]

    # Build GeoJSON features
    fields = [f[0] for f in reader.fields[1:]]  # skip DeletionFlag
    features = []
    for sr in reader.iterShapeRecords():
        geom = dict(sr.shape.__geo_interface__)  # mutable copy
        props = dict(zip(fields, sr.record))
        clean_props = {k: _json_safe(v) for k, v in props.items()}

        coords = geom.get("coordinates")
        if coords is not None:
            geom["coordinates"] = transform_coords(list(coords))
        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": clean_props,
        })

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    # Compute domain-specific stats
    geom_types = set()
    for f in features:
        geom_types.add(f["geometry"]["type"])

    stats = _compute_domain_stats(features, geom_types, analysis_type)

    return {
        "geojson": geojson,
        "stats": stats,
        "layer_name": layer_name,
    }
