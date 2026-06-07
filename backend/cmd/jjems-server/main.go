package main

import (
	"context"
	"crypto/subtle"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultListen      = "0.0.0.0:8088"
	defaultStaticRoot  = "."
	defaultDatabaseURL = "postgres://ems:ems_dev_only_change_me@localhost:5432/ems"
	defaultDatabaseTCP = "127.0.0.1:5432"
	defaultMQTT        = "127.0.0.1:1883"
	defaultModbusHost  = "192.168.1.100"
	defaultModbusPort  = 502
	defaultAuditLog    = "logs/hiems_command_audit.jsonl"
	defaultMaxPowerKW  = 3.0
	defaultTCPTimeout  = 1500 * time.Millisecond
	maxCommandBodySize = 32 << 10
)

var requiredSafetyAcks = []string{
	"onsite_operator_present",
	"soc_in_safe_range",
	"no_active_protection_alarm",
	"low_power_test_only",
	"rollback_ready",
}

type config struct {
	Listen       string
	StaticRoot   string
	DatabaseURL  string
	DatabaseAddr string
	MQTTAddr     string
	ModbusHost   string
	ModbusPort   int
	EnableWrites bool
	CommandToken string
	MaxPowerKW   float64
	AuditLog     string
	Timeout      time.Duration
}

type app struct {
	cfg       config
	startedAt time.Time
	static    http.Handler
	db        *pgxpool.Pool
}

type commandSpec struct {
	Label           string        `json:"label"`
	UnitID          byte          `json:"unit_id"`
	FC              byte          `json:"fc"`
	Addr            uint16        `json:"addr"`
	Kind            string        `json:"kind"`
	AllowedValues   []interface{} `json:"-"`
	Scale           float64       `json:"scale,omitempty"`
	EngineeringUnit string        `json:"engineering_unit,omitempty"`
	DefaultAbsLimit float64       `json:"default_abs_limit,omitempty"`
	Pulse           bool          `json:"pulse,omitempty"`
	Description     string        `json:"description"`
}

type commandRequest struct {
	Command    string      `json:"command"`
	Value      interface{} `json:"value"`
	Operator   string      `json:"operator"`
	Reason     string      `json:"reason"`
	DryRun     *bool       `json:"dryRun"`
	Execute    bool        `json:"execute"`
	SafetyAcks []string    `json:"safetyAcks"`
	ClientTS   string      `json:"clientTs"`
	RawBody    interface{} `json:"-"`
}

type commandPlan struct {
	Command           string   `json:"command"`
	Label             string   `json:"label"`
	UnitID            int      `json:"unitId"`
	FC                int      `json:"fc"`
	Addr              int      `json:"addr"`
	Value             any      `json:"value"`
	RawValue          uint16   `json:"rawValue"`
	DryRun            bool     `json:"dryRun"`
	Execute           bool     `json:"execute"`
	MissingSafetyAcks []string `json:"missingSafetyAcks"`
	Operator          string   `json:"operator"`
	Reason            string   `json:"reason"`
	ClientTS          string   `json:"clientTs,omitempty"`
}

