const LEVELS = { error: 0, warn: 1, info: 2 };

const currentLevel = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function formatTimestamp() {
  return new Date().toISOString();
}

function log(level, ...args) {
  if (LEVELS[level] > currentLevel) {
    return;
  }

  const prefix = `[${formatTimestamp()}] [${level.toUpperCase()}]`;
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[method](prefix, ...args);
}

export const logger = {
  info: (...args) => log("info", ...args),
  warn: (...args) => log("warn", ...args),
  error: (...args) => log("error", ...args),
};
