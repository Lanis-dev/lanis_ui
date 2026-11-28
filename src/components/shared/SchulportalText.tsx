import { createElement, Fragment, useMemo, type ReactNode } from 'react';
import clsx from 'clsx';
import { CalendarIcon, ClockIcon } from '@heroicons/react/24/outline';
import { safeHttpUrl } from '../../utils/safeHttpUrl';

const emphasis = {
  '**': 'strong',
  '__': 'u',
  '~~': 'em',
  '--': 's',
} as const;

type Marker = keyof typeof emphasis;
type InlineGroup = { marker?: Marker; children: ReactNode[] };

const codeStyle = 'rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-surface-800';
const linkStyle = 'text-primary-600 underline underline-offset-2 dark:text-primary-400';
const listStyle = 'list-inside list-disc';
const quoteStyle = 'my-1 border-l-2 border-surface-300 pl-3 dark:border-surface-600';
const emailPattern = /[\w.!#$%&'+/=?^{}|~-]+@[\w-]+(?:\.[\w-]+)+/;
const emailAddress = new RegExp(`^${emailPattern.source}$`);

// Schulportal uses its own delimiters, including ~~ for italics and -- for strikethrough.
const inlineTokens = new RegExp([
  /(?<code>(?<!`)\x60[^`\n]+\x60(?!`))/.source,
  /(?<literalTag><\/?[a-z][^<>\n]*>)/.source,
  /(?<marker>\*\*|__|~~|--)/.source,
  /(?<url>(?<![a-z\d])(?:https?:\/\/|www\.)[^\s<>`"']+)/.source,
  `(?<email>(?:(?<![\\w.!#$%&'+/=?^{}|~-])|(?<=__|~~|--))${emailPattern.source})`,
  /(?<script>[_^](?:\([^)\n]+\)|[^\s](?=\s)))/.source,
  /(?<date>(?<![a-z\d])\d{2}\.\d{1,2}\.(?:\d{4}|\d{2})(?![a-z\d]))/.source,
  /(?<time>(?<![a-z\d])\d{2}:\d{2}(?![a-z\d])(?:[ \t]+Uhr(?![a-z\d]))?)/.source,
].join('|'), 'gi');

function linkHref(value: string): string | null {
  if (value.toLowerCase().startsWith('mailto:')) {
    return emailAddress.test(value.slice(7)) ? value : null;
  }
  return safeHttpUrl(value);
}

function trimUrl(value: string, markers: InlineGroup[]): string {
  let trimmed = value;
  const opens = value.match(/\(/g)?.length ?? 0;
  let closes = value.match(/\)/g)?.length ?? 0;
  while (true) {
    const withoutPunctuation = trimmed.replace(/[.,!?;:]+$/, '');
    const marker = markers.find(({ marker }) => marker && withoutPunctuation.endsWith(marker))?.marker;
    if (marker) {
      trimmed = withoutPunctuation.slice(0, -marker.length);
      continue;
    }

    // Keep closing parentheses that belong to the URL itself.
    if (withoutPunctuation.endsWith(')') && closes > opens) {
      trimmed = withoutPunctuation.slice(0, -1);
      closes -= 1;
      continue;
    }
    return withoutPunctuation;
  }
}

function renderInline(line: string, lineBreak: boolean): ReactNode[] {
  const text = lineBreak ? line + '\n' : line;
  const groups: InlineGroup[] = [{ children: [] }];
  const tokens = new RegExp(inlineTokens);
  let cursor = 0;
  for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
    const { code, literalTag, url, email, script, date, time, marker } = match.groups!;
    const group = groups[groups.length - 1];
    group.children.push(text.slice(cursor, match.index));
    cursor = tokens.lastIndex;

    if (marker) {
      const delimiter = marker as Marker;
      if (group.marker === delimiter) {
        groups.pop();
        const item = group.children.some(child => child !== '')
          ? createElement(emphasis[delimiter], { key: match.index }, group.children)
          : delimiter + delimiter;
        groups[groups.length - 1].children.push(item);
      } else if (groups.some(entry => entry.marker === delimiter)) {
        group.children.push(delimiter);
      } else {
        groups.push({ marker: delimiter, children: [] });
      }
    } else if (code) {
      group.children.push(<code key={match.index} className={codeStyle}>{code.slice(1, -1)}</code>);
    } else if (literalTag) {
      group.children.push(literalTag);
    } else if (url || email) {
      const address = trimUrl(email || url, groups);
      cursor = tokens.lastIndex = match.index + address.length;
      const destination = email ? `mailto:${address}` : address.replace(/^www\./i, 'https://www.');
      const href = linkHref(destination);
      const label = email ? address : address.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '');
      group.children.push(href ? <a key={match.index} href={href} className={linkStyle}>{label}</a> : address);
    } else if (script) {
      const tag = script[0] === '_' ? 'sub' : 'sup';
      const value = script[1] === '(' ? script.slice(2, -1) : script.slice(1);
      group.children.push(createElement(tag, { key: match.index }, value));
    } else if (date || time) {
      const Icon = date ? CalendarIcon : ClockIcon;
      group.children.push(
        <span key={match.index} className="whitespace-nowrap font-medium text-primary-700 dark:text-primary-300">
          <Icon aria-hidden="true" className="mr-1 inline h-4 w-4 align-text-bottom" />{date || time}
        </span>,
      );
    }
  }
  groups[groups.length - 1].children.push(line.slice(cursor));
  while (groups.length > 1) {
    const group = groups.pop()!;
    const parent = groups[groups.length - 1];
    parent.children = parent.children.concat(group.marker, group.children);
  }
  return groups[0].children;
}

