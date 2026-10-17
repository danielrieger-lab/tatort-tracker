const EXPORT_STORAGE_KEYS = [
  "tatort-tracker-ratings-v1",
  "tatort-tracker-episodes-cache-v1",
  "tatort-tracker-failed-roles-v1",
  "tatort-tracker-location-cache-v1",
  "tatort-tracker-sync-last-run-v1",
  "tatorttracker.episodes.v1",
  "tatorttracker.broadcast-count.v1",
  "tatorttracker.broadcast-count.v2"
];
const EXPORT_FILE_NAME = "tatorttracker-backup.json";
const TEXT_RATING_FIELDS = [
  "zuerstGesehen",
  "mostLovedCharacter",
  "mostHatedCharacter",
  "kommentare"
];

function createRatingsExport(rawValue) {
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return rawValue;
    }

    const ratings = {};
    for (const [episodeNo, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        ratings[episodeNo] = entry;
        continue;
      }

      ratings[episodeNo] = { ...entry };
      for (const field of TEXT_RATING_FIELDS) {
        if (!(field in ratings[episodeNo])) {
          ratings[episodeNo][field] = "";
        }
      }
    }

    return JSON.stringify(ratings);
  } catch {
    return rawValue;
  }
}

function createExportPayload() {
  const localStorageData = {};

  for (const key of EXPORT_STORAGE_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) {
      localStorageData[key] = key === "tatort-tracker-ratings-v1"
        ? createRatingsExport(value)
        : value;
    }
  }

  return { localStorage: localStorageData };
}

function setExportStatus(message, isError = false) {
  document.querySelectorAll("[data-export-status]").forEach((element) => {
    element.textContent = message;
    element.classList.toggle("export-status-error", isError);
  });
}

function downloadExport(blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = EXPORT_FILE_NAME;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportData() {
  try {
    const json = JSON.stringify(createExportPayload(), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    if (typeof File === "function" && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
      const file = new File([blob], EXPORT_FILE_NAME, { type: "application/json" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: "Tatort Tracker Daten",
            files: [file]
          });
          setExportStatus("Daten wurden geteilt.");
          return;
        } catch (error) {
          if (error && error.name === "AbortError") {
            setExportStatus("Export abgebrochen.");
            return;
          }
        }
      }
    }

    downloadExport(blob);
    setExportStatus("Daten wurden als JSON-Datei heruntergeladen.");
  } catch (error) {
    setExportStatus("Export konnte nicht erstellt werden.", true);
  }
}

document.querySelectorAll("[data-export-data]").forEach((button) => {
  button.addEventListener("click", exportData);
});