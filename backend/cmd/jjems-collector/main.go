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
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultHost         = "192.168.1.100"
	defaultHTTPBase     = "http://192.168.1.100/api"
	defaultPort         = 502
	defaultUnitID       = 1
	defaultSiteID       = "33333333-0000-0000-0000-000000000001"
	defaultCabinetID    = "44444444-0000-0000-0000-000000000001"
	defaultDatabaseURL  = "postgres://ems:ems_dev_only_change_me@localhost:5432/ems"
	defaultLiveJSON     = "live/hiems_latest.json"
	defaultInterval     = 60 * time.Second
	defaultPowerLoop    = 1 * time.Second
	defaultCriticalLoop = 5 * time.Second
	defaultTimeout      = 5 * time.Second
	pcsUnitID           = 2
)

type config struct {
	Host         string
	HTTPBase     string
	Port         int
	UnitID       byte
	SiteID       string
	CabinetID    string
	DeviceID     string
	DatabaseURL  string
	LiveJSON     string
	Interval     time.Duration
	PowerLoop    time.Duration
	CriticalLoop time.Duration
	Timeout      time.Duration
	Once         bool
	PrintJSON    bool
	PrintSQL     bool
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

type pollGroup struct {
	Name           string
	Interval       time.Duration
	UnitID         byte
	Points         map[string]pointSpec
	IncludeStation bool
	RequireSOC     bool
	IncludeAlarms  bool
}

type alarmPoint struct {
	Code     string `json:"code"`
	NameZH   string `json:"nameZh"`
	NameEN   string `json:"nameEn"`
	Category string `json:"category"`
	Severity string `json:"severity"`
	Addr     uint16 `json:"addr"`
	Source   string `json:"source"`
}

type alarmState struct {
	Code     string `json:"code"`
	NameZH   string `json:"nameZh"`
	Category string `json:"category"`
	Severity string `json:"severity"`
	Addr     uint16 `json:"addr"`
	Active   bool   `json:"active"`
}

var criticalPoints = map[string]pointSpec{
	"socPct":          {FC: 4, Addr: 88, Qty: 1, Type: "u16", Scale: 0.1, Unit: "%", Status: "verified"},
	"sohPct":          {FC: 4, Addr: 89, Qty: 1, Type: "u16", Scale: 0.1, Unit: "%", Status: "candidate"},
	"bmsVoltageV":     {FC: 4, Addr: 86, Qty: 1, Type: "u16", Scale: 0.1, Unit: "V", Status: "candidate"},
	"bmsCurrentA":     {FC: 4, Addr: 87, Qty: 1, Type: "i16", Scale: 0.1, Unit: "A", Status: "vendor-sheet verified"},
	"maxCellTempC":    {FC: 4, Addr: 97, Qty: 1, Type: "i16", Scale: 0.1, Unit: "degC", Status: "vendor-sheet verified"},
	"avgCellTempC":    {FC: 4, Addr: 103, Qty: 1, Type: "i16", Scale: 0.1, Unit: "degC", Status: "vendor-sheet verified"},
	"bmsChargeKWh":    {FC: 4, Addr: 126, Qty: 2, Type: "u32_be_words", Scale: 0.1, Unit: "kWh", Status: "vendor-sheet verified"},
	"bmsDischargeKWh": {FC: 4, Addr: 128, Qty: 2, Type: "u32_be_words", Scale: 0.1, Unit: "kWh", Status: "vendor-sheet verified"},
}

var alarmPoints = []alarmPoint{
	{Code: "tw.dido.aerosol", NameZH: "氣溶膠回饋", NameEN: "Aerosol feedback", Category: "safety", Severity: "critical", Addr: 1, Source: "DIDO"},
	{Code: "tw.dido.smoke", NameZH: "煙感告警", NameEN: "Smoke alarm", Category: "safety", Severity: "critical", Addr: 2, Source: "DIDO"},
	{Code: "tw.dido.water", NameZH: "水浸告警", NameEN: "Water ingress alarm", Category: "safety", Severity: "error", Addr: 3, Source: "DIDO"},
	{Code: "tw.dido.temperature", NameZH: "溫感告警", NameEN: "Temperature detector alarm", Category: "safety", Severity: "critical", Addr: 4, Source: "DIDO"},
	{Code: "tw.dido.breaker", NameZH: "塑殼回饋", NameEN: "MCCB feedback", Category: "safety", Severity: "warning", Addr: 5, Source: "DIDO"},
	{Code: "tw.pcs.stopped", NameZH: "PCS 停機狀態", NameEN: "PCS stopped", Category: "pcs", Severity: "info", Addr: 17, Source: "PCS"},
	{Code: "tw.pcs.fault", NameZH: "PCS 總故障狀態", NameEN: "PCS total fault", Category: "pcs", Severity: "error", Addr: 20, Source: "PCS"},
	{Code: "tw.pcs.alarm", NameZH: "PCS 總報警狀態", NameEN: "PCS total alarm", Category: "pcs", Severity: "warning", Addr: 21, Source: "PCS"},
	{Code: "tw.pcs.estop", NameZH: "PCS 急停輸入", NameEN: "PCS emergency stop input", Category: "safety", Severity: "critical", Addr: 23, Source: "PCS"},
	{Code: "tw.pcs.grid.connected", NameZH: "PCS 並網狀態", NameEN: "PCS grid-connected", Category: "pcs", Severity: "info", Addr: 24, Source: "PCS"},
	{Code: "tw.pcs.bms.drycontact", NameZH: "PCS BMS 乾接點故障", NameEN: "PCS BMS dry-contact fault", Category: "pcs", Severity: "error", Addr: 27, Source: "PCS"},
	{Code: "tw.pcs.insulation.fault", NameZH: "PCS 絕緣故障", NameEN: "PCS insulation fault", Category: "safety", Severity: "critical", Addr: 42, Source: "PCS"},
	{Code: "tw.pcs.ac.overvoltage", NameZH: "PCS 交流過壓", NameEN: "PCS AC overvoltage", Category: "pcs", Severity: "error", Addr: 58, Source: "PCS"},
	{Code: "tw.pcs.ac.undervoltage", NameZH: "PCS 交流欠壓", NameEN: "PCS AC undervoltage", Category: "pcs", Severity: "error", Addr: 59, Source: "PCS"},
	{Code: "tw.pcs.dc.charge.overcurrent", NameZH: "PCS 直流充電過流", NameEN: "PCS DC charge overcurrent", Category: "pcs", Severity: "error", Addr: 70, Source: "PCS"},
	{Code: "tw.pcs.dc.discharge.overcurrent", NameZH: "PCS 直流放電過流", NameEN: "PCS DC discharge overcurrent", Category: "pcs", Severity: "error", Addr: 71, Source: "PCS"},
	{Code: "tw.bms.pack.overvoltage.l3", NameZH: "BMS 組端過壓 3 級", NameEN: "BMS pack overvoltage level 3", Category: "battery", Severity: "critical", Addr: 135, Source: "BMS"},
	{Code: "tw.bms.pack.undervoltage.l3", NameZH: "BMS 組端欠壓 3 級", NameEN: "BMS pack undervoltage level 3", Category: "battery", Severity: "critical", Addr: 138, Source: "BMS"},
	{Code: "tw.bms.insulation.l3", NameZH: "BMS 組端絕緣 3 級", NameEN: "BMS insulation level 3", Category: "safety", Severity: "critical", Addr: 147, Source: "BMS"},
	{Code: "tw.bms.cell.overtemp.charge.l3", NameZH: "單體充電過溫 3 級", NameEN: "Cell charge overtemperature level 3", Category: "thermal", Severity: "critical", Addr: 150, Source: "BMS"},
	{Code: "tw.bms.cell.overvoltage.l3", NameZH: "單體電壓過壓 3 級", NameEN: "Cell overvoltage level 3", Category: "battery", Severity: "critical", Addr: 156, Source: "BMS"},
	{Code: "tw.bms.cell.undervoltage.l3", NameZH: "單體電壓欠壓 3 級", NameEN: "Cell undervoltage level 3", Category: "battery", Severity: "critical", Addr: 159, Source: "BMS"},
	{Code: "tw.bms.soc.low.l3", NameZH: "SOC 過低 3 級", NameEN: "SOC low level 3", Category: "battery", Severity: "critical", Addr: 168, Source: "BMS"},
	{Code: "tw.bms.estop", NameZH: "BMS 急停", NameEN: "BMS emergency stop", Category: "safety", Severity: "critical", Addr: 179, Source: "BMS"},
	{Code: "tw.bms.door", NameZH: "BMS 門禁", NameEN: "BMS door access", Category: "safety", Severity: "warning", Addr: 181, Source: "BMS"},
	{Code: "tw.bms.limit.fault", NameZH: "電池極限故障", NameEN: "Battery limit fault", Category: "battery", Severity: "critical", Addr: 192, Source: "BMS"},
	{Code: "tw.bms.pcs.comm", NameZH: "BMS 與 PCS 通訊故障", NameEN: "BMS to PCS communication fault", Category: "comm", Severity: "error", Addr: 194, Source: "BMS"},
	{Code: "tw.bms.cell.overtemp.discharge.l3", NameZH: "單體放電過溫 3 級", NameEN: "Cell discharge overtemperature level 3", Category: "thermal", Severity: "critical", Addr: 205, Source: "BMS"},
	{Code: "tw.bms.soc.high.l3", NameZH: "SOC 過高 3 級", NameEN: "SOC high level 3", Category: "battery", Severity: "critical", Addr: 211, Source: "BMS"},
	{Code: "tw.bms.charge.prohibit", NameZH: "BMS 禁充標誌", NameEN: "BMS charge prohibited", Category: "battery", Severity: "warning", Addr: 226, Source: "BMS"},
	{Code: "tw.bms.discharge.prohibit", NameZH: "BMS 禁放標誌", NameEN: "BMS discharge prohibited", Category: "battery", Severity: "warning", Addr: 227, Source: "BMS"},
	{Code: "tw.bms.alarm", NameZH: "BMS 告警狀態", NameEN: "BMS alarm state", Category: "battery", Severity: "warning", Addr: 228, Source: "BMS"},
}

var powerPoints = map[string]pointSpec{
	"frequencyHz":     {FC: 4, Addr: 24, Qty: 1, Type: "u16", Scale: 0.01, Unit: "Hz", Status: "vendor-sheet verified"},
	"pcsKW":           {FC: 4, Addr: 28, Qty: 1, Type: "i16", Scale: 0.1, Unit: "kW", Status: "vendor-sheet verified"},
	"pcsKVar":         {FC: 4, Addr: 32, Qty: 1, Type: "i16", Scale: 0.1, Unit: "kVar", Status: "vendor-sheet verified"},
	"pcsDCPowerKW":    {FC: 4, Addr: 41, Qty: 1, Type: "i16", Scale: 0.1, Unit: "kW", Status: "vendor-sheet verified"},
	"pcsDCVoltageV":   {FC: 4, Addr: 42, Qty: 1, Type: "i16", Scale: 0.1, Unit: "V", Status: "vendor-sheet verified"},
	"pcsDCCurrentA":   {FC: 4, Addr: 43, Qty: 1, Type: "i16", Scale: 0.1, Unit: "A", Status: "vendor-sheet verified"},
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

	if err := ensureLatestTable(ctx, db, cfg); err != nil {
		slog.Error("collector schema check failed", "error", err)
		os.Exit(1)
	}

	groups := []pollGroup{
		{Name: "power", Interval: cfg.PowerLoop, UnitID: pcsUnitID, Points: powerPoints},
		{Name: "critical_alarm", Interval: cfg.CriticalLoop, UnitID: cfg.UnitID, Points: criticalPoints, IncludeStation: true, RequireSOC: true, IncludeAlarms: true},
	}

	latest := emptySnapshot(cfg)
	var latestMu sync.Mutex
	if cfg.Once {
		for _, group := range groups {
			if _, err := pollGroupOnce(ctx, db, cfg, group, latest, &latestMu); err != nil {
				slog.Error("collector poll failed", "group", group.Name, "error", err)
				os.Exit(1)
			}
		}
		if cfg.PrintJSON {
			if err := writeSnapshot(os.Stdout, latest); err != nil {
				slog.Error("print snapshot failed", "error", err)
			}
		}
		return
	}

	var wg sync.WaitGroup
	for _, group := range groups {
		group := group
		wg.Add(1)
		go func() {
			defer wg.Done()
			runPollGroup(ctx, db, cfg, group, latest, &latestMu)
		}()
	}
	wg.Wait()
}

func loadConfig() config {
	var cfg config
	flag.StringVar(&cfg.Host, "host", envString("HIEMS_HOST", defaultHost), "HiEMS Modbus host")
	flag.StringVar(&cfg.HTTPBase, "http-base", envString("HIEMS_HTTP_BASE", defaultHTTPBase), "HiEMS HTTP API base")
	flag.IntVar(&cfg.Port, "port", envInt("HIEMS_PORT", defaultPort), "HiEMS Modbus TCP port")
	unitID := flag.Int("unit-id", envInt("HIEMS_UNIT_ID", defaultUnitID), "HiEMS BMS Modbus unit id")
	flag.StringVar(&cfg.SiteID, "site-id", envString("JJEMS_SITE_ID", defaultSiteID), "JJEMS site UUID for alarm_events")
	flag.StringVar(&cfg.CabinetID, "cabinet-id", envString("JJEMS_CABINET_ID", defaultCabinetID), "JJEMS cabinet UUID")
	flag.StringVar(&cfg.DeviceID, "device-id", envString("JJEMS_DEVICE_ID", ""), "optional JJEMS device UUID for alarm_events")
	flag.StringVar(&cfg.DatabaseURL, "db-url", envString("DATABASE_URL", envString("JJEMS_DATABASE_URL", defaultDatabaseURL)), "PostgreSQL connection URL")
	flag.StringVar(&cfg.LiveJSON, "live-json", envString("HIEMS_LIVE_JSON", defaultLiveJSON), "live JSON output path")
	flag.DurationVar(&cfg.Interval, "interval", envDuration("SOC_LOG_INTERVAL_SEC", defaultInterval), "legacy poll interval")
	flag.DurationVar(&cfg.PowerLoop, "power-interval", envDuration("JJEMS_POWER_LOOP_INTERVAL", envDuration("JJEMS_POWER_LOOP_INTERVAL_SEC", defaultPowerLoop)), "power poll group interval")
	flag.DurationVar(&cfg.CriticalLoop, "critical-interval", envDuration("JJEMS_CRITICAL_LOOP_INTERVAL", envDuration("JJEMS_CRITICAL_LOOP_INTERVAL_SEC", defaultCriticalLoop)), "critical/alarm poll group interval")
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

func runPollGroup(ctx context.Context, db *pgxpool.Pool, cfg config, group pollGroup, latest *snapshot, latestMu *sync.Mutex) {
	for {
		snap, err := pollGroupOnce(ctx, db, cfg, group, latest, latestMu)
		if err != nil {
			slog.Error("collector poll failed", "group", group.Name, "error", err)
		} else {
			slog.Info("collector poll ok", "group", group.Name, "socPct", snap.Values["socPct"], "sohPct", snap.Values["sohPct"], "pcsKW", snap.Values["pcsKW"], "frequencyHz", snap.Values["frequencyHz"])
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(group.Interval):
		}
	}
}

func pollGroupOnce(ctx context.Context, db *pgxpool.Pool, cfg config, group pollGroup, latest *snapshot, latestMu *sync.Mutex) (*snapshot, error) {
	snap, err := buildGroupSnapshot(cfg, group)
	if err != nil {
		return nil, err
	}

	if group.RequireSOC {
		soc, ok := snap.Values["socPct"]
		if !ok || soc < 0 || soc > 100 {
			return nil, fmt.Errorf("SOC out of range: %v", snap.Values["socPct"])
		}
	}

	if err := insertTelemetry(ctx, db, cfg, snap); err != nil {
		return nil, err
	}
	if err := upsertLatestTelemetry(ctx, db, cfg, snap); err != nil {
		return nil, err
	}
	if group.IncludeAlarms {
		if err := syncAlarmEvents(ctx, db, cfg, snap); err != nil {
			return nil, err
		}
	}
	latestMu.Lock()
	mergeSnapshot(latest, snap)
	writeErr := writeLiveJSON(cfg.LiveJSON, latest)
	latestMu.Unlock()
	if writeErr != nil {
		return nil, writeErr
	}
	return snap, nil
}

func buildGroupSnapshot(cfg config, group pollGroup) (*snapshot, error) {
	groupValues, groupRaw, groupErrors := readPoints(cfg, group.Points, group.UnitID)
	values := map[string]float64{}
	for k, v := range groupValues {
		values[k] = v
	}

	station := map[string]any{}
	activeAlarms := []alarmState{}
	alarmErrors := map[string]string{}
	if group.IncludeAlarms {
		activeAlarms, alarmErrors = readAlarmStates(cfg, alarmPoints, group.UnitID)
	}

	if group.IncludeStation {
		station = readStationInfo(cfg.HTTPBase, cfg.Timeout)
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
	}

	meta := map[string]any{
		"pollGroup":       group.Name,
		"pollIntervalSec": group.Interval.Seconds(),
		"modbusStatus":    statusMap(group.Points),
		"modbusRaw":       groupRaw,
		"modbusErrors":    groupErrors,
		"stationInfoName": station["name"],
	}
	if group.IncludeAlarms {
		meta["activeAlarms"] = activeAlarms
		meta["alarmErrors"] = alarmErrors
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
		Meta:          meta,
	}
	return snap, nil
}

func emptySnapshot(cfg config) *snapshot {
	return &snapshot{
		TS:            time.Now().UTC().Format(time.RFC3339Nano),
		Source:        "hiems-gateway",
		Host:          cfg.Host,
		SiteHasPV:     false,
		SiteHasEV:     false,
		PowerVerified: false,
		PVKW:          0,
		Values:        map[string]float64{},
		Meta:          map[string]any{"pollGroups": map[string]any{}},
	}
}

func mergeSnapshot(dst *snapshot, src *snapshot) {
	dst.TS = src.TS
	dst.Source = src.Source
	dst.Host = src.Host
	for k, v := range src.Values {
		dst.Values[k] = v
	}
	groups, _ := dst.Meta["pollGroups"].(map[string]any)
	if groups == nil {
		groups = map[string]any{}
		dst.Meta["pollGroups"] = groups
	}
	if name, ok := src.Meta["pollGroup"].(string); ok {
		groups[name] = src.Meta
	}
}

func readAlarmStates(cfg config, points []alarmPoint, unitID byte) ([]alarmState, map[string]string) {
	if len(points) == 0 {
		return nil, nil
	}
	minAddr, maxAddr := points[0].Addr, points[0].Addr
	for _, point := range points[1:] {
		if point.Addr < minAddr {
			minAddr = point.Addr
		}
		if point.Addr > maxAddr {
			maxAddr = point.Addr
		}
	}
	bits, err := readModbusBits(cfg.Host, cfg.Port, unitID, 2, minAddr, maxAddr-minAddr+1, cfg.Timeout)
	if err != nil {
		return nil, map[string]string{"fc02": err.Error()}
	}
	active := []alarmState{}
	for _, point := range points {
		idx := int(point.Addr - minAddr)
		if idx >= 0 && idx < len(bits) && bits[idx] {
			active = append(active, alarmState{
				Code:     point.Code,
				NameZH:   point.NameZH,
				Category: point.Category,
				Severity: point.Severity,
				Addr:     point.Addr,
				Active:   true,
			})
		}
	}
	return active, nil
}

func readModbusBits(host string, port int, unitID byte, fc byte, addr uint16, qty uint16, timeout time.Duration) ([]bool, error) {
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
	wantBytes := int((qty + 7) / 8)
	if byteCount != wantBytes || len(payload) < byteCount {
		return nil, fmt.Errorf("unexpected bit payload: %x", payload)
	}
	bits := make([]bool, qty)
	for i := 0; i < int(qty); i++ {
		bits[i] = payload[i/8]&(1<<uint(i%8)) != 0
	}
	return bits, nil
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
		fmt.Printf("INSERT INTO telemetry_cabinet_1s (ts, cabinet_id, pcs_p_kw, pcs_q_kvar, pcs_dc_power_kw, pcs_dc_voltage, pcs_dc_current, dc_voltage, dc_current, frequency, soc, soh, temp_avg, temp_max, temp_min, insulation_kohm, status_bitmap) VALUES (%q, %q::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL);\n",
			snap.TS,
			cfg.CabinetID,
			sqlValue(snap.Values, "pcsKW"),
			sqlValue(snap.Values, "pcsKVar"),
			sqlValue(snap.Values, "pcsDCPowerKW"),
			sqlValue(snap.Values, "pcsDCVoltageV"),
			sqlValue(snap.Values, "pcsDCCurrentA"),
			sqlValue(snap.Values, "bmsVoltageV"),
			sqlValue(snap.Values, "bmsCurrentA"),
			sqlValue(snap.Values, "frequencyHz"),
			sqlValue(snap.Values, "socPct"),
			sqlValue(snap.Values, "sohPct"),
			sqlValue(snap.Values, "avgCellTempC"),
			sqlValue(snap.Values, "maxCellTempC"),
			sqlValue(snap.Values, "minCellTempC"),
			sqlValue(snap.Values, "insulationKOhm"),
		)
		return nil
	}

	ctx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()
	_, err := db.Exec(ctx, `
		INSERT INTO telemetry_cabinet_1s (
			ts, cabinet_id, pcs_p_kw, pcs_q_kvar,
			pcs_dc_power_kw, pcs_dc_voltage, pcs_dc_current,
			dc_voltage, dc_current,
			frequency, soc, soh, temp_avg, temp_max, temp_min,
			insulation_kohm, status_bitmap
		)
		VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
		time.Now().UTC(),
		cfg.CabinetID,
		nullableFloat(snap.Values, "pcsKW"),
		nullableFloat(snap.Values, "pcsKVar"),
		nullableFloat(snap.Values, "pcsDCPowerKW"),
		nullableFloat(snap.Values, "pcsDCVoltageV"),
		nullableFloat(snap.Values, "pcsDCCurrentA"),
		nullableFloat(snap.Values, "bmsVoltageV"),
		nullableFloat(snap.Values, "bmsCurrentA"),
		nullableFloat(snap.Values, "frequencyHz"),
		nullableFloat(snap.Values, "socPct"),
		nullableFloat(snap.Values, "sohPct"),
		nullableFloat(snap.Values, "avgCellTempC"),
		nullableFloat(snap.Values, "maxCellTempC"),
		nullableFloat(snap.Values, "minCellTempC"),
		nullableFloat(snap.Values, "insulationKOhm"),
		nil,
	)
	return err
}

func ensureLatestTable(ctx context.Context, db *pgxpool.Pool, cfg config) error {
	if cfg.PrintSQL {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()
	_, err := db.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS telemetry_cabinet_latest (
			cabinet_id      UUID PRIMARY KEY,
			ts              TIMESTAMPTZ NOT NULL,
			updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			pcs_p_kw        REAL,
			pcs_q_kvar      REAL,
			pcs_dc_power_kw REAL,
			pcs_dc_voltage  REAL,
			pcs_dc_current  REAL,
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
			status_bitmap   INTEGER,
			metadata        JSONB DEFAULT '{}'
		)`)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, `
		ALTER TABLE telemetry_cabinet_1s
			ADD COLUMN IF NOT EXISTS pcs_dc_power_kw REAL,
			ADD COLUMN IF NOT EXISTS pcs_dc_voltage REAL,
			ADD COLUMN IF NOT EXISTS pcs_dc_current REAL;
		ALTER TABLE telemetry_cabinet_latest
			ADD COLUMN IF NOT EXISTS pcs_dc_power_kw REAL,
			ADD COLUMN IF NOT EXISTS pcs_dc_voltage REAL,
			ADD COLUMN IF NOT EXISTS pcs_dc_current REAL;
	`)
	return err
}

