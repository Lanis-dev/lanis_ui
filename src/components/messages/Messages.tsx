import { capture } from '../../analytics/client';
import * as Popover from '@radix-ui/react-popover';
import { ConversationSkeleton } from '../shared/ModuleLoadingSkeletons';
import { useCachedState } from '../../hooks/useCachedState';
import { readPersonalCache, writePersonalCache } from '../../utils/accountDataWrites';
import { MessagesListSkeleton } from '../shared/LoadingSkeletons';
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useBasePath } from '../../contexts/BasePathContext';
import { useBackNavigation } from '../../hooks/useBackNavigation';
import { messagesAPI } from '../../services/api';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { MessageHeader, Message, SearchResult, SendMessageRequest, ReplyMessageRequest } from '../../types';
import SEO from '../seo/SEO';
import SchulportalText from '../shared/SchulportalText';
import MessageComposer from './MessageComposer';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  XMarkIcon,
  UserIcon,
  InboxArrowDownIcon,
  UsersIcon,
  ChatBubbleLeftIcon,
  AcademicCapIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { format, parseISO, isValid, isToday, isYesterday, differenceInCalendarDays } from 'date-fns';
import { de } from 'date-fns/locale';
import clsx from 'clsx';
import { isDemoRoute, notifyDemoCacheWrite } from '../../utils/demoMode';
import { canWriteAccountData, captureAccountDataGeneration } from '../../utils/accountDataWrites';
import { conversationPath, legacyMessagePath } from '../../utils/messageRoutes';

const htmlToText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const document = new DOMParser().parseFromString(value, 'text/html');
  return (document.body.textContent || '').replace(/\s+/g, ' ').trim();
};

const displayName = (value: unknown, fallback = ''): string => htmlToText(value) || fallback;

const formatInboxDate = (value: string) => {
  const date = parseISO(value);
  if (!isValid(date)) return value;
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Gestern';
  const daysAgo = differenceInCalendarDays(new Date(), date);
  return format(date, daysAgo > 1 && daysAgo < 7 ? 'EEEEEE' : 'dd.MM.yy', { locale: de });
};

interface ConversationParticipant {
  id: string;
  name: string;
  role: string;
  type: 'sender' | 'recipient';
  class: string;
}

