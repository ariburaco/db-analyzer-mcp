export interface ValidationResult {
  valid: boolean;
  error?: string;
  normalized?: string;
}

// Blocked keywords that indicate write operations
const BLOCKED_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'CREATE',
  'GRANT',
  'REVOKE',
  'EXECUTE',
  'CALL',
  'COPY',
  'VACUUM',
  'REINDEX',
  'CLUSTER',
  'COMMENT',
  'SECURITY',
  'OWNER',
  'SET ROLE',
  'RESET',
];

// Allowed statement prefixes
const ALLOWED_PREFIXES = ['SELECT', 'EXPLAIN', 'SHOW', 'WITH'];

// Dangerous patterns (even in SELECT context)
const DANGEROUS_PATTERNS = [
  /;\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)/i, // SQL injection attempts
  /INTO\s+OUTFILE/i, // File write attempts
  /INTO\s+DUMPFILE/i,
  /LOAD_FILE/i,
  /pg_read_file/i,
  /pg_write_file/i,
  /lo_import/i,
  /lo_export/i,
  /COPY\s+.*\s+TO/i,
  /pg_terminate_backend/i,
  /pg_cancel_backend/i,
];

export function validateQuery(
  sql: string,
  allowedStatements: string[] = ALLOWED_PREFIXES
): ValidationResult {
  if (!sql || typeof sql !== 'string') {
    return { valid: false, error: 'Query must be a non-empty string' };
  }

  // Normalize: trim and collapse whitespace
  const normalized = sql.trim().replace(/\s+/g, ' ');

  if (normalized.length === 0) {
    return { valid: false, error: 'Query cannot be empty' };
  }

  // Check max length (prevent DOS)
  if (normalized.length > 100000) {
    return { valid: false, error: 'Query too long (max 100KB)' };
  }

  const upperNormalized = normalized.toUpperCase();

  // Check if starts with allowed statement
  const startsWithAllowed = allowedStatements.some(prefix => upperNormalized.startsWith(prefix));

  if (!startsWithAllowed) {
    return {
      valid: false,
      error: `Query must start with one of: ${allowedStatements.join(', ')}`,
    };
  }

  // Check for blocked keywords anywhere in query
  for (const keyword of BLOCKED_KEYWORDS) {
    // Use word boundary to avoid false positives (e.g., "DELETED" column name)
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(upperNormalized)) {
      return {
        valid: false,
        error: `Blocked keyword detected: ${keyword}. Only read operations are allowed.`,
      };
    }
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        valid: false,
        error: 'Potentially dangerous SQL pattern detected',
      };
    }
  }

  // Check for multiple statements (basic check)
  // Allow semicolon only at the end
  const semiCount = (normalized.match(/;/g) || []).length;
  if (semiCount > 1 || (semiCount === 1 && !normalized.endsWith(';'))) {
    return {
      valid: false,
      error: 'Multiple statements not allowed. Execute one query at a time.',
    };
  }

  return { valid: true, normalized };
}

export function enforceLimit(sql: string, maxLimit: number): string {
  const normalized = sql.trim();
  const upperNormalized = normalized.toUpperCase();

  // Skip if already has LIMIT
  if (upperNormalized.includes(' LIMIT ')) {
    // Extract existing limit and ensure it's not too high
    const limitMatch = upperNormalized.match(/LIMIT\s+(\d+)/);
    if (limitMatch && limitMatch[1]) {
      const existingLimit = parseInt(limitMatch[1], 10);
      if (existingLimit > maxLimit) {
        // Replace with max limit
        return normalized.replace(/LIMIT\s+\d+/i, `LIMIT ${maxLimit}`);
      }
    }
    return normalized;
  }

  // Skip for EXPLAIN queries
  if (upperNormalized.startsWith('EXPLAIN')) {
    return normalized;
  }

  // Skip for SHOW queries
  if (upperNormalized.startsWith('SHOW')) {
    return normalized;
  }

  // WITH (CTE) queries - LIMIT goes at the end of the main query
  // The main SELECT after WITH should get the LIMIT
  if (upperNormalized.startsWith('WITH')) {
    const withoutSemi = normalized.replace(/;$/, '');
    return `${withoutSemi} LIMIT ${maxLimit}`;
  }

  // Add LIMIT
  const withoutSemi = normalized.replace(/;$/, '');
  return `${withoutSemi} LIMIT ${maxLimit}`;
}
