import { ConfigManager } from '../config/manager.ts';
import { getDriverWithConnection } from '../drivers/index.ts';
import { validateQuery, enforceLimit } from '../security/sql-validator.ts';
import type { DbQueryInput, DbExplainInput, DbRunFileInput } from './schemas.ts';
import { readFileSync, existsSync } from 'fs';
import { resolve, extname } from 'path';
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

export async function dbRunFile(input: DbRunFileInput): Promise<ToolResult> {
  const startTime = performance.now();
  let logger: FileLogger | null = null;

  try {
    const { projectPath, filePath, timeout = 60000, format = 'json', limit = 1000 } = input;

    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const config = configManager.load();
    logger = ensureLogger(projectPath, config.logging.level);

    // Resolve file path
    const resolvedPath = resolve(filePath);

    // Validate file extension
    const ext = extname(resolvedPath).toLowerCase();
    if (ext !== '.sql' && ext !== '.txt') {
      return error('Invalid file extension. Only .sql and .txt files are allowed.');
    }

    // Check file exists
    if (!existsSync(resolvedPath)) {
      return error(`File not found: ${resolvedPath}`);
    }

    // Read SQL from file
    const rawSql = readFileSync(resolvedPath, 'utf-8').trim();

    if (!rawSql) {
      return error('SQL file is empty.');
    }

    logger.info('Running SQL from file', {
      filePath: resolvedPath,
      sqlLength: rawSql.length,
    });

    // Check if it's an EXPLAIN query
    const isExplain = rawSql.toUpperCase().trimStart().startsWith('EXPLAIN');

    if (isExplain) {
      // For EXPLAIN queries, extract the inner query and validate it
      // Handle various EXPLAIN formats: EXPLAIN, EXPLAIN ANALYZE, EXPLAIN (ANALYZE, BUFFERS), etc.
      const innerSql = rawSql
        .replace(/^EXPLAIN\s*/i, '')
        .replace(/^\(\s*[^)]*\)\s*/i, '')  // Remove (ANALYZE, BUFFERS, ...) options
        .replace(/^ANALYZE\s*/i, '')        // Remove standalone ANALYZE keyword
        .trim();
      const validation = validateQuery(innerSql, ['SELECT', 'WITH']);

      if (!validation.valid) {
        logger.warn('Query validation failed', {
          file: resolvedPath,
          error: validation.error,
        });
        return error(`Query validation failed: ${validation.error}`);
      }

      // Execute EXPLAIN
      const dbConn = configManager.getDatabaseConnection();
      const driver = await getDriverWithConnection(config.driver.query, dbConn);

      const explainResult = await driver.explain(validation.normalized || innerSql);
      const duration = Math.round(performance.now() - startTime);

      logger.query(rawSql.substring(0, 500), duration, 0, true);

      if (format === 'text') {
        // Return as plain text for readability
        const textOutput = Array.isArray(explainResult)
          ? explainResult.map((row: Record<string, unknown>) => Object.values(row).join('\n')).join('\n')
          : JSON.stringify(explainResult, null, 2);

        return success({
          success: true,
          type: 'explain',
          file: resolvedPath,
          duration,
          plan: textOutput,
        });
      }

      return success({
        success: true,
        type: 'explain',
        file: resolvedPath,
        duration,
        plan: explainResult,
      });
    } else {
      // Regular SELECT/EXPLAIN query
      const allowedWithExplain = [...new Set([...config.security.allowedStatements, 'EXPLAIN'])];
      const validation = validateQuery(rawSql, allowedWithExplain);

      if (!validation.valid) {
        logger.warn('Query validation failed', {
          file: resolvedPath,
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

      logger.query(rawSql.substring(0, 500), result.duration, result.rowCount, true);

      if (format === 'text') {
        // Return as formatted text table
        return success({
          success: true,
          type: 'query',
          file: resolvedPath,
          rowCount: result.rowCount,
          duration,
          data: result.rows,
        });
      }

      return formatQueryResult(result.rows, result.rowCount, duration);
    }
  } catch (err) {
    const duration = Math.round(performance.now() - startTime);
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger?.query(input.filePath, duration, 0, false, errorMessage);
    logger?.error('File query execution failed', { error: errorMessage });

    return error('Query execution failed', errorMessage);
  }
}
