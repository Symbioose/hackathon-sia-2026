"""
Read SAGA GIS .sg-grd-z grids, compute pixel-level diffs between two scenarios,
generate diff PNG previews and return zonal stats.
"""

from __future__ import annotations

import json
import tempfile
import zipfile
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.colors as mcolors
import matplotlib.cm as cm
import matplotlib.pyplot as plt
import numpy as np
import pyproj
import rasterio.features
import rasterio.transform

RASTER_NAMES = ["infiltration", "interrill_erosion", "rill_erosion", "surface_runoff"]
RASTER_LABELS = {
    "infiltration": "Capacité d'infiltration du sol (mm)",
    "interrill_erosion": "Érosion diffuse (kg)",
    "rill_erosion": "Érosion concentrée (kg)",
    "surface_runoff": "Ruissellement",
}
NODATA = -99999.0
SAGA_CRS = "EPSG:2154"  # Lambert-93


# ---------------------------------------------------------------------------
# SAGA grid reading
# ---------------------------------------------------------------------------

def parse_sgrd_header(sgrd_text: str) -> dict:
    """Parse a SAGA .sgrd header file into a dict of typed values."""
    header: dict = {}
    for line in sgrd_text.splitlines():
        line = line.strip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        # Try to convert numeric values
        if key in ("CELLCOUNT_X", "CELLCOUNT_Y"):
            header[key] = int(value)
        elif key == "NODATA_VALUE":
            # SAGA uses "min;max" range format, e.g. "-99999.000000;-99999.000000"
            parts = value.split(";")
            header[key] = float(parts[0])
        elif key in ("CELLSIZE", "POSITION_XMIN", "POSITION_YMIN", "Z_FACTOR", "Z_OFFSET"):
            header[key] = float(value)
        else:
            header[key] = value
    return header


def read_saga_grid(sgz_path: Path, tmp_dir: Path) -> tuple[np.ndarray, dict]:
    """
    Extract a .sg-grd-z ZIP and read the raster as a numpy float32 array.
    Returns (data_2d, header_dict).
    """
    extract_dir = tmp_dir / sgz_path.stem
    extract_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(sgz_path, "r") as zf:
        zf.extractall(extract_dir)

    # Find the .sgrd and .sdat files
    sgrd_files = list(extract_dir.rglob("*.sgrd"))
    sdat_files = list(extract_dir.rglob("*.sdat"))

    if not sgrd_files:
        raise FileNotFoundError(f"No .sgrd file found in {sgz_path}")
    if not sdat_files:
        raise FileNotFoundError(f"No .sdat file found in {sgz_path}")

    header = parse_sgrd_header(sgrd_files[0].read_text(encoding="utf-8", errors="replace"))
    nx = header["CELLCOUNT_X"]
    ny = header["CELLCOUNT_Y"]

    data = np.fromfile(str(sdat_files[0]), dtype="<f4")
    data = data.reshape((ny, nx))

    # SAGA stores bottom-to-top by default (TOPTOBOTTOM=FALSE)
    toptobottom = header.get("TOPTOBOTTOM", "FALSE")
    if str(toptobottom).upper() != "TRUE":
        data = np.flipud(data)

    return data, header


# ---------------------------------------------------------------------------
# Zone masking
# ---------------------------------------------------------------------------


def _build_transform(header: dict) -> rasterio.transform.Affine:
    """Build a rasterio Affine transform from SAGA header values."""
    cellsize = header["CELLSIZE"]
    xmin = header["POSITION_XMIN"]
    ymin = header["POSITION_YMIN"]
    nx = header["CELLCOUNT_X"]
    ny = header["CELLCOUNT_Y"]

    # SAGA POSITION_XMIN/YMIN are cell centers; rasterio wants top-left corner
    x_origin = xmin - cellsize / 2
    y_origin = ymin + ny * cellsize - cellsize / 2  # top-left y

    return rasterio.transform.from_bounds(
        x_origin,
        ymin - cellsize / 2,
        x_origin + nx * cellsize,
        y_origin + cellsize,  # Note: from_bounds wants (west, south, east, north)
        nx,
        ny,
    )


