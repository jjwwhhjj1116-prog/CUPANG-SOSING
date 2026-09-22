import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const bootstrapPath = path.join(root, 'db/migrations/0001_sourceflow_bootstrap.sql');
const identifier = name => `"${name.replaceAll('"', '""')}"`;

// Read code as syntax, never import application modules or execute their requests.
export function ddlFromSource(source, filename = 'source.ts') {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const statements = [];
  const visit = node => {
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
    const text = literal ? node.text : ts.isTemplateExpression(node) ? node.head.text : '';
    if (/^\s*(?:CREATE|ALTER|DROP)\s/i.test(text)) {
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      if (!literal) throw new Error(`${filename}:${line}: dynamic DDL cannot be compared; make the schema explicit.`);
      const match = /^\s*CREATE\s+(TABLE|(?:UNIQUE\s+)?INDEX)\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z_]\w*)\b/i.exec(text);
      if (!match) throw new Error(`${filename}:${line}: unsupported runtime DDL; update the migration checker explicitly.`);
      statements.push({ file: filename, line, name: match[2], type: /TABLE/i.test(match[1]) ? 'table' : 'index', sql: text.trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return statements;
}

export function runtimeDDL() {
  const collect = directory => fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(file) : entry.name.endsWith('.ts') ? ddlFromSource(fs.readFileSync(file, 'utf8'), path.relative(root, file).replaceAll('\\', '/')) : [];
  });
  const statements = collect(path.join(root, 'db'));
  const declarations = new Map();
  for (const statement of statements) {
    const previous = declarations.get(statement.name);
    if (previous) assert.deepEqual(sqlTokens(statement.sql), sqlTokens(previous.sql), `Conflicting runtime DDL for ${statement.name}: ${previous.file}:${previous.line} and ${statement.file}:${statement.line}.`);
    else declarations.set(statement.name, statement);
  }
  assert.ok(statements.length, 'No runtime schema was found.');
  // Create parent tables before their indexes. SQLite permits references to a
  // table created later, and foreign-key checking stays enabled throughout.
  const unique = Array.from(declarations.values());
  return [...unique.filter(value => value.type === 'table'), ...unique.filter(value => value.type === 'index')];
}

export function readBootstrap() { return fs.readFileSync(bootstrapPath, 'utf8'); }

// Token normalization ignores spacing/case in keywords, preserves quoted text,
// CHECK expressions, partial-index predicates and the order of definitions.
export function sqlTokens(sql) {
  return (sql.match(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[a-zA-Z_][\w$]*|\d+(?:\.\d+)?|[^\s]/g) ?? [])
    .filter(token => !token.startsWith('--') && !token.startsWith('/*'))
    .map(token => token.startsWith("'") ? token : token.toLowerCase());
}

export function assertAdditiveBootstrap(sql) {
  const statements = []; let tokens = [];
  for (const token of sqlTokens(sql)) {
    if (token === ';') { if (tokens.length) statements.push(tokens); tokens = []; }
    else tokens.push(token);
  }
  if (tokens.length) statements.push(tokens);
  assert.ok(statements.length, 'Bootstrap is empty.');
  for (const statement of statements) {
    assert.match(statement.join(' '), /^create (?:table|(?:unique )?index) if not exists [a-zA-Z_]\w* /, 'Baseline must only create missing tables/indexes. Schema changes need a separately reviewed migration.');
  }
}

export function memoryDatabase() {
  // Intentionally accepts no path, URI, binding, credentials or network client.
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  return db;
}

export function schemaSnapshot(db) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row => ({
    type: row.type, name: row.name, table: row.tbl_name, sql: sqlTokens(row.sql ?? ''),
    ...(row.type === 'table' ? {
      columns: db.prepare(`PRAGMA table_xinfo(${identifier(row.name)})`).all().map(value => ({ ...value })),
      foreignKeys: db.prepare(`PRAGMA foreign_key_list(${identifier(row.name)})`).all().map(value => ({ ...value })),
      indexes: db.prepare(`PRAGMA index_list(${identifier(row.name)})`).all().map(({ name, unique, origin, partial }) => ({ name, unique, origin, partial,
        columns: db.prepare(`PRAGMA index_xinfo(${identifier(name)})`).all().map(value => ({ ...value })),
      })).sort((a, b) => a.name.localeCompare(b.name, 'en')),
    } : {}),
  }));
}

export function checkDatabaseSchema(sql = readBootstrap(), statements = runtimeDDL()) {
  assertAdditiveBootstrap(sql);
  const runtime = memoryDatabase(); const migrated = memoryDatabase();
  try {
    for (const statement of statements) runtime.exec(statement.sql);
    migrated.exec(sql);
    const expected = schemaSnapshot(runtime);
    assert.deepEqual(schemaSnapshot(migrated), expected, 'Bootstrap schema differs from runtime DDL (columns, constraints, foreign keys, indexes or predicates).');
    migrated.exec(sql);
    assert.deepEqual(schemaSnapshot(migrated), expected, 'Applying the bootstrap twice changed the schema.');
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(migrated.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    return { tables: expected.filter(value => value.type === 'table').length, indexes: expected.filter(value => value.type === 'index').length, runtimeModules: new Set(statements.map(value => value.file)).size };
  } finally { runtime.close(); migrated.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    console.error('Usage: node scripts/check-db-schema.mjs (no arguments; in-memory verification only)');
    process.exitCode = 1;
  } else {
    try {
      const result = checkDatabaseSchema();
      console.log(`Schema matches: ${result.tables} tables, ${result.indexes} indexes from ${result.runtimeModules} runtime modules. Fresh/repeated bootstrap checked in memory; no local or remote database opened.`);
    } catch (error) { console.error(error instanceof Error ? error.message : 'Schema verification failed.'); process.exitCode = 1; }
  }
}
