// Constants
const CH_BOUNDS = [
    [45.817, 5.955],
    [47.808, 10.492]
];

// Map Initialization - TopoMap for relief
const map = L.map('map-container', {
    maxBounds: CH_BOUNDS,
    maxBoundsViscosity: 1.0,
    minZoom: 8
}).setView([46.8182, 8.2275], 8);

L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>, SRTM | Map style &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
}).addTo(map);

// Application State
let spotsData = [];
let activeSpot = null;
let activeMarker = null;
let markersLayer = L.layerGroup().addTo(map);
let filters = {
    roof: false,
    wood: false,
    grate: false,
    mountain: false,
    snow_none: false,
    snow_some: false,
    weather_sunny: false,
    weather_cloudy: false
};
let weatherCache = {}; // Cache open-meteo responses by lat-lon string

// DOM Elements
const loadingIndicator = document.getElementById('loading-indicator');
const datePicker = document.getElementById('date-picker');
const filterBtns = document.querySelectorAll('.filter-btn');
const btnApplyWeather = document.getElementById('apply-weather-filter');

const btnToggleMap = document.getElementById('toggle-map');
const btnToggleList = document.getElementById('toggle-list');
const mapContainer = document.getElementById('map-container');
const listContainer = document.getElementById('list-container');
const listItemsWrapper = document.getElementById('list-items');

// Collapsible Filters Panel
const filtersPanel = document.getElementById('filters-panel');
const filtersToggleBtn = document.getElementById('filters-toggle');
const filtersToggleIcon = document.getElementById('filters-toggle-icon');

filtersToggleBtn.addEventListener('click', () => {
    const isCollapsed = filtersPanel.classList.toggle('collapsed');
    document.getElementById('sidebar').classList.toggle('collapsed', isCollapsed);
});

function collapseFiltersOnMobile() {
    if (window.innerWidth <= 768 && !filtersPanel.classList.contains('collapsed')) {
        filtersPanel.classList.add('collapsed');
        document.getElementById('sidebar').classList.add('collapsed');
    }
}

// Initialize Date Picker
const today = new Date();
datePicker.value = today.toISOString().split('T')[0];
const maxDate = new Date();
maxDate.setDate(today.getDate() + 15);
datePicker.max = maxDate.toISOString().split('T')[0];
datePicker.min = today.toISOString().split('T')[0];

datePicker.addEventListener('change', () => {
    weatherCache = {}; // Invalidate temporal cache
    if (activeSpot) loadSpotDetails(activeSpot, activeMarker);
    applyFiltersAndRender();
});

// WMO Weather Mapping
function decodeWMO(code) {
    if (code === 0 || code === 1) return { text: 'CLEAR / SUN', category: 'SUNNY' };
    if ([2, 3, 45, 48].includes(code)) return { text: 'CLOUDS / FOG', category: 'CLOUDY' };
    if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return { text: 'RAIN', category: 'RAIN' };
    if ([71,73,75,77,85,86].includes(code)) return { text: 'SNOWFALL', category: 'SNOW' };
    if (code >= 95) return { text: 'STORM', category: 'RAIN' };
    return { text: 'UNKNOWN', category: 'UNKNOWN' };
}

// Load Cached Data
async function loadOfflineData() {
    try {
        showLoading();
        const res = await fetch('spots.json');
        if (res.ok) {
           spotsData = await res.json();
        } else {
           console.log("spots.json not found.");
        }
        applyFiltersAndRender();
    } catch (e) {
        console.error("Failed to load local DB", e);
    } finally {
        hideLoading();
    }
}

// UI Toggles
filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const type = e.target.dataset.filter;
        
        // Handle mutually exclusive snow buttons visually
        if (type === 'snow_none') {
            filters.snow_some = false;
            document.querySelector('[data-filter="snow_some"]').classList.remove('active');
        }
        if (type === 'snow_some') {
            filters.snow_none = false;
            document.querySelector('[data-filter="snow_none"]').classList.remove('active');
        }
        
        // Handle mutually exclusive weather buttons visually
        if (type === 'weather_sunny') {
            filters.weather_cloudy = false;
            document.querySelector('[data-filter="weather_cloudy"]').classList.remove('active');
        }
        if (type === 'weather_cloudy') {
            filters.weather_sunny = false;
            document.querySelector('[data-filter="weather_sunny"]').classList.remove('active');
        }
        
        filters[type] = !filters[type];
        e.target.classList.toggle('active');
        
        if (['roof','wood','grate','mountain'].includes(type)) {
            applyFiltersAndRender();
        }
    });
});