# ---------------------------------------------------------------------------
# Diff PNG generation
# ---------------------------------------------------------------------------

def generate_diff_preview(
    data1: np.ndarray,
    data2: np.ndarray,
    valid_mask: np.ndarray,
    header: dict,
    output_dir: Path,
    name: str,
) -> Path:
    """Generate a diff PNG with RdBu diverging colormap, nodata as transparent."""
    diff = np.where(valid_mask, data2.astype(np.float64) - data1.astype(np.float64), np.nan)

    # Clip outliers at 2nd/98th percentile for better visualization
    valid_diff = diff[valid_mask]
    if valid_diff.size > 0:
        p2, p98 = np.percentile(valid_diff, [2, 98])
        diff_clipped = np.clip(diff, p2, p98)
    else:
        p2, p98 = -1.0, 1.0
        diff_clipped = diff

    # Symmetric around zero
    abs_max = max(abs(p2), abs(p98), 1e-10)
    norm = mcolors.TwoSlopeNorm(vmin=-abs_max, vcenter=0, vmax=abs_max)

    # Apply colormap
    cmap = cm.RdBu
    rgba = cmap(norm(diff_clipped))

    # Set nodata pixels to fully transparent
    rgba[~valid_mask, 3] = 0.0

    output_path = output_dir / f"{name}_diff.png"
    plt.imsave(str(output_path), rgba)
    return output_path


# ---------------------------------------------------------------------------
# Bounds conversion to WGS84
# ---------------------------------------------------------------------------

def _bounds_to_wgs84(header: dict) -> dict:
    """Convert SAGA Lambert-93 raster extent to WGS84 bounds for Leaflet."""
    cellsize = header["CELLSIZE"]
    xmin = header["POSITION_XMIN"] - cellsize / 2
    ymin = header["POSITION_YMIN"] - cellsize / 2
    xmax = xmin + header["CELLCOUNT_X"] * cellsize
    ymax = ymin + header["CELLCOUNT_Y"] * cellsize

    transformer = pyproj.Transformer.from_crs(SAGA_CRS, "EPSG:4326", always_xy=True)
    lon_min, lat_min = transformer.transform(xmin, ymin)
    lon_max, lat_max = transformer.transform(xmax, ymax)

    return {
        "south": lat_min,
        "west": lon_min,
        "north": lat_max,
        "east": lon_max,
    }


# ---------------------------------------------------------------------------
# Main comparison function
# ---------------------------------------------------------------------------

def _extract_features(zone_geojson: dict) -> list[tuple[str, dict]]:
    """Extract (id, geometry) pairs from GeoJSON."""
    features = []
    if zone_geojson.get("type") == "FeatureCollection":
        for feat in zone_geojson.get("features", []):
            fid = str(feat.get("properties", {}).get("id", feat.get("id", "")))
            features.append((fid, feat["geometry"]))
    elif zone_geojson.get("type") == "Feature":
        fid = str(zone_geojson.get("properties", {}).get("id", zone_geojson.get("id", "")))
        features.append((fid, zone_geojson["geometry"]))
    else:
        features.append(("1", zone_geojson))
    return features


def _feature_mask(
    geometry: dict,
    nx: int,
    ny: int,
    transform: rasterio.transform.Affine,
) -> np.ndarray:
    """Boolean mask (True = inside) for a single geometry."""
    mask_outside = rasterio.features.geometry_mask(
        [geometry],
        out_shape=(ny, nx),
        transform=transform,
        invert=False,
    )
    return ~mask_outside


