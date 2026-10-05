/** Canonical subset: optional screen + one/two ANDed integer px width bounds. */
export function mailMediaMatches(query: string, width: number): boolean | null {
  const canonical = query.trim().toLowerCase().replace(/^(?:only\s+)?screen\s+and\s+/, "");
  const bounds = canonical.split(/\s+and\s+/);
  if (bounds.length < 1 || bounds.length > 2) return null;
  let matches = true;
  for (const bound of bounds) {
    const m = /^\(\s*(min|max)-width\s*:\s*([0-9]{1,4})px\s*\)$/.exec(bound);
    if (!m || Number(m[2]) > 2000) return null;
    matches &&= m[1] === "min" ? width >= Number(m[2]) : width <= Number(m[2]);
  }
  return matches;
}


/** Geometry only; never changes the canonical message/quote. */
export function mailDocumentScale(hostWidth: number, naturalWidth: number, mobile: boolean, original: boolean): number {
  return mobile && !original && hostWidth > 0 && naturalWidth > hostWidth ? hostWidth / naturalWidth : 1;
}
