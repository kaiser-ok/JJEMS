package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
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
	defaultHost        = "192.168.1.100"
	defaultHTTPBase    = "http://192.168.1.100/api"
	defaultPort        = 502
	defaultUnitID      = 1
	defaultCabinetID   = "44444444-0000-0000-0000-000000000001"
	defaultDatabaseURL = "postgres://ems:ems_dev_only_change_me@localhost:5432/ems"
	defaultLiveJSON    = "live/hiems_latest.json"
	defaultInterval    = 60 * time.Second
	defaultTimeout     = 5 * time.Second
	pcsUnitID          = 2
)

type config struct {
	Host        string
	HTTPBase    string
	Port        int
	UnitID      byte
	CabinetID   string
	DatabaseURL string
	LiveJSON    string
	Interval    time.Duration
	Timeout     time.Duration
	Once        bool
	PrintJSON   bool
	PrintSQL    bool
}

type pointSpec struct {
	FC     byte    `json:"fc"`
	Addr   uint16  `json:"addr"`
	Qty    uint16  `json:"qty"`
	Type   string  `json:"type"`
	Scale  float64 `json:"scale"`
	Unit   string  `json:"unit"`
	Status string  `json:"status"`
}

type snapshot struct {
	TS            string             `json:"ts"`
	Source        string             `json:"source"`
	Host          string             `json:"host"`
	SiteHasPV     bool               `json:"siteHasPV"`
	SiteHasEV     bool               `json:"siteHasEV"`
	PowerVerified bool               `json:"powerVerified"`
	PVKW          float64            `json:"pvKW"`
	Values        map[string]float64 `json:"-"`
	Meta          map[string]any     `json:"meta"`
}

var modbusPoints = map[string]pointSpec{
	"socPct":          {FC: 4, Addr: 88, Qty: 1, Type: "u16", Scale: 0.1, Unit: "%", Status: "verified"},
	"sohPct":          {FC: 4, Addr: 89, Qty: 1, Type: "u16", Scale: 0.1, Unit: "%", Status: "candidate"},
	"bmsVoltageV":     {FC: 4, Addr: 86, Qty: 1, Type: "u16", Scale: 0.1, Unit: "V", Status: "candidate"},
	"bmsCurrentA":     {FC: 4, Addr: 87, Qty: 1, Type: "i16", Scale: 0.1, Unit: "A", Status: "vendor-sheet verified"},
	"maxCellTempC":    {FC: 4, Addr: 97, Qty: 1, Type: "i16", Scale: 0.1, Unit: "degC", Status: "vendor-sheet verified"},
	"avgCellTempC":    {FC: 4, Addr: 103, Qty: 1, Type: "i16", Scale: 0.1, Unit: "degC", Status: "vendor-sheet verified"},
	"bmsChargeKWh":    {FC: 4, Addr: 126, Qty: 2, Type: "u32_be_words", Scale: 0.1, Unit: "kWh", Status: "vendor-sheet verified"},
	"bmsDischargeKWh": {FC: 4, Addr: 128, Qty: 2, Type: "u32_be_words", Scale: 0.1, Unit: "kWh", Status: "vendor-sheet verified"},
}

