import urllib.request
import urllib.parse
import json
import time
import sys
import os

# Country BBox and Grid Config
COUNTRY_CONFIG = {
    'switzerland': {
        'min_lat': 45.8, 'max_lat': 47.8,
        'min_lon': 5.9, 'max_lon': 10.5,
        'grid_rows': 6, 'grid_cols': 6,
        'name_full': 'Switzerland'
    },
    'france': {
        'min_lat': 41.3, 'max_lat': 51.1,
        'min_lon': -5.1, 'max_lon': 9.6,
        'grid_rows': 20, 'grid_cols': 20, # Extra large grid for France
        'name_full': 'France'
    }
}

# Select country
country_key = sys.argv[1].lower() if len(sys.argv) > 1 else 'switzerland'
if country_key not in COUNTRY_CONFIG:
    print(f"Error: Unknown country '{country_key}'. Available: {', '.join(COUNTRY_CONFIG.keys())}")
    sys.exit(1)

config = COUNTRY_CONFIG[country_key]
print(f"\n--- FeuerMeister Data Fetcher: {config['name_full']} ---")
print(f"BBox: {config['min_lat']},{config['min_lon']} to {config['max_lat']},{config['max_lon']}")
print(f"Grid: {config['grid_rows']}x{config['grid_cols']} ({config['grid_rows'] * config['grid_cols']} tiles)")

all_spots = {}

# Load existing spots for merging (deduplication by ID)
output_file = 'spots.json'
if os.path.exists(output_file):
    try:
        with open(output_file, 'r') as f:
            existing_spots = json.load(f)
            for spot in existing_spots:
                all_spots[spot['id']] = spot
        print(f"Loaded {len(existing_spots)} existing spots from {output_file} for merging.")
    except Exception as e:
        print(f"Warning: Could not load existing spots.json ({e}). Starting fresh.")

def fetch_tile(bbox_str, name):
    query = f"""
    [out:json][timeout:180];
    (
      node["amenity"="bbq"]({bbox_str});
      node["amenity"="firepit"]({bbox_str});
    );
    out body;
    """
    
    servers = [
        "https://lz4.overpass-api.de/api/interpreter",
        "https://overpass-api.de/api/interpreter",
        "https://z.overpass-api.de/api/interpreter"
    ]
    
    for attempt in range(4):
        url = servers[attempt % len(servers)]
        try:
            print(f"  -> Fetching Tile {name} (Attempt {attempt+1}/4) on {url.split('/')[2]}...")
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': query}).encode('utf-8'), 
                                         headers={'User-Agent': 'SwissGrillSnowApp-V4/1.2'})
            with urllib.request.urlopen(req, timeout=190) as response:
                result = json.loads(response.read().decode())
                nodes = [el for el in result.get('elements', []) if el.get('type') == 'node']
                print(f"     Success: Found {len(nodes)} spots.")
                return nodes
        except Exception as e:
            print(f"     Warning: {e}. Waiting 20s before retry...")
            time.sleep(20)
    return []

min_lat, max_lat = config['min_lat'], config['max_lat']
min_lon, max_lon = config['min_lon'], config['max_lon']
rows, cols = config['grid_rows'], config['grid_cols']

lat_step = (max_lat - min_lat) / rows
lon_step = (max_lon - min_lon) / cols

for i in range(rows):
    for j in range(cols):
        s = min_lat + (i * lat_step)
        n = s + lat_step
        w = min_lon + (j * lon_step)
        e = w + lon_step
        bbox_str = f"{s:.6f},{w:.6f},{n:.6f},{e:.6f}"
        name = f"L{i}C{j}"
        
        nodes = fetch_tile(bbox_str, name)
        for node in nodes:
            clean_node = {
                "type": node.get("type"),
                "id": node.get("id"),
                "lat": node.get("lat"),
                "lon": node.get("lon"),
                "tags": node.get("tags", {})
            }
            all_spots[node['id']] = clean_node
        
        # Polite gap only if we have more tiles to fetch
        if i * cols + j < rows * cols - 1:
            print(f"     Cooling down for 5s...")
            time.sleep(5)

# Convert to list and save
spots_list = list(all_spots.values())

with open(output_file, 'w') as f:
    # Minified JSON output for storage efficiency
    json.dump(spots_list, f, separators=(',', ':'))
    
print(f"\nSuccessfully saved {len(spots_list)} total spots to {output_file}.")
print(f"Data is MINIFIED and deduplicated.")
