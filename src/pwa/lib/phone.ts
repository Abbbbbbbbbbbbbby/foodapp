// Live-typing mask for a 10-digit US phone number: (480) 555-0199.
// Strip-and-reformat on every keystroke — the standard approach for this
// style of input; a caret-aware version would smooth backspacing near
// punctuation but isn't worth the extra complexity here.
export function formatPhoneAsTyped(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  const len = digits.length;
  if (len === 0) return '';
  if (len < 4) return `(${digits}`;
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
