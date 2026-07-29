import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), '..');
const DEFAULT_ENTRY = 'src/archive/browserEntry.mjs';
const DEFAULT_RUNTIME = 'src/archive/browser-runtime.js';

function toModuleId(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function resolveModule(fromId, specifier) {
  if (specifier === 'fflate') return specifier;
  if (!specifier.startsWith('.')) {
    throw new Error(`Unsupported browser bundle dependency: ${specifier}`);
  }

  const fromPath = path.join(root, fromId);
  let resolved = path.resolve(path.dirname(fromPath), specifier);
  if (!path.extname(resolved)) resolved += '.mjs';
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`Archive module escapes repository root: ${specifier}`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Archive module not found: ${toModuleId(resolved)}`);
  }
  return toModuleId(resolved);
}

function parseNamedBindings(source) {
  return source
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const match = item.match(/^(\w+)\s+as\s+(\w+)$/);
      return match ? `${match[1]}: ${match[2]}` : item;
    })
    .join(', ');
}

function transformImports(source, moduleId, dependencies) {
  return source.replace(
    /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
    (_, clause, specifier) => {
      const resolved = resolveModule(moduleId, specifier);
      dependencies.add(resolved);
      const normalized = clause.trim();

      if (normalized.startsWith('{')) {
        const bindings = parseNamedBindings(normalized.slice(1, -1));
        return `const { ${bindings} } = __require(${JSON.stringify(resolved)});`;
      }
      if (normalized.startsWith('* as ')) {
        return `const ${normalized.slice(5).trim()} = __require(${JSON.stringify(resolved)});`;
      }
      if (/^\w+$/.test(normalized)) {
        return `const ${normalized} = __require(${JSON.stringify(resolved)}).default;`;
      }
      throw new Error(`Unsupported import clause in ${moduleId}: ${normalized}`);
    }
  );
}

function transformExports(source, moduleId) {
  const exports = new Map();
  let transformed = source;

  transformed = transformed.replace(
    /export\s+(async\s+)?function\s+(\w+)/g,
    (_, asyncKeyword = '', name) => {
      exports.set(name, name);
      return `${asyncKeyword}function ${name}`;
    }
  );
  transformed = transformed.replace(/export\s+class\s+(\w+)/g, (_, name) => {
    exports.set(name, name);
    return `class ${name}`;
  });
  transformed = transformed.replace(/export\s+(const|let|var)\s+(\w+)/g, (_, kind, name) => {
    exports.set(name, name);
    return `${kind} ${name}`;
  });
  transformed = transformed.replace(/export\s+default\s+/g, () => {
    exports.set('default', '__default_export__');
    return 'const __default_export__ = ';
  });
  transformed = transformed.replace(/export\s*{([\s\S]*?)}\s*;?/g, (_, list) => {
    for (const item of list.split(',')) {
      const normalized = item.trim();
      if (!normalized) continue;
      const match = normalized.match(/^(\w+)\s+as\s+(\w+)$/);
      if (match) exports.set(match[2], match[1]);
      else if (/^\w+$/.test(normalized)) exports.set(normalized, normalized);
      else throw new Error(`Unsupported export in ${moduleId}: ${normalized}`);
    }
    return '';
  });

  if (/\bexport\s/.test(transformed)) {
    throw new Error(`Unsupported export syntax remains in ${moduleId}`);
  }

  const assignments = [...exports.entries()]
    .map(([exported, local]) => `exports[${JSON.stringify(exported)}] = ${local};`)
    .join('\n');

  return `${transformed}\n${assignments}`;
}

function collectModules(entryId) {
  const modules = new Map();
  const visiting = new Set();

  function visit(moduleId) {
    if (moduleId === 'fflate' || modules.has(moduleId)) return;
    if (visiting.has(moduleId)) return;
    visiting.add(moduleId);

    const source = fs.readFileSync(path.join(root, moduleId), 'utf8');
    const dependencies = new Set();
    const withoutImports = transformImports(source, moduleId, dependencies);
    const transformed = transformExports(withoutImports, moduleId);

    for (const dependency of dependencies) visit(dependency);
    modules.set(moduleId, transformed);
    visiting.delete(moduleId);
  }

  visit(entryId);
  return modules;
}

export function buildArchiveBrowserBundle(options = {}) {
  const entryId = options.entry || DEFAULT_ENTRY;
  const runtimePath = path.join(root, options.runtime || DEFAULT_RUNTIME);
  const modules = collectModules(entryId);
  const definitions = [...modules.entries()].map(([moduleId, source]) => [
    `__modules[${JSON.stringify(moduleId)}] = function(module, exports, __require) {`,
    source,
    '};'
  ].join('\n')).join('\n\n');

  const runtime = fs.readFileSync(runtimePath, 'utf8');
  return [
    '// Loominary Archive browser bundle. Generated from source modules.',
    '(function attachLoominaryArchiveBundle(global) {',
    "'use strict';",
    'const __modules = Object.create(null);',
    'const __cache = Object.create(null);',
    '__modules.fflate = function(module, exports) {',
    "  const library = typeof fflate !== 'undefined' ? fflate : global.fflate;",
    "  if (!library) throw new Error('fflate is required for Archive ZIP export');",
    '  Object.assign(exports, library);',
    '};',
    definitions,
    'function __require(moduleId) {',
    '  if (__cache[moduleId]) return __cache[moduleId].exports;',
    "  const factory = __modules[moduleId];",
    "  if (!factory) throw new Error('Archive browser module not found: ' + moduleId);",
    '  const module = { exports: {} };',
    '  __cache[moduleId] = module;',
    '  factory(module, module.exports, __require);',
    '  return module.exports;',
    '}',
    `__require(${JSON.stringify(entryId)});`,
    runtime,
    "})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);",
    ''
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.stdout.write(buildArchiveBrowserBundle());
}
