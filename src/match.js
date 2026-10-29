// Conservative lexical hints; these never authorize an action.
const STOP = new Set('a an the is are was were be been to of in on for and or but with by at from it its this that as not no never has have had do does did will would should can may must any all only'.split(' '));
const NEG = /\b(not|no|never|none|cannot|can't|won't|isn't|aren't|wasn't|don't|doesn't|didn't|without|unavailable|stopped|paused|cancelled|dropped|declined|blocked|hold off|on hold)\b/i;
// Deliberately small English suffix set for retrieval hints only. No fuzzy prefixes,
// irregular forms or broad -ing/-ed stripping that could merge unrelated words.
function stem(word) {
  if (!/^[a-z]+$/.test(word)) return word;
  if (word.length > 4 && word.endsWith('ies')) word = word.slice(0, -3) + 'y';
  else if (word.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(word)) word = word.slice(0, -2);
  else if (word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) word = word.slice(0, -1);
  if (word.length >= 8 && word.endsWith('ment')) word = word.slice(0, -4);
  return word;
}
export function tokens(text, { stemmed = false } = {}) {
  const words = text.toLowerCase().replace(/[’]/g, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu)?.filter((word) => !STOP.has(word)) || [];
  return new Set(stemmed ? words.map(stem) : words);
}
export function similarity(a, b, options) {
  const left = tokens(a, options), right = tokens(b, options);
  if (!left.size || !right.size) return 0;
  return [...left].filter((word) => right.has(word)).length / Math.max(left.size, right.size);
}
const numbers = (text) => (text.match(/[-+]?\d[\d,]*(?:\.\d+)?%?/g) || []).map((n) => n.replaceAll(',', '')).sort();
export function clashReason(a, b) {
  // Compare wording independently of the numbers whose values may conflict.
  const wording = (text) => text.replace(/[-+]?\d[\d,]*(?:\.\d+)?%?/g, ' ');
  if (similarity(wording(a), wording(b)) < 0.6) return null;
  if (NEG.test(a.replaceAll('’', "'")) !== NEG.test(b.replaceAll('’', "'"))) return 'negation flip';
  const left = numbers(a), right = numbers(b);
  if (left.length && right.length && JSON.stringify(left) !== JSON.stringify(right)) return 'numbers differ';
  return null;
}
export function lexicalMatches(action, entries) {
  const actionTokens = tokens(action, { stemmed: true });
  // One-token queries carry too little context to offer useful fallback hints.
  if (actionTokens.size < 2) return [];
  return entries.filter((entry) => entry.status !== 'superseded')
    .map((entry) => {
      const words = tokens(entry.claim, { stemmed: true });
      const shared = [...actionTokens].filter((word) => words.has(word)).length;
      return { ...entry, similarity: shared >= 2 ? shared / actionTokens.size : 0 };
    })
    .filter((match) => match.similarity >= 0.34)
    .sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || b.similarity - a.similarity);
}
