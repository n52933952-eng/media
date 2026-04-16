const fs = require('fs');

const code = fs.readFileSync('src/Pages/MessagesPage.jsx', 'utf8');

// Simple (non-perfect) scanner to find unbalanced (), {}, [].
// Ignores content inside strings/templates/comments/regex to reduce false positives.
let stack = [];

function indexToLineCol(idx) {
  let line = 1;
  let col = 0;
  for (let i = 0; i < idx && i < code.length; i++) {
    if (code[i] === '\n') { line++; col = 0; } else { col++; }
  }
  return { line, col };
}

let i = 0;
let state = 'code'; // code | sq | dq | tpl | lineComment | blockComment | regex
let tplDepth = 0;

function push(ch, idx) {
  stack.push({ ch, idx });
}
function pop(expected) {
  if (stack.length === 0) return null;
  const top = stack[stack.length - 1];
  if (top.ch !== expected) return top; // mismatch
  stack.pop();
  return null;
}

while (i < code.length) {
  const ch = code[i];
  const next = code[i + 1];

  if (state === 'lineComment') {
    if (ch === '\n') state = 'code';
    i++;
    continue;
  }
  if (state === 'blockComment') {
    if (ch === '*' && next === '/') {
      state = 'code';
      i += 2;
      continue;
    }
    i++;
    continue;
  }

  if (state === 'sq') {
    if (ch === '\\') { i += 2; continue; }
    if (ch === '\'') state = 'code';
    i++;
    continue;
  }
  if (state === 'dq') {
    if (ch === '\\') { i += 2; continue; }
    if (ch === '"') state = 'code';
    i++;
    continue;
  }
  if (state === 'tpl') {
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') {
      tplDepth--;
      if (tplDepth <= 0) state = 'code';
      i++;
      continue;
    }
    i++;
    continue;
  }

  if (state === 'regex') {
    if (ch === '\\') { i += 2; continue; }
    if (ch === '/') { state = 'code'; i++; continue; }
    i++;
    continue;
  }

  // Enter comments
  if (ch === '/' && next === '/') { state = 'lineComment'; i += 2; continue; }
  if (ch === '/' && next === '*') { state = 'blockComment'; i += 2; continue; }

  // Enter strings/templates
  if (ch === '\'') { state = 'sq'; i++; continue; }
  if (ch === '"') { state = 'dq'; i++; continue; }
  if (ch === '`') { state = 'tpl'; tplDepth = 1; i++; continue; }

  // Enter regex (very approximate)
  if (ch === '/') {
    // Heuristic: previous non-space char that suggests regex start.
    // If last non-ws is one of (=:[,{;!&|?^~) then likely regex.
    let j = i - 1;
    while (j >= 0 && /\s/.test(code[j])) j--;
    const prev = code[j] || '';
    if (/[=(:,[!&|?^~{};]/.test(prev)) { state = 'regex'; i++; continue; }
  }

  // Track brackets
  if (ch === '(' || ch === '{' || ch === '[') {
    push(ch, i);
    i++;
    continue;
  }
  if (ch === ')' || ch === '}' || ch === ']') {
    const expected = ch === ')' ? '(' : ch === '}' ? '{' : '[';
    const mismatchTop = pop(expected);
    if (mismatchTop) {
      console.log('UNEXPECTED CLOSER', ch, 'at idx', i, 'mismatched with opener', mismatchTop.ch, 'at', mismatchTop.idx);
  const lcClose = indexToLineCol(i);
  const lcOpen = indexToLineCol(mismatchTop.idx);
  console.log('close at', JSON.stringify(lcClose), 'open at', JSON.stringify(lcOpen));
      break;
    }
    i++;
    continue;
  }

  i++;
}

if (stack.length === 0) {
  console.log('BALANCE_OK (by scanner)');
} else {
  console.log('UNBALANCED_OPENERS_LEFT:', stack.length);
  const top = stack[stack.length - 1];
  console.log('Last opener:', top.ch, 'at idx', top.idx);
  console.log('last opener line/col:', JSON.stringify(indexToLineCol(top.idx)));
  // Print a small snippet around the last opener
  const start = Math.max(0, top.idx - 200);
  const end = Math.min(code.length, top.idx + 200);
  const snippet = code.slice(start, end);
  console.log('--- snippet around last opener ---');
  console.log(snippet.replace(/\n/g, '\\n'));
  console.log('--- end snippet ---');
}

