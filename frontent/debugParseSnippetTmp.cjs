const fs = require('fs');
const parser = require('@babel/parser');

const lines = fs.readFileSync('src/Pages/MessagesPage.jsx', 'utf8').split(/\r?\n/);

// Based on balance scan: check just the online status conditional.
const startLine = 2273;
const endLine = 2285;

const snippet = lines.slice(startLine - 1, endLine).join('\n');

const code = `
  const X = () => (
    <div>
${snippet}
    </div>
  );
`;

// Debug: show generated code with line numbers
const numbered = code
  .split(/\r?\n/)
  .map((l, idx) => String(idx + 1).padStart(2, '0') + ': ' + l)
  .join('\n');
console.log('--- GENERATED CODE ---');
console.log(numbered);
console.log('--- END GENERATED CODE ---');

try {
  parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'classProperties', 'dynamicImport'] });
  console.log('SNIPPET_PARSE_OK');
} catch (e) {
  console.log('SNIPPET_PARSE_ERR');
  console.log('message:', e.message);
  console.log('loc:', e.loc);
}

