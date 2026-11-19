CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('agente','coordinador')),
  password_hash text NOT NULL,
  available boolean NOT NULL DEFAULT false
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expires ON sessions(expires_at);
CREATE TABLE customers (
  nit text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE assignment (
  id integer PRIMARY KEY CHECK (id=1),
  last_agent text REFERENCES users(id)
);
INSERT INTO assignment (id) VALUES (1);
CREATE TABLE counters (
  month text PRIMARY KEY,
  last_number integer NOT NULL CHECK (last_number BETWEEN 1 AND 9999)
);
CREATE TABLE requests (
  ticket text PRIMARY KEY,
  nit text NOT NULL REFERENCES customers(nit),
  channel text NOT NULL CHECK (channel IN ('llamada','correo','mensajeria')),
  category text NOT NULL CHECK (category IN ('stock','pedido','envio','facturacion','devolucion')),
  description text NOT NULL CHECK (length(description)>=10),
  order_ref text,
  agent_id text NOT NULL REFERENCES users(id),
  state text NOT NULL CHECK (state IN ('nuevo','proceso','logistica','ventas','resuelto','cerrado')),
  received_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  resolved_at timestamptz,
  response text,
  elapsed_ms bigint,
  compliant boolean,
  version integer NOT NULL DEFAULT 1,
  source_ref text UNIQUE,
  imported_at timestamptz,
  CHECK ((state IN ('resuelto','cerrado')) = (resolved_at IS NOT NULL)),
  CHECK ((source_ref IS NULL) = (imported_at IS NULL))
);
CREATE INDEX requests_received ON requests(received_at DESC, ticket DESC);
CREATE INDEX requests_agent ON requests(agent_id);
CREATE INDEX requests_state ON requests(state);
CREATE INDEX requests_resolved ON requests(resolved_at) WHERE resolved_at IS NOT NULL;
CREATE TABLE events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket text NOT NULL REFERENCES requests(ticket),
  actor_id text NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL,
  action text NOT NULL,
  before_values jsonb,
  after_values jsonb,
  note text
);
CREATE INDEX events_ticket_order ON events(ticket, occurred_at, id);
CREATE FUNCTION keep_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El historial de atención es de solo lectura';
END;
$$;
CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON events
FOR EACH STATEMENT EXECUTE FUNCTION keep_history();
CREATE TABLE idempotency (
  actor_id text NOT NULL REFERENCES users(id),
  key text NOT NULL,
  payload_hash text NOT NULL,
  ticket text NOT NULL REFERENCES requests(ticket),
  PRIMARY KEY (actor_id,key)
);
CREATE TABLE deployment (
  id integer PRIMARY KEY CHECK (id=1),
  mode text NOT NULL CHECK (mode IN ('demo','pilot'))
);
