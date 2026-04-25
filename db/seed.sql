-- ============================================================
-- J&J Power EMS · Seed Data
-- Run after schema.sql
-- ============================================================

-- ----------------------------------------
-- Cabinet models (Zpower-AC-261L family)
-- ----------------------------------------
INSERT INTO cabinet_models (model_code, series, variant, pcs_rated_kw, pcs_max_kw,
  battery_kwh, battery_chemistry, cell_config, nominal_voltage, c_rate,
  has_mppt, mppt_kw, has_sts, has_transformer,
  width_mm, depth_mm, height_mm, weight_kg, ip_battery, ip_electrical, description)
VALUES
('Zpower-AC-261L-S120-L125-TR-2H','Zpower-AC-261L','wide',125,150,261.248,'LFP','1P260S',832,0.5,
  TRUE,120,TRUE,TRUE,1800,1350,2280,3500,'IP55','IP54','寬版光儲：2× MPPT (120kW) + STS + 幹變'),
('Zpower-AC-261L-S60-L125-TR-2H','Zpower-AC-261L','wide',125,150,261.248,'LFP','1P260S',832,0.5,
  TRUE,60,TRUE,TRUE,1800,1350,2280,3500,'IP55','IP54','寬版光儲：1× MPPT (60kW) + STS + 幹變'),
('Zpower-AC-261L-S120-L125-2H','Zpower-AC-261L','wide',125,150,261.248,'LFP','1P260S',832,0.5,
  TRUE,120,TRUE,FALSE,1800,1350,2280,3500,'IP55','IP54','寬版光儲：2× MPPT + STS'),
('Zpower-AC-261L-S60-L125-2H','Zpower-AC-261L','wide',125,150,261.248,'LFP','1P260S',832,0.5,
  TRUE,60,TRUE,FALSE,1800,1350,2280,3500,'IP55','IP54','寬版光儲：1× MPPT + STS'),
('Zpower-AC-261L-S120-2H','Zpower-AC-261L','wide',125,150,261.248,'LFP','1P260S',832,0.5,
  TRUE,120,FALSE,FALSE,1800,1350,2280,3500,'IP55','IP54','寬版光儲：2× MPPT'),
('Zpower-AC-261L-S60-2H','Zpower-AC-261L','wide',125,150,261.248,'LFP','1P260S',832,0.5,
  TRUE,60,FALSE,FALSE,1800,1350,2280,3500,'IP55','IP54','寬版光儲：1× MPPT'),
('Zpower-AC-261L-Narrow','Zpower-AC-261L','narrow',125,150,261.248,'LFP','1P260S',832,0.5,
  FALSE,NULL,FALSE,FALSE,1000,1350,2280,2300,'IP55','IP55','窄版純儲能：無 PV 整合，並聯擴展用');

-- ----------------------------------------
-- Tariff plan (台電高壓三段式 — 夏月)
-- ----------------------------------------
INSERT INTO tariff_plans (id, code, name, effective_from, basic_charge_per_kw)
VALUES ('11111111-0000-0000-0000-000000000001'::UUID,
  'tw-hv-3stage-summer-2024', '高壓三段式時間電價 (夏月)',
  '2024-04-01', 223.60);

-- 週一至五
INSERT INTO tariff_periods (plan_id, period_type, weekday_mask, start_hour, end_hour, price_per_kwh) VALUES
('11111111-0000-0000-0000-000000000001'::UUID, 'peak',     31, 16, 22, 8.05),
('11111111-0000-0000-0000-000000000001'::UUID, 'mid_peak', 31,  9, 16, 5.02),
('11111111-0000-0000-0000-000000000001'::UUID, 'mid_peak', 31, 22, 24, 5.02),
('11111111-0000-0000-0000-000000000001'::UUID, 'off_peak', 31,  0,  9, 2.18);

-- 週六：無尖峰
INSERT INTO tariff_periods (plan_id, period_type, weekday_mask, start_hour, end_hour, price_per_kwh) VALUES
('11111111-0000-0000-0000-000000000001'::UUID, 'mid_peak', 32,  9, 24, 2.27),
('11111111-0000-0000-0000-000000000001'::UUID, 'off_peak', 32,  0,  9, 2.18);

