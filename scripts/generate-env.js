const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const envDir = path.join(__dirname, '..', 'src', 'environments');
const targetFile = path.join(envDir, 'environment.ts');
const devTargetFile = path.join(envDir, 'environment.development.ts');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  if (fs.existsSync(targetFile)) {
    console.log('SUPABASE_URL/SUPABASE_ANON_KEY no definidas, se usan los archivos de environment existentes.');
    process.exit(0);
  }
  console.error('Faltan las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY, y no existen archivos de environment locales.');
  process.exit(1);
}

const template = (production) => `export const environment = {
  production: ${production},
  supabaseUrl: '${SUPABASE_URL}',
  supabaseKey: '${SUPABASE_KEY}'
};
`;

fs.writeFileSync(targetFile, template(true));
fs.writeFileSync(devTargetFile, template(false));
console.log('Archivos de environment generados a partir de variables de entorno.');
