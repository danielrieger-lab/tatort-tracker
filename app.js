const list = document.getElementById("episode-list");
const catalogCount = document.getElementById("catalog-count");
const searchInput = document.getElementById("episode-search");
const suggestions = document.getElementById("episode-suggestions");
const episodeModal = document.getElementById("episode-modal");
const episodeModalTitle = document.getElementById("episode-modal-title");
const episodeModalBody = document.getElementById("episode-modal-body");

const RATING_STORAGE_KEY = "tatort-tracker-ratings-v1";
const EPISODES_CACHE_KEY = "tatort-tracker-episodes-cache-v1";
const FAILED_ROLES_CACHE_KEY = "tatort-tracker-failed-roles-v1";
const LOCATION_CACHE_KEY = "tatort-tracker-location-cache-v1";
const SYNC_LAST_RUN_KEY = "tatort-tracker-sync-last-run-v1";
const LOCAL_DB_NAME = "tatort-tracker-db";
const LOCAL_DB_VERSION = 1;
const LOCAL_DB_STORE = "appData";
const LOCAL_DB_EPISODES_KEY = "episodes";
const WIKIPEDIA_API = "https://de.wikipedia.org/w/api.php";
const RATING_KEYS = [
  { key: "fallqualitaet", label: "Fallqualität" },
  { key: "team", label: "Team" },
  { key: "inszenierung", label: "Inszenierung" },
  { key: "spannung", label: "Spannung" }
];
const GRUSELIG_KEY = "gruselig";
const MOST_LOVED_KEY = "mostLovedCharacter";
const MOST_HATED_KEY = "mostHatedCharacter";
const KOMMENTARE_KEY = "kommentare";
const ZUERST_GESEHEN_KEY = "zuerstGesehen";
const ANZAHL_KEY = "anzahl";
const GESAMT_KEY = "gesamt";
const RATING_ICON_PATHS = {
  [GESAMT_KEY]: "assets/icons/icon.svg",
  fallqualitaet: "assets/icons/fallqualität.svg",
  team: "assets/icons/team.svg",
  inszenierung: "assets/icons/inszenierung.svg",
  spannung: "assets/icons/spannung.svg",
  [GRUSELIG_KEY]: "assets/icons/gruselig.svg"
};
const URL_PARAMS = new URLSearchParams(window.location.search);
let pendingEpisodeNo = Number(URL_PARAMS.get("episode") || 0);
if (!Number.isFinite(pendingEpisodeNo) || pendingEpisodeNo <= 0) {
  pendingEpisodeNo = null;
}

let episodes = [];
let filteredEpisodes = [];
let ratingsByEpisode = readRatings();
normalizeViewedStateFromRatings();
let currentModalEpisodeNo = null;
let failedRoleTitles = [];
let locationCache = readLocationCache();

showLoadingState();
loadCatalog();

searchInput.addEventListener("input", () => {
  applyFilter(searchInput.value);
});

