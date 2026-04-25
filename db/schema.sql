-- ============================================================
-- J&J Power EMS · PostgreSQL 16 + TimescaleDB Schema
-- Version: 1.0  ·  Last updated: 2026-04-25
-- Run order: this file → seed.sql
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";        -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "timescaledb";     -- hypertables
CREATE EXTENSION IF NOT EXISTS "pg_trgm";         -- fuzzy text search

-- ============================================================
-- A. Multi-tenant + auth
-- ============================================================

CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  legal_name    TEXT,
  tax_id        TEXT,
  contact_email TEXT,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TYPE user_role_kind AS ENUM ('admin', 'operator', 'manager', 'viewer');

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT,
  locale          TEXT DEFAULT 'zh-TW',
  mfa_secret      TEXT,
  active          BOOLEAN DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_users_org ON users(org_id);

CREATE TABLE sites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  address         TEXT,
  lat             DECIMAL(9,6),
  lon             DECIMAL(9,6),
  contract_kw     INTEGER,
  tariff_plan_id  UUID,                                      -- FK added later
  industry        TEXT,
  pv_kwp          DECIMAL(8,2),
  timezone        TEXT DEFAULT 'Asia/Taipei',
  active_strategy_id UUID,                                   -- FK added later
  active          BOOLEAN DEFAULT TRUE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sites_org ON sites(org_id);

CREATE TABLE user_roles (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      user_role_kind NOT NULL,
  site_id   UUID REFERENCES sites(id) ON DELETE CASCADE,    -- NULL = all sites
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, role, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::UUID))
);

CREATE TABLE api_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  scopes        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  expires_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_api_tokens_org ON api_tokens(org_id);

CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address    INET,
  user_agent    TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ DEFAULT NOW(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  org_id        UUID REFERENCES organizations(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  ip_address    INET,
  user_agent    TEXT,
  payload       JSONB
);
CREATE INDEX idx_audit_logs_user_ts ON audit_logs(user_id, ts DESC);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);

-- ============================================================
-- B. Site / Cabinet hierarchy
-- ============================================================

CREATE TABLE cabinet_models (
  model_code        TEXT PRIMARY KEY,
  series            TEXT NOT NULL,
  variant           TEXT NOT NULL CHECK (variant IN ('wide','narrow')),
  pcs_rated_kw      DECIMAL(7,2) NOT NULL,
  pcs_max_kw        DECIMAL(7,2),
  battery_kwh       DECIMAL(8,3) NOT NULL,
  battery_chemistry TEXT DEFAULT 'LFP',
  cell_config       TEXT,
  nominal_voltage   DECIMAL(6,2),
  c_rate            DECIMAL(3,2),
  has_mppt          BOOLEAN DEFAULT FALSE,
  mppt_kw           INTEGER,
  has_sts           BOOLEAN DEFAULT FALSE,
  has_transformer   BOOLEAN DEFAULT FALSE,
  width_mm          INTEGER,
  depth_mm          INTEGER,
  height_mm         INTEGER,
  weight_kg         INTEGER,
  ip_battery        TEXT,
  ip_electrical     TEXT,
  description       TEXT,
  spec_doc_url      TEXT
);

CREATE TABLE cabinets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  model_code        TEXT NOT NULL REFERENCES cabinet_models(model_code),
  serial_number     TEXT UNIQUE,
  install_date      DATE,
  warranty_until    DATE,
  position          TEXT,
  ip_address        INET,
  modbus_unit_id    INTEGER,
  firmware_version  TEXT,
  active            BOOLEAN DEFAULT TRUE,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(site_id, code)
);
CREATE INDEX idx_cabinets_site ON cabinets(site_id);

CREATE TYPE device_kind AS ENUM (
  'pcs','bcu','bmu','meter','hvac','fire','door','pv_inverter','sts','transformer','controller'
);

CREATE TABLE devices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id        UUID REFERENCES cabinets(id) ON DELETE CASCADE,
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  type              device_kind NOT NULL,
  code              TEXT NOT NULL,
  vendor            TEXT,
  model             TEXT,
  serial_number     TEXT,
  ip_address        INET,
  modbus_unit_id    INTEGER,
  protocol          TEXT,
  parent_device_id  UUID REFERENCES devices(id) ON DELETE SET NULL,
  metadata          JSONB DEFAULT '{}',
  status            TEXT DEFAULT 'unknown',
  last_seen_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_devices_cabinet ON devices(cabinet_id);
