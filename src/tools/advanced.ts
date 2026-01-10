import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ConfigManager } from '../config/manager.ts';
import { getDriverWithConnection } from '../drivers/index.ts';
import type {
  DbErdInput,
  DbConstraintsInput,
  DbAnalyzeInput,
  DbDuplicatesInput,
} from './schemas.ts';
import { success, error } from '../utils/result.ts';
import type { ToolResult } from '../utils/result.ts';
import { getLogger } from '../logger/index.ts';
import { validateIdentifier, validateIdentifiers, quoteIdentifier } from '../security/index.ts';

interface SchemaSnapshot {
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      isPrimaryKey: boolean;
      isForeignKey: boolean;
      references?: { table: string; column: string };
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

export async function dbErd(input: DbErdInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, format = 'mermaid' } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const snapshot = loadSnapshot(configManager);
    if (!snapshot) {
      return error('Schema not found. Run db_pull first.');
    }

    let diagram: string;

    if (format === 'mermaid') {
      diagram = generateMermaidErd(snapshot);
    } else {
      diagram = generateAsciiErd(snapshot);
    }

    logger?.info('ERD generated', { format, tableCount: snapshot.tables.length });

    return success({
      success: true,
      format,
      tableCount: snapshot.tables.length,
      diagram,
    });
  } catch (err) {
    logger?.error('ERD generation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to generate ERD', err instanceof Error ? err.message : String(err));
  }
}

function generateMermaidErd(snapshot: SchemaSnapshot): string {
  const lines: string[] = ['```mermaid', 'erDiagram'];

  // Add tables with columns
  for (const table of snapshot.tables) {
    lines.push(`    ${table.name} {`);
    for (const col of table.columns) {
      const pk = col.isPrimaryKey ? 'PK' : '';
      const fk = col.isForeignKey ? 'FK' : '';
      const marker = pk || fk ? ` "${pk}${pk && fk ? ',' : ''}${fk}"` : '';
      lines.push(`        ${col.type.replace(/\s+/g, '_')} ${col.name}${marker}`);
    }
    lines.push('    }');
  }

  // Add relationships
  for (const table of snapshot.tables) {
    for (const col of table.columns) {
      if (col.isForeignKey && col.references) {
        // Determine relationship type (assuming many-to-one)
        lines.push(`    ${table.name} }o--|| ${col.references.table} : "${col.name}"`);
      }
    }
  }

  lines.push('```');
  return lines.join('\n');
}

function generateAsciiErd(snapshot: SchemaSnapshot): string {
  const lines: string[] = ['DATABASE SCHEMA', '═'.repeat(50), ''];

  for (const table of snapshot.tables) {
    lines.push(`┌${'─'.repeat(48)}┐`);
    lines.push(`│ ${table.name.padEnd(46)} │`);
    lines.push(`├${'─'.repeat(48)}┤`);

    for (const col of table.columns) {
      const pk = col.isPrimaryKey ? '🔑' : '  ';
      const fk = col.isForeignKey ? '🔗' : '  ';
      const nullable = col.nullable ? '?' : ' ';
      const colStr = `${pk}${fk} ${col.name}: ${col.type}${nullable}`;
      lines.push(`│ ${colStr.padEnd(46)} │`);
    }

    lines.push(`└${'─'.repeat(48)}┘`);
    lines.push('');
  }

  // Add relationships
  lines.push('RELATIONSHIPS', '─'.repeat(50));
  for (const table of snapshot.tables) {
    for (const col of table.columns) {
      if (col.isForeignKey && col.references) {
        lines.push(`${table.name}.${col.name} → ${col.references.table}.${col.references.column}`);
      }
    }
  }

  return lines.join('\n');
}

