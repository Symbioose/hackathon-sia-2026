from __future__ import annotations

import json
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

try:
    # Cas standard: import depuis la racine du projet.
    from backend.services.mtn import get_emprise
except ModuleNotFoundError:
    try:
        # Cas app locale: execution depuis backend.
        from services.mtn import get_emprise
    except ModuleNotFoundError:
        # Cas script local: execution depuis backend/services.
        from mtn import get_emprise


HTTP_CONNECT_TIMEOUT = 10
DEFAULT_SANDRE_WFS = "https://services.sandre.eaufrance.fr/geo/topage2024"
DEFAULT_GEOPF_WFS = "https://data.geopf.fr/wfs/ows"

# CORRECTION : On met les vraies couches Topage ici (et non BDTOPO)
BDTOPAGE_DEFAULT_LAYERS = [
    "TronconHydrographique_FXX_Topage2024",
    "SurfaceHydrographique_FXX_Topage2024",
]


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


def _get_default_service_url(layer_name: str) -> str:
    if layer_name.upper().startswith("BDTOPO_V3:"):
        return DEFAULT_GEOPF_WFS
    return DEFAULT_SANDRE_WFS



def fetch_bdtopage_shapefile_by_emprise(
    input_path: str | Path,
    layer_name: str = "TronconHydrographique_FXX_Topage2024",
    buffer: int = 0,
    service_url: str | None = None,
    srs: str = "EPSG:2154",
    output_dir: str | Path = "bdtopage_shp",
    timeout: int = 60,
) -> Path:
    """
    Récupère un Shapefile (zip) BD Topage sur l'emprise du GeoJSON, puis l'extrait.
    """
    selected_service_url = service_url or _get_default_service_url(layer_name)
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
    zip_path = out_dir / f"{layer_name.replace(':', '_')}.zip"

    declared_formats = _get_wfs_output_formats(service_url=selected_service_url, timeout=timeout)
    preferred_shape_like = [
        fmt for fmt in declared_formats if any(k in fmt.lower() for k in ("shape", "shp", "zip"))
    ]
    fallback_formats = ["shapezip", "shape-zip", "application/zip", "SHAPE-ZIP", "zip"]
    candidate_formats = preferred_shape_like + [
        fmt for fmt in fallback_formats if fmt.lower() not in {p.lower() for p in preferred_shape_like}
    ]

    last_error = ""
    for output_format in candidate_formats:
        params = {**base_params, "OUTPUTFORMAT": output_format}
        try:
            with HTTP_SESSION.get(
                selected_service_url,
                params=params,
                timeout=(HTTP_CONNECT_TIMEOUT, timeout),
            ) as response:
                if response.status_code != 200:
                    last_error = f"HTTP {response.status_code}: {response.text}"
                    continue

                content_type = response.headers.get("Content-Type", "").lower()
                if "xml" in content_type or response.content[:5].lower().startswith(b"<?xml"):
                    last_error = response.text
                    continue

                zip_path.write_bytes(response.content)
        except requests.RequestException as exc:
            last_error = f"Erreur reseau: {exc}"
            continue

        try:
            extracted_paths = _safe_extract_zip(zip_path, out_dir)
        except RuntimeError as exc:
            last_error = str(exc)
            zip_path.unlink(missing_ok=True)
            continue

        shp_files = [p for p in extracted_paths if p.suffix.lower() == ".shp"]
        if shp_files:
            zip_path.unlink(missing_ok=True)
            return shp_files[0]

        last_error = f"Aucun .shp trouve apres extraction de {zip_path}"
        zip_path.unlink(missing_ok=True)

    # Si on arrive ici, tous les formats ont échoué. On affiche la vraie erreur du Sandre !
    raise RuntimeError(f"Echec WFS SHP pour {layer_name}. Dernière erreur Sandre :\n{last_error[:500]}")


def fetch_bdtopage_layers_shapefiles_by_emprise(
    input_path: str | Path,
    layer_names: list[str] | None = None,
    buffer: int = 0,
    output_dir: str | Path = "bdtopage_shp",
    service_url: str | None = None,
    srs: str = "EPSG:2154",
    timeout: int = 60,
) -> dict[str, Any]:
    """
    Telecharge plusieurs couches hydro en Shapefile et retourne un rapport.
    """
    layers = layer_names or BDTOPAGE_DEFAULT_LAYERS
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    downloaded: dict[str, Any] = {}
    skipped: dict[str, Any] = {}

    for layer_name in layers:
        layer_dir = out_dir / layer_name.replace(":", "_")
        layer_dir.mkdir(parents=True, exist_ok=True)
        try:
            shp_path = fetch_bdtopage_shapefile_by_emprise(
                input_path=input_path,
                layer_name=layer_name,
                buffer=buffer,
                service_url=service_url,
                srs=srs,
                output_dir=layer_dir,
                timeout=timeout,
            )
            downloaded[layer_name] = {"shp_path": str(shp_path)}
        except Exception as exc:
            skipped[layer_name] = {"reason": str(exc)}

    return {"layers": downloaded, "skipped": skipped}


# Compat: on garde les anciens noms appeles dans ton terminal.
def fetch_bdtopage_geopackage_by_emprise(*args, **kwargs):  # type: ignore[no-untyped-def]
    return fetch_bdtopage_shapefile_by_emprise(*args, **kwargs)


def fetch_bdtopage_layers_geopackages_by_emprise(*args, **kwargs):  # type: ignore[no-untyped-def]
    return fetch_bdtopage_layers_shapefiles_by_emprise(*args, **kwargs)


def _get_wfs_output_formats(service_url: str, timeout: int = 30) -> list[str]:
    params = {"SERVICE": "WFS", "REQUEST": "GetCapabilities"}
    try:
        response = HTTP_SESSION.get(
            service_url,
            params=params,
            timeout=(HTTP_CONNECT_TIMEOUT, timeout),
        )
    except requests.RequestException:
        return []
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
    seen = set()
    for v in values:
        key = v.lower()
        if key not in seen:
            seen.add(key)
            uniq.append(v)
    return uniq


def _safe_extract_zip(zip_path: Path, out_dir: Path) -> list[Path]:
    out_dir_resolved = out_dir.resolve()
    try:
        with ZipFile(zip_path, "r") as zf:
            members = zf.infolist()
            extracted: list[Path] = []
            for info in members:
                target = (out_dir / info.filename).resolve()
                if out_dir_resolved not in target.parents and target != out_dir_resolved:
                    raise RuntimeError(f"Zip Slip detecte: {info.filename}")
                extracted.append(target)
            zf.extractall(out_dir)
            return extracted
    except BadZipFile as exc:
        raise RuntimeError(f"ZIP corrompu: {zip_path}") from exc
