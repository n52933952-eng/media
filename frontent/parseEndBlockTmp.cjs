const fs = require('fs');
const parser = require('@babel/parser');

const lines = fs.readFileSync('src/Pages/MessagesPage.jsx', 'utf8').split(/\r?\n/);
const start = 3794;
const end = 3938;
const snippet = lines.slice(start - 1, end).join('\n');

const code = `
const T = () => (
  <div>
${snippet}
  </div>
);
`;

try {
  parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  console.log('END_BLOCK_OK');
} catch (e) {
  console.log('END_BLOCK_ERR');
  console.log(e.message);
  console.log(e.loc);
}

