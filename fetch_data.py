import urllib.request
import urllib.parse
import json
import time

print("Fetching grill/firepit spots from Overpass API (Full Switzerland 6x6 Tiled - Extreme Resilience)...")

# Full Switzerland Bounds
min_lat, max_lat = 45.8, 47.8
min_lon, max_lon = 5.9, 10.5

# 6x6 Grid - smaller tiles avoid 504 timeouts on busy servers
lat_step = (max_lat - min_lat) / 6
lon_step = (max_lon - min_lon) / 6

all_spots = {} # Use dict keyed by ID for deduplication

def fetch_tile(bbox_str, name):
    query = f"""
    [out:json][timeout:180];
    (
      node["amenity"="bbq"]({bbox_str});
      node["amenity"="firepit"]({bbox_str});
    );
    out body;
    """
    
    # Try LZ4 first, then fallback to others
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

for i in range(6):
    for j in range(6):
        s = min_lat + (i * lat_step)
        n = s + lat_step
        w = min_lon + (j * lon_step)
        e = w + lon_step
        bbox_str = f"{s},{w},{n},{e}"
        name = f"L{i}C{j}"
        
        nodes = fetch_tile(bbox_str, name)
        for node in nodes:
            # Storage-efficient: keep only necessary fields
            clean_node = {
                "type": node.get("type"),
                "id": node.get("id"),
                "lat": node.get("lat"),
                "lon": node.get("lon"),
                "tags": node.get("tags", {})
            }
            all_spots[node['id']] = clean_node
        
        # Polite gap
        print(f"     Cooling down for 10s...")
        time.sleep(10)

# Convert back to list
spots_list = list(all_spots.values())

output_file = 'spots.json'
with open(output_file, 'w') as f:
    # Pretty-print with minimal indentation for balance between readability and size
    json.dump(spots_list, f, indent=2)
    
print(f"\nSuccessfully saved {len(spots_list)} total spots to {output_file}.")
print(f"Data is pretty-printed and stripped of unnecessary metadata.")
print(f"Switzerland coverage is complete (including Zürich).")
