// Turn the raw bytes of a .ged file into a string.
// GEDCOM files come as UTF-8, UTF-16 ("UNICODE"), Windows-1252 ("ANSI"),
// Macintosh Roman or the old ANSEL character set used by GEDCOM 5.x.

const ANSEL_SPACING = {
  0xa1: 0x141,
  0xa2: 0xd8,
  0xa3: 0x110,
  0xa4: 0xde,
  0xa5: 0xc6,
  0xa6: 0x152,
  0xa7: 0x2b9,
  0xa8: 0xb7,
  0xa9: 0x266d,
  0xaa: 0xae,
  0xab: 0xb1,
  0xac: 0x1a0,
  0xad: 0x1af,
  0xae: 0x2bc,
  0xb0: 0x2bb,
  0xb1: 0x142,
  0xb2: 0xf8,
  0xb3: 0x111,
  0xb4: 0xfe,
  0xb5: 0xe6,
  0xb6: 0x153,
  0xb7: 0x2ba,
  0xb8: 0x131,
  0xb9: 0xa3,
  0xba: 0xf0,
  0xbc: 0x1a1,
  0xbd: 0x1b0,
  0xbe: 0x25a1,
  0xbf: 0x25a0,
  0xc0: 0xb0,
  0xc1: 0x2113,
  0xc2: 0x2117,
  0xc3: 0xa9,
  0xc4: 0x266f,
  0xc5: 0xbf,
  0xc6: 0xa1,
  0xc7: 0xdf,
  0xc8: 0x20ac,
  0xcd: 0x65,
  0xce: 0x6f,
  0xcf: 0xdf,
};

// Combining marks. In ANSEL they come before the base letter, in Unicode after it.
const ANSEL_COMBINING = {
  0xe0: 0x309,
  0xe1: 0x300,
  0xe2: 0x301,
  0xe3: 0x302,
  0xe4: 0x303,
  0xe5: 0x304,
  0xe6: 0x306,
  0xe7: 0x307,
  0xe8: 0x308,
  0xe9: 0x30c,
  0xea: 0x30a,
  0xeb: 0xfe20,
  0xec: 0xfe21,
  0xed: 0x315,
  0xee: 0x30b,
  0xef: 0x310,
  0xf0: 0x327,
  0xf1: 0x328,
  0xf2: 0x323,
  0xf3: 0x324,
  0xf4: 0x325,
  0xf5: 0x333,
  0xf6: 0x332,
  0xf7: 0x326,
  0xf8: 0x31c,
  0xf9: 0x32e,
  0xfa: 0xfe22,
  0xfb: 0xfe23,
  0xfe: 0x313,
};

export function decodeAnsel(bytes) {
  let out = '';
  let pending = '';
  for (const b of bytes) {
    if (ANSEL_COMBINING[b]) {
      pending += String.fromCodePoint(ANSEL_COMBINING[b]);
      continue;
    }
    const cp = b < 0x80 ? b : (ANSEL_SPACING[b] ?? 0xfffd);
    out += String.fromCodePoint(cp) + pending;
    pending = '';
  }
  return (out + pending).normalize('NFC');
}

function charsetFromHeader(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 8192));
  const m = head.match(/(?:^|[\r\n])\s*1\s+CHAR\s+([^\r\n]+)/);
  return m ? m[1].trim().toUpperCase() : null;
}

export function detectEncoding(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0x30 && bytes[1] === 0x00) return 'utf-16le';
  if (bytes[0] === 0x00 && bytes[1] === 0x30) return 'utf-16be';

  const charset = charsetFromHeader(bytes);
  switch (charset) {
    case 'ANSEL':
      return 'ansel';
    case 'ANSI':
    case 'WINDOWS-1252':
    case 'CP1252':
    case 'IBMPC':
    case 'IBM WINDOWS':
      return 'windows-1252';
    case 'MACINTOSH':
      return 'macintosh';
    case 'UNICODE':
      return 'utf-16le';
    default:
      // UTF-8, ASCII, missing CHAR (GEDCOM 7 is always UTF-8) or unknown.
      return isValidUtf8(bytes) ? 'utf-8' : 'windows-1252';
  }
}

function isValidUtf8(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** @param {ArrayBuffer|Uint8Array} buffer */
export function decodeGedcom(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const encoding = detectEncoding(bytes);
  const text = encoding === 'ansel' ? decodeAnsel(bytes) : new TextDecoder(encoding).decode(bytes);
  return { text: text.replace(/^﻿/, ''), encoding };
}
