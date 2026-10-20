CREATE SCHEMA IF NOT EXISTS monitor_billing;
CREATE TABLE IF NOT EXISTS monitor_billing.challenges (
 id text PRIMARY KEY, wallet text NOT NULL, message text NOT NULL, expires_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_billing.sessions (
 digest text PRIMARY KEY, wallet text NOT NULL, expires_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_billing.entitlements (
 wallet text PRIMARY KEY, expires_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_billing.invoices (
 id uuid PRIMARY KEY, wallet text NOT NULL, plan text NOT NULL,
 usd_cents integer NOT NULL, rate_usd text NOT NULL, amount_wei numeric(78,0) NOT NULL,
 recipient text NOT NULL, chain_id integer NOT NULL, created_at bigint NOT NULL,
 expires_at bigint NOT NULL, duration_seconds integer NOT NULL,
 state text NOT NULL DEFAULT 'quoted', tx_hash text UNIQUE, reason text,
 settled_at bigint, access_until bigint, last_check_at bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS monitor_invoice_wallet ON monitor_billing.invoices(wallet,created_at DESC);
CREATE TABLE IF NOT EXISTS monitor_billing.payment_attempts (
 tx_hash text PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES monitor_billing.invoices(id),
 observed_at bigint NOT NULL, reason text
);
