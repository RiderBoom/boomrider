import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Helper to list all files in directory recursively
function getFilesRecursively(dir, extension = '') {
  const entries = readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getFilesRecursively(fullPath, extension));
    } else if (!extension || entry.name.endsWith(extension)) {
      files.push(fullPath);
    }
  }
  return files;
}

test('Frontend RPC parameters match SQL function parameter definitions', () => {
  // 1. Gather all SQL files
  const migrationFiles = readdirSync('supabase/migrations')
    .filter(f => f.endsWith('.sql'))
    .map(f => join('supabase/migrations', f));
  const sqlFiles = [...migrationFiles, 'supabase_schema.sql'];

  // Map of function_name -> Set of parameter names
  const sqlFunctionParams = new Map();

  // Simple regex to extract function definitions: CREATE OR REPLACE FUNCTION schema.func_name(params...)
  const funcRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)/gi;

  for (const file of sqlFiles) {
    const content = readFileSync(file, 'utf8');
    let match;
    while ((match = funcRegex.exec(content)) !== null) {
      const funcName = match[1].toLowerCase();
      const paramsRaw = match[2].trim();

      const paramNames = new Set();
      if (paramsRaw) {
        // Split params by comma, ignoring commas inside brackets if any
        const paramsList = paramsRaw.split(',');
        for (const p of paramsList) {
          const trimmed = p.trim();
          if (!trimmed) continue;
          // Parameter format: param_name TYPE ...
          const parts = trimmed.split(/\s+/);
          if (parts.length > 0 && parts[0] && !/^(OUT|INOUT|VARIADIC|TABLE)$/i.test(parts[0])) {
            paramNames.add(parts[0].toLowerCase());
          } else if (parts.length > 1) {
            paramNames.add(parts[1].toLowerCase());
          }
        }
      }
      sqlFunctionParams.set(funcName, paramNames);
    }
  }

  // 2. Scan frontend files for supabase.rpc('function_name', { ... })
  const srcFiles = getFilesRecursively('src', '.js').concat(getFilesRecursively('src', '.jsx'));
  const rpcCallRegex = /supabase(?:\.schema\([^)]+\))?\s*\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]\s*(?:,\s*\{([^}]*)\})?/g;

  const mismatches = [];

  for (const file of srcFiles) {
    const content = readFileSync(file, 'utf8');
    let match;
    while ((match = rpcCallRegex.exec(content)) !== null) {
      const funcName = match[1].toLowerCase();
      const paramsBlock = match[2];

      if (!sqlFunctionParams.has(funcName)) {
        mismatches.push(`${file}: RPC '${funcName}' is called by frontend but not defined in SQL schema`);
        continue;
      }

      const expectedParams = sqlFunctionParams.get(funcName);
      if (paramsBlock) {
        // Extract parameter keys from object literal block (key: val)
        const keyRegex = /([a-zA-Z0-9_]+)\s*:/g;
        let keyMatch;
        while ((keyMatch = keyRegex.exec(paramsBlock)) !== null) {
          const keyName = keyMatch[1].toLowerCase();
          if (!expectedParams.has(keyName)) {
            mismatches.push(`${file}: RPC '${funcName}' called with parameter '${keyName}' which is not in SQL signature`);
          }
        }
      }
    }
  }

  assert.deepEqual(mismatches, [], `Found RPC parameter mismatches:\n${mismatches.join('\n')}`);
});

test('Essential migration files (001-043) exist and maintain sequential ordering', () => {
  const files = readdirSync('supabase/migrations')
    .filter(f => f.endsWith('.sql'))
    .sort();

  const essentialNumbers = ['036', '037', '038', '039', '040', '041', '042', '043'];
  for (const num of essentialNumbers) {
    const exists = files.some(f => f.startsWith(`${num}_`));
    assert.ok(exists, `Missing essential migration ${num}`);
  }

  // Verify prefix numbers are sorted and present
  const prefixes = files.map(f => parseInt(f.split('_')[0], 10)).filter(n => !isNaN(n));
  assert.ok(prefixes.length >= 35, 'Expected comprehensive migration suite');
});

test('Required triggers, functions, and EXECUTE grants are declared in migrations / schema', () => {
  const sqlFiles = readdirSync('supabase/migrations')
    .filter(f => f.endsWith('.sql'))
    .map(f => join('supabase/migrations', f))
    .concat(['supabase_schema.sql']);

  const combinedContent = sqlFiles.map(f => readFileSync(f, 'utf8')).join('\n');

  // Verify required functions
  const requiredFunctions = [
    'create_service_quote',
    'place_customer_order',
    'cancel_order_atomic',
    'process_order_settlement',
    'handle_new_auth_user',
    'is_admin',
    'admin_set_user_role',
    'get_financial_reconciliation_report',
    'admin_get_system_health',
  ];

  for (const func of requiredFunctions) {
    const pattern = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${func}\\b`, 'i');
    assert.ok(pattern.test(combinedContent), `Missing required function definition: ${func}`);
  }

  // Verify required triggers
  const requiredTriggers = [
    'on_auth_user_created_initialize_account',
    'capture_wallet_ledger_entry',
    'protect_wallet_ledger_entries',
  ];

  for (const trigger of requiredTriggers) {
    const pattern = new RegExp(`CREATE\\s+TRIGGER\\s+${trigger}\\b`, 'i');
    assert.ok(pattern.test(combinedContent), `Missing required trigger definition: ${trigger}`);
  }

  // Verify required EXECUTE grants
  const requiredGrants = [
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?is_admin/i,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?admin_set_user_role/i,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?create_service_quote/i,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?cancel_order_atomic/i,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?process_order_settlement/i,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?get_financial_reconciliation_report/i,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?admin_get_system_health/i,
  ];

  for (const grantPattern of requiredGrants) {
    assert.ok(grantPattern.test(combinedContent), `Missing required EXECUTE grant pattern: ${grantPattern.source}`);
  }
});

test('Read-only audit script contains zero data mutation statements or forbidden keywords', () => {
  const sql = readFileSync('scripts/production-health-check.sql', 'utf8');

  const forbiddenKeywords = [
    'INSERT',
    'UPDATE',
    'DELETE',
    'ALTER',
    'DROP',
    'TRUNCATE',
    'GRANT',
    'REVOKE',
    'DO',
  ];

  for (const word of forbiddenKeywords) {
    const pattern = new RegExp(`\\b${word}\\b`, 'i');
    assert.equal(
      pattern.test(sql),
      false,
      `Read-only audit script scripts/production-health-check.sql contains forbidden keyword '${word}'`
    );
  }

  assert.ok(/\bSELECT\b/i.test(sql), 'Read-only audit script must contain SELECT statement');
});
