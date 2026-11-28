import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type Ref } from 'react';
import * as Popover from '@radix-ui/react-popover';
import clsx from 'clsx';
import {
  BoldIcon, CalendarIcon, ClockIcon, CodeBracketIcon, CommandLineIcon, EnvelopeIcon, EyeIcon,
  ItalicIcon, LinkIcon, ListBulletIcon, PaperClipIcon, PencilSquareIcon, PlusIcon, StrikethroughIcon, UnderlineIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import SchulportalText from '../shared/SchulportalText';
import { formatMessageDraft, type DraftFormat } from './formatMessageDraft';

const formats: { action: DraftFormat; label: string; icon: ReactNode }[] = [
  { action: 'bold', label: 'Fett', icon: <BoldIcon /> },
  { action: 'italic', label: 'Kursiv', icon: <ItalicIcon /> },
  { action: 'underline', label: 'Unterstreichen', icon: <UnderlineIcon /> },
  { action: 'strike', label: 'Durchstreichen', icon: <StrikethroughIcon /> },
  { action: 'bullets', label: 'Aufzählung', icon: <ListBulletIcon /> },
  { action: 'quote', label: 'Zitat', icon: <span className="text-lg leading-none">“</span> },
  { action: 'inlineCode', label: 'Code', icon: <CodeBracketIcon /> },
  { action: 'codeBlock', label: 'Codeblock', icon: <CommandLineIcon /> },
  { action: 'subscript', label: 'Tiefgestellt', icon: 'x₂' },
  { action: 'superscript', label: 'Hochgestellt', icon: 'x²' },
  { action: 'date', label: 'Datum einfügen', icon: <CalendarIcon /> },
  { action: 'time', label: 'Uhrzeit einfügen', icon: <ClockIcon /> },
  { action: 'url', label: 'Link einfügen', icon: <LinkIcon /> },
  { action: 'email', label: 'E-Mail-Adresse einfügen', icon: <EnvelopeIcon /> },
];

const toolButton = 'btn btn-ghost h-8 w-8 shrink-0 max-[359px]:w-7 rounded-lg p-0 focus-visible:ring-2 disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4';

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
} & (
  | { variant: 'draft'; inputId: string }
  | { variant: 'reply'; pillRef: Ref<HTMLDivElement>; children: ReactNode }
);