var allowlist = map[string]commandSpec{
	"pcs.remote_mode": {
		Label: "PCS 遠程/就地設定", UnitID: 2, FC: 5, Addr: 7, Kind: "coil",
		AllowedValues: []interface{}{float64(0), float64(1), false, true},
		Description:   "1=遠程；0=就地",
	},
	"pcs.standby": {
		Label: "PCS 設備待機", UnitID: 2, FC: 5, Addr: 8, Kind: "coil",
		AllowedValues: []interface{}{float64(0), float64(1), false, true},
		Description:   "1=待機；0=無效",
	},
	"pcs.start": {
		Label: "PCS 設備啟動", UnitID: 2, FC: 5, Addr: 2, Kind: "coil",
		AllowedValues: []interface{}{float64(1), true}, Pulse: true,
		Description: "1=啟動 pulse",
	},
	"pcs.stop": {
		Label: "PCS 設備停機", UnitID: 2, FC: 5, Addr: 3, Kind: "coil",
		AllowedValues: []interface{}{float64(1), true}, Pulse: true,
		Description: "1=停機 pulse",
	},
	"pcs.fault_reset": {
		Label: "PCS 故障復位", UnitID: 2, FC: 5, Addr: 1, Kind: "coil",
		AllowedValues: []interface{}{float64(1), true}, Pulse: true,
		Description: "只在明確故障處置流程使用",
	},
	"pcs.run_mode": {
		Label: "PCS 運行模式選擇", UnitID: 2, FC: 6, Addr: 1, Kind: "enum_register",
		AllowedValues: []interface{}{float64(0), float64(1), float64(2), float64(3), float64(4)},
		Description:   "0=無；1=恒流充電；2=恒壓充電；3=恒功率充電；4=直流恒壓模式",
	},
	"pcs.active_power_kw": {
		Label: "PCS 恒功率有功功率期望", UnitID: 2, FC: 6, Addr: 4, Kind: "scaled_kw_register",
		Scale: 10, EngineeringUnit: "kW", DefaultAbsLimit: 3,
		Description: "raw=kW*10；vendor sheet: 負=放電，正=充電；現場先限制低功率",
	},
	"pcs.reactive_power_kvar": {
		Label: "PCS 恒功率無功功率期望", UnitID: 2, FC: 6, Addr: 5, Kind: "scaled_kvar_register",
		Scale: 10, EngineeringUnit: "kVar", DefaultAbsLimit: 3,
		Description: "raw=kVar*10；非第一階段必要",
	},
}

func main() {
	cfg := loadConfig()
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	ctx := context.Background()
	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("invalid database config", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := db.Ping(ctx); err != nil {
		slog.Warn("database ping failed; DB-backed APIs will return errors until it is reachable", "error", err)
	}

	a := &app{
		cfg:       cfg,
		startedAt: time.Now().UTC(),
		static:    http.FileServer(http.Dir(cfg.StaticRoot)),
		db:        db,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", a.handleHealth)
	mux.HandleFunc("/api/db/health", a.handleDBHealth)
	mux.HandleFunc("/api/system/status", a.handleSystemStatus)
	mux.HandleFunc("/api/sites", a.handleSites)
	mux.HandleFunc("/api/devices", a.handleDevices)
	mux.HandleFunc("/api/cabinets", a.handleCabinets)
	mux.HandleFunc("/api/modbus-points", a.handleModbusPoints)
	mux.HandleFunc("/api/telemetry/status", a.handleTelemetryStatus)
	mux.HandleFunc("/api/telemetry/latest", a.handleTelemetryLatest)
	mux.HandleFunc("/api/telemetry/history", a.handleTelemetryHistory)
	mux.HandleFunc("/api/telemetry/bms-temperature", a.handleTelemetryBMSTemperature)
	mux.HandleFunc("/api/telemetry/gateway-onboarding", a.handleTelemetryGatewayOnboarding)
	mux.HandleFunc("/api/hiems/commands/allowlist", a.handleCommandAllowlist)
	mux.HandleFunc("/api/hiems/commands/health", a.handleCommandHealth)
	mux.HandleFunc("/api/hiems/commands", a.handleCommand)
	mux.HandleFunc("/", a.handleStatic)

	server := &http.Server{
		Addr:              cfg.Listen,
		Handler:           withRequestLog(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	slog.Info("starting jjems server",
		"listen", cfg.Listen,
		"staticRoot", cfg.StaticRoot,
		"writesEnabled", cfg.EnableWrites,
		"database", cfg.DatabaseURL,
		"mqtt", cfg.MQTTAddr,
		"modbus", net.JoinHostPort(cfg.ModbusHost, strconv.Itoa(cfg.ModbusPort)),
	)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func loadConfig() config {
	return config{
		Listen:       envString("JJEMS_LISTEN", defaultListen),
		StaticRoot:   envString("JJEMS_STATIC_ROOT", defaultStaticRoot),
		DatabaseURL:  envString("DATABASE_URL", envString("JJEMS_DATABASE_URL", defaultDatabaseURL)),
		DatabaseAddr: envString("JJEMS_DATABASE_ADDR", defaultDatabaseTCP),
		MQTTAddr:     envString("JJEMS_MQTT_ADDR", defaultMQTT),
		ModbusHost:   envString("JJEMS_MODBUS_HOST", defaultModbusHost),
		ModbusPort:   envInt("JJEMS_MODBUS_PORT", defaultModbusPort),
		EnableWrites: envBool("JJEMS_ENABLE_WRITES", false),
		CommandToken: os.Getenv("JJEMS_COMMAND_TOKEN"),
		MaxPowerKW:   envFloat("JJEMS_COMMAND_MAX_POWER_KW", defaultMaxPowerKW),
		AuditLog:     envString("JJEMS_COMMAND_AUDIT_LOG", defaultAuditLog),
		Timeout:      envDurationMS("JJEMS_TCP_TIMEOUT_MS", defaultTCPTimeout),
	}
}

func (a *app) handleStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "not found"})
		return
	}
	a.static.ServeHTTP(w, r)
}

func (a *app) handleHealth(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"service":   "jjems-server",
		"time":      time.Now().UTC().Format(time.RFC3339Nano),
		"startedAt": a.startedAt.Format(time.RFC3339Nano),
	})
}

