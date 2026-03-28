import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import XLSX from "xlsx";
import {
  loadKnownMatches,
  loadSearchProgress,
  persistKnownMatches,
  persistRun,
  persistSearchProgress,
} from "./db.js";

export async function runScraper(config) {
  validateConfig(config);

  const browser = await chromium.launch({
    headless: config.browser?.headless ?? true,
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  const timeoutMs = config.browser?.timeoutMs ?? 30000;
  const warnings = [];
  const searchKey = createSearchKey(config.startUrl, config.keywords ?? []);
  const processedState = await loadKnownMatches(searchKey, config.state);
  const progressState = await loadSearchProgress(searchKey, config.startUrl, config.state);
  const skippedKnownUrls = new Set();

  page.setDefaultTimeout(timeoutMs);

  const extractedItems = [];
  let currentUrl = progressState.resumeFromUrl || config.startUrl;
  let lastVisitedUrl = "";
  let pagesVisited = 0;
  let failedPagesSkipped = 0;
  const maxPages = config.crawl?.maxPages ?? 1;
  const maxFailedPageSkips = Math.max(3, Math.min(maxPages, 10));
  const startedFromSavedProgress = progressState.hasStoredProgress && currentUrl !== config.startUrl;

  try {
    while (currentUrl && pagesVisited < maxPages) {
      lastVisitedUrl = currentUrl;

      try {
        await openListingPage(page, currentUrl, config);
        failedPagesSkipped = 0;
      } catch (error) {
        const fallbackUrl = buildFallbackNextPageUrl(currentUrl);
        warnings.push(`No se pudo cargar la pagina ${currentUrl}: ${toMessage(error)}`);

        if (fallbackUrl && fallbackUrl !== currentUrl && failedPagesSkipped < maxFailedPageSkips) {
          failedPagesSkipped += 1;
          warnings.push(`Se omitio la pagina fallida y se intentara continuar con ${fallbackUrl}.`);
          currentUrl = fallbackUrl;
          continue;
        }

        break;
      }

      let pageItems = await extractItems(page, config);

      if (config.state?.skipKnownMatches !== false) {
        pageItems = pageItems.filter((item) => {
          if (!item.url) {
            return true;
          }

          if (processedState.urls.has(item.url)) {
            skippedKnownUrls.add(item.url);
            return false;
          }

          return true;
        });
      }

      if (config.extract?.detailContent?.enabled !== false) {
        pageItems = await enrichItemsWithDetailContent(context, pageItems, config, warnings);
      }

      extractedItems.push(...pageItems);
      pagesVisited += 1;
      currentUrl = await getNextPageUrl(page, config, currentUrl);
    }
  } finally {
    await browser.close();
  }

  const filteredItems = filterByKeywords(extractedItems, config.keywords ?? []);
  const uniqueItems = dedupe(filteredItems);
  const files = await writeOutput(uniqueItems, config.output);
  const hasPendingPages = Boolean(currentUrl);
  const reachedEnd = !hasPendingPages && pagesVisited > 0;
  const result = {
    items: uniqueItems,
    files,
    warnings,
    stats: {
      pagesVisited,
      extractedItems: extractedItems.length,
      filteredItems: filteredItems.length,
      uniqueItems: uniqueItems.length,
      skippedKnownUrls: skippedKnownUrls.size,
      startedFromSavedProgress,
      resumedFromUrl: startedFromSavedProgress ? progressState.resumeFromUrl : "",
      nextPageUrl: currentUrl || "",
      hasPendingPages,
      reachedEnd,
      lastVisitedUrl,
    },
  };

  await persistKnownMatches(searchKey, processedState.searchHash, uniqueItems);
  await persistSearchProgress(searchKey, processedState.searchHash, {
    startUrl: config.startUrl,
    nextPageUrl: currentUrl,
    lastPageUrl: lastVisitedUrl,
    isComplete: !currentUrl,
  });
  await persistRun(searchKey, processedState.searchHash, config, result);

  return result;
}

export async function discoverItems(config) {
  validateConfig(config);

  const browser = await chromium.launch({
    headless: config.browser?.headless ?? true,
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  const timeoutMs = config.browser?.timeoutMs ?? 30000;
  const warnings = [];
  const searchKey = createSearchKey(config.startUrl, config.keywords ?? []);
  const progressState = await loadSearchProgress(searchKey, config.startUrl, config.state);

  page.setDefaultTimeout(timeoutMs);

  const allItems = [];
  let currentUrl = config.startUrl;
  let lastVisitedUrl = "";
  let pagesVisited = 0;
  let failedPagesSkipped = 0;
  const maxPages = config.crawl?.maxPages ?? 1;
  const maxFailedPageSkips = Math.max(3, Math.min(maxPages, 10));

  try {
    while (currentUrl && pagesVisited < maxPages) {
      lastVisitedUrl = currentUrl;

      try {
        await openListingPage(page, currentUrl, config);
        failedPagesSkipped = 0;
      } catch (error) {
        const fallbackUrl = buildFallbackNextPageUrl(currentUrl);
        warnings.push(`No se pudo cargar la pagina ${currentUrl}: ${toMessage(error)}`);

        if (fallbackUrl && fallbackUrl !== currentUrl && failedPagesSkipped < maxFailedPageSkips) {
          failedPagesSkipped += 1;
          warnings.push(`Se omitio la pagina fallida y se intentara continuar con ${fallbackUrl}.`);
          currentUrl = fallbackUrl;
          continue;
        }

        break;
      }

      const pageItems = await extractItems(page, config);
      allItems.push(...pageItems);
      pagesVisited += 1;
      currentUrl = await getNextPageUrl(page, config, currentUrl);
    }
  } finally {
    await browser.close();
  }

  const uniqueItems = dedupe(allItems);

  await persistSearchProgress(searchKey, progressState.searchHash, {
    startUrl: config.startUrl,
    nextPageUrl: currentUrl,
    lastPageUrl: lastVisitedUrl,
    isComplete: !currentUrl,
  });

  return {
    items: uniqueItems,
    warnings,
    stats: {
      pagesVisited,
      totalFound: uniqueItems.length,
      hasPendingPages: Boolean(currentUrl),
      reachedEnd: !currentUrl && pagesVisited > 0,
      lastVisitedUrl,
    },
  };
}

export async function analyzeItems(items, config) {
  validateConfig(config);

  const browser = await chromium.launch({
    headless: config.browser?.headless ?? true,
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  });

  const warnings = [];
  const searchKey = createSearchKey(config.startUrl, config.keywords ?? []);
  const processedState = await loadKnownMatches(searchKey, config.state);

  try {
    const enriched = await enrichItemsWithDetailContent(context, items, config, warnings);
    const filteredItems = filterByKeywords(enriched, config.keywords ?? []);
    const uniqueItems = dedupe(filteredItems);
    const files = await writeOutput(uniqueItems, config.output);

    const result = {
      items: uniqueItems,
      files,
      warnings,
      stats: {
        analyzedItems: items.length,
        filteredItems: filteredItems.length,
        uniqueItems: uniqueItems.length,
      },
    };

    await persistKnownMatches(searchKey, processedState.searchHash, uniqueItems);
    await persistRun(searchKey, processedState.searchHash, config, {
      ...result,
      stats: {
        ...result.stats,
        pagesVisited: 0,
        extractedItems: items.length,
        skippedKnownUrls: 0,
        startedFromSavedProgress: false,
        resumedFromUrl: "",
        nextPageUrl: "",
        hasPendingPages: false,
        reachedEnd: true,
        lastVisitedUrl: "",
      },
    });

    return result;
  } finally {
    await browser.close();
  }
}

export async function loadJsonConfig(configPath, fallbackPath) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (fallbackPath) {
      const raw = await fs.readFile(fallbackPath, "utf8");
      return JSON.parse(raw);
    }

    throw error;
  }
}

export function resolveOutputUrls(files) {
  return {
    jsonUrl: files?.jsonPath ? `/outputs/${path.basename(files.jsonPath)}` : "",
    csvUrl: files?.csvPath ? `/outputs/${path.basename(files.csvPath)}` : "",
    xlsxUrl: files?.xlsxPath ? `/outputs/${path.basename(files.xlsxPath)}` : "",
  };
}

function validateConfig(config) {
  if (!config?.startUrl) {
    throw new Error('La configuracion debe incluir "startUrl".');
  }

  if (!config.extract?.itemSelector) {
    throw new Error('La configuracion debe incluir "extract.itemSelector".');
  }

  if (!config.extract?.fields || Object.keys(config.extract.fields).length === 0) {
    throw new Error('La configuracion debe incluir campos en "extract.fields".');
  }

  const selectorsToValidate = [
    ["extract.itemSelector", config.extract.itemSelector],
    ...Object.entries(config.extract.fields)
      .filter(([, f]) => f.selector)
      .map(([name, f]) => [`extract.fields.${name}.selector`, f.selector]),
  ];

  if (config.crawl?.pagination?.nextButtonSelector) {
    selectorsToValidate.push(["crawl.pagination.nextButtonSelector", config.crawl.pagination.nextButtonSelector]);
  }

  if (config.crawl?.waitForSelector) {
    selectorsToValidate.push(["crawl.waitForSelector", config.crawl.waitForSelector]);
  }

  for (const [path, selector] of selectorsToValidate) {
    validateCssSelector(path, selector);
  }
}

function validateCssSelector(configPath, selector) {
  if (typeof selector !== "string" || !selector.trim()) {
    throw new Error(`El selector CSS en "${configPath}" esta vacio o no es valido.`);
  }

  try {
    // Use a minimal document fragment to validate the selector syntax
    // This will throw if the selector is syntactically invalid
    if (typeof globalThis.document !== "undefined") {
      globalThis.document.querySelector(selector);
    }
  } catch {
    throw new Error(`El selector CSS "${selector}" en "${configPath}" no es valido.`);
  }
}

function createSearchKey(startUrl, keywords) {
  const normalizedUrl = String(startUrl || "").trim().toLowerCase();
  const normalizedKeywords = keywords.map(normalizeSearchValue).filter(Boolean).sort().join("|");
  return `${normalizedUrl}::${normalizedKeywords}`;
}

async function openListingPage(page, url, config) {
  const waitSelector = config.crawl?.waitForSelector;
  const maxRetries = config.browser?.retries ?? 3;

  await retryWithBackoff(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    if (waitSelector) {
      await page.waitForSelector(waitSelector, { state: "attached", timeout: 15000 });
    }

    await autoScroll(page, config.crawl?.scroll);
  }, maxRetries);
}

async function retryWithBackoff(fn, maxRetries, baseDelayMs = 1000) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

async function autoScroll(page, scrollConfig = {}) {
  if (!scrollConfig?.enabled) {
    return;
  }

  const times = scrollConfig.times ?? 3;
  const delayMs = scrollConfig.delayMs ?? 1000;

  for (let index = 0; index < times; index += 1) {
    await page.evaluate(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    });
    await page.waitForTimeout(delayMs);
  }
}

