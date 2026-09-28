import { Fragment, type ReactNode } from 'react';

/**
 * A tiny, safe Markdown renderer: builds React elements (never innerHTML),
 * so note text can't inject markup. Supports headings, lists, task lists,
 * quotes, **bold**, *italic*, `code`, ~~strike~~, #tags and http(s) links.
 */

const INLINE = /(\[\[[^\]]{1,120}\]\]|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+[^\s<.,;:!?)]|(?:^|(?<=\s))#[a-z][\w-]{0,30})/gi;

export function renderInline(text: string, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyBase}-${index++}`;
    // [[Note]] links render as real buttons — note cards must not nest them.
    if (token.startsWith('[[')) {
      const inner = token.slice(2, -2);
      const [title, alias] = inner.split('|');
      const trim = (value?: string) => (value ?? '').trim();
      out.push(
        <button
          key={key}
          type="button"
          className="note-link-pill"
          data-notelink={trim(title)}
          aria-label={`[[${trim(title)}]]`}
          onClick={(event) => event.preventDefault()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {trim(alias ?? title)}
        </button>,
      );
    }
    else if (token.startsWith('**') || token.startsWith('__')) out.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    else if (token.startsWith('~~')) out.push(<del key={key}>{token.slice(2, -2)}</del>);
    else if (token.startsWith('`')) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      out.push(parts ? <a key={key} href={parts[2]} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>{parts[1]}</a> : token);
    } else if (/^https?:\/\//i.test(token)) {
      out.push(<a key={key} href={token} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>{token.replace(/^https?:\/\//, '')}</a>);
    } else if (token.startsWith('#')) out.push(<span key={key} className="note-tag">{token}</span>);
    else out.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function extractTags(text: string): string[] {
  const tags = new Set<string>();
  for (const match of text.matchAll(/(?:^|\s)#([a-z][\w-]{0,30})/gi)) tags.add(match[1].toLowerCase());
  return [...tags];
}

export function Markdown({ text, limit }: { text: string; limit?: number }) {
  const lines = text.split('\n').slice(0, limit ?? Infinity);
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(<Tag key={`l${blocks.length}`}>{list.items}</Tag>);
    list = null;
  };
  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    const task = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (task || bullet || numbered) {
      const ordered = Boolean(numbered && !bullet);
      if (list && list.ordered !== ordered) flush();
      if (!list) list = { ordered, items: [] };
      list.items.push(
        task ? (
          <li key={index} className={task[1].trim() ? 'md-task is-done' : 'md-task'}>
            <span className="md-box" aria-hidden="true">{task[1].trim() ? '✓' : ''}</span>
            {renderInline(task[2], `t${index}`)}
          </li>
        ) : (
          <li key={index}>{renderInline((bullet?.[1] ?? numbered?.[1]) as string, `b${index}`)}</li>
        ),
      );
      return;
    }
    flush();
    if (!line.trim()) return;
    if (heading) {
      const level = heading[1].length;
      const Tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
      blocks.push(<Tag key={index}>{renderInline(heading[2], `h${index}`)}</Tag>);
    } else if (line.startsWith('>')) {
      blocks.push(<blockquote key={index}>{renderInline(line.replace(/^>\s?/, ''), `q${index}`)}</blockquote>);
    } else {
      blocks.push(<p key={index}>{renderInline(line, `p${index}`)}</p>);
    }
  });
  flush();
  return <Fragment>{blocks}</Fragment>;
}
