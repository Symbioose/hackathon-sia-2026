from __future__ import annotations

import csv
import math
import os
import re
import time
from datetime import UTC, datetime
from io import StringIO
from pathlib import Path
from typing import Any

import requests
from rasterio.warp import transform
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

try:
    from backend.services.mtn import get_emprise
except ModuleNotFoundError:
    try:
        from services.mtn import get_emprise
    except ModuleNotFoundError:
        from mtn import get_emprise


BASE_URL = "https://public-api.meteofrance.fr/public/DPClim/v1"
GEOPF_WFS_URL = "https://data.geopf.fr/wfs/ows"
CONNECT_TIMEOUT = 10
READ_TIMEOUT = 120
POLL_SECONDS = 2
POLL_ATTEMPTS = 15


def _session() -> requests.Session:
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


HTTP = _session()


def fetch_monthly_rainfall_average_last_ten_years_from_geojson(
    input_path: str | Path,
    code_departement: str | None = None,
    station_id: str | None = None,
    end_year: int | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    key = _api_key(api_key)
    x, y = _centroid_lambert93(input_path)
    lon, lat = _lambert93_to_wgs84(x, y)

    department = _resolve_department_code(input_path, code_departement, x, y)

    params: dict[str, str] = {"id-departement": department}
    stations = _json_get("/liste-stations/quotidienne", key, params)
    if not isinstance(stations, list) or not stations:
        raise RuntimeError("Aucune station retournee par Meteo-France.")

    station = _pick_station(stations, lon=lon, lat=lat, station_id=station_id)
    station_code = str(station.get("id"))
    station_lon, station_lat = _station_lon_lat(station)

    last_complete_year = datetime.now(UTC).year - 1
    final_year = end_year if end_year is not None else last_complete_year
    first_year = final_year - 9

    monthly_values: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    failed_years: dict[int, str] = {}
    success_years = 0

    for year in range(first_year, final_year + 1):
        try:
            order_payload = _json_get(
                "/commande-station/quotidienne",
                key,
                {
                    "id-station": station_code,
                    "date-deb-periode": f"{year}-01-01T00:00:00Z",
                    "date-fin-periode": f"{year}-12-31T23:59:59Z",
                },
            )
            order_id = _extract_order_id(order_payload)
            csv_text = _download_csv(order_id, key)
            monthly_totals = _parse_monthly_totals(csv_text)
            for month, value in monthly_totals.items():
                monthly_values[month].append(value)
            success_years += 1
        except Exception as exc:
            failed_years[year] = str(exc)

    averages: dict[str, float | None] = {}
    counts: dict[str, int] = {}
    for month in range(1, 13):
        key_month = f"{month:02d}"
        values = monthly_values[month]
        counts[key_month] = len(values)
        averages[key_month] = round(sum(values) / len(values), 2) if values else None

    return {
        "department_code": department,
        "station_id": station_code,
        "station_name": station.get("nom"),
        "station_distance_km": None
        if station_lon is None or station_lat is None
        else round(_distance_km(lon, lat, station_lon, station_lat), 2),
        "period": {
            "start_year": first_year,
            "end_year": final_year,
            "years_requested": 10,
            "years_success": success_years,
            "years_failed": len(failed_years),
        },
        "monthly_average_mm": averages,
        "monthly_years_count": counts,
        "failed_years": failed_years,
    }


def _api_key(provided: str | None) -> str:
    if provided and provided.strip():
        return _normalize_api_key(provided)
    for env_name in ("MARIANNE_API_KEY", "METEOFRANCE_API_KEY"):
        value = os.getenv(env_name)
        if value and value.strip():
            return _normalize_api_key(value)
    raise RuntimeError("Cle API manquante: api_key ou variable d'env.")


def _normalize_api_key(raw_value: str) -> str:
    value = raw_value.strip().strip('"').strip("'")
    if value.lower().startswith("bearer "):
        value = value[7:].strip()
    return value


def _auth_headers(api_key: str) -> dict[str, str]:
    return {
        "accept": "*/*",
        "apikey": api_key,
        "x-api-key": api_key,
        "Authorization": f"Bearer {api_key}",
    }


def _centroid_lambert93(input_path: str | Path) -> tuple[float, float]:
    bbox = get_emprise(input_path, buffer=0)
    x = (bbox["xmin"] + bbox["xmax"]) / 2.0
    y = (bbox["ymin"] + bbox["ymax"]) / 2.0
    return x, y


def _lambert93_to_wgs84(x: float, y: float) -> tuple[float, float]:
    lon, lat = transform("EPSG:2154", "EPSG:4326", [x], [y])
    return float(lon[0]), float(lat[0])


def _resolve_department_code(
    input_path: str | Path,
    provided: str | None,
    x: float,
    y: float,
) -> str:
    if provided and provided.strip():
        normalized = _normalize_department_code(provided)
        if normalized:
            return normalized
        raise RuntimeError(f"code_departement invalide: {provided}")
    return _department_code_from_bdtopo(input_path, x, y)


def _department_code_from_bdtopo(input_path: str | Path, x: float, y: float) -> str:
    del input_path 
    delta = 10.0
    base_params = {
        "SERVICE": "WFS",
        "VERSION": "1.1.0",
        "REQUEST": "GetFeature",
        "TYPENAME": "BDTOPO_V3:departement",
        "SRSNAME": "EPSG:2154",
        "BBOX": f"{x - delta},{y - delta},{x + delta},{y + delta},EPSG:2154",
    }

    last_error = "Aucun resultat"
    for output_format in ("application/json", "json", "geojson"):
        params = {**base_params, "OUTPUTFORMAT": output_format}
        try:
            with HTTP.get(
                GEOPF_WFS_URL,
                params=params,
                timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
            ) as response:
                if response.status_code != 200:
                    last_error = f"HTTP {response.status_code}"
                    continue
                content_type = response.headers.get("Content-Type", "").lower()
                if "xml" in content_type or response.content[:5].lower().startswith(b"<?xml"):
                    last_error = response.text[:250]
                    continue
                payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            last_error = str(exc)
            continue

        code = _extract_department_code_from_payload(payload)
        if code:
            return code

    raise RuntimeError(f"Impossible de determiner le code departement via BDTOPO_V3:departement ({last_error}).")


def _extract_department_code_from_payload(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    features = payload.get("features")
    if not isinstance(features, list):
        return None

    preferred_keys = (
        "CODE_DEPT",
        "CODE_DEP",
        "CODE_DEPARTEMENT",
        "INSEE_DEP",
        "INSEE_DEPT",
        "CODE_INSEE",
        "CODE",
    )
    for feature in features:
        if not isinstance(feature, dict):
            continue
        props = feature.get("properties")
        if not isinstance(props, dict):
            continue
        for key in preferred_keys:
            if key in props:
                normalized = _normalize_department_code(props.get(key))
                if normalized:
                    return normalized
        for value in props.values():
            normalized = _normalize_department_code(value)
            if normalized:
                return normalized
    return None


def _normalize_department_code(raw_value: Any) -> str | None:
    if raw_value is None:
        return None
    value = str(raw_value).strip().upper().replace(" ", "")
    if not value:
        return None
    if value in {"2A", "2B"}:
        return value
    if re.fullmatch(r"\d{1,3}", value):
        return value.zfill(2) if len(value) == 1 else value
    return None


def _json_get(path: str, api_key: str, params: dict[str, str]) -> Any:
    with HTTP.get(
        f"{BASE_URL}{path}",
        params=params,
        headers=_auth_headers(api_key),
        timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
    ) as response:
        if response.status_code not in (200, 202):
            raise RuntimeError(f"Erreur {path} ({response.status_code}): {response.text[:250]}")
        return response.json()


def _pick_station(
    stations: list[Any],
    lon: float,
    lat: float,
    station_id: str | None,
) -> dict[str, Any]:
    valid = [row for row in stations if isinstance(row, dict) and row.get("id") is not None]
    if not valid:
        raise RuntimeError("Aucune station exploitable.")

    if station_id and station_id.strip():
        target = station_id.strip()
        for station in valid:
            if str(station.get("id")) == target:
                return station
        raise RuntimeError(f"Station {target} introuvable.")

    best: dict[str, Any] | None = None
    best_distance = math.inf
    for station in valid:
        s_lon, s_lat = _station_lon_lat(station)
        if s_lon is None or s_lat is None:
            continue
        distance = _distance_km(lon, lat, s_lon, s_lat)
        if distance < best_distance:
            best_distance = distance
            best = station
    if best is None:
        return valid[0]
    return best


def _station_lon_lat(station: dict[str, Any]) -> tuple[float | None, float | None]:
    lon = _to_float(station.get("longitude")) or _to_float(station.get("lon"))
    lat = _to_float(station.get("latitude")) or _to_float(station.get("lat"))
    if lon is not None and lat is not None:
        return lon, lat
    coords = station.get("coordinates")
    if isinstance(coords, list) and len(coords) >= 2:
        return _to_float(coords[0]), _to_float(coords[1])
    return None, None


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", ".")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _distance_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _extract_order_id(payload: Any) -> str:
    if isinstance(payload, (str, int)):
        return str(payload).strip()

    if isinstance(payload, dict):
        cles_possibles = ("return", "id-cmde", "idCmde", "id_commande", "numeroDemande", "id")
        
        for key in cles_possibles:
            val = payload.get(key)
            if val is not None and str(val).strip():
                return str(val).strip()
                
        for sous_structure in payload.values():
            if isinstance(sous_structure, dict):
                for key in cles_possibles:
                    val = sous_structure.get(key)
                    if val is not None and str(val).strip():
                        return str(val).strip()

    raise RuntimeError(f"Identifiant de commande introuvable. Météo-France a renvoyé : {payload}")

def _download_csv(order_id: str, api_key: str) -> str:
    for _ in range(POLL_ATTEMPTS):
        with HTTP.get(
            f"{BASE_URL}/commande/fichier",
            params={"id-cmde": order_id},
            headers=_auth_headers(api_key),
            timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
        ) as response:
            if response.status_code in (200, 201):
                for encoding in ("utf-8-sig", "utf-8", "latin-1"):
                    try:
                        return response.content.decode(encoding)
                    except UnicodeDecodeError:
                        continue
                return response.content.decode("utf-8", errors="replace")
            if response.status_code in (202, 204):
                time.sleep(POLL_SECONDS)
                continue
            raise RuntimeError(f"Erreur commande/fichier ({response.status_code}): {response.text[:250]}")
    raise RuntimeError(f"Commande {order_id} non prete.")

def _parse_monthly_totals(csv_text: str) -> dict[int, float]:
    lignes_propres = [ligne for ligne in csv_text.splitlines() if ligne.strip() and not ligne.startswith("#")]
    
    reader = csv.DictReader(lignes_propres, delimiter=";")
    if reader.fieldnames is None:
        raise RuntimeError("CSV vide ou mal formaté.")

    lowered = {name: name.strip().lower() for name in reader.fieldnames}
    
    date_col = next((name for name, low in lowered.items() if "date" in low or "aaaa" in low or "jour" in low), None)
    
    rain_col = next(
        (name for name, low in lowered.items() if "rr" in low or "precip" in low or "cumul" in low),
        None,
    )
    
    if date_col is None or rain_col is None:
        raise RuntimeError(f"Colonnes introuvables. Météo-France a renvoyé ces colonnes : {list(lowered.keys())}")

    totals: dict[int, float] = {m: 0.0 for m in range(1, 13)}
    rows = 0
    for row in reader:
        raw_date = str(row.get(date_col, "")).strip()
        raw_rain = str(row.get(rain_col, "")).strip().lower()
        
        if not raw_date or not raw_rain or raw_rain in {"mq", "nan", "null"}:
            continue
            
        if raw_rain in {"tr", "trace"}:
            rain = 0.0
        else:
            try:
                rain = float(raw_rain.replace(",", "."))
            except ValueError:
                continue

        month = None
        for token in (raw_date, raw_date[:10]):
            for fmt in ("%Y-%m-%d", "%Y%m%d", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S"):
                try:
                    month = datetime.strptime(token, fmt).month
                    break
                except ValueError:
                    pass
            if month is not None:
                break
        
        if month is None:
            continue

        totals[month] += rain
        rows += 1

    if rows == 0:
        raise RuntimeError("Aucune donnée pluie exploitable dans ce fichier pour cette année.")
        
    return {month: round(value, 3) for month, value in totals.items()}