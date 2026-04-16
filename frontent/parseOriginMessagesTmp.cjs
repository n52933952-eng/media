const parser = require('@babel/parser');
const { execSync } = require('child_process');

const file = 'frontent/src/Pages/MessagesPage.jsx';
let code;
try {
  code = execSync(`git show origin/main:${file}`, { encoding: 'utf8' });
} catch (e) {
  console.error('Failed to git show origin/main for', file);
  process.exit(1);
}

try {
  parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'dynamicImport'],
  });
  console.log('ORIGIN_MAIN_PARSE_OK');
} catch (e) {
  console.log('ORIGIN_MAIN_PARSE_ERR');
  console.log('message:', e.message);
  console.log('loc:', e.loc);
  console.log('pos:', e.pos);
}

