/**
 * The flag table, rendered into help rather than written as prose.
 *
 * Help text as a single literal is untestable in the way that matters: the only
 * assertion available is that the source says what the source says. Rendering it
 * from data makes the CLI's documented surface a function of its actual option
 * set, so `renderUsage` can be tested and help cannot drift from the parser
 * without a test noticing.
 */
export const FLAGS = [
  { name: 'profile', arg: 'path', help: 'profile JSON (default .claude/backlog-groom-profile.json)' },
  { name: 'cache', arg: 'path', help: 'cache file (default .adlc/backlog-groom-cache.json; gitignored)' },
  { name: 'no-cache', arg: null, help: 'verify everything, ignoring and not writing the cache' },
  { name: 'threshold', arg: 'n', help: 'relation candidate-filter threshold (default 0.2)' },
  { name: 'json', arg: null, help: 'emit the groomed set as JSON instead of the report' },
  { name: 'out', arg: 'path', help: 'write the groomed set JSON to a file' },
  { name: 'help', arg: null, help: 'show this message' },
];

/** Render the usage block from the flag table. */
export function renderUsage(flags = FLAGS) {
  const lines = ['backlog-groom — groom a GitHub issue backlog against the code (read-only)', ''];
  for (const f of flags) {
    const left = f.arg ? `--${f.name} <${f.arg}>` : `--${f.name}`;
    lines.push(`  ${left.padEnd(22)}${f.help}`);
  }
  lines.push('', 'This command never writes to GitHub.');
  return lines.join('\n');
}
