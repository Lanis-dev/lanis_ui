import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SchulportalText from '../src/components/shared/SchulportalText';
import { formatMessageDraft } from '../src/components/messages/formatMessageDraft';

function render(content: string, messages = true) {
  return renderToStaticMarkup(createElement(SchulportalText, { content, messages }));
}

test('renders the Schulportal delimiters and combines decorations', () => {
  assert.match(render('**fett** __unterstrichen__ ~~kursiv~~ --entfernt--'),
    /<strong>fett<\/strong> <u>unterstrichen<\/u> <em>kursiv<\/em> <s>entfernt<\/s>/);
  assert.match(render('__--beides--__ --__beides__--'), /<u><s>beides<\/s><\/u> <s><u>beides<\/u><\/s>/);
  assert.match(render('Unvollständig **fett'), /Unvollständig \*\*fett/);
});

test('keeps the list, line breaks, and both script forms', () => {
  assert.match(render('Einleitung\r\n- H_2 O und H_(2)O\r\n- x^2 + x^(12)\r\nSchluss'),
    /Einleitung\n<ul[^>]*><li>H<sub>2<\/sub> O und H<sub>2<\/sub>O<\/li><li>x<sup>2<\/sup> \+ x<sup>12<\/sup><\/li><\/ul>Schluss/);
  assert.match(render('H_2 x^2'), /H<sub>2<\/sub> x\^2/);
});

test('renders code literally and decorates dates and times outside code', () => {
  const html = render('`**Text** 11:13`\n```\n- foo\n  <b>bar</b>\n```\n12.04.18 und 12.04.2018 um 11:13 Uhr oder 12:45');
  assert.match(html, /<code[^>]*>\*\*Text\*\* 11:13<\/code>/);
  assert.match(html, /<pre[^>]*><code[^>]*>- foo\n  &lt;b&gt;bar&lt;\/b&gt;<\/code><\/pre>/);
  assert.match(render('__12.04.2018__ __11:13 Uhr__'), /<u><span.*12\.04\.2018<\/span><\/u> <u><span.*11:13 Uhr<\/span><\/u>/);
  for (const text of ['12.04.18', '12.04.2018', '11:13 Uhr', '12:45']) {
    assert.ok(html.includes(`</svg>${text}</span>`));
  }
});

test('autolinks web and email addresses while leaving surrounding punctuation', () => {
  const html = render('**(https://example.com/A_(B)).** www.example.com ~~mia+kurs@example.com~~ --mia@example.com--');
  assert.match(html, /<strong>\(<a href="https:\/\/example\.com\/A_\(B\)"[^>]*>example\.com\/A_\(B\)<\/a>\)\.<\/strong>/);
  assert.match(html, /<a href="https:\/\/www\.example\.com\/"[^>]*>example\.com<\/a>/);
  assert.match(html, /<em><a href="mailto:mia\+kurs@example\.com"[^>]*>mia\+kurs@example\.com<\/a><\/em>/);
  assert.match(html, /<s><a href="mailto:mia@example\.com"[^>]*>mia@example\.com<\/a><\/s>/);
});

test('renders literal HTML as text and rejects links with embedded credentials', () => {
  const html = render('<b>Text</b> https://user@example.com/path');
  assert.match(html, /&lt;b&gt;Text&lt;\/b&gt; https:\/\/user@example\.com\/path/);
  assert.doesNotMatch(html, /<a\b|<b>/);
});

test('wraps selected text and puts the caret inside an empty format', () => {
  assert.deepEqual(formatMessageDraft('Hallo Klasse!', 6, 12, 'italic'), {
    value: 'Hallo ~~Klasse~~!',
    start: 8,
    end: 14,
  });
  assert.deepEqual(formatMessageDraft('x', 1, 1, 'superscript'), {
    value: 'x^()',
    start: 3,
    end: 3,
  });
  assert.deepEqual(formatMessageDraft('Hallo ~~Klasse~~!', 8, 14, 'italic'), {
    value: 'Hallo Klasse!',
    start: 6,
    end: 12,
  });
  const result = formatMessageDraft('Erste\n\nZweite', 0, 13, 'bold');
  assert.match(render(result.value), /<strong>Erste<\/strong>\n\n<strong>Zweite<\/strong>/);
});

test('formats complete list lines and leaves existing bullets and unselected lines alone', () => {
  assert.deepEqual(formatMessageDraft('ein Punkt\n- zwei\ndrei', 4, 17, 'bullets'), {
    value: '- ein Punkt\n- zwei\ndrei',
    start: 0,
    end: 18,
  });
  assert.deepEqual(formatMessageDraft('\nText', 0, 0, 'bullets'), { value: '- \nText', start: 2, end: 2 });
  const styled = formatMessageDraft('- eins\n- zwei', 0, 13, 'bold');
  assert.match(render(styled.value), /<li><strong>eins<\/strong><\/li><li><strong>zwei<\/strong><\/li>/);
});

test('makes code blocks from a selection and inserts editable automatic formats', () => {
  const result = formatMessageDraft('Probe: x = 2. Weiter.', 7, 12, 'codeBlock');
  assert.equal(result.value, 'Probe: \n```\nx = 2\n```\n. Weiter.');
  assert.equal(result.value.slice(result.start, result.end), 'x = 2');
  assert.match(render(result.value), /<pre[^>]*><code[^>]*>x = 2<\/code><\/pre>/);
  const now = new Date(2026, 10, 27, 11, 13);
  assert.equal(formatMessageDraft('', 0, 0, 'date', now).value, '27.11.2026');
  assert.equal(formatMessageDraft('', 0, 0, 'time', now).value, '11:13');
  assert.equal(formatMessageDraft('example.com', 0, 11, 'url').value, 'https://example.com');
  assert.equal(formatMessageDraft('', 0, 0, 'email').value, 'name@example.com');
});

test('documents quotes and no-space bullets in Nachrichten without changing lesson markup', () => {
  const source = '> **Antwort**\n> zweite Zeile\n-Ohne Leerzeichen\n--alter Termin--';
  const messages = render(source);
  assert.match(messages, /<blockquote[^>]*><strong>Antwort<\/strong>\nzweite Zeile<\/blockquote>/);
  assert.match(messages, /<li>Ohne Leerzeichen<\/li><\/ul><s>alter Termin<\/s>/);
  assert.doesNotMatch(render(source, false), /<blockquote|<ul/);
  const quote = formatMessageDraft('Erste\nZweite', 0, 12, 'quote');
  assert.equal(quote.value, '> Erste\n> Zweite');
  assert.match(render(quote.value), /<blockquote[^>]*>Erste\nZweite<\/blockquote>/);
});
