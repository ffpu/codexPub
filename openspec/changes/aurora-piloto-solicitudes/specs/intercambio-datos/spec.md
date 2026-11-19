# Intercambio de datos

## Purpose

Permite incorporar el directorio de clientes y los pendientes de la operación anterior, conciliarlos antes del corte y exportar los datos operativos a un formato portable.

## ADDED Requirements

### Requirement: Importación del directorio de clientes
El sistema SHALL permitir al coordinador importar clientes desde JSON o CSV con NIT y razón social. SHALL tratar el NIT como texto, usarlo como identificador del directorio y presentar las filas inválidas o ambiguas antes de confirmar la carga.

#### Scenario: Directorio con NIT repetido
- **WHEN** el archivo contiene dos filas con el mismo NIT y nombres que difieren
- **THEN** la previsualización identifica las filas y conserva el directorio vigente hasta confirmar una carga corregida

#### Scenario: Cliente disponible para radicación
- **WHEN** el coordinador confirma un directorio válido
- **THEN** el agente puede localizar al cliente importado por NIT o razón social en el formulario de radicación

### Requirement: Ensayo y conciliación de pendientes
El sistema SHALL ofrecer un ensayo sin escrituras y un reporte por fila que muestre casos listos, duplicados y excepciones, con un total conciliable con la hoja. SHALL requerir fecha original válida, cliente identificado y responsable válido para cargar una solicitud al piloto.

#### Scenario: Pendiente incompleto
- **WHEN** la hoja contiene un caso sin fecha válida o sin responsable identificable
- **THEN** el reporte identifica la fila y su motivo para que el coordinador la corrija antes de autorizar el corte

### Requirement: Carga definitiva de pendientes
El sistema SHALL importar solo solicitudes abiertas confirmadas, conservar su fecha original de recepción y registrar la procedencia y la fecha de importación. SHALL identificar el registro de origen para impedir duplicados si se reintenta la carga.

#### Scenario: Pendiente importado
- **WHEN** el coordinador confirma la importación de una fila válida que representa un caso abierto
- **THEN** la bandeja muestra el caso con un radicado interno, su fecha original, estado y responsable conciliados y un evento de migración

#### Scenario: Reintento de una carga
- **WHEN** el coordinador reintenta una carga que contiene una fila previamente importada con la misma referencia de origen
- **THEN** se informa que la fila ya fue cargada y se conserva el radicado existente

### Requirement: Exportación lógica en JSON
El sistema SHALL permitir al coordinador descargar un JSON estructurado con la versión del formato, fecha de exportación, clientes, solicitudes, actores referenciados e historial. SHALL excluir contraseñas, credenciales y secretos de infraestructura.

#### Scenario: Exportación para revisión
- **WHEN** el coordinador solicita la exportación
- **THEN** recibe un archivo JSON legible con las relaciones entre registros y sus eventos, sin material de autenticación
