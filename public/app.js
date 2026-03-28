const form = document.getElementById("scrape-form");
const status = document.getElementById("status");
const submitButton = document.getElementById("submit-button");
const discoverButton = document.getElementById("discover-button");
const analyzeButton = document.getElementById("analyze-button");
const discoveryPanel = document.getElementById("discovery-panel");
const discoveryCount = document.getElementById("discovery-count");
const discoveryPreview = document.getElementById("discovery-preview");
const summary = document.getElementById("summary");
const resultsList = document.getElementById("results-list");
const downloads = document.getElementById("downloads");
const historyList = document.getElementById("history-list");
const clearHistoryButton = document.getElementById("clear-history-button");

let discoveredItems = [];

await hydrateDefaults();
await loadHistory();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = buildFormPayload();

  setLoading(true);
  setStatus("Ejecutando scraping y revisando el contenido de los artículos...");
  clearResults();
  hideDiscoveryPanel();

  try {
    const response = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "No se pudo completar el scraping.");
    }

    const warningsCount = Array.isArray(data.warnings) ? data.warnings.length : 0;
    setStatus(warningsCount ? `Scraping completado con ${warningsCount} advertencia(s).` : "Scraping completado.");
    renderSummary(data);
    renderDownloads(data.files);
    renderResults(data.items);
    document.getElementById("resetKnownMatches").checked = false;
    await loadHistory();
  } catch (error) {
    setStatus(error.message || "Se produjo un error ejecutando el scraping.");
  } finally {
    setLoading(false);
  }
});

discoverButton.addEventListener("click", async () => {
  const payload = buildFormPayload();

  setDiscovering(true);
  setStatus("Descubriendo artículos en el listado (sin entrar a cada uno)...");
  clearResults();
  hideDiscoveryPanel();

  try {
    const response = await fetch("/api/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "No se pudo completar el descubrimiento.");
    }

    discoveredItems = Array.isArray(data.items) ? data.items : [];
    const maxPagesConfigured = Number(document.getElementById("maxPages")?.value || 10);
    renderDiscoveryPanel(data, maxPagesConfigured);
    const reachedEnd = data.stats?.reachedEnd ? " (fin del listado alcanzado)" : ` de ${maxPagesConfigured} configuradas`;
    setStatus(`Descubrimiento completado. Se encontraron ${discoveredItems.length} artículo(s) en ${data.stats?.pagesVisited ?? 0} página(s)${reachedEnd}.`);
  } catch (error) {
    setStatus(error.message || "Se produjo un error en el descubrimiento.");
  } finally {
    setDiscovering(false);
  }
});

analyzeButton.addEventListener("click", async () => {
  if (!discoveredItems.length) {
    setStatus("No hay artículos descubiertos para analizar.");
    return;
  }

  const payload = { ...buildFormPayload(), items: discoveredItems };

  setAnalyzing(true);
  clearResults();
  const total = discoveredItems.length;
  const estimatedMinutes = Math.ceil((total * 5) / 60);
  setStatus(`Analizando ${total} artículo(s) uno a uno... Esto puede tardar ~${estimatedMinutes} minuto(s). No cierres la ventana.`);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "No se pudo completar el análisis.");
    }

    const warningsCount = Array.isArray(data.warnings) ? data.warnings.length : 0;
    setStatus(warningsCount ? `Análisis completado con ${warningsCount} advertencia(s).` : "Análisis completado.");
    renderAnalysisSummary(data);
    renderDownloads(data.files);
    renderResults(data.items);
    document.getElementById("resetKnownMatches").checked = false;
    await loadHistory();
  } catch (error) {
    setStatus(error.message || "Se produjo un error en el análisis.");
  } finally {
    setAnalyzing(false);
  }
});

historyList.addEventListener("click", async (event) => {
  const useButton = event.target.closest("[data-action='use-run']");
  if (useButton) {
    applyRunToForm(JSON.parse(useButton.dataset.payload));
    return;
  }

  const viewButton = event.target.closest("[data-action='view-run']");
  if (viewButton) {
    await loadHistoryRunResults(Number(viewButton.dataset.runId));
    return;
  }

  const deleteButton = event.target.closest("[data-action='delete-run']");
  if (deleteButton) {
    await deleteRun(Number(deleteButton.dataset.runId));
  }
});

clearHistoryButton.addEventListener("click", async () => {
  if (!window.confirm("Esto eliminará todas las corridas, resultados guardados, cache de coincidencias y el progreso de continuación. ¿Deseas continuar?")) {
    return;
  }

  setStatus("Borrando historial completo...");

  try {
    const response = await fetch("/api/history/clear", { method: "POST" });
    const data = await response.json();

    if (!response.ok || !data.cleared) {
      throw new Error(data.error || "No se pudo borrar el historial.");
    }

    clearResults();
    await loadHistory();
    setStatus("Historial completo borrado.");
  } catch (error) {
    setStatus(error.message || "No se pudo borrar el historial.");
  }
});