var pcsPoints = map[string]pointSpec{
	"frequencyHz":     {FC: 4, Addr: 24, Qty: 1, Type: "u16", Scale: 0.01, Unit: "Hz", Status: "vendor-sheet verified"},
	"pcsKW":           {FC: 4, Addr: 28, Qty: 1, Type: "i16", Scale: 0.1, Unit: "kW", Status: "vendor-sheet verified"},
	"pcsKVar":         {FC: 4, Addr: 32, Qty: 1, Type: "i16", Scale: 0.1, Unit: "kVar", Status: "vendor-sheet verified"},
	"pcsChargeKWh":    {FC: 4, Addr: 45, Qty: 2, Type: "u32_be_words", Scale: 0.001, Unit: "kWh", Status: "vendor-sheet verified"},
	"pcsDischargeKWh": {FC: 4, Addr: 47, Qty: 2, Type: "u32_be_words", Scale: 0.001, Unit: "kWh", Status: "vendor-sheet verified"},
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg := loadConfig()
	ctx := context.Background()
	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("invalid database config", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	for {
		snap, err := pollOnce(ctx, db, cfg)
		if err != nil {
			slog.Error("collector poll failed", "error", err)
			if cfg.Once {
				os.Exit(1)
			}
		} else {
			slog.Info("collector poll ok", "socPct", snap.Values["socPct"], "sohPct", snap.Values["sohPct"], "pcsKW", snap.Values["pcsKW"], "frequencyHz", snap.Values["frequencyHz"])
			if cfg.PrintJSON {
				if err := writeSnapshot(os.Stdout, snap); err != nil {
					slog.Error("print snapshot failed", "error", err)
				}
			}
		}

		if cfg.Once {
			return
		}
		time.Sleep(cfg.Interval)
	}
}

func loadConfig() config {
	var cfg config
	flag.StringVar(&cfg.Host, "host", envString("HIEMS_HOST", defaultHost), "HiEMS Modbus host")
	flag.StringVar(&cfg.HTTPBase, "http-base", envString("HIEMS_HTTP_BASE", defaultHTTPBase), "HiEMS HTTP API base")
	flag.IntVar(&cfg.Port, "port", envInt("HIEMS_PORT", defaultPort), "HiEMS Modbus TCP port")
	unitID := flag.Int("unit-id", envInt("HIEMS_UNIT_ID", defaultUnitID), "HiEMS BMS Modbus unit id")
	flag.StringVar(&cfg.CabinetID, "cabinet-id", envString("JJEMS_CABINET_ID", defaultCabinetID), "JJEMS cabinet UUID")
	flag.StringVar(&cfg.DatabaseURL, "db-url", envString("DATABASE_URL", envString("JJEMS_DATABASE_URL", defaultDatabaseURL)), "PostgreSQL connection URL")
	flag.StringVar(&cfg.LiveJSON, "live-json", envString("HIEMS_LIVE_JSON", defaultLiveJSON), "live JSON output path")
	flag.DurationVar(&cfg.Interval, "interval", envDuration("SOC_LOG_INTERVAL_SEC", defaultInterval), "poll interval")
	flag.DurationVar(&cfg.Timeout, "timeout", envDuration("HIEMS_TIMEOUT_SEC", defaultTimeout), "network timeout")
	flag.BoolVar(&cfg.Once, "once", false, "poll once and exit")
	flag.BoolVar(&cfg.PrintJSON, "print-json", false, "print snapshot JSON")
	flag.BoolVar(&cfg.PrintSQL, "print-sql", false, "print INSERT SQL and skip DB write")
	flag.Parse()

	if *unitID < 1 || *unitID > 247 {
		slog.Error("invalid unit id", "unitID", *unitID)
		os.Exit(2)
	}
	cfg.UnitID = byte(*unitID)
	return cfg
}

func pollOnce(ctx context.Context, db *pgxpool.Pool, cfg config) (*snapshot, error) {
	snap, err := buildSnapshot(cfg)
	if err != nil {
		return nil, err
	}

	soc, ok := snap.Values["socPct"]
	if !ok || soc < 0 || soc > 100 {
		return nil, fmt.Errorf("SOC out of range: %v", snap.Values["socPct"])
	}

	if err := insertTelemetry(ctx, db, cfg, snap); err != nil {
		return nil, err
	}
	if err := writeLiveJSON(cfg.LiveJSON, snap); err != nil {
		return nil, err
	}
	return snap, nil
}

func buildSnapshot(cfg config) (*snapshot, error) {
	modbusValues, modbusRaw, modbusErrors := readPoints(cfg, modbusPoints, cfg.UnitID)
	pcsValues, pcsRaw, pcsErrors := readPoints(cfg, pcsPoints, pcsUnitID)
	station := readStationInfo(cfg.HTTPBase, cfg.Timeout)

	values := map[string]float64{}
	for k, v := range modbusValues {
		values[k] = v
	}
	for k, v := range pcsValues {
		values[k] = v
	}

	for apiKey, targetKey := range map[string]string{
		"soc":                  "socPct",
		"soh":                  "sohPct",
		"accuChargeQuantity":   "accuChargeKWh",
		"accDischargeQuantity": "accuDischargeKWh",
		"dayChargeQuantity":    "dayChargeKWh",
		"dayDischargeQuantity": "dayDischargeKWh",
	} {
		if v, ok := numberFromMap(station, apiKey); ok {
			values[targetKey] = v
		}
	}

	snap := &snapshot{
		TS:            time.Now().UTC().Format(time.RFC3339Nano),
		Source:        "hiems-gateway",
		Host:          cfg.Host,
		SiteHasPV:     false,
		SiteHasEV:     false,
		PowerVerified: false,
		PVKW:          0,
		Values:        values,
		Meta: map[string]any{
			"modbusStatus":    statusMap(modbusPoints),
			"pcsStatus":       statusMap(pcsPoints),
			"modbusRaw":       modbusRaw,
			"modbusErrors":    modbusErrors,
			"pcsRaw":          pcsRaw,
			"pcsErrors":       pcsErrors,
			"stationInfoName": station["name"],
		},
	}
	return snap, nil
}

func readPoints(cfg config, points map[string]pointSpec, unitID byte) (map[string]float64, map[string]float64, map[string]string) {
	values := map[string]float64{}
	raw := map[string]float64{}
	errs := map[string]string{}
	for name, spec := range points {
		regs, err := readModbusRegisters(cfg.Host, cfg.Port, unitID, spec.FC, spec.Addr, spec.Qty, cfg.Timeout)
		if err != nil {
			errs[name] = err.Error()
			continue
		}
		decoded, err := decodeRegisters(regs, spec.Type)
		if err != nil {
			errs[name] = err.Error()
			continue
		}
		raw[name] = decoded
		values[name] = math.Round(decoded*spec.Scale*1000) / 1000
	}
	return values, raw, errs
}

func readModbusRegisters(host string, port int, unitID byte, fc byte, addr uint16, qty uint16, timeout time.Duration) ([]uint16, error) {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), timeout)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))

	transactionID := uint16(time.Now().UnixMilli() & 0xffff)
	request := make([]byte, 12)
	binary.BigEndian.PutUint16(request[0:2], transactionID)
	binary.BigEndian.PutUint16(request[2:4], 0)
	binary.BigEndian.PutUint16(request[4:6], 6)
	request[6] = unitID
	request[7] = fc
	binary.BigEndian.PutUint16(request[8:10], addr)
	binary.BigEndian.PutUint16(request[10:12], qty)

	if _, err := conn.Write(request); err != nil {
		return nil, err
	}

	header := make([]byte, 7)
	if _, err := io.ReadFull(conn, header); err != nil {
		return nil, err
	}
	remaining := int(binary.BigEndian.Uint16(header[4:6])) - 1
	if remaining < 2 || remaining > 253 {
		return nil, fmt.Errorf("invalid Modbus response length: %d", remaining+1)
	}
	body := make([]byte, remaining)
	if _, err := io.ReadFull(conn, body); err != nil {
		return nil, err
	}
	response := append(header, body...)
	if len(response) < 9 {
		return nil, fmt.Errorf("short Modbus response: %x", response)
	}
	if got := binary.BigEndian.Uint16(response[0:2]); got != transactionID {
		return nil, fmt.Errorf("transaction id mismatch: expected %d, got %d", transactionID, got)
	}
	if protocolID := binary.BigEndian.Uint16(response[2:4]); protocolID != 0 {
		return nil, fmt.Errorf("unexpected Modbus protocol id: %d", protocolID)
	}
	if response[6] != unitID {
		return nil, fmt.Errorf("unit id mismatch: expected %d, got %d", unitID, response[6])
	}
	if response[7]&0x80 != 0 {
		return nil, fmt.Errorf("Modbus exception for FC%d addr %d: code %d", fc, addr, response[8])
	}
	if response[7] != fc {
		return nil, fmt.Errorf("function code mismatch: expected %d, got %d", fc, response[7])
	}

	byteCount := int(response[8])
	payload := response[9:]
	if byteCount != int(qty)*2 || len(payload) < byteCount {
		return nil, fmt.Errorf("unexpected register payload: %x", payload)
	}
	payload = payload[:byteCount]
	regs := make([]uint16, 0, qty)
	for i := 0; i < len(payload); i += 2 {
		regs = append(regs, binary.BigEndian.Uint16(payload[i:i+2]))
	}
	return regs, nil
}

