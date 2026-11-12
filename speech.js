// Turn a speech-recognition transcript into a digit string. No DOM access.

const SMALL = {
  zero: 0, oh: 0, o: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, fore: 4,
  five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Returns a digit string such as "93", or null if no number is recognized. */
export function parseSpokenNumber(text) {
  if (typeof text !== 'string') return null;
  const t = text.toLowerCase().replace(/[,.!?]/g, ' ').trim();
  if (t === '') return null;

  // Recognizers usually return digits ("93"). "9 3" is joined; otherwise take the last number.
  if (/^[\d\s]+$/.test(t)) return String(Number(t.replace(/\s+/g, '')));
  const groups = t.match(/\d+/g);
  if (groups) return String(Number(groups[groups.length - 1]));

  const words = t.replace(/-/g, ' ').split(/\s+/).filter((w) => w && w !== 'and');
  let total = 0;
  let current = 0;
  let any = false;
  for (const w of words) {
    if (w in SMALL) { current += SMALL[w]; any = true; }
    else if (w in TENS) { current += TENS[w]; any = true; }
    else if (w === 'hundred') { current = (current || 1) * 100; any = true; }
    else if (w === 'thousand') { total += (current || 1) * 1000; current = 0; any = true; }
    else return null; // unknown word: do not guess
  }
  return any ? String(total + current) : null;
}