const Messages: React.FC = () => {
  const { token } = useAuth();
  const basePath = useBasePath();
  const inboxPath = `${basePath}/messages`;
  const draftPath = `${inboxPath}/draft`;
  const goBack = useBackNavigation(inboxPath);
  const { messageId } = useParams();
  const { key: locationKey } = useLocation();
  const [searchParams] = useSearchParams();
  const isDraft = messageId === 'draft';
  const selectedConversation = !isDraft && messageId ? messageId : null;
  const hasDetail = isDraft || !!selectedConversation;
  const [messages, setMessages, hasMessages] = useCachedState<MessageHeader[]>('messages', () => {
    try {
      const cached = isDemoRoute() ? null : readPersonalCache('messages_cache_v2');
      const parsed: unknown = cached ? JSON.parse(cached) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  const activeConversation = useRef<{ id: string; token: string } | null>(null);
  const [conversations, setConversations] = useCachedState<Record<string, Message[]>>('conversations', {});
  const savedConversation = selectedConversation ? conversations[selectedConversation] : undefined;
  const conversationMessages = Array.isArray(savedConversation) ? savedConversation : [];
  const [isLoading, setIsLoading] = useState(true);
  const conversationRequest = useRef(0);
  const [isConversationLoading, setIsConversationLoading] = useState(false);
  const [error, setError] = useState('');
  const [showParticipants, setShowParticipants] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');

  const [messageSearch, setMessageSearch] = useState('');
  const inbox = useRef<HTMLDivElement>(null);
  const inboxScroll = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    if (!hasDetail && inbox.current) inbox.current.scrollTop = inboxScroll.current;
  }, [hasDetail]);

  useEffect(() => {
    if (hasDetail) detailHeading.current?.focus({ preventScroll: true });
  }, [hasDetail, messageId]);

  const [composeData, setComposeData] = useState({
    recipients: [] as SearchResult[],
    subject: '',
    content: '',
  });
  const [recipientSearch, setRecipientSearch] = useState('');
  const recipientInput = useRef<HTMLInputElement>(null);
  const recipientPopup = useRef<HTMLDivElement>(null);
  const [showRecipientResults, setShowRecipientResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [recipientStatus, setRecipientStatus] = useState('');
  const [isSending, setIsSending] = useState(false);
  const activeDraft = useRef<{ key: string; close: () => void } | null>(null);
  const seededDrafts = useRef(new Set<string>());
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const savedReply = selectedConversation ? replyDrafts[selectedConversation] : undefined;
  const replyBody = typeof savedReply === 'string' ? savedReply : '';
  const [replyError, setReplyError] = useState<{ id: string; text: string } | null>(null);
  const [composeError, setComposeError] = useState('');
  const [conversationError, setConversationError] = useState('');
  const [isReplying, setIsReplying] = useState(false);

  useLayoutEffect(() => {
    activeDraft.current = isDraft ? { key: locationKey, close: goBack } : null;
    return () => { activeDraft.current = null; };
  }, [isDraft, locationKey, goBack]);

  const replyComposer = useRef<HTMLDivElement>(null);
  const replyPill = useRef<HTMLDivElement>(null);
  const messageHistory = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const composer = replyComposer.current;
    const history = messageHistory.current;
    const pill = replyPill.current;
    if (!composer || !history || !pill) return;

    const reserveComposerSpace = () => {
      const wasAtBottom = history.scrollHeight - history.clientHeight - history.scrollTop <= 1;
      const pillBounds = pill.getBoundingClientRect();
      const bottomInset = composer.offsetHeight - pillBounds.height / 2;
      history.style.setProperty('--reply-history-inset', `${bottomInset}px`);
      history.style.setProperty('--reply-history-overlap', `${composer.offsetHeight - bottomInset}px`);
      if (wasAtBottom) history.scrollTop = history.scrollHeight;
    };
    reserveComposerSpace();

    const observer = new ResizeObserver(reserveComposerSpace);
    observer.observe(composer);
    observer.observe(pill);
    return () => observer.disconnect();
  }, [selectedConversation, isConversationLoading, conversationError]);

  const USERNAME_CACHE_KEY = 'username_cache';
  const USERNAME_CACHE_TTL = 365 * 24 * 60 * 60 * 1000;

  const loadUsernameCache = (): Record<string, string> => {
    if (isDemoRoute()) return {};
    try {
      const raw = readPersonalCache(USERNAME_CACHE_KEY);
      if (!raw) return {};
      const parsed: { data: Record<string, string>; ts: number } = JSON.parse(raw);
      if (Date.now() - parsed.ts > USERNAME_CACHE_TTL) {
        localStorage.removeItem(USERNAME_CACHE_KEY);
        return {};
      }
      return parsed.data;
    } catch { return {}; }
  };

  const usernameCacheGeneration = useRef(captureAccountDataGeneration()).current;

  const saveUsernameCache = (data: Record<string, string>) => {
    const cachedUsername = JSON.stringify({ data, ts: Date.now() });
    notifyDemoCacheWrite(USERNAME_CACHE_KEY, cachedUsername);
    writePersonalCache(USERNAME_CACHE_KEY, cachedUsername, usernameCacheGeneration);
  };

  const usernameCache = useRef<Record<string, string>>(loadUsernameCache());

  const applyUsernameCache = (msgs: MessageHeader[]) => {
    if (Object.keys(usernameCache.current).length === 0) return msgs;
    return msgs.map(m => ({
      ...m,
      SenderName: m.SenderName || usernameCache.current[m.Sender] || m.Sender,
    }));
  };

  useEffect(() => {
    if (!token) return;
    const abortController = new AbortController();
    loadMessages(abortController.signal);
    return () => abortController.abort();
  }, [token]);

  useLayoutEffect(() => {
    setShowParticipants(false);
    setParticipantSearch('');
    if (!selectedConversation || !token) return;
    const controller = new AbortController();
    activeConversation.current = { id: selectedConversation, token };
    void loadConversation(selectedConversation, controller.signal);
    return () => {
      activeConversation.current = null;
      conversationRequest.current++;
      controller.abort();
    };
  }, [selectedConversation, token]);

  useEffect(() => {
    const recipientId = searchParams.get('recipient');
    if (!isDraft || !recipientId || seededDrafts.current.has(locationKey)) return;
    seededDrafts.current.add(locationKey);

    const recipient: SearchResult = {
      id: recipientId,
      name: searchParams.get('recipientName') || searchParams.get('recipientUsername') || 'Lehrkraft',
      username: searchParams.get('recipientUsername') || '',
      type: 'Lehrkraft',
    };
    setComposeData(previous => ({
      ...previous,
      recipients: previous.recipients.some(item => item.id === recipient.id)
        ? previous.recipients
        : [...previous.recipients, recipient],
    }));
  }, [isDraft, locationKey, searchParams]);

  useEffect(() => {
    if (!showParticipants) return;
    const onBack = (event: Event) => {
      event.preventDefault();
      closeParticipantsModal();
    };
    window.addEventListener('lanis:back', onBack, true);
    return () => window.removeEventListener('lanis:back', onBack, true);
  }, [showParticipants]);

  const loadMessages = async (signal?: AbortSignal, clearError = true) => {
    if (!token) return;
    const writeGeneration = captureAccountDataGeneration();
    try {
      if (clearError) setError('');
      const response = await messagesAPI.getMessageHeaders(token, 'All', 0, signal);
      if (signal?.aborted) return;
      if (response.success) {
        const transformedMessages = response.conversations.map((msg: any) => ({
          Id: msg.Id || msg.id,
          Uniquid: String(msg.id || msg.Uniquid || msg.Id),
          Sender: msg.sender || msg.Sender,
          SenderId: msg.sender || msg.Sender,
          SenderName: displayName(msg.SenderName, msg.sender || msg.Sender),
          Betreff: htmlToText(msg.Betreff),
          WeitereEmpfaenger: msg.WeitereEmpfaenger,
          private: msg.private || 0,
          empf: Array.isArray(msg.empf) ? msg.empf.map((recipient: unknown) => displayName(recipient)) : [],
          Papierkorb: msg.Papierkorb,
          unread: msg.unread === 1 || msg.unread === true,
          date: msg.date || msg.Datum || new Date().toISOString(),
        }));
        const resolved = applyUsernameCache(transformedMessages);
        setMessages(resolved);
        if (canWriteAccountData(writeGeneration)) {
          const cachedMessages = JSON.stringify(resolved);
          notifyDemoCacheWrite('messages_cache_v2', cachedMessages);
          writePersonalCache('messages_cache_v2', cachedMessages, writeGeneration);
        }
      } else {
        setError('Fehler beim Laden der Nachrichten.');
      }
      setIsLoading(false);
    } catch (error) {
      if (signal?.aborted || axios.isCancel(error)) return;
      console.error('Error loading messages:', error);
      setError('Fehler beim Laden der Nachrichten.');
      setIsLoading(false);
    }
  };

  const loadConversation = async (conversationId: string, signal?: AbortSignal) => {
    if (!token) return;
    const requestId = ++conversationRequest.current;
    setConversationError('');
    try {
      setIsConversationLoading(!Array.isArray(conversations[conversationId]));
      const response = await messagesAPI.getConversation(token, conversationId, 0, signal);
      if (requestId !== conversationRequest.current) return;
      if (response.success && response.messages) {
        const transformedMessages = response.messages.map((msg: any) => ({
          ...msg,
          id: msg.Id || msg.id,
          senderId: msg.username || msg.sender || msg.Sender || '',
          sender: displayName(msg.SenderName, msg.sender || msg.Sender || msg.username || 'Unbekannter Sender'),
          content: msg.Inhalt || msg.content || '',
          date: msg.Datum || msg.date || new Date().toISOString(),
          empf: typeof msg.empf === 'string' ? displayName(msg.empf) : msg.empf,
          WeitereEmpfaenger: displayName(msg.WeitereEmpfaenger),
        }));
        setConversations(current => ({ ...current, [conversationId]: transformedMessages }));
        void capture('message_read');
        setConversationError('');
      } else {
        if (response && typeof response === 'object' && 'error' in response) {
          if (response.error === 'No message data in response: {\'error\': \'-1\'}') {
            setConversationError('Diese Unterhaltung konnte nicht geladen werden. Möglicherweise ist sie nicht mehr verfügbar oder Sie haben keine Berechtigung.');
          } else {
            setConversationError(`Fehler beim Laden der Unterhaltung: ${response.error}`);
          }
        } else {
          setConversationError('Unbekannter Fehler beim Laden der Unterhaltung.');
        }
      }
    } catch (error: any) {
      if (requestId !== conversationRequest.current) return;
      console.error('Error loading conversation:', error);
      if (error?.response?.status === 404) {
        setConversationError('Unterhaltung nicht gefunden.');
      } else if (error?.response?.status === 401) {
        setConversationError('Nicht berechtigt, diese Unterhaltung zu laden.');
      } else {
        setConversationError('Fehler beim Laden der Unterhaltung. Bitte versuchen Sie es später erneut.');
      }
    } finally {
      if (requestId === conversationRequest.current) {
        setIsConversationLoading(false);
        void loadMessages(signal, false);
      }
    }
  };

  useEffect(() => {
    const query = recipientSearch.trim();
    if (!isDraft || !token || !query) return;
    const controller = new AbortController();
    setRecipientStatus('Suche läuft …');
    const timeout = window.setTimeout(async () => {
      try {
        const response = await messagesAPI.searchRecipients(token, query, controller.signal);
        if (controller.signal.aborted) return;
        if (response.success) {
          setSearchResults(response.results);
          setRecipientStatus('');
        } else {
          setRecipientStatus('Empfänger konnten nicht geladen werden.');
        }
      } catch {
        if (!controller.signal.aborted) setRecipientStatus('Empfänger konnten nicht geladen werden.');
      }
    }, 200);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isDraft, recipientSearch, token]);

  const updateRecipientSearch = (value: string) => {
    setRecipientSearch(value);
    setSearchResults([]);
    setRecipientStatus(value.trim() ? 'Suche läuft …' : '');
  };

  const addRecipient = (recipient: SearchResult) => {
    setComposeData(prev => prev.recipients.some(r => r.id === recipient.id)
      ? prev
      : { ...prev, recipients: [...prev.recipients, recipient] });
    updateRecipientSearch('');
    recipientInput.current?.focus();
  };

  const removeRecipient = (recipientId: string) => {
    setComposeData(prev => ({
      ...prev,
      recipients: prev.recipients.filter(r => r.id !== recipientId)
    }));
  };

  const discardDraft = () => {
    setComposeData({ recipients: [], subject: '', content: '' });
    updateRecipientSearch('');
    setComposeError('');
    goBack();
  };

  const sendMessage = async () => {
    if (!token || isSending || composeData.recipients.length === 0 || !composeData.subject.trim() || !composeData.content.trim()) {
      return;
    }
    try {
      setIsSending(true);
      setComposeError('');
      const messageRequest: SendMessageRequest = {
        recipients: composeData.recipients.map(r => r.id),
        subject: composeData.subject,
        body: composeData.content,
      };
      const response = await messagesAPI.sendMessage(token, messageRequest);
      if (response.success) {
        void capture('message_sent');
        setComposeData(current => ({
          recipients: current.recipients.filter(recipient => !messageRequest.recipients.includes(recipient.id)),
          subject: '',
          content: '',
        }));
        seededDrafts.current.clear();
        updateRecipientSearch('');
        const draft = activeDraft.current;
        if (draft?.key === locationKey) draft.close();
        void loadMessages();
      } else {
        setComposeError('Nachricht konnte nicht gesendet werden. Versuche es erneut.');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setComposeError('Nachricht konnte nicht gesendet werden. Versuche es erneut.');
    } finally {
      setIsSending(false);
    }
  };

  const sendReply = async () => {
    if (!token || !selectedConversation || isReplying || !replyBody.trim()) return;
    const failure = { id: selectedConversation, text: 'Antwort konnte nicht gesendet werden. Versuche es erneut.' };
    setReplyError(null);
    try {
      setIsReplying(true);
      const replyRequest: ReplyMessageRequest = {
        conversation_id: selectedConversation,
        body: replyBody,
        to: 'all',
      };
      const response = await messagesAPI.replyMessage(token, replyRequest);
      if (response.success) {
        void capture('message_replied');
        setReplyDrafts(current => {
          if (current[selectedConversation] !== replyBody) return current;
          const next = { ...current };
          delete next[selectedConversation];
          return next;
        });
        const active = activeConversation.current;
        if (active?.id === selectedConversation && active.token === token) {
          await loadConversation(selectedConversation);
        }
      } else {
        setReplyError(failure);
      }
    } catch (error) {
      console.error('Error sending reply:', error);
      setReplyError(failure);
    } finally {
      setIsReplying(false);
    }
  };

  const closeParticipantsModal = () => {
    setShowParticipants(false);
    setParticipantSearch('');
  };

  const formatDate = (dateString: string) => {
    try {
      const date = parseISO(dateString);
      return format(date, 'dd.MM.yyyy HH:mm', { locale: de });
    } catch {
      return dateString;
    }
  };



  const query = messageSearch.trim().toLocaleLowerCase('de-DE');
  const visibleMessages = messages.filter(message =>
    !query || [message.Betreff, message.SenderName || message.Sender, ...(message.empf || [])]
      .some(value => typeof value === 'string' && value.toLocaleLowerCase('de-DE').includes(query)),
  );
  const availableRecipients = searchResults.filter(result => !composeData.recipients.some(recipient => recipient.id === result.id));
  const canSend = !!(composeData.recipients.length && composeData.subject.trim() && composeData.content.trim());
  const recipientPopupOpen = showRecipientResults && !!recipientSearch.trim() && !isSending;

  if (!token) return null;

  const redirectedPath = !messageId && legacyMessagePath(searchParams);
  if (redirectedPath) return <Navigate to={basePath + redirectedPath} replace />;

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <SEO
        title="Nachrichten"
        description="Lanis Nachrichten — Kommuniziere mit Lehrkräften und Mitschülern über das Schulportal Hessen."
        path="/messages"
        noindex
      />
      <div className={`${hasDetail ? 'hidden lg:flex' : 'flex'} relative min-h-0 w-full lg:w-80 xl:w-1/3 border-r border-surface-100 dark:border-surface-800 flex-col bg-surface-50 dark:bg-surface-950 lg:bg-white lg:dark:bg-surface-900`}>
        <div className="shrink-0 md:shrink p-4 sm:p-6 lg:p-4 border-b border-surface-100 dark:border-surface-800">
          <div className="flex items-center justify-between mb-4">
            {isDraft ? <h2 className="page-title">Nachrichten</h2> : <h1 className="page-title">Nachrichten</h1>}
            <Link
              to={draftPath}
              replace={isDraft}
              aria-current={isDraft ? 'page' : undefined}
              className="btn btn-primary hidden h-9 px-3 text-xs md:inline-flex"
            >
              <PlusIcon className="h-4 w-4 mr-1.5" />
              Neue Nachricht
            </Link>
          </div>

          <div className="relative">
            <MagnifyingGlassIcon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500" />
            <input
              type="search"
              className="input pl-9"
              aria-label="Betreff, Absender oder Empfänger suchen"
              placeholder="Betreff, Absender, Empfänger"
              value={messageSearch}
              onChange={e => setMessageSearch(e.target.value)}
            />
          </div>
        </div>

        <div ref={inbox} onScroll={event => {
          if (event.currentTarget.clientHeight) inboxScroll.current = event.currentTarget.scrollTop;
        }} className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {error && (
            <div className="m-4 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 rounded-xl text-xs">
              {error}
            </div>
          )}

          {isLoading && !hasMessages && messages.length === 0 ? (
            <MessagesListSkeleton />
          ) : messages && messages.length === 0 ? (
            <div className="empty-state">
              <InboxArrowDownIcon className="empty-state-icon" />
              <h3 className="empty-state-title">Keine Nachrichten</h3>
              <p className="empty-state-text">
                Keine Nachrichten vorhanden.
              </p>
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="empty-state">
              <h3 className="empty-state-title">Keine Treffer</h3>
              <button type="button" className="btn btn-ghost mt-2" onClick={() => setMessageSearch('')}>
                Suche zurücksetzen
              </button>
            </div>
          ) : (
            <div className="divide-y divide-surface-100 dark:divide-surface-800">
              {visibleMessages.map(message => {
                const selected = selectedConversation === message.Uniquid;
                return (
                  <Link
                    to={basePath + conversationPath(message.Uniquid)}
                    replace={selected}
                    key={message.Uniquid}
                    aria-current={selected ? 'page' : undefined}
                    className={clsx(
                      'relative grid w-full grid-cols-[0.5rem_minmax(0,1fr)_auto] items-start gap-2.5 py-3 pl-[15px] pr-3 text-left transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500',
                      selected
                        ? 'bg-primary-50 before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary-500 dark:bg-primary-950/40'
                        : 'hover:bg-surface-100 dark:hover:bg-surface-800',
                    )}
                  >
                    <span className={clsx('mt-1.5 h-2 w-2 rounded-full', message.unread && 'bg-primary-600 dark:bg-primary-400')}>
                      {message.unread && <span className="sr-only">Ungelesen</span>}
                    </span>
                    <span className="min-w-0">
                      <span className={clsx('block truncate text-sm text-surface-900 dark:text-surface-100', message.unread ? 'font-semibold' : 'font-medium')}>
                        {message.Betreff || '(Ohne Betreff)'}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-surface-600 dark:text-surface-400">
                        {message.SenderName || message.Sender}
                      </span>
                    </span>
                    {message.date && (
                      <time className="whitespace-nowrap pt-0.5 text-xs tabular-nums text-surface-600 dark:text-surface-400" title={formatDate(message.date)}>
                        {formatInboxDate(message.date)}
                      </time>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        <Link
          to={draftPath}
          aria-label="Neue Nachricht"
          className="btn btn-primary absolute bottom-4 right-4 z-10 h-14 w-14 rounded-full p-0 shadow-soft-lg md:hidden"
        >
          <PlusIcon aria-hidden="true" className="h-6 w-6" />
        </Link>
      </div>

      <div className={`${hasDetail ? 'flex' : 'hidden lg:flex'} flex-1 flex-col min-h-0 min-w-0`}>
        {isDraft ? (
          <form aria-busy={isSending} className="flex min-h-0 flex-1 flex-col" onSubmit={event => {
            event.preventDefault();
            void sendMessage();
          }}>
            <header className="shrink-0 border-b border-surface-100 bg-white px-4 py-3 dark:border-surface-800 dark:bg-surface-900">
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  aria-label="Entwurf verwerfen"
                  title="Entwurf verwerfen"
                  onClick={discardDraft}
                  disabled={isSending}
                  className="btn btn-ghost h-10 w-10 shrink-0 p-0 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950 dark:hover:text-red-400"
                >
                  <TrashIcon aria-hidden="true" className="h-5 w-5" />
                </button>
                <h1 ref={detailHeading} tabIndex={-1} className="item-title min-w-0 outline-none">Neue Nachricht</h1>
                <button type="submit" disabled={isSending || !canSend} className="btn btn-primary ml-auto shrink-0 gap-2 px-3 disabled:opacity-50 sm:px-4">
                  <PaperAirplaneIcon aria-hidden="true" className="h-4 w-4" />
                  {isSending ? 'Wird gesendet …' : 'Senden'}
                </button>
              </div>
              {composeError && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{composeError}</p>}
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
              <div className="mx-auto flex min-h-full w-full min-w-0 max-w-3xl flex-col gap-5">
                <div>
                  <label className="label" htmlFor="message-recipients">Empfänger</label>
                  <Popover.Root open={recipientPopupOpen} onOpenChange={setShowRecipientResults}>
                    <Popover.Anchor className="relative">
                      <MagnifyingGlassIcon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500" />
                      <input
                        type="search"
                        id="message-recipients"
                        ref={recipientInput}
                        disabled={isSending}
                        placeholder="Namen suchen"
                        className="input message-recipient-input pl-9"
                        autoComplete="off"
                        aria-haspopup="dialog"
                        aria-controls={recipientPopupOpen ? 'message-recipient-results' : undefined}
                        value={recipientSearch}
                        onFocus={() => setShowRecipientResults(true)}
                        onClick={() => setShowRecipientResults(true)}
                        onChange={event => {
                          setShowRecipientResults(true);
                          updateRecipientSearch(event.target.value);
                        }}
                        onKeyDown={event => {
                          if (event.nativeEvent.isComposing) return;
                          if (event.key === 'ArrowDown' && recipientSearch.trim()) {
                            event.preventDefault();
                            if (recipientPopupOpen) recipientPopup.current?.querySelector('button')?.focus();
                            else setShowRecipientResults(true);
                          }
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            if (recipientPopupOpen && availableRecipients.length === 1) addRecipient(availableRecipients[0]);
                          }
                        }}
                      />
                    </Popover.Anchor>
                    <Popover.Portal>
                      <Popover.Content
                        ref={recipientPopup}
                        id="message-recipient-results"
                        aria-label="Empfängersuche"
                        data-input-popup
                        align="start"
                        sideOffset={-1}
                        collisionPadding={12}
                        hideWhenDetached
                        onOpenAutoFocus={event => event.preventDefault()}
                        onCloseAutoFocus={event => event.preventDefault()}
                        onInteractOutside={event => {
                          if (event.target === recipientInput.current) event.preventDefault();
                        }}
                        onEscapeKeyDown={() => recipientInput.current?.focus({ preventScroll: true })}
                        className="message-recipient-results z-40 max-h-[min(11rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] overflow-y-auto"
                      >
                        <p role="status" className="px-3 py-2.5 text-xs text-surface-600 empty:hidden dark:text-surface-400">
                          {recipientStatus || (availableRecipients.length === 0 ? 'Keine weiteren Empfänger gefunden.' : '')}
                        </p>
                        {availableRecipients.length > 0 && (
                          <ul aria-label="Suchergebnisse" className="divide-y divide-surface-100 dark:divide-surface-800">
                            {availableRecipients.map(result => (
                              <li key={result.id}>
                                <button type="button" disabled={isSending} onClick={() => addRecipient(result)} className="btn btn-ghost w-full items-center justify-start gap-3 rounded-none px-3 py-2 text-left">
                                  <UserIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-surface-500" />
                                  <span className="min-w-0 break-words">
                                    <span className="block">{result.name}</span>
                                    <span className="block text-xs text-surface-600 dark:text-surface-400">{result.username}</span>
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                  {composeData.recipients.length > 0 && (
                    <ul aria-label="Ausgewählte Empfänger" className="mt-2 flex flex-wrap gap-2">
                      {composeData.recipients.map(recipient => (
                        <li key={recipient.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-50 pl-3 text-sm font-medium text-primary-800 dark:bg-primary-950 dark:text-primary-200">
                          <span className="min-w-0 break-words">{recipient.name}</span>
                          <button
                            type="button"
                            disabled={isSending}
                            aria-label={`${recipient.name} entfernen`}
                            onClick={() => removeRecipient(recipient.id)}
                            className="btn btn-ghost h-8 w-8 shrink-0 rounded-full p-0"
                          >
                            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <label className="label" htmlFor="message-subject">Betreff</label>
                  <input
                    type="text"
                    className="input"
                    id="message-subject"
                    disabled={isSending}
                    value={composeData.subject}
                    onChange={event => setComposeData(previous => ({ ...previous, subject: event.target.value }))}
                    required
                  />
                </div>

                <div className="flex min-h-36 flex-1 flex-col">
                  <label className="label" htmlFor="message-content">Nachricht</label>
                  <MessageComposer
                    variant="draft"
                    inputId="message-content"
                    disabled={isSending}
                    value={composeData.content}
                    onChange={content => setComposeData(previous => ({ ...previous, content }))}
                  />
                </div>
              </div>
            </div>

          </form>
        ) : selectedConversation ? (
          <>
            <div className="shrink-0 md:shrink border-b border-surface-100 dark:border-surface-800 p-4 bg-white/80 dark:bg-surface-900/80 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    aria-label="Zurück"
                    onClick={goBack}
                    className="btn btn-ghost h-10 w-10 shrink-0 p-0 lg:hidden"
                  >
                    <ArrowLeftIcon className="h-5 w-5" />
                  </button>
                  <h2 ref={detailHeading} tabIndex={-1} className="item-title min-w-0 break-words outline-none">
                    {messages.find(m => m.Uniquid === selectedConversation)?.Betreff || 'Unterhaltung'}
                  </h2>
                </div>
                <button
                  onClick={() => setShowParticipants(true)}
                  className="btn btn-secondary h-8 px-3 text-xs flex-shrink-0"
                >
                  <UsersIcon className="h-3.5 w-3.5 mr-1.5" />
                  Teilnehmer
                </button>
              </div>
            </div>

            {isConversationLoading ? (
              <ConversationSkeleton />
            ) : conversationError ? (
              <div className="empty-state" role="alert">
                <p className="empty-state-text">{conversationError}</p>
                <button className="btn btn-secondary mt-3" onClick={() => loadConversation(selectedConversation)}>Erneut versuchen</button>
              </div>
            ) : (
              <div className="relative min-h-0 flex-1">
              <div
                ref={messageHistory}
                className="absolute inset-x-0 top-0 bottom-[var(--reply-history-inset,30px)] overflow-y-auto px-4 pt-4 pb-[calc(var(--reply-history-overlap,22px)+1rem)] sm:px-6"
              >
                <div className="mx-auto max-w-3xl space-y-3">
                  {conversationMessages.map((message, index) => {
                    const day = formatDate(message.date).split(' ')[0];
                    const previousDay = index > 0 ? formatDate(conversationMessages[index - 1].date).split(' ')[0] : '';
                    return (
                      <React.Fragment key={message.id}>
                        {day !== previousDay && (
                          <div className="flex items-center gap-3 py-2 text-xs text-surface-600 before:h-px before:flex-1 before:bg-surface-200 after:h-px after:flex-1 after:bg-surface-200 dark:text-surface-400 dark:before:bg-surface-700 dark:after:bg-surface-700">
                            {isToday(parseISO(message.date)) ? 'Heute' : isYesterday(parseISO(message.date)) ? 'Gestern' : day}
                          </div>
                        )}
                        <article className="card p-3 sm:p-4">
                          <div className="mb-2 flex items-baseline justify-between gap-3">
                            <h3 className="break-words text-sm font-semibold text-surface-900 dark:text-surface-100">{message.sender}</h3>
                            <time className="shrink-0 text-xs text-surface-600 dark:text-surface-400" title={formatDate(message.date)}>
                              {isValid(parseISO(message.date)) ? format(parseISO(message.date), 'HH:mm') : message.date}
                            </time>
                          </div>
                          <SchulportalText messages content={message.content} legacyHtml={Boolean(message.Inhalt)} />
                        </article>
                      </React.Fragment>
                    );
                  })}
                  {conversationMessages.length === 0 && <p className="empty-state-text py-6 text-center">Keine Nachrichten in dieser Unterhaltung.</p>}
                </div>
              </div>

              <div ref={replyComposer} className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-2 sm:px-6">
                <div className="relative mx-auto max-w-3xl">
                  {replyError?.id === selectedConversation && (
                    <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">{replyError.text}</p>
                  )}
                  <MessageComposer
                    key={selectedConversation}
                    variant="reply"
                    pillRef={replyPill}
                    value={replyBody}
                    onChange={body => setReplyDrafts(current => ({ ...current, [selectedConversation]: body }))}
                  >
                    <button
                      type="button"
                      onClick={sendReply}
                      aria-label={isReplying ? 'Antwort wird gesendet' : 'Antwort senden'}
                      disabled={isReplying || !replyBody.trim()}
                      className="btn btn-primary mb-1 h-9 w-9 shrink-0 rounded-full p-0 disabled:opacity-50"
                    >
                      {isReplying ? (
                        <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      ) : (
                        <ArrowUpIcon aria-hidden="true" className="h-5 w-5" />
                      )}
                    </button>
                  </MessageComposer>
                </div>
              </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <InboxArrowDownIcon className="mx-auto h-12 w-12 text-surface-300" />
              <p className="mt-3 text-sm text-surface-500 dark:text-surface-400">Wählen Sie eine Nachricht aus, um sie anzuzeigen</p>
            </div>
          </div>
        )}
      </div>

      {/* Participants modal */}
      {showParticipants && selectedConversation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-900/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-surface-900 rounded-2xl sm:rounded-2xl shadow-soft-lg max-w-md w-full max-h-[70vh] flex flex-col animate-scale-in mx-2 sm:mx-0 ring-1 ring-black/5 dark:ring-white/10">
            <div className="flex items-center justify-between p-5 border-b border-surface-100 dark:border-surface-700">
              <h3 className="item-title">Teilnehmer</h3>
              <button
                aria-label="Teilnehmer schließen"
                onClick={closeParticipantsModal}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 p-5 overflow-y-auto">
              {(() => {
                const conversationMessage = conversationMessages.find(msg => msg.statistik);
                const stats = conversationMessage?.statistik;
                const messageHeader = messages.find(m => m.Uniquid === selectedConversation);

                if (!stats && !messageHeader) {
                  return (
                    <div className="empty-state">
                      <UsersIcon className="empty-state-icon" />
                      <p className="empty-state-text">Keine Teilnehmerinformationen verfügbar</p>
                    </div>
                  );
                }

                const getAllParticipants = (): ConversationParticipant[] => {
                  const participants = new Map<string, ConversationParticipant>();
                  if (messageHeader?.Sender) {
                    const senderMessage = conversationMessages.find(msg =>
                      msg.Sender === messageHeader.Sender || msg.senderId === messageHeader.Sender
                    );
                    const senderName = displayName(
                      senderMessage?.SenderName || messageHeader.SenderName,
                      senderMessage?.sender || messageHeader.Sender,
                    );
                    const senderRole = senderMessage?.SenderArt || 'Absender';
                    participants.set(messageHeader.Sender, {
                      id: messageHeader.Sender,
                      name: senderName,
                      role: senderRole,
                      type: 'sender',
                      class: ''
                    });
                  }
                  if (messageHeader?.empf && Array.isArray(messageHeader.empf)) {
                    messageHeader.empf.forEach((recipient, index) => {
                      const cleanText = displayName(recipient);
                      if (!cleanText) return;
                      const match = cleanText.match(/^(.*?)\s*\(([^)]+)\)$/);
                      const name = match ? match[1].trim() : cleanText;
                      const className = match ? match[2].trim() : '';
                      const participantKey = `recipient-${name.toLocaleLowerCase('de-DE')}`;
                      participants.set(participantKey, {
                        id: participantKey,
                        name: name,
                        role: 'Teilnehmer',
                        type: 'recipient',
                        class: className
                      });
                    });
                  }
                  return Array.from(participants.values());
                };

                const allParticipants = getAllParticipants();
                const filteredParticipants = allParticipants.filter(participant =>
                  participantSearch === '' ||
                  participant.name.toLowerCase().includes(participantSearch.toLowerCase()) ||
                  (participant.class && participant.class.toLowerCase().includes(participantSearch.toLowerCase()))
                );
                const participantCounts = allParticipants.length > 0
                  ? allParticipants.reduce((counts, participant) => {
                    const role = participant.role.toLocaleLowerCase('de-DE');
                    if (role.includes('betreuer') || role.includes('lehrkraft')) counts.betreuer += 1;
                    else if (role.includes('eltern')) counts.eltern += 1;
                    else counts.teilnehmer += 1;
                    counts.gesamt += 1;
                    return counts;
                  }, { teilnehmer: 0, betreuer: 0, eltern: 0, gesamt: 0 })
                  : {
                    teilnehmer: Number(stats?.teilnehmer || 0),
                    betreuer: Number(stats?.betreuer || 0),
                    eltern: Number(stats?.eltern || 0),
                    gesamt: Number(stats?.teilnehmer || 0) + Number(stats?.betreuer || 0) + Number(stats?.eltern || 0),
                  };

                return (
<div className="space-y-4">
                      {(stats || allParticipants.length > 0) && (
                        <div className="bg-surface-50 dark:bg-surface-950/70 rounded-xl p-4 ring-1 ring-surface-100 dark:ring-surface-700/80">
                          <h4 className="text-xs font-semibold text-surface-700 dark:text-surface-200 mb-3 uppercase tracking-wider">Übersicht</h4>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 dark:bg-blue-400" />
                              <span className="text-surface-500 dark:text-surface-400">Teilnehmer:</span>
                              <span className="font-medium text-surface-900 dark:text-white">{participantCounts.teilnehmer}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-purple-500 dark:bg-purple-400" />
                              <span className="text-surface-500 dark:text-surface-400">Betreuer:</span>
                              <span className="font-medium text-surface-900 dark:text-white">{participantCounts.betreuer}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                              <span className="text-surface-500 dark:text-surface-400">Eltern:</span>
                              <span className="font-medium text-surface-900 dark:text-white">{participantCounts.eltern}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-surface-400 dark:bg-surface-500 ring-1 ring-surface-500/20 dark:ring-surface-300/20" />
                              <span className="text-surface-500 dark:text-surface-400">Gesamt:</span>
                              <span className="font-medium text-surface-900 dark:text-white">{participantCounts.gesamt}</span>
                            </div>
                          </div>
                        </div>
                      )}

                    <div>
                      <label className="label dark:text-surface-200">Teilnehmer suchen</label>
                      <input
                        type="text"
                        placeholder="Name oder Klasse eingeben..."
                        className="input text-sm"
                        value={participantSearch}
                        onChange={(e) => setParticipantSearch(e.target.value)}
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-semibold text-surface-700 dark:text-surface-200">Alle Teilnehmer</h4>
                        <span className="text-[11px] text-surface-400 dark:text-surface-500">
                          {filteredParticipants.length} von {allParticipants.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {filteredParticipants.length === 0 && participantSearch !== '' ? (
                          <div className="text-center py-6">
                            <UserIcon className="mx-auto h-8 w-8 text-surface-300" />
                            <p className="mt-2 text-sm text-surface-500">Keine Teilnehmer gefunden</p>
                          </div>
                        ) : (
                          filteredParticipants.map((participant, index) => {
                            let roleColor = 'bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300';
                            let IconComponent = UserIcon;
                            if (participant.type === 'sender') {
                              roleColor = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20';
                            } else {
                              roleColor = 'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300 dark:ring-1 dark:ring-inset dark:ring-blue-400/20';
                              IconComponent = UserIcon;
                            }
                            if (participant.role.toLocaleLowerCase('de-DE').includes('betreuer')) {
                              roleColor = 'bg-purple-100 text-purple-700 dark:bg-purple-400/15 dark:text-purple-300 dark:ring-1 dark:ring-inset dark:ring-purple-400/20';
                              IconComponent = AcademicCapIcon;
                            }
                            return (
                              <div key={participant.id} className="flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-800/70 rounded-xl ring-1 ring-transparent dark:ring-surface-700/60">
                                <div className="w-8 h-8 flex items-center justify-center bg-white dark:bg-surface-900 rounded-full shadow-soft dark:ring-1 dark:ring-surface-700">
                                  <IconComponent className="w-4 h-4 text-surface-600 dark:text-surface-300" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{participant.name}</p>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${roleColor}`}>
                                      {participant.role}
                                    </span>
                                    {participant.class && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
                                        {participant.class}
                                      </span>
                                    )}
                                    <span className="text-[10px] text-surface-400 dark:text-surface-500">
                                      {participant.type === 'sender' ? 'Absender' : 'Empfänger'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {(() => {
                      const firstMessage = conversationMessages[0];
                      const weitereEmpfaenger = displayName(firstMessage?.WeitereEmpfaenger);
                      if (weitereEmpfaenger && weitereEmpfaenger.trim() !== '') {
                        return (
                          <div>
                            <h4 className="text-xs font-semibold text-surface-700 dark:text-surface-300 mb-2">Weitere Empfänger</h4>
                            <div className="text-sm text-surface-600 dark:text-surface-400 bg-surface-50 dark:bg-surface-800 rounded-xl p-3">
                              {weitereEmpfaenger}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                );
              })()}
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default Messages;
