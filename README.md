# FeuerMeister

A fully functional, offline-capable topographic mapping app designed specifically for finding firepits, BBQ shelters, and outdoor rest spots across Switzerland, featuring dynamic weather mapping (Snow & Precipitation conditions).

## Data Architecture & Filtering

1. **Topographical Data (Static)** 
   - All spatial data is derived from the **OpenStreetMap (OSM)** database via the Overpass API.
   - Using the `fetch_data.py` script, we query the exact boundary of Switzerland specifically searching for nodes explicitly tagged as `amenity=bbq`, `amenity=firepit`, and `leisure=firepit`.
   - *Shelters & Walls:* We identify if a grillplatz is sheltered by parsing the specific OSM tags `covered=yes`, `shelter=yes` (indicating a roof structure), as well as looking for `shelter_type` attributes or `building=yes` to determine if walls encapsulate the firepit. The application will expose these specific building tags in the details pane if they are recorded.

2. **Weather Data (Dynamic)**
   - The application relies on **Open-Meteo V1** to cross-examine specific spot coordinates without API keys.
   - It batch-processes points bounding the current screen to provide accurate WMO Weather Code classifications (Sun, Clouds, Rain, Snow) and exact Midday Snow Depths in centimeters.
   - We utilize **Meteoblue** via hotlinks to offer you detailed 14-day comprehensive forecasting explicitly tied to the exact latitude/longitude of the firepit.

## Features

- **Micro-Filters**: Visually filter map markers by Shelter status, Drinkable Water, Wood supply, and even current/predicted snow and weather (Sunny vs Cloudy).
- **Dual View Modes**: Switch between immersive TopoMap exploration and an organized List View.
- **GPS Targeting**: Directly pop open Google Maps routing.

## Installation & Running

Since the system relies on fetching the local `spots.json`, the directory simply must be served over a basic local HTTP server.

```bash
# Start a local Python HTTP server
python3 -m http.server 8000
```
Then navigate to `http://localhost:8000/`.

## Updating the Offline Spot Database

To update the local database with new OpenStreetMap data:
```bash
python3 fetch_data.py
```
This script securely queries the Overpass index for the entire Swiss bounding box, isolating the precise BBQ tags.
