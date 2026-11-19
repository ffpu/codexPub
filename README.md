# Comercial Aurora · Gestión de solicitudes

Aplicación interna para radicar, asignar y seguir solicitudes de clientes desde una bandeja compartida. El piloto usa cuatro cuentas de agente y una de coordinación. La demostración parte de datos ficticios y ofrece ambos roles.

## Probar en tu navegador

### Contenedor independiente

La imagen incluye la aplicación, Node.js, PostgreSQL y los datos ficticios. Solo necesitas Docker. Descarga `aurora-piloto-linux-amd64.tar.gz` y ejecuta estos comandos desde el directorio donde guardaste el archivo:

```sh
docker load -i aurora-piloto-linux-amd64.tar.gz
docker run -d --name aurora --stop-timeout 30 -p 127.0.0.1:3000:3000 -v aurora-datos:/var/lib/postgresql/data aurora-piloto:1.0
```

Abre **http://localhost:3000** en el equipo que ejecuta Docker y selecciona **Coordinador** o **Agente**. El primer arranque inicializa la base y carga la demostración. Usa `docker logs aurora` para ver el progreso, `docker stop aurora` para detenerlo y `docker start aurora` para volver a abrirlo. El volumen `aurora-datos` conserva los datos aunque se reemplace el contenedor.

La imagen descargable es para Docker con contenedores Linux en x86-64. Puedes construir una imagen nativa en tu equipo desde el código fuente con `docker build -t aurora-piloto:1.0 .`. Para operar con datos reales, consulta la [configuración del contenedor en modo piloto](docs/operacion-piloto.md#contenedor-independiente-en-modo-piloto).

### Desarrollo sin la imagen de Aurora

Requisitos: Node.js 22.20 o posterior, npm y PostgreSQL. Si tienes Docker, puedes crear la base de demostración como se indica abajo. En una terminal desde el directorio del proyecto:

```sh
docker run -d --name aurora-demo-db \
  -e POSTGRES_USER=aurora -e POSTGRES_PASSWORD=aurora-local-demo-db \
  -e POSTGRES_DB=aurora_demo -p 127.0.0.1:55432:5432 postgres:17-alpine
docker exec aurora-demo-db pg_isready -U aurora -d aurora_demo
```

Si PostgreSQL todavía está arrancando, vuelve a comprobar que acepte conexiones. Si ya tienes una base PostgreSQL disponible, usa su URL en los pasos siguientes. Con Bash o Zsh:

```sh
npm ci
export DATABASE_URL=postgresql://aurora:aurora-local-demo-db@127.0.0.1:55432/aurora_demo
npm run demo
npm start
```

Abre **http://localhost:3000** en el navegador del equipo donde ejecutaste el servidor. Selecciona **Coordinador** o **Agente** en el recuadro de demostración. Los usuarios de prueba son `coord` y `agente1` a `agente4`, todos con la clave de demostración `Aurora-Demo-2026`. Para probar dos cuentas a la vez, abre una ventana privada o usa dos perfiles de navegador.

## Recorrido de prueba

1. Ingresa como agente y abre **Nueva solicitud**. Busca al cliente por NIT o razón social. Completa canal, tipo y descripción. Guarda y anota el radicado que aparece.
2. Desde una sesión de coordinación, busca el mismo radicado. Revisa su responsable y plazo. En el detalle, reasigna a otro agente disponible e indica el motivo.
3. Abre el caso con el nuevo responsable o desde coordinación. Selecciona **Resuelto**, registra la respuesta de fondo y guarda. Comprueba el resultado de las 48 horas y el historial.
4. Como coordinador, usa **Importar y exportar** para ensayar el directorio o los pendientes y descargar un JSON. La conciliación aparece antes de confirmar.

La bandeja se refresca cada 10 segundos mientras está visible. **Actualizar** consulta de inmediato. Si otro usuario editó el caso mientras estaba abierto, **Ver versión vigente** carga los cambios y conserva el borrador aplicable.

## Pruebas automatizadas

Usa una base PostgreSQL dedicada a pruebas. Los tests crean y retiran su propio esquema:

```sh
docker exec aurora-demo-db createdb -U aurora aurora_test
export TEST_DATABASE_URL=postgresql://aurora:aurora-local-demo-db@127.0.0.1:55432/aurora_test
npm test
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Para otro sistema, ajusta `CHROMIUM_PATH` al ejecutable de Chromium o Chrome. Consulta la [guía de operación y corte](docs/operacion-piloto.md) para configurar HTTPS, aprovisionar cuentas reales, preparar la hoja y restaurar una copia.
