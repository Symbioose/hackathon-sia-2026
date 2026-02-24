"""Preview generation for analysis results.

- MNT (GeoTIFF) → PNG preview with stats
- Shapefile ZIP → GeoJSON with stats
"""

from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.warp import transform_bounds


def generate_mnt_preview(tif_path: str | Path) -> dict:
    """Read a GeoTIFF MNT, render a terrain PNG, compute stats.

    Returns dict with keys: png_path, bounds_wgs84, stats.
    """
    tif_path = Path(tif_path)
    if not tif_path.exists():
        raise FileNotFoundError(f"TIF not found: {tif_path}")

    with rasterio.open(tif_path) as src:
        data = src.read(1).astype(float)
        src_crs = src.crs
        src_bounds = src.bounds  # left, bottom, right, top
        res = src.res  # (pixel_width, pixel_height)
        nodata = src.nodata

    # Mask nodata values
    if nodata is not None:
        data = np.where(data == nodata, np.nan, data)

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

    # Render PNG with terrain colormap (same pattern as voir_mnt.py)
    fig, ax = plt.subplots(figsize=(10, 8))
    masked_data = np.ma.masked_invalid(data)
    img = ax.imshow(masked_data, cmap="terrain", vmin=alt_min, vmax=alt_max)
    fig.colorbar(img, ax=ax, label="Altitude (m)")
    ax.set_title(f"MNT — Min: {alt_min:.0f}m | Max: {alt_max:.0f}m")
    ax.set_xlabel("Pixels (X)")
    ax.set_ylabel("Pixels (Y)")
    ax.set_aspect("equal")

    png_path = tif_path.parent / "mnt_preview.png"
    fig.savefig(png_path, dpi=150, bbox_inches="tight", transparent=False)
    plt.close(fig)

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

def shapefile_zip_to_geojson(zip_path: str | Path) -> dict:
    """Extract shapefile from ZIP, convert to WGS84 GeoJSON with stats.

    Returns dict with keys: geojson, stats, layer_name.
    """
    import pyproj
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
    # Must attempt to read records to detect encoding issues
    reader = None
    for enc in ("utf-8", "latin-1", "cp1252"):
        try:
            r = shp.Reader(str(shp_file), encoding=enc)
            # Force-read first record to validate encoding
            if r.numRecords > 0:
                _ = r.record(0)
            reader = r
            break
        except Exception:
            continue
    if reader is None:
        raise RuntimeError(f"Cannot open shapefile: {shp_file}")

    # Detect CRS from .prj
    prj_file = shp_file.with_suffix(".prj")
    src_crs = None
    if prj_file.exists():
        prj_text = prj_file.read_text(errors="replace")
        if "Lambert_Conformal_Conic" in prj_text or "2154" in prj_text:
            src_crs = "EPSG:2154"
        elif "4326" in prj_text or "GCS_WGS_1984" in prj_text:
            src_crs = "EPSG:4326"

    # Build transformer (default assumes Lambert93)
    need_transform = src_crs != "EPSG:4326"
    if need_transform:
        transformer = pyproj.Transformer.from_crs(
            src_crs or "EPSG:2154", "EPSG:4326", always_xy=True,
        )

    def transform_coords(coords: list) -> list:
        """Recursively transform coordinate arrays."""
        if not coords:
            return coords
        if isinstance(coords[0], (int, float)):
            # Single point [x, y]
            if need_transform:
                lon, lat = transformer.transform(coords[0], coords[1])
                return [round(lon, 7), round(lat, 7)]
            return [round(coords[0], 7), round(coords[1], 7)]
        return [transform_coords(c) for c in coords]

    # Build GeoJSON features
    fields = [f[0] for f in reader.fields[1:]]  # skip DeletionFlag
    features = []
    for sr in reader.iterShapeRecords():
        geom = sr.shape.__geo_interface__
        props = dict(zip(fields, sr.record))
        # Clean props
        clean_props = {}
        for k, v in props.items():
            if isinstance(v, bytes):
                v = v.decode("latin-1", errors="replace")
            clean_props[k] = v

        geom["coordinates"] = transform_coords(geom["coordinates"])
        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": clean_props,
        })

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    # Compute stats
    geom_types = set()
    for f in features:
        geom_types.add(f["geometry"]["type"])

    attr_summary = fields[:10]  # first 10 attribute names

    stats = {
        "feature_count": len(features),
        "geometry_type": ", ".join(sorted(geom_types)),
        "attributes_summary": attr_summary,
    }

    return {
        "geojson": geojson,
        "stats": stats,
        "layer_name": layer_name,
    }