def _stats_from_mask(
    data1: np.ndarray,
    data2: np.ndarray,
    mask: np.ndarray,
) -> dict:
    """Compute comparison stats for a given mask. Uses SUM (not mean) to match the image."""
    s1_vals = data1[mask].astype(np.float64)
    s2_vals = data2[mask].astype(np.float64)

    total = int(mask.sum())
    if total == 0:
        return {
            "scenario1_sum": 0.0,
            "scenario2_sum": 0.0,
            "pct_change": 0.0,
        }

    s1_sum = float(np.sum(s1_vals))
    s2_sum = float(np.sum(s2_vals))
    pct = ((s2_sum - s1_sum) / abs(s1_sum) * 100) if abs(s1_sum) > 1e-10 else 0.0

    return {
        "scenario1_sum": round(s1_sum, 5),
        "scenario2_sum": round(s2_sum, 5),
        "pct_change": round(pct, 0),
    }


def compute_scenario_diff(
    scenario1_dir: Path,
    scenario2_dir: Path,
    zone_geojson_path: Path | None = None,
    output_dir: Path | None = None,
) -> dict:
    """
    Compare two sets of SAGA grids pixel-by-pixel, per-parcelle + total.

    Returns dict with per-raster, per-parcelle stats grouped like:
    { rasters: { infiltration: { label, parcelles: [{id, s1, s2, diff%}, ...], total: {s1, s2, diff%} }, ... } }
    """
    zone_geojson = None
    if zone_geojson_path and zone_geojson_path.exists():
        zone_geojson = json.loads(zone_geojson_path.read_text(encoding="utf-8"))

    # Extract feature list from GeoJSON
    features: list[tuple[str, dict]] = []
    if zone_geojson is not None:
        features = _extract_features(zone_geojson)

    rasters_result: dict = {}
    diff_png_paths: dict = {}
    bounds_wgs84 = None
    parcelle_ids: list[str] = [fid for fid, _ in features]

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        png_dir = output_dir if output_dir else tmp

        for name in RASTER_NAMES:
            s1_path = scenario1_dir / f"{name}.sg-grd-z"
            s2_path = scenario2_dir / f"{name}.sg-grd-z"

            if not s1_path.exists():
                raise FileNotFoundError(f"Scenario1 raster not found: {s1_path}")
            if not s2_path.exists():
                raise FileNotFoundError(f"Scenario2 raster not found: {s2_path}")

            data1, header1 = read_saga_grid(s1_path, tmp)
            data2, header2 = read_saga_grid(s2_path, tmp)

            if bounds_wgs84 is None:
                bounds_wgs84 = _bounds_to_wgs84(header1)

            nodata1 = header1.get("NODATA_VALUE", NODATA)
            nodata2 = header2.get("NODATA_VALUE", NODATA)
            both_valid = (data1 != nodata1) & (data2 != nodata2)

            nx = header1["CELLCOUNT_X"]
            ny = header1["CELLCOUNT_Y"]
            transform = _build_transform(header1)

            # Per-parcelle stats
            parcelles_stats: list[dict] = []
            total_mask = np.zeros((ny, nx), dtype=bool)

            for fid, geom in features:
                fmask = _feature_mask(geom, nx, ny, transform) & both_valid
                total_mask |= fmask
                stats = _stats_from_mask(data1, data2, fmask)
                parcelles_stats.append({
                    "id": fid,
                    **stats,
                })

            # If no features, use all valid pixels
            if not features:
                total_mask = both_valid

            # Total surface stats
            total_stats = _stats_from_mask(data1, data2, total_mask)

            rasters_result[name] = {
                "label": RASTER_LABELS.get(name, name),
                "parcelles": parcelles_stats,
                "total": total_stats,
            }

            # Generate diff preview PNG
            diff_png_paths[name] = generate_diff_preview(
                data1, data2, both_valid, header1, png_dir, name
            )

    return {
        "rasters": rasters_result,
        "parcelle_ids": parcelle_ids,
        "bounds_wgs84": bounds_wgs84 or {},
        "diff_png_paths": diff_png_paths,
    }
