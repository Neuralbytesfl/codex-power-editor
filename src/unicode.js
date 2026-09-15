function isHighSurrogate(value) { return value >= 0xd800 && value <= 0xdbff; }
function isLowSurrogate(value) { return value >= 0xdc00 && value <= 0xdfff; }

export function codePointStart(text, index) {
  const offset = Math.max(0, Math.min(index, text.length));
  return offset > 0 && isLowSurrogate(text.charCodeAt(offset)) && isHighSurrogate(text.charCodeAt(offset - 1))
    ? offset - 1 : offset;
}

export function previousCodePoint(text, index) {
  return codePointStart(text, Math.max(0, index - 1));
}

export function nextCodePoint(text, index) {
  const start = codePointStart(text, index);
  return Math.min(text.length, start + (text.codePointAt(start) > 0xffff ? 2 : 1));
}
