/* Avatar initials (#788).

   One rule for every avatar — the API computes it for stored names, the web
   editor's live preview computes it for the draft being typed — so the two can
   never disagree about what a name looks like.

   The old rule took `name[0]` of the first and last whitespace-separated word.
   That is a UTF-16 code UNIT, not a character and certainly not a letter, so a
   name such as "QA <User>" rendered "Q<", an emoji produced half a surrogate
   pair, and "<script>" came out as "<S".

   Only letters count. Everything else — punctuation, digits, symbols, emoji,
   the angle brackets of pasted markup — is skipped, never rendered.

     "Dhananjay Thomble"   → "DT"   first letter of first and last word
     "Ada Byron Lovelace"  → "AL"
     "Demo"                → "DE"   one word: its first two letters
     "QA <User>"           → "QU"
     "🎉 Ada"              → "AD"   a word with no letters does not count
     "" / "   " / "🎉"     → "?"    nothing to show */

// Stryker equivalence: the `^` and `$` anchors are not observable here. LETTER
// is only ever tested against a single code point produced by `for (const ch
// of word)` (see lettersOf), so the subject string is exactly one code point
// and `/\p{L}/u`, `/^\p{L}/u`, `/\p{L}$/u` and `/^\p{L}$/u` all give the same
// answer for every such input. Covered by the letter/non-letter cases in
// initials.test.ts (emoji, markup, combining marks, astral letters).
// Stryker disable next-line Regex: equivalent — the subject is always a single code point, so the ^/$ anchors cannot change the match.
const LETTER = /^\p{L}$/u;

/** Upper-cased code points of every letter in `word`, in order. */
function lettersOf(word: string): string[] {
  const out: string[] = [];
  // `for…of` walks code points, so an astral letter (or an emoji) is one step,
  // never half a surrogate pair.
  for (const ch of word) {
    if (!LETTER.test(ch)) continue;
    // "ß".toUpperCase() is "SS": keep one code point per letter so the result
    // stays two characters at most.
    out.push(Array.from(ch.toUpperCase())[0]!);
  }
  return out;
}

export function initialsOf(name: string): string {
  // Stryker equivalence: `/\s+/u` vs `/\s/u` is not observable. Splitting on a
  // single whitespace char leaves empty strings between runs of whitespace, but
  // lettersOf("") is [] and the `.filter(length > 0)` below drops every empty
  // word, so collapsing runs (`+`) or not produces the same word list. Covered
  // by the "  Grace   Hopper  " and tab/newline cases in initials.test.ts.
  // Stryker disable next-line Regex: equivalent — empty words from splitting on single whitespace are removed by the length>0 filter below.
  const words = name.split(/\s+/u)
    .map(lettersOf)
    .filter((letters) => letters.length > 0);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).join("");
  return words[0]![0]! + words[words.length - 1]![0]!;
}
