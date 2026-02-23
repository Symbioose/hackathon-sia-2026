from __future__ import annotations

from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

import requests

try:
    # Cas standard: import depuis la racine du projet.
    from backend.services.mtn import get_emprise
except ModuleNotFoundError:
    # Cas local: execution depuis backend/services.
    from mtn import get_emprise


def fetch_bdtopo_occupation_shapefile_by_emprise(
    input_path: str | Path,
    buffer: int = 0,
    layer_name: str = "BDTOPO_V3:zone_de_vegetation",
    service_url: str = "https://data.geopf.fr/wfs/ows",
    srs: str = "EPSG:2154",
    output_dir: str | Path = "bdtopo_occupation_shp",
    timeout: int = 60,
) -> Path:
    """
    Recupere la couche "occupation des sols" de la BD TOPO en Shapefile.

    Args:
        input_path: chemin du GeoJSON de zone d'etude.
        buffer: buffer en metres applique a la bbox.
        layer_name: nom de couche WFS occupation du sol.
        service_url: URL du service WFS BD TOPO.
        srs: projection de travail (par defaut EPSG:2154).
        output_dir: dossier de sortie pour le zip + extraction.
        timeout: timeout HTTP (secondes).

    Returns:
        Chemin du fichier .shp extrait.
    """
    bbox = get_emprise(input_path, buffer=buffer)
    minx, miny, maxx, maxy = bbox["xmin"], bbox["ymin"], bbox["xmax"], bbox["ymax"]

    base_params = {
        "SERVICE": "WFS",
        "VERSION": "1.1.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": layer_name,
        "SRSNAME": srs,
        "BBOX": f"{minx},{miny},{maxx},{maxy},{srs}",
    }

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    zip_path = out_dir / f"{layer_name.replace(':', '_')}.zip"

    declared_formats = _get_wfs_output_formats(service_url=service_url, timeout=timeout)
    preferred_shape_like = [
        fmt for fmt in declared_formats if any(k in fmt.lower() for k in ("shape", "shp", "zip"))
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
        raise RuntimeError(
            f"Echec WFS SHP BD TOPO pour {layer_name}. Derniere erreur: {last_error}"
        )

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

    uniq: list[str] = []
    seen: set[str] = set()
    for value in values:
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        uniq.append(value)
    return uniq