func (a *app) handleDBHealth(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	started := time.Now()
	if err := a.db.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":        false,
			"database":  "postgres",
			"latencyMs": time.Since(started).Milliseconds(),
			"error":     err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"database":  "postgres",
		"latencyMs": time.Since(started).Milliseconds(),
	})
}

func (a *app) handleSystemStatus(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	modbusAddr := net.JoinHostPort(a.cfg.ModbusHost, strconv.Itoa(a.cfg.ModbusPort))
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"time":       time.Now().UTC().Format(time.RFC3339Nano),
		"staticRoot": a.cfg.StaticRoot,
		"checks": map[string]any{
			"postgres": tcpCheck(a.cfg.DatabaseAddr, a.cfg.Timeout),
			"mqtt":     tcpCheck(a.cfg.MQTTAddr, a.cfg.Timeout),
			"modbus":   tcpCheck(modbusAddr, a.cfg.Timeout),
		},
		"commands": map[string]any{
			"writesEnabled":   a.cfg.EnableWrites,
			"tokenConfigured": a.cfg.CommandToken != "",
			"auditLog":        a.cfg.AuditLog,
		},
	})
}

func (a *app) handleSites(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	a.queryJSON(w, r, "sites", `
		SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.code), '[]'::jsonb)::text
		FROM (
			SELECT id, org_id, code, name, address, lat, lon, contract_kw,
			       industry, pv_kwp, timezone, active, deployment_mode, metadata, created_at
			FROM sites
			ORDER BY code
		) s`)
}

func (a *app) handleDevices(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	a.queryJSON(w, r, "devices", `
		SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.site_code, d.code), '[]'::jsonb)::text
		FROM (
			SELECT d.id, d.site_id, s.code AS site_code, d.cabinet_id, c.code AS cabinet_code,
			       d.type, d.code, d.vendor, d.model, d.serial_number, host(d.ip_address) AS ip_address,
			       d.modbus_unit_id, d.protocol, d.status, d.last_seen_at, d.metadata, d.created_at
			FROM devices d
			JOIN sites s ON s.id = d.site_id
			LEFT JOIN cabinets c ON c.id = d.cabinet_id
			ORDER BY s.code, d.code
		) d`)
}

func (a *app) handleCabinets(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	a.queryJSON(w, r, "cabinets", `
		SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.site_code, c.code), '[]'::jsonb)::text
		FROM (
			SELECT c.id, c.site_id, s.code AS site_code, c.code, c.model_code, c.serial_number,
			       c.install_date, c.warranty_until, c.position, host(c.ip_address) AS ip_address,
			       c.modbus_unit_id, c.firmware_version, c.active, c.metadata, c.created_at
			FROM cabinets c
			JOIN sites s ON s.id = c.site_id
			ORDER BY s.code, c.code
		) c`)
}

