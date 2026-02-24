import os
import boto3
import sys

def generate_summary():
    input =   """
    {
        "metadata": {
            "description": "Comparison of two scenarios across different parcelles/points",
            "generated_at": "2026-02-24"
        },
        "scenarios": {
            "infiltration_mm": {
            "unit": "mm",
            "name": "Infiltration",
            "parcelles": [
            T {
                "id": "7219863",
                "scenario_1": 26.056127,
                "scenario_2": 28.084492,
                "difference_percent": 8
                },
                {
                "id": "8726328",
                "scenario_1": 26.191769,
                "scenario_2": 27.882703,
                "difference_percent": 6
                },
                {
                "id": "8838634",
                "scenario_1": 25.95931,
                "scenario_2": 26.330162,
                "difference_percent": 1
                },
                {
                "id": "Total surface",
                "scenario_1": 78.207206,
                "scenario_2": 82.297357,
                "difference_percent": 5
                }
            ]
            },
            "surface_runoff_m3": {
            "unit": "m³",
            "name": "Surface runoff",
            "parcelles": [
                {
                "id": "7219863",
                "scenario_1": 1230529.48,
                "scenario_2": 1131523.74,
                "difference_percent": -8
                },
                {
                "id": "8726328",
                "scenario_1": 181870.891,
                "scenario_2": 98269.3789,
                "difference_percent": -46
                },
                {
                "id": "8838634",
                "scenario_1": 645715.397,
                "scenario_2": 567256.382,
                "difference_percent": -12
                },
                {
                "id": "Total surface",
                "scenario_1": 2058115.76,
                "scenario_2": 1797052.1,
                "difference_percent": -13
                }
            ]
            },
            "interrill_erosion_kg": {
            "unit": "kg",
            "name": "Interrill erosion",
            "parcelles": [
                {
                "id": "7219863",
                "scenario_1": 1043.03518,
                "scenario_2": 672.350365,
                "difference_percent": -36
                },
                {
                "id": "8726328",
                "scenario_1": 738.309105,
                "scenario_2": 597.858406,
                "difference_percent": -19
                },
                {
                "id": "8838634",
                "scenario_1": 597.565235,
                "scenario_2": 557.480808,
                "difference_percent": -7
                },
                {
                "id": "Total surface",
                "scenario_1": 2378.90952,
                "scenario_2": 1827.68958,
                "difference_percent": -23
                }
            ]
            },
            "rill_erosion_kg": {
            "unit": "kg",
            "name": "Rill erosion",
            "parcelles": [
                {
                "id": "7219863",
                "scenario_1": 5987.95091,
                "scenario_2": 4555.3554,
                "difference_percent": -24
                },
                {
                "id": "8726328",
                "scenario_1": 1380.81947,
                "scenario_2": 0,
                "difference_percent": -100
                },
                {
                "id": "8838634",
                "scenario_1": 3859.6409,
                "scenario_2": 3607.94076,
                "difference_percent": -7
                },
                {
                "id": "Total surface",
                "scenario_1": 11228.4113,
                "scenario_2": 8163.29616,
                "difference_percent": -27
                }
            ]
            }
        }
    }
    """
        
    client = boto3.client(
        service_name="bedrock-runtime",
        region_name="eu-west-1" # If you've configured a default region, you can omit this line
    )
    
    # Define the model and message
    model_id = "anthropic.claude-3-haiku-20240307-v1:0"
    messages = [
    {
        "role": "user",
        "content": [{
            "text": """
            Tu es un expert en hydrologie, geologie et surtout en érosion en france uniquement.

            RÈGLES STRICTES :
            1. Tu n'utilises QUE les informations contenues dans les fichiers fournis. 
            2. Les informations à chercher sont sous format geojson et ont des colonnes associées aux variables sur lesquels tu vas te baser pour faire la synthèse.
            2. Tu identifies automatiquement quel fichier contient l’information pertinente. Tu associes les variables agronomiques et hydrologiques aux notion qu'il faut synthetiser.
            3. Tu comprends chaque fichier selon son format.
            4. Tu contextualises les données et les relies entre elles.
            5. Tu produis une synthèse claire, structurée, sans hors-sujet.
            6. Si une information n'existe pas dans les fichiers, tu écris : "Information non fournie".
            7. Interdiction d'utiliser des connaissances externes.

            Le contenu des fichiers est fourni ci-dessous :
            {input}
            """
            }]
    },
    {
        "role": "user",
        "content": [{
            "text": "Fais une description synthétique et précise basée UNIQUEMENT sur les fichiers fournis."
        }]
    }]
    
    response = client.converse(
        modelId=model_id,
        messages=messages,
    )
    
if __name__ == '__main__':
    globals()[sys.argv[1]]()