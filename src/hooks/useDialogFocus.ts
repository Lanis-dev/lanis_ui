import { useEffect, useRef, type RefObject } from 'react';

const dialogs: HTMLElement[] = [];
const inertBackground = new Map<HTMLElement, boolean>();

function updateInertBackground() {
  const background = new Set<HTMLElement>();
  let branch = dialogs[dialogs.length - 1];
  while (branch?.parentElement && branch.parentElement !== document.body) {
    for (const sibling of branch.parentElement.children) {
      if (sibling !== branch && sibling instanceof HTMLElement) background.add(sibling);
    }
    branch = branch.parentElement;
  }
  for (const [element, original] of inertBackground) {
    if (background.has(element)) continue;
    element.inert = original;
    inertBackground.delete(element);
  }
  for (const element of background) {
    if (inertBackground.has(element)) continue;
    inertBackground.set(element, element.inert);
    element.inert = true;
  }
}

function controls(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]',
  )].filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
}

function focusDialog(dialog: HTMLElement) {
  (dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') || controls(dialog)[0] || dialog).focus();
}

/** Keep focus in the topmost dialog and restore the opener when it closes. */
export function useDialogFocus(active: boolean, ref: RefObject<HTMLElement>, onDismiss: () => void) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogs.push(dialog);
    updateInertBackground();
    focusDialog(dialog);
    const keydown = (event: KeyboardEvent) => {
      if (dialogs[dialogs.length - 1] !== dialog || event.defaultPrevented || document.querySelector('[data-input-popup]')) return;
      if (event.key === 'Escape') { event.preventDefault(); dismiss.current(); return; }
      if (event.key !== 'Tab') return;
      const items = controls(dialog);
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      const wasTop = dialogs[dialogs.length - 1] === dialog;
      dialogs.splice(dialogs.lastIndexOf(dialog), 1);
      updateInertBackground();
      if (!wasTop) return;
      const next = dialogs[dialogs.length - 1];
      if (opener !== document.body && opener?.isConnected && opener.getClientRects().length
          && !opener.closest('[inert]') && (!next || next.contains(opener))) {
        opener.focus();
      } else if (next) {
        focusDialog(next);
      } else {
        [...document.querySelectorAll<HTMLElement>('button[aria-label="Menü öffnen"], button[title="Abmelden"]')]
          .find(element => element.getClientRects().length > 0 && !element.closest('[inert]'))?.focus();
      }
    };
  }, [active, ref]);
}