type BlockKind = 'list' | 'quote';

function renderLines(text: string, messages: boolean, allowBlocks = true): ReactNode[] {
  const lines = text.split('\n');
  const output: ReactNode[] = [];
  const bulletPattern = messages ? /^[ \t]*-(?!-)[ \t]*(.*)$/ : /^[ \t]*-[ \t]+(.*)$/;
  let blockKind: BlockKind | undefined;
  let block: ReactNode[] = [];

  function flushBlock(index: number) {
    if (blockKind === 'list') output.push(<ul key={`block-${index}`} className={listStyle}>{block}</ul>);
    if (blockKind === 'quote') output.push(<blockquote key={`block-${index}`} className={quoteStyle}>{block}</blockquote>);
    block = [];
  }

  for (const [index, line] of lines.entries()) {
    const lineBreak = index < lines.length - 1;
    const bullet = allowBlocks && bulletPattern.exec(line);
    const quote = allowBlocks && messages && /^[ \t]*>[ \t]+(.*)$/.exec(line);
    const kind = bullet ? 'list' : quote ? 'quote' : undefined;
    if (kind !== blockKind) {
      flushBlock(index);
      blockKind = kind;
    }

    if (bullet) {
      block.push(<li key={index}>{renderInline(bullet[1], lineBreak)}</li>);
    } else if (quote) {
      if (block.length) block.push('\n');
      block.push(<Fragment key={index}>{renderInline(quote[1], lineBreak)}</Fragment>);
    } else {
      output.push(<Fragment key={index}>{renderInline(line, lineBreak)}{lineBreak ? '\n' : null}</Fragment>);
    }
  }
  flushBlock(lines.length);
  return output;
}

