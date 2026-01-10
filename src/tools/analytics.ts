import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ConfigManager } from '../config/manager.ts';
import { getDriverWithConnection } from '../drivers/index.ts';
import type {
  DbStatsInput,
  DbRelationsInput,
  DbIndexesInput,
  DbSearchInput,
  DbDescribeInput,
} from './schemas.ts';
import { success, error } from '../utils/result.ts';
import type { ToolResult } from '../utils/result.ts';
import { getLogger } from '../logger/index.ts';
import { validateIdentifier } from '../security/index.ts';

interface SchemaSnapshot {
  tables: Array<{
    name: string;
    schema: string;
    rowCount: number;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      isPrimaryKey: boolean;
      isForeignKey: boolean;
      references?: { table: string; column: string };
    }>;
    indexes: Array<{
      name: string;
      columns: string[];
      isUnique: boolean;
      isPrimary: boolean;
    }>;
  }>;
}

function loadSnapshot(configManager: ConfigManager): SchemaSnapshot | null {
  const snapshotPath = join(configManager.schemaPath, 'snapshot.json');
  if (!existsSync(snapshotPath)) {
    return null;
  }
  return JSON.parse(readFileSync(snapshotPath, 'utf-8'));
}

export async function dbStats(input: DbStatsInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    // Get database-level stats
    const tables = await driver.getTables(config.database.schema);

    let totalRows = 0;
    let totalSize = 0;
    let totalIndexes = 0;

    for (const table of tables) {
      totalRows += table.rowCount;
      totalSize += table.sizeBytes || 0;
      const indexes = await driver.getIndexes(table.name, table.schema);
      totalIndexes += indexes.length;
    }

    const stats = {
      tableCount: tables.length,
      totalRows,
      totalSizeMB: Math.round((totalSize / 1024 / 1024) * 100) / 100,
      totalIndexes,
      averageRowsPerTable: tables.length > 0 ? Math.round(totalRows / tables.length) : 0,
      largestTables: tables
        .sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))
        .slice(0, 5)
        .map(t => ({
          name: t.name,
          rows: t.rowCount,
          sizeMB: Math.round(((t.sizeBytes || 0) / 1024 / 1024) * 100) / 100,
        })),
      emptyTables: tables.filter(t => t.rowCount === 0).map(t => t.name),
    };

    logger?.info('Database stats retrieved', { tableCount: stats.tableCount });

    return success({
      success: true,
      stats,
    });
  } catch (err) {
    logger?.error('Failed to get stats', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to get database stats', err instanceof Error ? err.message : String(err));
  }
}

export async function dbRelations(input: DbRelationsInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, table } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    // Validate table name if provided
    if (table) {
      const tableValidation = validateIdentifier(table, 'table');
      if (!tableValidation.valid) {
        return error(tableValidation.error!);
      }
    }

    const snapshot = loadSnapshot(configManager);
    if (!snapshot) {
      return error('Schema not found. Run db_pull first.');
    }

    interface Relation {
      fromTable: string;
      fromColumn: string;
      toTable: string;
      toColumn: string;
      type: string;
    }

    const relations: Relation[] = [];

    for (const t of snapshot.tables) {
      for (const col of t.columns) {
        if (col.isForeignKey && col.references) {
          relations.push({
            fromTable: t.name,
            fromColumn: col.name,
            toTable: col.references.table,
            toColumn: col.references.column,
            type: 'many-to-one',
          });
        }
      }
    }

    let filtered = relations;
    if (table) {
      filtered = relations.filter(
        r =>
          r.fromTable.toLowerCase() === table.toLowerCase() ||
          r.toTable.toLowerCase() === table.toLowerCase()
      );
    }

    // Build a simple ASCII diagram
    const diagram = buildRelationDiagram(filtered);

    logger?.info('Relations retrieved', { count: filtered.length });

    return success({
      success: true,
      relationCount: filtered.length,
      relations: filtered,
      diagram,
    });
  } catch (err) {
    logger?.error('Failed to get relations', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to get relations', err instanceof Error ? err.message : String(err));
  }
}

function buildRelationDiagram(
  relations: Array<{ fromTable: string; fromColumn: string; toTable: string; toColumn: string }>
): string {
  if (relations.length === 0) return 'No relations found';

  const lines: string[] = ['```', 'Relationships:'];
  for (const r of relations) {
    lines.push(`  ${r.fromTable}.${r.fromColumn} ──► ${r.toTable}.${r.toColumn}`);
  }
  lines.push('```');
  return lines.join('\n');
}

