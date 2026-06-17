const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function listFiles(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(listFiles(full));
    else if (entry.isFile() && full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function findCommentRanges(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  const ranges = [];
  const templateBraceStack = [];

  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (kind === ts.SyntaxKind.TemplateHead) {
      templateBraceStack.push(0);
    } else if (kind === ts.SyntaxKind.OpenBraceToken && templateBraceStack.length > 0) {
      templateBraceStack[templateBraceStack.length - 1]++;
    } else if (kind === ts.SyntaxKind.CloseBraceToken && templateBraceStack.length > 0) {
      if (templateBraceStack[templateBraceStack.length - 1] === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === ts.SyntaxKind.TemplateTail) {
          templateBraceStack.pop();
        }
        kind = scanner.scan();
        continue;
      } else {
        templateBraceStack[templateBraceStack.length - 1]--;
      }
    } else if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      ranges.push({ start: scanner.getTokenPos(), end: scanner.getTextPos() });
    }
    kind = scanner.scan();
  }

  return ranges;
}

function stripComments(text) {
  const ranges = findCommentRanges(text);
  if (ranges.length === 0) return text;

  for (let i = ranges.length - 1; i >= 0; i--) {
    const { start, end } = ranges[i];

    let lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = text.length;

    const before = text.slice(lineStart, start);
    const after = text.slice(end, lineEnd);

    if (before.trim() === '' && after.trim() === '') {
      const removeEnd = lineEnd < text.length ? lineEnd + 1 : lineEnd;
      text = text.slice(0, lineStart) + text.slice(removeEnd);
    } else if (after.trim() === '') {
      const trimmedBeforeEnd = lineStart + before.replace(/\s+$/, '').length;
      text = text.slice(0, trimmedBeforeEnd) + text.slice(lineEnd);
    } else {
      text = text.slice(0, start) + text.slice(end);
    }
  }

  return text;
}

const srcDir = path.join(__dirname, 'src');
const files = listFiles(srcDir);
let changed = 0;
for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  const stripped = stripComments(original);
  if (stripped !== original) {
    fs.writeFileSync(file, stripped, 'utf8');
    changed++;
  }
}
console.log(`Stripped comments in ${changed} files`);
