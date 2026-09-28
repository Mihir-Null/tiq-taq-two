/**
 * fonts.ts — registers the bundled web fonts with the FontFace API.
 *
 * The font files come from the @fontsource-variable npm packages and are
 * bundled by Vite (`?url` gives us the final asset URL — or an inline data
 * URL in the single-file build). We only register the Latin, Latin-extended
 * and Greek subsets we actually use (ψ, φ, …), so browsers download little.
 */

import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import interLatinExt from '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url';
import interGreek from '@fontsource-variable/inter/files/inter-greek-wght-normal.woff2?url';
import monoLatin from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url';
import monoGreek from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-greek-wght-normal.woff2?url';
import garaLatin from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-normal.woff2?url';
import garaLatinExt from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-ext-wght-normal.woff2?url';
import garaGreek from '@fontsource-variable/eb-garamond/files/eb-garamond-greek-wght-normal.woff2?url';
import garaItalic from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-italic.woff2?url';

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const GREEK = 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF';

interface Face {
  family: string;
  url: string;
  range: string;
  style?: 'normal' | 'italic';
}

const FACES: Face[] = [
  { family: 'Inter Variable', url: interLatin, range: LATIN },
  { family: 'Inter Variable', url: interLatinExt, range: LATIN_EXT },
  { family: 'Inter Variable', url: interGreek, range: GREEK },
  { family: 'JetBrains Mono Variable', url: monoLatin, range: LATIN },
  { family: 'JetBrains Mono Variable', url: monoGreek, range: GREEK },
  { family: 'EB Garamond Variable', url: garaLatin, range: LATIN },
  { family: 'EB Garamond Variable', url: garaLatinExt, range: LATIN_EXT },
  { family: 'EB Garamond Variable', url: garaGreek, range: GREEK },
  { family: 'EB Garamond Variable', url: garaItalic, range: LATIN, style: 'italic' },
];

export function registerFonts(): void {
  if (typeof FontFace === 'undefined') return;
  for (const f of FACES) {
    try {
      const face = new FontFace(f.family, `url(${f.url}) format('woff2')`, {
        weight: '100 900',
        style: f.style ?? 'normal',
        unicodeRange: f.range,
        display: 'swap',
      });
      document.fonts.add(face);
    } catch (err) {
      console.warn('font registration failed', f.family, err);
    }
  }
}