async function hydrateDefaults() {
  try {
    const response = await fetch("/api/defaults");
    const defaults = await response.json();

    if (!response.ok) {
      return;
    }

    for (const [key, value] of Object.entries(defaults)) {
      const field = document.getElementById(key);
      if (!field) {
        continue;
      }

      if (field.type === "checkbox") {
        field.checked = Boolean(value);
      } else {
        field.value = value;
      }
    }
  } catch {
  }
}

async function loadHistory() {
  historyList.innerHTML = `<div class="empty compact">Cargando historial...</div>`;

  try {
    const response = await fetch("/api/history");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "No se pudo cargar el historial.");
    }

    renderHistory(data.runs || []);
  } catch (error) {
    historyList.innerHTML = `<div class="empty compact">${escapeHtml(error.message || "No se pudo cargar el historial.")}</div>`;
  }
}

async function loadHistoryRunResults(runId) {
  setStatus("Cargando resultados guardados de esa corrida...");
  clearResults();

  try {
    const response = await fetch(`/api/history/${runId}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "No se pudieron cargar los resultados guardados.");
    }

    summary.innerHTML = `<strong>${data.items.length}</strong> resultado(s) recuperados del historial.`;
    renderResults(data.items || []);
    downloads.innerHTML = "";
    setStatus("Resultados cargados desde el historial.");
  } catch (error) {
    setStatus(error.message || "No se pudieron cargar los resultados del historial.");
  }
}

async function deleteRun(runId) {
  if (!window.confirm("¿Deseas eliminar esta corrida del historial?")) {
    return;
  }

  setStatus("Eliminando corrida...");

  try {
    const response = await fetch(`/api/history/${runId}`, { method: "DELETE" });
    const data = await response.json();

    if (!response.ok || !data.deleted) {
      throw new Error(data.error || "No se pudo eliminar la corrida.");
    }

    await loadHistory();
    setStatus("Corrida eliminada del historial.");
  } catch (error) {
    setStatus(error.message || "No se pudo eliminar la corrida.");
  }
}

function renderHistory(runs) {
  if (!runs.length) {
    historyList.innerHTML = `<div class="empty compact">Todavía no hay búsquedas registradas.</div>`;
    return;
  }

  historyList.innerHTML = runs
    .map((run) => {
      const payload = escapeAttributeJson({
        url: run.startUrl,
        keyword: run.keyword,
        maxPages: run.maxPages,
      });

      return `
        <article class="history-card">
          <div class="history-top">
            <strong>${escapeHtml(run.keyword || "Sin palabra clave")}</strong>
            <span>${formatDate(run.createdAt)}</span>
          </div>
          <p>${escapeHtml(run.startUrl)}</p>
          <div class="history-stats">
            <span>${run.uniqueItems} nuevos</span>
            <span>${run.skippedKnownUrls} omitidos</span>
            <span>${run.pagesVisited} páginas</span>
          </div>
          <div class="history-actions">
            <button type="button" class="secondary-button" data-action="view-run" data-run-id="${run.id}">Ver</button>
            <button type="button" class="secondary-button" data-action="use-run" data-payload="${payload}">Reusar</button>
            <button type="button" class="secondary-button danger-button" data-action="delete-run" data-run-id="${run.id}">Eliminar</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function applyRunToForm(run) {
  document.getElementById("url").value = run.url || "";
  document.getElementById("keyword").value = run.keyword || "";
  if (run.maxPages) {
    document.getElementById("maxPages").value = run.maxPages;
  }
  setStatus("Se cargaron los filtros de una búsqueda anterior. Si ejecutas de nuevo, la búsqueda continuará desde la siguiente página pendiente de esa combinación URL + palabra clave.");
}

function buildFormPayload() {
  const formData = new FormData(form);
  return {
    url: formData.get("url")?.toString().trim(),
    keyword: formData.get("keyword")?.toString().trim(),
    maxPages: Number(formData.get("maxPages") || 10),
    itemSelector: formData.get("itemSelector")?.toString().trim(),
    titleSelector: formData.get("titleSelector")?.toString().trim(),
    summarySelector: formData.get("summarySelector")?.toString().trim(),
    urlSelector: formData.get("urlSelector")?.toString().trim(),
    nextButtonSelector: formData.get("nextButtonSelector")?.toString().trim(),
    skipKnownMatches: document.getElementById("skipKnownMatches").checked,
    resetKnownMatches: document.getElementById("resetKnownMatches").checked,
  };
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  discoverButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Buscando..." : "Ejecutar scraping";
}

function setDiscovering(isDiscovering) {
  discoverButton.disabled = isDiscovering;
  submitButton.disabled = isDiscovering;
  discoverButton.textContent = isDiscovering ? "Descubriendo..." : "Descubrir artículos";
}

function setAnalyzing(isAnalyzing) {
  analyzeButton.disabled = isAnalyzing;
  analyzeButton.textContent = isAnalyzing ? "Analizando..." : "Analizar artículos";
}

function renderDiscoveryPanel(data, maxPagesConfigured = 10) {
  const total = Array.isArray(data.items) ? data.items.length : 0;
  const pages = data.stats?.pagesVisited ?? 0;
  const reachedEnd = data.stats?.reachedEnd;
  const coverageNote = reachedEnd
    ? `Se recorrió el listado completo (${pages} páginas).`
    : `Se revisaron ${pages} de ${maxPagesConfigured} páginas configuradas. Puede haber más artículos en páginas siguientes.`;
  discoveryCount.innerHTML = `Se encontraron <strong>${total}</strong> artículo(s). ${coverageNote}<br>Haz clic en "Analizar artículos" para buscar la palabra clave en su contenido.`;

  const preview = (data.items || []).slice(0, 5);
  discoveryPreview.innerHTML = preview
    .map((item) => {
      const title = escapeHtml(item.title || "Sin título");
      const url = item.url ? escapeHtml(item.url) : "";
      return `<li>${url ? `<a href="${url}" target="_blank" rel="noreferrer">${title}</a>` : title}</li>`;
    })
    .join("");

  if (total > 5) {
    discoveryPreview.innerHTML += `<li><em>... y ${total - 5} más</em></li>`;
  }

  discoveryPanel.hidden = false;
}

function hideDiscoveryPanel() {
  discoveryPanel.hidden = true;
  discoveryPreview.innerHTML = "";
  discoveryCount.textContent = "";
  discoveredItems = [];
}

function renderAnalysisSummary(data) {
  const warningsText = Array.isArray(data.warnings) && data.warnings.length
    ? `<br><small>${escapeHtml(data.warnings[0])}${data.warnings.length > 1 ? ` y ${data.warnings.length - 1} más.` : ""}</small>`
    : "";
  summary.innerHTML = `
    <strong>${data.stats?.uniqueItems ?? 0}</strong> coincidencia(s) encontradas de ${data.stats?.analyzedItems ?? 0} artículo(s) analizados.${warningsText}
  `;
}

function setStatus(message) {
  status.textContent = message;
}

function clearResults() {
  summary.innerHTML = "";
  downloads.innerHTML = "";
  resultsList.innerHTML = "";
}

function renderSummary(data) {
  const skippedPageWarnings = extractSkippedPageWarnings(data.warnings);
  const progressLabel = buildProgressLabel(data.stats);
  const warnings = Array.isArray(data.warnings) && data.warnings.length
    ? `<br><small>${escapeHtml(data.warnings[0])}${data.warnings.length > 1 ? ` y ${data.warnings.length - 1} más.` : ""}</small>`
    : "";

  const skipped = Number(data.stats?.skippedKnownUrls || 0)
    ? `<br><small>Se omitieron ${data.stats.skippedKnownUrls} URL(s) ya encontradas para esta misma búsqueda.</small>`
    : "";

  const resumed = data.stats?.startedFromSavedProgress
    ? `<br><small>La corrida continuó desde una página pendiente guardada anteriormente.</small>`
    : "";

  const resumedPage = data.stats?.resumedFromUrl
    ? `<br><small>Retomó desde ${escapeHtml(formatPageLabel(data.stats.resumedFromUrl, data.startUrl || ""))}.</small>`
    : "";

  const lastVisitedPage = data.stats?.lastVisitedUrl
    ? `<br><small>Última página revisada: ${escapeHtml(formatPageLabel(data.stats.lastVisitedUrl, data.startUrl || ""))}.</small>`
    : "";

  const nextPendingPage = data.stats?.nextPageUrl
    ? `<br><small>Siguiente página pendiente: ${escapeHtml(formatPageLabel(data.stats.nextPageUrl, data.startUrl || ""))}.</small>`
    : "";

  const nextStep = data.stats?.hasPendingPages
    ? `<br><small>Quedó guardada la siguiente página para continuar automáticamente en la próxima ejecución.</small>`
    : data.stats?.reachedEnd
      ? `<br><small>Se alcanzó el final del listado disponible para esta búsqueda.</small>`
      : "";

  const skippedFailedPages = skippedPageWarnings.length
    ? `<br><small>Se saltó ${skippedPageWarnings.length} página(s) fallida(s) y la corrida siguió avanzando.</small><br><small>${escapeHtml(skippedPageWarnings[0])}</small>`
    : "";

  const progressMarkup = buildProgressMarkup(data.stats);

  summary.innerHTML = `
    ${progressLabel ? `<small><strong>${escapeHtml(progressLabel)}</strong></small><br>` : ""}
    ${progressMarkup}
    <strong>${data.stats.uniqueItems}</strong> coincidencias nuevas, ${data.stats.pagesVisited} página(s) revisadas y ${data.stats.extractedItems} item(s) extraídos.${skipped}${resumed}${resumedPage}${lastVisitedPage}${nextPendingPage}${nextStep}${skippedFailedPages}${warnings}
  `;
}

function renderDownloads(files) {
  if (!files?.jsonUrl && !files?.csvUrl && !files?.xlsxUrl) {
    return;
  }

  downloads.innerHTML = `
    ${files.jsonUrl ? `<a href="${files.jsonUrl}" target="_blank" rel="noreferrer">JSON</a>` : ""}
    ${files.csvUrl ? `<a href="${files.csvUrl}" target="_blank" rel="noreferrer">CSV</a>` : ""}
    ${files.xlsxUrl ? `<a href="${files.xlsxUrl}" target="_blank" rel="noreferrer">Excel</a>` : ""}
  `;
}

function renderResults(items) {
  if (!items?.length) {
    resultsList.innerHTML = `<div class="empty">No se encontraron coincidencias nuevas para esa palabra clave.</div>`;
    return;
  }

  resultsList.innerHTML = items
    .map((item) => {
      const title = escapeHtml(item.title || "Sin título");
      const summaryText = escapeHtml(item.summary || "Sin resumen");
      const url = item.url ? escapeHtml(item.url) : "";
      const keywordChips = (item.matchedKeywords || [])
        .map((keyword) => `<span class="chip">${escapeHtml(keyword)}</span>`)
        .join("");

      return `
        <article class="result-card">
          <div class="result-head">
            <h3>${title}</h3>
            <div class="chips">${keywordChips}</div>
          </div>
          <p>${summaryText}</p>
          ${url ? `<a class="result-link" href="${url}" target="_blank" rel="noreferrer">Abrir artículo</a>` : ""}
        </article>
      `;
    })
    .join("");
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString("es-CO", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return String(value || "");
  }
}

function formatPageLabel(value, fallbackStartUrl = "") {
  if (!value) {
    return "una página desconocida";
  }

  try {
    const url = new URL(value, window.location.origin);
    const page = Number(url.searchParams.get("p") || "1");

    if (Number.isFinite(page) && page > 0) {
      return `la página ${page}`;
    }
  } catch {
  }

  if (fallbackStartUrl && value === fallbackStartUrl) {
    return "la página 1";
  }

  return value;
}

function extractSkippedPageWarnings(warnings) {
  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings.filter((warning) => String(warning).toLowerCase().includes("se omitio la pagina fallida"));
}

function buildProgressLabel(stats) {
  const lastVisitedPage = extractPageNumber(stats?.lastVisitedUrl);
  const nextPendingPage = extractPageNumber(stats?.nextPageUrl);

  if (lastVisitedPage && nextPendingPage) {
    return `Progreso acumulado del listado: se llegó hasta la página ${lastVisitedPage} y la siguiente pendiente es la ${nextPendingPage}.`;
  }

  if (lastVisitedPage) {
    return `Progreso acumulado del listado: se llegó hasta la página ${lastVisitedPage}.`;
  }

  if (nextPendingPage) {
    return `Progreso acumulado del listado: la siguiente página pendiente es la ${nextPendingPage}.`;
  }

  return "";
}

function extractPageNumber(value) {
  if (!value) {
    return 0;
  }

  try {
    const url = new URL(value, window.location.origin);
    const page = Number(url.searchParams.get("p") || "1");
    return Number.isFinite(page) && page > 0 ? page : 0;
  } catch {
    return 0;
  }
}

function buildProgressMarkup(stats) {
  const currentPage = extractPageNumber(stats?.lastVisitedUrl) || extractPageNumber(stats?.nextPageUrl);
  const totalPages = Number(document.getElementById("maxPages")?.max || 29);

  if (!currentPage || !Number.isFinite(totalPages) || totalPages <= 0) {
    return "";
  }

  const percentage = Math.max(0, Math.min((currentPage / totalPages) * 100, 100));

  return `
    <div class="summary-progress" aria-label="Progreso del listado">
      <div class="summary-progress-track">
        <div class="summary-progress-fill" style="width: ${percentage.toFixed(1)}%"></div>
      </div>
      <div class="summary-progress-meta">Página ${currentPage} de ${totalPages} configuradas</div>
    </div>
  `;
}

function escapeAttributeJson(value) {
  return escapeHtml(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
