import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../env.js";
import { clearAllHistory, deleteRun, ensureDatabaseSchema, getRecentRuns, getRunResults } from "./db.js";
import { logger } from "./logger.js";
import { loadJsonConfig, resolveOutputUrls, runScraper } from "./scraper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const outputDir = path.join(rootDir, "outputs");
const fallbackConfigPath = path.join(rootDir, "scraper.config.example.json");
const port = Number(process.env.PORT || 3000);

const DEFAULTS = {
  startUrl: "https://clubmamasypapas.com/contenidos",
  keyword: "Mi manual del bebe",
  maxPages: 10,
  itemSelector: ".post-item-details",
  titleSelector: ".post-item-name span",
  summarySelector: ".blog-item-description span",
  urlSelector: ".post-item-link a",
  nextButtonSelector: ".pages-item-next a.next",
  skipKnownMatches: true,
  resetKnownMatches: false
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      return serveFile(path.join(publicDir, "index.html"), response);
    }

    if (request.method === "GET" && request.url === "/api/defaults") {
      return sendJson(response, 200, DEFAULTS);
    }

    if (request.method === "GET" && request.url === "/api/history") {
      const runs = await getRecentRuns(10);
      return sendJson(response, 200, { runs });
    }

    if (request.method === "GET" && request.url?.startsWith("/api/history/")) {
      const match = request.url.match(/^\/api\/history\/(\d+)$/);
      if (!match) {
        return sendJson(response, 404, { error: "Historial no encontrado." });
      }

      const items = await getRunResults(Number(match[1]));
      return sendJson(response, 200, { items });
    }

    if (request.method === "DELETE" && request.url?.startsWith("/api/history/")) {
      const match = request.url.match(/^\/api\/history\/(\d+)$/);
      if (!match) {
        return sendJson(response, 404, { error: "Corrida no encontrada." });
      }

      const deleted = await deleteRun(Number(match[1]));
      return sendJson(response, 200, { deleted });
    }

    if (request.method === "POST" && request.url === "/api/history/clear") {
      await clearAllHistory();
      return sendJson(response, 200, { cleared: true });
    }

    if (request.method === "GET" && request.url?.startsWith("/outputs/")) {
      const fileName = path.basename(request.url.replace("/outputs/", ""));
      return serveFile(path.join(outputDir, fileName), response);
    }

    if (request.method === "GET") {
      const assetPath = path.join(publicDir, path.basename(request.url || ""));
      return serveFile(assetPath, response);
    }

    if (request.method === "POST" && request.url === "/api/scrape") {
      const body = await readJsonBody(request);
      const config = await buildConfig(body);
      const result = await runScraper(config);
      return sendJson(response, 200, {
        items: result.items,
        stats: result.stats,
        warnings: result.warnings,
        files: resolveOutputUrls(result.files)
      });
    }

    return sendJson(response, 404, { error: "Ruta no encontrada." });
  } catch (error) {
    return sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Error interno."
    });
  }
});

await ensureDatabaseSchema();

server.listen(port, () => {
  logger.info(`Syscraping disponible en http://localhost:${port}`);
});

async function buildConfig(body) {
  const baseConfig = await loadJsonConfig(fallbackConfigPath);
  const url = String(body?.url || DEFAULTS.startUrl).trim();
  const keyword = String(body?.keyword || DEFAULTS.keyword).trim();
  const itemSelector = String(body?.itemSelector || DEFAULTS.itemSelector).trim();
  const titleSelector = String(body?.titleSelector || DEFAULTS.titleSelector).trim();
  const summarySelector = String(body?.summarySelector || DEFAULTS.summarySelector).trim();
  const urlSelector = String(body?.urlSelector || DEFAULTS.urlSelector).trim();
  const nextButtonSelector = String(body?.nextButtonSelector || DEFAULTS.nextButtonSelector).trim();
  const requestedMaxPages = Number(body?.maxPages || DEFAULTS.maxPages);
  const maxPages = Number.isFinite(requestedMaxPages) && requestedMaxPages >= 1 ? Math.floor(requestedMaxPages) : DEFAULTS.maxPages;

  if (!url) {
    throw new Error("Debes indicar una URL valida.");
  }

  if (!keyword) {
    throw new Error("Debes indicar al menos una palabra clave.");
  }

  return {
    ...baseConfig,
    startUrl: url,
    keywords: [keyword],
    crawl: {
      ...baseConfig.crawl,
      maxPages,
      waitForSelector: itemSelector,
      pagination: {
        nextButtonSelector
      }
    },
    extract: {
      ...baseConfig.extract,
      itemSelector,
      fields: {
        title: {
          selector: titleSelector,
          type: "text"
        },
        summary: {
          selector: summarySelector,
          type: "text"
        },
        url: {
          selector: urlSelector,
          type: "attribute",
          attribute: "href"
        }
      },
      detailContent: {
        enabled: true,
        selector: ".page-main, main, body"
      }
    },
    state: {
      skipKnownMatches: body?.skipKnownMatches !== false,
      resetOnRun: body?.resetKnownMatches === true
    }
  };
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function serveFile(filePath, response) {
  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: "Archivo no encontrado." });
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