func (a *app) handleModbusPoints(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	a.queryJSON(w, r, "modbusPoints", `
		SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.device_type, p.vendor, p.model, p.address), '[]'::jsonb)::text
		FROM (
			SELECT id, device_type, vendor, model, name_zh, name_en, address,
			       function_code, data_type, scale, unit, description, writable
			FROM modbus_points
			ORDER BY device_type, vendor, model, address
		) p`)
}

func (a *app) queryJSON(w http.ResponseWriter, r *http.Request, key string, sql string) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	var raw string
	if err := a.db.QueryRow(ctx, sql).Scan(&raw); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	var data any
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "database returned invalid JSON: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, key: data})
}

func (a *app) handleTelemetryStatus(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	var raw *string
	const sql = `
		WITH latest AS (
			SELECT ts, cabinet_id, soc, pcs_p_kw, frequency, temp_avg
			FROM telemetry_cabinet_1s
			WHERE soc IS NOT NULL
			  AND (pcs_p_kw IS NOT NULL OR frequency IS NOT NULL OR temp_avg IS NOT NULL)
			ORDER BY ts DESC
			LIMIT 1
		), counts AS (
			SELECT COUNT(*)::int AS samples_24h
			FROM telemetry_cabinet_1s
			WHERE ts >= NOW() - INTERVAL '24 hours'
		)
		SELECT jsonb_build_object(
			'ok', latest.ts IS NOT NULL AND latest.ts >= NOW() - INTERVAL '5 minutes',
			'source', 'timescaledb',
			'storage', 'telemetry_cabinet_1s',
			'latestTs', latest.ts,
			'latestAgeSec', CASE WHEN latest.ts IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM (NOW() - latest.ts))::int END,
			'samples24h', counts.samples_24h,
			'latest', CASE WHEN latest.ts IS NULL THEN NULL ELSE jsonb_build_object(
				'cabinetId', latest.cabinet_id,
				'socPct', latest.soc,
				'pcsKW', latest.pcs_p_kw,
				'frequencyHz', latest.frequency,
				'tempAvgC', latest.temp_avg
			) END
		)::text
		FROM counts
		LEFT JOIN latest ON true`
	if err := a.db.QueryRow(ctx, sql).Scan(&raw); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "source": "timescaledb", "error": err.Error()})
		return
	}
	var status map[string]any
	if raw == nil || !json.Valid([]byte(*raw)) {
		status = map[string]any{"ok": false, "source": "timescaledb", "error": "no telemetry status available"}
	} else if err := json.Unmarshal([]byte(*raw), &status); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	status["checks"] = map[string]any{
		"postgres": tcpCheck(a.cfg.DatabaseAddr, a.cfg.Timeout),
		"mqtt":     tcpCheck(a.cfg.MQTTAddr, a.cfg.Timeout),
		"modbus":   tcpCheck(net.JoinHostPort(a.cfg.ModbusHost, strconv.Itoa(a.cfg.ModbusPort)), a.cfg.Timeout),
	}
	writeJSON(w, http.StatusOK, status)
}

func (a *app) handleTelemetryLatest(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	if a.serveTelemetryLatestFromDB(w, r) {
		return
	}
	a.serveJSONFile(w, "live/hiems_latest.json")
}

func (a *app) handleTelemetryHistory(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	if a.serveTelemetryHistoryFromDB(w, r) {
		return
	}
	a.serveJSONFile(w, "live/hiems_history_24h.json")
}

