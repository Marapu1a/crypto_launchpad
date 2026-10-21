CREATE SCHEMA IF NOT EXISTS monitor_alerts;
CREATE TABLE IF NOT EXISTS monitor_alerts.sessions (
 digest text PRIMARY KEY, owner text UNIQUE NOT NULL, expires bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_alerts.rules (
 owner text NOT NULL, target text NOT NULL, minimum numeric NOT NULL CHECK(minimum>=0),
 new_token boolean NOT NULL, push boolean NOT NULL, telegram boolean NOT NULL,
 created_at bigint NOT NULL, PRIMARY KEY(owner,target)
);
CREATE TABLE IF NOT EXISTS monitor_alerts.devices (
 id text PRIMARY KEY, owner text NOT NULL, subscription jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_alerts.chats (owner text PRIMARY KEY, chat text UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS monitor_alerts.links (digest text PRIMARY KEY, owner text UNIQUE NOT NULL, expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS monitor_alerts.seen (owner text, target text, token text, PRIMARY KEY(owner,target,token));
CREATE TABLE IF NOT EXISTS monitor_alerts.cursor (name text PRIMARY KEY, value bigint NOT NULL);
CREATE TABLE IF NOT EXISTS monitor_alerts.outbox (
 id bigserial PRIMARY KEY, event_key text NOT NULL, owner text NOT NULL, target text NOT NULL,
 channel text NOT NULL, destination text NOT NULL, payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 retry_at bigint NOT NULL DEFAULT 0, created_at bigint NOT NULL,
 UNIQUE(event_key,owner,channel,destination)
);

CREATE TABLE IF NOT EXISTS monitor_alerts.languages (owner text PRIMARY KEY, language text NOT NULL CHECK(language IN ('en','ru','zh')));
CREATE TABLE IF NOT EXISTS monitor_alerts.chat_languages (chat text PRIMARY KEY, language text NOT NULL CHECK(language IN ('en','ru','zh')));
ALTER TABLE monitor_alerts.links ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'ru' CHECK(language IN ('en','ru','zh'));
