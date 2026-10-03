// TS/TSX checks through the TypeScript parser, so comments never count and component props named
// `title` aren't mistaken for the DOM attribute (brief §2 rules 1, 2, 4 and 6).
import ts from 'typescript';
import { ALLOWED_CHARS, MAX_MS, codePoint, colourFunction, isNamedColour } from './values.mjs';

/** OS-drawn pickers and spinners (rule 6) */
const NATIVE_INPUTS = new Set(['number', 'color', 'date', 'datetime-local', 'month', 'week', 'time']);
/** `<title>` inside an SVG shows a native tooltip, like the attribute */
const NATIVE_TAGS = new Set(['select', 'datalist', 'title']);
/** keyframe keys WAAPI may use: the moving properties plus timing */
const WAAPI_KEYS = new Set(['transform', 'translate', 'scale', 'rotate', 'clipPath', 'offset', 'easing', 'composite']);
const MOTION_KEY = /^(transition|animation)/i;
/** JSX attributes and assignments that take a colour */
const COLOUR_SINKS = /^(fill|stroke|color|stopColor|floodColor|lightingColor|fillStyle|strokeStyle|shadowColor)$/;

/** JSX reads these entities as the characters, which the char allowlist must see (`&nbsp;` is U+00A0 on screen) */
const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi;
const NAMED_ENTITIES = { nbsp: 0xa0, middot: 0xb7, times: 0xd7, deg: 0xb0, hellip: 0x2026, ndash: 0x2013, mdash: 0x2014, lsquo: 0x2018, rsquo: 0x2019, ldquo: 0x201c, rdquo: 0x201d };
const decodeEntities = (s) =>
  s.replace(ENTITY, (m, e) => {
    const code = e[0] === '#' ? Number.parseInt(e[1].toLowerCase() === 'x' ? e.slice(2) : e.slice(1), e[1].toLowerCase() === 'x' ? 16 : 10) : NAMED_ENTITIES[e.toLowerCase()];
    return code === undefined ? m : String.fromCodePoint(code);
  });

const stringValue = (n) => (n && ts.isStringLiteralLike(n) ? n.text : null);
const propName = (n) => (n.name && (ts.isIdentifier(n.name) || ts.isStringLiteralLike(n.name)) ? n.name.text : null);

/**
 * Violations in one TS/TSX file. `scope` says which rules apply: { chars, colour, ui, main }.
 * Strings inside THEME_HEX (src/main/window.ts) are not colour violations; they are returned in
 * `themeHex` as { path: 'dark.page', value, line } for the caller to compare with tokens.css.
 */