export default function MessageComposer(props: ComposerProps) {
  const { value, onChange, disabled } = props;
  const reply = props.variant === 'reply';
  const [formatting, setFormatting] = useState(false);
  const [preview, setPreview] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const firstTool = useRef<HTMLButtonElement>(null);
  const modeToggle = useRef<HTMLButtonElement>(null);
  const focusToolbar = useRef(false);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const previewSelection = useRef<{
    start: number;
    end: number;
    direction: HTMLTextAreaElement['selectionDirection'];
    scrollTop: number;
  } | null>(null);

  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    if (!selection) return;
    pendingSelection.current = null;
    input.current?.setSelectionRange(selection.start, selection.end);
  }, [value]);

  useLayoutEffect(() => {
    const field = input.current;
    const selection = previewSelection.current;
    if (preview || !field || !selection) return;

    previewSelection.current = null;
    if (formatting) field.focus({ preventScroll: true });
    field.setSelectionRange(selection.start, selection.end, selection.direction);
    field.scrollTop = selection.scrollTop;
  }, [preview, formatting]);

  function inputHasFocus() {
    const field = input.current;
    return field !== null && field.ownerDocument.activeElement === field;
  }

  function preserveInputFocus(event: PointerEvent<HTMLElement>) {
    if (event.button === 0 && inputHasFocus()) event.preventDefault();
  }

  function togglePreview() {
    const field = input.current;
    if (!preview && field) {
      previewSelection.current = {
        start: field.selectionStart,
        end: field.selectionEnd,
        direction: field.selectionDirection,
        scrollTop: field.scrollTop,
      };
      modeToggle.current?.focus({ preventScroll: true });
    }
    setPreview(!preview);
  }

  function applyFormat(action: DraftFormat) {
    const field = input.current;
    if (!field) return;
    const result = formatMessageDraft(value, field.selectionStart, field.selectionEnd, action);
    field.focus({ preventScroll: true });
    if (result.value === value) {
      field.setSelectionRange(result.start, result.end);
    } else {
      pendingSelection.current = result;
      onChange(result.value);
    }
  }

  function closeFormatting() {
    setFormatting(false);
    setPreview(false);
    if (!inputHasFocus()) more.current?.focus({ preventScroll: true });
  }

  return (
    <div className={reply ? undefined : 'flex min-h-0 flex-1 flex-col'}>
      {formatting && (
        <div
          role="group"
          aria-label="Nachricht formatieren"
          onPointerDownCapture={preserveInputFocus}
          className="pointer-events-auto mb-1.5 grid auto-rows-[2rem] grid-flow-row-dense grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] rounded-xl border border-surface-200 bg-white p-1 shadow-sm dark:border-surface-700 dark:bg-surface-900 max-[359px]:grid-cols-[repeat(auto-fill,minmax(1.75rem,1fr))]"
        >
          {formats.map(({ action, label, icon }, index) => (
            <button
              key={action}
              ref={index === 0 ? firstTool : undefined}
              type="button"
              aria-label={label}
              title={label}
              disabled={disabled || preview}
              className={clsx(toolButton, 'justify-self-center')}
              onClick={() => applyFormat(action)}
            >
              <span aria-hidden="true" className="font-semibold">{icon}</span>
            </button>
          ))}
          <div className="row-start-1 flex items-center justify-end gap-0.5 border-l border-surface-200 pl-1 [grid-column:-5/-1] dark:border-surface-700 max-[359px]:gap-0 max-[359px]:border-0 max-[359px]:pl-0 max-[359px]:[grid-column:-3/-1]">
            <button
              ref={modeToggle}
              type="button"
              title={preview ? 'Bearbeiten' : 'Vorschau'}
              className={clsx('btn btn-ghost h-8 gap-1.5 rounded-lg px-2 py-0 text-xs max-[359px]:w-7 max-[359px]:px-0', preview && 'bg-primary-50 text-primary-800 dark:bg-primary-950 dark:text-primary-200')}
              onClick={togglePreview}
            >
              {preview ? <PencilSquareIcon aria-hidden="true" className="h-4 w-4" /> : <EyeIcon aria-hidden="true" className="h-4 w-4" />}
              <span className="max-[359px]:sr-only">{preview ? 'Bearbeiten' : 'Vorschau'}</span>
            </button>
            <button type="button" aria-label="Formatierung schließen" title="Formatierung schließen" className={toolButton} onClick={closeFormatting}>
              <XMarkIcon aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      <div
        ref={reply ? props.pillRef : undefined}
        className={reply
          ? 'pointer-events-auto flex items-end gap-1 rounded-[1.5rem] bg-surface-100 px-1 text-sm text-surface-900 dark:bg-surface-800 dark:text-surface-100'
          : 'flex min-h-32 flex-1 items-start gap-2'}
      >
        <Popover.Root>
          <Popover.Trigger
            ref={more}
            type="button"
            aria-label="Nachrichtenaktionen"
            title="Nachrichtenaktionen"
            disabled={disabled}
            onPointerDown={preserveInputFocus}
            className="btn btn-ghost h-11 w-11 shrink-0 rounded-full p-0 focus:ring-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
          >
            <PlusIcon aria-hidden="true" className="h-5 w-5" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              data-input-popup
              aria-label="Nachrichtenaktionen"
              side="top"
              align="start"
              sideOffset={8}
              collisionPadding={12}
              className="z-50 w-48 rounded-xl border border-surface-200 bg-white p-1 shadow-soft-lg dark:border-surface-700 dark:bg-surface-900"
              onPointerDownCapture={preserveInputFocus}
              onOpenAutoFocus={event => {
                if (inputHasFocus()) event.preventDefault();
              }}
              onCloseAutoFocus={event => {
                const moveToToolbar = focusToolbar.current;
                focusToolbar.current = false;
                if (inputHasFocus()) {
                  event.preventDefault();
                  return;
                }
                if (!moveToToolbar) return;
                event.preventDefault();
                (preview ? modeToggle.current : firstTool.current)?.focus({ preventScroll: true });
              }}
            >
              <Popover.Close
                type="button"
                className="btn btn-ghost w-full justify-start gap-2 rounded-lg px-2.5 py-2"
                onClick={() => {
                  focusToolbar.current = !inputHasFocus();
                  setFormatting(true);
                }}
              >
                <BoldIcon aria-hidden="true" className="h-4 w-4" />
                Formatieren
              </Popover.Close>
              <button type="button" disabled className="btn w-full cursor-not-allowed justify-start gap-2 rounded-lg px-2.5 py-2 text-surface-500 opacity-60 dark:text-surface-400">
                <PaperClipIcon aria-hidden="true" className="h-4 w-4" />
                Datei hochladen
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <div className={clsx('relative min-w-0 flex-1', !reply && 'min-h-32 self-stretch')}>
          <textarea
            ref={input}
            id={reply ? undefined : props.inputId}
            rows={reply ? 1 : 5}
            hidden={preview}
            className={reply
              ? 'min-h-11 w-full max-h-36 resize-none bg-transparent py-3 leading-5 outline-none placeholder:text-surface-600 dark:placeholder:text-surface-400 [field-sizing:content] [vertical-align:top]'
              : 'input absolute inset-0 h-full resize-none leading-relaxed'}
            aria-label={reply ? 'Antwort schreiben' : undefined}
            placeholder={reply ? 'Antwort schreiben…' : undefined}
            value={value}
            onChange={event => onChange(event.target.value)}
            disabled={disabled}
            required={!reply && !preview}
          />
          {preview && (
            <div
              role="region"
              aria-label="Nachrichtenvorschau"
              tabIndex={0}
              className={reply
                ? 'min-h-11 max-h-36 overflow-y-auto rounded-lg py-3 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500'
                : 'input absolute inset-0 h-full overflow-y-auto leading-relaxed'}
            >
              {value.trim()
                ? <SchulportalText messages content={value} className={reply ? 'text-sm leading-5' : 'text-sm leading-relaxed'} />
                : <p className="text-sm leading-5 text-surface-500 dark:text-surface-400">Noch kein Text.</p>}
            </div>
          )}
        </div>
        {reply && props.children}
      </div>
    </div>
  );
}
