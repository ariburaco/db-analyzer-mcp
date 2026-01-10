import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ConfigManager } from '../config/manager.ts';
import type { DbGrepInput, DbOverviewInput, DbRelatedInput } from './schemas.ts';
import { success, error } from '../utils/result.ts';
import type { ToolResult } from '../utils/result.ts';
import { getLogger } from '../logger/index.ts';

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

/**
 * db_grep - Search schema for keywords
 * Fast way to find relevant tables/columns without loading full schema
 */
export async function dbGrep(input: DbGrepInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, query, searchIn = 'all' } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const snapshot = loadSnapshot(configManager);
    if (!snapshot) {
      return error('Schema snapshot not found. Run db_pull first.');
    }

    const queryLower = query.toLowerCase();
    const results: {
      tables: string[];
      columns: Array<{ table: string; column: string; type: string }>;
      types: Array<{ table: string; column: string; type: string }>;
    } = {
      tables: [],
      columns: [],
      types: [],
    };

    for (const table of snapshot.tables) {
      // Search table names
      if (searchIn === 'all' || searchIn === 'tables') {
        if (table.name.toLowerCase().includes(queryLower)) {
          results.tables.push(table.name);
        }
      }

      // Search columns and types
      for (const col of table.columns) {
        if (searchIn === 'all' || searchIn === 'columns') {
          if (col.name.toLowerCase().includes(queryLower)) {
            results.columns.push({
              table: table.name,
              column: col.name,
              type: col.type,
            });
          }
        }

        if (searchIn === 'all' || searchIn === 'types') {
          if (col.type.toLowerCase().includes(queryLower)) {
            results.types.push({
              table: table.name,
              column: col.name,
              type: col.type,
            });
          }
        }
      }
    }

    const totalMatches = results.tables.length + results.columns.length + results.types.length;

    logger?.info('Schema grep completed', { query, matches: totalMatches });

    return success({
      success: true,
      query,
      searchIn,
      matches: totalMatches,
      results: {
        tables: results.tables.length > 0 ? results.tables : undefined,
        columns: results.columns.length > 0 ? results.columns : undefined,
        types: results.types.length > 0 ? results.types : undefined,
      },
      hint:
        totalMatches > 0
          ? `Use db_schema(table="X") to get full details for a specific table`
          : `No matches found. Try a different keyword.`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger?.error('Schema grep failed', { error: errorMessage });
    return error('Schema grep failed', errorMessage);
  }
}

/**
 * db_overview - Compact schema summary
 * Returns minimal info to understand DB structure
 */
export async function dbOverview(input: DbOverviewInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, includeColumns = false } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const snapshot = loadSnapshot(configManager);
    if (!snapshot) {
      return error('Schema snapshot not found. Run db_pull first.');
    }

    // Build compact overview
    const overview = snapshot.tables.map(table => {
      const pks = table.columns.filter(c => c.isPrimaryKey).map(c => c.name);
      const fks = table.columns
        .filter(c => c.isForeignKey && c.references)
        .map(c => ({
          column: c.name,
          references: `${c.references!.table}.${c.references!.column}`,
        }));

      const base: {
        table: string;
        rows: number;
        pk: string[];
        fk: Array<{ column: string; references: string }>;
        columns?: string[];
      } = {
        table: table.name,
        rows: table.rowCount,
        pk: pks,
        fk: fks,
      };

      if (includeColumns) {
        base.columns = table.columns.map(c => c.name);
      }

      return base;
    });

    // Group by row count for summary
    const withData = overview.filter(t => t.rows > 0).length;
    const empty = overview.filter(t => t.rows === 0).length;
    const totalFKs = overview.reduce((sum, t) => sum + t.fk.length, 0);

    logger?.info('Schema overview generated', { tables: overview.length });

    return success({
      success: true,
      summary: {
        totalTables: overview.length,
        tablesWithData: withData,
        emptyTables: empty,
        totalForeignKeys: totalFKs,
      },
      tables: overview,
      hint: 'Use db_grep(query="keyword") to search for specific tables/columns, or db_schema(table="X") for full details.',
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger?.error('Schema overview failed', { error: errorMessage });
    return error('Schema overview failed', errorMessage);
  }
}

