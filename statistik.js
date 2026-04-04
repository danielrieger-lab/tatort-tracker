const RATING_STORAGE_KEY = "tatort-tracker-ratings-v1";
const ERMITTLER_RANKING_STORAGE_KEY = "tatort-tracker-ermittler-rankings-v1";
const LOCATION_RANKING_STORAGE_KEY = "tatort-tracker-location-rankings-v1";
const EPISODES_SOURCE = "data/tatort-episodes.json";

const modal = document.getElementById("stat-modal");
const status = document.getElementById("stat-modal-status");
const list = document.getElementById("stat-modal-list");
const podium = document.getElementById("stat-podium");
const hint = document.querySelector(".stat-modal-hint");
const statTiles = document.querySelectorAll(".stat-tile");
const statAverageValue = document.getElementById("stat-average-value");

let episodes = [];
let ratingsByEpisode = readRatings();
let currentMode = "best";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
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

function refreshRatingsAndAverageTile() {
  ratingsByEpisode = readRatings();
  updateOverallGeneralMeanTile();
}

function getEpisodeRating(episodeNo, ratingKey) {
  const entry = ratingsByEpisode[String(episodeNo)] || {};
  const value = Number(entry[ratingKey] || 0);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(5, value));
}

function getAverageRating(episodeNo) {
  const keys = ["fallqualitaet", "team", "inszenierung", "spannung"];
  const sum = keys.reduce((acc, key) => acc + getEpisodeRating(episodeNo, key), 0);
  return sum / keys.length;
}

function getTeamScoreByErmittler() {
  const groups = new Map();

  for (const episode of episodes) {
    const ermittler = String(episode.ermittler || "").trim();
    if (!ermittler) {
      continue;
    }

    const key = normalizeText(ermittler);
    if (!groups.has(key)) {
      groups.set(key, {
        ermittler,
        episodes: [],
        ratedEpisodes: [],
        generalValues: [],
        teamValues: [],
        generalMean: 0,
        teamMean: 0,
        score: 0
      });
    }

    const group = groups.get(key);
    const general = getAverageRating(episode.no);
    const team = getEpisodeRating(episode.no, "team");

    group.episodes.push(episode);

    const isRated = general > 0 || team > 0;
    if (general > 0) {
      group.generalValues.push(general);
    }
    if (isRated) {
      group.ratedEpisodes.push(episode);
      group.teamValues.push(team);
    }
  }

  for (const group of groups.values()) {
    group.generalMean = group.generalValues.length
      ? group.generalValues.reduce((acc, value) => acc + value, 0) / group.generalValues.length
      : 0;
    group.teamMean = group.teamValues.length
      ? group.teamValues.reduce((acc, value) => acc + value, 0) / group.teamValues.length
      : 0;
    group.score = (group.generalMean + group.teamMean) / 2;

    for (const episode of group.episodes) {
      episode.ermittlerRanking = group.score;
    }
  }

  persistErmittlerRankings(groups);

  return groups;
}