func (a *app) serveTelemetryLatestFromDB(w http.ResponseWriter, r *http.Request) bool {
	const sql = `
		SELECT jsonb_build_object(
			'ts', t.ts,
			'source', 'timescaledb',
			'cabinetId', t.cabinet_id,
			'cabinetCode', c.code,
			'siteHasPV', false,
			'siteHasEV', false,
			'powerVerified', true,
			'pvKW', 0,
			'socPct', t.soc,
			'sohPct', t.soh,
			'pcsKW', t.pcs_p_kw,
			'pcsKVar', t.pcs_q_kvar,
			'essKW', t.pcs_p_kw,
			'frequencyHz', t.frequency,
			'dcVoltageV', t.dc_voltage,
			'dcCurrentA', t.dc_current,
			'tempAvgC', t.temp_avg,
			'tempMaxC', t.temp_max,
			'tempMinC', t.temp_min,
			'meta', jsonb_build_object('backend', 'go', 'storage', 'telemetry_cabinet_1s')
		)::text
		FROM telemetry_cabinet_1s t
		LEFT JOIN cabinets c ON c.id = t.cabinet_id
		WHERE t.soc IS NOT NULL
		  AND (t.pcs_p_kw IS NOT NULL OR t.frequency IS NOT NULL OR t.temp_avg IS NOT NULL)
		ORDER BY t.ts DESC
		LIMIT 1`
	return a.serveOptionalDBJSON(w, r, sql)
}

func (a *app) serveTelemetryHistoryFromDB(w http.ResponseWriter, r *http.Request) bool {
	const sql = `
		WITH samples AS (
			SELECT t.ts, t.soc, t.soh, t.pcs_p_kw, t.pcs_q_kvar, t.dc_voltage,
			       t.dc_current, t.frequency, t.temp_avg, t.temp_max, t.temp_min
			FROM telemetry_cabinet_1s t
			WHERE t.ts >= NOW() - INTERVAL '24 hours'
			  AND t.soc IS NOT NULL
			  AND (t.pcs_p_kw IS NOT NULL OR t.frequency IS NOT NULL OR t.temp_avg IS NOT NULL)
			ORDER BY t.ts ASC
		)
		SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE jsonb_build_object(
			'generatedAt', NOW(),
			'source', 'timescaledb',
			'sampleIntervalSec', 60,
			'samples', jsonb_agg(jsonb_build_object(
				'ts', ts,
				'socPct', soc,
				'sohPct', soh,
				'pcsKW', pcs_p_kw,
				'pcsKVar', pcs_q_kvar,
				'essKW', pcs_p_kw,
				'gridKW', NULL,
				'loadKW', NULL,
				'pvKW', 0,
				'frequencyHz', frequency,
				'dcVoltageV', dc_voltage,
				'dcCurrentA', dc_current,
				'tempAvgC', temp_avg,
				'tempMaxC', temp_max,
				'tempMinC', temp_min
			) ORDER BY ts)
		)::text END
		FROM samples`
	return a.serveOptionalDBJSON(w, r, sql)
}

func (a *app) serveOptionalDBJSON(w http.ResponseWriter, r *http.Request, sql string) bool {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	var raw *string
	if err := a.db.QueryRow(ctx, sql).Scan(&raw); err != nil {
		slog.Warn("telemetry DB query failed; falling back to JSON file", "error", err)
		return false
	}
	if raw == nil || strings.TrimSpace(*raw) == "" || strings.TrimSpace(*raw) == "null" {
		return false
	}
	if !json.Valid([]byte(*raw)) {
		slog.Warn("telemetry DB query returned invalid JSON; falling back to JSON file")
		return false
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	_, _ = w.Write([]byte(*raw))
	return true
}

func (a *app) handleTelemetryBMSTemperature(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	a.serveJSONFile(w, "live/hiems_bms_temperature.json")
}

func (a *app) handleTelemetryGatewayOnboarding(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	a.serveJSONFile(w, "live/hiems_gateway_onboarding.json")
}

func (a *app) serveJSONFile(w http.ResponseWriter, relPath string) {
	path := filepath.Join(a.cfg.StaticRoot, relPath)
	data, err := os.ReadFile(path)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]any{"ok": false, "error": err.Error(), "path": relPath})
		return
	}
	if !json.Valid(data) {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "telemetry JSON file is invalid", "path": relPath})
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	_, _ = w.Write(data)
}