async function extractItems(page, config) {
  const { itemSelector, fields } = config.extract;
  const fieldEntries = Object.entries(fields);
  const currentUrl = page.url();

  const items = await page.$$eval(
    itemSelector,
    (elements, payload) => {
      const normalizeText = (value) => {
        if (!value) {
          return "";
        }

        return String(value).replace(/\s+/g, " ").trim();
      };

      return elements.map((element) => {
        const record = {};

        for (const [fieldName, fieldConfig] of payload.fieldEntries) {
          const target = fieldConfig.selector ? element.querySelector(fieldConfig.selector) : element;

          if (!target) {
            record[fieldName] = "";
            continue;
          }

          if (fieldConfig.type === "attribute") {
            record[fieldName] = normalizeText(target.getAttribute(fieldConfig.attribute || ""));
            continue;
          }

          if (fieldConfig.type === "html") {
            record[fieldName] = normalizeText(target.innerHTML);
            continue;
          }

          record[fieldName] = normalizeText(target.textContent);
        }

        return record;
      });
    },
    { fieldEntries }
  );

  return items.map((item) => normalizeRecordUrls(item, fields, currentUrl));
}

async function enrichItemsWithDetailContent(context, items, config, warnings) {
  const detailSelector = config.extract?.detailContent?.selector || "main";
  const delayMs = config.extract?.detailContent?.delayMs ?? 500;
  const detailTimeoutMs = config.extract?.detailContent?.timeoutMs ?? 30000;
  const concurrency = config.extract?.detailContent?.concurrency ?? 1;

  const pages = [];
  for (let p = 0; p < concurrency; p += 1) {
    const detailPage = await context.newPage();
    detailPage.setDefaultTimeout(detailTimeoutMs);
    pages.push(detailPage);
  }

  try {
    const enriched = new Array(items.length);
    const itemsWithUrl = [];

    for (let i = 0; i < items.length; i += 1) {
      if (!items[i].url) {
        enriched[i] = items[i];
      } else {
        itemsWithUrl.push(i);
      }
    }

    for (let batchStart = 0; batchStart < itemsWithUrl.length; batchStart += concurrency) {
      if (batchStart > 0 && delayMs > 0) {
        await sleep(delayMs);
      }

      const batch = itemsWithUrl.slice(batchStart, batchStart + concurrency);

      await Promise.all(
        batch.map(async (itemIndex, pageIndex) => {
          const item = items[itemIndex];
          const detailPage = pages[pageIndex];

          try {
            await detailPage.goto(item.url, { waitUntil: "domcontentloaded" });
            const content = await extractDetailContent(detailPage, detailSelector);
            enriched[itemIndex] = { ...item, content: normalizeContent(content) };
          } catch (error) {
            warnings.push(`No se pudo leer el detalle de ${item.url}: ${toMessage(error)}`);
            enriched[itemIndex] = item;
          }
        })
      );
    }

    return enriched;
  } finally {
    await Promise.all(pages.map((p) => p.close()));
  }
}

