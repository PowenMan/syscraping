import path from "node:path";
import { fileURLToPath } from "node:url";
import "../env.js";
import { logger } from "./logger.js";
import { loadJsonConfig, runScraper } from "./scraper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cwd = process.cwd();
const defaultConfigPath = path.resolve(cwd, "scraper.config.json");
const fallbackConfigPath = path.resolve(cwd, "scraper.config.example.json");

const configPath = getConfigPath();
const config = await loadJsonConfig(configPath, configPath === defaultConfigPath ? fallbackConfigPath : undefined);
const result = await runScraper(config);

logger.info(`Paginas visitadas: ${result.stats.pagesVisited}`);
logger.info(`Items extraidos: ${result.stats.extractedItems}`);
logger.info(`Items filtrados: ${result.stats.filteredItems}`);
logger.info(`Items unicos: ${result.stats.uniqueItems}`);
logger.info(`JSON: ${result.files.jsonPath}`);
logger.info(`CSV: ${result.files.csvPath}`);
logger.info(`Excel: ${result.files.xlsxPath}`);

function getConfigPath() {
  const argIndex = process.argv.indexOf("--config");

  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    return path.resolve(cwd, process.argv[argIndex + 1]);
  }

  return defaultConfigPath;
}
