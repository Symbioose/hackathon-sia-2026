from __future__ import annotations

import json
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import requests

try:
    # Cas standard: import depuis la racine du projet.
    from backend.services.mtn import get_emprise
except ModuleNotFoundError:
    # Cas local: execution depuis backend/services.
    from mtn import get_emprise


def fetch_bdtopage_by_emprise(
    input_path: str | Path,
    layer_name: str = "TronconHydrographique_FXX_Topage2024",
    buffer: int = 0,
    service_url: str = "https://services.sandre.eaufrance.fr/geo/topage2024",
    srs: str = "EPSG:2154",
    output_path: str | Path | None = None,
    timeout: int = 60,
) -> dict[str, Any]:
    """
    Recupere les objets BD Topage dans l'emprise du GeoJSON d'etude.

    Args:
        input_path: chemin vers la zone d'etude GeoJSON.
        layer_name: nom de couche WFS (ex: "CoursEau_FXX").
        buffer: buffer en metres applique sur la bbox.
        service_url: URL du service WFS Topage.
        srs: projection cible de la requete (par defaut EPSG:2154).
        output_path: si renseigne, ecrit le GeoJSON resultat sur disque.
        timeout: timeout HTTP (secondes).

    Returns:
        Un dictionnaire GeoJSON (FeatureCollection).
    """
    bbox = get_emprise(input_path, buffer=buffer)
    minx, miny, maxx, maxy = bbox["xmin"], bbox["ymin"], bbox["xmax"], bbox["ymax"]

    # WFS 1.1.0 est generalement plus stable sur les serveurs SIG institutionnels.
    base_params = {
        "SERVICE": "WFS",
        "VERSION": "1.1.0",
        "REQUEST": "GetFeature",
        "TYPENAME": layer_name,
        "SRSNAME": srs,
        "BBOX": f"{minx},{miny},{maxx},{maxy},{srs}",
    }
    # Certains serveurs WFS refusent certains alias de format.
    candidate_formats = ["application/json", "json", "geojson"]
    geojson: dict[str, Any] | None = None
    last_error = ""

    for output_format in candidate_formats:
        params = {**base_params, "OUTPUTFORMAT": output_format}
        response = requests.get(service_url, params=params, timeout=timeout)

        if response.status_code != 200:
            last_error = f"HTTP {response.status_code}: {response.text}"
            continue

        content_type = response.headers.get("Content-Type", "").lower()
        if "xml" in content_type:
            last_error = response.text
            continue

        try:
            payload = response.json()
        except ValueError:
            last_error = "Reponse non JSON."
            continue

        if isinstance(payload, dict) and payload.get("type") == "FeatureCollection":
            geojson = payload
            break

        last_error = "JSON recu mais format inattendu."

    if geojson is None:
        raise RuntimeError(f"Echec WFS pour {layer_name}. Derniere erreur: {last_error}")

    if output_path is not None:
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(geojson, ensure_ascii=False, indent=2), encoding="utf-8")

    return geojson


def fetch_bdtopage_shapefile_by_emprise(
    input_path: str | Path,
    layer_name: str = "TronconHydrographique_FXX_Topage2024",
    buffer: int = 0,
    service_url: str = "https://services.sandre.eaufrance.fr/geo/topage2024",
    srs: str = "EPSG:2154",
    output_dir: str | Path = "bdtopage_shp",
    timeout: int = 60,
) -> Path:
    """
    Recupere un Shapefile (zip) BD Topage sur l'emprise du GeoJSON, puis l'extrait.

    Returns:
        Chemin du fichier .shp extrait.
    """
    bbox = get_emprise(input_path, buffer=buffer)
    minx, miny, maxx, maxy = bbox["xmin"], bbox["ymin"], bbox["xmax"], bbox["ymax"]

    base_params = {
        "SERVICE": "WFS",
        "VERSION": "1.1.0",
        "REQUEST": "GetFeature",
        "TYPENAME": layer_name,
        "SRSNAME": srs,
        "BBOX": f"{minx},{miny},{maxx},{maxy},{srs}",
    }

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    zip_path = out_dir / f"{layer_name}.zip"

    # Les serveurs WFS varient: on commence par les formats declares par GetCapabilities.
    declared_formats = _get_wfs_output_formats(service_url=service_url, timeout=timeout)
    preferred_shape_like = [
        fmt
        for fmt in declared_formats
        if any(k in fmt.lower() for k in ("shape", "shp", "zip"))
    ]
    fallback_formats = ["shapezip", "shape-zip", "application/zip", "SHAPE-ZIP", "zip"]
    candidate_formats = preferred_shape_like + [
        fmt for fmt in fallback_formats if fmt not in preferred_shape_like
    ]
    last_error = ""

    for output_format in candidate_formats:
        params = {**base_params, "OUTPUTFORMAT": output_format}
        response = requests.get(service_url, params=params, timeout=timeout)

        if response.status_code != 200:
            last_error = f"HTTP {response.status_code}: {response.text}"
            continue

        content_type = response.headers.get("Content-Type", "").lower()
        if "xml" in content_type:
            last_error = response.text
            continue
        if response.content[:5].lower().startswith(b"<?xml"):
            last_error = response.text
            continue

        zip_path.write_bytes(response.content)
        break
    else:
        raise RuntimeError(f"Echec WFS SHP pour {layer_name}. Derniere erreur: {last_error}")

    with ZipFile(zip_path, "r") as zf:
        zf.extractall(out_dir)

    shp_files = list(out_dir.rglob("*.shp"))
    if not shp_files:
        raise RuntimeError(f"Aucun .shp trouve apres extraction de {zip_path}")

    return shp_files[0]


def _get_wfs_output_formats(service_url: str, timeout: int = 30) -> list[str]:
    """Lit les OUTPUTFORMAT disponibles via WFS GetCapabilities."""
    params = {"SERVICE": "WFS", "REQUEST": "GetCapabilities"}
    response = requests.get(service_url, params=params, timeout=timeout)
    if response.status_code != 200:
        return []

    try:
        root = ET.fromstring(response.content)
    except ET.ParseError:
        return []

    values: list[str] = []
    for elem in root.iter():
        tag = elem.tag.lower()
        if tag.endswith("value") and elem.text:
            text = elem.text.strip()
            if text:
                values.append(text)

    # Dedupe en preservant l'ordre.
    uniq: list[str] = []
    seen = set()
    for v in values:
        key = v.lower()
        if key not in seen:
            seen.add(key)
            uniq.append(v)
    return uniq
