import { format } from 'date-fns';

const wrappers = {
  bold: ['**', '**'],
  italic: ['~~', '~~'],
  underline: ['__', '__'],
  strike: ['--', '--'],
  inlineCode: ['`', '`'],
  subscript: ['_(', ')'],
  superscript: ['^(', ')'],
} as const;

export type DraftFormat = keyof typeof wrappers | 'bullets' | 'quote' | 'codeBlock' | 'date' | 'time' | 'url' | 'email';

export function formatMessageDraft(value: string, start: number, end: number, action: DraftFormat, now = new Date()) {
  const selected = value.slice(start, end);
  const replace = (text: string, from = 0, to = text.length, left = start, right = end) => ({
    value: value.slice(0, left) + text + value.slice(right),
    start: left + from,
    end: left + to,
  });

  switch (action) {
    case 'quote':
    case 'bullets': {
      const prefix = action === 'quote' ? '> ' : '- ';
      const existingPrefix = action === 'quote' ? /^[ \t]*>[ \t]+/ : /^[ \t]*-(?!-)/;
      const firstLine = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
      const nextBreak = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
      const endOfLine = nextBreak === -1 ? value.length : nextBreak;
      const lines = value.slice(firstLine, endOfLine).split('\n');
      const markedLines = lines.map(line => existingPrefix.test(line) ? line : prefix + line).join('\n');
      const caret = start === end ? start - firstLine + markedLines.length - lines[0].length : 0;
      return replace(markedLines, caret, start === end ? caret : markedLines.length, firstLine, endOfLine);
    }
    case 'codeBlock': {
      const prefix = (start > 0 && value[start - 1] !== '\n' ? '\n' : '') + '```\n';
      const suffix = '\n```' + (end < value.length && value[end] !== '\n' ? '\n' : '');
      const code = selected.replace(/\n$/, '');
      return replace(prefix + code + suffix, prefix.length, prefix.length + code.length);
    }
    case 'date':
      return replace(format(now, 'dd.MM.yyyy'));
    case 'time':
      return replace(format(now, 'HH:mm'));
    case 'url': {
      const address = selected.trim();
      if (/^(?:https?:\/\/|www\.)\S+$/i.test(address)) return replace(address);
      if (/^[\w-]+(?:\.[\w-]+)+\S*$/.test(address)) return replace(`https://${address}`);
      return replace('https://example.com', 'https://'.length);
    }
    case 'email':
      return replace(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(selected.trim()) ? selected.trim() : 'name@example.com');
    default: {
      const [open, close] = wrappers[action];
      if (start >= open.length && value.slice(start - open.length, start) === open && value.slice(end, end + close.length) === close) {
        return replace(selected, 0, selected.length, start - open.length, end + close.length);
      }

      const lines = selected.split('\n');
      const startsAtLine = start === 0 || value[start - 1] === '\n';
      const wrapLine = (line: string, index: number) => {
        const linePrefix = (startsAtLine || index > 0) ? /^[ \t]*(?:-(?!-)[ \t]*|>[ \t]+)/.exec(line)?.[0] ?? '' : '';
        const text = line.slice(linePrefix.length);
        return { before: linePrefix + open, text };
      };
      if (lines.length === 1) {
        const { before, text } = wrapLine(selected, 0);
        return replace(before + text + close, before.length, before.length + text.length);
      }
      const wrapped = lines.map((line, index) => {
        if (!line) return line;
        const { before, text } = wrapLine(line, index);
        return before + text + close;
      }).join('\n');
      return replace(wrapped);
    }
  }
}