func (a *app) handleCommandHealth(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":            true,
		"ts":            time.Now().UTC().Format(time.RFC3339Nano),
		"writesEnabled": a.cfg.EnableWrites,
	})
}

func (a *app) handleCommandAllowlist(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	public := make(map[string]commandSpec, len(allowlist))
	for name, spec := range allowlist {
		spec.AllowedValues = nil
		public[name] = spec
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                  true,
		"ts":                  time.Now().UTC().Format(time.RFC3339Nano),
		"host":                a.cfg.ModbusHost,
		"port":                a.cfg.ModbusPort,
		"writesEnabled":       a.cfg.EnableWrites,
		"tokenConfigured":     a.cfg.CommandToken != "",
		"requiredSafetyAcks":  requiredSafetyAcks,
		"commands":            public,
		"implementation":      "go",
		"compatibilityTarget": "scripts/hiems_command_api.py",
	})
}

func (a *app) handleCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	if !allowMethod(w, r, http.MethodPost) {
		return
	}

	audit := map[string]any{
		"ts":     time.Now().UTC().Format(time.RFC3339Nano),
		"path":   r.URL.Path,
		"remote": remoteIP(r),
		"status": "received",
	}

	var req commandRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxCommandBodySize))
	dec.UseNumber()
	if err := dec.Decode(&req); err != nil {
		audit["status"] = "rejected"
		audit["error"] = err.Error()
		_ = appendAudit(a.cfg.AuditLog, audit)
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid JSON: " + err.Error()})
		return
	}
	audit["request"] = req

	plan, err := validateCommand(req, a.cfg.MaxPowerKW)
	if err != nil {
		audit["status"] = "rejected"
		audit["error"] = err.Error()
		_ = appendAudit(a.cfg.AuditLog, audit)
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	audit["plan"] = plan

	if plan.Execute {
		if !a.cfg.EnableWrites {
			err := "writes are disabled; restart API with JJEMS_ENABLE_WRITES=true"
			audit["status"] = "rejected"
			audit["error"] = err
			_ = appendAudit(a.cfg.AuditLog, audit)
			writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": err})
			return
		}
		if !a.checkAuth(r) {
			err := "missing or invalid bearer token"
			audit["status"] = "rejected"
			audit["error"] = err
			_ = appendAudit(a.cfg.AuditLog, audit)
			writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": err})
			return
		}
		result, err := modbusWriteSingle(a.cfg, plan)
		if err != nil {
			audit["status"] = "rejected"
			audit["error"] = err.Error()
			_ = appendAudit(a.cfg.AuditLog, audit)
			writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": err.Error(), "plan": plan})
			return
		}
		audit["status"] = "executed"
		audit["result"] = result
		_ = appendAudit(a.cfg.AuditLog, audit)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "mode": "executed", "plan": plan, "result": result, "auditLog": a.cfg.AuditLog})
		return
	}

	audit["status"] = "dry-run"
	_ = appendAudit(a.cfg.AuditLog, audit)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "mode": "dry-run", "plan": plan, "auditLog": a.cfg.AuditLog})
}

