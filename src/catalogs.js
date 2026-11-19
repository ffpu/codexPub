export const channels = { llamada: 'Llamada telefónica', correo: 'Correo electrónico', mensajeria: 'Mensajería' };
export const categories = { stock: 'Consulta de stock', pedido: 'Estado del pedido', envio: 'Inconformidad de envío', facturacion: 'Facturación y cobro', devolucion: 'Devolución' };
export const states = { nuevo: 'Nuevo', proceso: 'En proceso', logistica: 'Pendiente logística', ventas: 'Pendiente ventas', resuelto: 'Resuelto', cerrado: 'Cerrado' };
export const openStates = ['nuevo', 'proceso', 'logistica', 'ventas'];
export const limitMs = 48 * 60 * 60 * 1000;

export const string = value => typeof value === 'string' ? value.trim() : '';

export function validateFields(data) {
  const record = {
    nit: string(data?.nit), channel: string(data?.channel), category: string(data?.category),
    description: string(data?.description), order_ref: string(data?.order_ref) || null
  };
  const fields = {};
  if (!record.nit || record.nit.length > 40) fields.nit = 'Selecciona un cliente del directorio.';
  if (!Object.hasOwn(channels, record.channel)) fields.channel = 'Selecciona el canal de origen.';
  if (!Object.hasOwn(categories, record.category)) fields.category = 'Selecciona el tipo de solicitud.';
  if (record.description.length < 10 || record.description.length > 5000) fields.description = 'Escribe entre 10 y 5000 caracteres.';
  if (record.order_ref?.length > 100) fields.order_ref = 'Usa máximo 100 caracteres.';
  return { record, fields };
}
