import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../bridge/cursor_bridge.py', import.meta.url), 'utf8');
const code = `import sys,json; data=json.load(sys.stdin); scope={'__name__':'pocket_cursor'}; exec(compile(data['source'],'pocket-cursor','exec'),scope); print(json.dumps(scope['install'](data['source'])))`;
const machine = process.argv[2];
if (machine && !/^[a-zA-Z0-9._-]+$/.test(machine)) throw Error('Invalid machine name');
let installed = false;
for (const python of ['python', 'python3']) {
  try {
    const env = { ...process.env };
    delete env.HC_TERMINAL_ID;
    const result = await new Promise((resolve, reject) => {
      const child = execFile(
        process.env.HC_PATH || 'hc',
        [
          'exec',
          ...(machine ? ['--on', machine] : []),
          '--timeout',
          '15',
          '-i',
          '--',
          python,
          '-c',
          code,
        ],
        { env, windowsHide: true, timeout: 20000, encoding: 'utf8' },
        (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout))),
      );
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ source }));
    });
    console.log(JSON.stringify(result));
    installed = true;
    break;
  } catch (error) {
    if (python === 'python3') throw error;
  }
}
if (!installed) throw Error('Cursor hook installation failed');
