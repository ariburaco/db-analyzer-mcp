import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ConfigManager } from '../config/manager.ts';
import { getDriverWithConnection } from '../drivers/index.ts';
import type { DbPullInput, DbSchemaInput, DbTablesInput, DbSampleInput } from './schemas.ts';
import { success, error, formatTablesResult } from '../utils/result.ts';
import type { ToolResult } from '../utils/result.ts';
import { getLogger } from '../logger/index.ts';
import { validateIdentifier } from '../security/index.ts';

interface SchemaSnapshot {
  version: string;
  pulledAt: string;
  engine: string;
  tables: TableSnapshot[];
}

interface TableSnapshot {
  name: string;
  schema: string;
  rowCount: number;
  columns: ColumnSnapshot[];
  indexes: IndexSnapshot[];
}

interface ColumnSnapshot {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: {
    table: string;
    column: string;
  };
}

interface IndexSnapshot {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
}

export async function dbPull(input: DbPullInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, engine = 'drizzle' } = input;

    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();

    logger?.info('Starting schema pull', { engine, projectPath });

    // Get driver and introspect
    const driver = await getDriverWithConnection(config.driver.query, dbConn);
    const tables = await driver.getTables(config.database.schema);

    const snapshot: SchemaSnapshot = {
      version: '1.0.0',
      pulledAt: new Date().toISOString(),
      engine,
      tables: [],
    };

    // Get columns and indexes for each table
    for (const table of tables) {
      const columns = await driver.getColumns(table.name, table.schema);
      const indexes = await driver.getIndexes(table.name, table.schema);

      snapshot.tables.push({
        name: table.name,
        schema: table.schema,
        rowCount: table.rowCount,
        columns: columns.map(col => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          defaultValue: col.defaultValue,
          isPrimaryKey: col.isPrimaryKey,
          isForeignKey: col.isForeignKey,
          references: col.references,
        })),
        indexes: indexes.map(idx => ({
          name: idx.name,
          columns: idx.columns,
          isUnique: idx.isUnique,
          isPrimary: idx.isPrimary,
        })),
      });
    }

    // Ensure schema directory exists
    if (!existsSync(configManager.schemaPath)) {
      mkdirSync(configManager.schemaPath, { recursive: true });
    }

    // Save snapshot
    const snapshotPath = join(configManager.schemaPath, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

    logger?.info('Schema pull completed', {
      tableCount: tables.length,
      snapshotPath,
    });

    return success({
      success: true,
      message: 'Schema pulled successfully',
      tableCount: snapshot.tables.length,
      snapshotPath,
      tables: snapshot.tables.map(t => ({
        name: t.name,
        columnCount: t.columns.length,
        rowCount: t.rowCount,
      })),
    });
  } catch (err) {
    logger?.error('Schema pull failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to pull schema', err instanceof Error ? err.message : String(err));
  }
}

export async function dbSchema(input: DbSchemaInput): Promise<ToolResult> {
  try {
    const { projectPath, table } = input;

    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const snapshotPath = join(configManager.schemaPath, 'snapshot.json');

    if (!existsSync(snapshotPath)) {
      return error('Schema not found. Run db_pull first to fetch the database schema.');
    }

    const snapshot: SchemaSnapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

    if (table) {
      const tableSchema = snapshot.tables.find(t => t.name.toLowerCase() === table.toLowerCase());

      if (!tableSchema) {
        return error(`Table '${table}' not found in schema`, {
          availableTables: snapshot.tables.map(t => t.name),
        });
      }

      return success({
        success: true,
        pulledAt: snapshot.pulledAt,
        table: tableSchema,
      });
    }

    return success({
      success: true,
      pulledAt: snapshot.pulledAt,
      tableCount: snapshot.tables.length,
      tables: snapshot.tables.map(t => ({
        name: t.name,
        schema: t.schema,
        rowCount: t.rowCount,
        columnCount: t.columns.length,
        columns: t.columns.map(c => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          isPrimaryKey: c.isPrimaryKey,
          isForeignKey: c.isForeignKey,
        })),
      })),
    });
  } catch (err) {
    return error('Failed to get schema', err instanceof Error ? err.message : String(err));
  }
}

export async function dbTables(input: DbTablesInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, schema = 'public' } = input;

    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();

    const driver = await getDriverWithConnection(config.driver.query, dbConn);
    const tables = await driver.getTables(schema);

    logger?.info('Listed tables', { count: tables.length, schema });

    return formatTablesResult(
      tables.map(t => ({
        name: t.name,
        schema: t.schema,
        rowCount: t.rowCount,
        sizeBytes: t.sizeBytes,
        sizeMB: t.sizeBytes ? Math.round((t.sizeBytes / 1024 / 1024) * 100) / 100 : undefined,
      }))
    );
  } catch (err) {
    logger?.error('Failed to list tables', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to list tables', err instanceof Error ? err.message : String(err));
  }
}

export async function dbSample(input: DbSampleInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, table, limit = 10, schema = 'public' } = input;

    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    // Validate table name
    const tableValidation = validateIdentifier(table, 'table');
    if (!tableValidation.valid) {
      return error(tableValidation.error!);
    }

    // Validate schema name
    const schemaValidation = validateIdentifier(schema, 'schema');
    if (!schemaValidation.valid) {
      return error(schemaValidation.error!);
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();

    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    // Verify table exists
    const exists = await driver.tableExists(table, schema);
    if (!exists) {
      return error(`Table '${table}' not found in schema '${schema}'`);
    }

    // Enforce safe limit
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);

    const result = await driver.getSampleData(table, safeLimit, schema);

    logger?.info('Sampled table', {
      table,
      rowCount: result.rowCount,
      duration: result.duration,
    });

    return success({
      success: true,
      table,
      rowCount: result.rowCount,
      duration: `${result.duration}ms`,
      rows: result.rows,
    });
  } catch (err) {
    logger?.error('Failed to sample table', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to sample table', err instanceof Error ? err.message : String(err));
  }
}