export function checkTs(file, text, scope) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const themeHex = [];
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const add = (node, rule, msg, extraLines = 0) => out.push({ line: lineOf(node.getStart(sf)) + extraLines, rule, msg });

  const inThemeHex = (n) => {
    for (let p = n.parent; p; p = p.parent) if (ts.isVariableDeclaration(p)) return p.name.getText(sf) === 'THEME_HEX';
    return false;
  };
  const inStyleAttr = (obj) => {
    let p = obj.parent;
    while (p && (ts.isAsExpression(p) || ts.isParenthesizedExpression(p) || ts.isSatisfiesExpression(p))) p = p.parent;
    return !!p && ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent) && p.parent.name.getText(sf) === 'style';
  };
  // A bare word like 'black' is only a colour where CSS or a canvas reads it; elsewhere it can be
  // data (a CMYK plate key), so named colours count only in these places.
  const usedAsColour = (n) => {
    let p = n.parent;
    if (p && ts.isJsxExpression(p)) p = p.parent;
    if (ts.isJsxAttribute(p)) return COLOUR_SINKS.test(p.name.getText(sf));
    if (ts.isPropertyAssignment(p)) return inStyleAttr(p.parent);
    if (ts.isBinaryExpression(p) && ts.isPropertyAccessExpression(p.left)) return COLOUR_SINKS.test(p.left.name.text) || /(^|\.)style$/.test(p.left.expression.getText(sf));
    return ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === 'setProperty';
  };

  function checkText(node, text, isTemplatePart) {
    if (scope.chars) {
      const seen = new Set();
      let nl = 0;
      const shown = ts.isJsxText(node) || (ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent)) ? decodeEntities(text) : text;
      for (const ch of shown) {
        if (ch === '\n') nl++;
        if (ch > '\x7f' && !ALLOWED_CHARS.has(ch) && !seen.has(ch)) {
          seen.add(ch);
          add(node, 1, `non-ASCII "${ch}" (${codePoint(ch)}) is not in the allowlist`, nl);
        }
      }
    }
    if (scope.colour && !ts.isJsxText(node)) {
      const lit = colourFunction(text) ?? (!isTemplatePart && isNamedColour(text) && usedAsColour(node) ? text : null);
      if (lit && scope.main && inThemeHex(node)) {
        const key = propName(node.parent);
        const theme = propName(node.parent.parent.parent);
        themeHex.push({ path: `${theme}.${key}`, value: text, line: lineOf(node.getStart(sf)) });
      } else if (lit) add(node, 2, `colour literal ${lit} outside tokens.css`);
    }
  }

  function checkAnimate(call) {
    const [frames, timing] = call.arguments;
    const objs = frames && ts.isArrayLiteralExpression(frames) ? frames.elements : [frames];
    if (!objs.every((o) => o && ts.isObjectLiteralExpression(o))) add(call, 4, ".animate() keyframes can't be checked; write them as a literal");
    for (const o of objs.filter((o) => o && ts.isObjectLiteralExpression(o))) {
      for (const p of o.properties) if (!WAAPI_KEYS.has(propName(p))) add(p, 4, `.animate() animates ${propName(p) ?? p.getText(sf)}`);
    }
    const dur = timing && ts.isObjectLiteralExpression(timing) ? timing.properties.find((p) => propName(p) === 'duration')?.initializer : timing;
    if (!dur || !ts.isNumericLiteral(dur)) add(call, 4, ".animate() duration can't be checked; write it as a number");
    else if (Number(dur.text) > MAX_MS) add(call, 4, `.animate() runs ${dur.text}ms (max ${MAX_MS}ms)`);
  }

  function visit(node) {
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) checkText(node, node.text, false);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) checkText(node, node.text, true);

    if (scope.ui && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
      const tag = node.tagName.getText(sf);
      if (/^[a-z]/.test(tag)) {
        if (NATIVE_TAGS.has(tag)) add(node, 6, `<${tag}> draws an OS popup; use the shared Select or Tooltip`);
        for (const a of node.attributes.properties) {
          if (!ts.isJsxAttribute(a)) continue;
          const name = a.name.getText(sf);
          if (name === 'title') add(a, 6, 'title attribute draws an OS tooltip; use <Tooltip>');
          if (tag === 'input' && name === 'type') {
            const v = stringValue(a.initializer) ?? (a.initializer && ts.isJsxExpression(a.initializer) ? stringValue(a.initializer.expression) : null);
            if (v === null) add(a, 6, "input type can't be checked; write it as a string");
            else if (NATIVE_INPUTS.has(v)) add(a, 6, `<input type="${v}">; use NumberField or the shared pickers`);
          }
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const obj = node.expression.expression.getText(sf);
      if (scope.main && name === 'popup') add(node, 6, 'Menu.popup draws an OS menu; use the shared context menu');
      if (scope.ui && name === 'setAttribute' && stringValue(node.arguments[0]) === 'title') add(node, 6, 'title attribute draws an OS tooltip; use <Tooltip>');
      if (scope.ui && /^(window|globalThis)$/.test(obj) && /^(alert|confirm|prompt)$/.test(name)) add(node, 6, `${obj}.${name}() draws an OS dialog`);
      if (scope.ui && name === 'animate') checkAnimate(node);
      if (scope.ui && name === 'setProperty' && MOTION_KEY.test(stringValue(node.arguments[0]) ?? '')) add(node, 4, 'inline motion style; declare it in a CSS module so it can be checked');
    }
    if (scope.ui && ts.isIdentifier(node) && node.text === 'startViewTransition') add(node, 4, 'startViewTransition is not allowed');
    if (scope.ui && ts.isPropertyAssignment(node)) {
      const key = propName(node) ?? '';
      if (MOTION_KEY.test(key) && inStyleAttr(node.parent)) add(node, 4, 'inline motion style; declare it in a CSS module so it can be checked');
      if (key === 'behavior' && stringValue(node.initializer) === 'smooth') add(node, 4, 'smooth scrolling animates the view');
    }
    if (scope.ui && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && MOTION_KEY.test(node.left.name.text) && /(^|\.)style$/.test(node.left.expression.getText(sf))) {
      add(node, 4, 'inline motion style; declare it in a CSS module so it can be checked');
    }
    if (scope.ui && ts.isStringLiteralLike(node) && /material-symbols-(rounded|outlined|sharp)/.test(node.text) && !file.endsWith('ui/Icon.tsx')) {
      add(node, 1, 'icon font class outside ui/Icon.tsx; render icons with <Icon>');
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { out, themeHex };
}
