// The arithmetic a NumberField takes: + - * / and parentheses, with the usual precedence and a unary
// minus ("62+5", "0.2*0.8", "-(3+1)/2"). A small recursive-descent reader, not eval; anything it
// can't read gives null.

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

/** The value of the expression, or null when it isn't one (or isn't finite: a divide by zero). */
export function evaluate(text: string): number | null {
  // comma decimals and the typographic operators, then no spaces
  if (/[\d.)]\s+[\d.(]/.test(text)) return null; // "1 2" is two numbers, not twelve
  const src = text.replace(/,/g, '.').replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  let at = 0;

  const primary = (): number | null => {
    if (src[at] === '(') {
      at++;
      const v = sum();
      if (v === null || src[at] !== ')') return null;
      at++;
      return v;
    }
    const m = NUMBER.exec(src.slice(at));
    if (!m) return null;
    at += m[0].length;
    return Number(m[0]);
  };
  const unary = (): number | null => {
    if (src[at] === '-' || src[at] === '+') {
      const sign = src[at++] === '-' ? -1 : 1;
      const v = unary();
      return v === null ? null : sign * v;
    }
    return primary();
  };
  const product = (): number | null => {
    let v = unary();
    while (v !== null && (src[at] === '*' || src[at] === '/')) {
      const op = src[at++];
      const r = unary();
      v = r === null ? null : op === '*' ? v * r : v / r;
    }
    return v;
  };
  function sum(): number | null {
    let v = product();
    while (v !== null && (src[at] === '+' || src[at] === '-')) {
      const op = src[at++];
      const r = product();
      v = r === null ? null : op === '+' ? v + r : v - r;
    }
    return v;
  }

  const v = src ? sum() : null;
  return v !== null && at === src.length && Number.isFinite(v) ? v : null;
}

/** What a NumberField reads: the expression, with the field's own unit allowed after it ("62%", "180°"). null when it isn't a number. */
export function parseNumber(text: string, unit?: string): number | null {
  let t = text.trim();
  if (unit && t.toLowerCase().endsWith(unit.toLowerCase())) t = t.slice(0, -unit.length).trim();
  return evaluate(t);
}