CREATE INDEX idx_devices_site_type ON devices(site_id, type);
CREATE INDEX idx_devices_metadata ON devices USING GIN (metadata);

CREATE TABLE packs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id    UUID NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  pack_index    INTEGER NOT NULL,
  bmu_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  cell_count    INTEGER NOT NULL DEFAULT 16,
  UNIQUE(cabinet_id, pack_index)
);

CREATE TABLE cells (
  id            BIGSERIAL PRIMARY KEY,
  pack_id       UUID NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  cell_index    INTEGER NOT NULL,
  global_index  INTEGER NOT NULL,
  UNIQUE(pack_id, cell_index)
);
CREATE INDEX idx_cells_pack ON cells(pack_id);

-- Modbus point catalogue
CREATE TABLE modbus_points (
  id              BIGSERIAL PRIMARY KEY,
  device_type     device_kind NOT NULL,
  vendor          TEXT,
  model           TEXT,
  name_zh         TEXT NOT NULL,
  name_en         TEXT,
  address         INTEGER NOT NULL,
  function_code   SMALLINT NOT NULL,
  data_type       TEXT NOT NULL,
  scale           DECIMAL(10,4) DEFAULT 1.0,
  unit            TEXT,
  description     TEXT,
  writable        BOOLEAN DEFAULT FALSE,
  UNIQUE(device_type, vendor, model, address)
);

-- ============================================================
-- C. Strategies & Schedule
-- ============================================================

CREATE TABLE strategies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID REFERENCES organizations(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  color         TEXT,
  params        JSONB NOT NULL DEFAULT '{}',
  is_system     BOOLEAN DEFAULT FALSE,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, code)
);
CREATE INDEX idx_strategies_params ON strategies USING GIN (params);

-- Now we can wire the FK from sites
ALTER TABLE sites ADD CONSTRAINT fk_sites_strategy
  FOREIGN KEY (active_strategy_id) REFERENCES strategies(id) ON DELETE SET NULL;

CREATE TYPE sched_mode AS ENUM ('charge','discharge','idle');

CREATE TABLE schedule_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  effective_date  DATE NOT NULL,
  hour            SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  mode            sched_mode NOT NULL,
  target_kw       DECIMAL(7,2) NOT NULL,
  label           TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(site_id, effective_date, hour)
);
CREATE INDEX idx_schedule_overrides_site_date ON schedule_overrides(site_id, effective_date);

CREATE TABLE strategy_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  strategy_id   UUID NOT NULL REFERENCES strategies(id),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  changed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_via   TEXT
);
CREATE INDEX idx_strategy_runs_site_started ON strategy_runs(site_id, started_at DESC);

