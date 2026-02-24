from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


HTTP_CONNECT_TIMEOUT = 10
HTTP_READ_TIMEOUT = 180
DOWNLOAD_CHUNK_SIZE = 1024 * 1024


def _build_http_session() -> requests.Session:
    retry = Retry(
        total=5,
        connect=5,
        read=5,
        status=5,
        backoff_factor=0.7,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session = requests.Session()
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


HTTP_SESSION = _build_http_session()

def _iter_points(coords):
    """Parcourt récursivement coordinates et yield (x, y)."""
    if not isinstance(coords, list) or not coords:
        return

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


def _validate_epsg_2154(payload: dict[str, Any]) -> None:
    """
    Verifie que le CRS est EPSG:2154 quand l'info CRS est presente.
    """
    crs_obj = payload.get("crs")
    if not isinstance(crs_obj, dict):
        return

    props = crs_obj.get("properties")
    if not isinstance(props, dict):
        return

    name = str(props.get("name", "")).strip()
    if name and "2154" not in name:
        raise ValueError(f"CRS non supporte: {name}. Attendu EPSG:2154.")


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
    if not isinstance(payload, dict):
        raise ValueError("Le fichier doit contenir un objet GeoJSON.")

    _validate_epsg_2154(payload)

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
    largeur = max(1, int(round(xmax - xmin)))
    hauteur = max(1, int(round(ymax - ymin)))
    
    print(f"📏 Zone demandée : {largeur}m x {hauteur}m")
    
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

    print("📡 Requête envoyée à l'IGN...")
    output_path = Path(fichier_sortie)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with HTTP_SESSION.get(
        url,
        params=params,
        timeout=(HTTP_CONNECT_TIMEOUT, HTTP_READ_TIMEOUT),
        stream=True,
    ) as reponse:
        if reponse.status_code != 200:
            raise RuntimeError(f"Erreur HTTP {reponse.status_code} : {reponse.text}")

        if "xml" in reponse.headers.get("Content-Type", "").lower():
            raise RuntimeError(f"Erreur de l'API IGN : {reponse.text}")

        with output_path.open("wb") as f:
            for chunk in reponse.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE):
                if chunk:
                    f.write(chunk)

    taille_mo = output_path.stat().st_size / (1024 * 1024)
    print(f"✅ SUCCÈS ! Fichier {fichier_sortie} récupéré ({taille_mo:.2f} Mo).")
    return str(output_path)

if __name__ == "__main__":
    raise SystemExit(main())
    
