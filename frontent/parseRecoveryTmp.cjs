const fs = require('fs');
const parser = require('@babel/parser');

const code = fs.readFileSync('src/Pages/MessagesPage.jsx', 'utf8');

try {
  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'dynamicImport'],
    errorRecovery: true,
  });
  console.log('RECOVERY_PARSE_DONE');
  if (ast.errors && ast.errors.length) {
    console.log('ERROR_COUNT', ast.errors.length);
    ast.errors.slice(0, 20).forEach((e, i) => {
      console.log(`#${i + 1}`, e.message, 'loc=', e.loc);
    });
  } else {
    console.log('NO_ERRORS_REPORTED');
  }
} catch (e) {
  console.log('RECOVERY_THROWN');
  console.log(e.message, e.loc);
}

