# DB Analyzer MCP

A safe, read-only database analysis tool for AI assistants via the Model Context Protocol (MCP). Enables AI to understand your database schema, run analytics queries, and provide insights without any risk of data modification.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.2-black.svg)](https://bun.sh/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-green.svg)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **31 Database Tools** - Schema introspection, query execution, performance analysis, and more
- **Read-Only by Design** - Only SELECT, EXPLAIN, SHOW, and WITH (CTE) queries allowed
- **Multi-Layer Security** - SQL validation, identifier sanitization, query limits
- **PostgreSQL Support** - Primary focus with architecture ready for MySQL/SQLite
- **Project-Local Config** - `.db-mcp/` folder for configuration, logs, and cached schema
- **Zero Console Output** - All logging to files (stdio reserved for MCP protocol)

## Installation

```bash
# Clone the repository
git clone https://github.com/ariburaco/db-analyzer-mcp.git
cd db-analyzer-mcp

# Install dependencies
bun install
```

## Configuration

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "db-analyzer": {
      "command": "bun",
      "args": ["run", "/path/to/db-analyzer-mcp/src/index.ts"]
    }
  }
}
```

### VS Code with Claude Extension

Add to your VS Code settings or `.mcp.json`:

```json
{
  "mcpServers": {
    "db-analyzer": {
      "command": "bun",
      "args": ["run", "/path/to/db-analyzer-mcp/src/index.ts"]
    }
  }
}
```

### Cursor IDE

Add to Cursor's MCP configuration:

```json
{
  "mcpServers": {
    "db-analyzer": {
      "command": "bun",
      "args": ["run", "/path/to/db-analyzer-mcp/src/index.ts"]
    }
  }
}
```

## Quick Start

1. **Initialize your project** (creates `.db-mcp/` folder):
```
Use db_init with projectPath="/path/to/your/project"
```

2. **Ensure your `.env` file has DATABASE_URL**:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/mydb
```

3. **Pull your database schema**:
```
Use db_pull to introspect the database
```

4. **Start analyzing**:
```
Use db_tables to see all tables
Use db_describe for table details
Use db_query to run SELECT queries
```

## Tools Reference

### Schema Tools

| Tool | Description |
|------|-------------|
| `db_init` | Initialize .db-mcp folder with configuration |
| `db_pull` | Pull database schema using Drizzle or Prisma |
| `db_schema` | Get cached schema information |
| `db_tables` | List all tables with row counts and sizes |
| `db_describe` | Complete table info: columns, indexes, FKs, samples |
| `db_sample` | Get sample rows from a table |

### Query Tools

| Tool | Description |
|------|-------------|
| `db_query` | Execute read-only SELECT queries |
| `db_explain` | Run EXPLAIN ANALYZE for query optimization |
| `db_run_file` | Execute SQL from .sql/.txt file (for large queries with embeddings) |

### Analytics Tools

| Tool | Description |
|------|-------------|
| `db_stats` | Database statistics: tables, rows, size, indexes |
| `db_relations` | Foreign key relationships between tables |
| `db_indexes` | List all indexes with columns and properties |
| `db_search` | Search for tables and columns by name |
| `db_analyze` | Column analysis: NULLs, distinct values, min/max |
| `db_duplicates` | Find duplicate rows based on columns |

### Advanced Tools

| Tool | Description |
|------|-------------|
| `db_erd` | Generate ERD in Mermaid or ASCII format |
| `db_constraints` | List all constraints (PK, FK, UNIQUE, CHECK) |

### Monitoring Tools

| Tool | Description |
|------|-------------|
| `db_health` | Health check: connections, cache ratio, disk usage |
| `db_locks` | Active locks and blocking queries |
| `db_slow_queries` | Find slow queries (pg_stat_statements) |
| `db_suggest_indexes` | Suggest missing indexes |
| `db_unused_indexes` | Find unused indexes wasting space |
| `db_bloat` | Detect table/index bloat and dead tuples |

### Extra Tools

| Tool | Description |
|------|-------------|
| `db_export` | Export data to JSON or CSV |
| `db_export_batch` | Export large datasets with automatic batching (streams to file) |
| `db_compare` | Compare schema with saved snapshot |
| `db_report` | Generate comprehensive markdown report |
| `db_quality` | Data quality checks: orphaned FKs, integrity |

### Schema Exploration Tools

