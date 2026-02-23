from __future__ import annotations

from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile

import requests
import shapefile  # pip install pyshp
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

try:
    # Cas standard: import depuis la racine du projet.
    from backend.services.mtn import get_emprise
except ModuleNotFoundError:
    # Cas local: execution depuis backend/services.
    from mtn import get_emprise

HTTP_CONNECT_TIMEOUT = 10

# J'ai retiré RPG_2024 car l'IGN ne le sert pas sous ce nom sur ce serveur WFS.
BDTOPO_OCCUPATION_LAYERS: dict[str, str] = {
    "BATIMENT": "BDTOPO_V3:batiment",
    "CIMETIERE": "BDTOPO_V3:cimetiere",
    "HAIE": "BDTOPO_V3:haie",
    "SURFACE_HYDROGRAPHIQUE": "BDTOPO_V3:surface_hydrographique",
    "TERRAIN_DE_SPORT": "BDTOPO_V3:terrain_de_sport",
    "TRONCON_DE_ROUTE": "BDTOPO_V3:troncon_de_route",
    "ZONE_DE_VEGETATION": "BDTOPO_V3:zone_de_vegetation",
}

# Ta nomenclature métier parfaite (Land Use)
CODE_LU_DEFAULT: dict[str, int] = {
    "BATIMENT": 14,
    "CIMETIERE": 13,
    "HAIE": 19,
    "SURFACE_HYDROGRAPHIQUE": 20,
    "TERRAIN_DE_SPORT": 13,
    "TRONCON_DE_ROUTE": 16,
    "ZONE_DE_VEGETATION": 19,
}

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

def fetch_bdtopo_occupation_layers_shapefiles(
    input_path: str | Path,
    buffer: int = 0,
    output_dir: str | Path = "bdtopo_occupation_shp",
    service_url: str = "https://data.geopf.fr/wfs/ows",
    srs: str = "EPSG:2154",
    timeout: int = 60,
    layer_map: dict[str, str] | None = None,
    code_lu_map: dict[str, int] | None = None,
) -> dict[str, Any]:
    """
    Télécharge les couches d'occupation du sol BD TOPO en Shapefile
    et ajoute un champ CODE_LU dans chaque ligne du DBF.
    """
    selected_layers = layer_map or BDTOPO_OCCUPATION_LAYERS
    selected_codes = code_lu_map or CODE_LU_DEFAULT

    bbox = get_emprise(input_path, buffer=buffer)
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        available_typenames = _get_wfs_feature_type_names(service_url=service_url, timeout=timeout)
    except requests.RequestException:
        available_typenames = []
        
    result_layers: dict[str, Any] = {}
    skipped_layers: dict[str, Any] = {}

    for layer_key, typename in selected_layers.items():
        code_lu = selected_codes.get(layer_key, 0)
        layer_dir = out_dir / layer_key.lower()
        layer_dir.mkdir(parents=True, exist_ok=True)

        shp_path = None
        last_error = ""
        for candidate in _resolve_typename_candidates(typename, available_typenames):
            try:
                shp_path = _download_layer_shapefile(
                    typename=candidate,
                    bbox=bbox,
                    out_dir=layer_dir,
                    service_url=service_url,
                    srs=srs,
                    timeout=timeout,
                )
                typename = candidate
                break
            except RuntimeError as exc:
                last_error = str(exc)
                continue

        if shp_path is None:
            skipped_layers[layer_key] = {"typename": typename, "reason": last_error or "Layer introuvable"}
            continue

        try:
            _set_code_lu_field(shp_path, code_lu)
            result_layers[layer_key] = {
                "typename": typename,
                "code_lu": code_lu,
                "shp_path": str(shp_path),
            }
        except Exception as e:
            skipped_layers[layer_key] = {"typename": typename, "reason": f"Erreur lors de l'ajout du CODE_LU : {e}"}

    return {"bbox": bbox, "layers": result_layers, "skipped": skipped_layers}


def _download_layer_shapefile(
    typename: str,
    bbox: dict[str, float],
    out_dir: Path,
    service_url: str,
    srs: str,
    timeout: int,
) -> Path:
    minx, miny, maxx, maxy = bbox["xmin"], bbox["ymin"], bbox["xmax"], bbox["ymax"]

    base_params = {
        "SERVICE": "WFS",
        "VERSION": "1.1.0",
        "REQUEST": "GetFeature",
        "TYPENAME": typename,
        "SRSNAME": srs,
        "BBOX": f"{minx},{miny},{maxx},{maxy},{srs}",
    }

    declared_formats = _get_wfs_output_formats(service_url=service_url, timeout=timeout)
    preferred_shape_like = [
        fmt for fmt in declared_formats if any(k in fmt.lower() for k in ("shape", "shp", "zip"))
    ]
    fallback_formats = ["shapezip", "shape-zip", "application/zip", "SHAPE-ZIP", "zip"]
    candidate_formats = preferred_shape_like + [
        fmt for fmt in fallback_formats if fmt.lower() not in {f.lower() for f in preferred_shape_like}
    ]

    zip_path = out_dir / f"{typename.replace(':', '_')}.zip"
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

        last_error = f"Aucun .shp trouve apres extraction pour {typename}"
        zip_path.unlink(missing_ok=True)
    raise RuntimeError(f"Echec WFS SHP pour {typename}. Derniere erreur: {last_error[:200]}")


