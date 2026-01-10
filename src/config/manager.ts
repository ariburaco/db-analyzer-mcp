import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { type Config, ConfigSchema, DEFAULT_CONFIG } from './types.ts';

/**
 * Parse .env file manually to avoid dotenv's stdout output that breaks MCP protocol.
 * Bun/dotenv outputs package info to stdout, which corrupts JSON protocol.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, 'utf-8');
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Find the first = sign
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

const CONFIG_DIR = '.db-mcp';
const CONFIG_FILE = 'config.json';

export class ConfigManager {
  private projectPath: string;
  private configPath: string;
  private config: Config | null = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.configPath = join(projectPath, CONFIG_DIR, CONFIG_FILE);
  }

  get dbMcpPath(): string {
    return join(this.projectPath, CONFIG_DIR);
  }

  get schemaPath(): string {
    return join(this.dbMcpPath, 'schema');
  }

  get logsPath(): string {
    return join(this.dbMcpPath, 'logs');
  }

  isInitialized(): boolean {
    return existsSync(this.configPath);
  }

  /**
   * Load .env file from the target project's root.
   * Uses manual parsing to avoid dotenv's stdout output that breaks MCP protocol.
   * Always loads fresh - no caching, to support multiple projects.
   */
  private loadProjectEnv(): void {
    const envPath = join(this.projectPath, '.env');
    const envVars = parseEnvFile(envPath);

    // Set environment variables - OVERRIDE existing values for this project
    for (const [key, value] of Object.entries(envVars)) {
      process.env[key] = value;
    }
  }

  init(overrides?: Partial<Config>): Config {
    const dbMcpDir = this.dbMcpPath;

    // Create directories
    if (!existsSync(dbMcpDir)) {
      mkdirSync(dbMcpDir, { recursive: true });
    }
    if (!existsSync(this.schemaPath)) {
      mkdirSync(this.schemaPath, { recursive: true });
    }
    if (!existsSync(this.logsPath)) {
      mkdirSync(this.logsPath, { recursive: true });
    }

    // Merge config
    const config: Config = {
      ...DEFAULT_CONFIG,
      ...overrides,
      database: {
        ...DEFAULT_CONFIG.database,
        ...overrides?.database,
      },
      driver: {
        ...DEFAULT_CONFIG.driver,
        ...overrides?.driver,
      },
      security: {
        ...DEFAULT_CONFIG.security,
        ...overrides?.security,
      },
      logging: {
        ...DEFAULT_CONFIG.logging,
        ...overrides?.logging,
      },
    };

    // Write config
    writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    this.config = config;

    return config;
  }

  load(): Config {
    if (this.config) {
      return this.config;
    }

    if (!this.isInitialized()) {
      throw new Error(`Project not initialized. Run db_init first. Path: ${this.projectPath}`);
    }

    const raw = readFileSync(this.configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const validated = ConfigSchema.parse(parsed);

    this.config = validated;
    return validated;
  }

  update(updates: Partial<Config>): Config {
    const current = this.load();
    const updated: Config = {
      ...current,
      ...updates,
      database: {
        ...current.database,
        ...updates.database,
      },
      driver: {
        ...current.driver,
        ...updates.driver,
      },
      security: {
        ...current.security,
        ...updates.security,
      },
      logging: {
        ...current.logging,
        ...updates.logging,
      },
    };

    writeFileSync(this.configPath, JSON.stringify(updated, null, 2));
    this.config = updated;

    return updated;
  }

  /**
   * Get database connection details.
   * Supports both URL-based and individual field-based configuration.
   * Individual fields take precedence over URL (allows special chars in password).
   */
  getDatabaseConnection(): DatabaseConnection {
    const config = this.load();
    const db = config.database;

    // Load .env from target project
    this.loadProjectEnv();

    // Helper to get value from config or env
    const getVal = (
      direct: string | undefined,
      envKey: string | undefined,
      defaultVal?: string
    ): string | undefined => {
      if (direct) return direct;
      if (envKey && process.env[envKey]) return process.env[envKey];
      return defaultVal;
    };

    const getNumVal = (
      direct: number | undefined,
      envKey: string | undefined,
      defaultVal?: number
    ): number | undefined => {
      if (direct !== undefined) return direct;
      if (envKey && process.env[envKey]) return parseInt(process.env[envKey]!, 10);
      return defaultVal;
    };

    // Check if individual fields are configured
    const host = getVal(db.host, db.hostEnv);
    const user = getVal(db.user, db.userEnv);
    const password = getVal(db.password, db.passwordEnv);
    const database = getVal(db.database, db.databaseEnv);
    const port = getNumVal(db.port, db.portEnv);

    // If individual fields are present, use them
    if (host || user || password || database) {
      // Determine SSL
      let ssl: boolean | 'require' | 'prefer' | { rejectUnauthorized: boolean } = false;
      if (db.ssl === true || db.ssl === 'true' || db.ssl === 'require') {
        ssl = 'require';
      } else if (db.ssl === 'no-verify' || db.ssl === 'allow') {
        ssl = { rejectUnauthorized: false };
      } else if (db.ssl === 'prefer') {
        ssl = 'prefer';
      }

      return {
        mode: 'fields',
        host: host || 'localhost',
        port: port || 5432,
        user: user || 'postgres',
        password: password || '',
        database: database || 'postgres',
        ssl,
      };
    }

    // Fall back to URL-based connection
    let url = db.url;
    if (!url) {
      const envVarName = db.envVar || 'DATABASE_URL';
      url = process.env[envVarName];
    }

    if (!url) {
      const envPath = join(this.projectPath, '.env');
      throw new Error(
        `Database connection not configured. Either set individual fields (host, user, password, database) or set DATABASE_URL in ${envPath}`
      );
    }

    return {
      mode: 'url',
      url,
    };
  }

  // Legacy method for backwards compatibility
  getDatabaseUrl(): string {
    const conn = this.getDatabaseConnection();
    if (conn.mode === 'url') {
      return conn.url;
    }
    // Build URL from fields (note: may have issues with special chars)
    const { host, port, user, password, database } = conn;
    return `postgresql://${user}:${password}@${host}:${port}/${database}`;
  }
}

export interface DatabaseConnectionUrl {
  mode: 'url';
  url: string;
}

export interface DatabaseConnectionFields {
  mode: 'fields';
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean | 'require' | 'prefer' | { rejectUnauthorized: boolean };
}

export type DatabaseConnection = DatabaseConnectionUrl | DatabaseConnectionFields;
