INSERT INTO customers(nit,name) VALUES
('900123456','Colegio Los Cedros'),
('901090032','Grupo Litoral'),
('800241009','Centro Educativo Horizonte'),
('900785610','Estudio Cerezo'),
('901432781','Papelería Norte'),
('800039910','Fundación Manos Abiertas')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  this_month text := to_char(now() AT TIME ZONE 'America/Bogota','YYYYMM');
  demo_ref text;
  seed record;
  received timestamptz;
  resolved timestamptz;
BEGIN
  IF EXISTS (SELECT 1 FROM requests) THEN RETURN; END IF;
  FOR seed IN SELECT * FROM (VALUES
    (1,'900123456','correo','pedido','Confirmar la fecha de entrega del pedido de resmas.','PED-1058','agente1','nuevo',3),
    (2,'901090032','llamada','stock','Consultar existencias de carpetas tamaño oficio.','PED-1054','agente2','proceso',11),
    (3,'800241009','mensajeria','envio','Faltan tres cajas de marcadores en el envío recibido.','PED-1044','agente3','logistica',28),
    (4,'900785610','correo','facturacion','Solicitan corrección en la factura del último envío.','PED-1040','agente4','ventas',43),
    (5,'901432781','llamada','devolucion','Gestionar la devolución de un paquete de archivadores.','PED-1027','agente1','proceso',52),
    (6,'800039910','correo','pedido','Solicitan información sobre un despacho programado.','PED-1020','agente2','nuevo',57),
    (7,'900123456','mensajeria','stock','Necesitan confirmar disponibilidad de papel de color.','PED-1019','agente3','resuelto',63),
    (8,'901090032','correo','envio','Confirmar la entrega de los sobres y etiquetas.','PED-1007','agente4','cerrado',75)
  ) AS example(n,nit,channel,category,description,order_ref,agent_id,state,age)
  LOOP
    demo_ref := 'AUR-' || this_month || '-' || lpad(seed.n::text,4,'0');
    received := now() - make_interval(hours => seed.age);
    resolved := CASE WHEN seed.state IN ('resuelto','cerrado') THEN received + interval '25 hours' END;
    INSERT INTO requests(ticket,nit,channel,category,description,order_ref,agent_id,state,received_at,issued_at,resolved_at,response,elapsed_ms,compliant)
    VALUES (demo_ref,seed.nit,seed.channel,seed.category,seed.description,seed.order_ref,seed.agent_id,seed.state,received,received,resolved,
      CASE WHEN resolved IS NOT NULL THEN 'Se confirmó la información al cliente.' END,
      CASE WHEN resolved IS NOT NULL THEN 90000000 END,CASE WHEN resolved IS NOT NULL THEN true END);
    INSERT INTO events(ticket,actor_id,occurred_at,action,after_values)
    VALUES (demo_ref,'coord',received,'radicacion',jsonb_build_object('state','nuevo','agent_id',seed.agent_id));
    IF seed.state IN ('proceso','ventas','logistica') THEN
      INSERT INTO events(ticket,actor_id,occurred_at,action,before_values,after_values)
      VALUES (demo_ref,seed.agent_id,received+interval '1 hour','estado','{"state":"nuevo"}',jsonb_build_object('state',seed.state));
    ELSIF resolved IS NOT NULL THEN
      INSERT INTO events(ticket,actor_id,occurred_at,action,before_values,after_values,note)
      VALUES (demo_ref,seed.agent_id,resolved,'estado','{"state":"nuevo"}','{"state":"resuelto"}','Se confirmó la información al cliente.');
      IF seed.state='cerrado' THEN
        INSERT INTO events(ticket,actor_id,occurred_at,action,before_values,after_values)
        VALUES (demo_ref,seed.agent_id,resolved+interval '1 hour','estado','{"state":"resuelto"}','{"state":"cerrado"}');
      END IF;
    END IF;
  END LOOP;
  INSERT INTO counters VALUES (this_month,8) ON CONFLICT (month) DO UPDATE SET last_number=GREATEST(counters.last_number, EXCLUDED.last_number);
END $$;
