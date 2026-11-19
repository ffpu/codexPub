# Diseño técnico del piloto

## Context

El repositorio contiene la configuración de OpenSpec y carece de una aplicación previa. La propuesta establece una bandeja común para cinco usuarios concurrentes y un corte desde una hoja de cálculo. La aplicación debe poder probarse por URL antes de activar la operación real.

## Goals / Non-Goals

**Goals**

- Mantener solicitudes, responsables, eventos y estado de asignación coherentes ante escrituras simultáneas y reintentos.
- Hacer repetible el corte, la verificación en navegador y la recuperación del entorno.

**Non-Goals**

- Los conectores con canales externos y el ERP pertenecen a H2. El portal externo y la analítica predictiva pertenecen a H3.

## Decisions

1. **Aplicación y datos**. Se propone servir HTML5, CSS3 y JavaScript desde una aplicación Node.js con API del mismo origen y PostgreSQL. Una aplicación única simplifica el despliegue y permite exponer la interfaz y la API bajo el mismo dominio HTTPS. El proveedor se seleccionará al verificar alojamiento, respaldo y soporte frente a los topes de la propuesta.
2. **Modelo y transacciones**. Persistir cliente, usuario, solicitud, evento, disponibilidad, cursor de reparto y contador mensual. Usar transacciones para radicar el caso, avanzar el turno, reservar el consecutivo y agregar su evento. Una restricción única protege el radicado. La API acepta una clave de idempotencia para evitar dobles radicaciones tras reintentos. Versionar solicitudes y rechazar escrituras sobre una versión antigua. Agregar eventos en la misma transacción que el cambio y omitir operaciones de edición de historial de la API.
3. **Catálogos y tiempo**. Usar las categorías Consulta de stock, Estado del pedido, Inconformidad de envío, Facturación y cobro y Devolución. Usar tiempo del servidor en UTC para radicación y resolución, representar fechas en hora colombiana y calcular el mes del radicado con `America/Bogota`. El consecutivo corresponde al mes de emisión del radicado, incluso al migrar. Conservar por separado la fecha original que gobierna el plazo. Calcular los vencimientos con una duración exacta de 48 horas.
4. **Bandeja**. Usar consultas paginadas con filtros e índices, y refresco periódico mientras la bandeja esté visible. Mantener el borrador si la versión del caso cambia durante una edición. El piloto medirá el objetivo de 1,5 segundos para carga y búsqueda con datos representativos y cinco sesiones activas.
5. **Identidad y ambientes**. Crear cuentas individuales y verificar sesión y rol en el servidor. Usar cookies de sesión seguras, HTTPS y credenciales y bases separadas para pruebas y piloto. El aprovisionamiento de cuentas será operativo, con dos roles dentro de la aplicación. Usar respaldo de base de datos con restauración ensayada. La exportación JSON sirve para portabilidad y verificación de registros.
6. **Importación**. Convertir la hoja a CSV conservando valores de NIT y documentar un mapeo de campos, estados y agentes. Acordar una referencia de origen estable por fila que sobreviva a reordenamientos. Interpretar las fechas sin zona como hora colombiana tras verificar la convención en la muestra. Validar de nuevo al confirmar la carga y registrar procedencia con una clave única. Mantener el archivo, mapeo y reporte de conciliación en acceso restringido.

## Risks / Trade-offs

- **Pérdida de actualización concurrente**. Aplicar versiones y transacciones, y probar con dos usuarios que escriben sobre la misma versión.
- **Fechas ambiguas, duplicados y agentes no identificados en la hoja**. Usar una muestra, validar la zona, ensayar la carga y corregir o documentar exclusiones con el coordinador antes del corte.
- **Sin agentes disponibles**. El coordinador verifica la cobertura al inicio y durante los turnos. Si la cobertura cae a cero, el formulario conserva el borrador e informa cómo reanudar la asignación.
- **Demostración con acceso a datos reales**. Probar el aislamiento con datos, credenciales, URL y copias de seguridad separados.

## Migration Plan

1. Aprovisionar ambientes y cuentas. Validar el flujo en demostración con datos ficticios antes de procesar la hoja real.
2. Ensayar directorio y pendientes. Conciliar los candidatos con los registros aptos, duplicados y excepciones. El coordinador aprueba las correcciones o exclusiones documentadas.
3. Acordar una ventana de corte, conservar una copia de la hoja, cerrar su edición operativa e importar el lote definitivo. Verificar conteos, referencias y una muestra de fechas, estados y vencimientos. Habilitar el piloto tras la validación del coordinador.
4. Si falla el corte antes de la apertura, recuperar el respaldo previo y reanudar temporalmente el registro en la hoja. Si ya hay solicitudes nuevas en el piloto, preservarlas y conciliarlas antes de revertir el proceso.
5. Durante las seis semanas, revisar semanalmente registro, asignación y plazo. Medir tiempo administrativo y gastos con muestras y fuentes operativas comparables con la línea base.

## Open Questions

- El formato exacto de las columnas y el proveedor de alojamiento se validarán con la muestra de migración y la cotización. El contrato de importación y las pruebas del piloto se mantienen.
