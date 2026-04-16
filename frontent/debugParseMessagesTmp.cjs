const fs = require('fs');
const parser = require('@babel/parser');

const filePath = 'src/Pages/MessagesPage.jsx';
const codeFull = fs.readFileSync(filePath, 'utf8');

const lines = codeFull.split(/\r?\n/);

function tryParse(code, label) {
  try {
    parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'dynamicImport'],
    });
    console.log(label + ': PARSE_OK');
    return { ok: true };
  } catch (e) {
    console.log(label + ': PARSE_ERR');
    console.log('  message:', e.message);
    console.log('  loc:', e.loc);
    console.log('  pos:', e.pos);
    if (e.codeFrame) console.log('  codeFrame:', e.codeFrame);
    return { ok: false, err: e };
  }
}

// Quick check: full file
const fullRes = tryParse(codeFull, 'FULL');
if (!fullRes.ok) {
  const e = fullRes.err;
  const pos = e.pos ?? (e.loc && e.loc.index);
  const idx = typeof pos === 'number' ? pos : null;
  if (idx != null) {
    const start = Math.max(0, idx - 300);
    const end = Math.min(codeFull.length, idx + 300);
    const around = codeFull.slice(start, end);
    console.log('--- AROUND FULL ERROR (snippet) ---');
    console.log(around.replace(/\n/g, '\\n'));
    console.log('--- END SNIPPET ---');
  }
}

// Try removing last N lines to see if the syntax problem is near the end.
// Increase window because the JSX is huge and the parser reports the first
// point it can no longer recover.
const maxTail = Math.min(600, lines.length);
for (let tail = 0; tail <= maxTail; tail += 25) {
  const trimmed = lines.slice(0, Math.max(0, lines.length - tail)).join('\n');
  tryParse(trimmed, `TAIL_${tail}`);
}