function renderMarkup(text: string, messages: boolean): ReactNode[] {
  const output: ReactNode[] = [];
  const normalized = text.replace(/\r\n?/g, '\n');
  let cursor = 0;

  for (const fence of normalized.matchAll(/(?<!`)\x60{3}(?!`)([\s\S]*?)(?<!`)\x60{3}(?!`)/g)) {
    const offset = fence.index!;
    output.push(
      <Fragment key={offset}>{renderLines(normalized.slice(cursor, offset).replace(/\n$/, ''), messages)}</Fragment>,
      <pre key={`code-${offset}`} className="my-1 overflow-x-auto rounded bg-surface-100 p-2 dark:bg-surface-800">
        <code className="font-mono text-[0.9em]">{fence[1].replace(/^\n|\n$/g, '')}</code>
      </pre>,
    );
    cursor = offset + fence[0].length + Number(normalized[offset + fence[0].length] === '\n');
  }

  output.push(<Fragment key="end">{renderLines(normalized.slice(cursor), messages)}</Fragment>);
  return output;
}

const legacyTags = new Set(['p', 'div', 'b', 'strong', 'em', 'i', 'u', 's', 'del', 'strike', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'span']);

const legacyBlockTags = new Set(['p', 'div', 'li', 'blockquote']);

type LegacyMode = 'block' | 'inline' | 'literal';

function renderLegacyText(text: string, mode: LegacyMode, messages: boolean): ReactNode {
  if (mode === 'literal') return text;
  return mode === 'block' ? renderMarkup(text, messages) : renderLines(text, messages, false);
}

function renderLegacyChildren(parent: ParentNode, messages: boolean, mode: LegacyMode = 'block'): ReactNode[] {
  const output: ReactNode[] = [];
  let text = '';
  for (const [index, child] of Array.from(parent.childNodes).entries()) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? '';
      continue;
    }
    if (!(child instanceof Element)) continue;

    const tag = child.localName;
    if (tag === 'br') {
      text += '\n';
      continue;
    }
    if (!legacyTags.has(tag) || child.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      text += child.outerHTML;
      continue;
    }
    output.push(<Fragment key={`text-${index}`}>{renderLegacyText(text, mode, messages)}</Fragment>);
    text = '';

    // Recreate known elements from scratch. Only validated link destinations are copied.
    const href = tag === 'a' ? linkHref(child.getAttribute('href') ?? '') : null;
    const className = tag === 'a' && href ? linkStyle
      : tag === 'ul' ? listStyle
      : tag === 'ol' ? 'list-inside list-decimal'
      : tag === 'blockquote' ? quoteStyle
      : tag === 'code' ? codeStyle
      : tag === 'pre' ? 'overflow-x-auto'
      : undefined;
    const childMode = mode === 'literal' || ['a', 'pre', 'code'].includes(tag) ? 'literal'
      : legacyBlockTags.has(tag) ? 'block'
      : 'inline';
    // A legacy paragraph can contain a Schulportal list or fenced code block.
    const element = tag === 'p' ? 'div'
      : tag === 'a' && !href ? 'span'
      : tag === 'strike' ? 's'
      : tag;
    output.push(createElement(
      element,
      { key: index, className, ...(href ? { href } : {}) },
      renderLegacyChildren(child, messages, childMode),
    ));
  }

  output.push(<Fragment key="end">{renderLegacyText(text, mode, messages)}</Fragment>);
  return output;
}

function renderBody(content: string, legacyHtml: boolean, messages: boolean): ReactNode[] {
  if (legacyHtml && /<[a-z/!]|&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(content)) {
    const template = document.createElement('template');
    template.innerHTML = content;
    return renderLegacyChildren(template.content, messages);
  }
  return renderMarkup(content, messages);
}

interface SchulportalTextProps {
  content: string;
  legacyHtml?: boolean;
  messages?: boolean;
  className?: string;
}

export default function SchulportalText({
  content,
  legacyHtml = false,
  messages = false,
  className = 'text-sm leading-relaxed text-surface-700 dark:text-surface-300',
}: SchulportalTextProps) {
  const body = useMemo(() => renderBody(content, legacyHtml, messages), [content, legacyHtml, messages]);
  return (
    <div className={clsx('min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]', className)}>
      {body}
    </div>
  );
}
