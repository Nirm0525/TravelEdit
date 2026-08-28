const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const publicEnvDir = path.join(__dirname, '..', 'src', 'environments');
const adminEnvDir = path.join(__dirname, '..', 'projects', 'admin', 'src', 'environments');

const publicTargetFile = path.join(publicEnvDir, 'environment.ts');
const publicProdTargetFile = path.join(publicEnvDir, 'environment.prod.ts');
const adminTargetFile = path.join(adminEnvDir, 'environment.ts');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  const hasExisting =
    fs.existsSync(publicTargetFile) || fs.existsSync(publicProdTargetFile) || fs.existsSync(adminTargetFile);

  if (hasExisting) {
    console.log('SUPABASE_URL/SUPABASE_ANON_KEY no definidas, se usan los archivos de environment existentes.');
    process.exit(0);
  }
  console.error('Faltan las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY, y no existen archivos de environment locales.');
  process.exit(1);
}

const publicTemplate = (production) => `export const environment = {
  production: ${production},
  supabaseUrl: '${SUPABASE_URL}',
  supabaseKey: '${SUPABASE_KEY}'
};
`;

const adminTemplate = (production) => `export const environment = {
  production: ${production},
  // Vacío en producción: admin se sirve en /admin/ del mismo dominio que el
  // sitio público, así que un enlace que empieza en "/" (p. ej. "/#destinos")
  // ya apunta correctamente al sitio público sin necesidad de un host explícito.
  // En local, admin (4301) y el sitio público (4200) son puertos distintos —
  // sin este host explícito, "Vista previa" abriría el enlace dentro del
  // propio admin en vez del sitio público.
  publicSiteUrl: '${production ? '' : 'http://localhost:4200'}',
  supabaseUrl: '${SUPABASE_URL}',
  supabaseKey: '${SUPABASE_KEY}'
};
`;

fs.mkdirSync(publicEnvDir, { recursive: true });
fs.writeFileSync(publicTargetFile, publicTemplate(true));
fs.writeFileSync(path.join(publicEnvDir, 'environment.development.ts'), publicTemplate(false));
fs.writeFileSync(publicProdTargetFile, publicTemplate(true));

fs.mkdirSync(adminEnvDir, { recursive: true });
fs.writeFileSync(adminTargetFile, adminTemplate(true));
fs.writeFileSync(path.join(adminEnvDir, 'environment.development.ts'), adminTemplate(false));

console.log('Archivos de environment generados a partir de variables de entorno (sitio público + admin).');
