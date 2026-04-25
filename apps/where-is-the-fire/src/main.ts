import "./style.css";
import L from "leaflet";
import "leaflet.markercluster";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import { callbackUrl, formaClientIdValue, nasaMapKeyValue } from "./config";
import { loadForma } from "./forma";

const firmsSources = [
  "VIIRS_NOAA20_NRT",
  "VIIRS_SNPP_NRT",
  "MODIS_NRT",
] as const;
const firmsLookbackDays = 2;
const minFetchZoom = 3;
const fetchDebounceMs = 900;
const cacheTtlMs = 10 * 60 * 1000;
const maxCacheEntries = 500;
const maxTilesPerFetch = 20;

type FireRow = Record<string, string> & {
  _source?: string;
};

type Tile = {
  x: number;
  y: number;
  zoom: number;
};

type CachedTile = {
  rows: FireRow[];
  source: string;
  at: number;
};

function getRequiredElement<T extends HTMLElement>(
  id: string,
  constructor: { new (): T },
) {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element;
}

const statusEl = getRequiredElement("status", HTMLElement);
const metaEl = getRequiredElement("meta", HTMLElement);
const firesEl = getRequiredElement("fires", HTMLElement);

const tileCache = new Map<string, CachedTile>();
let activeFetchController: AbortController | null = null;
let debouncedTimer: number | null = null;
let clusterGroup: L.MarkerClusterGroup | null = null;
let leafletMap: L.Map | null = null;

delete (L.Icon.Default.prototype as L.Icon.Default & {
  _getIconUrl?: unknown;
})._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
});

function setStatus(text: string) {
  statusEl.textContent = text;
}

function toTileX(longitude: number, zoom: number) {
  return Math.floor(((longitude + 180) / 360) * 2 ** zoom);
}

function toTileY(latitude: number, zoom: number) {
  const latRad = (latitude * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      2 ** zoom,
  );
}

function tileBounds(x: number, y: number, zoom: number) {
  const n = 2 ** zoom;
  const lonLeft = (x / n) * 360 - 180;
  const lonRight = ((x + 1) / n) * 360 - 180;
  const latTop =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const latBottom =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return {
    west: lonLeft,
    south: latBottom,
    east: lonRight,
    north: latTop,
  };
}

function getTilesForBounds(bounds: L.LatLngBounds, zoom: number) {
  const south = Math.max(bounds.getSouth(), -85);
  const north = Math.min(bounds.getNorth(), 85);
  const west = bounds.getWest();
  const east = bounds.getEast();
  const xMin = toTileX(west, zoom);
  const xMax = toTileX(east, zoom);
  const yMin = toTileY(north, zoom);
  const yMax = toTileY(south, zoom);
  const tiles: Tile[] = [];

  for (let x = xMin; x <= xMax; x += 1) {
    for (let y = yMin; y <= yMax; y += 1) {
      tiles.push({ x, y, zoom });
    }
  }

  return tiles;
}

function csvToRows(csv: string) {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) {
    return [];
  }

  const headers = lines[0].split(",").map((value) => value.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: FireRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? "";
    });
    return row;
  });
}

function mergeAndDeduplicate(rows: FireRow[]) {
  const byId = new Map<string, FireRow>();
  for (const row of rows) {
    const id = [
      row.latitude,
      row.longitude,
      row.acq_date,
      row.acq_time,
      row.satellite || row.instrument || "",
    ].join("|");
    if (!byId.has(id)) {
      byId.set(id, row);
    }
  }
  return [...byId.values()];
}

