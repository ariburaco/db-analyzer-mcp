import { ConfigManager } from '../config/manager.ts';
import { getDriverWithConnection } from '../drivers/index.ts';
import { validateQuery, enforceLimit } from '../security/sql-validator.ts';
import type { DbQueryInput, DbExplainInput } from './schemas.ts';
import { success, error, formatQueryResult } from '../utils/result.ts';
import type { ToolResult } from '../utils/result.ts';
import { ensureLogger, type FileLogger } from '../logger/index.ts';

export async function dbQuery(input: DbQueryInput): Promise<ToolResult> {
  const startTime = performance.now();
  let logger: FileLogger | null = null;

  try {
    const { projectPath, sql: rawSql, limit = 100 } = input;

    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const config = configManager.load();
    logger = ensureLogger(projectPath, config.logging.level);

    // Validate query
    const validation = validateQuery(rawSql, config.security.allowedStatements);
    if (!validation.valid) {
      logger.warn('Query validation failed', {
        sql: rawSql.substring(0, 200),
        error: validation.error,
      });
      return error(`Query validation failed: ${validation.error}`);
    }

    // Enforce row limit
    const effectiveLimit = Math.min(limit, config.security.maxRowLimit);
    const safeSql = enforceLimit(validation.normalized || rawSql, effectiveLimit);

    // Execute query
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    const result = await driver.query(safeSql);
    const duration = Math.round(performance.now() - startTime);

    logger.query(safeSql, result.duration, result.rowCount, true);

    return formatQueryResult(result.rows, result.rowCount, duration);
  } catch (err) {
    const duration = Math.round(performance.now() - startTime);
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger?.query(input.sql, duration, 0, false, errorMessage);
    logger?.error('Query execution failed', { error: errorMessage });

    return error('Query execution failed', errorMessage);
  }
}

export async function dbExplain(input: DbExplainInput): Promise<ToolResult> {
  let logger: FileLogger | null = null;

  try {
    const { projectPath, sql: rawSql } = input;

    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const config = configManager.load();
    logger = ensureLogger(projectPath, config.logging.level);

    // Validate the base query (not the EXPLAIN itself)
    const validation = validateQuery(rawSql, ['SELECT', 'WITH']);
    if (!validation.valid) {
      return error(`Query validation failed: ${validation.error}`);
    }

    // Execute EXPLAIN
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    const explainResult = await driver.explain(validation.normalized || rawSql);

    logger.info('Explain executed', { sql: rawSql.substring(0, 200) });

    return success({
      success: true,
      sql: validation.normalized || rawSql,
      plan: explainResult,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger?.error('Explain execution failed', { error: errorMessage });
    return error('Explain execution failed', errorMessage);
  }
}
