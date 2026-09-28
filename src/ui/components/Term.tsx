import type { ComponentChildren } from 'preact';
import { GLOSSARY_BY_ID } from '../../tutorial/glossary.ts';
import { navigate } from '../../app/router.ts';

/** A glossary word: dotted underline, tooltip on hover, click opens the Codex. */
export function Term({ k, children }: { k: string; children?: ComponentChildren }) {
  const g = GLOSSARY_BY_ID[k];
  if (!g) return <>{children}</>;
  return (
    <span
      class="term"
      data-tip={`${g.term}: ${g.short}`}
      tabIndex={0}
      role="link"
      onClick={() => navigate('/learn', { term: k })}
      onKeyDown={(e) => e.key === 'Enter' && navigate('/learn', { term: k })}
    >
      {children ?? g.term.toLowerCase()}
    </span>
  );
}
