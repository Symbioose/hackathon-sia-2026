from __future__ import annotations

import os
import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.cors import CORSMiddleware


from dotenv import load_dotenv

from services.bdtopage import BDTOPAGE_DEFAULT_LAYERS, fetch_bdtopage_layers_shapefiles_by_emprise
from services.bdtopo import (
    BDTOPO_OCCUPATION_LAYERS,
    CODE_LU_DEFAULT,
    fetch_bdtopo_occupation_layers_shapefiles,
)
from services.marianne import fetch_monthly_rainfall_average_last_ten_years_from_geojson
from services.mtn import get_emprise, telecharger_tif_lambert
from services.rpg import RPG_DEFAULT_LAYER, fetch_rpg_shapefile_by_emprise


BASE_DIR = Path(__file__).resolve().parent
TMP_DIR = BASE_DIR / "tmp"
OUTPUTS_DIR = BASE_DIR / "outputs"
TMP_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Geo Services API", version="1.0.0")
app.mount("/files", StaticFiles(directory=str(OUTPUTS_DIR)), name="files")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
load_dotenv()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _save_upload(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "zone.geojson").suffix or ".geojson"
    target = TMP_DIR / f"{uuid4().hex}{suffix}"
    with target.open("wb") as f:
        shutil.copyfileobj(upload.file, f)
    return target


def _cleanup_upload(upload: UploadFile, path: Path) -> None:
    try:
        upload.file.close()
    finally:
        path.unlink(missing_ok=True)


def _zip_shapefile_bundle(shp_path: Path, zip_path: Path) -> Path:
    base = shp_path.with_suffix("")
    exts = [".shp", ".shx", ".dbf", ".prj", ".cpg", ".qix", ".sbn", ".sbx"]
    from zipfile import ZIP_DEFLATED, ZipFile

    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zf:
        for ext in exts:
            candidate = base.with_suffix(ext)
            if candidate.exists():
                zf.write(candidate, arcname=candidate.name)
    return zip_path


def _build_bdtopo_layer_selection(layer_names: str | None) -> tuple[dict[str, str], dict[str, int]]:
    if not layer_names:
        return BDTOPO_OCCUPATION_LAYERS, CODE_LU_DEFAULT

    requested_typenames = [v.strip() for v in layer_names.split(",") if v.strip()]
    if not requested_typenames:
        return BDTOPO_OCCUPATION_LAYERS, CODE_LU_DEFAULT

    known_by_typename = {v.lower(): k for k, v in BDTOPO_OCCUPATION_LAYERS.items()}
    unknown = [name for name in requested_typenames if name.lower() not in known_by_typename]
    if unknown:
        allowed = ", ".join(sorted(BDTOPO_OCCUPATION_LAYERS.values()))
        raise HTTPException(
            status_code=400,
            detail=f"Layer(s) inconnue(s): {', '.join(unknown)}. Valeurs autorisees: {allowed}",
        )

    selected_keys: list[str] = []
    for typename in requested_typenames:
        key = known_by_typename[typename.lower()]
        if key not in selected_keys:
            selected_keys.append(key)

    selected_layers = {key: BDTOPO_OCCUPATION_LAYERS[key] for key in selected_keys}
    selected_codes = {key: CODE_LU_DEFAULT[key] for key in selected_keys}
    return selected_layers, selected_codes


@app.post("/mtn/emprise")
def mtn_emprise(
    zone_file: UploadFile = File(...),
    buffer: int = Form(0),
) -> dict:
    zone_path = _save_upload(zone_file)
    try:
        bbox = get_emprise(zone_path, buffer=buffer)
        return {"bbox": bbox}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        _cleanup_upload(zone_file, zone_path)


