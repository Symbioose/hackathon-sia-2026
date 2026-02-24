import boto3
import os
from pathlib import Path


def generate_summary(csv_path: str):
    csv_input = _read_csv(csv_path)

    try:
        client = boto3.client(
            service_name="bedrock-runtime",
            region_name=os.getenv("AWS_REGION", "eu-west-1"),
        )
    except Exception:
        return "Une erreur est survenue lors de la génération de la synthèse."

    # Define the model and message
    model_id = os.getenv("AWS_BEDROCK_MODEL_ID", "mistral.mistral-7b-instruct-v0:2")
    messages = [
        {
            "role": "user",
            "content": [{
                "text": f"""
                Tu es un expert en hydrologie, geologie et surtout en érosion en France.

                RÈGLES STRICTES :
                1. Tu utiliseras les informations fournies dans le fichier CSV
                2. Les informations à chercher sont sous format CSV avec des colonnes associées aux variables sur lesquelles tu vas te baser pour faire la synthèse.
                3. Tu identifies automatiquement quelle colonne contient l’information pertinente. Tu associes les variables agronomiques et hydrologiques aux notions qu'il faut synthetiser.
                4. Tu contextualises les données et les relies entre elles.
                5. Tu produis une synthèse claire, structurée, sans hors-sujet.
                6. Si une information n'existe pas dans les fichiers, tu écris : "Information non fournie".
                7. Interdiction d'utiliser des connaissances externes.
                8. Ne pas parler du format CSV
                9. Réponds en français
                10. Voici les noms en français des variables : infiltration, ruissellement, érosion interrill et érosion en rill:
                    - "infiltration": "Capacité d'infiltration du sol (mm)",
                    - "interrill_erosion": "Érosion diffuse (kg)",
                    - "rill_erosion": "Érosion concentrée (kg)",
                    - "surface_runoff": "Ruissellement",


                Fais une description synthétique en 3 phrases maximum de la comparaison entre les deux scénarios d'infiltration, de ruissellement, d'érosion interrill et d'érosion en rill.
                Fais une recommandation du meilleur scénario en fonction de ces éléments.

                Le contenu en format CSV est le suivant :
                {csv_input}

                """
                }]
        }]

    try:
        response = client.converse(
            modelId=model_id,
            messages=messages,
        )
    except Exception:
        return "Une erreur est survenue lors de la génération de la synthèse."

    # Extract the generated text from the response
    if "output" in response and "message" in response["output"]:
        message = response["output"]["message"]
        if "content" in message and len(message["content"]) > 0:
            return message["content"][0].get("text", "")

    return "Une erreur est survenue lors de la génération de la synthèse."


def _read_csv(csv_path: str) -> str:
    """Read a CSV file and return its content as a string."""
    csv_file = Path(csv_path)

    if not csv_file.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    with open(csv_file, "r", encoding="utf-8") as f:
        return f.read()
