export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  duration: number;
}

export interface TableInfo {
  name: string;
  schema: string;
  rowCount: number;
  sizeBytes?: number;
}

export interface ColumnInfo {
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

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
}

import type { DatabaseConnection } from '../config/manager.ts';

export interface DatabaseDriver {
  connect(url: string): Promise<void>;
  connectWithConfig(config: DatabaseConnection): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Query execution
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;

  // Schema introspection
  getTables(schema?: string): Promise<TableInfo[]>;
  getColumns(table: string, schema?: string): Promise<ColumnInfo[]>;
  getIndexes(table: string, schema?: string): Promise<IndexInfo[]>;

  // Validation
  tableExists(table: string, schema?: string): Promise<boolean>;

  // Utility
  explain(sql: string): Promise<string>;
  getSampleData<T = Record<string, unknown>>(
    table: string,
    limit: number,
    schema?: string
  ): Promise<QueryResult<T>>;
}

export abstract class BaseDriver implements DatabaseDriver {
  protected connected = false;
  protected connectionUrl: string | null = null;

  abstract connect(url: string): Promise<void>;
  abstract connectWithConfig(config: DatabaseConnection): Promise<void>;
  abstract disconnect(): Promise<void>;

  isConnected(): boolean {
    return this.connected;
  }

  abstract query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
  abstract getTables(schema?: string): Promise<TableInfo[]>;
  abstract getColumns(table: string, schema?: string): Promise<ColumnInfo[]>;
  abstract getIndexes(table: string, schema?: string): Promise<IndexInfo[]>;
  abstract tableExists(table: string, schema?: string): Promise<boolean>;
  abstract explain(sql: string): Promise<string>;

  async getSampleData<T = Record<string, unknown>>(
    table: string,
    limit: number = 10,
    schema: string = 'public'
  ): Promise<QueryResult<T>> {
    // Escape any double quotes in identifiers
    const safeTable = table.replace(/"/g, '""');
    const safeSchema = schema.replace(/"/g, '""');
    const qualifiedTable = `"${safeSchema}"."${safeTable}"`;
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 10000);
    return this.query<T>(`SELECT * FROM ${qualifiedTable} LIMIT ${safeLimit}`);
  }
}
