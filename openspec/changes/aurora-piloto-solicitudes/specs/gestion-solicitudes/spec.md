# Gestión de solicitudes

## Purpose

Mantiene un registro común de solicitudes de clientes desde la radicación hasta el cierre, con un responsable y un historial de atención consultable.

## ADDED Requirements

### Requirement: Radicación manual
El sistema SHALL registrar solicitudes de llamada, correo electrónico o mensajería para un cliente identificado por NIT y razón social. SHALL requerir tipo y descripción de al menos 10 caracteres, admitir un identificador de pedido opcional y crear el caso en estado Nuevo con fecha de recepción asignada por el servidor.

#### Scenario: Radicación válida
- **WHEN** un usuario autorizado radica un caso completo para un cliente del directorio
- **THEN** obtiene un radicado inmutable y único con formato AUR-YYYYMM-XXXX, la fecha de recepción, el estado Nuevo y el agente responsable

#### Scenario: Radicación incompleta
- **WHEN** faltan datos obligatorios o los valores están fuera de catálogo
- **THEN** el formulario identifica los campos inválidos y el servidor rechaza la operación sin crear caso, consumir turno ni agregar eventos al historial

### Requirement: Asignación por turnos
El sistema SHALL asignar los casos nuevos por turno circular entre agentes disponibles. SHALL omitir a los no disponibles y registrar el responsable junto con la radicación, incluso cuando varias sesiones radican al mismo tiempo.

#### Scenario: Reparto con ausencias
- **WHEN** los agentes 1, 3 y 4 están disponibles, el siguiente turno corresponde al 1 y se radican cuatro casos válidos
- **THEN** el orden de asignación es 1, 3, 4 y 1

#### Scenario: Falta de agentes disponibles
- **WHEN** se intenta radicar y no hay agentes disponibles
- **THEN** el sistema mantiene los campos diligenciados, informa que el coordinador debe habilitar un agente y permite reintentar sin registrar un caso sin responsable

### Requirement: Reasignación coordinada
El sistema SHALL permitir que el coordinador actualice la disponibilidad de los agentes y reasigne solicitudes abiertas a otro agente disponible indicando el motivo.

#### Scenario: Reasignación por ausencia
- **WHEN** el coordinador elige un agente disponible y registra el motivo
- **THEN** la bandeja muestra el nuevo responsable y el historial conserva el responsable anterior, el nuevo y el motivo

### Requirement: Bandeja compartida
El sistema SHALL permitir buscar por radicado, NIT o razón social y filtrar por estado, responsable y condición de vencimiento. SHALL mostrar los cambios confirmados en las demás sesiones al refrescar y actualizar la bandeja automáticamente sin exigir que el usuario vuelva a ingresar.

#### Scenario: Consulta desde otro equipo
- **WHEN** un agente guarda un caso y otro consulta la bandeja desde otra sesión
- **THEN** ambos ven el mismo radicado, responsable, fecha de recepción y estado

#### Scenario: Edición sobre una versión anterior
- **WHEN** dos usuarios intentan editar la misma versión del caso y uno ya guardó
- **THEN** el segundo recibe un aviso de conflicto y puede revisar la versión vigente sin sobrescribir la primera edición

### Requirement: Estados y resolución
El sistema SHALL admitir Nuevo, En proceso, Pendiente logística, Pendiente ventas, Resuelto y Cerrado. SHALL solicitar la respuesta de fondo al resolver y permitir el cierre únicamente desde Resuelto.

#### Scenario: Resolución y cierre
- **WHEN** el agente responsable o el coordinador registra la respuesta y cambia el caso a Resuelto
- **THEN** el sistema registra la resolución y permite un cierre posterior sin alterar la fecha de resolución

### Requirement: Historial de atención
El sistema SHALL agregar un evento al historial con actor, hora, acción y valores anteriores y nuevos aplicables por cada radicación, migración, reasignación o cambio de estado confirmado. La aplicación SHALL exponer un historial de solo lectura a usuarios autorizados.

#### Scenario: Seguimiento de cambios
- **WHEN** se consulta un caso que fue radicado, reasignado y resuelto
- **THEN** se ven los tres eventos en orden cronológico con sus respectivos actores y fechas
