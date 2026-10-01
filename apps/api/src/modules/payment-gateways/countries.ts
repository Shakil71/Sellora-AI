let byName: Map<string, string> | undefined;

function nameIndex(): Map<string, string> {
  if (byName) return byName;
  byName = new Map();
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        const name = names.of(code);
        if (name && name !== code) byName.set(name.toLowerCase(), code);
      }
    }
  } catch {
    // ICU data unavailable: only 2-letter codes are understood.
  }
  return byName;
}

/** "Bangladesh" / "bd" / "BD" -> "BD". Returns undefined when the country is unknown. */
export function toCountryCode(value?: string | null): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^[a-z]{2}$/i.test(v)) return v.toUpperCase();
  return nameIndex().get(v.toLowerCase());
}