func decodeRegisters(regs []uint16, dtype string) (float64, error) {
	switch dtype {
	case "u16":
		return float64(regs[0]), nil
	case "i16":
		return float64(int16(regs[0])), nil
	case "u32_be_words":
		return float64(uint32(regs[0])<<16 | uint32(regs[1])), nil
	case "i32_be_words":
		value := uint32(regs[0])<<16 | uint32(regs[1])
		return float64(int32(value)), nil
	case "u32_le_words":
		return float64(uint32(regs[1])<<16 | uint32(regs[0])), nil
	case "i32_le_words":
		value := uint32(regs[1])<<16 | uint32(regs[0])
		return float64(int32(value)), nil
	default:
		return 0, fmt.Errorf("unsupported data type: %s", dtype)
	}
}

func readStationInfo(httpBase string, timeout time.Duration) map[string]any {
	payload := []byte(`{}`)
	url := strings.TrimRight(httpBase, "/") + "/Common/StationInfo?MapId=1"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return map[string]any{"_error": err.Error()}
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return map[string]any{"_error": err.Error()}
	}
	defer resp.Body.Close()

	var body struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return map[string]any{"_error": err.Error()}
	}
	if body.Code == 200 && body.Data != nil {
		return body.Data
	}
	return map[string]any{}
}

