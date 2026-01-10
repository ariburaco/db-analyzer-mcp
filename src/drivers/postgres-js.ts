import postgres, { type Sql } from 'postgres';
import {
  BaseDriver,
  type QueryResult,
  type TableInfo,
  type ColumnInfo,
  type IndexInfo,
} from './base.ts';
import { getLogger } from '../logger/index.ts';
import type { DatabaseConnection } from '../config/manager.ts';

type PostgresClient = Sql;

interface TableRow {
  name: string;
  schema: string;
  row_count: number;
  size_bytes: number;
}

interface ColumnRow {
  name: string;
  type: string;
  nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  ref_table: string | null;
  ref_column: string | null;
}

interface IndexRow {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
}

export class PostgresJsDriver extends BaseDriver {
  private client: PostgresClient | null = null;

  async connect(url: string): Promise<void> {
    // Parse URL properly to handle special characters in password
    const parsed = this.parseConnectionUrl(url);

    this.client = postgres({
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      username: parsed.user,
      password: parsed.password,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: parsed.ssl,
    });

    // Test connection
    await this.client`SELECT 1`;
    this.connectionUrl = url;
    this.connected = true;
  }

  async connectWithConfig(config: DatabaseConnection): Promise<void> {
    if (config.mode === 'url') {
      // URL-based connection
      return this.connect(config.url);
    }

    // Field-based connection (handles special chars in password properly)
    this.client = postgres({
      host: config.host,
      port: config.port,
      database: config.database,
      username: config.user,
      password: config.password,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: config.ssl,
    });

    // Test connection
    await this.client`SELECT 1`;
    this.connectionUrl = `postgresql://${config.user}@${config.host}:${config.port}/${config.database}`;
    this.connected = true;
  }

  private parseConnectionUrl(url: string): {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean | 'require' | 'prefer' | { rejectUnauthorized: boolean };
  } {
    // Remove quotes if present
    let cleanUrl = url.trim();
    if (
      (cleanUrl.startsWith("'") && cleanUrl.endsWith("'")) ||
      (cleanUrl.startsWith('"') && cleanUrl.endsWith('"'))
    ) {
      cleanUrl = cleanUrl.slice(1, -1);
    }

    // Extract sslmode before URL parsing
    let ssl: boolean | 'require' | 'prefer' | { rejectUnauthorized: boolean } = false;
    const sslModeMatch = cleanUrl.match(/[?&]sslmode=([^&]*)/i);
    if (sslModeMatch && sslModeMatch[1]) {
      const sslMode = sslModeMatch[1].toLowerCase();
      if (sslMode === 'require' || sslMode === 'verify-full') {
        ssl = 'require';
      } else if (sslMode === 'true' || sslMode === '1') {
        ssl = { rejectUnauthorized: false };
      } else if (sslMode === 'prefer') {
        ssl = 'prefer';
      } else if (sslMode === 'no-verify' || sslMode === 'allow') {
        ssl = { rejectUnauthorized: false };
      }
      // Remove sslmode from URL for parsing
      cleanUrl = cleanUrl.replace(/[?&]sslmode=[^&]*/i, '').replace(/\?$/, '');
    }

    // Parse: postgresql://user:password@host:port/database
    const match = cleanUrl.match(/^postgres(?:ql)?:\/\/([^:]+):(.+)@([^:\\/]+):?(\d+)?\/([^?]+)/);

    if (!match) {
      throw new Error('Invalid database URL format');
    }

    const [, user, password, host, portStr, database] = match;

    return {
      host: host || 'localhost',
      port: portStr ? parseInt(portStr, 10) : 5432,
      database: database || 'postgres',
      user: user || 'postgres',
      password: password || '',
      ssl,
    };
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
    this.connected = false;
    this.connectionUrl = null;
  }

  private getClient(): PostgresClient {
    if (!this.client || !this.connected) {
      throw new Error('Database not connected');
    }
    return this.client;
  }

