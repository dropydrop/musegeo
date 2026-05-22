import os
import json
import datetime
import requests
from sentinelhub import (
    SHConfig,
    SentinelHubStatistical,
    Geometry,
    CRS,
    DataCollection,
    BBox,
    bbox_to_dimensions,
)

# --- CONFIGURATION ---
DATA_DIR = "data"
PARCELLES_GEOJSON = os.path.join(DATA_DIR, "parcelles.geojson")

# Sentinel Hub Credentials (from Environment)
CLIENT_ID = os.environ.get("SH_CLIENT_ID")
CLIENT_SECRET = os.environ.get("SH_CLIENT_SECRET")

config = SHConfig()
if CLIENT_ID and CLIENT_SECRET:
    config.sh_client_id = CLIENT_ID
    config.sh_client_secret = CLIENT_SECRET

# Script Evalscript pour calculer NDVI, NDWI, LAI et filtrer les nuages via SCL
# SCL codes: 8, 9, 10 are clouds/medium/high prob + cirrus
evalscript = """
//VERSION=3
function setup() {
  return {
    input: [{
      bands: ["B03", "B04", "B08", "B11", "SCL"],
      units: "DN"
    }],
    output: [
      { id: "default", bands: 3 },
      { id: "scl", bands: 1 }
    ]
  };
}

function evaluatePixel(samples) {
  let ndvi = (samples.B08 - samples.B04) / (samples.B08 + samples.B04);
  let ndwi = (samples.B03 - samples.B08) / (samples.B03 + samples.B08);
  // LAI simplifié pour Sentinel-2 (approximation empirique)
  let lai = 3.618 * ((samples.B08 - samples.B04) / (samples.B08 + samples.B04)) - 0.118;
  
  return {
    default: [ndvi, ndwi, lai],
    scl: [samples.SCL]
  };
}
"""

def fetch_parcel_data(parcel_id, geometry_data):
    """Appelle l'API Statistical de Sentinel Hub pour une parcelle."""
    
    # Définition de la période (90 derniers jours)
    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=90)
    
    geometry = Geometry(geometry_data, crs=CRS.WGS84)
    
    stats_request = SentinelHubStatistical(
        aggregation=SentinelHubStatistical.aggregation(
            evalscript=evalscript,
            time_interval=(start_date.isoformat(), end_date.isoformat()),
            aggregation_interval="P1D",
            size=(512, 512) # Résolution indicative
        ),
        input_data=[
            SentinelHubStatistical.input_data(DataCollection.SENTINEL2_L2A)
        ],
        geometry=geometry,
        config=config
    )
    
    try:
        data = stats_request.get_data()[0]
        history = []
        
        for entry in data['data']:
            date = entry['interval']['from'].split('T')[0]
            outputs = entry['outputs']['default']['bands']['B0'] # NDVI, NDWI, LAI
            scl_stats = entry['outputs']['scl']['bands']['B0']['stats']
            
            # Cloud filtering logic based on SCL
            # If median SCL is 8, 9 or 10 -> marked as cloud
            is_cloud = False
            if 'median' in scl_stats:
                if scl_stats['median'] in [8, 9, 10]:
                    is_cloud = True
            
            # Extraction des moyennes
            stats = outputs['stats']
            history.append({
                "date": date,
                "ndvi": round(stats['mean'], 3) if not is_cloud else 0.1,
                "ndwi": round(entry['outputs']['default']['bands']['B1']['stats']['mean'], 3) if not is_cloud else 0.05,
                "lai": round(entry['outputs']['default']['bands']['B2']['stats']['mean'], 3) if not is_cloud else 0.2,
                "isCloud": is_cloud
            })
            
        return sorted(history, key=lambda x: x['date'])
    except Exception as e:
        print(f"Error fetching {parcel_id}: {e}")
        return []

def main():
    if not os.path.exists(PARCELLES_GEOJSON):
        print("No parcelles.geojson found.")
        return

    with open(PARCELLES_GEOJSON, 'r') as f:
        geojson = json.load(f)

    for feature in geojson['features']:
        p_id = feature['properties'].get('id') or feature.get('id')
        p_name = feature['properties'].get('name', f"Parcelle {p_id}")
        
        if not p_id: continue
        
        print(f"Processing {p_name} ({p_id})...")
        history = fetch_parcel_data(p_id, feature['geometry'])
        
        if history:
            output_file = os.path.join(DATA_DIR, f"parcelle_{p_id}.json")
            
            # Si le fichier existe déjà, on peut merger (optionnel pour V1)
            parcel_data = {
                "parcelle_id": p_id,
                "nom": p_name,
                "last_update": datetime.datetime.now().isoformat(),
                "historique": history
            }
            
            with open(output_file, 'w') as out:
                json.dump(parcel_data, out, indent=2)
            print(f"Saved {output_file}")

if __name__ == "__main__":
    main()
