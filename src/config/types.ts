import { z } from 'zod';

export const DatabaseTypeSchema = z.enum(['postgresql', 'mysql', 'sqlite']);
export type DatabaseType = z.infer<typeof DatabaseTypeSchema>;

export const DriverTypeSchema = z.enum(['bun-sql', 'drizzle', 'postgres-js']);
export type DriverType = z.infer<typeof DriverTypeSchema>;

export const IntrospectionEngineSchema = z.enum(['drizzle', 'prisma']);
export type IntrospectionEngine = z.infer<typeof IntrospectionEngineSchema>;

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const ConfigSchema = z.object({
  version: z.string().default('1.0.0'),
  database: z.object({
    type: DatabaseTypeSchema.default('postgresql'),
    // Option 1: Full URL
    url: z.string().optional(),
    envVar: z.string().optional(), // Env var name for URL (default: DATABASE_URL)
    // Option 2: Individual fields (supports special chars in password)
    host: z.string().optional(),
    port: z.number().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    database: z.string().optional(), // database name
    ssl: z.union([z.boolean(), z.string()]).optional(), // true, false, 'require', 'no-verify'
    // Env var names for individual fields
    hostEnv: z.string().optional(),
    portEnv: z.string().optional(),
    userEnv: z.string().optional(),
    passwordEnv: z.string().optional(),
    databaseEnv: z.string().optional(),
    // Schema
    schema: z.string().default('public'),
  }),
  driver: z.object({
    query: DriverTypeSchema.default('bun-sql'),
    introspection: IntrospectionEngineSchema.default('drizzle'),
  }),
  security: z.object({
    readOnly: z.boolean().default(true),
    maxRowLimit: z.number().default(10000),
    queryTimeout: z.number().default(30000),
    allowedStatements: z.array(z.string()).default(['SELECT', 'EXPLAIN', 'SHOW', 'WITH']),
  }),
  logging: z.object({
    level: LogLevelSchema.default('info'),
    maxFileSize: z.string().default('10MB'),
    maxFiles: z.number().default(5),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = {
  version: '1.0.0',
  database: {
    type: 'postgresql',
    schema: 'public',
  },
  driver: {
    query: 'bun-sql',
    introspection: 'drizzle',
  },
  security: {
    readOnly: true,
    maxRowLimit: 10000,
    queryTimeout: 30000,
    allowedStatements: ['SELECT', 'EXPLAIN', 'SHOW', 'WITH'],
  },
  logging: {
    level: 'info',
    maxFileSize: '10MB',
    maxFiles: 5,
  },
};
