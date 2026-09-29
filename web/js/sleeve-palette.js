// Picks one of five leather colours for a book's record sleeve. Hashing the id (FNV-1a) keeps a
// book's colour identical on every device and across reloads, with no column in the database.

export const SLEEVE_PALETTES = ['wine', 'moss', 'slate', 'amber', 'parchment'];

/** @param {string} id @returns {string} palette name */
export function sleevePalette(id) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return SLEEVE_PALETTES[hash % SLEEVE_PALETTES.length];
}

/** CSS custom properties consumed by .sleeve and .disc (web/css/vinyl.css). @param {string} id */
export function sleeveStyle(id) {
  const p = sleevePalette(id);
  return {
    '--cover-bg': `var(--sleeve-${p}-bg)`,
    '--cover-bg-deep': `var(--sleeve-${p}-deep)`,
    '--cover-ornament': `var(--sleeve-${p}-ornament)`,
    '--cover-ink': `var(--sleeve-${p}-ink)`,
  };
}