CREATE TABLE dispatch_commands (
  id            BIGSERIAL,
  ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cabinet_id    UUID NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  device_id     UUID REFERENCES devices(id),
  command_type  TEXT NOT NULL,
  value         DECIMAL(10,3),
  source        TEXT,
  issued_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  ack_status    TEXT DEFAULT 'pending',
  ack_ts        TIMESTAMPTZ,
  error_msg     TEXT,
  PRIMARY KEY (id, ts)
);
SELECT create_hypertable('dispatch_commands', 'ts', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX idx_dispatch_commands_cabinet_ts ON dispatch_commands(cabinet_id, ts DESC);

-- ============================================================
-- D. Telemetry (TimescaleDB hypertables)
-- ============================================================

CREATE TABLE telemetry_cabinet_1s (
  ts              TIMESTAMPTZ NOT NULL,
  cabinet_id      UUID NOT NULL,
  pcs_p_kw        REAL,
  pcs_q_kvar      REAL,
  dc_voltage      REAL,
  dc_current      REAL,
  ac_voltage      REAL,
  frequency       REAL,
  soc             REAL,
  soh             REAL,
  temp_avg        REAL,
  temp_max        REAL,
  temp_min        REAL,
  insulation_kohm REAL,
  efficiency_pct  REAL,
  status_bitmap   INTEGER
);
SELECT create_hypertable('telemetry_cabinet_1s', 'ts', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX idx_telemetry_cabinet_1s_cabinet ON telemetry_cabinet_1s(cabinet_id, ts DESC);
ALTER TABLE telemetry_cabinet_1s SET (timescaledb.compress, timescaledb.compress_segmentby = 'cabinet_id');
SELECT add_compression_policy('telemetry_cabinet_1s', INTERVAL '7 days');
SELECT add_retention_policy('telemetry_cabinet_1s', INTERVAL '90 days');

CREATE TABLE telemetry_cell_30s (
  ts                  TIMESTAMPTZ NOT NULL,
  cabinet_id          UUID NOT NULL,
  cell_global_index   SMALLINT NOT NULL,
  voltage_mv          SMALLINT,
  temp_c10            SMALLINT,
  balancing           BOOLEAN
);
SELECT create_hypertable('telemetry_cell_30s', 'ts', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX idx_telemetry_cell_30s_cabinet ON telemetry_cell_30s(cabinet_id, ts DESC);
ALTER TABLE telemetry_cell_30s SET (timescaledb.compress, timescaledb.compress_segmentby = 'cabinet_id');
SELECT add_compression_policy('telemetry_cell_30s', INTERVAL '7 days');
SELECT add_retention_policy('telemetry_cell_30s', INTERVAL '30 days');

CREATE TABLE telemetry_meter_1m (
  ts                  TIMESTAMPTZ NOT NULL,
  device_id           UUID NOT NULL,
  p_kw                REAL,
  q_kvar              REAL,
  pf                  REAL,
  voltage_avg         REAL,
  frequency           REAL,
  import_kwh_cumul    DOUBLE PRECISION,
  export_kwh_cumul    DOUBLE PRECISION,
  max_demand_15min    REAL
);
SELECT create_hypertable('telemetry_meter_1m', 'ts', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX idx_telemetry_meter_1m_device ON telemetry_meter_1m(device_id, ts DESC);
ALTER TABLE telemetry_meter_1m SET (timescaledb.compress, timescaledb.compress_segmentby = 'device_id');
SELECT add_compression_policy('telemetry_meter_1m', INTERVAL '30 days');

CREATE TABLE telemetry_pv_1m (
  ts              TIMESTAMPTZ NOT NULL,
  device_id       UUID NOT NULL,
  ac_p_kw         REAL,
  dc_voltage      REAL,
  dc_current      REAL,
  daily_kwh       REAL,
  irradiance_w_m2 REAL
);
SELECT create_hypertable('telemetry_pv_1m', 'ts', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX idx_telemetry_pv_1m_device ON telemetry_pv_1m(device_id, ts DESC);

-- Continuous aggregate: 15-min summary for dashboard
CREATE MATERIALIZED VIEW telemetry_cabinet_15m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('15 minutes', ts) AS bucket,
  cabinet_id,
  AVG(pcs_p_kw)::REAL    AS avg_p_kw,
  MAX(pcs_p_kw)::REAL    AS max_p_kw,
  MIN(pcs_p_kw)::REAL    AS min_p_kw,
  AVG(soc)::REAL         AS avg_soc,
  MAX(temp_max)::REAL    AS peak_temp,
  MIN(temp_min)::REAL    AS lowest_temp,
  COUNT(*)               AS sample_count
FROM telemetry_cabinet_1s
GROUP BY bucket, cabinet_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_cabinet_15m',
  start_offset      => INTERVAL '2 hours',
  end_offset        => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '5 minutes');

-- ============================================================
-- E. Alarms
-- ============================================================

CREATE TYPE alarm_severity AS ENUM ('info','warning','error','critical');
CREATE TYPE alarm_state    AS ENUM ('active','acked','cleared');

CREATE TABLE alarm_definitions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT UNIQUE NOT NULL,
  name_zh             TEXT NOT NULL,
  name_en             TEXT,
  severity            alarm_severity NOT NULL,
  category            TEXT,
  auto_action         TEXT,
  description         TEXT,
  recommended_action  TEXT
);

CREATE TABLE alarm_events (
  id            BIGSERIAL,
  ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  device_id     UUID REFERENCES devices(id) ON DELETE SET NULL,
  alarm_def_id  UUID NOT NULL REFERENCES alarm_definitions(id),
  severity      alarm_severity NOT NULL,
  state         alarm_state NOT NULL DEFAULT 'active',
  value         DECIMAL(10,3),
  threshold     DECIMAL(10,3),
  metadata      JSONB DEFAULT '{}',
  PRIMARY KEY (id, ts)
);
SELECT create_hypertable('alarm_events', 'ts', chunk_time_interval => INTERVAL '30 days');
CREATE INDEX idx_alarm_events_state ON alarm_events(state, severity, ts DESC) WHERE state = 'active';
CREATE INDEX idx_alarm_events_site_ts ON alarm_events(site_id, ts DESC);

CREATE TABLE alarm_acks (
  event_id      BIGINT NOT NULL,
  event_ts      TIMESTAMPTZ NOT NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  ts            TIMESTAMPTZ DEFAULT NOW(),
  comment       TEXT,
  PRIMARY KEY (event_id, event_ts)
);

-- ============================================================
-- F. Financials
-- ============================================================

CREATE TYPE tariff_period_kind AS ENUM ('peak','mid_peak','off_peak');

CREATE TABLE tariff_plans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  effective_from        DATE NOT NULL,
  effective_until       DATE,
  basic_charge_per_kw   DECIMAL(6,2),
  metadata              JSONB DEFAULT '{}'
);

CREATE TABLE tariff_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         UUID NOT NULL REFERENCES tariff_plans(id) ON DELETE CASCADE,
  period_type     tariff_period_kind NOT NULL,
  weekday_mask    SMALLINT NOT NULL DEFAULT 127,         -- bit0 Mon, bit6 Sun
  start_hour      SMALLINT NOT NULL CHECK (start_hour BETWEEN 0 AND 24),
  end_hour        SMALLINT NOT NULL CHECK (end_hour BETWEEN 0 AND 24),
  price_per_kwh   DECIMAL(6,3) NOT NULL
);
CREATE INDEX idx_tariff_periods_plan ON tariff_periods(plan_id);

ALTER TABLE sites ADD CONSTRAINT fk_sites_tariff
  FOREIGN KEY (tariff_plan_id) REFERENCES tariff_plans(id) ON DELETE SET NULL;

CREATE TABLE billing_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  month           DATE NOT NULL,                          -- YYYY-MM-01
  basic_charge    DECIMAL(10,2) DEFAULT 0,
  energy_charge   DECIMAL(10,2) DEFAULT 0,
  penalty         DECIMAL(10,2) DEFAULT 0,
  total           DECIMAL(10,2) DEFAULT 0,
  max_demand_kw   DECIMAL(7,2),
  total_kwh       DECIMAL(10,2),
  co2_kg          DECIMAL(10,2),
  issued_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(site_id, month)
);