func upsertLatestTelemetry(ctx context.Context, db *pgxpool.Pool, cfg config, snap *snapshot) error {
	if cfg.PrintSQL {
		return nil
	}
	meta, err := json.Marshal(snap.Meta)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()
	_, err = db.Exec(ctx, `
		INSERT INTO telemetry_cabinet_latest (
			cabinet_id, ts, pcs_p_kw, pcs_q_kvar,
			pcs_dc_power_kw, pcs_dc_voltage, pcs_dc_current,
			dc_voltage, dc_current,
			frequency, soc, soh, temp_avg, temp_max, temp_min,
			insulation_kohm, status_bitmap, metadata
		)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
		ON CONFLICT (cabinet_id) DO UPDATE SET
			ts = EXCLUDED.ts,
			updated_at = NOW(),
			pcs_p_kw = COALESCE(EXCLUDED.pcs_p_kw, telemetry_cabinet_latest.pcs_p_kw),
			pcs_q_kvar = COALESCE(EXCLUDED.pcs_q_kvar, telemetry_cabinet_latest.pcs_q_kvar),
			pcs_dc_power_kw = COALESCE(EXCLUDED.pcs_dc_power_kw, telemetry_cabinet_latest.pcs_dc_power_kw),
			pcs_dc_voltage = COALESCE(EXCLUDED.pcs_dc_voltage, telemetry_cabinet_latest.pcs_dc_voltage),
			pcs_dc_current = COALESCE(EXCLUDED.pcs_dc_current, telemetry_cabinet_latest.pcs_dc_current),
			dc_voltage = COALESCE(EXCLUDED.dc_voltage, telemetry_cabinet_latest.dc_voltage),
			dc_current = COALESCE(EXCLUDED.dc_current, telemetry_cabinet_latest.dc_current),
			frequency = COALESCE(EXCLUDED.frequency, telemetry_cabinet_latest.frequency),
			soc = COALESCE(EXCLUDED.soc, telemetry_cabinet_latest.soc),
			soh = COALESCE(EXCLUDED.soh, telemetry_cabinet_latest.soh),
			temp_avg = COALESCE(EXCLUDED.temp_avg, telemetry_cabinet_latest.temp_avg),
			temp_max = COALESCE(EXCLUDED.temp_max, telemetry_cabinet_latest.temp_max),
			temp_min = COALESCE(EXCLUDED.temp_min, telemetry_cabinet_latest.temp_min),
			insulation_kohm = COALESCE(EXCLUDED.insulation_kohm, telemetry_cabinet_latest.insulation_kohm),
			status_bitmap = COALESCE(EXCLUDED.status_bitmap, telemetry_cabinet_latest.status_bitmap),
			metadata = telemetry_cabinet_latest.metadata || EXCLUDED.metadata`,
		cfg.CabinetID,
		time.Now().UTC(),
		nullableFloat(snap.Values, "pcsKW"),
		nullableFloat(snap.Values, "pcsKVar"),
		nullableFloat(snap.Values, "pcsDCPowerKW"),
		nullableFloat(snap.Values, "pcsDCVoltageV"),
		nullableFloat(snap.Values, "pcsDCCurrentA"),
		nullableFloat(snap.Values, "bmsVoltageV"),
		nullableFloat(snap.Values, "bmsCurrentA"),
		nullableFloat(snap.Values, "frequencyHz"),
		nullableFloat(snap.Values, "socPct"),
		nullableFloat(snap.Values, "sohPct"),
		nullableFloat(snap.Values, "avgCellTempC"),
		nullableFloat(snap.Values, "maxCellTempC"),
		nullableFloat(snap.Values, "minCellTempC"),
		nullableFloat(snap.Values, "insulationKOhm"),
		nil,
		string(meta),
	)
	return err
}