-- 週日及離峰日
INSERT INTO tariff_periods (plan_id, period_type, weekday_mask, start_hour, end_hour, price_per_kwh) VALUES
('11111111-0000-0000-0000-000000000001'::UUID, 'off_peak', 64, 0, 24, 2.18);

-- ----------------------------------------
-- Demo organization + site
-- ----------------------------------------
INSERT INTO organizations (id, name, legal_name, contact_email)
VALUES ('22222222-0000-0000-0000-000000000001'::UUID,
  'J&J Power Demo', 'J&J Power GmbH', 'demo@jjpower.com');

INSERT INTO sites (id, org_id, code, name, address, contract_kw, tariff_plan_id, industry, pv_kwp)
VALUES ('33333333-0000-0000-0000-000000000001'::UUID,
  '22222222-0000-0000-0000-000000000001'::UUID,
  'kh-luzhu', '高雄路竹廠 · 表後儲能示範站',
  '高雄市路竹區中華四路 2 號',
  2500,
  '11111111-0000-0000-0000-000000000001'::UUID,
  '電子元件製造', 400);

-- Two cabinets
INSERT INTO cabinets (id, site_id, code, model_code, serial_number, install_date, ip_address, modbus_unit_id) VALUES
('44444444-0000-0000-0000-000000000001'::UUID,
  '33333333-0000-0000-0000-000000000001'::UUID,
  'SYS-A','Zpower-AC-261L-S120-L125-TR-2H','JJ261L-2024-001','2024-12-15','192.168.1.11'::INET,1),
('44444444-0000-0000-0000-000000000002'::UUID,
  '33333333-0000-0000-0000-000000000001'::UUID,
  'SYS-B','Zpower-AC-261L-S60-L125-2H','JJ261L-2024-002','2024-12-15','192.168.1.12'::INET,2);

-- ----------------------------------------
-- Strategies (system defaults)
-- ----------------------------------------
INSERT INTO strategies (org_id, code, name, description, color, params, is_system) VALUES
(NULL, 'arbitrage', '尖離峰時間套利', '依時間電價自動充放電，賺取尖離峰價差', '#00c2a8',
  '{"soc_min":15,"soc_max":90,"max_charge_kw":180,"max_discharge_kw":225,"max_cycles_per_day":1.0}'::JSONB, TRUE),
(NULL, 'peak_shave', '削峰填谷 / 契約控制', '當需量超過設定上限時放電', '#3b82f6',
  '{"target_demand_kw":2300,"soc_min":15,"max_discharge_kw":225}'::JSONB, TRUE),
(NULL, 'sreg', '需量反應 (sReg)', '參與台電即時備轉輔助服務', '#f59e0b',
  '{"reserve_pct":80,"response_ms":1000}'::JSONB, TRUE),
(NULL, 'afc', '調頻輔助 (AFC/dReg)', '依電網頻率即時雙向調整', '#8b5cf6',
  '{"deadband_hz":0.1,"response_ms":500,"max_swing_kw":50}'::JSONB, TRUE),
(NULL, 'pv_self', '光儲自用', '白天儲存 PV 餘電，夜間放出', '#facc15',
  '{"pv_excess_threshold_kw":50,"discharge_window":["17:00","22:00"]}'::JSONB, TRUE),
(NULL, 'manual', '手動模式', '操作員手動下達 P/Q setpoint', '#8b98b0',
  '{}'::JSONB, TRUE);

