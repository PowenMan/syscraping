import { createHash } from "node:crypto";
import "../env.js";
import mysql from "mysql2/promise";

const DB_CONFIG = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "syscraping",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let pool;

export function getDbPool() {
  if (!pool) {
    pool = mysql.createPool(DB_CONFIG);
  }

  return pool;
}

export async function ensureDatabaseSchema() {
  const db = getDbPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS scrape_runs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      search_key VARCHAR(1024) NOT NULL,
      search_hash CHAR(64) NOT NULL,
      start_url VARCHAR(1500) NOT NULL,
      keyword VARCHAR(255) NOT NULL,
      max_pages INT UNSIGNED NOT NULL DEFAULT 1,
      pages_visited INT UNSIGNED NOT NULL DEFAULT 0,
      extracted_items INT UNSIGNED NOT NULL DEFAULT 0,
      filtered_items INT UNSIGNED NOT NULL DEFAULT 0,
      unique_items INT UNSIGNED NOT NULL DEFAULT 0,
      skipped_known_urls INT UNSIGNED NOT NULL DEFAULT 0,
      warnings_json JSON NULL,
      files_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_scrape_runs_search_hash (search_hash),
      KEY idx_scrape_runs_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS scrape_known_matches (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      search_key VARCHAR(1024) NOT NULL,
      search_hash CHAR(64) NOT NULL,
      result_url VARCHAR(1500) NOT NULL,
      result_url_hash CHAR(64) NOT NULL,
      title TEXT NULL,
      summary TEXT NULL,
      content MEDIUMTEXT NULL,
      matched_keywords_json JSON NULL,
      first_found_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_found_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_scrape_known_matches (search_hash, result_url_hash),
      KEY idx_scrape_known_matches_last_found_at (last_found_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS scrape_run_results (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      run_id BIGINT UNSIGNED NOT NULL,
      result_url VARCHAR(1500) NOT NULL,
      title TEXT NULL,
      summary TEXT NULL,
      content MEDIUMTEXT NULL,
      matched_keywords_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_scrape_run_results_run_id (run_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS scrape_search_progress (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      search_key VARCHAR(1024) NOT NULL,
      search_hash CHAR(64) NOT NULL,
      start_url VARCHAR(1500) NOT NULL,
      next_page_url VARCHAR(1500) NULL,
      last_page_url VARCHAR(1500) NULL,
      is_complete TINYINT(1) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_scrape_search_progress_search_hash (search_hash),
      KEY idx_scrape_search_progress_updated_at (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

export async function loadKnownMatches(searchKey, { resetOnRun = false } = {}) {
  const db = getDbPool();
  const searchHash = hashValue(searchKey);

  if (resetOnRun) {
    await db.execute("DELETE FROM scrape_known_matches WHERE search_hash = ?", [searchHash]);
    return { searchHash, urls: new Set() };
  }

  const [rows] = await db.execute(
    "SELECT result_url FROM scrape_known_matches WHERE search_hash = ?",
    [searchHash]
  );

  return {
    searchHash,
    urls: new Set(rows.map((row) => row.result_url).filter(Boolean)),
  };
}

export async function loadSearchProgress(searchKey, startUrl, { resetOnRun = false, continueFromLastPage = true } = {}) {
  const db = getDbPool();
  const searchHash = hashValue(searchKey);

  if (resetOnRun) {
    await db.execute("DELETE FROM scrape_search_progress WHERE search_hash = ?", [searchHash]);
    return {
      searchHash,
      resumeFromUrl: startUrl,
      hasStoredProgress: false,
      isComplete: false,
      lastPageUrl: "",
      nextPageUrl: "",
    };
  }

  const [rows] = await db.execute(
    `
      SELECT start_url, next_page_url, last_page_url, is_complete
      FROM scrape_search_progress
      WHERE search_hash = ?
      LIMIT 1
    `,
    [searchHash]
  );

  const row = rows[0];

  if (!row) {
    return {
      searchHash,
      resumeFromUrl: startUrl,
      hasStoredProgress: false,
      isComplete: false,
      lastPageUrl: "",
      nextPageUrl: "",
    };
  }

  const shouldResume = continueFromLastPage !== false && row.next_page_url && !row.is_complete;

  return {
    searchHash,
    resumeFromUrl: shouldResume ? row.next_page_url : startUrl,
    hasStoredProgress: true,
    isComplete: Boolean(row.is_complete),
    lastPageUrl: row.last_page_url || "",
    nextPageUrl: row.next_page_url || "",
  };
}

export async function persistSearchProgress(searchKey, searchHash, payload) {
  const db = getDbPool();

  await db.execute(
    `
      INSERT INTO scrape_search_progress (
        search_key,
        search_hash,
        start_url,
        next_page_url,
        last_page_url,
        is_complete
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        start_url = VALUES(start_url),
        next_page_url = VALUES(next_page_url),
        last_page_url = VALUES(last_page_url),
        is_complete = VALUES(is_complete),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      searchKey,
      searchHash,
      payload.startUrl,
      payload.nextPageUrl || null,
      payload.lastPageUrl || null,
      payload.isComplete ? 1 : 0,
    ]
  );
}

export async function persistKnownMatches(searchKey, searchHash, items) {
  if (!items.length) {
    return;
  }

  const db = getDbPool();

  for (const item of items) {
    if (!item.url) {
      continue;
    }

    await db.execute(
      `
        INSERT INTO scrape_known_matches (
          search_key,
          search_hash,
          result_url,
          result_url_hash,
          title,
          summary,
          content,
          matched_keywords_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          summary = VALUES(summary),
          content = VALUES(content),
          matched_keywords_json = VALUES(matched_keywords_json),
          last_found_at = CURRENT_TIMESTAMP
      `,
      [
        searchKey,
        searchHash,
        item.url,
        hashValue(item.url),
        item.title || null,
        item.summary || null,
        item.content || null,
        JSON.stringify(item.matchedKeywords ?? []),
      ]
    );
  }
}

export async function persistRun(searchKey, searchHash, config, result) {
  const db = getDbPool();
  const keyword = Array.isArray(config.keywords) ? String(config.keywords[0] || "") : "";

  const [runInsert] = await db.execute(
    `
      INSERT INTO scrape_runs (
        search_key,
        search_hash,
        start_url,
        keyword,
        max_pages,
        pages_visited,
        extracted_items,
        filtered_items,
        unique_items,
        skipped_known_urls,
        warnings_json,
        files_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      searchKey,
      searchHash,
      config.startUrl,
      keyword,
      config.crawl?.maxPages ?? 1,
      result.stats?.pagesVisited ?? 0,
      result.stats?.extractedItems ?? 0,
      result.stats?.filteredItems ?? 0,
      result.stats?.uniqueItems ?? 0,
      result.stats?.skippedKnownUrls ?? 0,
      JSON.stringify(result.warnings ?? []),
      JSON.stringify(result.files ?? {}),
    ]
  );

  const runId = runInsert.insertId;

  for (const item of result.items ?? []) {
    await db.execute(
      `
        INSERT INTO scrape_run_results (
          run_id,
          result_url,
          title,
          summary,
          content,
          matched_keywords_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        runId,
        item.url || "",
        item.title || null,
        item.summary || null,
        item.content || null,
        JSON.stringify(item.matchedKeywords ?? []),
      ]
    );
  }

  return runId;
}

export async function getRecentRuns(limit = 8) {
  const db = getDbPool();
  const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const [rows] = await db.query(
    `
      SELECT
        id,
        start_url,
        keyword,
        max_pages,
        pages_visited,
        extracted_items,
        filtered_items,
        unique_items,
        skipped_known_urls,
        created_at
      FROM scrape_runs
      ORDER BY id DESC
      LIMIT ${safeLimit}
    `
  );

  return rows.map((row) => ({
    id: row.id,
    startUrl: row.start_url,
    keyword: row.keyword,
    maxPages: row.max_pages,
    pagesVisited: row.pages_visited,
    extractedItems: row.extracted_items,
    filteredItems: row.filtered_items,
    uniqueItems: row.unique_items,
    skippedKnownUrls: row.skipped_known_urls,
    createdAt: row.created_at,
  }));
}

export async function getRunResults(runId) {
  const db = getDbPool();
  const [rows] = await db.execute(
    `
      SELECT
        result_url,
        title,
        summary,
        content,
        matched_keywords_json
      FROM scrape_run_results
      WHERE run_id = ?
      ORDER BY id DESC
    `,
    [runId]
  );

  return rows.map((row) => ({
    url: row.result_url,
    title: row.title || "",
    summary: row.summary || "",
    content: row.content || "",
    matchedKeywords: parseJsonArray(row.matched_keywords_json),
  }));
}

export async function deleteRun(runId) {
  const db = getDbPool();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await connection.execute("DELETE FROM scrape_run_results WHERE run_id = ?", [runId]);
    const [result] = await connection.execute("DELETE FROM scrape_runs WHERE id = ?", [runId]);
    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function clearAllHistory() {
  const db = getDbPool();
  await db.query("TRUNCATE TABLE scrape_run_results");
  await db.query("TRUNCATE TABLE scrape_runs");
  await db.query("TRUNCATE TABLE scrape_known_matches");
  await db.query("TRUNCATE TABLE scrape_search_progress");
}

function parseJsonArray(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hashValue(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}