func syncAlarmEvents(ctx context.Context, db *pgxpool.Pool, cfg config, snap *snapshot) error {
	if cfg.PrintSQL {
		return nil
	}
	active, _ := snap.Meta["activeAlarms"].([]alarmState)
	ctx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()
	for _, point := range alarmPoints {
		if point.Severity == "info" {
			continue
		}
		if _, err := db.Exec(ctx, `
			INSERT INTO alarm_definitions (code, name_zh, name_en, severity, category, description)
			VALUES ($1, $2, $3, $4::alarm_severity, $5, $6)
			ON CONFLICT (code) DO UPDATE SET
				name_zh = EXCLUDED.name_zh,
				name_en = EXCLUDED.name_en,
				severity = EXCLUDED.severity,
				category = EXCLUDED.category,
				description = EXCLUDED.description`,
			point.Code, point.NameZH, point.NameEN, point.Severity, point.Category,
			fmt.Sprintf("TW vendor Modbus FC02 addr %d (%s)", point.Addr, point.Source)); err != nil {
			return err
		}
	}

	activeByCode := map[string]alarmState{}
	for _, alarm := range active {
		activeByCode[alarm.Code] = alarm
	}
	for _, point := range alarmPoints {
		if point.Severity == "info" {
			continue
		}
		if alarm, ok := activeByCode[point.Code]; ok {
			meta, err := json.Marshal(map[string]any{
				"source":    "tw-vendor-modbus-fc02",
				"addr":      alarm.Addr,
				"pollGroup": snap.Meta["pollGroup"],
			})
			if err != nil {
				return err
			}
			_, err = db.Exec(ctx, `
				INSERT INTO alarm_events (ts, site_id, device_id, alarm_def_id, severity, state, value, metadata)
				SELECT $1, $2::uuid, NULLIF($3, '')::uuid, d.id, $4::alarm_severity, 'active'::alarm_state, 1, $5::jsonb
				FROM alarm_definitions d
				WHERE d.code = $6
				  AND NOT EXISTS (
					SELECT 1 FROM alarm_events e
					WHERE e.site_id = $2::uuid
					  AND COALESCE(e.device_id::text, '') = COALESCE(NULLIF($3, '')::uuid::text, '')
					  AND e.alarm_def_id = d.id
					  AND e.state = 'active'
				  )`,
				time.Now().UTC(), cfg.SiteID, cfg.DeviceID, alarm.Severity, string(meta), alarm.Code)
			if err != nil {
				return err
			}
			continue
		}
		_, err := db.Exec(ctx, `
			UPDATE alarm_events e
			SET state = 'cleared'
			FROM alarm_definitions d
			WHERE e.alarm_def_id = d.id
			  AND d.code = $1
			  AND e.site_id = $2::uuid
			  AND COALESCE(e.device_id::text, '') = COALESCE(NULLIF($3, '')::uuid::text, '')
			  AND e.state = 'active'`, point.Code, cfg.SiteID, cfg.DeviceID)
		if err != nil {
			return err
		}
	}
	return nil
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
