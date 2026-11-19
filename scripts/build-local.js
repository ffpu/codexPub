import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const [template, css, ui, catalogs, storage, imports, localApp, toolbar, toolbarStyle] = await Promise.all(
  ['public/index.html', 'public/styles.css', 'public/app.js', 'src/catalogs.js', 'local/store.js',
    'local/imports.js', 'local/app.js', 'local/toolbar.html', 'local/toolbar.css'].map(read)
);
const escapeScript = value => value.replace(/<\/script/gi, '<\\/script');
const engine = [catalogs.replace(/^export /gm, ''), storage, imports, localApp].join('\n');
let standalone = template;
function replace(pattern, value) {
  if (!standalone.includes(pattern)) throw new Error('No se encontró el bloque que se debe adaptar: ' + pattern);
  standalone = standalone.replace(pattern, () => value);
}
replace('<link rel="stylesheet" href="/styles.css">', '<style>\n' + css + '\n' + toolbarStyle + '</style>');
replace('  <script type="module" src="/app.js"></script>\n', '');
replace('<body>', '<body>\n' + toolbar);
replace('<h2>Inicia sesión</h2>', '<h2>Elige tu perfil</h2>');
replace('<p>Ingresa con tu cuenta para abrir la bandeja.</p>', '<p>Usa un perfil de esta base local. Guarda el archivo JSON antes de cerrar.</p>');
replace('<label>Usuario<input name="id" autocomplete="username" required maxlength="50"></label>\n        <label>Contraseña<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>',
  '<label>Perfil de trabajo<select name="id" id="local-profile" required></select></label>');
replace('title="Cerrar sesión" aria-label="Cerrar sesión"', 'title="Cambiar perfil" aria-label="Cambiar perfil"');
replace('<a class="secondary" href="/api/export" download>↓ Exportar JSON</a>', '<button class="secondary" type="button" data-save-local>↓ Guardar JSON</button>');
replace('</body>', '<script>\n(() => {\n' + escapeScript(engine) + '\n})();\n</script>\n<script type="module">\n'
  + escapeScript(ui) + '\n</script>\n</body>');
await writeFile(new URL('index.html', root), standalone);
