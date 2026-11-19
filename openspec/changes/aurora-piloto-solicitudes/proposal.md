# Piloto de gestión de solicitudes de Comercial Aurora

## Why

Comercial Aurora atiende a 300 clientes, procesa cerca de 1.200 pedidos y recibe unas 600 solicitudes al mes. Un registro compartido durante seis semanas de operación real permitirá medir las pérdidas de solicitudes, la asignación de responsables y el cumplimiento del plazo de atención.

## What Changes

- Habilitar cuentas individuales para cuatro agentes y un coordinador que trabajan simultáneamente desde sus navegadores.
- Registrar llamadas, correos y mensajes de forma manual, generar radicados únicos y repartir los casos por turnos entre los agentes disponibles. Permitir al coordinador gestionar disponibilidad y reasignar con motivo.
- Proporcionar una bandeja compartida con búsqueda, filtros, estados, historial y seguimiento de 48 horas corridas desde el primer día.
- Importar el directorio de clientes en JSON o CSV, migrar los pendientes de la hoja con sus fechas originales y permitir al coordinador exportar un respaldo lógico en JSON.
- Entregar una URL HTTPS de prueba con datos ficticios para recorrer el flujo en dos sesiones independientes. Habilitar el piloto real en un entorno separado de acceso restringido.

## Capabilities

### New Capabilities

- `acceso-piloto`: acceso individual, permisos por rol y aislamiento de entornos.
- `gestion-solicitudes`: radicación, asignación, bandeja, estados e historial compartido.
- `seguimiento-plazos`: indicador y medición del plazo de 48 horas corridas.
- `intercambio-datos`: directorio, migración y conciliación de pendientes, y exportación.

### Modified Capabilities

## Impact

- Afecta la operación de atención y sustituye la hoja compartida como registro operativo cuando se apruebe el corte.
- Conserva HTML5, CSS3 y JavaScript para la interfaz. Incorpora un servidor y una base relacional para mantener un estado común. JSON y CSV se usan para intercambiar datos.
- El montaje y el ensayo de migración preceden a las seis semanas de operación real. El presupuesto de referencia es de hasta COP 12.000.000 de implementación y COP 300.000 mensuales de operación, sujeto a cotización que incluya alojamiento, respaldo y soporte.
- Metas de evaluación del piloto: registrar y asignar el 100 % de solicitudes, resolver al menos el 90 % en 48 horas, reducir el tiempo administrativo de 20 a 12 minutos por solicitud y medir el avance de COP 800.000 a COP 400.000 mensuales en gastos por envíos o materiales repetidos.
- ERP, webhooks y avisos automáticos quedan para H2. Portal externo, analítica predictiva y sincronización bidireccional quedan para H3.
