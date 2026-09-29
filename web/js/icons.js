// Lucide-style inline SVG icons (stroke 1.5, 24x24 viewbox). No emoji icons anywhere in the app.
import { html } from '../vendor/preact-htm.module.js';

/** @type {Record<string, string>} raw <path>/<g> markup per icon name, from lucide.dev (ISC license) */
const PATHS = {
  library: '<path d="M4 3h1v18H4zM9 3h1v18H9z"/><path d="M14.5 3.5l4 17-1 .2-4-17z"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.5"/>',
  headphones: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="17" y="14" width="4" height="6" rx="1"/><rect x="3" y="14" width="4" height="6" rx="1"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  play: '<path d="M7 5.5v13l11-6.5z"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  download: '<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
  'log-out': '<path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.5 5.2A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a15.6 15.6 0 0 1-3.1 4M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3.3-.6"/>',
  flashlight: '<path d="M8 2h8l-1 6H9z"/><path d="M9 8v11a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V8"/>',
  'flashlight-off': '<path d="M3 3l18 18M8 2h8l-1 6h-1M9 8v11a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4"/>',
  'book-open': '<path d="M12 7v13"/><path d="M5 5h6a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z"/><path d="M19 5h-6a2 2 0 0 0-2 2v13h6a2 2 0 0 0 2-2z"/>',
  'refresh-cw': '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/>',
  'more-vertical': '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  timer: '<path d="M10 2h4"/><path d="M12 14 15 11"/><circle cx="12" cy="14" r="8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  'chevrons-up-down': '<path d="m7 9 5-5 5 5M7 15l5 5 5-5"/>',
  'type-size': '<path d="M4 7V5h13v2"/><path d="M9 5v14M9 19H7m2 0h2"/><path d="M17 12v-2h5v2"/><path d="M19.5 10v9"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M6.5 12a5.5 5.5 0 0 1 5.5-5.5"/>',
  bookmark: '<path d="M6 3h12v18l-6-4.5L6 21z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
};

/**
 * Inline SVG icon.
 * @param {{name: string, size?: number, className?: string, title?: string}} props
 */
export function Icon({ name, size = 24, className = '', title }) {
  const inner = PATHS[name] || '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="${title ? 'false' : 'true'}" ${title ? `role="img"` : ''}>${title ? `<title>${title}</title>` : ''}${inner}</svg>`;
  return html`<span class=${`icon icon-${name} ${className}`} dangerouslySetInnerHTML=${{ __html: svg }}></span>`;
}
