import os
from pathlib import Path

import requests


def generate_summary(csv_path: str) -> str:
    csv_input = _read_csv(csv_path)

    token = os.getenv("AWS_BEARER_TOKEN_BEDROCK", "")
    if not token:
        return "Erreur : clé API Bedrock manquante (AWS_BEARER_TOKEN_BEDROCK)."

    region = os.getenv("AWS_REGION", "eu-west-1")
    model_id = os.getenv("AWS_BEDROCK_MODEL_ID", "mistral.mistral-large-2402-v1:0")

    url = f"https://bedrock-runtime.{region}.amazonaws.com/model/{model_id}/converse"

    body = {
        "messages": [
            {
                "role": "user",
                "content": [{
                    "text": f"""Tu es un expert en érosion des sols. Analyse uniquement les données suivantes, sans aucune connaissance externe.

Variables (noms CSV → français) :
- infiltration → Infiltration (mm)
- interrill_erosion → Érosion diffuse (kg)
- rill_erosion → Érosion concentrée (kg)
- surface_runoff → Ruissellement

Instructions :
- Pour chaque variable, cite les totaux des deux scénarios et la variation en % exactement tels qu'ils apparaissent dans les données.
- Conclus en 1 phrase sur quel scénario est le meilleur et pourquoi, en te basant uniquement sur les chiffres.
- Sois direct, pas d'introduction, pas de conclusion générale, pas de blabla.
- Réponds en français.

Données :
{csv_input}
"""
                }]
            }
        ],
        "inferenceConfig": {"maxTokens": 350},
    }

    try:
        resp = requests.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
            json=body,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        return f"Erreur appel Bedrock : {exc}"

    if "output" in data and "message" in data["output"]:
        message = data["output"]["message"]
        if "content" in message and len(message["content"]) > 0:
            return message["content"][0].get("text", "").strip()

    return "Erreur : réponse inattendue de Bedrock."


def _read_csv(csv_path: str) -> str:
    """Read a CSV file and return its content as a string."""
    csv_file = Path(csv_path)

    if not csv_file.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    with open(csv_file, "r", encoding="utf-8") as f:
        return f.read()
