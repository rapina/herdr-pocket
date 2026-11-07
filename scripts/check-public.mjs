import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
export function checkPublic() {
  const files = [
    ...new Set(
      execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean),
    ),
  ];
  const patterns = [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['GitHub token', /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}/],
    ['personal home path', /(?:[A-Z]:[\\/]Users[\\/]|\/Users\/|\/home\/)[a-z0-9_.-]+[\\/]/i],
    ['tailnet IP', /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/],
    ['tailnet hostname', /\b[\w-]+\.(?!example\.)[\w-]+\.ts\.net\b/],
  ];
  let localToken;
  const config = resolve(root, '.local/config.json');
  if (existsSync(config))
    localToken = JSON.parse(readFileSync(config, 'utf8').replace(/^\uFEFF/, '')).token;
  const failures = [];
  for (const file of files) {
    if (
      /^(?:\.local|artifacts|node_modules)(?:\/|$)|\.(?:jks|keystore)$|(?:^|\/)\.env(?:\.|$)/.test(
        file,
      ) &&
      !file.endsWith('.env.example')
    )
      failures.push(`${file}: private file`);
    if (/(?:^|\/)(?:google-services|firebase-service-account)\.json$/.test(file))
      failures.push(`${file}: Firebase configuration`);
    if (!existsSync(resolve(root, file))) continue;
    const bytes = readFileSync(resolve(root, file));
    if (localToken && bytes.includes(Buffer.from(localToken)))
      failures.push(`${file}: local credential`);
    if (bytes.includes(0)) continue;
    const content = bytes.toString('utf8');
    for (const [label, pattern] of patterns)
      if (pattern.test(content)) failures.push(`${file}: ${label}`);
  }
  if (failures.length) throw new Error(`Source review required:\n${failures.join('\n')}`);
  console.log(`Public source checks passed (${files.length} files). Git history is not scanned.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkPublic();
