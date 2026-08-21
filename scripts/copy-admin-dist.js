const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', 'dist', 'admin', 'browser');
const to = path.join(__dirname, '..', 'dist', 'TravelEdit', 'browser', 'admin');

if (!fs.existsSync(from)) {
  console.error(`No existe ${from} — corre "ng build admin" antes de este script.`);
  process.exit(1);
}

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });

console.log(`Copiado ${from} -> ${to}`);