async function extractDetailContent(page, detailSelector) {
  const locator = page.locator(detailSelector).first();
  const fallbackLocator = page.locator("body").first();

  const text = await locator
    .evaluate(extractCleanTextFromRoot)
    .catch(async () => fallbackLocator.evaluate(extractCleanTextFromRoot));

  return String(text || "");
}

function extractCleanTextFromRoot(root) {
  const target = root?.cloneNode?.(true);

  if (!target) {
    return "";
  }

  const removeSelectors = [
    "header",
    "nav",
    "footer",
    "aside",
    "form",
    "script",
    "style",
    "noscript",
    "iframe",
    "[role='navigation']",
    ".breadcrumbs",
    ".breadcrumb",
    ".menu",
    ".navbar",
    ".nav",
    ".footer",
    ".header",
    ".comments",
    ".comment",
    ".related",
    ".related-posts",
    ".post-related",
    ".share",
    ".social",
    ".newsletter",
    ".subscribe",
    ".cookie",
    ".modal",
    ".popup",
    ".banner",
    ".sidebar",
  ];

  for (const selector of removeSelectors) {
    target.querySelectorAll(selector).forEach((node) => node.remove());
  }

  const noisyPatterns = [
    "articulos populares",
    "artículos populares",
    "articulos recientes",
    "artículos recientes",
    "categorias",
    "categorías",
    "comentarios",
    "comparte este post",
    "te gusto",
    "te gustó",
    "ingresar",
    "suscribete",
    "suscríbete",
    "siguenos en redes",
    "síguenos en redes",
    "terminos y condiciones",
    "términos y condiciones",
    "politica de privacidad",
    "política de privacidad",
    "todos los derechos reservados",
    "the store will not work correctly when cookies are disabled",
    "necesitamos el consentimiento para utilizar tus cookies",
  ];

  target.querySelectorAll("*").forEach((node) => {
    // Only remove leaf-level elements (no child elements) to avoid
    // accidentally deleting parent containers that wrap article content
    // alongside sidebar noise (e.g. a <div> whose textContent includes
    // both the article body AND "categorias" from a nested sidebar).
    if (node.childElementCount > 0) {
      return;
    }

    const text = String(node.textContent || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      return;
    }

    if (noisyPatterns.some((pattern) => text.includes(pattern))) {
      node.remove();
    }
  });

  return String(target.textContent || "").replace(/\s+/g, " ").trim();
}

