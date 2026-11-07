import { createHash } from 'node:crypto';

const supported = new Set(['codex', 'claude', 'claude-code']);
const optionLine = /^\s*([❯›]?)\s*(\d{1,2})[.)]\s+(.+?)\s*$/;
const rule = /^\s*[─━═╌-]{5,}\s*$/;
const utility = /^(?:Type something\.?|Chat about this|Other\s*\(.*\))$/i;

// Read only the active numbered dialog, never infer choices from conversation prose.
export function parseInteraction(terminal, sessionId, screen) {
  if (
    terminal.state !== 'live' ||
    terminal.status?.state !== 'blocked' ||
    terminal.status.kind === 'auth' ||
    !supported.has(terminal.status.app) ||
    !sessionId ||
    !screen?.complete ||
    screen.how !== 'screen'
  )
    return null;
  const lines = screen.text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replaceAll('\r', '')
    .split('\n');
  const footer = lines.findLastIndex((line) =>
    /enter.*(?:select|confirm|submit)|press enter/i.test(line),
  );
  if (footer < 0 || /space.*(?:select|toggle)/i.test(lines[footer])) return null;
  const selectedLine = lines.findLastIndex(
    (line, i) => i < footer && /^[\s]*[❯›]\s*\d+[.)]\s/.test(line),
  );
  if (selectedLine < 0) return null;
  let first = selectedLine;
  while (first > 0 && !rule.test(lines[first - 1])) first--;
  const firstOption = lines.findIndex(
    (line, i) => i >= first && i <= selectedLine && optionLine.test(line),
  );
  if (firstOption < 0) return null;
  const choices = [];
  let selected = null;
  for (let i = firstOption; i < footer; i++) {
    const match = lines[i].match(optionLine);
    if (match) {
      const number = Number(match[2]);
      if (number !== choices.length + 1 || number > 12) return null;
      if (match[1]) {
        if (selected !== null) return null;
        selected = number;
      }
      choices.push({ id: String(number), label: match[3], description: '', position: number });
    } else if (choices.length && lines[i].trim() && !rule.test(lines[i])) {
      choices.at(-1).description += `${choices.at(-1).description ? '\n' : ''}${lines[i].trim()}`;
    }
  }
  if (choices.length < 2 || selected === null) return null;
  let start = first;
  if (start === 0) {
    start = lines.findLastIndex(
      (line, i) =>
        i < firstOption &&
        /would you like|do you want|allow |approve |permission|승인|허용/i.test(line),
    );
    if (start < 0) return null;
  }
  const question = lines
    .slice(start, firstOption)
    .map((line) => line.replace(/^\s*[│┃]\s?/, '').trimEnd())
    .join('\n')
    .trim();
  if (
    !question ||
    question.length > 12000 ||
    choices.some((c) => c.label.length + c.description.length > 4000)
  )
    return null;
  const id = createHash('sha256')
    .update(
      JSON.stringify([
        terminal.created_ms,
        sessionId,
        terminal.status_ms,
        terminal.status.kind,
        question,
        choices,
        selected,
      ]),
    )
    .digest('hex');
  return {
    id,
    kind: terminal.status.kind || 'permission',
    question,
    selected,
    choices: choices.filter((c) => !utility.test(c.label)),
    footer: lines[footer].trim(),
  };
}

export async function readInteraction(hc, terminal, sessionId) {
  if (terminal.status?.state !== 'blocked' || !sessionId) return null;
  return parseInteraction(
    terminal,
    sessionId,
    await hc('read', terminal.address, '--json', '--lines', '0'),
  );
}

export function choiceKeys(interaction, choiceId) {
  const choice = interaction?.choices.find((c) => c.id === choiceId);
  if (!choice) return null;
  const distance = choice.position - interaction.selected;
  return [...Array(Math.abs(distance)).fill(distance > 0 ? 'down' : 'up'), 'enter'];
}
