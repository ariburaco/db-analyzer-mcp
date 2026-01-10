import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { ConfigManager } from '../config/manager.ts';
import { getDriverWithConnection } from '../drivers/index.ts';
import type {
  DbExportInput,
  DbExportBatchInput,
  DbCompareInput,
  DbReportInput,
  DbQualityInput,
} from './schemas.ts';
import { success, error } from '../utils/result.ts';
import type { ToolResult } from '../utils/result.ts';
import { getLogger } from '../logger/index.ts';
import { validateIdentifier, validateIdentifiers } from '../security/index.ts';
import { validateQuery } from '../security/sql-validator.ts';

interface SchemaSnapshot {
  version: string;
  pulledAt: string;
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

/**
 * Export table data to JSON or CSV format
 */
export async function dbExport(input: DbExportInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, table, format = 'json', columns, where, limit = 1000 } = input;
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
    if (columns && columns.length > 0) {
      const colValidation = validateIdentifiers(columns, 'column');
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

    // Build query
    const columnList =
      columns && columns.length > 0
        ? columns.map(c => `"${c.replace(/"/g, '""')}"`).join(', ')
        : '*';

    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 10000);
    let sql = `SELECT ${columnList} FROM "${config.database.schema}"."${table}"`;

    if (where) {
      // Basic sanitization - only allow simple WHERE clauses
      if (!/^[a-zA-Z0-9_\s=<>!'".,()-]+$/.test(where)) {
        return error('Invalid WHERE clause. Only simple conditions allowed.');
      }
      sql += ` WHERE ${where}`;
    }

    sql += ` LIMIT ${safeLimit}`;

    const result = await driver.query(sql);

    let output: string;
    if (format === 'csv') {
      // Convert to CSV
      if (result.rows.length === 0) {
        output = '';
      } else {
        const headers = Object.keys(result.rows[0] as Record<string, unknown>);
        const csvLines = [headers.join(',')];

        for (const row of result.rows as Array<Record<string, unknown>>) {
          const values = headers.map(h => {
            const val = row[h];
            if (val === null || val === undefined) return '';
            if (typeof val === 'string') {
              return `"${val.replace(/"/g, '""')}"`;
            }
            if (typeof val === 'object') {
              return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
            }
            return String(val);
          });
          csvLines.push(values.join(','));
        }
        output = csvLines.join('\n');
      }
    } else {
      output = JSON.stringify(result.rows, null, 2);
    }

    // Save to file
    const exportDir = join(configManager.dbMcpPath, 'exports');
    if (!existsSync(exportDir)) {
      const { mkdirSync } = await import('fs');
      mkdirSync(exportDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${table}_${timestamp}.${format}`;
    const filepath = join(exportDir, filename);
    writeFileSync(filepath, output);

    logger?.info('Data exported', { table, format, rowCount: result.rowCount });

    return success({
      success: true,
      table,
      format,
      rowCount: result.rowCount,
      filepath,
      preview: output.substring(0, 500) + (output.length > 500 ? '...' : ''),
    });
  } catch (err) {
    logger?.error('Export failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to export data', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Export large datasets with automatic batching
 * Streams directly to file to bypass MCP token limits
 */
export async function dbExportBatch(input: DbExportBatchInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, sql, outputPath, format = 'jsonl', batchSize = 10000, maxRows } = input;

    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    // Validate SQL query
    const validation = validateQuery(sql);
    if (!validation.valid) {
      return error(`Invalid query: ${validation.error}`);
    }

    // Check for ORDER BY (required for consistent pagination)
    if (!/\bORDER\s+BY\b/i.test(sql)) {
      return error('Query must include ORDER BY clause for consistent pagination');
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    // Determine output file path
    let filepath: string;
    if (outputPath) {
      filepath = outputPath.startsWith('/') ? outputPath : join(projectPath, outputPath);
      // Ensure directory exists
      const dir = dirname(filepath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    } else {
      const exportDir = join(configManager.dbMcpPath, 'exports');
      if (!existsSync(exportDir)) {
        mkdirSync(exportDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      filepath = join(exportDir, `batch_export_${timestamp}.${format}`);
    }

    // Remove the LIMIT from original query if present (we'll add our own)
    let baseQuery = sql.replace(/\bLIMIT\s+\d+\s*(OFFSET\s+\d+)?/gi, '').trim();
    // Remove trailing semicolon if any
    baseQuery = baseQuery.replace(/;$/, '').trim();

    let totalRows = 0;
    let batchCount = 0;
    let offset = 0;
    let isFirstBatch = true;
    const startTime = Date.now();
    let headers: string[] = [];

    // For JSON format, we need to track if we need to close the array
    if (format === 'json') {
      writeFileSync(filepath, '[\n');
    }

    // Batch loop
    while (true) {
      const effectiveLimit = maxRows ? Math.min(batchSize, maxRows - totalRows) : batchSize;
      if (effectiveLimit <= 0) break;

      const batchQuery = `${baseQuery} LIMIT ${effectiveLimit} OFFSET ${offset}`;
      const result = await driver.query(batchQuery);

      if (result.rows.length === 0) {
        break; // No more data
      }

      // Write batch to file
      if (format === 'jsonl') {
        // JSONL: one JSON object per line
        const lines = (result.rows as Array<Record<string, unknown>>)
          .map(row => JSON.stringify(row))
          .join('\n');
        appendFileSync(filepath, (totalRows > 0 ? '\n' : '') + lines);
      } else if (format === 'csv') {
        // CSV format
        if (isFirstBatch && result.rows.length > 0) {
          headers = Object.keys(result.rows[0] as Record<string, unknown>);
          writeFileSync(filepath, headers.join(',') + '\n');
        }

        const csvLines = (result.rows as Array<Record<string, unknown>>)
          .map(row => {
            return headers
              .map(h => {
                const val = row[h];
                if (val === null || val === undefined) return '';
                if (typeof val === 'string') {
                  return `"${val.replace(/"/g, '""')}"`;
                }
                if (typeof val === 'object') {
                  return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
                }
                return String(val);
              })
              .join(',');
          })
          .join('\n');
        appendFileSync(filepath, csvLines + '\n');
      } else {
        // JSON format (array)
        const jsonRows = (result.rows as Array<Record<string, unknown>>)
          .map(row => '  ' + JSON.stringify(row))
          .join(',\n');
        appendFileSync(filepath, (totalRows > 0 ? ',\n' : '') + jsonRows);
      }

      totalRows += result.rows.length;
      batchCount++;
      offset += result.rows.length;
      isFirstBatch = false;

      logger?.info('Batch exported', {
        batch: batchCount,
        rows: result.rows.length,
        totalRows,
      });

      // Check if we got fewer rows than requested (end of data)
      if (result.rows.length < effectiveLimit) {
        break;
      }

      // Check max rows limit
      if (maxRows && totalRows >= maxRows) {
        break;
      }
    }

    // Close JSON array if needed
    if (format === 'json') {
      appendFileSync(filepath, '\n]');
    }

    const duration = Date.now() - startTime;

    logger?.info('Batch export completed', {
      filepath,
      totalRows,
      batchCount,
      duration,
    });

    return success({
      success: true,
      filepath,
      format,
      totalRows,
      batchCount,
      batchSize,
      durationMs: duration,
      rowsPerSecond: Math.round(totalRows / (duration / 1000)),
      hint:
        format === 'jsonl'
          ? 'JSONL files can be read line-by-line. Use: bun -e "for await (const line of Bun.file(\'path\').stream()) console.log(JSON.parse(line))"'
          : undefined,
    });
  } catch (err) {
    logger?.error('Batch export failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to export data', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Compare two schema snapshots
 */
export async function dbCompare(input: DbCompareInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, snapshotPath } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    // Load current snapshot
    const currentSnapshot = loadSnapshot(configManager);
    if (!currentSnapshot) {
      return error('Current schema not found. Run db_pull first.');
    }

    // Load comparison snapshot
    if (!existsSync(snapshotPath)) {
      return error(`Snapshot file not found: ${snapshotPath}`);
    }

    const compareSnapshot: SchemaSnapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

    interface Difference {
      type: 'added' | 'removed' | 'modified';
      entity: 'table' | 'column' | 'index';
      table: string;
      name?: string;
      details?: string;
    }

    const differences: Difference[] = [];

    // Build table maps
    const currentTables = new Map(currentSnapshot.tables.map(t => [t.name, t]));
    const compareTables = new Map(compareSnapshot.tables.map(t => [t.name, t]));

    // Find added tables
    for (const [name, table] of currentTables) {
      if (!compareTables.has(name)) {
        differences.push({
          type: 'added',
          entity: 'table',
          table: name,
          details: `${table.columns.length} columns`,
        });
      }
    }

    // Find removed tables
    for (const [name] of compareTables) {
      if (!currentTables.has(name)) {
        differences.push({
          type: 'removed',
          entity: 'table',
          table: name,
        });
      }
    }

    // Compare existing tables
    for (const [name, currentTable] of currentTables) {
      const compareTable = compareTables.get(name);
      if (!compareTable) continue;

      // Compare columns
      const currentCols = new Map(currentTable.columns.map(c => [c.name, c]));
      const compareCols = new Map(compareTable.columns.map(c => [c.name, c]));

      for (const [colName, col] of currentCols) {
        if (!compareCols.has(colName)) {
          differences.push({
            type: 'added',
            entity: 'column',
            table: name,
            name: colName,
            details: col.type,
          });
        } else {
          const compareCol = compareCols.get(colName)!;
          if (col.type !== compareCol.type || col.nullable !== compareCol.nullable) {
            differences.push({
              type: 'modified',
              entity: 'column',
              table: name,
              name: colName,
              details: `${compareCol.type} → ${col.type}`,
            });
          }
        }
      }

      for (const [colName] of compareCols) {
        if (!currentCols.has(colName)) {
          differences.push({
            type: 'removed',
            entity: 'column',
            table: name,
            name: colName,
          });
        }
      }

      // Compare indexes
      const currentIdxs = new Map(currentTable.indexes.map(i => [i.name, i]));
      const compareIdxs = new Map(compareTable.indexes.map(i => [i.name, i]));

      for (const [idxName, idx] of currentIdxs) {
        if (!compareIdxs.has(idxName)) {
          differences.push({
            type: 'added',
            entity: 'index',
            table: name,
            name: idxName,
            details: idx.columns.join(', '),
          });
        }
      }

      for (const [idxName] of compareIdxs) {
        if (!currentIdxs.has(idxName)) {
          differences.push({
            type: 'removed',
            entity: 'index',
            table: name,
            name: idxName,
          });
        }
      }
    }

    logger?.info('Schema comparison completed', { differenceCount: differences.length });

    return success({
      success: true,
      currentSnapshot: {
        pulledAt: currentSnapshot.pulledAt,
        tableCount: currentSnapshot.tables.length,
      },
      compareSnapshot: {
        pulledAt: compareSnapshot.pulledAt,
        tableCount: compareSnapshot.tables.length,
      },
      differenceCount: differences.length,
      differences,
      summary: {
        added: differences.filter(d => d.type === 'added').length,
        removed: differences.filter(d => d.type === 'removed').length,
        modified: differences.filter(d => d.type === 'modified').length,
      },
    });
  } catch (err) {
    logger?.error('Schema comparison failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to compare schemas', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Generate comprehensive database report in markdown
 */
export async function dbReport(input: DbReportInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, includeData = false } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    const snapshot = loadSnapshot(configManager);
    if (!snapshot) {
      return error('Schema not found. Run db_pull first.');
    }

    const lines: string[] = [];

    // Header
    lines.push('# Database Report');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Schema: ${config.database.schema}`);
    lines.push(`Pulled at: ${snapshot.pulledAt}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`- **Tables**: ${snapshot.tables.length}`);

    let totalRows = 0;
    let totalColumns = 0;
    let totalIndexes = 0;

    for (const table of snapshot.tables) {
      totalRows += table.rowCount;
      totalColumns += table.columns.length;
      totalIndexes += table.indexes.length;
    }

    lines.push(`- **Total Rows**: ${totalRows.toLocaleString()}`);
    lines.push(`- **Total Columns**: ${totalColumns}`);
    lines.push(`- **Total Indexes**: ${totalIndexes}`);
    lines.push('');

    // Tables section
    lines.push('## Tables');
    lines.push('');
    lines.push('| Table | Rows | Columns | Indexes |');
    lines.push('|-------|------|---------|---------|');

    for (const table of snapshot.tables.sort((a, b) => b.rowCount - a.rowCount)) {
      lines.push(
        `| ${table.name} | ${table.rowCount.toLocaleString()} | ${table.columns.length} | ${table.indexes.length} |`
      );
    }
    lines.push('');

    // Detailed schema for each table
    lines.push('## Schema Details');
    lines.push('');

    for (const table of snapshot.tables) {
      lines.push(`### ${table.name}`);
      lines.push('');
      lines.push(`Rows: ${table.rowCount.toLocaleString()}`);
      lines.push('');

      // Columns
      lines.push('#### Columns');
      lines.push('');
      lines.push('| Column | Type | Nullable | PK | FK |');
      lines.push('|--------|------|----------|----|----|');

      for (const col of table.columns) {
        const pk = col.isPrimaryKey ? '✓' : '';
        const fk = col.isForeignKey ? `→ ${col.references?.table}` : '';
        lines.push(
          `| ${col.name} | ${col.type} | ${col.nullable ? 'Yes' : 'No'} | ${pk} | ${fk} |`
        );
      }
      lines.push('');

      // Indexes
      if (table.indexes.length > 0) {
        lines.push('#### Indexes');
        lines.push('');
        lines.push('| Index | Columns | Unique | Primary |');
        lines.push('|-------|---------|--------|---------|');

        for (const idx of table.indexes) {
          lines.push(
            `| ${idx.name} | ${idx.columns.join(', ')} | ${idx.isUnique ? '✓' : ''} | ${idx.isPrimary ? '✓' : ''} |`
          );
        }
        lines.push('');
      }

      // Sample data
      if (includeData) {
        try {
          const sample = await driver.getSampleData(table.name, 3, table.schema);
          if (sample.rows.length > 0) {
            lines.push('#### Sample Data');
            lines.push('');
            lines.push('```json');
            lines.push(JSON.stringify(sample.rows, null, 2));
            lines.push('```');
            lines.push('');
          }
        } catch {
          // Skip if sample fails
        }
      }
    }

    // Relationships
    lines.push('## Relationships');
    lines.push('');
    lines.push('```mermaid');
    lines.push('erDiagram');

    for (const table of snapshot.tables) {
      for (const col of table.columns) {
        if (col.isForeignKey && col.references) {
          lines.push(`    ${table.name} }o--|| ${col.references.table} : "${col.name}"`);
        }
      }
    }

    lines.push('```');
    lines.push('');

    const report = lines.join('\n');

    // Save report
    const reportPath = join(configManager.dbMcpPath, 'report.md');
    writeFileSync(reportPath, report);

    logger?.info('Report generated', { tableCount: snapshot.tables.length });

    return success({
      success: true,
      reportPath,
      tableCount: snapshot.tables.length,
      preview: report.substring(0, 1000) + '...',
    });
  } catch (err) {
    logger?.error('Report generation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to generate report', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Data quality checks - referential integrity, orphans, etc.
 */
export async function dbQuality(input: DbQualityInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, table } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    if (table) {
      const tableValidation = validateIdentifier(table, 'table');
      if (!tableValidation.valid) {
        return error(tableValidation.error!);
      }
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    const snapshot = loadSnapshot(configManager);
    if (!snapshot) {
      return error('Schema not found. Run db_pull first.');
    }

    interface QualityIssue {
      type: 'orphan' | 'null_fk' | 'duplicate_pk' | 'constraint_violation';
      severity: 'high' | 'medium' | 'low';
      table: string;
      column?: string;
      count: number;
      description: string;
    }

    const issues: QualityIssue[] = [];

    // Filter tables if specified
    const tablesToCheck = table
      ? snapshot.tables.filter(t => t.name.toLowerCase() === table.toLowerCase())
      : snapshot.tables;

    for (const t of tablesToCheck) {
      // Check for orphaned foreign keys
      for (const col of t.columns) {
        if (col.isForeignKey && col.references) {
          const orphanQuery = `
            SELECT COUNT(*) as count
            FROM "${t.name}" child
            LEFT JOIN "${col.references.table}" parent
              ON child."${col.name}" = parent."${col.references.column}"
            WHERE child."${col.name}" IS NOT NULL
              AND parent."${col.references.column}" IS NULL
          `;

          try {
            const orphanResult = await driver.query(orphanQuery);
            const orphanCount = (orphanResult.rows[0] as Record<string, number>).count || 0;

            if (orphanCount > 0) {
              issues.push({
                type: 'orphan',
                severity: 'high',
                table: t.name,
                column: col.name,
                count: orphanCount,
                description: `${orphanCount} orphaned records: ${t.name}.${col.name} → ${col.references.table}.${col.references.column}`,
              });
            }
          } catch {
            // Skip if query fails (table might not exist)
          }

          // Check for NULL foreign keys
          const nullFkQuery = `
            SELECT COUNT(*) as count
            FROM "${t.name}"
            WHERE "${col.name}" IS NULL
          `;

          try {
            const nullResult = await driver.query(nullFkQuery);
            const nullCount = (nullResult.rows[0] as Record<string, number>).count || 0;

            if (nullCount > 0 && !col.nullable) {
              issues.push({
                type: 'null_fk',
                severity: 'medium',
                table: t.name,
                column: col.name,
                count: nullCount,
                description: `${nullCount} NULL values in non-nullable FK: ${t.name}.${col.name}`,
              });
            }
          } catch {
            // Skip if query fails
          }
        }
      }

      // Check for NULL in primary keys
      const pkCols = t.columns.filter(c => c.isPrimaryKey);
      for (const pk of pkCols) {
        const nullPkQuery = `
          SELECT COUNT(*) as count
          FROM "${t.name}"
          WHERE "${pk.name}" IS NULL
        `;

        try {
          const nullResult = await driver.query(nullPkQuery);
          const nullCount = (nullResult.rows[0] as Record<string, number>).count || 0;

          if (nullCount > 0) {
            issues.push({
              type: 'constraint_violation',
              severity: 'high',
              table: t.name,
              column: pk.name,
              count: nullCount,
              description: `${nullCount} NULL values in primary key: ${t.name}.${pk.name}`,
            });
          }
        } catch {
          // Skip if query fails
        }
      }
    }

    // Sort issues by severity
    const severityOrder = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    logger?.info('Quality check completed', {
      issueCount: issues.length,
      tablesChecked: tablesToCheck.length,
    });

    return success({
      success: true,
      tablesChecked: tablesToCheck.length,
      issueCount: issues.length,
      issues,
      summary: {
        high: issues.filter(i => i.severity === 'high').length,
        medium: issues.filter(i => i.severity === 'medium').length,
        low: issues.filter(i => i.severity === 'low').length,
      },
    });
  } catch (err) {
    logger?.error('Quality check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to run quality check', err instanceof Error ? err.message : String(err));
  }
}