func validateCommand(req commandRequest, maxPowerKW float64) (commandPlan, error) {
	spec, ok := allowlist[req.Command]
	if !ok {
		return commandPlan{}, fmt.Errorf("unsupported command: %s", req.Command)
	}

	dryRun := true
	if req.DryRun != nil {
		dryRun = *req.DryRun
	}
	if req.Execute && dryRun {
		return commandPlan{}, errors.New("execute=true requires dryRun=false")
	}

	missing := missingSafetyAcks(req.SafetyAcks)
	if req.Execute && len(missing) > 0 {
		return commandPlan{}, fmt.Errorf("missing safety acknowledgements: %s", strings.Join(missing, ", "))
	}

	var raw uint16
	var eng any
	var err error

	switch spec.Kind {
	case "coil":
		var coil bool
		coil, err = parseBool(req.Value)
		if err != nil {
			return commandPlan{}, err
		}
		if !coilAllowed(coil, spec.AllowedValues) {
			return commandPlan{}, errors.New("coil value is not allowed for this command")
		}
		if coil {
			raw = 0xFF00
			eng = 1
		} else {
			raw = 0x0000
			eng = 0
		}
	case "enum_register":
		n, err := parseInteger(req.Value)
		if err != nil {
			return commandPlan{}, errors.New("enum register value must be an integer")
		}
		if !numberAllowed(float64(n), spec.AllowedValues) {
			return commandPlan{}, errors.New("enum register value is not allowed")
		}
		raw = uint16(n)
		eng = n
	case "scaled_kw_register", "scaled_kvar_register":
		n, err := parseNumber(req.Value)
		if err != nil {
			return commandPlan{}, errors.New("scaled register value must be numeric")
		}
		limit := math.Min(maxPowerKW, spec.DefaultAbsLimit)
		if math.Abs(n) > limit {
			return commandPlan{}, fmt.Errorf("absolute value exceeds current low-power limit: %g %s", limit, spec.EngineeringUnit)
		}
		raw, err = signedU16(math.Round(n * spec.Scale))
		if err != nil {
			return commandPlan{}, err
		}
		eng = n
	default:
		return commandPlan{}, errors.New("unsupported command kind")
	}

	operator := strings.TrimSpace(req.Operator)
	if operator == "" {
		operator = "unknown"
	}

	return commandPlan{
		Command:           req.Command,
		Label:             spec.Label,
		UnitID:            int(spec.UnitID),
		FC:                int(spec.FC),
		Addr:              int(spec.Addr),
		Value:             eng,
		RawValue:          raw,
		DryRun:            dryRun,
		Execute:           req.Execute,
		MissingSafetyAcks: missing,
		Operator:          operator,
		Reason:            strings.TrimSpace(req.Reason),
		ClientTS:          req.ClientTS,
	}, nil
}

func modbusWriteSingle(cfg config, plan commandPlan) (map[string]any, error) {
	addr := net.JoinHostPort(cfg.ModbusHost, strconv.Itoa(cfg.ModbusPort))
	conn, err := net.DialTimeout("tcp", addr, cfg.Timeout)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(cfg.Timeout))

	tid := uint16(time.Now().UnixMilli() & 0xffff)
	req := make([]byte, 12)
	binary.BigEndian.PutUint16(req[0:2], tid)
	binary.BigEndian.PutUint16(req[2:4], 0)
	binary.BigEndian.PutUint16(req[4:6], 6)
	req[6] = byte(plan.UnitID)
	req[7] = byte(plan.FC)
	binary.BigEndian.PutUint16(req[8:10], uint16(plan.Addr))
	binary.BigEndian.PutUint16(req[10:12], plan.RawValue)

	if _, err := conn.Write(req); err != nil {
		return nil, err
	}
	resp := make([]byte, 260)
	n, err := conn.Read(resp)
	if err != nil {
		return nil, err
	}
	resp = resp[:n]
	if len(resp) < 12 {
		return nil, fmt.Errorf("short Modbus response: %x", resp)
	}
	if got := binary.BigEndian.Uint16(resp[0:2]); got != tid {
		return nil, fmt.Errorf("transaction id mismatch: expected %d, got %d", tid, got)
	}
	if proto := binary.BigEndian.Uint16(resp[2:4]); proto != 0 {
		return nil, fmt.Errorf("unexpected Modbus protocol id: %d", proto)
	}
	if resp[6] != byte(plan.UnitID) {
		return nil, fmt.Errorf("unit id mismatch: expected %d, got %d", plan.UnitID, resp[6])
	}
	if resp[7]&0x80 != 0 {
		return nil, fmt.Errorf("Modbus exception for FC%d addr %d: code %d", plan.FC, plan.Addr, resp[8])
	}
	if resp[7] != byte(plan.FC) {
		return nil, fmt.Errorf("function code mismatch: expected %d, got %d", plan.FC, resp[7])
	}
	echoAddr := binary.BigEndian.Uint16(resp[8:10])
	echoValue := binary.BigEndian.Uint16(resp[10:12])
	if echoAddr != uint16(plan.Addr) || echoValue != plan.RawValue {
		return nil, fmt.Errorf("unexpected write echo: addr=%d value=%d", echoAddr, echoValue)
	}
	return map[string]any{
		"responseHex": fmt.Sprintf("% x", resp),
		"echoAddr":    echoAddr,
		"echoValue":   echoValue,
	}, nil
}

