import urllib.request
import urllib.parse
import json

print("Fetching grill/firepit spots from Overpass API (Central Switzerland)...")

# Smaller bounding box for central CH avoids 504 timeouts on free servers
bbox = "46.5,7.0,47.2,9.0"

query = f"""
[out:json][timeout:30];
(
  node["amenity"="bbq"]({bbox});
  node["amenity"="firepit"]({bbox});
);
out body;
>;
out skel qt;
"""

url = "https://overpass-api.de/api/interpreter"
data = urllib.parse.urlencode({'data': query}).encode('utf-8')

try:
    req = urllib.request.Request(url, data=data, headers={'User-Agent': 'SwissGrillSnowApp/1.0'})
    with urllib.request.urlopen(req, timeout=40) as response:
        result = json.loads(response.read().decode())
        nodes = [el for el in result.get('elements', []) if el.get('type') == 'node']
        
        output_file = 'spots.json'
        with open(output_file, 'w') as f:
            json.dump(nodes, f)
            
        print(f"Successfully saved {len(nodes)} spots to {output_file}.")
except Exception as e:
    print(f"Error fetching data: {e}")
