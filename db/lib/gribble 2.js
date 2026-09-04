// The Literate cipher — how a written message looks to someone who cannot
// read. Used by the Bird's letters (docs/systemdocs/BIRD.md), and built to
// be reused by whatever coded documents come next.
//
// LEAF MODULE, ON PURPOSE: it requires nothing, so the web client can import
// it by path as `@lifeweb/db/lib/gribble`. Never add it to the @lifeweb/db
// barrel — that drags node:fs into the browser bundle.
//
// This is obfuscation, not cryptography: it defeats pen-and-paper analysis
// so a player without Literate can't read the letter, not someone with the
// source. Output is statistically flat (a XOR keystream, no spaces or word
// shapes) rather than a plain substitution cipher, which would leak word
// lengths and letter frequencies.

// 32 bytes, fixed for the life of the game. Changing it makes every message
// ever sent undecodable, so don't.
const KEY = [
  0x8f, 0x2c, 0xd1, 0x47, 0x0b, 0xa9, 0x63, 0xfe, 0x15, 0x8d, 0x3a, 0xc7, 0x52, 0xe0, 0x9b, 0x24,
  0x76, 0xbf, 0x08, 0xd5, 0x91, 0x4e, 0xa3, 0x2f, 0xcc, 0x61, 0x1d, 0xb8, 0x7a, 0xe6, 0x35, 0x50,
];

// 65 codepoints from the Runic block (U+16A0 onward): 64 symbols plus one pad.
// Runic is chosen for two reasons. It reads as "a script, and not one you know",
// which is exactly the fiction; and it sits in the BMP, so one rune is one
// UTF-16 unit and therefore one Discord character. An astral script like
// Deseret would double every length against Discord's 2000-char ceiling.
const ALPHABET = [];
for (let i = 0; i < 65; i++) ALPHABET.push(String.fromCharCode(0x16a0 + i));
const PAD = ALPHABET[64];

// Reverse lookup, built once.
const INDEX = new Map();
for (let i = 0; i < ALPHABET.length; i++) INDEX.set(ALPHABET[i], i);

// FNV-1a, truncated to 16 bits. Not a security check — it only has to make an
// accidental or hand-typed rune string fail to decode rather than produce
// garbage that looks like a message.
function checksum16(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ((h >>> 16) ^ h) & 0xffff;
}

// xorshift32 seeded from the nonce, with a key byte folded into every output.
// Flat enough that the ciphertext carries no usable structure, which is the
// whole requirement.
function keystream(nonce) {
  let state = (0x9e3779b9 ^ (nonce << 13)) >>> 0;
  for (let i = 0; i < KEY.length; i++) {
    state = (Math.imul(state ^ KEY[i], 0x01000193) + i) >>> 0;
  }
  let i = 0;
  return function nextByte() {
    state ^= (state << 13) >>> 0;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= (state << 5) >>> 0;
    state >>>= 0;
    return (((state >>> 24) ^ (state >>> 8)) ^ KEY[i++ % KEY.length]) & 0xff;
  };
}

// TextEncoder/TextDecoder rather than Buffer: this module runs in the browser
// too, and Buffer does not.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

// Encodes any string into runes. Returns "" for an empty string — a letter with
// no body is the caller's problem to reject, not this module's.
function encodeGribble(text) {
  if (typeof text !== "string" || text.length === 0) return "";

  const body = encoder.encode(text);
  const sum = checksum16(body);
  const plain = new Uint8Array(body.length + 2);
  plain.set(body, 0);
  plain[body.length] = (sum >>> 8) & 0xff;
  plain[body.length + 1] = sum & 0xff;

  // 16 bits of nonce, carried in the clear as the first three symbols so the
  // decoder can rebuild the same keystream.
  const nonce = Math.floor(Math.random() * 0x10000);
  const next = keystream(nonce);
  const cipher = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i++) cipher[i] = plain[i] ^ next();

  // The nonce goes through the same 6-bit packing as everything else, as two
  // bytes prepended to the ciphertext.
  const out = new Uint8Array(cipher.length + 2);
  out[0] = (nonce >>> 8) & 0xff;
  out[1] = nonce & 0xff;
  out.set(cipher, 2);

  return pack(out);
}

