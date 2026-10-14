#!/usr/bin/env node
// A separate process contains parser crashes and gives the parent an exit code
// that cannot be confused with Node's ordinary uncaught-error exit of 1.

const VALID = 0;
const INVALID = 65;
const CANNOT_DECIDE = 3;

try {
  const [{ readFileSync }, { createRequire }, { dirname, extname, join }, { resolveTypeScript }] = await Promise.all([
    import('node:fs'),
    import('node:module'),
    import('node:path'),
    import('./syntax.mjs'),
  ]);
  const file = process.argv[2];
  if (!file) process.exit(CANNOT_DECIDE);
  const resolved = resolveTypeScript(file);
  if (resolved === null) process.exit(CANNOT_DECIDE);

  const ts = createRequire(import.meta.url)(resolved.path);
  const name = join(dirname(file), `.__adlc_syntax__${extname(file)}`);
  const text = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const host = {
    getSourceFile: (candidate) => candidate === name ? sourceFile : undefined,
    fileExists: (candidate) => candidate === name,
    readFile: (candidate) => candidate === name ? text : undefined,
    getDefaultLibFileName: () => '',
    writeFile: () => {},
    getCurrentDirectory: () => dirname(file),
    getDirectories: () => [],
    getCanonicalFileName: (candidate) => candidate,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram({
    rootNames: [name],
    options: { noResolve: true, noLib: true, allowJs: true, jsx: ts.JsxEmit.Preserve },
    host,
  });
  const held = program.getSourceFile(name);
  if (held === undefined) process.exit(CANNOT_DECIDE);
  process.exit(program.getSyntacticDiagnostics(held).length === 0 ? VALID : INVALID);
} catch {
  process.exit(CANNOT_DECIDE);
}
