from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from zipfile import BadZipFile, ZipFile

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

try:
    from backend.services.mtn import get_emprise
except ModuleNotFoundError:
    try:
        from services.mtn import get_emprise
    except ModuleNotFoundError:
        from mtn import get_emprise


RPG_DEFAULT_LAYER = "RPG.LATEST:parcelles_graphiques"
RPG_DEFAULT_WFS_URL = "https://data.geopf.fr/wfs/ows"
HTTP_CONNECT_TIMEOUT = 10


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


def fetch_rpg_shapefile_by_emprise(
    input_path: str | Path,
    layer_name: str = RPG_DEFAULT_LAYER,
    buffer: int = 0,
    service_url: str = RPG_DEFAULT_WFS_URL,
    srs: str = "EPSG:2154",
    output_dir: str | Path = "rpg_shp",
    timeout: int = 60,
) -> Path:
    """
    Telecharge la couche RPG en Shapefile (zip) sur l'emprise du GeoJSON.
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
    zip_path = out_dir / f"{layer_name.replace(':', '_')}.zip"

    declared_formats = _get_wfs_output_formats(service_url=service_url, timeout=timeout)
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
                service_url,
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

    raise RuntimeError(f"Echec WFS SHP pour {layer_name}. Derniere erreur: {last_error[:500]}")


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
    seen: set[str] = set()
    for value in values:
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        uniq.append(value)
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


def fetch_rpg_geopackage_by_emprise(*args: Any, **kwargs: Any) -> Path:
    return fetch_rpg_shapefile_by_emprise(*args, **kwargs)
