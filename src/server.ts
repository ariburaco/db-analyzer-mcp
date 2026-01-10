import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  TOOL_DEFINITIONS,
  dbInit,
  dbPull,
  dbSchema,
  dbQuery,
  dbExplain,
  dbTables,
  dbSample,
  dbStats,
  dbRelations,
  dbIndexes,
  dbSearch,
  dbDescribe,
  dbErd,
  dbConstraints,
  dbAnalyze,
  dbDuplicates,
  dbHealth,
  dbLocks,
  dbSlowQueries,
  dbSuggestIndexes,
  dbUnusedIndexes,
  dbBloat,
  dbExport,
  dbExportBatch,
  dbCompare,
  dbReport,
  dbQuality,
  dbGrep,
  dbOverview,
  dbRelated,
} from './tools/index.ts';
import {
  DbInitSchema,
  DbPullSchema,
  DbSchemaSchema,
  DbQuerySchema,
  DbExplainSchema,
  DbTablesSchema,
  DbSampleSchema,
  DbStatsSchema,
  DbRelationsSchema,
  DbIndexesSchema,
  DbSearchSchema,
  DbDescribeSchema,
  DbErdSchema,
  DbConstraintsSchema,
  DbAnalyzeSchema,
  DbDuplicatesSchema,
  DbHealthSchema,
  DbLocksSchema,
  DbSlowQueriesSchema,
  DbSuggestIndexesSchema,
  DbUnusedIndexesSchema,
  DbBloatSchema,
  DbExportSchema,
  DbExportBatchSchema,
  DbCompareSchema,
  DbReportSchema,
  DbQualitySchema,
  DbGrepSchema,
  DbOverviewSchema,
  DbRelatedSchema,
} from './tools/schemas.ts';
import { error } from './utils/result.ts';
import { disconnectAll } from './drivers/index.ts';
import { getLogger } from './logger/index.ts';

export class DbAnalyzerServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'db-analyzer-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: TOOL_DEFINITIONS,
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'db_init': {
            const input = DbInitSchema.parse(args);
            return await dbInit(input);
          }

          case 'db_pull': {
            const input = DbPullSchema.parse(args);
            return await dbPull(input);
          }

          case 'db_schema': {
            const input = DbSchemaSchema.parse(args);
            return await dbSchema(input);
          }

          case 'db_query': {
            const input = DbQuerySchema.parse(args);
            return await dbQuery(input);
          }

          case 'db_explain': {
            const input = DbExplainSchema.parse(args);
            return await dbExplain(input);
          }

          case 'db_tables': {
            const input = DbTablesSchema.parse(args);
            return await dbTables(input);
          }

          case 'db_sample': {
            const input = DbSampleSchema.parse(args);
            return await dbSample(input);
          }

          case 'db_stats': {
            const input = DbStatsSchema.parse(args);
            return await dbStats(input);
          }

          case 'db_relations': {
            const input = DbRelationsSchema.parse(args);
            return await dbRelations(input);
          }

          case 'db_indexes': {
            const input = DbIndexesSchema.parse(args);
            return await dbIndexes(input);
          }

          case 'db_search': {
            const input = DbSearchSchema.parse(args);
            return await dbSearch(input);
          }

          case 'db_describe': {
            const input = DbDescribeSchema.parse(args);
            return await dbDescribe(input);
          }

          case 'db_erd': {
            const input = DbErdSchema.parse(args);
            return await dbErd(input);
          }

          case 'db_constraints': {
            const input = DbConstraintsSchema.parse(args);
            return await dbConstraints(input);
          }

          case 'db_analyze': {
            const input = DbAnalyzeSchema.parse(args);
            return await dbAnalyze(input);
          }

          case 'db_duplicates': {
            const input = DbDuplicatesSchema.parse(args);
            return await dbDuplicates(input);
          }

          // === MONITORING TOOLS ===
          case 'db_health': {
            const input = DbHealthSchema.parse(args);
            return await dbHealth(input);
          }

          case 'db_locks': {
            const input = DbLocksSchema.parse(args);
            return await dbLocks(input);
          }

          case 'db_slow_queries': {
            const input = DbSlowQueriesSchema.parse(args);
            return await dbSlowQueries(input);
          }

          case 'db_suggest_indexes': {
            const input = DbSuggestIndexesSchema.parse(args);
            return await dbSuggestIndexes(input);
          }

          case 'db_unused_indexes': {
            const input = DbUnusedIndexesSchema.parse(args);
            return await dbUnusedIndexes(input);
          }

          case 'db_bloat': {
            const input = DbBloatSchema.parse(args);
            return await dbBloat(input);
          }

          // === EXTRA TOOLS ===
          case 'db_export': {
            const input = DbExportSchema.parse(args);
            return await dbExport(input);
          }

          case 'db_export_batch': {
            const input = DbExportBatchSchema.parse(args);
            return await dbExportBatch(input);
          }

          case 'db_compare': {
            const input = DbCompareSchema.parse(args);
            return await dbCompare(input);
          }

          case 'db_report': {
            const input = DbReportSchema.parse(args);
            return await dbReport(input);
          }

          case 'db_quality': {
            const input = DbQualitySchema.parse(args);
            return await dbQuality(input);
          }

          // === SCHEMA EXPLORATION TOOLS ===
          case 'db_grep': {
            const input = DbGrepSchema.parse(args);
            return await dbGrep(input);
          }

          case 'db_overview': {
            const input = DbOverviewSchema.parse(args);
            return await dbOverview(input);
          }

          case 'db_related': {
            const input = DbRelatedSchema.parse(args);
            return await dbRelated(input);
          }

          default:
            return error(`Unknown tool: ${name}`);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const logger = getLogger();

        // Log to file silently
        logger?.error('Tool execution failed', {
          tool: name,
          error: errorMessage,
          stack: err instanceof Error ? err.stack : undefined,
        });

        if (err instanceof z.ZodError) {
          return error('Invalid arguments', err.issues);
        }
        return error('Tool execution failed', errorMessage);
      }
    });
  }

  private setupErrorHandling(): void {
    this.server.onerror = err => {
      const logger = getLogger();

      // Log to file silently
      logger?.error('MCP server error', {
        error: err.message,
        stack: err.stack,
      });
    };

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await this.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.shutdown();
      process.exit(0);
    });
  }

  private async shutdown(): Promise<void> {
    await disconnectAll();
    await this.server.close();
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    // Server started - no stderr output to avoid confusing log viewers
  }
}