export async function dbConstraints(input: DbConstraintsInput): Promise<ToolResult> {
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

    // Verify table exists if specified
    if (table) {
      const exists = await driver.tableExists(table, config.database.schema);
      if (!exists) {
        return error(`Table '${table}' not found in schema '${config.database.schema}'`);
      }
    }

    // Use escaped identifiers for safety
    const schemaName = config.database.schema.replace(/'/g, "''");
    const tableName = table ? table.replace(/'/g, "''") : null;

    let sql = `
      SELECT
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        ccu.table_name AS foreign_table,
        ccu.column_name AS foreign_column,
        cc.check_clause
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.constraint_type = 'FOREIGN KEY'
      LEFT JOIN information_schema.check_constraints cc
        ON tc.constraint_name = cc.constraint_name
      WHERE tc.table_schema = '${schemaName}'
    `;

    if (tableName) {
      sql += ` AND tc.table_name = '${tableName}'`;
    }

    sql += ' ORDER BY tc.table_name, tc.constraint_type';

    const result = await driver.query(sql);

    interface Constraint {
      table: string;
      name: string;
      type: string;
      column?: string;
      foreignTable?: string;
      foreignColumn?: string;
      checkClause?: string;
    }

    const constraints: Constraint[] = result.rows.map((row: Record<string, unknown>) => ({
      table: row.table_name as string,
      name: row.constraint_name as string,
      type: row.constraint_type as string,
      column: row.column_name as string | undefined,
      foreignTable: row.foreign_table as string | undefined,
      foreignColumn: row.foreign_column as string | undefined,
      checkClause: row.check_clause as string | undefined,
    }));

    logger?.info('Constraints retrieved', { count: constraints.length });

    return success({
      success: true,
      constraintCount: constraints.length,
      constraints,
    });
  } catch (err) {
    logger?.error('Failed to get constraints', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to get constraints', err instanceof Error ? err.message : String(err));
  }
}

export async function dbAnalyze(input: DbAnalyzeInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, table, columns: specificColumns } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    // Validate table name
    const tableValidation = validateIdentifier(table, 'table');
    if (!tableValidation.valid) {
      return error(tableValidation.error!);
    }

    // Validate column names if provided
    if (specificColumns && specificColumns.length > 0) {
      const colValidation = validateIdentifiers(specificColumns, 'column');
      if (!colValidation.valid) {
        return error(colValidation.error!);
      }
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    // Verify table exists
    const exists = await driver.tableExists(table, config.database.schema);
    if (!exists) {
      return error(`Table '${table}' not found in schema '${config.database.schema}'`);
    }

    // Get columns (uses parameterized queries internally)
    const allColumns = await driver.getColumns(table, config.database.schema);
    if (allColumns.length === 0) {
      return error(`Table '${table}' has no columns`);
    }

    const columnsToAnalyze = specificColumns
      ? allColumns.filter(c => specificColumns.includes(c.name))
      : allColumns;

    interface ColumnAnalysis {
      name: string;
      type: string;
      totalRows: number;
      nullCount: number;
      nullPercentage: number;
      distinctCount: number;
      minValue?: unknown;
      maxValue?: unknown;
      trueCount?: number;
      falseCount?: number;
    }

    const analysis: ColumnAnalysis[] = [];

    // Use properly quoted identifiers
    const quotedTable = quoteIdentifier(table);

    // Get total row count
    const countResult = await driver.query(`SELECT COUNT(*) as count FROM ${quotedTable}`);
    const totalRows = ((countResult.rows[0] as Record<string, unknown>)?.count as number) || 0;

    for (const col of columnsToAnalyze) {
      const colName = col.name;
      const colType = col.type.toLowerCase();
      const quotedCol = quoteIdentifier(colName);

      // Determine column category for appropriate stats
      const isBooleanType = colType === 'boolean' || colType === 'bool';
      const isJsonType = colType === 'json' || colType === 'jsonb';
      const isArrayType = colType.endsWith('[]') || colType.startsWith('array');

      let statsQuery: string;
      if (isBooleanType) {
        // Boolean: count true/false
        statsQuery = `
          SELECT
            COUNT(*) - COUNT(${quotedCol}) as null_count,
            COUNT(DISTINCT ${quotedCol}) as distinct_count,
            SUM(CASE WHEN ${quotedCol} = true THEN 1 ELSE 0 END) as true_count,
            SUM(CASE WHEN ${quotedCol} = false THEN 1 ELSE 0 END) as false_count
          FROM ${quotedTable}
        `;
      } else if (isJsonType || isArrayType) {
        // JSON/JSONB/Array: only null count and distinct count
        statsQuery = `
          SELECT
            COUNT(*) - COUNT(${quotedCol}) as null_count,
            COUNT(DISTINCT ${quotedCol}::text) as distinct_count
          FROM ${quotedTable}
        `;
      } else {
        // Standard types: min/max
        statsQuery = `
          SELECT
            COUNT(*) - COUNT(${quotedCol}) as null_count,
            COUNT(DISTINCT ${quotedCol}) as distinct_count,
            MIN(${quotedCol})::text as min_val,
            MAX(${quotedCol})::text as max_val
          FROM ${quotedTable}
        `;
      }

      const statsResult = await driver.query(statsQuery);
      const stats = statsResult.rows[0] as Record<string, unknown>;

      const baseStats = {
        name: colName,
        type: col.type,
        totalRows,
        nullCount: (stats?.null_count as number) || 0,
        nullPercentage:
          totalRows > 0
            ? Math.round((((stats?.null_count as number) || 0) / totalRows) * 10000) / 100
            : 0,
        distinctCount: (stats?.distinct_count as number) || 0,
      };

      if (isBooleanType) {
        analysis.push({
          ...baseStats,
          trueCount: (stats?.true_count as number) || 0,
          falseCount: (stats?.false_count as number) || 0,
        });
      } else if (isJsonType || isArrayType) {
        // JSON/Array types - only basic stats, no min/max
        analysis.push(baseStats);
      } else {
        analysis.push({
          ...baseStats,
          minValue: stats?.min_val,
          maxValue: stats?.max_val,
        });
      }
    }

    logger?.info('Table analyzed', { table, columnCount: analysis.length });

    return success({
      success: true,
      table,
      totalRows,
      columns: analysis,
    });
  } catch (err) {
    logger?.error('Analysis failed', { error: err instanceof Error ? err.message : String(err) });
    return error('Failed to analyze table', err instanceof Error ? err.message : String(err));
  }
}

export async function dbDuplicates(input: DbDuplicatesInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, table, columns, limit = 100 } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    if (!columns || columns.length === 0) {
      return error('Please specify columns to check for duplicates');
    }

    // Validate table name
    const tableValidation = validateIdentifier(table, 'table');
    if (!tableValidation.valid) {
      return error(tableValidation.error!);
    }

    // Validate column names
    const colValidation = validateIdentifiers(columns, 'column');
    if (!colValidation.valid) {
      return error(colValidation.error!);
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    // Verify table exists
    const exists = await driver.tableExists(table, config.database.schema);
    if (!exists) {
      return error(`Table '${table}' not found in schema '${config.database.schema}'`);
    }

    // Use properly quoted identifiers
    const quotedTable = quoteIdentifier(table);
    const columnList = columns.map(c => quoteIdentifier(c)).join(', ');

    // Validate limit is a positive integer
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 10000);

    const sql = `
      SELECT ${columnList}, COUNT(*) as duplicate_count
      FROM ${quotedTable}
      GROUP BY ${columnList}
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT ${safeLimit}
    `;

    const result = await driver.query(sql);

    const totalDuplicateGroups = result.rowCount;
    let totalDuplicateRows = 0;
    for (const row of result.rows as Array<Record<string, unknown>>) {
      totalDuplicateRows += (row.duplicate_count as number) - 1; // -1 because one is the "original"
    }

    logger?.info('Duplicates found', { table, groups: totalDuplicateGroups });

    return success({
      success: true,
      table,
      columnsChecked: columns,
      duplicateGroups: totalDuplicateGroups,
      totalDuplicateRows,
      duplicates: result.rows,
    });
  } catch (err) {
    logger?.error('Duplicate check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to find duplicates', err instanceof Error ? err.message : String(err));
  }
}