  async query<T = Record<string, unknown>>(
    sqlQuery: string,
    _params?: unknown[]
  ): Promise<QueryResult<T>> {
    const sql = this.getClient();
    const logger = getLogger();

    const start = performance.now();

    try {
      const result = await sql.unsafe(sqlQuery);
      const duration = Math.round(performance.now() - start);

      // Log successful query
      logger?.query(sqlQuery, duration, result.length, true);

      return {
        rows: result as unknown as T[],
        rowCount: result.length,
        duration,
      };
    } catch (err) {
      const duration = Math.round(performance.now() - start);
      const errMessage = err instanceof Error ? err.message : String(err);

      // Log failed query
      logger?.query(sqlQuery, duration, 0, false, errMessage);

      throw err;
    }
  }

  async getTables(schema: string = 'public'): Promise<TableInfo[]> {
    const sql = this.getClient();

    const result = await sql<TableRow[]>`
      SELECT
        t.table_name as name,
        t.table_schema as schema,
        COALESCE(s.n_live_tup, 0)::int as row_count,
        pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::bigint as size_bytes
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s
        ON s.schemaname = t.table_schema
        AND s.relname = t.table_name
      WHERE t.table_schema = ${schema}
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
    `;

    return result.map(row => ({
      name: row.name,
      schema: row.schema,
      rowCount: row.row_count,
      sizeBytes: row.size_bytes,
    }));
  }

  async getColumns(table: string, schema: string = 'public'): Promise<ColumnInfo[]> {
    const sql = this.getClient();

    const result = await sql<ColumnRow[]>`
      SELECT
        c.column_name as name,
        c.data_type as type,
        c.is_nullable = 'YES' as nullable,
        c.column_default as default_value,
        COALESCE(pk.is_primary, false) as is_primary_key,
        COALESCE(fk.is_foreign, false) as is_foreign_key,
        fk.ref_table,
        fk.ref_column
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name, true as is_primary
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = ${schema}
          AND tc.table_name = ${table}
          AND tc.constraint_type = 'PRIMARY KEY'
      ) pk ON pk.column_name = c.column_name
      LEFT JOIN (
        SELECT
          kcu.column_name,
          true as is_foreign,
          ccu.table_name as ref_table,
          ccu.column_name as ref_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_schema = ${schema}
          AND tc.table_name = ${table}
          AND tc.constraint_type = 'FOREIGN KEY'
      ) fk ON fk.column_name = c.column_name
      WHERE c.table_schema = ${schema}
        AND c.table_name = ${table}
      ORDER BY c.ordinal_position
    `;

    return result.map(row => ({
      name: row.name,
      type: row.type,
      nullable: row.nullable,
      defaultValue: row.default_value ?? undefined,
      isPrimaryKey: row.is_primary_key,
      isForeignKey: row.is_foreign_key,
      references:
        row.ref_table && row.ref_column
          ? {
              table: row.ref_table,
              column: row.ref_column,
            }
          : undefined,
    }));
  }

  async getIndexes(table: string, schema: string = 'public'): Promise<IndexInfo[]> {
    const sql = this.getClient();

    const result = await sql<IndexRow[]>`
      SELECT
        i.relname as name,
        array_agg(a.attname ORDER BY x.ordinality) as columns,
        ix.indisunique as is_unique,
        ix.indisprimary as is_primary
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
      WHERE n.nspname = ${schema}
        AND t.relname = ${table}
      GROUP BY i.relname, ix.indisunique, ix.indisprimary
      ORDER BY i.relname
    `;

    return result.map(row => ({
      name: row.name,
      columns: row.columns,
      isUnique: row.is_unique,
      isPrimary: row.is_primary,
    }));
  }

  async tableExists(table: string, schema: string = 'public'): Promise<boolean> {
    const sql = this.getClient();

    const result = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = ${schema}
          AND table_name = ${table}
          AND table_type = 'BASE TABLE'
      ) as exists
    `;

    return result[0]?.exists ?? false;
  }

  async explain(sqlQuery: string): Promise<string> {
    const sql = this.getClient();

    const result = await sql.unsafe(`EXPLAIN ANALYZE ${sqlQuery}`);
    return result.map((row: Record<string, unknown>) => Object.values(row)[0]).join('\n');
  }
}
