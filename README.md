# Hackathon SIA 2026 — Outil d'analyse géospatiale agricole

Outil web de diagnostic géospatial destiné aux exploitations agricoles françaises. Il permet d'analyser une zone à partir d'un fichier GeoJSON, de croiser des données publiques (IGN, RPG, Météo-France), et de comparer deux scénarios de simulation de ruissellement et d'érosion avec une synthèse générée par IA.

---

## Architecture

```
hackathon-sia-2026/
├── backend/               # API FastAPI (Python)
│   ├── main.py            # Routeur principal, endpoints REST
│   ├── services/
│   │   ├── mtn.py                 # Téléchargement MNT (GéoPlateforme IGN WCS)
│   │   ├── bdtopo.py              # Occupation des sols (BD TOPO WFS)
│   │   ├── bdtopage.py            # Hydrographie & bassins versants (BD TOPAGE WFS)
│   │   ├── rpg.py                 # Parcelles agricoles (RPG WFS)
│   │   ├── marianne.py            # Données pluviométriques (Météo-France API)
│   │   ├── preview.py             # Conversion raster → PNG, shapefile → GeoJSON
│   │   ├── saga_compare.py        # Comparaison de rasters SAGA (.sg-grd-z)
│   │   └── summary_automation.py  # Synthèse IA via AWS Bedrock
│   ├── examples_geojson/  # Fichiers GeoJSON d'exemple pour tester l'application
│   │   ├── zone_etude.geojson
│   │   └── parcelles_audeville.geojson
│   ├── outputs/           # Fichiers générés (servis via /files)
│   ├── tmp/               # Uploads temporaires (nettoyés automatiquement)
│   ├── requirements.txt
│   └── .env               # Variables d'environnement (non versionné)
│
└── frontend/              # Application React + Vite (TypeScript)
    └── src/
        ├── App.tsx                        # État global, orchestration des appels API
        ├── components/
        │   ├── MapComponent.tsx           # Carte Leaflet avec overlays raster/vecteur
        │   ├── SidePanel.tsx              # Panneau de contrôle (upload, analyses, résultats)
        │   └── ComparisonPanel.tsx        # Onglet comparaison de scénarios
        ├── utils/
        │   ├── geoJsonZone.ts             # Validation et parsing GeoJSON
        │   └── coordinateTransform.ts     # Conversion EPSG:4326 ↔ EPSG:2154
        └── config.ts                      # URL de l'API backend
```

### Flux de données

```
[Utilisateur]
    │  Upload GeoJSON (Lambert-93 EPSG:2154 ou WGS84)
    ▼
[Frontend React]
    │  Validation géométrie + calcul bbox
    │  POST multipart/form-data → http://localhost:8000
    ▼
[Backend FastAPI]
    │  Extraction emprise, appels APIs gouvernementales
    │  Génération fichiers (TIF, ZIP shapefile, PNG, CSV)
    │  Fichiers servis statiquement via /files
    ▼
[Frontend React]
    │  Affichage carte Leaflet (overlays image / vecteur GeoJSON)
    │  Téléchargement résultats
```

---

## Prérequis

- **Python** 3.11+
- **Node.js** 18+
- **GDAL / PROJ** (requis par rasterio — inclus dans la plupart des distributions Python scientifiques)
- Un compte **AWS** avec accès à **Amazon Bedrock** (modèle Mistral activé dans la région choisie)
- Une clé API **Météo-France** (portail Marianne)

---

## Installation

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows : .venv\Scripts\activate
pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

---

## Configuration — Variables d'environnement

Créer le fichier `backend/.env` :

```env
# ── Météo-France (API Marianne) ──────────────────────────────────────────────
# Clé JWT obtenue sur https://portail-api.meteofrance.fr
MARIANNE_API_KEY=<votre_jwt_meteofrance>

# ── AWS Bedrock (synthèse IA) ────────────────────────────────────────────────
# Région AWS où le modèle Bedrock est activé
AWS_REGION=eu-west-1

# ID du modèle Bedrock à utiliser
# Exemples :
#   mistral.mistral-large-2402-v1:0   → meilleure qualité
#   mistral.mistral-7b-instruct-v0:2  → plus rapide, moins coûteux
AWS_BEDROCK_MODEL_ID=mistral.mistral-large-2402-v1:0

# Token Bearer pour l'authentification Bedrock
AWS_BEARER_TOKEN_BEDROCK=<votre_token_bedrock>
```

> Les credentials AWS peuvent aussi être fournis via les variables standard (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) ou via un rôle IAM si déployé sur EC2/ECS.

