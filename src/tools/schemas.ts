import { z } from 'zod';

// db_init
export const DbInitSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  databaseUrl: z.string().optional().describe('Database connection URL (optional)'),
  envVar: z
    .string()
    .optional()
    .describe('Environment variable name for database URL (e.g., DATABASE_URL, MY_DB_URL)'),
  dbType: z.enum(['postgresql', 'mysql', 'sqlite']).default('postgresql').describe('Database type'),
});

export type DbInitInput = z.infer<typeof DbInitSchema>;

// db_pull
export const DbPullSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  engine: z.enum(['drizzle', 'prisma']).default('drizzle').describe('Introspection engine'),
});

export type DbPullInput = z.infer<typeof DbPullSchema>;

// db_schema
export const DbSchemaSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().optional().describe('Specific table name (optional)'),
});

export type DbSchemaInput = z.infer<typeof DbSchemaSchema>;

// db_query
export const DbQuerySchema = z.object({
  projectPath: z.string().describe('Project root path'),
  sql: z.string().describe('SQL SELECT query to execute'),
  limit: z.number().default(100).describe('Maximum rows to return (safety limit)'),
});

export type DbQueryInput = z.infer<typeof DbQuerySchema>;

// db_explain
export const DbExplainSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  sql: z.string().describe('SQL query to analyze'),
});

export type DbExplainInput = z.infer<typeof DbExplainSchema>;

// db_tables
export const DbTablesSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  schema: z.string().default('public').describe('Database schema'),
});

export type DbTablesInput = z.infer<typeof DbTablesSchema>;

// db_sample
export const DbSampleSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().describe('Table name'),
  limit: z.number().default(10).describe('Number of sample rows'),
  schema: z.string().default('public').describe('Database schema'),
});

export type DbSampleInput = z.infer<typeof DbSampleSchema>;

// db_stats
export const DbStatsSchema = z.object({
  projectPath: z.string().describe('Project root path'),
});

export type DbStatsInput = z.infer<typeof DbStatsSchema>;

// db_relations
export const DbRelationsSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().optional().describe('Filter relations for a specific table'),
});

export type DbRelationsInput = z.infer<typeof DbRelationsSchema>;

// db_indexes
export const DbIndexesSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().optional().describe('Filter indexes for a specific table'),
});

export type DbIndexesInput = z.infer<typeof DbIndexesSchema>;

// db_search
export const DbSearchSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  query: z.string().describe('Search query (table or column name)'),
});

export type DbSearchInput = z.infer<typeof DbSearchSchema>;

// db_describe
export const DbDescribeSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().describe('Table name to describe'),
  sampleLimit: z.number().default(5).describe('Number of sample rows'),
});

export type DbDescribeInput = z.infer<typeof DbDescribeSchema>;

// db_erd
export const DbErdSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  format: z.enum(['mermaid', 'ascii']).default('mermaid').describe('Output format'),
});

export type DbErdInput = z.infer<typeof DbErdSchema>;

// db_constraints
export const DbConstraintsSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().optional().describe('Filter for specific table'),
});

export type DbConstraintsInput = z.infer<typeof DbConstraintsSchema>;

// db_analyze
export const DbAnalyzeSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().describe('Table to analyze'),
  columns: z.array(z.string()).optional().describe('Specific columns to analyze'),
});

export type DbAnalyzeInput = z.infer<typeof DbAnalyzeSchema>;

// db_duplicates
export const DbDuplicatesSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().describe('Table to check'),
  columns: z.array(z.string()).describe('Columns to check for duplicates'),
  limit: z.number().default(100).describe('Max duplicates to return'),
});

export type DbDuplicatesInput = z.infer<typeof DbDuplicatesSchema>;

// === NEW MONITORING TOOLS ===

// db_health
export const DbHealthSchema = z.object({
  projectPath: z.string().describe('Project root path'),
});

export type DbHealthInput = z.infer<typeof DbHealthSchema>;

// db_locks
export const DbLocksSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  includeIdle: z.boolean().default(false).describe('Include idle connections'),
});

export type DbLocksInput = z.infer<typeof DbLocksSchema>;

// db_slow_queries
export const DbSlowQueriesSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  minDurationMs: z.number().default(100).describe('Minimum query duration in ms'),
  limit: z.number().default(20).describe('Max queries to return'),
});

