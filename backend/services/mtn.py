"""Récupère l'emprise (bbox) d'un GeoJSON sans dépendance externe."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def _iter_points(coords):
    """Parcourt récursivement coordinates et yield (x, y)."""
    if not isinstance(coords, list) or not coords:
        return

    # feuille: [x, y] ou [x, y, z]
    if len(coords) >= 2 and isinstance(coords[0], (int, float)) and isinstance(coords[1], (int, float)):
        yield float(coords[0]), float(coords[1])
        return

    for item in coords:
        yield from _iter_points(item)


def _iter_geometries(payload):
    """Yield les géométries GeoJSON depuis FeatureCollection/Feature/Geometry."""
    geo_type = payload.get("type")

    if geo_type == "FeatureCollection":
        for feature in payload.get("features", []):
            if isinstance(feature, dict) and isinstance(feature.get("geometry"), dict):
                yield feature["geometry"]
        return

    if geo_type == "Feature" and isinstance(payload.get("geometry"), dict):
        yield payload["geometry"]
        return

    if isinstance(payload.get("coordinates"), list):
        yield payload


def get_emprise(input_path: str | Path) -> dict[str, float]:
    """
    Fonction API: retourne l'emprise globale d'un GeoJSON.

    Retour:
        {"xmin": float, "ymin": float, "xmax": float, "ymax": float}
    """
    path = Path(input_path)
    with path.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    minx = miny = maxx = maxy = None

    for geom in _iter_geometries(payload):
        coords = geom.get("coordinates")
        if coords is None:
            continue

        for x, y in _iter_points(coords):
            if minx is None:
                minx = maxx = x
                miny = maxy = y
            else:
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)

    if minx is None:
        raise ValueError("Aucune coordonnée valide trouvée dans le fichier.")

    return {"xmin": minx, "ymin": miny, "xmax": maxx, "ymax": maxy}


def main() -> int:
    parser = argparse.ArgumentParser(description="Récupère l'emprise d'un GeoJSON.")
    parser.add_argument("input_json", type=Path, help="Chemin du fichier JSON/GeoJSON")
    args = parser.parse_args()

    print(get_emprise(args.input_json))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