btnApplyWeather.addEventListener('click', async () => {
    if (filters.snow_none || filters.snow_some || filters.weather_sunny || filters.weather_cloudy) {
        await batchFetchWeatherForVisible();
    }
    applyFiltersAndRender();
});

btnToggleMap.addEventListener('click', () => {
    btnToggleMap.classList.add('active');
    btnToggleList.classList.remove('active');
    mapContainer.classList.add('active');
    listContainer.classList.remove('active');
    map.invalidateSize();
});

btnToggleList.addEventListener('click', () => {
    btnToggleList.classList.add('active');
    btnToggleMap.classList.remove('active');
    listContainer.classList.add('active');
    mapContainer.classList.remove('active');
    renderListView();
});

// Map Movement
let debounceTimer;
map.on('moveend', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if (map.getZoom() >= 10) {
            applyFiltersAndRender();
        } else {
            markersLayer.clearLayers();
        }
    }, 400);
});

// Core Logic
function isSpotMatchingAmenities(node) {
    if (filters.roof) {
        const covered = node.tags.covered === 'yes' || node.tags.shelter === 'yes';
        if (!covered) return false;
    }
    if (filters.wood) {
        const fuel = node.tags.wood === 'yes' || node.tags.fuel === 'wood';
        if (!fuel) return false;
    }
    if (filters.grate) {
        if (node.tags.grate !== 'yes') return false;
    }
    if (filters.mountain) {
        if (!node.tags.ele || parseInt(node.tags.ele) < 1000) return false;
    }
    return true;
}

function showLoading() { loadingIndicator.classList.remove('hidden'); }
function hideLoading() { loadingIndicator.classList.add('hidden'); }

