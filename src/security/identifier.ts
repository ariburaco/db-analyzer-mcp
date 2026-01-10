/**
 * SQL Identifier Validation
 * Prevents SQL injection through table/column names
 */

// Valid identifier pattern: alphanumeric + underscore, must start with letter or underscore
const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Max identifier length (PostgreSQL limit is 63)
const MAX_IDENTIFIER_LENGTH = 63;

// Reserved SQL keywords that shouldn't be used as identifiers
const RESERVED_KEYWORDS = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'TABLE',
  'DATABASE',
  'INDEX',
  'VIEW',
  'TRIGGER',
  'FUNCTION',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'TRUE',
  'FALSE',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'ON',
  'AS',
  'ORDER',
  'BY',
  'GROUP',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'ALL',
  'DISTINCT',
  'GRANT',
  'REVOKE',
  'EXECUTE',
  'TRUNCATE',
]);

export interface IdentifierValidation {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

/**
 * Validates a SQL identifier (table name, column name, schema name)
 */
export function validateIdentifier(
  identifier: string,
  type: 'table' | 'column' | 'schema' = 'table'
): IdentifierValidation {
  if (!identifier || typeof identifier !== 'string') {
    return { valid: false, error: `${type} name must be a non-empty string` };
  }

  const trimmed = identifier.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: `${type} name cannot be empty` };
  }

  if (trimmed.length > MAX_IDENTIFIER_LENGTH) {
    return {
      valid: false,
      error: `${type} name too long (max ${MAX_IDENTIFIER_LENGTH} characters)`,
    };
  }

  // Check for valid characters
  if (!VALID_IDENTIFIER.test(trimmed)) {
    return {
      valid: false,
      error: `Invalid ${type} name "${trimmed}". Only letters, numbers, and underscores allowed. Must start with a letter or underscore.`,
    };
  }

  // Check for reserved keywords (warn but allow with quotes)
  if (RESERVED_KEYWORDS.has(trimmed.toUpperCase())) {
    // We still allow it but it will be quoted
    return { valid: true, sanitized: trimmed };
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Validates multiple identifiers (e.g., column list)
 */
export function validateIdentifiers(
  identifiers: string[],
  type: 'table' | 'column' | 'schema' = 'column'
): IdentifierValidation {
  if (!Array.isArray(identifiers)) {
    return { valid: false, error: `${type} names must be an array` };
  }

  for (const id of identifiers) {
    const result = validateIdentifier(id, type);
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true, sanitized: identifiers.join(', ') };
}

/**
 * Safely quotes an identifier for use in SQL
 * Uses double quotes (PostgreSQL standard)
 */
export function quoteIdentifier(identifier: string): string {
  // Escape any existing double quotes by doubling them
  const escaped = identifier.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Validates and quotes an identifier in one step
 * Returns null if invalid
 */
export function safeIdentifier(
  identifier: string,
  type: 'table' | 'column' | 'schema' = 'table'
): string | null {
  const validation = validateIdentifier(identifier, type);
  if (!validation.valid) {
    return null;
  }
  return quoteIdentifier(validation.sanitized!);
}
