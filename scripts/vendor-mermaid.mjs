import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'node_modules/mermaid');
const destination = resolve(root, 'app/src/main/assets/vendor');
mkdirSync(destination, { recursive: true });
copyFileSync(resolve(source, 'dist/mermaid.min.js'), resolve(destination, 'mermaid.min.js'));
copyFileSync(resolve(source, 'LICENSE'), resolve(root, 'licenses/Mermaid-MIT.txt'));
const visited = new Set(),
  notices = [];
function license(name, from = root) {
  let directory;
  for (let parent = from; parent !== resolve(parent, '..'); parent = resolve(parent, '..')) {
    try {
      readFileSync(resolve(parent, 'node_modules', name, 'package.json'));
      directory = resolve(parent, 'node_modules', name);
      break;
    } catch {}
  }
  if (!directory || visited.has(directory)) return;
  visited.add(directory);
  const pkg = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  const files = readdirSync(directory).filter((file) =>
    /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(file),
  );
  notices.push(
    `${pkg.name} ${pkg.version} (${pkg.license || 'see package'})\n${files.map((file) => readFileSync(resolve(directory, file), 'utf8')).join('\n')}`,
  );
  for (const dependency of Object.keys(pkg.dependencies || {})) license(dependency, directory);
}
license('mermaid');
writeFileSync(
  resolve(root, 'licenses/Mermaid-dependencies.txt'),
  notices.sort().join('\n\n----------------------------------------\n\n'),
);
const bytes = readFileSync(resolve(destination, 'mermaid.min.js'));
console.log(
  `Vendored Mermaid: ${bytes.length} bytes, SHA-256 ${createHash('sha256').update(bytes).digest('hex')}`,
);