-- ----------------------------------------
-- Alarm definitions (samples — extend as needed)
-- ----------------------------------------
INSERT INTO alarm_definitions (code, name_zh, name_en, severity, category, auto_action, recommended_action) VALUES
('cell.temp.warn',     '電芯溫度警告', 'Cell temperature warning', 'warning', 'thermal', 'derate',   '降功率運行，檢查液冷'),
('cell.temp.high',     '電芯溫度過高', 'Cell temperature critical','critical','thermal', 'shutdown', '立即停機，排查液冷與環境溫度'),
('cell.imbalance',     '電芯不平衡',   'Cell voltage imbalance',   'warning', 'battery', 'notify',   '啟動主動均衡，必要時更換 Pack'),
('insulation.low',     '絕緣值偏低',   'Insulation low',           'warning', 'safety',  'notify',   '檢查接地，避免漏電風險'),
('insulation.fault',   '絕緣異常',     'Insulation fault',         'critical','safety',  'shutdown', '立即停機，請技師到場'),
('pcs.comm.lost',      'PCS 通訊中斷', 'PCS comm lost',            'error',   'comm',    NULL,       '檢查網路、重啟 PCS'),
('bmu.comm.lost',      'BMU 通訊中斷', 'BMU comm lost',            'error',   'comm',    NULL,       '檢查 CAN 線、重啟 BCU'),
('contract.over',      '契約超約預警', 'Contract over-demand warn','warning', 'energy',  'derate',   '啟動削峰策略'),
('soc.low',            'SoC 過低',     'SoC low',                  'info',    'battery', NULL,       '排程下次充電'),
('fire.smoke',         '煙感觸發',     'Smoke detected',           'critical','safety',  'shutdown', '立即停機並啟動消防'),
('fire.aerosol',       '氣溶膠釋放',   'Aerosol fire released',    'critical','safety',  'shutdown', '系統下電，撤離現場');

-- ----------------------------------------
-- Demo modbus points (subset of HiTHIUM Rack Information sheet)
-- ----------------------------------------
INSERT INTO modbus_points (device_type, vendor, name_zh, name_en, address, function_code, data_type, scale, unit, writable) VALUES
('bcu','HiTHIUM','Rack 電池總電壓','Rack Voltage',                  90, 3,'uint16',0.1,  'V',  FALSE),
('bcu','HiTHIUM','Rack 電池總電流','Rack Current',                  91, 3,'int16', 0.1,  'A',  FALSE),
('bcu','HiTHIUM','RackSOC',         'Rack SOC',                     93, 3,'uint16',0.1,  '%',  FALSE),
('bcu','HiTHIUM','RackSOH',         'Rack SOH',                     94, 3,'uint16',0.1,  '%',  FALSE),
('bcu','HiTHIUM','Rack 絕緣值',     'Rack Insulation Value',        95, 3,'uint16',1.0,  'kΩ', FALSE),
('bcu','HiTHIUM','Rack 正極絕緣值', 'Rack Positive Insulation',     96, 3,'uint16',1.0,  'kΩ', FALSE),
('bcu','HiTHIUM','Rack 負極絕緣值', 'Rack Negative Insulation',     97, 3,'uint16',1.0,  'kΩ', FALSE),
('bcu','HiTHIUM','最大充電電流',    'Rack Max Charge Current',      98, 3,'uint16',0.1,  'A',  FALSE),
('bcu','HiTHIUM','最大放電電流',    'Rack Max Discharge Current',   99, 3,'uint16',0.1,  'A',  FALSE),
('bcu','HiTHIUM','單體電壓最高 ID', 'Max Cell Voltage ID',         100, 3,'uint16',1.0,  '#',  FALSE),
('bcu','HiTHIUM','單體最高電壓',    'Max Cell Voltage',            101, 3,'uint16',0.001,'V',  FALSE),
('bcu','HiTHIUM','單體電壓最低 ID', 'Min Cell Voltage ID',         102, 3,'uint16',1.0,  '#',  FALSE),
('bcu','HiTHIUM','單體最低電壓',    'Min Cell Voltage',            103, 3,'uint16',0.001,'V',  FALSE),
('bcu','HiTHIUM','單體溫度最高 ID', 'Max Cell Temp ID',            104, 3,'uint16',1.0,  '#',  FALSE),
('bcu','HiTHIUM','單體最高溫度',    'Max Cell Temperature',        105, 3,'int16', 0.1,  '°C', FALSE),
('bcu','HiTHIUM','單體溫度最低 ID', 'Min Cell Temp ID',            106, 3,'uint16',1.0,  '#',  FALSE),
('bcu','HiTHIUM','單體最低溫度',    'Min Cell Temperature',        107, 3,'int16', 0.1,  '°C', FALSE),
('bcu','HiTHIUM','Rack 平均電壓',   'Rack Average Voltage',        108, 3,'uint16',0.001,'V',  FALSE),
('bcu','HiTHIUM','Rack 平均溫度',   'Rack Average Temperature',    109, 3,'int16', 0.1,  '°C', FALSE),
('bcu','HiTHIUM','BMU1-16 通訊狀態','BMU 1-16 Comm State',         131, 3,'uint16',1.0,  'bitmap',FALSE);

