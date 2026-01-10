import { ConfigManager } from '../config/manager.ts';
import { getDriverWithConnection } from '../drivers/index.ts';
import type {
  DbHealthInput,
  DbLocksInput,
  DbSlowQueriesInput,
  DbSuggestIndexesInput,
  DbUnusedIndexesInput,
  DbBloatInput,
} from './schemas.ts';
import { success, error } from '../utils/result.ts';
import type { ToolResult } from '../utils/result.ts';
import { getLogger } from '../logger/index.ts';
import { validateIdentifier } from '../security/index.ts';

/**
 * Database health check - connections, activity, disk usage
 */
export async function dbHealth(input: DbHealthInput): Promise<ToolResult> {
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

    // Connection stats
    const connResult = await driver.query(`
      SELECT
        count(*) FILTER (WHERE state = 'active') as active_connections,
        count(*) FILTER (WHERE state = 'idle') as idle_connections,
        count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
        count(*) as total_connections,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);

    const connStats = connResult.rows[0] as Record<string, number>;

    // Database size
    const sizeResult = await driver.query(`
      SELECT
        pg_database_size(current_database()) as db_size_bytes,
        pg_size_pretty(pg_database_size(current_database())) as db_size_pretty
    `);
    const sizeStats = sizeResult.rows[0] as Record<string, unknown>;

    // Cache hit ratio
    const cacheResult = await driver.query(`
      SELECT
        sum(heap_blks_read) as heap_read,
        sum(heap_blks_hit) as heap_hit,
        CASE
          WHEN sum(heap_blks_hit) + sum(heap_blks_read) = 0 THEN 0
          ELSE round(sum(heap_blks_hit)::numeric / (sum(heap_blks_hit) + sum(heap_blks_read)) * 100, 2)
        END as cache_hit_ratio
      FROM pg_statio_user_tables
    `);
    const cacheStats = cacheResult.rows[0] as Record<string, number>;

    // Transaction stats
    const txResult = await driver.query(`
      SELECT
        xact_commit as commits,
        xact_rollback as rollbacks,
        tup_inserted as inserts,
        tup_updated as updates,
        tup_deleted as deletes,
        tup_returned as rows_returned,
        tup_fetched as rows_fetched
      FROM pg_stat_database
      WHERE datname = current_database()
    `);
    const txStats = txResult.rows[0] as Record<string, number>;

    // Uptime
    const uptimeResult = await driver.query(`
      SELECT
        now() - pg_postmaster_start_time() as uptime,
        pg_postmaster_start_time() as started_at
    `);
    const uptimeStats = uptimeResult.rows[0] as Record<string, unknown>;

    // Long running queries
    const longQueriesResult = await driver.query(`
      SELECT count(*) as long_running_count
      FROM pg_stat_activity
      WHERE state = 'active'
        AND now() - query_start > interval '30 seconds'
        AND query NOT LIKE 'SELECT%pg_stat%'
    `);
    const longQueries = longQueriesResult.rows[0] as Record<string, number>;

    const health = {
      status: 'healthy',
      connections: {
        active: connStats.active_connections || 0,
        idle: connStats.idle_connections || 0,
        idleInTransaction: connStats.idle_in_transaction || 0,
        total: connStats.total_connections || 0,
        max: connStats.max_connections || 100,
        usagePercent: Math.round(
          ((connStats.total_connections || 0) / (connStats.max_connections || 100)) * 100
        ),
      },
      database: {
        sizeBytes: sizeStats.db_size_bytes as number,
        sizePretty: sizeStats.db_size_pretty as string,
      },
      cache: {
        hitRatio: cacheStats.cache_hit_ratio || 0,
        status:
          (cacheStats.cache_hit_ratio || 0) >= 99
            ? 'excellent'
            : (cacheStats.cache_hit_ratio || 0) >= 95
              ? 'good'
              : 'needs_attention',
      },
      transactions: {
        commits: txStats.commits || 0,
        rollbacks: txStats.rollbacks || 0,
        rollbackRatio:
          (txStats.commits || 0) > 0
            ? Math.round(((txStats.rollbacks || 0) / (txStats.commits || 1)) * 10000) / 100
            : 0,
      },
      activity: {
        inserts: txStats.inserts || 0,
        updates: txStats.updates || 0,
        deletes: txStats.deletes || 0,
        rowsReturned: txStats.rows_returned || 0,
      },
      uptime: {
        duration: String(uptimeStats.uptime),
        startedAt: String(uptimeStats.started_at),
      },
      warnings: [] as string[],
      longRunningQueries: longQueries.long_running_count || 0,
    };

    // Add warnings
    if (health.connections.usagePercent > 80) {
      health.warnings.push(`High connection usage: ${health.connections.usagePercent}%`);
      health.status = 'warning';
    }
    if (health.cache.hitRatio < 95) {
      health.warnings.push(`Low cache hit ratio: ${health.cache.hitRatio}%`);
      health.status = 'warning';
    }
    if (health.transactions.rollbackRatio > 5) {
      health.warnings.push(`High rollback ratio: ${health.transactions.rollbackRatio}%`);
      health.status = 'warning';
    }
    if (health.longRunningQueries > 0) {
      health.warnings.push(`${health.longRunningQueries} long-running queries (>30s)`);
    }

    logger?.info('Health check completed', { status: health.status });

    return success({
      success: true,
      health,
    });
  } catch (err) {
    logger?.error('Health check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to get database health', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Active locks and blocking queries
 */
export async function dbLocks(input: DbLocksInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, includeIdle = false } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    // Active locks
    const locksResult = await driver.query(`
      SELECT
        l.locktype,
        l.mode,
        l.granted,
        l.pid,
        a.usename as username,
        a.application_name,
        a.client_addr,
        a.state,
        a.query_start,
        now() - a.query_start as duration,
        CASE WHEN length(a.query) > 100 THEN substring(a.query, 1, 100) || '...' ELSE a.query END as query,
        l.relation::regclass as table_name
      FROM pg_locks l
      JOIN pg_stat_activity a ON l.pid = a.pid
      WHERE l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
        ${includeIdle ? '' : "AND a.state != 'idle'"}
      ORDER BY a.query_start
      LIMIT 50
    `);

    // Blocking queries
    const blockingResult = await driver.query(`
      SELECT
        blocked.pid as blocked_pid,
        blocked.usename as blocked_user,
        CASE WHEN length(blocked.query) > 100 THEN substring(blocked.query, 1, 100) || '...' ELSE blocked.query END as blocked_query,
        blocking.pid as blocking_pid,
        blocking.usename as blocking_user,
        CASE WHEN length(blocking.query) > 100 THEN substring(blocking.query, 1, 100) || '...' ELSE blocking.query END as blocking_query,
        now() - blocked.query_start as blocked_duration
      FROM pg_stat_activity blocked
      JOIN pg_locks blocked_locks ON blocked.pid = blocked_locks.pid
      JOIN pg_locks blocking_locks ON blocked_locks.locktype = blocking_locks.locktype
        AND blocked_locks.database IS NOT DISTINCT FROM blocking_locks.database
        AND blocked_locks.relation IS NOT DISTINCT FROM blocking_locks.relation
        AND blocked_locks.page IS NOT DISTINCT FROM blocking_locks.page
        AND blocked_locks.tuple IS NOT DISTINCT FROM blocking_locks.tuple
        AND blocked_locks.virtualxid IS NOT DISTINCT FROM blocking_locks.virtualxid
        AND blocked_locks.transactionid IS NOT DISTINCT FROM blocking_locks.transactionid
        AND blocked_locks.classid IS NOT DISTINCT FROM blocking_locks.classid
        AND blocked_locks.objid IS NOT DISTINCT FROM blocking_locks.objid
        AND blocked_locks.objsubid IS NOT DISTINCT FROM blocking_locks.objsubid
        AND blocked_locks.pid != blocking_locks.pid
      JOIN pg_stat_activity blocking ON blocking_locks.pid = blocking.pid
      WHERE NOT blocked_locks.granted
      ORDER BY blocked.query_start
      LIMIT 20
    `);

    // Lock summary by type
    const summaryResult = await driver.query(`
      SELECT
        locktype,
        mode,
        count(*) as count,
        count(*) FILTER (WHERE granted) as granted,
        count(*) FILTER (WHERE NOT granted) as waiting
      FROM pg_locks
      WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
      GROUP BY locktype, mode
      ORDER BY count DESC
    `);

    logger?.info('Locks retrieved', {
      lockCount: locksResult.rowCount,
      blockingCount: blockingResult.rowCount,
    });

    return success({
      success: true,
      lockCount: locksResult.rowCount,
      blockingCount: blockingResult.rowCount,
      locks: locksResult.rows,
      blocking: blockingResult.rows,
      summary: summaryResult.rows,
    });
  } catch (err) {
    logger?.error('Failed to get locks', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to get locks', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Slow queries from pg_stat_statements
 */
export async function dbSlowQueries(input: DbSlowQueriesInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, minDurationMs = 100, limit = 20 } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    // Check if pg_stat_statements is available
    const extCheck = await driver.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
      ) as has_extension
    `);

    const hasExtension = (extCheck.rows[0] as Record<string, boolean>).has_extension;

    if (!hasExtension) {
      // Fallback to pg_stat_activity for currently running slow queries
      const activeResult = await driver.query(`
        SELECT
          pid,
          usename as username,
          application_name,
          client_addr,
          state,
          query_start,
          now() - query_start as duration,
          CASE WHEN length(query) > 200 THEN substring(query, 1, 200) || '...' ELSE query END as query
        FROM pg_stat_activity
        WHERE state = 'active'
          AND now() - query_start > interval '${Math.floor(minDurationMs)}ms'
          AND query NOT LIKE '%pg_stat%'
        ORDER BY query_start
        LIMIT ${Math.min(limit, 50)}
      `);

      return success({
        success: true,
        source: 'pg_stat_activity',
        note: 'pg_stat_statements not installed. Showing currently running slow queries only.',
        queryCount: activeResult.rowCount,
        queries: activeResult.rows,
      });
    }

    // Use pg_stat_statements for historical data
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100);

    const slowResult = await driver.query(`
      SELECT
        queryid,
        CASE WHEN length(query) > 200 THEN substring(query, 1, 200) || '...' ELSE query END as query,
        calls,
        round(total_exec_time::numeric, 2) as total_time_ms,
        round(mean_exec_time::numeric, 2) as avg_time_ms,
        round(min_exec_time::numeric, 2) as min_time_ms,
        round(max_exec_time::numeric, 2) as max_time_ms,
        round(stddev_exec_time::numeric, 2) as stddev_ms,
        rows,
        round((100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0))::numeric, 2) as cache_hit_percent
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND mean_exec_time > ${minDurationMs}
      ORDER BY total_exec_time DESC
      LIMIT ${safeLimit}
    `);

    logger?.info('Slow queries retrieved', { count: slowResult.rowCount });

    return success({
      success: true,
      source: 'pg_stat_statements',
      minDurationMs,
      queryCount: slowResult.rowCount,
      queries: slowResult.rows,
    });
  } catch (err) {
    logger?.error('Failed to get slow queries', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to get slow queries', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Suggest missing indexes based on sequential scans
 */
export async function dbSuggestIndexes(input: DbSuggestIndexesInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, table, minSize = 10000 } = input;
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

    // Tables with high sequential scan ratio
    let seqScanQuery = `
      SELECT
        schemaname as schema,
        relname as table_name,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        n_live_tup as row_count,
        CASE
          WHEN seq_scan + idx_scan = 0 THEN 0
          ELSE round((seq_scan::numeric / (seq_scan + idx_scan)) * 100, 2)
        END as seq_scan_percent,
        pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) as table_size
      FROM pg_stat_user_tables
      WHERE n_live_tup > ${Math.floor(minSize)}
        AND seq_scan > idx_scan
    `;

    if (table) {
      seqScanQuery += ` AND relname = '${table.replace(/'/g, "''")}'`;
    }

    seqScanQuery += ` ORDER BY seq_tup_read DESC LIMIT 20`;

    const seqScanResult = await driver.query(seqScanQuery);

    // Foreign keys without indexes
    const fkNoIndexResult = await driver.query(`
      SELECT
        tc.table_schema as schema,
        tc.table_name,
        kcu.column_name,
        ccu.table_name as referenced_table,
        ccu.column_name as referenced_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = '${config.database.schema}'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_indexes pi
          WHERE pi.schemaname = tc.table_schema
            AND pi.tablename = tc.table_name
            AND pi.indexdef LIKE '%' || kcu.column_name || '%'
        )
      ${table ? `AND tc.table_name = '${table.replace(/'/g, "''")}'` : ''}
      ORDER BY tc.table_name
    `);

    // Generate suggestions
    interface Suggestion {
      table: string;
      column: string;
      reason: string;
      impact: string;
      suggestedIndex: string;
    }

    const suggestions: Suggestion[] = [];

    // Suggestions from FK without index
    for (const row of fkNoIndexResult.rows as Array<Record<string, string>>) {
      const tableName = row.table_name || '';
      const columnName = row.column_name || '';
      suggestions.push({
        table: tableName,
        column: columnName,
        reason: `Foreign key to ${row.referenced_table}.${row.referenced_column} has no index`,
        impact: 'high',
        suggestedIndex: `CREATE INDEX idx_${tableName}_${columnName} ON "${tableName}" ("${columnName}");`,
      });
    }

    // Suggestions from high seq scan tables
    for (const row of seqScanResult.rows as Array<Record<string, unknown>>) {
      if ((row.seq_scan_percent as number) > 50) {
        suggestions.push({
          table: row.table_name as string,
          column: '(analyze queries)',
          reason: `${row.seq_scan_percent}% sequential scans on ${row.row_count} rows`,
          impact: (row.seq_scan_percent as number) > 80 ? 'high' : 'medium',
          suggestedIndex: `-- Analyze frequent WHERE clauses on "${row.table_name}" to determine best index`,
        });
      }
    }

    logger?.info('Index suggestions generated', { count: suggestions.length });

    return success({
      success: true,
      suggestionCount: suggestions.length,
      suggestions,
      tablesWithHighSeqScans: seqScanResult.rows,
      foreignKeysWithoutIndex: fkNoIndexResult.rows,
    });
  } catch (err) {
    logger?.error('Failed to suggest indexes', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to suggest indexes', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Find unused indexes
 */
export async function dbUnusedIndexes(input: DbUnusedIndexesInput): Promise<ToolResult> {
  const logger = getLogger();

  try {
    const { projectPath, minSizeMb = 1 } = input;
    const configManager = new ConfigManager(projectPath);

    if (!configManager.isInitialized()) {
      return error('Project not initialized. Run db_init first.');
    }

    const config = configManager.load();
    const dbConn = configManager.getDatabaseConnection();
    const driver = await getDriverWithConnection(config.driver.query, dbConn);

    const minSizeBytes = Math.floor(minSizeMb) * 1024 * 1024;

    const result = await driver.query(`
      SELECT
        s.schemaname as schema,
        s.relname as table_name,
        s.indexrelname as index_name,
        s.idx_scan as scans,
        s.idx_tup_read as tuples_read,
        s.idx_tup_fetch as tuples_fetched,
        pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size,
        pg_relation_size(s.indexrelid) as index_size_bytes,
        CASE
          WHEN i.indisunique THEN 'unique'
          WHEN i.indisprimary THEN 'primary'
          ELSE 'regular'
        END as index_type
      FROM pg_stat_user_indexes s
      JOIN pg_index i ON s.indexrelid = i.indexrelid
      WHERE s.schemaname = '${config.database.schema}'
        AND s.idx_scan = 0
        AND pg_relation_size(s.indexrelid) > ${minSizeBytes}
        AND NOT i.indisprimary
        AND NOT i.indisunique
      ORDER BY pg_relation_size(s.indexrelid) DESC
      LIMIT 50
    `);

    // Calculate potential savings
    let totalSavings = 0;
    for (const row of result.rows as Array<Record<string, unknown>>) {
      totalSavings += (row.index_size_bytes as number) || 0;
    }

    logger?.info('Unused indexes found', { count: result.rowCount });

    return success({
      success: true,
      unusedCount: result.rowCount,
      potentialSavings: {
        bytes: totalSavings,
        pretty: `${Math.round((totalSavings / 1024 / 1024) * 100) / 100} MB`,
      },
      note: 'Only showing non-unique, non-primary indexes with 0 scans since last stats reset',
      indexes: result.rows,
    });
  } catch (err) {
    logger?.error('Failed to find unused indexes', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to find unused indexes', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Table and index bloat detection
 */
export async function dbBloat(input: DbBloatInput): Promise<ToolResult> {
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

    // Table bloat estimation
    let tableBloatQuery = `
      SELECT
        schemaname as schema,
        relname as table_name,
        n_live_tup as live_tuples,
        n_dead_tup as dead_tuples,
        CASE
          WHEN n_live_tup = 0 THEN 0
          ELSE round((n_dead_tup::numeric / n_live_tup) * 100, 2)
        END as dead_tuple_percent,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze,
        pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) as total_size
      FROM pg_stat_user_tables
      WHERE schemaname = '${config.database.schema}'
    `;

    if (table) {
      tableBloatQuery += ` AND relname = '${table.replace(/'/g, "''")}'`;
    }

    tableBloatQuery += ` ORDER BY n_dead_tup DESC LIMIT 30`;

    const tableBloatResult = await driver.query(tableBloatQuery);

    // Index bloat - using pg_stat_user_indexes
    let indexBloatQuery = `
      SELECT
        schemaname as schema,
        relname as table_name,
        indexrelname as index_name,
        idx_scan as scans,
        pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
        pg_relation_size(indexrelid) as index_size_bytes
      FROM pg_stat_user_indexes
      WHERE schemaname = '${config.database.schema}'
    `;

    if (table) {
      indexBloatQuery += ` AND relname = '${table.replace(/'/g, "''")}'`;
    }

    indexBloatQuery += ` ORDER BY pg_relation_size(indexrelid) DESC LIMIT 30`;

    const indexResult = await driver.query(indexBloatQuery);

    // Tables needing vacuum
    const needsVacuumResult = await driver.query(`
      SELECT
        schemaname as schema,
        relname as table_name,
        n_dead_tup as dead_tuples,
        last_vacuum,
        last_autovacuum,
        CASE
          WHEN last_vacuum IS NULL AND last_autovacuum IS NULL THEN 'never vacuumed'
          WHEN n_dead_tup > 10000 THEN 'high dead tuples'
          WHEN now() - COALESCE(last_autovacuum, last_vacuum) > interval '7 days' THEN 'stale vacuum'
          ELSE 'ok'
        END as vacuum_status
      FROM pg_stat_user_tables
      WHERE schemaname = '${config.database.schema}'
        AND (
          n_dead_tup > 10000
          OR (last_vacuum IS NULL AND last_autovacuum IS NULL)
          OR now() - COALESCE(last_autovacuum, last_vacuum) > interval '7 days'
        )
      ORDER BY n_dead_tup DESC
      LIMIT 20
    `);

    logger?.info('Bloat analysis completed', {
      tableCount: tableBloatResult.rowCount,
      needsVacuum: needsVacuumResult.rowCount,
    });

    return success({
      success: true,
      tableBloat: tableBloatResult.rows,
      indexes: indexResult.rows,
      needsVacuum: needsVacuumResult.rows,
      recommendations:
        needsVacuumResult.rowCount > 0
          ? ['Consider running VACUUM ANALYZE on tables with high dead tuple counts']
          : ['No immediate vacuum needed'],
    });
  } catch (err) {
    logger?.error('Failed to analyze bloat', {
      error: err instanceof Error ? err.message : String(err),
    });
    return error('Failed to analyze bloat', err instanceof Error ? err.message : String(err));
  }
}