async function fetchFirmsRowsForArea(area: string, signal: AbortSignal) {
  let lastError: unknown = null;

  for (const source of firmsSources) {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${nasaMapKeyValue}/${source}/${area}/${firmsLookbackDays}`;

    try {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error(`FIRMS ${source} failed (${response.status})`);
      }

      const csv = await response.text();
      const rows = csvToRows(csv).map((row) => ({ ...row, _source: source }));
      return { rows, source };
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      lastError = error;
      console.warn(`FIRMS source ${source} failed`, error);
    }
  }

  throw lastError ?? new Error("All FIRMS sources failed.");
}

function touchCacheEntry(cacheKey: string, entry: CachedTile) {
  tileCache.delete(cacheKey);
  tileCache.set(cacheKey, entry);
  if (tileCache.size > maxCacheEntries) {
    const oldest = tileCache.keys().next().value;
    if (oldest) {
      tileCache.delete(oldest);
    }
  }
}

async function getTileRows(tile: Tile, signal: AbortSignal) {
  const cacheKey = `${tile.zoom}/${tile.x}/${tile.y}`;
  const now = Date.now();
  const cached = tileCache.get(cacheKey);

  if (cached && now - cached.at < cacheTtlMs) {
    touchCacheEntry(cacheKey, cached);
    return { rows: cached.rows, cacheHit: true, source: cached.source };
  }

  const bbox = tileBounds(tile.x, tile.y, tile.zoom);
  const area = `${bbox.west.toFixed(6)},${bbox.south.toFixed(6)},${bbox.east.toFixed(6)},${bbox.north.toFixed(6)}`;
  const { rows, source } = await fetchFirmsRowsForArea(area, signal);
  touchCacheEntry(cacheKey, { rows, source, at: now });
  return { rows, cacheHit: false, source };
}

function clearFireMarkers() {
  clusterGroup?.clearLayers();
}

function renderFireRows(rows: FireRow[]) {
  clearFireMarkers();
  if (!clusterGroup) {
    return;
  }

  for (const row of rows) {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }

    const brightness = row.bright_ti4 || row.brightness || "n/a";
    const confidence = row.confidence || row.confidence_level || "n/a";
    const date = row.acq_date || "n/a";
    const time = row.acq_time || "n/a";
    const source = row._source || "n/a";

    const marker = L.circleMarker([lat, lon], {
      radius: 4,
      color: "#e03131",
      fillColor: "#ff6b6b",
      fillOpacity: 0.8,
      weight: 1,
    }).bindPopup(
      `Fire detection<br/>Source: ${source}<br/>Date: ${date} ${time}<br/>Brightness: ${brightness}<br/>Confidence: ${confidence}`,
    );

    clusterGroup.addLayer(marker);
  }
}

async function refreshForViewport() {
  if (!leafletMap) {
    return;
  }

  const currentZoom = leafletMap.getZoom();
  if (currentZoom < minFetchZoom) {
    clearFireMarkers();
    setStatus(`Zoom in to level ${minFetchZoom}+ to load wildfire detections.`);
    firesEl.textContent = "";
    return;
  }

  const tileZoom = Math.max(
    minFetchZoom,
    Math.min(7, Math.floor(currentZoom) - 1),
  );
  const tiles = getTilesForBounds(leafletMap.getBounds(), tileZoom);
  if (tiles.length > maxTilesPerFetch) {
    clearFireMarkers();
    setStatus(
      `Too many visible tiles (${tiles.length}). Zoom in to stay under rate limits.`,
    );
    firesEl.textContent = "";
    return;
  }

  activeFetchController?.abort();
  activeFetchController = new AbortController();
  const { signal } = activeFetchController;

  setStatus(`Loading wildfire tiles (${tiles.length})...`);
  let cacheHits = 0;
  let loadedTiles = 0;
  const allRows: FireRow[] = [];

  for (const tile of tiles) {
    try {
      const { rows, cacheHit } = await getTileRows(tile, signal);
      if (cacheHit) {
        cacheHits += 1;
      }
      loadedTiles += 1;
      allRows.push(...rows);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      console.warn("Tile load failed", tile, error);
    }
  }

  const rows = mergeAndDeduplicate(allRows);
  renderFireRows(rows);
  setStatus(
    `Loaded ${rows.length} detections from ${loadedTiles} tiles (${cacheHits} cached, zoom ${currentZoom}).`,
  );
  const preview = rows.slice(0, 10);
  firesEl.textContent =
    rows.length === 0
      ? "No active fire detections in this viewport."
      : `Showing first ${preview.length} of ${rows.length} detections:\n${JSON.stringify(preview, null, 2)}`;
}

function scheduleViewportRefresh() {
  if (debouncedTimer !== null) {
    window.clearTimeout(debouncedTimer);
  }

  debouncedTimer = window.setTimeout(() => {
    void refreshForViewport().catch((error) => {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      console.error("Viewport refresh failed:", error);
      setStatus("Failed to refresh wildfire data.");
    });
  }, fetchDebounceMs);
}

function initializeMap(projectLatitude: number, projectLongitude: number) {
  leafletMap = L.map("map", {
    worldCopyJump: true,
    preferCanvas: true,
  }).setView([projectLatitude, projectLongitude], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(leafletMap);

  L.marker([projectLatitude, projectLongitude])
    .bindPopup("Forma project location")
    .addTo(leafletMap);

  clusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    disableClusteringAtZoom: 9,
    maxClusterRadius: 55,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
  });

  leafletMap.addLayer(clusterGroup);
  leafletMap.on("moveend zoomend", scheduleViewportRefresh);
}

async function ensureProjectLocation(Forma: Awaited<ReturnType<typeof loadForma>>) {
  setStatus("Reading project location...");
  const geo = await Forma.project.getGeoLocation();
  if (geo) {
    return geo;
  }

  const projectData = await Forma.project.get();
  if (
    projectData &&
    Number.isFinite(projectData.latitude) &&
    Number.isFinite(projectData.longitude)
  ) {
    return [
      projectData.latitude as number,
      projectData.longitude as number,
    ] as const;
  }

  throw new Error("Project geolocation is not available.");
}

async function run() {
  const Forma = await loadForma();

  Forma.onEmbeddedViewClosing?.(async () => {});

  Forma.auth.configure({
    clientId: formaClientIdValue,
    callbackUrl,
    scopes: ["data:write", "data:read"],
  });

  setStatus("Signing in...");
  const tokenResponse = await Forma.auth.acquireTokenOverlay();
  console.log(
    "Access token issued; length:",
    tokenResponse.accessToken?.length,
  );

  const [projectLatitude, projectLongitude] = await ensureProjectLocation(Forma);
  const region = Forma.getRegion?.() ?? "n/a";
  metaEl.textContent =
    `Project: ${Forma.getProjectId()} | Region: ${region} | ` +
    `Lat/Lon: ${projectLatitude.toFixed(5)}, ${projectLongitude.toFixed(5)}`;

  initializeMap(projectLatitude, projectLongitude);
  scheduleViewportRefresh();
}

void run().catch((error) => {
  setStatus("Failed. Check the console for details.");
  console.error("Wildfire extension error:", error);
});