async function loadCatalog() {
  const cachedEpisodes = await readEpisodesCache();
  if (Array.isArray(cachedEpisodes) && cachedEpisodes.length > 0) {
    episodes = cachedEpisodes;
    buildSuggestions(episodes);
    applyFilter(searchInput.value);
    catalogCount.textContent = `${episodes.length.toLocaleString("de-DE")} Tatort-Folgen geladen.`;
  }

  try {
    const response = await fetch("data/tatort-episodes.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const bundledEpisodes = await response.json();
    episodes = Array.isArray(cachedEpisodes) && cachedEpisodes.length > 0 ? cachedEpisodes : bundledEpisodes;

    failedRoleTitles = await loadFailedRoleTitles();

    const syncResult = await runDailySync();

    buildSuggestions(episodes);
    applyFilter(searchInput.value);

    catalogCount.textContent = `${episodes.length.toLocaleString("de-DE")} Tatort-Folgen geladen.`;
    if (!syncResult.error) {
      await persistEpisodesCache();
    }
  } catch (error) {
    if (episodes.length > 0) {
      buildSuggestions(episodes);
      applyFilter(searchInput.value);
      catalogCount.textContent = `${episodes.length.toLocaleString("de-DE")} Tatort-Folgen geladen.`;
      return;
    }

    renderErrorState();
    catalogCount.textContent = "Tatort-Katalog konnte nicht geladen werden.";
  }
}

async function runDailySync() {
  if (!shouldRunDailySync()) {
    return { ran: false, error: false };
  }

  try {
    const listRaw = await fetchWikipediaPageRaw("Liste_der_Tatort-Folgen");
    const latestRows = parseEpisodeRowsFromListRaw(listRaw);
    episodes = mergeEpisodesFromList(episodes, latestRows);

    const uniqueErmittlerLinks = Array.from(new Set(latestRows.flatMap((row) => Array.isArray(row.ermittlerLinks) ? row.ermittlerLinks : [])));
    const uniqueTitleLinks = Array.from(new Set(latestRows.flatMap((row) => Array.isArray(row.titleLinks) ? row.titleLinks : [])));
    const uniqueLinks = Array.from(new Set([...uniqueErmittlerLinks, ...uniqueTitleLinks]));
    for (const link of uniqueLinks) {
      if (locationCache[link]) {
        continue;
      }

      try {
        const pageRaw = await fetchWikipediaPageRaw(link, true);
        const resolvedLocation = extractLocationFromWiki(pageRaw);
        if (resolvedLocation) {
          locationCache[link] = resolvedLocation;
        }
      } catch {
        locationCache[link] = locationCache[link] || "";
      }
    }

    for (const row of latestRows) {
      const episode = episodes.find((item) => Number(item.no) === Number(row.no));
      if (!episode) {
        continue;
      }

      const resolvedLocation = (Array.isArray(row.ermittlerLinks) ? row.ermittlerLinks : [])
        .concat(Array.isArray(row.titleLinks) ? row.titleLinks : [])
        .map((link) => locationCache[link] || "")
        .find((value) => String(value || "").trim());
      episode.location = resolvedLocation || "";
    }

    const locationByErmittler = new Map();
    for (const episode of episodes) {
      const ermittler = normalizeTitle(String(episode.ermittler || "").replace(/\s*\([^)]*\)/g, ""));
      const location = String(episode.location || "").trim();
      if (!ermittler || !location) {
        continue;
      }
      if (!locationByErmittler.has(ermittler)) {
        locationByErmittler.set(ermittler, location);
      }
    }

    for (const episode of episodes) {
      if (String(episode.location || "").trim()) {
        continue;
      }
      const ermittlerKey = normalizeTitle(String(episode.ermittler || "").replace(/\s*\([^)]*\)/g, ""));
      const resolved = locationByErmittler.get(ermittlerKey);
      if (resolved) {
        episode.location = resolved;
      }
    }

    persistLocationCache();

    if (failedRoleTitles.length > 0) {
      const unresolved = [];
      for (const failedTitle of failedRoleTitles) {
        const pageRaw = await fetchWikipediaPageRaw(failedTitle, true);
        const roles = extractRolesFromBesetzung(pageRaw);
        if (roles.length === 0) {
          unresolved.push(failedTitle);
          continue;
        }

        const pageName = failedTitle.replace(/^Tatort:\s*/, "").trim();
        const pageBase = pageName.replace(/\s*\(\d{4}\)\s*$/, "").trim();
        const episode = episodes.find((item) => normalizeTitle(item.title) === normalizeTitle(pageBase));
        if (episode) {
          episode.roles = roles;
        } else {
          unresolved.push(failedTitle);
        }
      }
      failedRoleTitles = unresolved;
      persistFailedRoleTitles();
    }

    localStorage.setItem(SYNC_LAST_RUN_KEY, String(Date.now()));
    return { ran: true, error: false };
  } catch {
    localStorage.setItem(SYNC_LAST_RUN_KEY, String(Date.now()));
    return { ran: true, error: true };
  }
}

function shouldRunDailySync() {
  const lastRun = Number(localStorage.getItem(SYNC_LAST_RUN_KEY) || 0);
  const now = new Date();
  const slot = new Date(now);
  slot.setHours(4, 0, 0, 0);
  if (now < slot) {
    slot.setDate(slot.getDate() - 1);
  }
  return lastRun < slot.getTime();
}

