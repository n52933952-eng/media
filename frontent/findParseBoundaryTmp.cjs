const fs = require('fs');
const parser = require('@babel/parser');

const code = fs.readFileSync('src/Pages/MessagesPage.jsx', 'utf8');
const lines = code.split(/\r?\n/);

function ok(tail) {
  const trimmed = lines.slice(0, Math.max(0, lines.length - tail)).join('\n');
  try {
    parser.parse(trimmed, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'dynamicImport'],
    });
    return true;
  } catch {
    return false;
  }
}

let lo = 0;
let hi = lines.length;
// find minimal tail where parse becomes OK
while (lo < hi) {
  const mid = Math.floor((lo + hi) / 2);
  if (ok(mid)) hi = mid;
  else lo = mid + 1;
}

const boundary = lo;
console.log('TOTAL_LINES', lines.length);
console.log('MIN_TAIL_FOR_OK', boundary);
console.log('FIRST_OK_CUTS_FILE_TO_LINES', lines.length - boundary);
console.log('WINDOW_START', Math.max(1, lines.length - boundary - 20));
console.log('WINDOW_END', Math.min(lines.length, lines.length - boundary + 20));

for (let i = Math.max(1, lines.length - boundary - 20); i <= Math.min(lines.length, lines.length - boundary + 20); i++) {
  console.log(String(i).padStart(5, ' '), '|', lines[i - 1]);
}