| Tool | Description |
|------|-------------|
| `db_grep` | Search schema for tables, columns, or types by keyword |
| `db_overview` | Get compact schema overview with row counts |
| `db_related` | Find all tables related via foreign keys |

## Supported Query Types

| Query Type | Status |
|------------|--------|
| Simple SELECT | ✅ |
| JOINs (LEFT, RIGHT, INNER) | ✅ |
| Aggregations (COUNT, SUM, AVG) | ✅ |
| GROUP BY / HAVING | ✅ |
| Window Functions | ✅ |
| Subqueries | ✅ |
| CTE (WITH clause) | ✅ |
| Recursive CTE | ✅ |
| UNION / INTERSECT | ✅ |
| EXPLAIN ANALYZE | ✅ |

## Security

### Read-Only Enforcement

Multiple layers of protection ensure no data modification:

1. **Statement Whitelist** - Only `SELECT`, `EXPLAIN`, `SHOW`, `WITH` allowed
2. **Keyword Blocklist** - Blocks `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, etc.
3. **SQL Injection Prevention** - Identifier validation, table existence checks
4. **Row Limits** - Configurable max rows (default: 10,000)
5. **Query Timeout** - Prevents long-running operations
6. **Dangerous Pattern Detection** - Blocks file operations, backend termination

### Blocked Operations

```
INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE,
GRANT, REVOKE, EXECUTE, CALL, COPY, VACUUM, REINDEX,
CLUSTER, COMMENT, SECURITY, OWNER, SET ROLE, RESET
```

## Project Structure

```
.db-mcp/                    # Created in your project root
├── config.json             # Configuration file
├── schema/
│   └── snapshot.json       # Schema snapshot for AI
└── logs/
    ├── mcp.log             # General logs
    ├── queries.log         # Query execution logs
    └── errors.log          # Error logs
```

## Configuration Options

`.db-mcp/config.json`:

### Option 1: Using DATABASE_URL (from .env)

```json
{
  "version": "1.0.0",
  "database": {
    "type": "postgresql",
    "envVar": "DATABASE_URL",
    "schema": "public"
  }
}
```

### Option 2: Individual Fields (recommended for special characters in password)

```json
{
  "version": "1.0.0",
  "database": {
    "type": "postgresql",
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "my>complex<password&with$special:chars",
    "database": "mydb",
    "ssl": "no-verify",
    "schema": "public"
  }
}
```

### Option 3: Individual Fields from Environment Variables

```json
{
  "version": "1.0.0",
  "database": {
    "type": "postgresql",
    "hostEnv": "DB_HOST",
    "portEnv": "DB_PORT",
    "userEnv": "DB_USER",
    "passwordEnv": "DB_PASSWORD",
    "databaseEnv": "DB_NAME",
    "ssl": "require",
    "schema": "public"
  }
}
```

### SSL Options

| Value | Description |
|-------|-------------|
| `false` | No SSL (default) |
| `true` or `"require"` | SSL required |
| `"prefer"` | Use SSL if available |
| `"no-verify"` | SSL without certificate verification (for tunnels/self-signed) |

### Full Configuration Example

```json
{
  "version": "1.0.0",
  "database": {
    "type": "postgresql",
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "secret",
    "database": "mydb",
    "ssl": "no-verify",
    "schema": "public"
  },
  "driver": {
    "query": "postgres-js",
    "introspection": "drizzle"
  },
  "security": {
    "readOnly": true,
    "maxRowLimit": 10000,
    "queryTimeout": 30000,
    "allowedStatements": ["SELECT", "EXPLAIN", "SHOW", "WITH"]
  },
  "logging": {
    "level": "info",
    "maxFileSize": "10MB",
    "maxFiles": 5
  }
}
```

## Development

```bash
# Run in development mode
bun run dev

# Type check
bun run typecheck

# Lint
bun run lint

# Format
bun run format
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/) - Fast JavaScript runtime
- **Language**: TypeScript (strict mode)
- **MCP SDK**: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- **Schema Introspection**: [Drizzle Kit](https://orm.drizzle.team/kit-docs/overview)
- **Database Driver**: [postgres.js](https://github.com/porsager/postgres)
- **Validation**: [Zod](https://zod.dev/)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

**Ali Burak Ozden** - [@ariburaco](https://github.com/ariburaco)

---

Built with Bun and MCP for safe AI-powered database analysis.
