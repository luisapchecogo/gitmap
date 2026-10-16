/**
 * Creates an element. Text is always set through textContent: commit
 * messages, author names and ref names come from the repository and must
 * never be parsed as HTML.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

/** A codicon, e.g. `icon('git-branch')`. */
export function icon(name: string, extraClass = ''): HTMLSpanElement {
  const span = h('span', `codicon codicon-${name}${extraClass ? ` ${extraClass}` : ''}`);
  span.setAttribute('aria-hidden', 'true');
  return span;
}
