# Flujo de desarrollo con OpenSpec

Trabaja desde la raíz del repositorio. Usa las skills de `.agents/skills/` para explorar requisitos, proponer o revisar un cambio, implementar sus tareas, sincronizar especificaciones y archivarlo.

Las skills ejecutan `openspec` desde el `PATH`. En la sesión de shell que las ejecute, activa el binario local con `export PATH="$PWD/node_modules/.bin:$PATH"`. También puedes ejecutar comandos individuales con `npm exec --offline -- openspec`.

Si faltan las dependencias, ejecuta `npm ci` desde la raíz. En Codex Cloud, usa `npm ci --cache "$(mktemp -d /tmp/codex-openspec-npm.XXXXXX)"` si el caché predeterminado de npm no admite escritura.
