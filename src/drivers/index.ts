import type { DatabaseDriver } from './base.ts';
import { PostgresJsDriver } from './postgres-js.ts';
import type { DriverType } from '../config/types.ts';
import type { DatabaseConnection } from '../config/manager.ts';

export type { DatabaseDriver, QueryResult, TableInfo, ColumnInfo, IndexInfo } from './base.ts';
export type {
  DatabaseConnection,
  DatabaseConnectionUrl,
  DatabaseConnectionFields,
} from '../config/manager.ts';

const driverInstances: Map<string, DatabaseDriver> = new Map();

export function createDriver(type: DriverType): DatabaseDriver {
  switch (type) {
    case 'bun-sql':
      // TODO: Implement Bun.sql driver when stable
      // For now, fallback to postgres.js
      return new PostgresJsDriver();

    case 'drizzle':
      // TODO: Implement Drizzle driver
      return new PostgresJsDriver();

    case 'postgres-js':
      return new PostgresJsDriver();

    default:
      throw new Error(`Unknown driver type: ${type}`);
  }
}

/**
 * Get connection key for caching
 */
function getConnectionKey(type: DriverType, conn: DatabaseConnection): string {
  if (conn.mode === 'url') {
    return `${type}:${conn.url}`;
  }
  return `${type}:${conn.host}:${conn.port}:${conn.database}:${conn.user}`;
}

/**
 * Get or create a database driver with connection.
 * Supports both URL-based and individual field-based connections.
 */
export async function getDriverWithConnection(
  type: DriverType,
  conn: DatabaseConnection
): Promise<DatabaseDriver> {
  const key = getConnectionKey(type, conn);

  if (driverInstances.has(key)) {
    const existing = driverInstances.get(key)!;
    if (existing.isConnected()) {
      return existing;
    }
    // Reconnect if disconnected
    await existing.connectWithConfig(conn);
    return existing;
  }

  const driver = createDriver(type);
  await driver.connectWithConfig(conn);
  driverInstances.set(key, driver);

  return driver;
}

// Legacy method for backwards compatibility
export async function getDriver(type: DriverType, url: string): Promise<DatabaseDriver> {
  return getDriverWithConnection(type, { mode: 'url', url });
}

export async function disconnectAll(): Promise<void> {
  for (const driver of driverInstances.values()) {
    if (driver.isConnected()) {
      await driver.disconnect();
    }
  }
  driverInstances.clear();
}
