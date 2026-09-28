/**
 * tooltip.ts — one tooltip for the whole app.
 *
 * Any element with a `data-tip="…"` attribute gets a tooltip:
 *   • mouse: on hover,
 *   • keyboard: on focus,
 *   • touch: on a long press (~450 ms).
 * We use event delegation (listeners on `document`), so components only
 * have to add the attribute — no wrapper components or per-element state.
 */

let el: HTMLDivElement | null = null;
let current: HTMLElement | null = null;
let pressTimer: ReturnType<typeof setTimeout> | undefined;

function ensure(): HTMLDivElement {
  if (!el) {
    el = document.createElement('div');
    el.className = 'tooltip';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
  }
  return el;
}

function show(target: HTMLElement): void {
  const text = target.dataset.tip;
  if (!text) return;
  const tip = ensure();
  current = target;
  tip.textContent = text;
  tip.classList.add('show');
  const r = target.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  const margin = 8;
  let top = r.top - tr.height - margin;
  let below = false;
  if (top < 4) {
    top = r.bottom + margin;
    below = true;
  }
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));
  tip.style.top = `${top + window.scrollY}px`;
  tip.style.left = `${left + window.scrollX}px`;
  tip.classList.toggle('below', below);
}

export function hideTooltip(): void {
  current = null;
  el?.classList.remove('show');
}

const tipTarget = (e: Event): HTMLElement | null =>
  (e.target instanceof Element ? (e.target.closest('[data-tip]') as HTMLElement | null) : null);

export function installTooltips(): void {
  document.addEventListener('pointerover', (e) => {
    if ((e as PointerEvent).pointerType !== 'mouse') return;
    const t = tipTarget(e);
    if (t && t !== current) show(t);
    if (!t && current) hideTooltip();
  });
  document.addEventListener('pointerout', (e) => {
    const t = tipTarget(e);
    const to = (e as PointerEvent).relatedTarget as Element | null;
    if (t && (!to || !t.contains(to))) hideTooltip();
  });
  document.addEventListener('focusin', (e) => {
    const t = tipTarget(e);
    if (t && (t as HTMLElement).matches(':focus-visible')) show(t);
  });
  document.addEventListener('focusout', hideTooltip);
  document.addEventListener('pointerdown', (e) => {
    clearTimeout(pressTimer);
    hideTooltip();
    if ((e as PointerEvent).pointerType !== 'touch') return;
    const t = tipTarget(e);
    if (t) pressTimer = setTimeout(() => show(t), 450);
  });
  document.addEventListener('pointerup', () => clearTimeout(pressTimer));
  document.addEventListener('scroll', hideTooltip, true);
}