-- Cell-level (range 133-134 voltage, 135-136 temperature)
-- Use array reference; ETL worker expands these into 512 individual reads

-- ----------------------------------------
-- Deployment topology for demo site (A. 邊緣單站)
-- ----------------------------------------
UPDATE sites SET deployment_mode = 'combined'
WHERE id = '33333333-0000-0000-0000-000000000001'::UUID;

-- ----------------------------------------
-- MQTT gateway (HiTHIUM SCU 對接 demo)
-- ----------------------------------------
INSERT INTO mqtt_gateways (id, site_id, client_id, username, password_hash,
  device_topic, gateway_topic, firmware_version, connection_state)
VALUES ('55555555-0000-0000-0000-000000000001'::UUID,
  '33333333-0000-0000-0000-000000000001'::UUID,
  'jjpower-kh-luzhu-scu-001', 'kh_luzhu_scu',
  '$argon2id$v=19$m=65536,t=3,p=4$DEMO_HASH_REPLACE_IN_PROD',
  'site/kh-luzhu/scu-001', 'gw/jjpower-kh-luzhu-scu-001',
  'V2.2.1', 'offline');

-- ----------------------------------------
-- MQTT field map (代表性 14 筆，從 V1.4 規範 107 個字段挑出)
-- 6 大類：BMS / PCS / 溫濕度 / 消防 / 關口表 / 儲能表
-- ----------------------------------------
INSERT INTO mqtt_field_map (device_kind, field_id, name_zh, name_en, data_type, value_type, unit, scale, target_table, target_column) VALUES
-- BMS
('BMS',  1, '簇狀態',           'Rack State',         '遙測','enum',  '',    1.0, NULL,                    NULL),
('BMS',  2, '簇電壓',           'Rack Voltage',       '遙測','int16', 'V',   0.1, 'telemetry_cabinet_1s',  'dc_voltage'),
('BMS',  3, '簇電流',           'Rack Current',       '遙測','int16', 'A',   0.1, 'telemetry_cabinet_1s',  'dc_current'),
('BMS',  4, '簇SOC',            'Rack SOC',           '遙測','int16', '%',   0.1, 'telemetry_cabinet_1s',  'soc'),
('BMS',  5, '簇SOH',            'Rack SOH',           '遙測','int16', '%',   0.1, 'telemetry_cabinet_1s',  'soh'),
('BMS',  6, '絕緣電阻',         'Insulation',         '遙測','int16', 'kΩ',  1.0, 'telemetry_cabinet_1s',  'insulation_kohm'),
('BMS',  8, '平均單體溫度',     'Avg Cell Temp',      '遙測','int16', '°C',  0.1, 'telemetry_cabinet_1s',  'temp_avg'),
('BMS', 13, '最高單體溫度',     'Max Cell Temp',      '遙測','int16', '°C',  0.1, 'telemetry_cabinet_1s',  'temp_max'),
-- PCS
('PCS',  1, '即時有功功率',     'PCS Active Power',   '遙測','int16', 'kW',  0.1, 'telemetry_cabinet_1s',  'pcs_p_kw'),
('PCS',  2, '即時無功功率',     'PCS Reactive Power', '遙測','int16', 'kVAR',0.1, 'telemetry_cabinet_1s',  'pcs_q_kvar'),
('PCS',  3, '電網頻率',         'Grid Frequency',     '遙測','uint16','Hz',  0.01,'telemetry_cabinet_1s',  'frequency'),
-- 關口表
('關口表', 1, '即時有功功率',   'Meter Active Power',  '遙測','int16', 'kW',  0.1, 'telemetry_meter_1m',    'p_kw'),
('關口表', 2, '功率因數',       'Meter PF',            '遙測','int16', '',    0.01,'telemetry_meter_1m',    'pf'),
('關口表', 3, '累計購入電量',   'Meter Import kWh',    '遙測','uint32','kWh', 0.1, 'telemetry_meter_1m',    'import_kwh_cumul');

-- ============================================================
-- Done. Demo data ready.
-- Next: register a user, run worker to start ingesting telemetry.
-- 三拓撲說明見 DEPLOYMENT.md
-- ============================================================
