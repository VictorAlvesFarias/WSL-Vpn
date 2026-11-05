/** Lowercase, without accents: "Credencial" and "credêncial" are the same word. */
export const normalize = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Every word of the query appears somewhere in the texts, in any order ("work github" finds "Trabalho · github.com"). */
export function matches(query: string, ...texts: (string | null | undefined)[]): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize(texts.filter(Boolean).join(' '));
  return words.every((word) => haystack.includes(word));
}