func insertTelemetry(ctx context.Context, db *pgxpool.Pool, cfg config, snap *snapshot) error {
	if cfg.PrintSQL {
		fmt.Printf("INSERT INTO telemetry_cabinet_1s (ts, cabinet_id, soc, soh) VALUES (%q, %q::uuid, %s, %s);\n", snap.TS, cfg.CabinetID, sqlValue(snap.Values, "socPct"), sqlValue(snap.Values, "sohPct"))
		return nil
	}

	ctx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()
	_, err := db.Exec(ctx, `
		INSERT INTO telemetry_cabinet_1s (ts, cabinet_id, soc, soh)
		VALUES ($1, $2::uuid, $3, $4)`, time.Now().UTC(), cfg.CabinetID, nullableFloat(snap.Values, "socPct"), nullableFloat(snap.Values, "sohPct"))
	return err
}

func writeLiveJSON(path string, snap *snapshot) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	writeErr := writeSnapshot(f, snap)
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp, path)
}

func writeSnapshot(f io.Writer, snap *snapshot) error {
	body := map[string]any{
		"ts":            snap.TS,
		"source":        snap.Source,
		"host":          snap.Host,
		"siteHasPV":     snap.SiteHasPV,
		"siteHasEV":     snap.SiteHasEV,
		"powerVerified": snap.PowerVerified,
		"pvKW":          snap.PVKW,
		"meta":          snap.Meta,
	}
	for k, v := range snap.Values {
		body[k] = v
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(body)
}

func statusMap(points map[string]pointSpec) map[string]string {
	out := map[string]string{}
	for k, v := range points {
		out[k] = v.Status
	}
	return out
}

func numberFromMap(m map[string]any, key string) (float64, bool) {
	switch v := m[key].(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case json.Number:
		f, err := v.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

func nullableFloat(values map[string]float64, key string) any {
	v, ok := values[key]
	if !ok {
		return nil
	}
	return v
}

func sqlValue(values map[string]float64, key string) string {
	v, ok := values[key]
	if !ok {
		return "NULL"
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func envString(key string, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		parsed, err := strconv.Atoi(v)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if parsed, err := time.ParseDuration(v); err == nil {
			return parsed
		}
		if seconds, err := strconv.ParseFloat(v, 64); err == nil {
			return time.Duration(seconds * float64(time.Second))
		}
	}
	return fallback
}
