// Page-number announcements for the capture screen. Pure module (tested with node --test).
// One photo is one page: `seq` is 0-based on the wire, pages are shown 1-based.

/**
 * Seqs of items that turned 'done' since the last call; marks them in `seen` so each page is
 * announced once.
 * @param {Set<string>} seen uploadIds already announced (mutated)
 * @param {{uploadId: string, seq: number, status: string}[]} items
 * @returns {number[]}
 */
export function newlyDone(seen, items) {
  const out = [];
  for (const item of items) {
    if (item.status === 'done' && !seen.has(item.uploadId)) {
      seen.add(item.uploadId);
      out.push(item.seq);
    }
  }
  return out;
}

/** 0-based seqs → "4–6" / "4, 6" / "1–2, 4" (1-based, sorted, runs folded). @param {number[]} seqs */
export function formatPageList(seqs) {
  const pages = [...new Set(seqs)].sort((a, b) => a - b).map((s) => s + 1);
  const parts = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j += 1;
    parts.push(j > i ? `${pages[i]}–${pages[j]}` : `${pages[i]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** 1-based page numbers not uploaded yet. @param {{seq: number, status: string}[]} items */
export function pendingPages(items) {
  return items.filter((i) => i.status !== 'done').map((i) => i.seq + 1).sort((a, b) => a - b);
}