/**
 * db_related - Find related tables via FK
 * Traverses foreign key relationships to build a graph
 */
export async function dbRelated(input: DbRelatedInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, table, depth = 1 } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const snapshot = loadSnapshot(configManager);
    if (!snapshot) {
      return error('Schema snapshot not found. Run db_pull first.');
    }

    // Find the target table
    const targetTable = snapshot.tables.find(t => t.name.toLowerCase() === table.toLowerCase());
    if (!targetTable) {
      return error(`Table "${table}" not found`);
    }

    // Build FK graph
    const graph: Map<
      string,
      {
        referencesTo: Array<{ table: string; via: string; column: string }>;
        referencedBy: Array<{ table: string; via: string; column: string }>;
      }
    > = new Map();

    // Initialize graph for all tables
    for (const t of snapshot.tables) {
      graph.set(t.name, { referencesTo: [], referencedBy: [] });
    }

    // Build relationships
    for (const t of snapshot.tables) {
      for (const col of t.columns) {
        if (col.isForeignKey && col.references) {
          // t.name -> col.references.table
          graph.get(t.name)!.referencesTo.push({
            table: col.references.table,
            via: col.name,
            column: col.references.column,
          });
          // col.references.table <- t.name
          graph.get(col.references.table)?.referencedBy.push({
            table: t.name,
            via: col.name,
            column: col.references.column,
          });
        }
      }
    }

    // BFS to find related tables up to depth
    const visited = new Set<string>();
    const related: Array<{
      table: string;
      depth: number;
      relation: 'direct' | 'references' | 'referenced_by';
      via?: string;
    }> = [];

    const queue: Array<{ tableName: string; currentDepth: number }> = [
      { tableName: targetTable.name, currentDepth: 0 },
    ];
    visited.add(targetTable.name);

    const effectiveDepth = Math.min(Math.max(1, depth), 3);

    while (queue.length > 0) {
      const { tableName, currentDepth } = queue.shift()!;

      if (currentDepth >= effectiveDepth) continue;

      const tableGraph = graph.get(tableName);
      if (!tableGraph) continue;

      // Tables this table references (FK outgoing)
      for (const ref of tableGraph.referencesTo) {
        if (!visited.has(ref.table)) {
          visited.add(ref.table);
          related.push({
            table: ref.table,
            depth: currentDepth + 1,
            relation: 'references',
            via: `${tableName}.${ref.via} -> ${ref.table}.${ref.column}`,
          });
          queue.push({ tableName: ref.table, currentDepth: currentDepth + 1 });
        }
      }

      // Tables that reference this table (FK incoming)
      for (const ref of tableGraph.referencedBy) {
        if (!visited.has(ref.table)) {
          visited.add(ref.table);
          related.push({
            table: ref.table,
            depth: currentDepth + 1,
            relation: 'referenced_by',
            via: `${ref.table}.${ref.via} -> ${tableName}.${ref.column}`,
          });
          queue.push({ tableName: ref.table, currentDepth: currentDepth + 1 });
        }
      }
    }

    // Get target table info
    const targetInfo = {
      name: targetTable.name,
      rows: targetTable.rowCount,
      columns: targetTable.columns.length,
      pk: targetTable.columns.filter(c => c.isPrimaryKey).map(c => c.name),
      directReferences: graph.get(targetTable.name)!.referencesTo.map(r => r.table),
      directlyReferencedBy: graph.get(targetTable.name)!.referencedBy.map(r => r.table),
    };

    logger?.info('Related tables found', { table, related: related.length });

    return success({
      success: true,
      table: targetInfo,
      related,
      totalRelated: related.length,
      hint:
        related.length > 0
          ? `Use db_schema(table="X") to see column details for any related table`
          : `This table has no foreign key relationships`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger?.error('Find related tables failed', { error: errorMessage });
    return error('Find related tables failed', errorMessage);
  }
}
