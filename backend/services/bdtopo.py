from __future__ import annotations

import os
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile

import requests
import shapefile

try:
    # Cas standard: import depuis la racine du projet.
    from backend.services.mtn import get_emprise
except ModuleNotFoundError:
    # Cas local: execution depuis backend/services.
    from mtn import get_emprise


BDTOPO_OCCUPATION_LAYERS: dict[str, str] = {
    "BATIMENT": "BDTOPO_V3:batiment",
    "CIMETIERE": "BDTOPO_V3:cimetiere",
    "HAIE": "BDTOPO_V3:haie",
    "RPG_2024": "RPG_2024",
    "SURFACE_HYDROGRAPHIQUE": "BDTOPO_V3:surface_hydrographique",
    "TERRAIN_DE_SPORT": "BDTOPO_V3:terrain_de_sport",
    "TRONCON_DE_ROUTE": "BDTOPO_V3:troncon_de_route",
    "TRONCON_HYDROGRAPHIQUE": "BDTOPO_V3:troncon_hydrographique",
    "ZONE_DE_VEGETATION": "BDTOPO_V3:zone_de_vegetation",
}

CODE_LU_DEFAULT: dict[str, int] = {
    "BATIMENT": 1,
    "CIMETIERE": 2,
    "HAIE": 3,
    "RPG_2024": 4,
    "SURFACE_HYDROGRAPHIQUE": 5,
    "TERRAIN_DE_SPORT": 6,
    "TRONCON_DE_ROUTE": 7,
    "TRONCON_HYDROGRAPHIQUE": 8,
    "ZONE_DE_VEGETATION": 9,
}


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
    Telecharge les couches d'occupation du sol BD TOPO en Shapefile
    et ajoute un champ CODE_LU dans chaque ligne.

    Returns:
        {
          "bbox": {...},
          "layers": {
            "BATIMENT": {
              "typename": "...",
              "code_lu": 1,
              "shp_path": "..."
            },
            ...
          }
        }
    """
    selected_layers = layer_map or BDTOPO_OCCUPATION_LAYERS
    selected_codes = code_lu_map or CODE_LU_DEFAULT

    bbox = get_emprise(input_path, buffer=buffer)
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    available_typenames = _get_wfs_feature_type_names(service_url=service_url, timeout=timeout)
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

        _set_code_lu_field(shp_path, code_lu)

        result_layers[layer_key] = {
            "typename": typename,
            "code_lu": code_lu,
            "shp_path": str(shp_path),
        }

    return {"bbox": bbox, "layers": result_layers, "skipped": skipped_layers}


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
    Compat mono-couche: telecharge une couche BD TOPO en Shapefile.
    """
    bbox = get_emprise(input_path, buffer=buffer)
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    return _download_layer_shapefile(
        typename=layer_name,
        bbox=bbox,
        out_dir=out_dir,
        service_url=service_url,
        srs=srs,
        timeout=timeout,
    )


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
        response = requests.get(service_url, params=params, timeout=timeout)

        if response.status_code != 200:
            last_error = f"HTTP {response.status_code}: {response.text}"
            continue

        content_type = response.headers.get("Content-Type", "").lower()
        if "xml" in content_type or response.content[:5].lower().startswith(b"<?xml"):
            last_error = response.text
            continue

        zip_path.write_bytes(response.content)
        break
    else:
        raise RuntimeError(f"Echec WFS SHP pour {typename}. Derniere erreur: {last_error}")

    try:
        with ZipFile(zip_path, "r") as zf:
            zf.extractall(out_dir)
    except BadZipFile as exc:
        raise RuntimeError(f"Le serveur n'a pas renvoye un zip valide pour {typename}") from exc

    shp_files = sorted(out_dir.glob("*.shp"))
    if not shp_files:
        shp_files = sorted(out_dir.rglob("*.shp"))
    if not shp_files:
        raise RuntimeError(f"Aucun .shp trouve apres extraction pour {typename}")

    return shp_files[0]


def _set_code_lu_field(shp_path: Path, code_lu: int) -> None:
    """
    Ajoute (ou met a jour) le champ CODE_LU dans un shapefile.
    """
    reader = _open_shapefile_reader_with_fallback(shp_path)
    original_fields = reader.fields[1:]  # sans DeletionFlag
    field_names = [f[0] for f in original_fields]
    has_code_lu = "CODE_LU" in field_names
    code_idx = field_names.index("CODE_LU") if has_code_lu else -1

    tmp_base = shp_path.with_name(f"{shp_path.stem}_tmp")
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

    writer.close()
    reader.close()

    for ext in (".shp", ".shx", ".dbf"):
        os.replace(f"{tmp_base}{ext}", f"{shp_path.with_suffix(ext)}")


def _open_shapefile_reader_with_fallback(shp_path: Path) -> shapefile.Reader:
    """
    Ouvre un shapefile avec fallback d'encodage DBF.
    """
    last_exc: Exception | None = None
    for encoding in ("utf-8", "latin1", "cp1252"):
        try:
            reader = shapefile.Reader(str(shp_path), encoding=encoding)
            # Force une lecture d'un record pour valider l'encodage choisi.
            _ = next(reader.iterRecords(), None)
            return reader
        except UnicodeDecodeError as exc:
            last_exc = exc
            try:
                reader.close()
            except Exception:
                pass
            continue

    raise RuntimeError(f"Impossible de lire le DBF (encodage inconnu) pour {shp_path}") from last_exc


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


def _get_wfs_feature_type_names(service_url: str, timeout: int = 30) -> list[str]:
    """Lit les noms de couche (FeatureType Name) via WFS GetCapabilities."""
    params = {"SERVICE": "WFS", "REQUEST": "GetCapabilities"}
    response = requests.get(service_url, params=params, timeout=timeout)
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
            value = elem.text.strip()
            if ":" in value:
                names.append(value)

    uniq: list[str] = []
    seen: set[str] = set()
    for value in names:
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        uniq.append(value)
    return uniq


def _resolve_typename_candidates(typename: str, available_names: list[str]) -> list[str]:
    """
    Retourne des candidats de typename, en essayant de retrouver le namespace si absent.
    """
    base = typename.strip()
    if not available_names:
        return [base]

    lower_base = base.lower()
    candidates = [base]

    # Match exact (insensible a la casse)
    for name in available_names:
        if name.lower() == lower_base and name not in candidates:
            candidates.append(name)

    # Si pas de namespace, tenter ':nom'
    if ":" not in base:
        for name in available_names:
            if name.lower().endswith(f":{lower_base}") and name not in candidates:
                candidates.append(name)

    # Match partiel (utile pour RPG_2024)
    for name in available_names:
        if lower_base in name.lower() and name not in candidates:
            candidates.append(name)

    return candidates
