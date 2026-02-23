"""Récupère l'emprise (bbox) d'un GeoJSON sans dépendance externe."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import requests


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


def get_emprise(input_path: str | Path, buffer: int = 0) -> dict[str, float]:
    """
    Fonction API: retourne l'emprise globale d'un GeoJSON.

    Args:
        input_path: chemin vers le GeoJSON.
        buffer: marge en metres ajoutee autour de l'emprise (0 par defaut).

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

    if buffer < 0:
        raise ValueError("Le buffer doit etre >= 0.")

    # Agrandit la bbox de 'buffer' metres dans les 4 directions.
    minx -= buffer
    miny -= buffer
    maxx += buffer
    maxy += buffer

    return {"xmin": minx, "ymin": miny, "xmax": maxx, "ymax": maxy}


def main() -> int:
    parser = argparse.ArgumentParser(description="Récupère l'emprise d'un GeoJSON.")
    parser.add_argument("input_json", type=Path, help="Chemin du fichier JSON/GeoJSON")
    parser.add_argument("--buffer", type=int, default=0, help="Buffer en metres autour de la bbox")
    args = parser.parse_args()

    coords = get_emprise(args.input_json, buffer=args.buffer)
    print(coords)
    telecharger_tif_lambert(coords["xmin"],coords["ymin"],coords["xmax"],coords["ymax"])

    return 0



def telecharger_tif_lambert(xmin, ymin, xmax, ymax, fichier_sortie="mnt_final.tif"):
    """
    Prend les 4 coordonnées d'une Bounding Box déjà en Lambert 93 (mètres)
    et télécharge directement le fichier TIF de l'IGN.
    """
    # 1. On calcule la taille de l'image (1 pixel = 1 mètre)
    largeur = int(xmax - xmin)
    hauteur = int(ymax - ymin)
    
    print(f"📏 Zone demandée : {largeur}m x {hauteur}m")
    
    # 2. Paramètres de l'API IGN
    url = "https://data.geopf.fr/wms-r/wms"
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES", # Couche Relief
        "STYLES": "",  # Obligatoire en WMS 1.3.0, même si vide.
        "CRS": "EPSG:2154", # On dit direct à l'IGN : "C'est du Lambert 93"
        "BBOX": f"{xmin},{ymin},{xmax},{ymax}",
        "WIDTH": str(largeur),
        "HEIGHT": str(hauteur),
        "FORMAT": "image/geotiff"
    }

    # 3. On télécharge
    print("📡 Requête envoyée à l'IGN...")
    reponse = requests.get(url, params=params)

    if reponse.status_code == 200:
        if "xml" in reponse.headers.get("Content-Type", ""):
            print("❌ Erreur de l'API IGN :", reponse.text)
        else:
            with open(fichier_sortie, 'wb') as f:
                f.write(reponse.content)
            taille_mo = len(reponse.content) / (1024 * 1024)
            print(f"✅ SUCCÈS ! Fichier {fichier_sortie} récupéré ({taille_mo:.2f} Mo).")
    else:
        print(f"❌ Erreur HTTP {reponse.status_code} : {reponse.text}")

# --- TEST AVEC LES COORDONNÉES DE TON GEOJSON ---
if __name__ == "__main__":
    raise SystemExit(main())
    
