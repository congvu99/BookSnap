// Pure helpers that turn the flat library list into Netflix-style rails (no Preact, node-testable).

export const UNSORTED_LABEL = 'Chưa phân loại';
export const RECENT_RAIL_MAX = 12;
const TOPIC_PREFIX = 'topic:';

const byCreatedDesc = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''));

/** Books of one topic rail ('' topic id -> 'unsorted'), plus the topic name. */
function topicRails(books) {
  const groups = new Map();
  for (const book of books) {
    const id = book.topic ? String(book.topic.id) : '';
    if (!groups.has(id)) groups.set(id, { key: `${TOPIC_PREFIX}${id || 'unsorted'}`, title: book.topic ? book.topic.name : UNSORTED_LABEL, books: [] });
    groups.get(id).books.push(book);
  }
  const named = [...groups.entries()].filter(([id]) => id !== '').map(([, rail]) => rail);
  named.sort((a, b) => a.title.localeCompare(b.title, 'vi', { sensitivity: 'base' }));
  return groups.has('') ? [...named, groups.get('')] : named;
}

/** All rails with their full book lists, in display order, empty ones omitted. */
function allRails(books, continuing, profileName) {
  const list = Array.isArray(books) ? books : [];
  const cont = (Array.isArray(continuing) ? continuing : []).filter((b) => b && b.progress);
  const name = profileName ? ` của ${profileName}` : '';
  const rails = [
    { key: 'continue', title: `Nghe tiếp${name}`, books: cont },
    { key: 'shelf', title: 'Kệ của tôi', books: list.filter((b) => b.on_shelf) },
    { key: 'recent', title: 'Mới thêm', books: [...list].sort(byCreatedDesc) },
    ...topicRails(list),
  ];
  return rails.filter((r) => r.books.length > 0);
}

/**
 * Rails for the library screen; "Mới thêm" is capped, the rest show everything.
 * @returns {{key: string, title: string, books: any[]}[]}
 */
export function buildRails(books, continuing, profileName) {
  return allRails(books, continuing, profileName).map((r) => (r.key === 'recent' ? { ...r, books: r.books.slice(0, RECENT_RAIL_MAX) } : r));
}

/** One rail with its full (uncapped) list for the browse screen, or null when unknown / empty. */
export function railByKey(books, continuing, profileName, key) {
  return allRails(books, continuing, profileName).find((r) => r.key === key) || null;
}

/** Whole minutes left to listen (rounded up), or null when unknown. */
export function remainingMinutes(book) {
  const total = book && book.chunks ? book.chunks.total : 0;
  if (!book || !book.duration_ms || !total) return null;
  const done = book.progress ? Math.min(total, book.progress.chunk_seq) / total : 0;
  return Math.max(1, Math.ceil((book.duration_ms * (1 - done)) / 60000));
}