async function readEpisodesCache() {
  const fromDb = await readFromIndexedDb(LOCAL_DB_EPISODES_KEY);
  if (Array.isArray(fromDb) && fromDb.length > 0) {
    return fromDb;
  }

  try {
    const raw = localStorage.getItem(EPISODES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function persistEpisodesCache() {
  try {
    localStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(episodes));
  } catch {
  }

  await writeToIndexedDb(LOCAL_DB_EPISODES_KEY, episodes);
}

function readLocationCache() {
  try {
    const raw = localStorage.getItem(LOCATION_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistLocationCache() {
  try {
    localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(locationCache));
  } catch {
  }
}

function readFailedRoleTitlesCache() {
  try {
    const raw = localStorage.getItem(FAILED_ROLES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function openIndexedDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      resolve(null);
      return;
    }

    const request = window.indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_DB_STORE)) {
        db.createObjectStore(LOCAL_DB_STORE);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

async function readFromIndexedDb(key) {
  try {
    const db = await openIndexedDb();
    if (!db) {
      return null;
    }

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_DB_STORE, "readonly");
      const store = tx.objectStore(LOCAL_DB_STORE);
      const req = store.get(key);

      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return null;
  }
}

async function writeToIndexedDb(key, value) {
  try {
    const db = await openIndexedDb();
    if (!db) {
      return;
    }

    await new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_DB_STORE, "readwrite");
      const store = tx.objectStore(LOCAL_DB_STORE);
      store.put(value, key);

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
  }
}

function persistFailedRoleTitles() {
  localStorage.setItem(FAILED_ROLES_CACHE_KEY, JSON.stringify(failedRoleTitles));
}

async function loadFailedRoleTitles() {
  const cached = readFailedRoleTitlesCache();
  if (cached && cached.length > 0) {
    return cached;
  }

  try {
    const response = await fetch("data/tatort-episode-roles-failed.txt", { cache: "no-store" });
    if (!response.ok) {
      return [];
    }
    const text = await response.text();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    localStorage.setItem(FAILED_ROLES_CACHE_KEY, JSON.stringify(lines));
    return lines;
  } catch {
    return [];
  }
}

async function fetchWikipediaPageRaw(titleOrPageName, alreadyFullTitle = false) {
  const title = alreadyFullTitle ? titleOrPageName : titleOrPageName;
  const params = new URLSearchParams({
    action: "query",
    prop: "revisions",
    rvprop: "content",
    format: "json",
    formatversion: "2",
    origin: "*",
    titles: title
  });

  const response = await fetch(`${WIKIPEDIA_API}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  const page = data?.query?.pages?.[0];
  const raw = page?.revisions?.[0]?.content;
  if (!raw) {
    throw new Error("No page content");
  }
  return raw;
}

function parseEpisodeRowsFromListRaw(raw) {
  const rows = [];
  const lines = String(raw || "").split(/\r?\n/);
  let inTable = false;
  let cells = [];
  let currentCellIndex = -1;

  const pushRowIfValid = () => {
    if (cells.length < 5) {
      return;
    }

    const noRaw = cleanWikiText(cells[0]);
    const noMatch = noRaw.match(/^\d+$/);
    if (!noMatch) {
      return;
    }

    const titleRaw = String(cells[1] || "").replace(/<br\s*\/?>(.|\n|\r)*$/i, "");
    const title = cleanWikiText(titleRaw);
    if (!title) {
      return;
    }

    rows.push({
      no: Number(noRaw),
      title,
      sender: cleanWikiText(cells[2]),
      date: cleanWikiText(cells[3]),
      ermittler: cleanWikiText(cells[4]),
      ermittlerLinks: extractWikiLinks(cells[4]),
      titleLinks: extractWikiLinks(cells[1])
    });
  };

  for (const line of lines) {
    if (/^\{\|/.test(line)) {
      inTable = true;
      cells = [];
      currentCellIndex = -1;
      continue;
    }
    if (!inTable) {
      continue;
    }

    if (/^\|-/.test(line)) {
      pushRowIfValid();
      cells = [];
      currentCellIndex = -1;
      continue;
    }

    if (/^\|\}/.test(line)) {
      pushRowIfValid();
      inTable = false;
      cells = [];
      currentCellIndex = -1;
      continue;
    }

    if (/^!/.test(line)) {
      continue;
    }

    const cellMatch = line.match(/^\|\s*(.*)$/);
    if (cellMatch) {
      const chunks = cellMatch[1].split("||");
      for (const chunk of chunks) {
        cells.push(chunk.trim());
      }
      currentCellIndex = cells.length - 1;
      continue;
    }

    if (currentCellIndex >= 0 && line.trim()) {
      cells[currentCellIndex] = `${cells[currentCellIndex]} ${line.trim()}`;
    }
  }

  return rows;
}

function extractWikiLinks(value) {
  const links = [];
  const text = String(value || "");
  const linkPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match;

  while ((match = linkPattern.exec(text)) !== null) {
    const link = cleanWikiText(match[1]);
    if (link) {
      links.push(link);
    }
  }

  return Array.from(new Set(links));
}

function extractLocationFromWiki(raw) {
  const patterns = [
    /\|\s*Ort\s*=\s*([^\n|}]+)/i,
    /\|\s*Orte\s*=\s*([^\n|}]+)/i,
    /\|\s*Dienstort\s*=\s*([^\n|}]+)/i,
    /\|\s*Dienstorte\s*=\s*([^\n|}]+)/i,
    /\|\s*Wohnort\s*=\s*([^\n|}]+)/i,
    /\|\s*Wirkungsort\s*=\s*([^\n|}]+)/i,
    /\|\s*Einsatzort\s*=\s*([^\n|}]+)/i,
    /\|\s*Region\s*=\s*([^\n|}]+)/i,
    /\|\s*Standort\s*=\s*([^\n|}]+)/i
  ];

  for (const pattern of patterns) {
    const match = String(raw || "").match(pattern);
    if (match) {
      const value = cleanWikiText(match[1]).replace(/\s*\([^)]*\)/g, "").trim();
      if (value) {
        return value;
      }
    }
  }

  const text = cleanWikiText(raw);
  const introPatterns = [
    /ermittelt\s+in\s+([^.,;]+?)(?:\s+und\s+|\.|,|;|\)|$)/i,
    /ermittelt\s+von\s+([^.,;]+?)(?:\s+und\s+|\.|,|;|\)|$)/i,
    /Dienstort\s+([^.,;]+?)(?:\.|,|;|\)|$)/i,
    /Region\s+([^.,;]+?)(?:\.|,|;|\)|$)/i
  ];

  for (const pattern of introPatterns) {
    const match = text.match(pattern);
    if (match) {
      const value = cleanWikiText(match[1]).replace(/\s*\([^)]*\)/g, "").trim();
      if (value) {
        return value;
      }
    }
  }

  return "";
}

function mergeEpisodesFromList(currentEpisodes, latestRows) {
  const merged = [...currentEpisodes];
  const byNo = new Map(merged.map((item) => [Number(item.no), item]));
  const byTitle = new Map(merged.map((item) => [normalizeTitle(item.title), item]));

  for (const row of latestRows) {
    const existingByNo = byNo.get(Number(row.no));
    const existingByTitle = byTitle.get(normalizeTitle(row.title));
    const target = existingByNo || existingByTitle;

    if (target) {
      target.title = row.title;
      target.sender = row.sender;
      target.date = row.date;
      target.ermittler = row.ermittler;
      if (!Array.isArray(target.roles)) {
        target.roles = [];
      }
      continue;
    }

    const newEpisode = {
      no: Number(row.no),
      title: row.title,
      sender: row.sender,
      date: row.date,
      ermittler: row.ermittler,
      location: "",
      roles: []
    };
    merged.push(newEpisode);
    byNo.set(newEpisode.no, newEpisode);
    byTitle.set(normalizeTitle(newEpisode.title), newEpisode);
  }

  merged.sort((a, b) => Number(a.no) - Number(b.no));
  return merged;
}

function extractRolesFromBesetzung(raw) {
  const lines = String(raw || "").split(/\r?\n/);
  const roles = [];
  let start = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (/^\|\s*Besetzung\s*=/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return roles;
  }

  const first = lines[start].replace(/^\|\s*Besetzung\s*=\s*/, "").trim();
  if (first.startsWith("*")) {
    const match = first.slice(1).trim().match(/^(.*?):\s*(.+)$/);
    if (match) {
      const name = cleanWikiText(match[1]);
      const role = cleanWikiText(match[2]);
      if (name && role) {
        roles.push(`${name}:${role}`);
      }
    }
  }

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\|\s*[A-Za-zÄÖÜäöüß0-9 _-]+\s*=/.test(line) || /^\}\}/.test(line)) {
      break;
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith("*")) {
      continue;
    }
    const match = trimmed.slice(1).trim().match(/^(.*?):\s*(.+)$/);
    if (!match) {
      continue;
    }
    const name = cleanWikiText(match[1]);
    const role = cleanWikiText(match[2]);
    if (name && role) {
      roles.push(`${name}:${role}`);
    }
  }

  return roles;
}

function cleanWikiText(value) {
  let text = String(value || "");
  text = text.replace(/<ref[^>]*>.*?<\/ref>/gsi, "");
  text = text.replace(/<ref[^/>]*\/>/gsi, "");
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");
  text = text.replace(/\{\{DatumZelle\|([^}]+)\}\}/g, "$1");
  text = text.replace(/\{\{Anker\|[^}]+\}\}/g, "");
  text = text.replace(/\{\{[^{}]*\}\}/g, "");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.replace(/^[,;\s]+|[,;\s]+$/g, "");
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function showLoadingState() {
  list.innerHTML = "";
  const item = document.createElement("li");
  item.className = "episode-card";
  item.textContent = "Tatort-Folgen werden geladen …";
  list.appendChild(item);
}

function applyFilter(query) {
  const search = String(query || "").trim().toLowerCase();
  if (!search) {
    filteredEpisodes = episodes;
    renderEpisodes(filteredEpisodes);
    return;
  }

  filteredEpisodes = episodes.filter((episode) => {
    const year = typeof episode.date === "string" && episode.date.length >= 4 ? episode.date.slice(0, 4) : "";
    const ermittler = String(episode.ermittler || "").toLowerCase();
    const location = String(episode.location || "").toLowerCase();
    return String(episode.no).includes(search)
      || episode.title.toLowerCase().includes(search)
      || year.includes(search)
      || ermittler.includes(search)
      || location.includes(search);
  });

  renderEpisodes(filteredEpisodes);
}

function buildSuggestions(items) {
  suggestions.innerHTML = "";

  const maxSuggestions = Math.min(items.length, 800);
  for (let i = 0; i < maxSuggestions; i += 1) {
    const episode = items[i];
    const year = typeof episode.date === "string" && episode.date.length >= 4 ? episode.date.slice(0, 4) : "";
    const ermittler = String(episode.ermittler || "").trim();
    const location = String(episode.location || "").trim();
    const option = document.createElement("option");
    option.value = `${episode.no} | ${episode.title} | ${year} | ${ermittler} | ${location}`;
    suggestions.appendChild(option);
  }
}

function renderEpisodes(sourceEpisodes) {
  list.innerHTML = "";

  if (sourceEpisodes.length === 0) {
    const empty = document.createElement("li");
    empty.className = "episode-card";
    empty.textContent = "Keine Episoden gefunden.";
    list.appendChild(empty);
    return;
  }

  for (const episode of sourceEpisodes) {
    const row = document.createElement("li");
    row.className = "episode-card";
    if (getEpisodeNumberChoice(episode.no, ANZAHL_KEY, 0) > 0) {
      row.classList.add("viewed");
    }
    row.id = `episode-${episode.no}`;
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.dataset.ranked = isEpisodeRanked(episode.no) ? "true" : "false";

    const location = String(episode.location || "").trim();

    const line = document.createElement("p");
    line.className = "episode-line";
    line.append(document.createTextNode(`${episode.no} - `));

    const boldTitle = document.createElement("strong");
    boldTitle.textContent = episode.title;
    line.append(boldTitle);

    if (location) {
      line.append(document.createTextNode(` (${location})`));
    }

    row.addEventListener("click", () => {
      openEpisodeModal(episode.no);
    });

    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openEpisodeModal(episode.no);
      }
    });

    row.append(line);

    list.appendChild(row);
  }

  if (pendingEpisodeNo !== null) {
    const target = document.getElementById(`episode-${pendingEpisodeNo}`);
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      openEpisodeModal(pendingEpisodeNo);
      pendingEpisodeNo = null;
    }
  }
}

function createRatingArea(episode) {
  const ratingArea = document.createElement("section");
  ratingArea.className = "rating-area";

  const generalRating = document.createElement("div");
  generalRating.className = "rating-row general-rating";
  const generalLabel = document.createElement("span");
  generalLabel.className = "rating-label";
  generalLabel.textContent = "Gesamtbewertung";
  const generalValue = document.createElement("span");
  generalValue.className = "rating-value";
  generalValue.textContent = `${getAverageRating(episode.no).toFixed(1)}/5`;
  const generalStars = createReadOnlyStars(getAverageRating(episode.no));
  generalRating.append(generalLabel, generalValue, generalStars);

  const topFields = createTopFields(episode.no);
  ratingArea.append(topFields, generalRating);

  for (const item of RATING_KEYS) {
    const ratingRow = document.createElement("div");
    ratingRow.className = "rating-row";

    const label = document.createElement("span");
    label.className = "rating-label";
    label.textContent = item.label;

    const stars = createInteractiveStars(episode.no, item.key);
    ratingRow.append(label, stars);
    ratingArea.append(ratingRow);
  }

  const gruseligRow = document.createElement("div");
  gruseligRow.className = "rating-row extra-rating";
  const gruseligLabel = document.createElement("span");
  gruseligLabel.className = "rating-label";
  gruseligLabel.textContent = "gruselig (Kissenfaktor)";
  const gruseligStars = createInteractiveStars(episode.no, GRUSELIG_KEY);
  gruseligRow.append(gruseligLabel, gruseligStars);
  ratingArea.append(gruseligRow);

  const lovedCharacterRow = createCharacterField(episode, MOST_LOVED_KEY, "most loved Charakter");
  const hatedCharacterRow = createCharacterField(episode, MOST_HATED_KEY, "most hated Charakter");
  const besonderheitenRow = createBesonderheitenBlock(episode);
  const kommentarRow = createKommentarField(episode.no);
  ratingArea.append(lovedCharacterRow, hatedCharacterRow, besonderheitenRow, kommentarRow);

  return ratingArea;
}

function createBesonderheitenBlock(episode) {
  const row = document.createElement("div");
  row.className = "rating-row besonderheiten-row";

  const label = document.createElement("span");
  label.className = "rating-label";
  label.textContent = "Besonderheiten";

  const text = document.createElement("p");
  text.className = "besonderheiten-text";
  text.textContent = String(episode.besonderheiten || "").trim() || "Keine Besonderheiten.";

  row.append(label, text);
  return row;
}

function createKommentarField(episodeNo) {
  const row = document.createElement("div");
  row.className = "rating-row kommentar-row";

  const label = document.createElement("span");
  label.className = "rating-label";
  label.textContent = "Kommentare";

  const input = document.createElement("textarea");
  input.className = "kommentar-input";
  input.rows = 3;
  input.placeholder = "Kommentar eingeben";
  input.value = getEpisodeTextChoice(episodeNo, KOMMENTARE_KEY);

  const stop = (event) => {
    event.stopPropagation();
  };

  input.addEventListener("click", stop);
  input.addEventListener("keydown", stop);
  input.addEventListener("input", () => {
    setEpisodeTextChoice(episodeNo, KOMMENTARE_KEY, input.value);
  });

  row.append(label, input);
  return row;
}

function renderEpisodeModal(episodeNo) {
  const episode = episodes.find((item) => Number(item.no) === Number(episodeNo));
  if (!episode || !episodeModalBody || !episodeModalTitle) {
    return;
  }

  const location = String(episode.location || "").trim();
  episodeModalTitle.textContent = location
    ? `${episode.no} - ${episode.title} (${location})`
    : `${episode.no} - ${episode.title}`;

  episodeModalBody.innerHTML = "";
  episodeModalBody.appendChild(createRatingArea(episode));
}

function openEpisodeModal(episodeNo) {
  if (!episodeModal) {
    return;
  }

  currentModalEpisodeNo = Number(episodeNo);
  renderEpisodeModal(currentModalEpisodeNo);
  episodeModal.classList.remove("hidden");
  episodeModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeEpisodeModal() {
  if (!episodeModal) {
    return;
  }
  episodeModal.classList.add("hidden");
  episodeModal.setAttribute("aria-hidden", "true");
  currentModalEpisodeNo = null;
  document.body.classList.remove("modal-open");
}

function createTopFields(episodeNo) {
  const row = document.createElement("div");
  row.className = "rating-row top-fields";

  const left = document.createElement("div");
  left.className = "top-field";

  const leftLabel = document.createElement("span");
  leftLabel.className = "rating-label";
  leftLabel.textContent = "zuerst gesehen";

  const leftControls = document.createElement("div");
  leftControls.className = "top-field-controls";

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "top-date-input";

  const savedDate = getEpisodeTextChoice(episodeNo, ZUERST_GESEHEN_KEY);
  if (/^\d{4}-\d{2}-\d{2}$/.test(savedDate)) {
    dateInput.value = savedDate;
  }

  const commitDateValue = () => {
    setEpisodeTextChoice(episodeNo, ZUERST_GESEHEN_KEY, dateInput.value || "");
    countInput.value = String(getEpisodeNumberChoice(episodeNo, ANZAHL_KEY, 0));
    renderEpisodes(filteredEpisodes);
  };

  dateInput.addEventListener("click", (event) => event.stopPropagation());
  dateInput.addEventListener("keydown", (event) => event.stopPropagation());
  dateInput.addEventListener("change", commitDateValue);
  dateInput.addEventListener("blur", commitDateValue);

  leftControls.append(dateInput);
  left.append(leftLabel, leftControls);

  const right = document.createElement("div");
  right.className = "top-field anzahl-field";

  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "0";
  countInput.step = "1";
  countInput.className = "top-count-input";
  countInput.value = String(getEpisodeNumberChoice(episodeNo, ANZAHL_KEY, 0));

  countInput.addEventListener("click", (event) => event.stopPropagation());
  countInput.addEventListener("keydown", (event) => event.stopPropagation());
  countInput.addEventListener("input", () => {
    setEpisodeNumberChoice(episodeNo, ANZAHL_KEY, countInput.value);
    countInput.value = String(getEpisodeNumberChoice(episodeNo, ANZAHL_KEY, 0));
    renderEpisodes(filteredEpisodes);
    if (currentModalEpisodeNo === Number(episodeNo)) {
      renderEpisodeModal(episodeNo);
    }
  });

  right.append(countInput);
  row.append(left, right);

  return row;
}

function createCharacterField(episode, fieldKey, labelText) {
  const row = document.createElement("div");
  row.className = "rating-row character-row";

  const label = document.createElement("span");
  label.className = "rating-label";
  label.textContent = labelText;

  const controls = document.createElement("div");
  controls.className = "character-controls";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "character-input";
  input.placeholder = "keine Auswahl";
  input.autocomplete = "off";

  const listId = `roles-${episode.no}-${fieldKey}`;
  input.setAttribute("list", listId);

  const datalist = document.createElement("datalist");
  datalist.id = listId;

  for (const roleName of getEpisodeRoleOptions(episode)) {
    const option = document.createElement("option");
    option.value = roleName;
    datalist.appendChild(option);
  }

  const currentValue = getEpisodeTextChoice(episode.no, fieldKey);
  input.value = currentValue;

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "clear-char-btn";
  clearButton.textContent = "Leeren";

  const stop = (event) => {
    event.stopPropagation();
  };

  input.addEventListener("click", stop);
  input.addEventListener("keydown", stop);
  input.addEventListener("input", () => {
    const value = input.value.trim();
    setEpisodeTextChoice(episode.no, fieldKey, value);
  });

  clearButton.addEventListener("click", (event) => {
    event.stopPropagation();
    input.value = "";
    setEpisodeTextChoice(episode.no, fieldKey, "");
  });

  controls.append(input, datalist, clearButton);
  row.append(label, controls);

  return row;
}

function getEpisodeRoleOptions(episode) {
  const roles = Array.isArray(episode.roles) ? episode.roles : [];
  const options = new Set();

  for (const entry of roles) {
    const text = String(entry || "").trim();
    if (!text) {
      continue;
    }
    const parts = text.split(":");
    if (parts.length < 2) {
      continue;
    }
    const roleName = parts.slice(1).join(":").trim();
    if (roleName) {
      options.add(roleName);
    }
  }

  return Array.from(options);
}

function createReadOnlyStars(value) {
  const wrapper = document.createElement("div");
  wrapper.className = "stars readonly";

  for (let star = 1; star <= 5; star += 1) {
    const icon = document.createElement("span");
    icon.className = "star";
    icon.textContent = "★";
    if (star <= Math.round(value)) {
      icon.classList.add("filled");
    }
    wrapper.appendChild(icon);
  }

  return wrapper;
}

function createInteractiveStars(episodeNo, ratingKey) {
  const wrapper = document.createElement("div");
  wrapper.className = "stars interactive";

  const currentValue = getEpisodeRating(episodeNo, ratingKey);

  for (let star = 1; star <= 5; star += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "star-button";
    button.setAttribute("aria-label", `${star} Sterne`);

    const icon = document.createElement("span");
    icon.className = "rating-icon";
    applyRatingIcon(icon, ratingKey);
    button.appendChild(icon);

    if (star <= currentValue) {
      button.classList.add("filled");
      icon.classList.add("filled");
    }

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const existing = getEpisodeRating(episodeNo, ratingKey);
      const nextValue = existing === star ? 0 : star;
      setEpisodeRating(episodeNo, ratingKey, nextValue);
      renderEpisodes(filteredEpisodes);
      if (currentModalEpisodeNo === Number(episodeNo)) {
        renderEpisodeModal(episodeNo);
      }
    });

    wrapper.appendChild(button);
  }

  return wrapper;
}

function applyRatingIcon(element, ratingKey) {
  const rawPath = RATING_ICON_PATHS[ratingKey] || RATING_ICON_PATHS[GESAMT_KEY];
  const encodedPath = encodeURI(rawPath);
  element.style.setProperty("--icon-url", `url("${encodedPath}")`);
}

function getEpisodeRating(episodeNo, ratingKey) {
  const entry = ratingsByEpisode[String(episodeNo)] || {};
  const value = Number(entry[ratingKey] || 0);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(5, value));
}

function setEpisodeRating(episodeNo, ratingKey, value) {
  const key = String(episodeNo);
  const current = ratingsByEpisode[key] || {};
  ratingsByEpisode[key] = {
    ...current,
    [ratingKey]: Math.max(0, Math.min(5, Number(value) || 0))
  };
  ensureEpisodeViewedState(episodeNo);
  persistRatings();
}

function getEpisodeTextChoice(episodeNo, fieldKey) {
  const entry = ratingsByEpisode[String(episodeNo)] || {};
  return String(entry[fieldKey] || "");
}

function setEpisodeTextChoice(episodeNo, fieldKey, value) {
  const key = String(episodeNo);
  const current = ratingsByEpisode[key] || {};
  ratingsByEpisode[key] = {
    ...current,
    [fieldKey]: String(value || "")
  };
  ensureEpisodeViewedState(episodeNo);
  persistRatings();
}

function getEpisodeNumberChoice(episodeNo, fieldKey, defaultValue) {
  const entry = ratingsByEpisode[String(episodeNo)] || {};
  const value = Number(entry[fieldKey]);
  if (!Number.isFinite(value) || value < 0) {
    return defaultValue;
  }
  return Math.floor(value);
}

function setEpisodeNumberChoice(episodeNo, fieldKey, value) {
  const numeric = Number(value);
  let safeValue = Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;

  if (fieldKey === ANZAHL_KEY && safeValue === 0 && shouldAutoSetViewed(episodeNo)) {
    safeValue = 1;
  }

  const key = String(episodeNo);
  const current = ratingsByEpisode[key] || {};
  ratingsByEpisode[key] = {
    ...current,
    [fieldKey]: safeValue
  };
  ensureEpisodeViewedState(episodeNo);
  persistRatings();
}

function shouldAutoSetViewed(episodeNo) {
  const zuerstGesehen = getEpisodeTextChoice(episodeNo, ZUERST_GESEHEN_KEY).trim();
  const hasMainRating = RATING_KEYS.some((item) => getEpisodeRating(episodeNo, item.key) > 0);
  const hasGruseligRating = getEpisodeRating(episodeNo, GRUSELIG_KEY) > 0;
  return Boolean(zuerstGesehen || hasMainRating || hasGruseligRating);
}

function ensureEpisodeViewedState(episodeNo) {
  const key = String(episodeNo);
  const current = ratingsByEpisode[key] || {};
  const anzahl = Number(current[ANZAHL_KEY] || 0);
  if (shouldAutoSetViewed(episodeNo) && (!Number.isFinite(anzahl) || anzahl <= 0)) {
    ratingsByEpisode[key] = {
      ...current,
      [ANZAHL_KEY]: 1
    };
  }
}

function normalizeViewedStateFromRatings() {
  let changed = false;

  for (const [episodeNo] of Object.entries(ratingsByEpisode)) {
    const before = getEpisodeNumberChoice(episodeNo, ANZAHL_KEY, 0);
    ensureEpisodeViewedState(episodeNo);
    const after = getEpisodeNumberChoice(episodeNo, ANZAHL_KEY, 0);
    if (before !== after) {
      changed = true;
    }
  }

  if (changed) {
    persistRatings();
  }
}

function getAverageRating(episodeNo) {
  const values = RATING_KEYS.map((item) => getEpisodeRating(episodeNo, item.key));
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

function isEpisodeRanked(episodeNo) {
  const zuerstGesehen = getEpisodeTextChoice(episodeNo, ZUERST_GESEHEN_KEY).trim();
  const anzahl = getEpisodeNumberChoice(episodeNo, ANZAHL_KEY, 0);
  const hasMainRating = RATING_KEYS.some((item) => getEpisodeRating(episodeNo, item.key) > 0);
  const hasGruseligRating = getEpisodeRating(episodeNo, GRUSELIG_KEY) > 0;
  const mostLoved = getEpisodeTextChoice(episodeNo, MOST_LOVED_KEY).trim();
  const mostHated = getEpisodeTextChoice(episodeNo, MOST_HATED_KEY).trim();

  return Boolean(
    zuerstGesehen
    || anzahl !== 0
    || hasMainRating
    || hasGruseligRating
    || mostLoved
    || mostHated
  );
}

function readRatings() {
  try {
    const raw = localStorage.getItem(RATING_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistRatings() {
  localStorage.setItem(RATING_STORAGE_KEY, JSON.stringify(ratingsByEpisode));
}

function renderErrorState() {
  list.innerHTML = "";
  const item = document.createElement("li");
  item.className = "episode-card";
  item.textContent = "Tatort-Katalog konnte nicht geladen werden.";
  list.appendChild(item);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js");
  });
}

document.querySelectorAll("[data-close-episode-modal]").forEach((element) => {
  element.addEventListener("click", closeEpisodeModal);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && episodeModal && !episodeModal.classList.contains("hidden")) {
    closeEpisodeModal();
  }
});