@app.post("/mtn/download")
def mtn_download(
    zone_file: UploadFile = File(...),
    buffer: int = Form(0),
) -> dict:
    zone_path = _save_upload(zone_file)
    run_id = uuid4().hex
    out_dir = OUTPUTS_DIR / "mtn" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_tif = out_dir / "mnt.tif"

    try:
        bbox = get_emprise(zone_path, buffer=buffer)
        telecharger_tif_lambert(
            bbox["xmin"],
            bbox["ymin"],
            bbox["xmax"],
            bbox["ymax"],
            fichier_sortie=str(out_tif),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        _cleanup_upload(zone_file, zone_path)

    return {
        "bbox": bbox,
        "tif_path": str(out_tif),
        "download_url": f"/files/mtn/{run_id}/mnt.tif",
    }


@app.post("/bdtopage/download")
def bdtopage_download(
    zone_file: UploadFile = File(...),
    buffer: int = Form(0),
    layer_names: str | None = Form(None),
) -> dict:
    zone_path = _save_upload(zone_file)
    run_id = uuid4().hex
    out_dir = OUTPUTS_DIR / "bdtopage" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    requested_layers = (
        [v.strip() for v in layer_names.split(",") if v.strip()]
        if layer_names
        else BDTOPAGE_DEFAULT_LAYERS
    )

    try:
        result = fetch_bdtopage_layers_shapefiles_by_emprise(
            input_path=zone_path,
            layer_names=requested_layers,
            buffer=buffer,
            output_dir=out_dir,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        _cleanup_upload(zone_file, zone_path)

    layers_with_download = {}
    for key, info in result.get("layers", {}).items():
        shp_path = Path(info["shp_path"])
        zip_path = _zip_shapefile_bundle(shp_path, shp_path.parent / f"{shp_path.stem}.zip")
        layers_with_download[key] = {
            **info,
            "zip_path": str(zip_path),
            "download_url": f"/files/bdtopage/{run_id}/{shp_path.parent.name}/{zip_path.name}",
        }

    return {
        "layers": layers_with_download,
        "skipped": result.get("skipped", {}),
    }


@app.post("/bdtopo/download")
def bdtopo_download(
    zone_file: UploadFile = File(...),
    buffer: int = Form(0),
    layer_names: str | None = Form(None),
) -> dict:
    zone_path = _save_upload(zone_file)
    run_id = uuid4().hex
    out_dir = OUTPUTS_DIR / "bdtopo" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    selected_layers, selected_codes = _build_bdtopo_layer_selection(layer_names)

    try:
        result = fetch_bdtopo_occupation_layers_shapefiles(
            input_path=zone_path,
            buffer=buffer,
            output_dir=out_dir,
            layer_map=selected_layers,
            code_lu_map=selected_codes,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        _cleanup_upload(zone_file, zone_path)

    layers_with_download = {}
    for key, info in result.get("layers", {}).items():
        shp_path = Path(info["shp_path"])
        zip_path = _zip_shapefile_bundle(shp_path, shp_path.parent / f"{shp_path.stem}.zip")
        layers_with_download[key] = {
            **info,
            "zip_path": str(zip_path),
            "download_url": f"/files/bdtopo/{run_id}/{shp_path.parent.name}/{zip_path.name}",
        }

    return {
        "bbox": result.get("bbox"),
        "layers": layers_with_download,
        "skipped": result.get("skipped", {}),
    }


@app.post("/rpg/download")
def rpg_download(
    zone_file: UploadFile = File(...),
    buffer: int = Form(0),
    layer_name: str = Form(RPG_DEFAULT_LAYER),
) -> dict:
    zone_path = _save_upload(zone_file)
    run_id = uuid4().hex
    out_dir = OUTPUTS_DIR / "rpg" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        shp_path = fetch_rpg_shapefile_by_emprise(
            input_path=zone_path,
            layer_name=layer_name,
            buffer=buffer,
            output_dir=out_dir,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        _cleanup_upload(zone_file, zone_path)

    zip_path = _zip_shapefile_bundle(Path(shp_path), Path(shp_path).parent / f"{Path(shp_path).stem}.zip")
    return {
        "layer_name": layer_name,
        "shp_path": str(shp_path),
        "zip_path": str(zip_path),
        "download_url": f"/files/rpg/{run_id}/{Path(zip_path).name}",
    }


@app.post("/marianne/rainfall/monthly-average")
def marianne_rainfall_monthly_average_only(
    zone_file: UploadFile = File(...),
    code_departement: str | None = Form(None),
    station_id: str | None = Form(None),
    end_year: int | None = Form(None),
    api_key: str | None = Form(None),
) -> dict:
    result = _compute_marianne_monthly_average(
        zone_file=zone_file,
        code_departement=code_departement,
        station_id=station_id,
        end_year=end_year,
        api_key=api_key,
    )
    return {"monthly_average_mm": result.get("monthly_average_mm", {})}


def _compute_marianne_monthly_average(
    zone_file: UploadFile,
    code_departement: str | None,
    station_id: str | None,
    end_year: int | None,
    api_key: str | None,
) -> dict:
    zone_path = _save_upload(zone_file)
    try:
        result = fetch_monthly_rainfall_average_last_ten_years_from_geojson(
            input_path=zone_path,
            code_departement=code_departement,
            station_id=station_id,
            end_year=end_year,
            api_key=api_key,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        _cleanup_upload(zone_file, zone_path)
    return result


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=True,
    )