CREATE TABLE savings_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_period_id   UUID NOT NULL REFERENCES billing_periods(id) ON DELETE CASCADE,
  basic_saved         DECIMAL(10,2) DEFAULT 0,
  penalty_avoided     DECIMAL(10,2) DEFAULT 0,
  arbitrage_revenue   DECIMAL(10,2) DEFAULT 0,
  sreg_revenue        DECIMAL(10,2) DEFAULT 0,
  afc_revenue         DECIMAL(10,2) DEFAULT 0,
  total_saved         DECIMAL(10,2) GENERATED ALWAYS AS
    (basic_saved + penalty_avoided + arbitrage_revenue + sreg_revenue + afc_revenue) STORED,
  cycles_count        DECIMAL(5,2)
);

CREATE TABLE capex_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  item                TEXT NOT NULL,
  amount              DECIMAL(12,2) NOT NULL,
  paid_date           DATE,
  depreciation_years  SMALLINT DEFAULT 15,
  salvage_value_pct   DECIMAL(4,2) DEFAULT 8.0,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_capex_records_site ON capex_records(site_id);

-- ============================================================
-- G. Forecasts & Optimization
-- ============================================================

CREATE TABLE load_forecasts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  forecast_for      TIMESTAMPTZ NOT NULL,
  horizon_h         SMALLINT NOT NULL,
  predicted_kw      REAL NOT NULL,
  confidence_low    REAL,
  confidence_high   REAL,
  model_name        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_load_forecasts_site_for ON load_forecasts(site_id, forecast_for DESC);

