# Operación y corte del piloto

## Preparar los dos entornos

Usa dominios HTTPS, bases, usuarios de PostgreSQL, cuentas de aplicación y respaldos independientes para demostración y piloto. Configura `APP_MODE=demo` en la demostración y `APP_MODE=pilot` en la operación real. El programa comprueba que el modo coincida con la base antes de iniciar. Configura `DATABASE_URL` mediante el gestor de secretos del alojamiento y usa una conexión PostgreSQL cifrada cuando la base esté en otro servidor.

En ambos entornos fija `PUBLIC_ORIGIN` a la URL HTTPS del frontend, sin barra final. Puedes configurar `TLS_CERT` y `TLS_KEY` con rutas a certificados y llaves del dominio o terminar TLS en un proxy. Para usar un único proxy, configura `TRUST_PROXY=1`, limita el acceso al backend a ese proxy y verifica que sobrescriba las cabeceras reenviadas. `HOST` y `PORT` ajustan la escucha. HTTPS directo usa como mínimo TLS 1.3. Protege la demostración de acuerdo con la audiencia prevista y usa exclusivamente datos ficticios en ella.

Con las variables del entorno correspondiente, aplica migraciones y crea las cuentas:

```sh
npm ci --omit=dev
npm run migrate
npm run user -- agente1 agente "Nombre del agente" < /ruta/segura/clave-temporal
npm run user -- coordinacion coordinador "Nombre del coordinador" < /ruta/segura/clave-coordinacion
npm start
```

Usa contraseñas únicas de al menos 12 caracteres y entrega las credenciales por el canal interno acordado. Repetir el comando de usuario actualiza la contraseña y revoca sesiones previas. Corre `npm run demo` únicamente con la base de demostración. Verifica que `/health` devuelva `{"ready":true}` y que las cuentas de un entorno sean rechazadas en el otro.

### Contenedor independiente en modo piloto

La imagen integra PostgreSQL y usa un socket local con autenticación por usuario del sistema. Publica solo el puerto de la aplicación. Crea un volumen exclusivo para el piloto, separado del volumen de demostración. Este ejemplo supone un proxy HTTPS en el mismo equipo que envía el tráfico a `127.0.0.1:3100`:

```sh
docker run -d --name aurora-piloto --stop-timeout 30 -p 127.0.0.1:3100:3000 \
  -e APP_MODE=pilot -e PUBLIC_ORIGIN=https://aurora.example.com -e TRUST_PROXY=1 \
  -v aurora-piloto-datos:/var/lib/postgresql/data aurora-piloto:1.0
docker exec -i -u postgres aurora-piloto node scripts/admin.js user coordinacion coordinador "Nombre del coordinador" < /ruta/segura/clave-coordinacion
```

Cambia el dominio del ejemplo y provisiona las demás cuentas con el mismo comando. El modo piloto aplica las migraciones en el primer arranque y espera que el operador cree las cuentas. Para una copia lógica del contenedor, usa `docker exec -u postgres aurora-piloto pg_dump -Fc -d aurora > aurora-piloto.dump`. Conserva el volumen al sustituir o actualizar el contenedor.

## Directorio y solicitudes pendientes

El directorio admite un CSV UTF-8 con columnas `nit,name` o un arreglo JSON con los mismos campos. Conserva el NIT como texto y no lo formatees como un número. El CSV usa coma como delimitador y comillas dobles para valores que contienen comas.

Exporta una copia de la hoja de **solo pendientes** y mapea sus columnas a este encabezado:

```csv
source_ref,nit,channel,category,description,order_ref,agent_id,state,received_at
HOJA-0042,001234,correo,pedido,Confirmar despacho del pedido,ERP-220,agente1,logistica,2026-11-17T10:00:00-05:00
```

| Campo | Convención |
|---|---|
| `source_ref` | Identificador único y estable de origen. Consérvalo al corregir y reordenar filas. |
| `nit` | NIT de texto tal como figura en el directorio importado. |
| `channel` | `llamada`, `correo`, `mensajeria`. |
| `category` | `stock`, `pedido`, `envio`, `facturacion`, `devolucion`. |
| `description`, `order_ref` | Descripción de al menos 10 caracteres. Referencia de pedido opcional. |
| `agent_id` | Identificador de una cuenta de agente del piloto. El coordinador concilia los casos sin responsable. |
| `state` | `nuevo`, `proceso`, `logistica`, `ventas`. |
| `received_at` | Fecha y hora originales en ISO 8601, preferiblemente con zona explícita. Una hora sin zona se interpreta como hora colombiana. |

Los números que muestra el reporte se refieren a registros de datos, empezando por 1 sin contar el encabezado. Primero importa el directorio. Ensaya el CSV de pendientes, concilia aptos, duplicados y excepciones, corrige el archivo y repite el ensayo. La carga confirmada revalida todo el archivo y conserva los radicados asociados a las referencias previamente importadas.

## Copia de seguridad y reversión

Usa las herramientas de PostgreSQL mediante un servicio configurado en `pg_service.conf` o el gestor de respaldos del proveedor. Guarda las copias en almacenamiento privado con cifrado y retención acordada. Ejemplo con servicios PostgreSQL configurados por el operador:

```sh
pg_dump --format=custom --file=aurora-previo.dump --dbname=service=aurora_piloto
pg_restore --exit-on-error --dbname=service=aurora_restauracion aurora-previo.dump
```

Apunta la restauración a una base vacía e independiente. Verifica el modo, conteos de clientes y casos, muestra de estados, referencias y orden del historial. El JSON descargado sirve para revisión y portabilidad de registros. La restauración operativa utiliza el respaldo de PostgreSQL.

## Lista de corte y seguimiento para coordinación

- [ ] Aprobar la prueba en navegador desde dos sesiones independientes y confirmar que el personal entra con sus cuentas.
- [ ] Conciliar la muestra de la hoja, incluidos pendientes antiguos y casos sin agente identificable. Confirmar que la fecha original gobierna el plazo.
- [ ] Acordar la ventana de corte, respaldar la base y congelar la edición de la hoja.
- [ ] Confirmar la carga y comparar los conteos y una muestra de fechas, responsables, estados y vencimientos. Registrar la aprobación de coordinación antes de abrir el piloto.
- [ ] Si el corte falla antes de la apertura, recuperar el respaldo previo y retomar temporalmente la hoja. Si ya ingresaron casos nuevos, conservar y conciliar esos registros antes de revertir.
- [ ] Revisar cada semana solicitudes registradas y asignadas, porcentaje de resoluciones dentro de 48 horas, tiempo de gestión y gastos por repetición de envíos o materiales. Medir el registro contra el total recibido por los canales, el tiempo con una muestra comparable y los gastos contra registros contables.