function persistErmittlerRankings(groups) {
  const payload = {};

  for (const [key, group] of groups.entries()) {
    payload[key] = {
      ermittler: group.ermittler,
      generalMean: group.generalMean,
      teamMean: group.teamMean,
      ermittlerRanking: group.score,
      ratedEpisodes: group.ratedEpisodes.length
    };
  }

  try {
    localStorage.setItem(ERMITTLER_RANKING_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function getLocationScoreByLocation() {
  const groups = new Map();

  for (const episode of episodes) {
    const location = String(episode.location || "").trim();
    if (!location) {
      continue;
    }

    const key = normalizeText(location);
    if (!groups.has(key)) {
      groups.set(key, {
        location,
        episodes: [],
        ratedEpisodes: [],
        generalValues: [],
        score: 0
      });
    }

    const group = groups.get(key);
    const general = getAverageRating(episode.no);

    group.episodes.push(episode);
    if (general > 0) {
      group.ratedEpisodes.push(episode);
      group.generalValues.push(general);
    }
  }

  for (const group of groups.values()) {
    group.score = group.generalValues.length
      ? group.generalValues.reduce((acc, value) => acc + value, 0) / group.generalValues.length
      : 0;

    for (const episode of group.episodes) {
      episode.locationRating = group.score;
    }
  }

  persistLocationRankings(groups);

  return groups;
}

function persistLocationRankings(groups) {
  const payload = {};

  for (const [key, group] of groups.entries()) {
    payload[key] = {
      location: group.location,
      locationRating: group.score,
      ratedEpisodes: group.ratedEpisodes.length
    };
  }

  try {
    localStorage.setItem(LOCATION_RANKING_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function getDominantLocation(group) {
  const candidates = group.ratedEpisodes.length > 0 ? group.ratedEpisodes : group.episodes;
  const locationCount = new Map();

  for (const episode of candidates) {
    const location = String(episode.location || "").trim();
    if (!location) {
      continue;
    }
    const key = normalizeText(location);
    if (!locationCount.has(key)) {
      locationCount.set(key, { label: location, count: 0 });
    }
    locationCount.get(key).count += 1;
  }

  let best = "";
  let count = 0;
  for (const item of locationCount.values()) {
    if (item.count > count) {
      best = item.label;
      count = item.count;
    }
  }

  return best;
}

function getGroupScore(group) {
  return Number(group.score || 0);
}

function formatScore(value) {
  return `${value.toFixed(1)}/5`;
}

function updateOverallGeneralMeanTile() {
  if (!statAverageValue) {
    return;
  }

  const ratedValues = episodes
    .map((episode) => getAverageRating(episode.no))
    .filter((value) => value > 0);

  if (ratedValues.length === 0) {
    statAverageValue.textContent = "--/5";
    return;
  }

  const mean = ratedValues.reduce((acc, value) => acc + value, 0) / ratedValues.length;
  statAverageValue.textContent = formatScore(mean);
}

function openModal() {
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function renderList() {
  list.innerHTML = "";
  if (podium) {
    podium.innerHTML = "";
    podium.classList.add("hidden");
  }

  let ranked;

  if (currentMode === "teams" || currentMode === "worstTeams") {
    ranked = Array.from(getTeamScoreByErmittler().values())
      .map((group) => ({
        ermittler: group.ermittler,
        location: getDominantLocation(group),
        score: getGroupScore(group)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (currentMode === "worstTeams") {
          return (a.score - b.score) || a.ermittler.localeCompare(b.ermittler, "de");
        }
        return (b.score - a.score) || a.ermittler.localeCompare(b.ermittler, "de");
      })
      .slice(0, 10);
  } else if (currentMode === "cities" || currentMode === "worstCities") {
    ranked = Array.from(getLocationScoreByLocation().values())
      .map((group) => ({
        location: group.location,
        score: Number(group.score || 0)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (currentMode === "worstCities") {
          return (a.score - b.score) || a.location.localeCompare(b.location, "de");
        }
        return (b.score - a.score) || a.location.localeCompare(b.location, "de");
      })
      .slice(0, 10);
  } else if (currentMode === "scary") {
    ranked = episodes
      .map((episode) => ({
        episode,
        score: getEpisodeRating(episode.no, "gruselig")
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => (b.score - a.score) || (a.episode.no - b.episode.no))
      .slice(0, 10);
  } else {
    ranked = episodes
      .map((episode) => ({
        episode,
        score: getAverageRating(episode.no)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (currentMode === "worst") {
          return (a.score - b.score) || (a.episode.no - b.episode.no);
        }
        return (b.score - a.score) || (a.episode.no - b.episode.no);
      })
      .slice(0, 10);
  }

  if (ranked.length === 0) {
    if (currentMode === "teams" || currentMode === "worstTeams") {
      status.textContent = "Noch keine bewerteten Teams gespeichert.";
    } else if (currentMode === "cities" || currentMode === "worstCities") {
      status.textContent = "Noch keine bewerteten Städte gespeichert.";
    } else if (currentMode === "scary") {
      status.textContent = "Noch keine Gruselig-Rankings gespeichert.";
    } else {
      status.textContent = "Noch keine Folgen mit Gesamtwertung gespeichert.";
    }
    return;
  }

  status.textContent = "";

  let listItems = ranked;

  if (currentMode === "best") {
    const podiumItems = ranked.slice(0, 3);
    listItems = ranked.slice(3);

    if (podiumItems.length > 0) {
      podium.classList.remove("hidden");
      const heading = document.createElement("div");
      heading.className = "stat-podium-heading";
      heading.textContent = "Gewinnerpodest";

      const podiumColumns = document.createElement("div");
      podiumColumns.className = "stat-podium-columns";

      const order = [1, 0, 2];
      order.forEach((itemIndex) => {
        const item = podiumItems[itemIndex];
        if (!item) {
          return;
        }

        const place = itemIndex + 1;
        const entry = document.createElement("button");
        entry.type = "button";
        entry.className = `stat-podium-card place-${place}`;
        entry.innerHTML = `
          <span class="podium-place">${place}.</span>
          <span class="podium-title">${escapeHtml(item.episode.title)}</span>
          <span class="podium-score">${formatScore(item.score)}</span>
        `;

        entry.addEventListener("click", () => {
          window.location.href = `index.html?episode=${encodeURIComponent(item.episode.no)}`;
        });

        podiumColumns.appendChild(entry);
      });

      podium.append(heading, podiumColumns);
    }
  }

  listItems.forEach((item, index) => {
    const positionNumber = currentMode === "best" ? index + 4 : index + 1;
    const position = `${positionNumber}.`;
    let entry;
    if (currentMode === "teams" || currentMode === "worstTeams") {
      entry = document.createElement("div");
      entry.className = "stat-modal-entry";
      const locationPart = item.location ? ` (${escapeHtml(item.location)})` : "";
      entry.innerHTML = `
        <span class="entry-left"><span class="entry-no">${position}</span><span class="entry-title">${escapeHtml(item.ermittler)}${locationPart}</span></span>
        <span class="entry-score">${formatScore(item.score)}</span>
      `;
    } else if (currentMode === "cities" || currentMode === "worstCities") {
      entry = document.createElement("div");
      entry.className = "stat-modal-entry";
      entry.innerHTML = `
        <span class="entry-left"><span class="entry-no">${position}</span><span class="entry-title">${escapeHtml(item.location)}</span></span>
        <span class="entry-score">${formatScore(item.score)}</span>
      `;
    } else if (currentMode === "scary") {
      entry = document.createElement("div");
      entry.className = "stat-modal-entry";
      entry.innerHTML = `
        <span class="entry-left"><span class="entry-no">${position}</span><span class="entry-title">${escapeHtml(item.episode.title)}</span></span>
        <span class="entry-score">${formatScore(item.score)}</span>
      `;
    } else {
      entry = document.createElement("button");
      entry.type = "button";
      entry.className = "stat-modal-entry";
      entry.innerHTML = `
        <span class="entry-left"><span class="entry-no">${position}</span><span class="entry-title">${escapeHtml(item.episode.title)}</span></span>
        <span class="entry-score">${formatScore(item.score)}</span>
      `;

      entry.addEventListener("click", () => {
        window.location.href = `index.html?episode=${encodeURIComponent(item.episode.no)}`;
      });
    }

    list.appendChild(entry);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadEpisodes() {
  try {
    const response = await fetch(EPISODES_SOURCE, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    episodes = Array.isArray(data) ? data : [];
    updateOverallGeneralMeanTile();
    renderList();
  } catch {
    status.textContent = "Die Statistik konnte nicht geladen werden.";
    updateOverallGeneralMeanTile();
  }
}

function openList(mode) {
  currentMode = mode;
  const title = document.getElementById("stat-modal-title");
  if (mode === "worst") {
    title.textContent = "Schlechteste Folgen";
    if (hint) {
      hint.textContent = "Tippe auf eine Folge, um sie auf der Episoden-Seite zu öffnen.";
    }
  } else if (mode === "worstTeams") {
    title.textContent = "Schlechteste Teams";
    if (hint) {
      hint.textContent = "Ermittler-Ranking nach Team- und Gesamtbewertung.";
    }
  } else if (mode === "cities") {
    title.textContent = "Beste Städte";
    if (hint) {
      hint.textContent = "Städte-Ranking nach mittlerer Gesamtbewertung aller bewerteten Folgen.";
    }
  } else if (mode === "worstCities") {
    title.textContent = "Schlechteste Städte";
    if (hint) {
      hint.textContent = "Städte-Ranking nach mittlerer Gesamtbewertung aller bewerteten Folgen.";
    }
  } else if (mode === "teams") {
    title.textContent = "Beste Teams";
    if (hint) {
      hint.textContent = "Ermittler-Ranking nach Team- und Gesamtbewertung.";
    }
  } else if (mode === "scary") {
    title.textContent = "Gruseligste Folgen";
    if (hint) {
      hint.textContent = "Top 5 nach Gruselranking.";
    }
  } else {
    title.textContent = "Beste Folgen";
    if (hint) {
      hint.textContent = "Tippe auf eine Folge, um sie auf der Episoden-Seite zu öffnen.";
    }
  }
  openModal();

  if (episodes.length === 0) {
    loadEpisodes();
    return;
  }

  renderList();
}

if (statTiles[0]) {
  statTiles[0].style.cursor = "pointer";
  statTiles[0].addEventListener("click", () => openList("best"));
}

if (statTiles[1]) {
  statTiles[1].style.cursor = "pointer";
  statTiles[1].addEventListener("click", () => openList("worst"));
}

if (statTiles[2]) {
  statTiles[2].style.cursor = "pointer";
  statTiles[2].addEventListener("click", () => openList("teams"));
}

if (statTiles[3]) {
  statTiles[3].style.cursor = "pointer";
  statTiles[3].addEventListener("click", () => openList("worstTeams"));
}

if (statTiles[4]) {
  statTiles[4].style.cursor = "pointer";
  statTiles[4].addEventListener("click", () => openList("cities"));
}

if (statTiles[5]) {
  statTiles[5].style.cursor = "pointer";
  statTiles[5].addEventListener("click", () => openList("worstCities"));
}

if (statTiles[6]) {
  statTiles[6].style.cursor = "pointer";
  statTiles[6].addEventListener("click", () => openList("scary"));
}

window.addEventListener("storage", (event) => {
  if (event.key === RATING_STORAGE_KEY || event.key === null) {
    refreshRatingsAndAverageTile();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshRatingsAndAverageTile();
  }
});

document.querySelectorAll("[data-close-stat-modal]").forEach((element) => {
  element.addEventListener("click", closeModal);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.classList.contains("hidden")) {
    closeModal();
  }
});

modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

loadEpisodes();