export type DbSlowQueriesInput = z.infer<typeof DbSlowQueriesSchema>;

// db_suggest_indexes
export const DbSuggestIndexesSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().optional().describe('Filter for specific table'),
  minSize: z.number().default(10000).describe('Min table rows to consider'),
});

export type DbSuggestIndexesInput = z.infer<typeof DbSuggestIndexesSchema>;

// db_unused_indexes
export const DbUnusedIndexesSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  minSizeMb: z.number().default(1).describe('Min index size in MB to report'),
});

export type DbUnusedIndexesInput = z.infer<typeof DbUnusedIndexesSchema>;

// db_bloat
export const DbBloatSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().optional().describe('Filter for specific table'),
});

export type DbBloatInput = z.infer<typeof DbBloatSchema>;

// === EXTRA TOOLS ===

// db_export
export const DbExportSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().describe('Table to export'),
  format: z.enum(['json', 'csv']).default('json').describe('Export format'),
  columns: z.array(z.string()).optional().describe('Specific columns to export'),
  where: z.string().optional().describe('WHERE clause for filtering'),
  limit: z.number().default(1000).describe('Max rows to export'),
});

export type DbExportInput = z.infer<typeof DbExportSchema>;

// db_export_batch - Large data export with batching
export const DbExportBatchSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  sql: z
    .string()
    .describe('Custom SELECT query to export (must include ORDER BY for consistent pagination)'),
  outputPath: z
    .string()
    .optional()
    .describe('Custom output file path (optional, auto-generates if not provided)'),
  format: z
    .enum(['json', 'jsonl', 'csv'])
    .default('jsonl')
    .describe('Export format: jsonl (one JSON per line, best for large data), json, or csv'),
  batchSize: z.number().default(10000).describe('Rows per batch (default 10000)'),
  maxRows: z
    .number()
    .optional()
    .describe('Maximum total rows to export (optional, exports all if not set)'),
});

export type DbExportBatchInput = z.infer<typeof DbExportBatchSchema>;

// db_compare
export const DbCompareSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  snapshotPath: z.string().describe('Path to comparison snapshot.json'),
});

export type DbCompareInput = z.infer<typeof DbCompareSchema>;

// db_report
export const DbReportSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  includeData: z.boolean().default(false).describe('Include sample data in report'),
});

export type DbReportInput = z.infer<typeof DbReportSchema>;

// db_quality
export const DbQualitySchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().optional().describe('Filter for specific table'),
});

export type DbQualityInput = z.infer<typeof DbQualitySchema>;

// === SCHEMA EXPLORATION TOOLS ===

// db_grep - Search schema by keyword
export const DbGrepSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  query: z.string().describe('Search keyword (matches table names, column names, types)'),
  searchIn: z
    .enum(['all', 'tables', 'columns', 'types'])
    .default('all')
    .describe('Where to search'),
});

export type DbGrepInput = z.infer<typeof DbGrepSchema>;

// db_overview - Compact schema summary
export const DbOverviewSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  includeColumns: z.boolean().default(false).describe('Include column names (compact, no types)'),
});

export type DbOverviewInput = z.infer<typeof DbOverviewSchema>;

// db_related - Find related tables via FK
export const DbRelatedSchema = z.object({
  projectPath: z.string().describe('Project root path'),
  table: z.string().describe('Table name to find relations for'),
  depth: z.number().default(1).describe('How deep to traverse relations (1-3)'),
});

export type DbRelatedInput = z.infer<typeof DbRelatedSchema>;

