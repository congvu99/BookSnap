// Library as a jukebox list: each row is just the title beside a record whose picture carries the state
// (RecordArt); the full status is still spoken through aria-label. Groups get an index-card heading.
// Layout reference: docs/mockups/library-redesign-options.html (D · Hộp đĩa jukebox).
import { html, useRef } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';
import { remainingMinutes } from '../library-rails.js';
import { isPlayableKind, recordKind, spokenRecordStatus } from '../library-record-state.js';
import { RecordArt } from './library-record-art.js';
import { BUSY_PHASES, clampedBuildPercent, href, progressPercent, stateInfo, useRecordPress } from './library-crate.js';

/** Spoken status of a row (the screen shows it as a picture): who captured it plus what is left, or the build / error state. */
function rowStatusText(book, info) {
  if (info.phase !== 'ready') return spokenRecordStatus(book.created_by_name, info.label);
  let detail = '';
  if (book.progress) {
    const minutes = remainingMinutes(book);
    detail = minutes !== null ? `còn ${minutes} phút` : `đã nghe ${progressPercent(book)}%`;
  } else {
    const total = book.chunks ? book.chunks.total : 0;
    if (total) detail = `${total} đoạn`;
  }
  return spokenRecordStatus(book.created_by_name, detail);
}

/** @param {{ book: any, offline: boolean, buildPercents: Map<any, number> }} props */
function LibraryRecordRow({ book, offline, buildPercents }) {
  const info = stateInfo(book);
  const building = !offline && BUSY_PHASES.has(info.phase);
  const kind = recordKind(info.phase, progressPercent(book));
  const percent = building ? clampedBuildPercent(book, buildPercents) : progressPercent(book);
  const target = href(book, offline);
  const { opensPlayer, linkRef, handlers } = useRecordPress(book, target, '.disc');
  return html`
    <li>
      <a class=${`rrow${isPlayableKind(kind) ? '' : ' is-dim'}`} ref=${linkRef} href=${target} aria-label=${`${book.title}, ${rowStatusText(book, info)}`} ...${handlers}>
        <${RecordArt} book=${book} kind=${kind} percent=${percent} />
        <div class="rrow-title">${book.title}</div>
        <span class="rrow-action ${opensPlayer ? 'is-play' : ''}" aria-hidden="true"><${Icon} name=${opensPlayer ? 'play' : 'chevron-right'} size=${opensPlayer ? 16 : 18} /></span>
      </a>
    </li>
  `;
}

/**
 * Grouped record list. A group with an empty title is drawn without a heading.
 * @param {{ groups: {key: string, title: string, books: any[]}[], offline: boolean }} props
 */
export function LibraryRecordList({ groups, offline }) {
  const buildPercents = useRef(new Map());
  return html`${groups.map((group) => {
    const headingId = `group-${group.key.replace(/[^\w-]/g, '_')}`;
    return html`
      <section class="rgroup" key=${group.key} aria-labelledby=${group.title ? headingId : undefined} aria-label=${group.title ? undefined : 'Danh sách sách'}>
        ${group.title && html`<h2 class="rgroup-title" id=${headingId}>${group.title}<small>${group.books.length}</small></h2>`}
        <ul class="rlist">${group.books.map((b) => html`<${LibraryRecordRow} key=${b.id} book=${b} offline=${offline} buildPercents=${buildPercents.current} />`)}</ul>
      </section>
    `;
  })}`;
}

/** "Nghe tiếp" card: the most recently played book. @param {{ book: any }} props book from GET /api/me/continue */
export function LibraryNowPlaying({ book }) {
  const minutes = remainingMinutes(book);
  const percent = progressPercent(book);
  const { linkRef, handlers } = useRecordPress(book, `#/listen/${book.id}`, '.disc');
  const status = spokenRecordStatus(book.created_by_name, minutes !== null ? `còn ${minutes} phút` : '');
  const spoken = `Nghe tiếp ${book.title}${status ? `, ${status}` : ''}`;
  return html`
    <a class="lib-now" ref=${linkRef} href=${`#/listen/${book.id}`} aria-label=${spoken} ...${handlers}>
      <${RecordArt} book=${book} kind=${recordKind('ready', percent)} percent=${percent} />
      <div class="lib-now-text">
        <p class="eyebrow"><span class="lozenge" aria-hidden="true"></span>Nghe tiếp</p>
        <h2 class="lib-now-title">${book.title}</h2>
        <span class="lib-now-play" aria-hidden="true"><${Icon} name="play" size=${18} /></span>
      </div>
    </a>
  `;
}
