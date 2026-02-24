import boto3
import os
from pathlib import Path


def generate_summary(csv_path: str) -> str:
    csv_input = _read_csv(csv_path)

    try:
        client = boto3.client(
            service_name="bedrock-runtime",
            region_name=os.getenv("AWS_REGION", "eu-west-1"),
        )
    except Exception:
        return "Une erreur est survenue lors de la génération de la synthèse."

    model_id = os.getenv("AWS_BEDROCK_MODEL_ID", "mistral.mistral-7b-instruct-v0:2")
    messages = [
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
    ]

    try:
        response = client.converse(
            modelId=model_id,
            messages=messages,
            inferenceConfig={"maxTokens": 350},
        )
    except Exception:
        return "Une erreur est survenue lors de la génération de la synthèse."

    if "output" in response and "message" in response["output"]:
        message = response["output"]["message"]
        if "content" in message and len(message["content"]) > 0:
            return message["content"][0].get("text", "").strip()

    return "Une erreur est survenue lors de la génération de la synthèse."


def _read_csv(csv_path: str) -> str:
    """Read a CSV file and return its content as a string."""
    csv_file = Path(csv_path)

    if not csv_file.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    with open(csv_file, "r", encoding="utf-8") as f:
        return f.read()