// Tool definitions for MCP
export const TOOL_DEFINITIONS = [
  {
    name: 'db_init',
    description:
      "Initialize .db-mcp folder with configuration. Run this first before using other tools. Reads database URL from the project's .env file.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        databaseUrl: {
          type: 'string',
          description: 'Database connection URL (optional, if not using .env)',
        },
        envVar: {
          type: 'string',
          description: 'Environment variable name in .env file (default: DATABASE_URL)',
        },
        dbType: {
          type: 'string',
          enum: ['postgresql', 'mysql', 'sqlite'],
          default: 'postgresql',
          description: 'Database type',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_pull',
    description:
      'Pull complete database schema using Drizzle or Prisma. Creates schema.ts and snapshot.json in .db-mcp/schema/',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        engine: {
          type: 'string',
          enum: ['drizzle', 'prisma'],
          default: 'drizzle',
          description: 'Introspection engine',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_schema',
    description:
      'Get database schema information from cache. Returns tables, columns, and relations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Specific table name (optional)' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_query',
    description:
      'Execute a read-only SELECT query. Returns rows as JSON. Only SELECT, EXPLAIN, SHOW statements are allowed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        sql: { type: 'string', description: 'SQL SELECT query to execute' },
        limit: {
          type: 'number',
          default: 100,
          description: 'Maximum rows to return (safety limit)',
        },
      },
      required: ['projectPath', 'sql'],
    },
  },
  {
    name: 'db_explain',
    description: 'Run EXPLAIN ANALYZE on a query for performance optimization.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        sql: { type: 'string', description: 'SQL query to analyze' },
      },
      required: ['projectPath', 'sql'],
    },
  },
  {
    name: 'db_tables',
    description: 'List all tables with row counts and basic information.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        schema: { type: 'string', default: 'public', description: 'Database schema' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_sample',
    description: 'Get sample rows from a table.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Table name' },
        limit: { type: 'number', default: 10, description: 'Number of sample rows' },
        schema: { type: 'string', default: 'public', description: 'Database schema' },
      },
      required: ['projectPath', 'table'],
    },
  },
  {
    name: 'db_stats',
    description: 'Get database statistics: total tables, rows, size, index count, and more.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_relations',
    description:
      'Get all foreign key relationships between tables. Shows which tables reference each other.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Filter relations for a specific table (optional)' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_indexes',
    description: 'List all indexes in the database with their columns and properties.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Filter indexes for a specific table (optional)' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_search',
    description: 'Search for tables and columns by name. Useful for finding where a field is used.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        query: { type: 'string', description: 'Search query (matches table or column names)' },
      },
      required: ['projectPath', 'query'],
    },
  },
  {
    name: 'db_describe',
    description:
      'Get complete information about a table: columns, indexes, foreign keys, and sample data.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Table name to describe' },
        sampleLimit: {
          type: 'number',
          default: 5,
          description: 'Number of sample rows to include',
        },
      },
      required: ['projectPath', 'table'],
    },
  },
  {
    name: 'db_erd',
    description:
      'Generate an Entity Relationship Diagram in Mermaid or ASCII format. Perfect for visualizing database structure.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        format: {
          type: 'string',
          enum: ['mermaid', 'ascii'],
          default: 'mermaid',
          description: 'Output format (mermaid for diagrams, ascii for text)',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_constraints',
    description:
      'List all constraints in the database: PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK, NOT NULL.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Filter for specific table (optional)' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_analyze',
    description:
      'Analyze table columns: NULL count, distinct values, min/max values, data distribution.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Table to analyze' },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific columns to analyze (optional, defaults to all)',
        },
      },
      required: ['projectPath', 'table'],
    },
  },
  {
    name: 'db_duplicates',
    description: 'Find duplicate rows based on specified columns. Useful for data quality checks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Table to check' },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Columns to check for duplicates',
        },
        limit: { type: 'number', default: 100, description: 'Max duplicates to return' },
      },
      required: ['projectPath', 'table', 'columns'],
    },
  },
  // === MONITORING TOOLS ===
  {
    name: 'db_health',
    description:
      'Database health check: connections, cache hit ratio, disk usage, transaction stats, and warnings.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_locks',
    description:
      'Show active database locks, blocking queries, and lock wait analysis. Critical for debugging deadlocks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        includeIdle: {
          type: 'boolean',
          default: false,
          description: 'Include idle connections in results',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_slow_queries',
    description:
      'Find slow queries using pg_stat_statements or current activity. Essential for performance optimization.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        minDurationMs: {
          type: 'number',
          default: 100,
          description: 'Minimum query duration in milliseconds',
        },
        limit: { type: 'number', default: 20, description: 'Max queries to return' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_suggest_indexes',
    description:
      'Suggest missing indexes based on sequential scans and foreign keys without indexes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Filter for specific table (optional)' },
        minSize: {
          type: 'number',
          default: 10000,
          description: 'Minimum table rows to consider',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_unused_indexes',
    description:
      'Find unused indexes that waste disk space and slow down writes. Shows potential savings.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        minSizeMb: {
          type: 'number',
          default: 1,
          description: 'Minimum index size in MB to report',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_bloat',
    description:
      'Detect table and index bloat. Shows dead tuples, vacuum status, and maintenance recommendations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Filter for specific table (optional)' },
      },
      required: ['projectPath'],
    },
  },
  // === EXTRA TOOLS ===
  {
    name: 'db_export',
    description:
      'Export table data to JSON or CSV format. Supports column selection and WHERE filtering.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Table to export' },
        format: {
          type: 'string',
          enum: ['json', 'csv'],
          default: 'json',
          description: 'Export format',
        },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific columns to export (optional)',
        },
        where: { type: 'string', description: 'WHERE clause for filtering (optional)' },
        limit: { type: 'number', default: 1000, description: 'Max rows to export' },
      },
      required: ['projectPath', 'table'],
    },
  },
  {
    name: 'db_export_batch',
    description:
      'Export large datasets with automatic batching. Supports custom SQL queries and streams directly to file (bypasses token limits). Use JSONL format for best performance with large data. Perfect for exporting 100K+ rows.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        sql: {
          type: 'string',
          description:
            'Custom SELECT query (MUST include ORDER BY for consistent pagination). Example: SELECT id, name FROM users ORDER BY id',
        },
        outputPath: {
          type: 'string',
          description:
            'Custom output file path (optional, auto-generates in .db-mcp/exports/ if not provided)',
        },
        format: {
          type: 'string',
          enum: ['json', 'jsonl', 'csv'],
          default: 'jsonl',
          description:
            'Export format: jsonl (one JSON per line, best for large data), json, or csv',
        },
        batchSize: {
          type: 'number',
          default: 10000,
          description: 'Rows per batch (default 10000)',
        },
        maxRows: {
          type: 'number',
          description: 'Maximum total rows to export (optional, exports all if not set)',
        },
      },
      required: ['projectPath', 'sql'],
    },
  },
  {
    name: 'db_compare',
    description:
      'Compare current schema with a saved snapshot. Shows added, removed, and modified tables/columns.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        snapshotPath: { type: 'string', description: 'Path to comparison snapshot.json file' },
      },
      required: ['projectPath', 'snapshotPath'],
    },
  },
  {
    name: 'db_report',
    description:
      'Generate comprehensive database report in markdown. Includes schema, relationships, and optionally sample data.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        includeData: {
          type: 'boolean',
          default: false,
          description: 'Include sample data in report',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_quality',
    description:
      'Data quality checks: orphaned foreign keys, referential integrity issues, NULL in primary keys.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Filter for specific table (optional)' },
      },
      required: ['projectPath'],
    },
  },
  // === SCHEMA EXPLORATION TOOLS ===
  {
    name: 'db_grep',
    description:
      'Search schema for keywords. Finds tables, columns, or types matching a pattern. Much faster than loading full schema. Use this FIRST to find relevant tables.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        query: {
          type: 'string',
          description: 'Search keyword (e.g., "user", "email", "timestamp", "jsonb")',
        },
        searchIn: {
          type: 'string',
          enum: ['all', 'tables', 'columns', 'types'],
          default: 'all',
          description: 'Where to search: all, tables, columns, or types',
        },
      },
      required: ['projectPath', 'query'],
    },
  },
  {
    name: 'db_overview',
    description:
      'Get compact schema overview. Returns table names with row counts and primary/foreign keys only. Perfect for understanding DB structure without loading full schema.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        includeColumns: {
          type: 'boolean',
          default: false,
          description: 'Include column names (just names, no types - keeps output small)',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'db_related',
    description:
      'Find all tables related to a given table via foreign keys. Returns the relationship graph showing which tables connect to which. Essential for understanding JOINs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: { type: 'string', description: 'Project root path' },
        table: { type: 'string', description: 'Table name to find relations for' },
        depth: {
          type: 'number',
          default: 1,
          description: 'How deep to traverse relations (1=direct, 2=one hop, 3=two hops)',
        },
      },
      required: ['projectPath', 'table'],
    },
  },
];
