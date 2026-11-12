import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkPublic } from './check-public.mjs';

const root = resolve(import.meta.dirname, '..');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
if (git(['status', '--porcelain']).trim())
  throw new Error('Commit reviewed source before exporting.');
checkPublic();
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
const output = resolve(root, 'artifacts/wired-source.zip');
git(['archive', '--format=zip', '--prefix=wired/', `--output=${output}`, 'HEAD']);
console.log(`Exported source without Git history: ${output}`);
