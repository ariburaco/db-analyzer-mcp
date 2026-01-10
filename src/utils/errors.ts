export class DbMcpError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'DbMcpError';
    this.code = code;
  }
}

export class NotInitializedError extends DbMcpError {
  constructor(projectPath: string) {
    super(`Project not initialized at ${projectPath}. Run db_init first.`, 'NOT_INITIALIZED');
    this.name = 'NotInitializedError';
  }
}

export class DatabaseConnectionError extends DbMcpError {
  constructor(message: string) {
    super(`Database connection failed: ${message}`, 'CONNECTION_ERROR');
    this.name = 'DatabaseConnectionError';
  }
}

export class ValidationError extends DbMcpError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class QueryError extends DbMcpError {
  sql: string;

  constructor(message: string, sql: string) {
    super(`Query failed: ${message}`, 'QUERY_ERROR');
    this.name = 'QueryError';
    this.sql = sql;
  }
}

export class TimeoutError extends DbMcpError {
  constructor(timeout: number) {
    super(`Query timed out after ${timeout}ms`, 'TIMEOUT_ERROR');
    this.name = 'TimeoutError';
  }
}

export class IntrospectionError extends DbMcpError {
  constructor(message: string) {
    super(`Schema introspection failed: ${message}`, 'INTROSPECTION_ERROR');
    this.name = 'IntrospectionError';
  }
}
