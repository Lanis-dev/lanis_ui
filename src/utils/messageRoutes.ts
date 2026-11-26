export function conversationPath(id: string) {
  return `/messages/${encodeURIComponent(id)}`;
}

export function legacyMessagePath(searchParams: URLSearchParams): string | null {
  const conversation = searchParams.get('conversation');
  if (conversation) return conversationPath(conversation);
  if (searchParams.get('compose') !== '1') return null;
  const params = new URLSearchParams(searchParams);
  params.delete('compose');
  return params.size ? `/messages/draft?${params}` : '/messages/draft';
}

export function messagesReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/messages')) return null;
  try {
    const url = new URL(value, 'https://lanis.invalid');
    if (url.origin !== 'https://lanis.invalid' || !/^\/messages(?:\/[^/]+)?\/?$/.test(url.pathname)) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