async function getNextPageUrl(page, config, currentUrl) {
  const nextButtonSelector = config.crawl?.pagination?.nextButtonSelector;

  if (!nextButtonSelector) {
    return null;
  }

  const href = await page
    .$eval(nextButtonSelector, (element) => element.getAttribute("href"))
    .catch(() => null);

  if (!href) {
    return null;
  }

  return new URL(href, currentUrl).toString();
}

function buildFallbackNextPageUrl(currentUrl) {
  try {
    const url = new URL(currentUrl);
    const currentPage = Number(url.searchParams.get("p") || "1");

    if (!Number.isFinite(currentPage) || currentPage < 1) {
      return null;
    }

    url.searchParams.set("p", String(currentPage + 1));
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeRecordUrls(item, fields, baseUrl) {
  const normalized = { ...item };

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldConfig.type !== "attribute") {
      continue;
    }

    const attributeName = String(fieldConfig.attribute || "").toLowerCase();

    if (!["href", "src"].includes(attributeName)) {
      continue;
    }

    normalized[fieldName] = absolutizeUrl(normalized[fieldName], baseUrl);
  }

  return normalized;
}

function absolutizeUrl(value, baseUrl) {
  if (!value) {
    return "";
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function filterByKeywords(items, keywords) {
  if (!keywords.length) {
    return items.map((item) => ({ ...item, matchedKeywords: [] }));
  }

  const normalizedKeywords = keywords.map(normalizeSearchValue).filter(Boolean);

  return items
    .map((item) => {
      const haystack = normalizeSearchValue(Object.values(item).join(" "));
      const matchedKeywords = normalizedKeywords.filter((keyword) => haystack.includes(keyword));
      return { ...item, matchedKeywords };
    })
    .filter((item) => item.matchedKeywords.length > 0);
}

function normalizeSearchValue(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeContent(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function dedupe(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key = `${item.url || ""}::${item.title || ""}::${item.summary || ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function writeOutput(items, outputConfig = {}) {
  const directory = path.resolve(process.cwd(), outputConfig.directory ?? "outputs");
  const basename = outputConfig.basename ?? "results";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(directory, `${basename}-${stamp}.json`);
  const csvPath = path.join(directory, `${basename}-${stamp}.csv`);
  const xlsxPath = path.join(directory, `${basename}-${stamp}.xlsx`);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(jsonPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  await fs.writeFile(csvPath, toCsv(items), "utf8");

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(toWorkbookRows(items));
  XLSX.utils.book_append_sheet(workbook, worksheet, "Resultados");
  XLSX.writeFile(workbook, xlsxPath);

  return { jsonPath, csvPath, xlsxPath };
}

function toCsv(items) {
  if (!items.length) {
    return "";
  }

  const headers = Array.from(new Set(items.flatMap((item) => Object.keys(item))));

  const escapeCell = (value) => {
    const normalized = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
    const sanitized = normalized.replace(/\r\n?/g, "\n");
    const escaped = sanitized.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const lines = [
    headers.map(escapeCell).join(","),
    ...items.map((item) => headers.map((header) => escapeCell(item[header])).join(",")),
  ];

  return "\uFEFF" + lines.join("\r\n");
}

function toWorkbookRows(items) {
  return items.map((item) => Object.fromEntries(
    Object.entries(item).map(([key, value]) => [key, Array.isArray(value) ? value.join(" | ") : String(value ?? "")])
  ));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMessage(error) {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}

export const _testUtils = { filterByKeywords, dedupe, toCsv, normalizeSearchValue };