---

## Lancement

```bash
# Terminal 1 — Backend
cd backend
python main.py
# → http://localhost:8000
# → Documentation Swagger : http://localhost:8000/docs

# Terminal 2 — Frontend
cd frontend
npm run dev
# → http://localhost:5173
```

---

## Fonctionnalités

### Onglet Analyse

1. **Upload d'une zone** — Déposer un fichier GeoJSON (Polygon ou MultiPolygon). La zone peut être en Lambert-93 (EPSG:2154) ou WGS84 (EPSG:4326), la conversion est automatique.
2. **Buffer** — Appliquer un tampon en mètres autour de la zone avant les requêtes.
3. **Sélection des analyses** — Cocher une ou plusieurs analyses parmi :

| Analyse | Source | Format retourné |
|---|---|---|
| MNT (Modèle Numérique de Terrain) | IGN GéoPlateforme WCS | GeoTIFF → PNG overlay |
| Axe de ruissellement | BD TOPAGE WFS | Shapefile ZIP → GeoJSON overlay |
| Occupation des sols | BD TOPO WFS | Shapefile ZIP → GeoJSON overlay |
| Culture (parcelles RPG) | RPG WFS | Shapefile ZIP → GeoJSON overlay |
| Bassin versant | BD TOPAGE WFS | Shapefile ZIP → GeoJSON overlay |
| Données de pluie | Météo-France Marianne | CSV téléchargeable |

4. **Lancement** — Les analyses sont exécutées en parallèle. Les résultats s'affichent sur la carte Leaflet et sont téléchargeables.

### Onglet Comparaison de scénarios

1. **Dépôt des fichiers SAGA** — Glisser-déposer 4 fichiers `.sg-grd-z` par scénario (infiltration, érosion diffuse, érosion concentrée, ruissellement).
2. **Zone optionnelle** — Si une zone a été chargée dans l'onglet Analyse, elle est utilisée pour calculer les statistiques par parcelle.
3. **Résultats** :
   - Tableau détaillé par parcelle avec totaux et variation en %
   - Export CSV de la synthèse
   - **Synthèse IA** — Analyse automatique via AWS Bedrock (Mistral) : citation des chiffres clés et recommandation du meilleur scénario

---

## Endpoints API

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/health` | Vérification de l'état de l'API |
| `POST` | `/mtn/download` | Télécharge le MNT (GeoTIFF) pour la zone |
| `GET` | `/mtn/preview` | Génère un PNG preview du MNT |
| `POST` | `/bdtopage/download` | Télécharge les couches BD TOPAGE |
| `POST` | `/bdtopo/download` | Télécharge les couches BD TOPO |
| `POST` | `/rpg/download` | Télécharge les parcelles RPG |
| `POST` | `/marianne/rainfall/monthly-average` | Calcule les précipitations mensuelles moyennes (10 ans) |
| `GET` | `/shapefile/geojson` | Convertit un ZIP shapefile en GeoJSON WGS84 |
| `POST` | `/scenarios/compare` | Compare deux jeux de rasters SAGA + synthèse IA |
| `GET` | `/files/...` | Accès statique aux fichiers générés |

Documentation interactive complète : `http://localhost:8000/docs`

---

## Format des fichiers SAGA

Les fichiers attendus par `/scenarios/compare` sont au format **SAGA GIS `.sg-grd-z`** — archives ZIP contenant :
- un fichier `.sgrd` (en-tête textuel : dimensions, cellsize, coordonnées d'origine en Lambert-93)
- un fichier `.sdat` (raster binaire float32 little-endian)

Les quatre variables attendues par scénario :

| Clé fichier | Variable |
|---|---|
| `infiltration` | Capacité d'infiltration du sol (mm) |
| `interrill_erosion` | Érosion diffuse (kg) |
| `rill_erosion` | Érosion concentrée (kg) |
| `surface_runoff` | Ruissellement |

---

## Notes de déploiement

- Le dossier `backend/outputs/` grossit avec chaque analyse — prévoir une politique de nettoyage périodique.
- En production, restreindre `allow_origins` dans `main.py` au domaine réel du frontend.
- La synthèse IA ajoute quelques secondes au temps de réponse selon la latence AWS Bedrock. Pour réduire ce délai, utiliser `mistral.mistral-7b-instruct-v0:2` via `AWS_BEDROCK_MODEL_ID`.
- Ajouter `backend/.env` et `backend/outputs/` au `.gitignore` pour éviter de versionner des données sensibles ou volumineuses.
