// IF A PERSON READS IT ON SCREEN, IT GOES THROUGH t().
//
// i18n.test.ts proves every key has English and Chinese. This proves the other half: that no
// on-screen text skips the dictionary. Without it, a new label written straight into JSX ships in
// English to a Chinese dsh and nothing notices until someone looks at the screen.
//
// Blunt on purpose. Each client component file is run through esbuild's TSX transpiler, which turns
// JSX into calls whose text children and props can be inspected structurally. Any literal
// with letters that sits where a person would read it (JSX text, a ternary among children, an
// aria-label, title, placeholder, alt or label prop) fails the gate unless ALLOWED below names it
// with a reason. Code that writes the DOM by hand (textContent, setAttribute on a label) is checked
// in the source the same way. A false positive costs one ALLOWED line; a false negative costs a
// reader English in a Chinese UI.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { transformSync } from "esbuild";
import ts from "typescript";

const transpile = (code: string): string => transformSync(code, {
  loader: "tsx", jsx: "automatic", format: "esm", target: "es2022", charset: "utf8",
}).code;

const DIR = fileURLToPath(new URL(".", import.meta.url));

/** Text allowed to reach the screen untranslated, each with the reason it stays as written. */
const ALLOWED = new Map<string, string>([
  ["Oh My Claude", "product name, and dsh's settings nav row is found by it"],
  ["MCP", "protocol name"],
  ["Stdio", "MCP transport identifier the CLI takes"],
  ["SSE", "MCP transport identifier the CLI takes"],
  ["HTTP", "MCP transport identifier the CLI takes"],
  ["settings.json", "file name"],
  ["CLAUDE.md", "file name"],
  ["Claude Code", "product name"],
  ["Headroom", "product name"],
  ["GitHub", "product name"],
  ["Notion", "product name"],
  ["Sentry", "product name"],
  ["Slack", "product name"],
  ["Stripe", "product name"],
  ["Asana", "product name"],
  ["HubSpot", "product name"],
  ["Tailscale", "product name"],
  ["Bash(npm run:*)", "permission-rule syntax example, typed as written"],
]);

/** One untranslated string, where it was found. */
interface Hit {
  file: string;
  line: number;
  text: string;
}

const LITERAL = /"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

/** Whether a literal reads as words a person sees: two letters in a row, and not a code token such
 *  as a data hook, CSS, a path or a URL. */
