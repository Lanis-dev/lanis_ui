import { capture } from '../../analytics/client';
import { ConversationSkeleton } from '../shared/ModuleLoadingSkeletons';
import { useCachedState } from '../../hooks/useCachedState';
import { readPersonalCache, writePersonalCache } from '../../utils/accountDataWrites';
import { MessagesListSkeleton } from '../shared/LoadingSkeletons';
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { messagesAPI } from '../../services/api';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { MessageHeader, Message, SearchResult, SendMessageRequest, ReplyMessageRequest } from '../../types';
import SEO from '../seo/SEO';
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
} from '@heroicons/react/24/outline';
import { format, parseISO, isValid, isToday, isYesterday, differenceInCalendarDays } from 'date-fns';
import { de } from 'date-fns/locale';
import clsx from 'clsx';
import { isDemoRoute, notifyDemoCacheWrite } from '../../utils/demoMode';
import { canWriteAccountData, captureAccountDataGeneration } from '../../utils/accountDataWrites';

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
  const [searchParams] = useSearchParams();
  const [messages, setMessages, hasMessages] = useCachedState<MessageHeader[]>('messages', () => {
    try {
      const cached = isDemoRoute() ? null : readPersonalCache('messages_cache_v2');
      const parsed: unknown = cached ? JSON.parse(cached) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const activeConversation = useRef<string | null>(null);
  const [conversations, setConversations] = useCachedState<Record<string, Message[]>>('conversations', {});
  const conversationMessages = selectedConversation ? conversations[selectedConversation] || [] : [];
  const [isLoading, setIsLoading] = useState(true);
  const conversationRequest = useRef(0);
  const [isConversationLoading, setIsConversationLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');

  const [messageSearch, setMessageSearch] = useState('');
  const inbox = useRef<HTMLDivElement>(null);
  const inboxScroll = useRef(0);

  useLayoutEffect(() => {
    if (!selectedConversation && inbox.current) inbox.current.scrollTop = inboxScroll.current;
  }, [selectedConversation]);

  if (!token) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-surface-900">Nicht authentifiziert</h3>
          <p className="text-surface-500">Bitte melden Sie sich an, um Nachrichten zu sehen.</p>
        </div>
      </div>
    );
  }

  const [composeData, setComposeData] = useState({
    recipients: [] as SearchResult[],
    subject: '',
    content: '',
  });
  const [recipientSearch, setRecipientSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const replyBody = selectedConversation ? replyDrafts[selectedConversation] || '' : '';
  const [replyError, setReplyError] = useState<{ id: string; text: string } | null>(null);
  const [composeError, setComposeError] = useState('');
  const [conversationError, setConversationError] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [attachmentToast, setAttachmentToast] = useState<{ conversation: string } | null>(null);

  useEffect(() => {
    if (!attachmentToast) return;
    const timeout = window.setTimeout(() => setAttachmentToast(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [attachmentToast]);

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
      const bottomInset = composer.getBoundingClientRect().bottom - (pillBounds.top + pillBounds.height / 2);
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
    return () => {
      abortController.abort();
      activeConversation.current = null;
      conversationRequest.current++;
    };
  }, [token]);

  useEffect(() => {
    const conversationId = searchParams.get('conversation');
    if (conversationId && token) {
      loadConversation(conversationId);
    }
  }, [searchParams, token]);

  useEffect(() => {
    const recipientId = searchParams.get('recipient');
    if (searchParams.get('compose') !== '1' || !recipientId) return;

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
    setShowCompose(true);
  }, [searchParams]);

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
          Uniquid: msg.id || msg.Uniquid,
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
      if (axios.isCancel(error)) return;
      console.error('Error loading messages:', error);
      setError('Fehler beim Laden der Nachrichten.');
      setIsLoading(false);
    }
  };

  const loadConversation = async (conversationId: string) => {
    if (!token) return;
    const requestId = ++conversationRequest.current;
    setConversationError('');
    if (inbox.current?.getClientRects().length) inboxScroll.current = inbox.current.scrollTop;
    try {
      setIsConversationLoading(conversations[conversationId] === undefined);
      activeConversation.current = conversationId;
      setSelectedConversation(conversationId);
      const response = await messagesAPI.getConversation(token, conversationId);
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
        void loadMessages(undefined, false);
      }
    }
  };

  const searchRecipients = async (query: string) => {
    if (!token || !query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      setIsSearching(true);
      const response = await messagesAPI.searchRecipients(token, query);
      if (response.success) {
        setSearchResults(response.results);
      }
    } catch (error) {
      console.error('Error searching recipients:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const addRecipient = (recipient: SearchResult) => {
    if (!composeData.recipients.some(r => r.id === recipient.id)) {
      setComposeData(prev => ({
        ...prev,
        recipients: [...prev.recipients, recipient]
      }));
    }
    setRecipientSearch('');
    setSearchResults([]);
  };

  const removeRecipient = (recipientId: string) => {
    setComposeData(prev => ({
      ...prev,
      recipients: prev.recipients.filter(r => r.id !== recipientId)
    }));
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
        setShowCompose(false);
        setComposeData({ recipients: [], subject: '', content: '' });
        await loadMessages();
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
        if (activeConversation.current === selectedConversation) await loadConversation(selectedConversation);
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

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <SEO
        title="Nachrichten"
        description="Lanis Nachrichten — Kommuniziere mit Lehrkräften und Mitschülern über das Schulportal Hessen."
        path="/messages"
        noindex
      />
      {/* Messages list - hidden on mobile when conversation is selected */}
      <div className={`${selectedConversation ? 'hidden lg:flex' : 'flex'} relative min-h-0 w-full lg:w-80 xl:w-1/3 border-r border-surface-100 dark:border-surface-800 flex-col bg-surface-50 dark:bg-surface-950 lg:bg-white lg:dark:bg-surface-900`}>
        <div className="shrink-0 md:shrink p-4 sm:p-6 lg:p-4 border-b border-surface-100 dark:border-surface-800">
          <div className="flex items-center justify-between mb-4">
            <h1 className="page-title">Nachrichten</h1>
            <button
              onClick={() => setShowCompose(true)}
              className="btn btn-primary hidden h-9 px-3 text-xs md:inline-flex"
            >
              <PlusIcon className="h-4 w-4 mr-1.5" />
              Neue Nachricht
            </button>
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

        <div ref={inbox} className="flex-1 overflow-y-auto pb-20 md:pb-0">
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
                  <button
                    type="button"
                    key={message.Uniquid}
                    aria-current={selected ? 'true' : undefined}
                    className={clsx(
                      'relative grid w-full grid-cols-[0.5rem_minmax(0,1fr)_auto] items-start gap-2.5 py-3 pl-[15px] pr-3 text-left transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500',
                      selected
                        ? 'bg-primary-50 before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary-500 dark:bg-primary-950/40'
                        : 'hover:bg-surface-100 dark:hover:bg-surface-800',
                    )}
                    onClick={() => loadConversation(message.Uniquid)}
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
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Neue Nachricht"
          onClick={() => setShowCompose(true)}
          className="btn btn-primary absolute bottom-4 right-4 z-10 h-14 w-14 rounded-full p-0 shadow-soft-lg md:hidden"
        >
          <PlusIcon aria-hidden="true" className="h-6 w-6" />
        </button>
      </div>

      {/* Conversation view - visible on mobile only when conversation selected */}
      <div className={`${selectedConversation ? 'flex' : 'hidden lg:flex'} flex-1 flex-col min-h-0 min-w-0`}>
        {selectedConversation ? (
          <>
            <div className="shrink-0 md:shrink border-b border-surface-100 dark:border-surface-800 p-4 bg-white/80 dark:bg-surface-900/80 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    aria-label="Zurück zum Posteingang"
                    onClick={() => {
                      activeConversation.current = null;
                      conversationRequest.current++;
                      setSelectedConversation(null);
                    }}
                    className="lg:hidden flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                  >
                    <ArrowLeftIcon className="h-5 w-5" />
                  </button>
                  <h2 className="item-title min-w-0 break-words">
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
                          <div
                            className="min-w-0 max-w-full whitespace-pre-line break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-surface-700 dark:text-surface-300 [&_a]:text-primary-600 dark:[&_a]:text-primary-400 [&_a:hover]:underline"
                            dangerouslySetInnerHTML={{ __html: message.content }}
                          />
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
                  <div role="status" className="pointer-events-none absolute inset-x-0 bottom-full mb-2 flex justify-center">
                    {attachmentToast?.conversation === selectedConversation && (
                      <span className="rounded-full bg-surface-900 px-3 py-1.5 text-xs font-medium text-surface-50 shadow-soft dark:bg-surface-100 dark:text-surface-900">
                        Coming soon™
                      </span>
                    )}
                  </div>
                  <div ref={replyPill} className="pointer-events-auto flex items-end gap-1 rounded-[1.5rem] bg-surface-100 px-1 text-sm text-surface-900 dark:bg-surface-800 dark:text-surface-100">
                    <button
                      type="button"
                      aria-label="Anhang hinzufügen"
                      onClick={() => setAttachmentToast({ conversation: selectedConversation })}
                      className="btn btn-ghost h-11 w-11 shrink-0 rounded-full p-0 focus:ring-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
                    >
                      <PlusIcon aria-hidden="true" className="h-5 w-5" />
                    </button>
                    <textarea
                      rows={1}
                      className="min-h-11 min-w-0 max-h-36 flex-1 resize-none bg-transparent py-3 leading-5 outline-none placeholder:text-surface-600 dark:placeholder:text-surface-400 [field-sizing:content]"
                      aria-label="Antwort schreiben"
                      placeholder="Antwort schreiben…"
                      value={replyBody}
                      onChange={e => {
                        const body = e.target.value;
                        setReplyDrafts(current => ({ ...current, [selectedConversation]: body }));
                      }}
                    />
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
                  </div>
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

      {/* Compose modal */}
      {showCompose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-900/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-surface-800 rounded-2xl sm:rounded-2xl shadow-soft-lg max-w-lg w-full max-h-[85vh] flex flex-col animate-scale-in mx-2 sm:mx-0">
            <div className="flex items-center justify-between p-5 border-b border-surface-100 dark:border-surface-800">
              <h3 className="item-title">Neue Nachricht</h3>
              <button
                aria-label="Neue Nachricht schließen"
                onClick={() => setShowCompose(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="label" htmlFor="message-recipients">Empfänger</label>
                <div className="space-y-2">
                  {composeData.recipients.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {composeData.recipients.map((recipient) => (
                        <span
                          key={recipient.id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800"
                        >
                          {recipient.name}
                          <button
                            aria-label={`${recipient.name} entfernen`}
                            onClick={() => removeRecipient(recipient.id)}
                            className="text-primary-400 dark:text-primary-500 hover:text-primary-600 dark:hover:text-primary-300"
                          >
                            <XMarkIcon className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="relative">
                    <input
                      type="text"
                      id="message-recipients"
                      placeholder="Empfänger suchen..."
                      className="input text-sm"
                      value={recipientSearch}
                      onChange={(e) => {
                        setRecipientSearch(e.target.value);
                        searchRecipients(e.target.value);
                      }}
                    />
                    {isSearching && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2">
                        <span className="w-3 h-3 rounded-full border-2 border-primary-300 border-t-primary-600 animate-spin block" />
                      </span>
                    )}
                  </div>
                  {searchResults.length > 0 && (
                    <div className="border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden">
                      {searchResults.map((result) => (
                        <button
                          key={result.id}
                          onClick={() => addRecipient(result)}
                          className="w-full text-left px-3.5 py-2.5 hover:bg-surface-50 dark:hover:bg-surface-800 border-b border-surface-100 dark:border-surface-700 last:border-b-0 transition-colors text-sm"
                        >
                          <div className="font-medium text-surface-900 dark:text-surface-100">{result.name}</div>
                          <div className="text-xs text-surface-500 dark:text-surface-400">{result.username}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="label" htmlFor="message-subject">Betreff</label>
                <input
                  type="text"
                  className="input text-sm"
                  id="message-subject"
                  value={composeData.subject}
                  onChange={(e) => setComposeData(prev => ({ ...prev, subject: e.target.value }))}
                />
              </div>

              <div>
                <label className="label" htmlFor="message-content">Nachricht</label>
                <textarea
                  rows={8}
                  className="input text-sm resize-none"
                  id="message-content"
                  value={composeData.content}
                  onChange={(e) => setComposeData(prev => ({ ...prev, content: e.target.value }))}
                />
              </div>
            </div>

            {composeError && <p role="alert" className="px-5 pb-3 text-sm text-red-600 dark:text-red-400">{composeError}</p>}
            <div className="flex items-center justify-end gap-3 p-5 border-t border-surface-100 dark:border-surface-800">
              <button
                onClick={() => setShowCompose(false)}
                className="btn btn-secondary h-9 text-xs"
              >
                Abbrechen
              </button>
              <button
                onClick={sendMessage}
                disabled={isSending || composeData.recipients.length === 0 || !composeData.subject.trim() || !composeData.content.trim()}
                className="btn btn-primary h-9 text-xs disabled:opacity-50"
              >
                {isSending ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Senden...
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <PaperAirplaneIcon className="h-3.5 w-3.5" />
                    Senden
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
