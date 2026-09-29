// Accent-insensitive text matching for Vietnamese search: "Đắc nhân tâm" matches "dac nhan tam".

/** Lowercase, strip combining marks (NFD) and map đ -> d. @param {string} s */
export function foldText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

/** True when every word of `query` occurs (folded) in `text`. Empty query matches everything. */
export function matchesQuery(text, query) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = foldText(text);
  return words.every((w) => hay.includes(w));
}