// Decodes runes back to the original string. Returns null for anything that
// isn't one of ours: a stray character, a truncated block, a failed checksum,
// or bytes that aren't valid UTF-8.
function decodeGribble(runes) {
  if (typeof runes !== "string") return null;
  const cleaned = clean(runes);
  if (cleaned.length === 0) return null;

  const out = unpack(cleaned);
  // 2 nonce + at least 1 body byte + 2 checksum.
  if (!out || out.length < 5) return null;

  const nonce = (out[0] << 8) | out[1];
  const next = keystream(nonce);
  const plain = new Uint8Array(out.length - 2);
  for (let i = 0; i < plain.length; i++) plain[i] = out[i + 2] ^ next();

  const body = plain.subarray(0, plain.length - 2);
  const sum = (plain[plain.length - 2] << 8) | plain[plain.length - 1];
  if (checksum16(body) !== sum) return null;

  try {
    return decoder.decode(body);
  } catch {
    return null;
  }
}

// Players paste what they were given, which in practice means the runes plus
// whatever Discord furniture came with them — the `»` prefix every DM carries,
// the `-#` footer telling them to find a reader, and any amount of stray
// whitespace or newlines. Everything that isn't in the alphabet is dropped,
// which handles all of it without asking the player to tidy up first.
function clean(runes) {
  let out = "";
  for (const ch of runes) if (INDEX.has(ch)) out += ch;
  return out;
}

// 3 bytes -> 4 six-bit symbols, with an explicit pad rune rather than an
// inferred length. Base64's own alphabet is skipped: going straight from
// six-bit groups to runes is the same operation with one fewer step to get
// wrong, and avoids btoa/Buffer differing between the browser and Node.
function pack(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const b0 = bytes[i];
    const b1 = remaining > 1 ? bytes[i + 1] : 0;
    const b2 = remaining > 2 ? bytes[i + 2] : 0;
    out += ALPHABET[b0 >>> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >>> 4)];
    out += remaining > 1 ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >>> 6)] : PAD;
    out += remaining > 2 ? ALPHABET[b2 & 0x3f] : PAD;
  }
  return out;
}

// Reverses pack(). Returns null on a length that could never have come out of
// it, so a hand-mangled block fails here rather than at the checksum.
function unpack(runes) {
  if (runes.length % 4 !== 0) return null;

  let padCount = 0;
  if (runes.length >= 1 && runes[runes.length - 1] === PAD) padCount++;
  if (runes.length >= 2 && runes[runes.length - 2] === PAD) padCount++;
  if (padCount > 2) return null;

  const groups = runes.length / 4;
  const out = new Uint8Array(groups * 3 - padCount);
  let o = 0;
  for (let i = 0; i < runes.length; i += 4) {
    const s0 = INDEX.get(runes[i]);
    const s1 = INDEX.get(runes[i + 1]);
    const s2 = INDEX.get(runes[i + 2]);
    const s3 = INDEX.get(runes[i + 3]);
    // A pad anywhere but the last two positions is not something pack() emits.
    if (s0 === undefined || s1 === undefined || s0 === 64 || s1 === 64) return null;
    if (s2 === undefined || s3 === undefined) return null;

    if (o < out.length) out[o++] = ((s0 << 2) | (s1 >>> 4)) & 0xff;
    if (s2 !== 64 && o < out.length) out[o++] = (((s1 & 0x0f) << 4) | (s2 >>> 2)) & 0xff;
    if (s3 !== 64 && o < out.length) out[o++] = (((s2 & 0x03) << 6) | s3) & 0xff;
  }
  return o === out.length ? out : null;
}

// True if a string looks like one of ours — used by the Read box to tell "you
// pasted something that isn't a message" apart from "this didn't decode".
function looksLikeGribble(text) {
  return typeof text === "string" && clean(text).length >= 4;
}

module.exports = { encodeGribble, decodeGribble, looksLikeGribble, GRIBBLE_ALPHABET: ALPHABET };
