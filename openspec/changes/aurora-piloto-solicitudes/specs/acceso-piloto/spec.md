# Acceso al piloto

## Purpose

Permite que el equipo de atención trabaje sobre datos compartidos con acceso individual y que la demostración en navegador utilice datos ficticios separados.

## ADDED Requirements

### Requirement: Acceso individual por HTTPS
El sistema SHALL autenticar cuentas individuales y admitir cinco sesiones concurrentes para cuatro agentes y un coordinador desde sus navegadores.

#### Scenario: Acceso simultáneo del equipo
- **WHEN** los cuatro agentes y el coordinador ingresan con credenciales válidas desde sesiones independientes
- **THEN** cada uno accede por HTTPS a la bandeja del mismo entorno con su identidad y rol

#### Scenario: Solicitud sin sesión válida
- **WHEN** se intenta consultar o modificar un registro sin una sesión válida
- **THEN** el servidor deniega el acceso sin exponer los datos

### Requirement: Permisos de operación por rol
El sistema SHALL permitir al agente radicar y consultar solicitudes y actualizar el estado de sus casos asignados. El coordinador SHALL poder intervenir en cualquier caso, gestionar disponibilidad, reasignar e importar y exportar datos. El servidor SHALL aplicar estos permisos a cada operación.

#### Scenario: Edición de un caso ajeno
- **WHEN** un agente intenta actualizar un caso asignado a otro agente
- **THEN** el servidor rechaza el cambio y conserva el caso y su historial

#### Scenario: Operación reservada al coordinador
- **WHEN** un agente intenta reasignar una solicitud, cambiar disponibilidad o acceder a una operación de importación o exportación
- **THEN** el servidor deniega la operación

### Requirement: Entorno de prueba en navegador
La entrega SHALL incluir una URL HTTPS de pruebas que permita usar ambas clases de cuenta y recorrer el flujo con datos ficticios en sesiones independientes. El entorno de prueba SHALL tener credenciales y datos separados del piloto real.

#### Scenario: Operación de demostración sin afectar el piloto
- **WHEN** un usuario crea y reasigna una solicitud desde dos sesiones de prueba
- **THEN** el caso y su historial se pueden consultar desde la segunda sesión de prueba y no aparecen en la bandeja real