func (a *app) checkAuth(r *http.Request) bool {
	if a.cfg.CommandToken == "" {
		return false
	}
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return false
	}
	supplied := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	return subtle.ConstantTimeCompare([]byte(supplied), []byte(a.cfg.CommandToken)) == 1
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(payload)
}

func allowMethod(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method == http.MethodOptions {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return false
	}
	if r.Method != method {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
		return false
	}
	return true
}

func tcpCheck(addr string, timeout time.Duration) map[string]any {
	start := time.Now()
	conn, err := net.DialTimeout("tcp", addr, timeout)
	elapsed := time.Since(start)
	if err != nil {
		return map[string]any{"ok": false, "addr": addr, "latencyMs": elapsed.Milliseconds(), "error": err.Error()}
	}
	_ = conn.Close()
	return map[string]any{"ok": true, "addr": addr, "latencyMs": elapsed.Milliseconds()}
}

func appendAudit(path string, record map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	return json.NewEncoder(f).Encode(record)
}

func parseBool(v interface{}) (bool, error) {
	switch x := v.(type) {
	case bool:
		return x, nil
	case json.Number:
		n, err := x.Int64()
		if err == nil && (n == 0 || n == 1) {
			return n == 1, nil
		}
	case float64:
		if x == 0 || x == 1 {
			return x == 1, nil
		}
	case string:
		switch strings.ToLower(strings.TrimSpace(x)) {
		case "1", "true":
			return true, nil
		case "0", "false":
			return false, nil
		}
	}
	return false, errors.New("coil command value must be boolean/0/1")
}

func parseNumber(v interface{}) (float64, error) {
	switch x := v.(type) {
	case json.Number:
		return x.Float64()
	case float64:
		return x, nil
	case int:
		return float64(x), nil
	default:
		return 0, errors.New("not numeric")
	}
}

func parseInteger(v interface{}) (int, error) {
	n, err := parseNumber(v)
	if err != nil {
		return 0, err
	}
	if math.Trunc(n) != n {
		return 0, errors.New("not integer")
	}
	return int(n), nil
}

func signedU16(value float64) (uint16, error) {
	iv := int(value)
	if iv < -32768 || iv > 32767 {
		return 0, errors.New("signed register raw value out of int16 range")
	}
	return uint16(int16(iv)), nil
}

func coilAllowed(value bool, allowed []interface{}) bool {
	for _, item := range allowed {
		parsed, err := parseBool(item)
		if err == nil && parsed == value {
			return true
		}
	}
	return false
}

func numberAllowed(value float64, allowed []interface{}) bool {
	for _, item := range allowed {
		n, err := parseNumber(item)
		if err == nil && n == value {
			return true
		}
	}
	return false
}

func missingSafetyAcks(acks []string) []string {
	present := make(map[string]bool, len(acks))
	for _, ack := range acks {
		present[ack] = true
	}
	var missing []string
	for _, ack := range requiredSafetyAcks {
		if !present[ack] {
			missing = append(missing, ack)
		}
	}
	return missing
}

func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func withRequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		slog.Info("http request", "method", r.Method, "path", r.URL.Path, "remote", remoteIP(r), "duration", time.Since(start))
	})
}

func envString(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func envFloat(key string, fallback float64) float64 {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			return n
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		switch strings.ToLower(v) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return fallback
}

func envDurationMS(key string, fallback time.Duration) time.Duration {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Millisecond
		}
	}
	return fallback
}