function looksLikeCopy(text: string): boolean {
  let s = text.trim();
  // A template's `${…}` parts are code; only the words around them are read.
  for (let prev = ""; prev !== s;) {
    prev = s;
    s = s.replace(/\$\{[^{}]*\}/g, " ").trim();
  }
  // A stylesheet written as a string (a rule body in braces) is CSS, not copy.
  if (/\{[^}]*:[^}]*\}/.test(s)) return false;
  if (!/[A-Za-z]{2}/.test(s)) return false;
  if (ALLOWED.has(s)) return false;
  // Code tokens: identifiers, hooks, CSS, paths, URLs, placeholders-only templates.
  if (/^[\w.:/@#~$-]+$/.test(s) && !/^[A-Z][a-z]+$/.test(s) && !/\s/.test(s)) return false;
  if (/^(https?:|\/|\.\/|~\/|data:|#|var\(|rgba?\(|calc\()/.test(s)) return false;
  if (/^\$\{[^}]*\}$/.test(s)) return false;
  return true;
}

/** One double-quoted or backtick string literal, as a regex source. */
const STR = '("(?:[^"\\\\]|\\\\.)*"|\\x60(?:[^\\x60\\\\]|\\\\.)*\\x60)';
/** A `t(...)` key, a comparison operand, or a string-method argument: literals code reads, not people. */
const CODE_LITERAL = new RegExp(
  `\\bt\\(\\s*${STR}|[!=]==?\\s*${STR}|${STR}\\s*[!=]==?|\\.(?:startsWith|endsWith|includes|indexOf|split|replace|replaceAll|match|test)\\(\\s*${STR}`,
  "g",
);

/** The literals on one transpiled line, after removing the ones only code reads (see CODE_LITERAL).
 *  A line of CSS written as a string yields none. */
function literalsOf(line: string): string[] {
  if (/@keyframes|@media|[a-z-]+:[^;{}"]+;/.test(line)) return [];
  const bare = line.replace(CODE_LITERAL, " ");
  return [...bare.matchAll(LITERAL)].map((m) => m[1] ?? m[2] ?? "");
}

/** Inspect JSX-runtime properties structurally: esbuild may put nested objects on one line. */
function scanJsx(file: string, input = readFileSync(join(DIR, file), "utf8")): Hit[] {
  const out = transpile(input);
  const source = ts.createSourceFile(file, out, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const hits: Hit[] = [];
  const visibleProps = new Set(["children", "aria-label", "aria-description", "title", "placeholder", "alt", "label"]);
  const collect = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (looksLikeCopy(node.text)) hits.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: node.text });
    } else if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach(collect);
    } else if (ts.isConditionalExpression(node)) {
      collect(node.whenTrue);
      collect(node.whenFalse);
    } else if (ts.isBinaryExpression(node)) {
      // Comparisons are program logic; logical operators may render their right-hand value.
      if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) collect(node.right);
      else if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) { collect(node.left); collect(node.right); }
    } else if (ts.isTemplateExpression(node)) {
      // Only the literal parts are UI copy; interpolated expressions are program data.
      const text = node.head.text + node.templateSpans.map((span) => span.literal.text).join(" ");
      if (looksLikeCopy(text)) hits.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text });
    } else if (ts.isParenthesizedExpression(node)) collect(node.expression);
    // Calls (including t()), objects (styles/props) and function bodies are not text children.
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
      if (visibleProps.has(name)) collect(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

/** Text written into the DOM by hand in any client file: `textContent`, `innerText`, `title` or
 *  `placeholder` assigned a literal, or a label attribute set to one. */
function scanDom(file: string): Hit[] {
  const hits: Hit[] = [];
  readFileSync(join(DIR, file), "utf8")
    .split("\n")
    .forEach((line, i) => {
      const assign = /\.(?:textContent|innerText|title|placeholder)\s*=\s*(["`].*)$/.exec(line);
      const attr = /setAttribute\(\s*"(?:aria-label|title|placeholder|alt)",\s*(["`].*)$/.exec(
        line,
      );
      for (const m of [assign, attr]) {
        if (!m) continue;
        for (const text of literalsOf(m[1]!))
          if (looksLikeCopy(text)) hits.push({ file, line: i + 1, text });
      }
    });
  return hits;
}

/** Phrases of two or more English words allowed outside t() anywhere in client code, each with the
 *  reason. Matched by prefix, since a few are long. */
const ALLOWED_PHRASES = new Map<string, string>([
  ["The user stepped away and is coming back", "the recap prompt, read by Claude, not a person"],
  ["markdown. Lead with the overall goal", "the recap prompt, read by Claude, not a person"],
  ["narrative, fix internals", "the recap prompt, read by Claude, not a person"],
  ["noreferrer noopener", "a link rel value"],
  ["Free space", "a CLI category name the code compares against"],
  ["Run this:", "the Run button's prompt, read by Claude, not a person"],
  ["MCP servers", "a CLI /usage group heading, the lookup key for its translation"],
  ["System prompt", "a CLI category name, the lookup key for its translation"],
  ["System tools", "a CLI category name, the lookup key for its translation"],
  ["MCP tools", "a CLI category name, the lookup key for its translation"],
  ["Custom agents", "a CLI category name, the lookup key for its translation"],
  ["Memory files", "a CLI category name, the lookup key for its translation"],
  ["no live Claude process", "a server error the code matches on"],
  ["inactive context", "a cordis error the code matches on"],
  ["Read Only", "dsh's preset label, matched in dsh's own menu"],
  ["Workspace Write", "dsh's preset label, matched in dsh's own menu"],
  ["Full access", "dsh's preset label, matched in dsh's own menu"],
  ["Access mode", "the start of dsh's shield aria-label, matched to find it"],
  ["last used", "a /skill-doctor column header the parser matches"],
  ["7d tokens", "a /skill-doctor column header the parser matches"],
  ["Claude Code", "product name"],
  ["Oh My Claude", "product name"],
  ["Bash(npm run:*)", "permission-rule syntax example, typed as written"],
]);

/** Phrases of two or more English words in any client file that sit outside t(): a helper that
 *  returns a sentence, a label kept in a variable, a table of messages. Logs, thrown errors,
 *  comparisons, selectors, CSS and dsh's own fallback dictionary in picker.tsx are skipped. */
function scanPhrases(file: string): Hit[] {
  const hits: Hit[] = [];
  const text = readFileSync(join(DIR, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  text.split("\n").forEach((raw, i) => {
    const line = raw.includes("://") ? raw : raw.replace(/\/\/.*$/, "");
    if (/console\.|\bdebug\(|new Error\(|throw /.test(line)) return;
    // picker.tsx mirrors dsh's own directory-browser dictionary as its no-locale fallback.
    if (basename(file) === "picker.tsx" && /^\s*"browser\.[\w]+":/.test(line)) return;
    if (basename(file) === "picker.tsx" && line.includes('|| "Add workspace"')) return;
    for (const lit of literalsOf(line)) {
      let s = lit.trim();
      for (let prev = ""; prev !== s;) {
        prev = s;
        s = s.replace(/\$\{[^{}]*\}/g, " ").trim();
      }
      if (!/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(s)) continue;
      if (/^(?:[a-z][\w]*-[\w-]+\s*){2,}$/.test(s)) continue; // CSS class lists
      if (/[[\]=^]|\{[^}]*:|--|var\(|color-mix|\d(px|fr|s|ms)\b|\b(ease|linear|forwards)\b/.test(s))
        continue;
      if ([...ALLOWED_PHRASES.keys()].some((k) => s.startsWith(k))) continue;
      hits.push({ file, line: i + 1, text: s });
    }
  });
  return hits;
}

// Recursive so a file under panel/ or cards/ is scanned too. The i18n dictionaries stay out:
// their values are the dictionary itself (i18n.test.ts checks those), and reading them here
// would flag every English value as text that skipped t().
const files = readdirSync(DIR, { recursive: true, encoding: "utf8" }).filter(
  (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|\.d\.ts$/.test(f) && !f.startsWith("i18n/"),
);
const hits = [
  ...files.filter((f) => f.endsWith(".tsx")).flatMap((file) => scanJsx(file)),
  ...files.flatMap(scanDom),
  ...files.flatMap(scanPhrases),
];

// The scanner itself: a planted English label is caught, a translated one and a hook are not.
{
  const found = scanJsx("planted.tsx",
    'const A = () => <div aria-label="Close it" data-omc-x="x" style={{margin: "4px 0"}} onClick={() => log("Handler data")}><i className="dsh-cm-row dsh-cm-back" />{t("a.b")}<b>Hello there</b>{n ? "two items" : t("c")}{tab === "Memory" && <i />}</div>;',
  ).map((hit) => hit.text);
  assert.ok(found.includes("Close it"), "a literal aria-label is caught");
  assert.ok(found.includes("Hello there"), "JSX text is caught");
  assert.ok(found.includes("two items"), "a literal in a ternary is caught");
  assert.ok(!found.includes("a.b") && !found.includes("x"), "t() keys and hooks are not");
  assert.ok(!found.includes("Memory"), "a comparison operand is not");
  assert.deepEqual(found.sort(), ["Close it", "Hello there", "two items"].sort(), "styles, classes and handlers are not visible copy");
}

assert.deepEqual(
  hits.map((h) => `${h.file}:${h.line} ${JSON.stringify(h.text)}`),
  [],
  "on-screen text that skips t(): route it through the dictionary, or add it to ALLOWED with a reason",
);
