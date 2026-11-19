# Seguimiento de plazos

## Purpose

Hace visible el plazo de atención en la bandeja y permite medir el cumplimiento a partir de la recepción real de cada solicitud.

## ADDED Requirements

### Requirement: Indicador de 48 horas corridas
La bandeja SHALL mostrar el tiempo restante para cada solicitud abierta y distinguir las vencidas. El plazo SHALL calcularse desde la recepción original, incluidos fines de semana y festivos, y SHALL continuar durante las esperas de logística o ventas.

#### Scenario: Límite del plazo
- **WHEN** una solicitud abierta lleva 47 horas y 59 minutos desde su recepción
- **THEN** la bandeja muestra el tiempo restante y la marca como vencida cuando transcurren más de 48 horas

#### Scenario: Pendiente importado ya vencido
- **WHEN** se consulta una solicitud que se importó con fecha de recepción de hace 50 horas
- **THEN** aparece vencida desde la primera consulta

### Requirement: Resultado al resolver
El sistema SHALL calcular la duración entre la recepción y la resolución, usando el tiempo transcurrido exacto antes de aplicar redondeos de pantalla. SHALL registrar cumplimiento si la duración es menor o igual a 48 horas corridas.

#### Scenario: Resolución en el límite
- **WHEN** un caso se resuelve exactamente 48 horas después de su recepción
- **THEN** el sistema registra 48 horas y confirma que cumplió el plazo

#### Scenario: Resolución tardía
- **WHEN** un caso se resuelve 48 horas y un segundo después de su recepción
- **THEN** el sistema registra el resultado como incumplido

### Requirement: Medición del cumplimiento
El sistema SHALL permitir que el coordinador consulte para un periodo el total de solicitudes resueltas y la proporción que cumplió 48 horas. SHALL mostrar un resultado sin datos cuando el total de resueltas sea cero.

#### Scenario: Cálculo del periodo
- **WHEN** un periodo contiene diez resoluciones, nueve de ellas en 48 horas o menos, y dos casos aún abiertos
- **THEN** el coordinador ve nueve de diez resueltas dentro del plazo y un cumplimiento del 90 %