def _set_code_lu_field(shp_path: Path, code_lu: int) -> None:
    """
    Ajoute (ou met à jour) le champ CODE_LU dans le fichier .dbf du shapefile.
    """
    reader = _open_shapefile_reader_with_fallback(shp_path)
    writer: shapefile.Writer | None = None
    tmp_base = shp_path.with_name(f"{shp_path.stem}_tmp")

    try:
        original_fields = reader.fields[1:]  # on ignore le DeletionFlag
        field_names = [f[0] for f in original_fields]
        has_code_lu = "CODE_LU" in field_names
        code_idx = field_names.index("CODE_LU") if has_code_lu else -1

        writer = shapefile.Writer(str(tmp_base), shapeType=reader.shapeType)
        writer.autoBalance = 1

        for name, field_type, size, dec in original_fields:
            writer.field(name, field_type, size, dec)
        if not has_code_lu:
            writer.field("CODE_LU", "N", 10, 0)

        for shape_record in reader.iterShapeRecords():
            values = list(shape_record.record)
            if has_code_lu:
                values[code_idx] = int(code_lu)
            else:
                values.append(int(code_lu))
            writer.shape(shape_record.shape)
            writer.record(*values)
    except Exception:
        if writer is not None:
            try:
                writer.close()
            except Exception:
                pass
        try:
            reader.close()
        except Exception:
            pass
        for ext in (".shp", ".shx", ".dbf"):
            tmp_base.with_suffix(ext).unlink(missing_ok=True)
        raise
    else:
        writer.close()
        reader.close()
        for ext in (".shp", ".shx", ".dbf"):
            tmp_file = tmp_base.with_suffix(ext)
            if tmp_file.exists():
                tmp_file.replace(shp_path.with_suffix(ext))

def _open_shapefile_reader_with_fallback(shp_path: Path) -> shapefile.Reader:
    last_exc: Exception | None = None
    for encoding in ("utf-8", "latin1", "cp1252"):
        reader: shapefile.Reader | None = None
        try:
            reader = shapefile.Reader(str(shp_path), encoding=encoding)
            _ = next(reader.iterRecords(), None)
            return reader
        except (UnicodeDecodeError, shapefile.ShapefileException) as exc:
            last_exc = exc
            if reader is not None:
                reader.close()
            continue
    raise RuntimeError(f"Impossible de lire le DBF (encodage inconnu) pour {shp_path}") from last_exc


def _safe_extract_zip(zip_path: Path, out_dir: Path) -> list[Path]:
    out_dir_resolved = out_dir.resolve()
    try:
        with ZipFile(zip_path, "r") as zf:
            extracted: list[Path] = []
            for info in zf.infolist():
                target = (out_dir / info.filename).resolve()
                if out_dir_resolved not in target.parents and target != out_dir_resolved:
                    raise RuntimeError(f"Zip Slip detecte: {info.filename}")
                extracted.append(target)
            zf.extractall(out_dir)
            return extracted
    except BadZipFile as exc:
        raise RuntimeError(f"Le serveur n'a pas renvoye un zip valide pour {zip_path.name}") from exc


def _get_wfs_output_formats(service_url: str, timeout: int = 30) -> list[str]:
    params = {"SERVICE": "WFS", "REQUEST": "GetCapabilities"}
    try:
        response = HTTP_SESSION.get(service_url, params=params, timeout=(HTTP_CONNECT_TIMEOUT, timeout))
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
            if elem.text.strip():
                values.append(elem.text.strip())
    return list(dict.fromkeys(values))


def _get_wfs_feature_type_names(service_url: str, timeout: int = 30) -> list[str]:
    params = {"SERVICE": "WFS", "REQUEST": "GetCapabilities"}
    try:
        response = HTTP_SESSION.get(service_url, params=params, timeout=(HTTP_CONNECT_TIMEOUT, timeout))
    except requests.RequestException:
        return []
    if response.status_code != 200:
        return []
    try:
        root = ET.fromstring(response.content)
    except ET.ParseError:
        return []
    names: list[str] = []
    for elem in root.iter():
        tag = elem.tag.lower()
        if tag.endswith("name") and elem.text:
            if ":" in elem.text.strip():
                names.append(elem.text.strip())
    return list(dict.fromkeys(names))


def _resolve_typename_candidates(typename: str, available_names: list[str]) -> list[str]:
    base = typename.strip()
    if not available_names:
        return [base]
    lower_base = base.lower()
    candidates = [base]
    for name in available_names:
        if name.lower() == lower_base and name not in candidates:
            candidates.append(name)
    if ":" not in base:
        for name in available_names:
            if name.lower().endswith(f":{lower_base}") and name not in candidates:
                candidates.append(name)
    for name in available_names:
        if lower_base in name.lower() and name not in candidates:
            candidates.append(name)
    return candidates