// Batch fetching weather for performance
async function batchFetchWeatherForVisible() {
    showLoading();
    const bounds = map.getBounds();
    const visibleSpots = spotsData.filter(node => 
        bounds.contains([node.lat, node.lon]) && isSpotMatchingAmenities(node)
    );
    
    const batchSize = 50;
    for (let i = 0; i < visibleSpots.length; i += batchSize) {
        const batch = visibleSpots.slice(i, i + batchSize);
        const uncached = batch.filter(n => !weatherCache[`${n.lat},${n.lon}`]);
        
        if (uncached.length === 0) continue;
        
        const lats = uncached.map(n => n.lat).join(',');
        const lons = uncached.map(n => n.lon).join(',');
        
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&daily=weathercode&hourly=snow_depth&timezone=Europe%2FZurich&forecast_days=16`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            
            const results = uncached.length === 1 ? [data] : data;
            
            uncached.forEach((node, idx) => {
                const nodeData = results[idx];
                const key = `${node.lat},${node.lon}`;
                const selectedDate = datePicker.value;
                const hourlyIndex = nodeData.hourly.time.indexOf(`${selectedDate}T12:00`);
                let depth = hourlyIndex !== -1 ? nodeData.hourly.snow_depth[hourlyIndex] : 0;
                if (depth === null || isNaN(depth)) depth = 0;
                
                const dailyIndex = nodeData.daily.time.indexOf(selectedDate);
                const wmo = dailyIndex !== -1 ? nodeData.daily.weathercode[dailyIndex] : null;
                
                weatherCache[key] = { 
                    snowDepthCM: Math.round(depth * 100),
                    weathercode: wmo
                };
            });
        } catch (e) {
            console.error("Batch fetch failed", e);
        }
    }
    hideLoading();
}

function applyFiltersAndRender() {
    if (map.getZoom() < 10 && mapContainer.classList.contains('active')) {
        markersLayer.clearLayers();
        return;
    }
    
    const bounds = map.getBounds();
    const visibleAndFiltered = spotsData.filter(node => {
        if (!bounds.contains([node.lat, node.lon])) return false;
        if (!isSpotMatchingAmenities(node)) return false;
        
        // Advanced Weather Filters
        if (filters.snow_none || filters.snow_some || filters.weather_sunny || filters.weather_cloudy) {
            const cached = weatherCache[`${node.lat},${node.lon}`];
            if (!cached) return false; // If not fetched, hide (they must click explicit 'Apply' which fetches them all)
            
            if (filters.snow_none && cached.snowDepthCM > 0) return false;
            if (filters.snow_some && cached.snowDepthCM === 0) return false;
            
            if (cached.weathercode !== null) {
                const wmoDecoded = decodeWMO(cached.weathercode);
                if (filters.weather_sunny && wmoDecoded.category !== 'SUNNY') return false;
                if (filters.weather_cloudy && wmoDecoded.category !== 'CLOUDY') return false;
            }
        }
        
        return true;
    });
    
    renderMapMarkers(visibleAndFiltered);
    if (!mapContainer.classList.contains('active')) {
        renderListView(visibleAndFiltered);
    }
}

function renderMapMarkers(spots) {
    markersLayer.clearLayers();
    
    spots.forEach(node => {
        const hasRoof = node.tags.covered === 'yes' || node.tags.shelter === 'yes';
        const html = hasRoof ? 'R' : 'B'; 

        const icon = L.divIcon({
            className: 'custom-marker',
            html: `<span>${html}</span>`,
            iconSize: [20, 20]
        });

        const marker = L.marker([node.lat, node.lon], { icon }).addTo(markersLayer);
        
        marker.on('click', () => {
            loadSpotDetails(node, marker);
        });
    });
}

function renderListView(spotsObj) {
    const spots = spotsObj || (function() {
        const bounds = map.getBounds();
        return spotsData.filter(node => bounds.contains([node.lat, node.lon]) && isSpotMatchingAmenities(node));
    })();
    
    listItemsWrapper.innerHTML = '';
    
    if (spots.length === 0) {
        listItemsWrapper.innerHTML = '<div style="padding:24px; color:var(--grey); font-weight:700;">NO MATCHING SPOTS</div>';
        return;
    }
    
    spots.forEach(node => {
        const name = node.tags.name || 'Barbecue Point';
        const coords = `${node.lat.toFixed(4)}, ${node.lon.toFixed(4)}`;
        
        let amenitiesStr = [];
        if (node.tags.covered === 'yes' || node.tags.shelter === 'yes') amenitiesStr.push('Shelter');
        if (node.tags.wood === 'yes' || node.tags.fuel === 'wood') amenitiesStr.push('Wood');
        if (node.tags.grate === 'yes') amenitiesStr.push('Grate');
        const amenitiesText = amenitiesStr.length > 0 ? amenitiesStr.join(', ') : '-';
        
        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `
            <span>${name}</span>
            <span><a href="https://www.google.com/maps/search/?api=1&query=${node.lat},${node.lon}" target="_blank" style="color:var(--ch-red)">${coords}</a></span>
            <span>${amenitiesText}</span>
            <button class="btn-primary" style="font-size:10px; padding:4px 8px;">VIEW</button>
        `;
        
        el.querySelector('button').addEventListener('click', () => {
            loadSpotDetails(node);
        });
        
        listItemsWrapper.appendChild(el);
    });
}


async function loadSpotDetails(node, marker) {
    activeSpot = node;
    
    if (marker) {
        if (activeMarker && activeMarker.getElement()) {
            activeMarker.getElement().classList.remove('active');
        }
        activeMarker = marker;
        if(activeMarker.getElement()) activeMarker.getElement().classList.add('active');
    }
    
    document.getElementById('initial-state').classList.add('hidden');
    document.getElementById('spot-details').classList.remove('hidden');

    // On mobile: collapse filters so spot details are immediately visible
    collapseFiltersOnMobile();
    
    document.getElementById('spot-title').innerText = (node.tags.name || 'Feuerstelle').toUpperCase();
    
    const gpsLink = document.getElementById('spot-gps');
    gpsLink.href = `https://www.google.com/maps/search/?api=1&query=${node.lat},${node.lon}`;
    
    const osmLink = document.getElementById('spot-osm');
    osmLink.href = `https://www.openstreetmap.org/node/${node.id}`;
    
    const weatherLink = document.getElementById('spot-weather');
    const latStr = Math.abs(node.lat).toFixed(3) + (node.lat >= 0 ? 'N' : 'S');
    const lonStr = Math.abs(node.lon).toFixed(3) + (node.lon >= 0 ? 'E' : 'W');
    weatherLink.href = `https://www.meteoblue.com/en/weather/week/${latStr}${lonStr}`;
    weatherLink.classList.remove('hidden');
    
    const isCovered = node.tags.covered === 'yes' || node.tags.shelter === 'yes';
    const hasBench = node.tags.bench === 'yes';
    const hasFuel = node.tags.wood === 'yes' || node.tags.fuel === 'wood';
    const hasGrate = node.tags.grate === 'yes';

    const amenitiesList = document.getElementById('spot-amenities');
    amenitiesList.innerHTML = '';
    
    const addLabel = (label, yes) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${label}</span> <span class="val ${yes?'yes':'no'}">${yes?'YES':'NO'}</span>`;
        amenitiesList.appendChild(li);
    }
    addLabel('SHELTER / ROOF', isCovered);
    addLabel('SEATING', hasBench);
    addLabel('WOOD PROVIDED', hasFuel);
    addLabel('GRATE', hasGrate);

    // Advanced shelter specifics if available
    if (node.tags.shelter_type) {
        const li = document.createElement('li');
        li.innerHTML = `<span>TYPE</span> <span class="val yes">${node.tags.shelter_type.toUpperCase().replace('_', ' ')}</span>`;
        amenitiesList.appendChild(li);
    }
    if (node.tags.building) {
         const li = document.createElement('li');
         li.innerHTML = `<span>BUILDING</span> <span class="val yes">${node.tags.building === 'yes' ? 'ENCLOSED' : node.tags.building.toUpperCase()}</span>`;
         amenitiesList.appendChild(li);
    }

    // Raw JSON Payload dump
    const rawPayloadBox = document.getElementById('spot-raw-payload');
    rawPayloadBox.innerText = JSON.stringify(node.tags, null, 2);

    await fetchWeatherSingle(node.lat, node.lon);
}

async function fetchWeatherSingle(lat, lon) {
    showLoading();
    
    const selectedDate = document.getElementById('date-picker').value;
    document.getElementById('weather-date-label').innerHTML = `DATE: ${selectedDate}`;
    const content = document.getElementById('weather-content');
    content.innerHTML = '<div style="font-size:10px">Loading...</div>';
    
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,snowfall_sum&hourly=snow_depth&timezone=Europe%2FZurich&forecast_days=16`;
        const res = await fetch(url);
        const data = await res.json();
        
        const dateIndex = data.daily.time.indexOf(selectedDate);
        if (dateIndex === -1) {
            content.innerHTML = "<div style='font-size:10px'>NO DATA</div>";
            return;
        }
        
        const tempMax = data.daily.temperature_2m_max[dateIndex] ?? 0;
        const tempMin = data.daily.temperature_2m_min[dateIndex] ?? 0;
        
        const wmoCode = data.daily.weathercode[dateIndex];
        const condition = decodeWMO(wmoCode);
        
        const hourlyIndex = data.hourly.time.indexOf(`${selectedDate}T12:00`);
        let snowDepth = hourlyIndex !== -1 ? data.hourly.snow_depth[hourlyIndex] : 0;
        if (snowDepth === null || isNaN(snowDepth)) snowDepth = 0;
        
        let snowfallSum = data.daily.snowfall_sum[dateIndex];
        if (snowfallSum === null || isNaN(snowfallSum)) snowfallSum = 0;
        
        const depthCM = Math.round(snowDepth * 100);
        
        // Update Cache
        weatherCache[`${lat},${lon}`] = { 
            snowDepthCM: depthCM,
            weathercode: wmoCode
        };
        
        content.innerHTML = `
            <div class="weather-metric">
                <span class="desc">CONDITION</span>
                <span class="data">${condition.text}</span>
            </div>
            <div class="weather-metric">
                <span class="desc">SNOW DEPTH</span>
                <span class="data">${depthCM} CM</span>
            </div>
            <div class="weather-metric">
                <span class="desc">TEMP (MIN/MAX)</span>
                <span class="data">${Math.round(tempMin)}° / ${Math.round(tempMax)}°</span>
            </div>
        `;
    } catch (e) {
        content.innerHTML = "<div style='font-size:10px'>ERROR FETCHING WEATHER</div>";
    } finally {
        hideLoading();
    }
}

// Initial Boot marker
if (map.getZoom() < 10) {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.top = '80px';
    el.style.left = '24px';
    el.style.zIndex = '1000';
    el.style.background = 'var(--white)';
    el.style.padding = '12px 24px';
    el.style.border = '2px solid var(--black)';
    el.style.fontWeight = '700';
    el.style.fontSize = '10px';
    el.id = 'zoom-prompt';
    el.innerText = 'ZOOM IN TO LOAD SPOT LOCATIONS';
    document.getElementById('map-container').appendChild(el);
    
    map.on('zoomend', () => {
        const p = document.getElementById('zoom-prompt');
        if (map.getZoom() >= 10 && p) p.style.display = 'none';
        else if (map.getZoom() < 10 && p) p.style.display = 'block';
    });
}

// Launch
loadOfflineData();
