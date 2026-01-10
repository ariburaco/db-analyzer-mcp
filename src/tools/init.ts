import { ConfigManager } from '../config/manager.ts';
import type { DbInitInput } from './schemas.ts';
import { success, error } from '../utils/result.ts';
import type { ToolResult } from '../utils/result.ts';
import { initLogger } from '../logger/index.ts';
import type { DatabaseType } from '../config/types.ts';

export async function dbInit(input: DbInitInput): Promise<ToolResult> {
  try {
    const { projectPath, databaseUrl, envVar, dbType = 'postgresql' } = input;

    const configManager = new ConfigManager(projectPath);

    // Check if already initialized
    if (configManager.isInitialized()) {
      return success({
        success: true,
        message: 'Project already initialized',
        path: configManager.dbMcpPath,
        configPath: `${configManager.dbMcpPath}/config.json`,
      });
    }

    // Initialize config
    const config = configManager.init({
      database: {
        type: dbType as DatabaseType,
        url: databaseUrl,
        envVar: envVar || 'DATABASE_URL',
        schema: 'public',
      },
    });

    // Initialize logger
    initLogger(projectPath, config.logging.level);

    return success({
      success: true,
      message: 'Project initialized successfully',
      path: configManager.dbMcpPath,
      configPath: `${configManager.dbMcpPath}/config.json`,
      schemaPath: configManager.schemaPath,
      logsPath: configManager.logsPath,
      envFile: `${projectPath}/.env`,
      config: {
        databaseType: config.database.type,
        envVar: config.database.envVar,
        driver: config.driver.query,
        introspection: config.driver.introspection,
      },
    });
  } catch (err) {
    return error('Failed to initialize project', err instanceof Error ? err.message : String(err));
  }
}
