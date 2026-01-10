import { appendFileSync, existsSync, mkdirSync, statSync, renameSync } from 'fs';
import { join } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

interface QueryLogEntry {
  timestamp: string;
  sql: string;
  duration: number;
  rowCount: number;
  success: boolean;
  error?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

export class FileLogger {
  private logDir: string;
  private minLevel: LogLevel;

  constructor(projectPath: string, minLevel: LogLevel = 'info') {
    this.logDir = join(projectPath, '.db-mcp', 'logs');
    this.minLevel = minLevel;

    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private rotateIfNeeded(filePath: string): void {
    if (!existsSync(filePath)) return;

    try {
      const stats = statSync(filePath);
      if (stats.size < MAX_FILE_SIZE) return;

      // Rotate files
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        const oldPath = `${filePath}.${i}`;
        const newPath = `${filePath}.${i + 1}`;
        if (existsSync(oldPath)) {
          if (i === MAX_FILES - 1) {
            // Delete oldest
            Bun.file(oldPath);
          } else {
            renameSync(oldPath, newPath);
          }
        }
      }
      renameSync(filePath, `${filePath}.1`);
    } catch {
      // Ignore rotation errors
    }
  }

  private writeLog(filename: string, entry: object): void {
    // Ensure logs directory exists (in case it was deleted)
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    const filePath = join(this.logDir, filename);
    this.rotateIfNeeded(filePath);

    const line = JSON.stringify(entry) + '\n';
    appendFileSync(filePath, line);
  }

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };

    this.writeLog('mcp.log', entry);

    if (level === 'error') {
      this.writeLog('errors.log', entry);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }

  query(sql: string, duration: number, rowCount: number, success: boolean, error?: string): void {
    const entry: QueryLogEntry = {
      timestamp: new Date().toISOString(),
      sql: sql.substring(0, 1000), // Truncate long queries
      duration,
      rowCount,
      success,
      ...(error && { error }),
    };

    this.writeLog('queries.log', entry);
  }
}

// Singleton logger instance - initialized per project
let loggerInstance: FileLogger | null = null;
let currentProjectPath: string | null = null;

export function initLogger(projectPath: string, level: LogLevel = 'info'): FileLogger {
  loggerInstance = new FileLogger(projectPath, level);
  currentProjectPath = projectPath;
  return loggerInstance;
}

export function getLogger(): FileLogger | null {
  return loggerInstance;
}

/**
 * Ensures logger is initialized for the given project path.
 * If logger doesn't exist or project path changed, initializes it.
 * Returns the logger instance.
 */
export function ensureLogger(projectPath: string, level: LogLevel = 'info'): FileLogger {
  if (!loggerInstance || currentProjectPath !== projectPath) {
    return initLogger(projectPath, level);
  }
  return loggerInstance;
}
