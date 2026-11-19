# Tareas del piloto

## 1. Base y acceso

- [x] 1.1 Crear la aplicación Node.js con interfaz HTML5, CSS3 y JavaScript, y migraciones PostgreSQL. Verificar el arranque y aplicar las migraciones a una base vacía.
- [x] 1.2 Implementar cuentas, inicio y cierre de sesión, y controles de rol en servidor. Verificar acceso autorizado, sesión ausente y operaciones reservadas al coordinador.
- [x] 1.3 Configurar despliegues separados por HTTPS y documentar alta de cuentas, respaldo y restauración. Verificar la separación de credenciales y restaurar un respaldo de prueba en una base independiente.

## 2. Radicación, bandeja e historial

- [x] 2.1 Implementar el formulario, los catálogos y la búsqueda de cliente. Verificar el guardado válido y el rechazo de campos inválidos sin crear registros.
- [x] 2.2 Implementar consecutivo, reparto por turnos, disponibilidad e idempotencia. Verificar radicaciones concurrentes, reintentos y los casos de ausencia parcial y total.
- [x] 2.3 Implementar la bandeja, sus filtros, el detalle y el refresco. Verificar que dos sesiones vean el mismo caso y que una actualización durante una edición conserve el borrador.
- [x] 2.4 Implementar reasignación, estados e historial. Verificar permisos, registro del motivo, respuesta al resolver, cierre desde Resuelto y rechazo de una escritura con versión antigua.

## 3. Plazo e indicadores

- [x] 3.1 Implementar fecha límite y condición de vencimiento en la bandeja. Verificar un caso de 47 h 59 min, el límite exacto, un pendiente que cruza el límite y un pendiente migrado ya vencido.
- [x] 3.2 Registrar duración y cumplimiento al resolver y habilitar la consulta del coordinador por periodo. Verificar resoluciones a 48 h y a 48 h más un segundo, el denominador de casos resueltos y el resultado sin datos.

## 4. Intercambio de datos y preparación del corte

- [x] 4.1 Implementar importación del directorio en JSON y CSV. Verificar NIT con ceros iniciales, duplicados, filas inválidas y consulta de los clientes incorporados.
- [x] 4.2 Implementar ensayo, reporte y confirmación de importación de pendientes. Verificar ausencia de escrituras en el ensayo, preservación de fechas, estados y responsables conciliados, trazabilidad y reintento sin duplicar radicados.
- [x] 4.3 Implementar exportación JSON reservada al coordinador. Verificar versión, relaciones y ausencia de credenciales en el archivo.
- [ ] 4.4 Preparar el mapeo de la hoja y el procedimiento de reversión. Verificar una importación con una muestra autorizada y entregar al coordinador un reporte con conteos, excepciones y fechas conciliables.

## 5. Aceptación integrada en navegador

- [ ] 5.1 Entregar la URL HTTPS de prueba con datos ficticios y verificar desde dos navegadores el recorrido de radicación, asignación, consulta, reasignación, resolución e historial.
- [x] 5.2 Verificar con cinco sesiones y datos representativos que los cambios se reflejan en la bandeja y que las escrituras concurrentes mantienen la integridad. Registrar tiempos de carga y búsqueda frente al objetivo de 1,5 segundos.
- [ ] 5.3 Entregar al coordinador la guía de operación y la lista de verificación del corte. Revisar con el coordinador los resultados de aceptación, el informe de migración y el método de medición semanal.
