/**
 * Term.tsx — glossary words. A dotted word shows a one-line tooltip on hover;
 * clicking or tapping it opens a small card with the full explanation right
 * where you are. (It used to jump to the Codex — which threw away the game
 * you were in the middle of. The card links to the Codex in a new tab.)
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { GLOSSARY_BY_ID } from '../../tutorial/glossary.ts';
import { Icon } from './Icon.tsx';

/** The term card that is open (at most one), and the word it belongs to. */
const openTerm = signal<{ k: string; anchor: HTMLElement } | null>(null);

export function closeTermCard(): void {
  openTerm.value = null;
}

/** "Probability (Born rule)" → "probability (Born rule)": only the first letter shrinks. */
const inline = (term: string): string => term[0].toLowerCase() + term.slice(1);

export function Term({ k, children }: { k: string; children?: ComponentChildren }) {
  const g = GLOSSARY_BY_ID[k];
  if (!g) return <>{children}</>;
  const open = (anchor: HTMLElement) => {
    openTerm.value = openTerm.value?.anchor === anchor ? null : { k, anchor };
  };
  return (
    <span
      class="term"
      data-tip={`${g.term}: ${g.short}`}
      tabIndex={0}
      role="button"
      aria-haspopup="dialog"
      onClick={(e) => {
        e.stopPropagation();
        open(e.currentTarget as HTMLElement);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(e.currentTarget as HTMLElement);
        }
      }}
    >
      {children ?? inline(g.term)}
    </span>
  );
}

/** Rendered once by the app shell; shows the open term's card next to its word. */
export function TermCard() {
  const t = openTerm.value;
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Place the card below the word (or above it, if there's no room), and
  // follow the word when the page scrolls.
  useLayoutEffect(() => {
    if (!t) return;
    const place = () => {
      const c = card.current;
      if (!t.anchor.isConnected || !c) {
        openTerm.value = null;
        return;
      }
      const r = t.anchor.getBoundingClientRect();
      const w = c.offsetWidth;
      const h = c.offsetHeight;
      const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
      const top = r.bottom + h + 12 < window.innerHeight ? r.bottom + 8 : Math.max(8, r.top - h - 8);
      setPos({ left, top });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [t]);

  // Close on Escape or a click elsewhere.
  useEffect(() => {
    if (!t) return;
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!card.current?.contains(target) && !t.anchor.contains(target)) closeTermCard();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeTermCard();
        t.anchor.focus();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc);
    };
  }, [t]);

  if (!t) return null;
  const g = GLOSSARY_BY_ID[t.k];
  return (
    <div
      class="term-card"
      ref={card}
      role="dialog"
      aria-label={g.term}
      style={{ left: `${pos?.left ?? -9999}px`, top: `${pos?.top ?? -9999}px` }}
    >
      <div class="term-card-head">
        <strong>{g.term}</strong>
        <button class="icon-btn" onClick={closeTermCard} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </div>
      <p class="term-short">{g.short}</p>
      <p class="small">{g.game}</p>
      {g.math && <code class="term-math">{g.math}</code>}
      <a class="small" href={`#/learn?term=${t.k}`} target="_blank" rel="noopener">
        The physics behind it, in the Codex ↗
      </a>
    </div>
  );
}
