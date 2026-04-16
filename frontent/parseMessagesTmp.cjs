const fs = require('fs');
const parser = require('@babel/parser');

const code = fs.readFileSync('src/Pages/MessagesPage.jsx', 'utf8');

try {
  parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'dynamicImport'],
  });
  console.log('PARSE_OK');
} catch (e) {
  console.log('PARSE_ERR');
  console.log('message:', e.message);
  console.log('loc:', e.loc);
  console.log('pos:', e.pos);
  process.exitCode = 1;
}