CREATE TABLE pv_forecasts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  forecast_for      TIMESTAMPTZ NOT NULL,
  horizon_h         SMALLINT NOT NULL,
  predicted_kw      REAL NOT NULL,
  irradiance_w_m2   REAL,
  cloud_cover       REAL,
  model_name        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_pv_forecasts_site_for ON pv_forecasts(site_id, forecast_for DESC);

CREATE TABLE weather_observations (
  ts            TIMESTAMPTZ NOT NULL,
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  temperature   REAL,
  humidity      REAL,
  irradiance    REAL,
  cloud_cover   REAL,
  wind_speed    REAL,
  source        TEXT
);
SELECT create_hypertable('weather_observations', 'ts', chunk_time_interval => INTERVAL '30 days');
CREATE INDEX idx_weather_site ON weather_observations(site_id, ts DESC);

CREATE TABLE optimization_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  triggered_at      TIMESTAMPTZ DEFAULT NOW(),
  solver            TEXT,
  objective         TEXT,
  input_params      JSONB,
  output_schedule   JSONB,
  solve_time_ms     INTEGER,
  status            TEXT
);
CREATE INDEX idx_optimization_runs_site ON optimization_runs(site_id, triggered_at DESC);

-- ============================================================
-- H. External integrations
-- ============================================================

CREATE TABLE tpc_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at     TIMESTAMPTZ DEFAULT NOW(),
  event_id        TEXT,
  event_type      TEXT,                                   -- 'sreg','dr_program','dispatch'
  start_at        TIMESTAMPTZ,
  end_at          TIMESTAMPTZ,
  target_kw       DECIMAL(8,2),
  price_per_kwh   DECIMAL(6,3),
  status          TEXT DEFAULT 'pending',
  compliance_pct  DECIMAL(5,2),
  metadata        JSONB
);
CREATE INDEX idx_tpc_signals_status ON tpc_signals(status, start_at DESC);

CREATE TABLE openrouter_credits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts            TIMESTAMPTZ DEFAULT NOW(),
  org_id        UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  model         TEXT,
  prompt_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd      DECIMAL(10,6)
);
CREATE INDEX idx_openrouter_credits_org_ts ON openrouter_credits(org_id, ts DESC);

-- ============================================================
-- Row Level Security (basic policies)
-- ============================================================

-- Helper function: set per-session context
-- Application sets:
--   SET LOCAL app.current_user_id = '...';
--   SET LOCAL app.current_org_id  = '...';

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY sites_org_isolation ON sites
  USING (org_id::text = current_setting('app.current_org_id', TRUE));

ALTER TABLE cabinets ENABLE ROW LEVEL SECURITY;
CREATE POLICY cabinets_via_site ON cabinets
  USING (site_id IN (SELECT id FROM sites));

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY devices_via_site ON devices
  USING (site_id IN (SELECT id FROM sites));

-- Repeat for other org-scoped tables in production deployment.

-- ============================================================
-- Helpful views
-- ============================================================

CREATE OR REPLACE VIEW v_active_alarms AS
SELECT
  e.id, e.ts, e.severity, e.state, e.value, e.threshold,
  s.code AS site_code, s.name AS site_name,
  d.code AS device_code, d.type AS device_type,
  ad.code AS alarm_code, ad.name_zh AS alarm_name, ad.recommended_action
FROM alarm_events e
JOIN alarm_definitions ad ON ad.id = e.alarm_def_id
JOIN sites s ON s.id = e.site_id
LEFT JOIN devices d ON d.id = e.device_id
WHERE e.state = 'active'
ORDER BY e.severity DESC, e.ts DESC;

CREATE OR REPLACE VIEW v_site_realtime AS
SELECT
  s.id        AS site_id,
  s.name      AS site_name,
  c.code      AS cabinet_code,
  t.ts        AS last_ts,
  t.pcs_p_kw, t.soc, t.temp_max, t.temp_min, t.insulation_kohm
FROM sites s
JOIN cabinets c ON c.site_id = s.id
LEFT JOIN LATERAL (
  SELECT * FROM telemetry_cabinet_1s
  WHERE cabinet_id = c.id
  ORDER BY ts DESC LIMIT 1
) t ON TRUE;

-- ============================================================
-- Done.
-- Next: run seed.sql to populate cabinet_models, strategies,
-- tariff_plans + periods, and demo organization+site+cabinets.
-- ============================================================