export async function dbIndexes(input: DbIndexesInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, table } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    // Validate table name if provided
    if (table) {
      const tableValidation = validateIdentifier(table, 'table');
      if (!tableValidation.valid) {
        return error(tableValidation.error!);
      }
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    const tables = await driver.getTables(config.database.schema);

    interface IndexInfo {
      table: string;
      name: string;
      columns: string[];
      isUnique: boolean;
      isPrimary: boolean;
    }

    const allIndexes: IndexInfo[] = [];

    const targetTables = table
      ? tables.filter(t => t.name.toLowerCase() === table.toLowerCase())
      : tables;

    // If table specified but not found
    if (table && targetTables.length === 0) {
      return error(`Table '${table}' not found in schema '${config.database.schema}'`);
    }

    for (const t of targetTables) {
      const indexes = await driver.getIndexes(t.name, t.schema);
      for (const idx of indexes) {
        allIndexes.push({
          table: t.name,
          name: idx.name,
          columns: idx.columns,
          isUnique: idx.isUnique,
          isPrimary: idx.isPrimary,
        });
      }
    }

    logger?.info('Indexes retrieved', { count: allIndexes.length });

    return success({
      success: true,
      indexCount: allIndexes.length,
      indexes: allIndexes,
    });
  } catch (err) {
    logger?.error('Failed to get indexes', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to get indexes', err instanceof Error ? err.message : String(err));
  }
}

export async function dbSearch(input: DbSearchInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, query } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const snapshot = loadSnapshot(configManager);
    if (!snapshot) {
      return error('Schema not found. Run db_pull first.');
    }

    const searchLower = query.toLowerCase();

    interface SearchResult {
      type: 'table' | 'column';
      table: string;
      column?: string;
      columnType?: string;
      match: string;
    }

    const results: SearchResult[] = [];

    for (const table of snapshot.tables) {
      // Match table name
      if (table.name.toLowerCase().includes(searchLower)) {
        results.push({
          type: 'table',
          table: table.name,
          match: table.name,
        });
      }

      // Match column names
      for (const col of table.columns) {
        if (col.name.toLowerCase().includes(searchLower)) {
          results.push({
            type: 'column',
            table: table.name,
            column: col.name,
            columnType: col.type,
            match: `${table.name}.${col.name}`,
          });
        }
      }
    }

    logger?.info('Search completed', { query, resultCount: results.length });

    return success({
      success: true,
      query,
      resultCount: results.length,
      results,
    });
  } catch (err) {
    logger?.error('Search failed', { error: err instanceof Error ? err.message : String(err) });
    return error('Search failed', err instanceof Error ? err.message : String(err));
  }
}

export async function dbDescribe(input: DbDescribeInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, table, sampleLimit = 5 } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    // Validate table name
    const tableValidation = validateIdentifier(table, 'table');
    if (!tableValidation.valid) {
      return error(tableValidation.error!);
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    // Verify table exists
    const exists = await driver.tableExists(table, config.database.schema);
    if (!exists) {
      return error(`Table '${table}' not found in schema '${config.database.schema}'`);
    }

    // Safe sample limit
    const safeSampleLimit = Math.min(Math.max(1, Math.floor(sampleLimit)), 100);

    // Get columns
    const columns = await driver.getColumns(table, config.database.schema);
    if (columns.length === 0) {
      return error(`Table '${table}' has no columns`);
    }

    // Get indexes
    const indexes = await driver.getIndexes(table, config.database.schema);

    // Get sample data
    const sampleData = await driver.getSampleData(table, safeSampleLimit, config.database.schema);

    // Get table stats
    const tables = await driver.getTables(config.database.schema);
    const tableInfo = tables.find(t => t.name.toLowerCase() === table.toLowerCase());

    // Find foreign keys (incoming and outgoing)
    const snapshot = loadSnapshot(configManager);
    const outgoingFKs = columns.filter(c => c.isForeignKey && c.references);
    const incomingFKs: Array<{ table: string; column: string }> = [];

    if (snapshot) {
      for (const t of snapshot.tables) {
        for (const col of t.columns) {
          if (col.references?.table.toLowerCase() === table.toLowerCase()) {
            incomingFKs.push({ table: t.name, column: col.name });
          }
        }
      }
    }

    logger?.info('Table described', { table });

    return success({
      success: true,
      table: {
        name: table,
        rowCount: tableInfo?.rowCount || 0,
        sizeMB: tableInfo?.sizeBytes
          ? Math.round((tableInfo.sizeBytes / 1024 / 1024) * 100) / 100
          : 0,
      },
      columns: columns.map(c => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        isPrimaryKey: c.isPrimaryKey,
        isForeignKey: c.isForeignKey,
        references: c.references,
        default: c.defaultValue,
      })),
      indexes: indexes.map(i => ({
        name: i.name,
        columns: i.columns,
        isUnique: i.isUnique,
        isPrimary: i.isPrimary,
      })),
      foreignKeys: {
        outgoing: outgoingFKs.map(c => ({
          column: c.name,
          references: c.references,
        })),
        incoming: incomingFKs,
      },
      sampleData: {
        rowCount: sampleData.rowCount,
        rows: sampleData.rows,
      },
    });
  } catch (err) {
    logger?.error('Describe failed', { error: err instanceof Error ? err.message : String(err) });
    return error('Failed to describe table', err instanceof Error ? err.message : String(err));
  }
}
