import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  addNetworkSuggestion,
  addSavedNetwork,
  checkAndroidWifiScanPermission,
  connectAndroidToUserWifi,
  ensureAndroidWifiScanPermissions,
  getCapability,
  getDiagnostics,
  getLastScanDiagnostics,
  openSystemWifiSettings,
  scanWifiSsidList,
  type Capability,
  type WifiScanItem,
  type WifiScanPermissionStatus,
} from '@/services/wifi/android-saved-wifi';

type LogLine = { ts: number; level: 'info' | 'warn' | 'error'; text: string };

export default function WifiTestScreen() {
  const [capability, setCapability] = useState<Capability | null>(null);
  const [results, setResults] = useState<WifiScanItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<WifiScanItem | null>(null);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [permission, setPermission] = useState<WifiScanPermissionStatus>('denied');
  const logIdRef = useRef(0);

  const log = useCallback(
    (level: LogLine['level'], text: string) => {
      logIdRef.current += 1;
      setLogs((prev) => {
        const next: LogLine[] = [{ ts: Date.now(), level, text }, ...prev];
        return next.slice(0, 50);
      });
    },
    []
  );

  const ensurePermission = useCallback(async (): Promise<WifiScanPermissionStatus> => {
    try {
      await ensureAndroidWifiScanPermissions();
      setPermission('granted');
      log('info', 'permission: granted');
      return 'granted';
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes('PERMISSION_BLOCKED')) {
        setPermission('blocked');
        log('error', 'permission: blocked (시스템 설정에서 허용 필요)');
        return 'blocked';
      }
      if (msg.includes('PERMISSION_DENIED')) {
        setPermission('denied');
        log('warn', 'permission: denied');
        return 'denied';
      }
      setPermission('unavailable');
      log('error', `permission error: ${msg}`);
      return 'unavailable';
    }
  }, [log]);

  // 마운트 시: capability 조회 + 권한 자동 팝업 요청
  useEffect(() => {
    (async () => {
      const cap = await getCapability();
      setCapability(cap);
      if (cap) log('info', `capability: API ${cap.sdkInt}, addNetworks=${cap.supportsAddNetworks}`);
      else log('warn', 'native module unavailable (not Android?)');
      const cur = await checkAndroidWifiScanPermission();
      if (cur === 'granted') {
        setPermission('granted');
        log('info', 'permission: granted (already)');
      } else {
        await ensurePermission();
      }
    })();
  }, [log, ensurePermission]);

  const onScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setSelected(null);
    setPassword('');
    try {
      const list = await scanWifiSsidList();
      setResults(list);
      const diag = getLastScanDiagnostics();
      log(
        'info',
        diag
          ? `scan ok: ${list.length} (raw=${diag.rawCount}, emptySsid=${diag.emptySsidCount}, startScan=${diag.startScanTriggered}, broadcast=${diag.receivedBroadcast})`
          : `scan ok: ${list.length}`
      );
      if (list.length === 0) {
        const env = await getDiagnostics();
        if (env) {
          log(
            'warn',
            `env: wifiEnabled=${env.wifiEnabled} locationEnabled=${env.locationEnabled} cachedScanCount=${env.cachedScanCount}`
          );
          if (!env.wifiEnabled) {
            log('error', 'WiFi가 꺼져 있습니다');
          } else if (!env.locationEnabled && env.sdkInt < 33) {
            log('error', 'API 32 이하에서는 시스템 위치 서비스가 켜져 있어야 WiFi 스캔 가능');
          } else if (
            env.cachedScanCount === 0 &&
            env.sdkInt >= 34 &&
            diag &&
            !diag.startScanTriggered
          ) {
            log(
              'warn',
              'Android 14+에서 startScan throttle. "WiFi 설정" 버튼으로 시스템 패널을 열었다 돌아오면 캐시가 채워집니다'
            );
          }
        }
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes('PERMISSION_BLOCKED')) {
        setPermission('blocked');
        log('error', '권한 차단됨 — 시스템 설정에서 허용 필요');
      } else if (msg.includes('PERMISSION_DENIED')) {
        setPermission('denied');
        log('warn', '권한 거부 — 스캔 불가');
      } else {
        log('error', `scan failed: ${e?.code ?? ''} ${msg}`);
      }
    } finally {
      setScanning(false);
    }
  }, [scanning, log]);

  const onOpenSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  const onOpenWifiSettings = useCallback(async () => {
    try {
      await openSystemWifiSettings();
      log('info', 'WiFi 설정 패널 열림 — 잠깐 대기 후 뒤로가기로 돌아와 다시 스캔하세요');
    } catch (e: any) {
      log('error', `openSystemWifiSettings failed: ${e?.message ?? e}`);
    }
  }, [log]);

  const onSuggest = useCallback(async () => {
    if (!selected || suggesting) return;
    if (selected.sec !== 'OPEN' && password.length === 0) {
      log('warn', '비밀번호를 입력하세요');
      return;
    }
    setSuggesting(true);
    try {
      log('info', `addNetworkSuggestion: ssid="${selected.ssid}" sec=${selected.sec}`);
      const res = await addNetworkSuggestion(selected.ssid, password, selected.sec);
      if (res.ok) {
        log(
          'info',
          res.reason === 'duplicate'
            ? '이미 제안 네트워크로 등록됨 (status=' + res.status + ')'
            : '제안 등록 성공 (status=' + res.status + ')'
        );
      } else {
        log(
          'warn',
          `제안 등록 실패: reason=${res.reason}${res.message ? ` (${res.message})` : ''}`
        );
      }
    } catch (e: any) {
      log('error', `addNetworkSuggestion threw: ${e?.code ?? ''} ${e?.message ?? e}`);
    } finally {
      setSuggesting(false);
    }
  }, [selected, password, suggesting, log]);

  const onConnect = useCallback(async () => {
    if (!selected || connecting) return;
    if (selected.sec !== 'OPEN' && password.length === 0) {
      log('warn', '비밀번호를 입력하세요');
      return;
    }
    setConnecting(true);
    try {
      log('info', `connectAndroidToUserWifi: ssid="${selected.ssid}" sec=${selected.sec}`);
      await connectAndroidToUserWifi(selected.ssid, password, selected.sec);
      log('info', '연결 시도 완료 (네이티브 resolve) — 시스템에서 실제 연결 확인 필요');
    } catch (e: any) {
      log('error', `connect failed: ${e?.code ?? ''} ${e?.message ?? e}`);
    } finally {
      setConnecting(false);
    }
  }, [selected, password, connecting, log]);

  const onSave = useCallback(async () => {
    if (!selected || saving) return;
    if (selected.sec !== 'OPEN' && password.length === 0) {
      log('warn', '비밀번호를 입력하세요');
      return;
    }
    setSaving(true);
    try {
      log('info', `addSavedNetwork: ssid="${selected.ssid}" sec=${selected.sec}`);
      const res = await addSavedNetwork(selected.ssid, password, selected.sec);
      if (res.ok) {
        log('info', '저장 성공 (사용자 승인)');
      } else {
        log('warn', `저장 실패: reason=${res.reason}${res.message ? ` (${res.message})` : ''}`);
      }
    } catch (e: any) {
      log('error', `addSavedNetwork threw: ${e?.code ?? ''} ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  }, [selected, password, saving, log]);

  const capabilityText = useMemo(() => {
    if (capability == null) return 'unavailable';
    return `API ${capability.sdkInt} · ADD_NETWORKS=${capability.supportsAddNetworks ? 'Y' : 'N'} · SUGGESTION=${capability.supportsSuggestion ? 'Y' : 'N'}`;
  }, [capability]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>WiFi 저장 네트워크 테스트</Text>
        <Text style={styles.capability}>{capabilityText}</Text>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.button, scanning && styles.buttonDisabled]}
          onPress={onScan}
          disabled={scanning}>
          {scanning ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>스캔</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.wifiSettingsButton} onPress={onOpenWifiSettings}>
          <Text style={styles.buttonText}>WiFi 설정</Text>
        </TouchableOpacity>
        {permission === 'blocked' && (
          <TouchableOpacity style={styles.settingsButton} onPress={onOpenSettings}>
            <Text style={styles.buttonText}>권한 설정 열기</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.ssid}
        style={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>스캔 결과 없음</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.row, selected?.ssid === item.ssid && styles.rowSelected]}
            onPress={() => {
              setSelected(item);
              setPassword('');
            }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.ssid}>{item.ssid}</Text>
              <Text style={styles.meta}>{item.sec.toUpperCase()}</Text>
            </View>
          </TouchableOpacity>
        )}
      />

      {selected && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>
            {selected.ssid} <Text style={styles.formSec}>({selected.sec.toUpperCase()})</Text>
          </Text>
          {selected.sec !== 'OPEN' && (
            <TextInput
              style={styles.input}
              placeholder="비밀번호"
              placeholderTextColor="#888"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.buttonDisabled]}
            onPress={onSave}
            disabled={saving || connecting || suggesting}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>저장 네트워크에 추가 (시스템 UI)</Text>
            )}
          </TouchableOpacity>
          <View style={{ height: 8 }} />
          <TouchableOpacity
            style={[styles.suggestButton, suggesting && styles.buttonDisabled]}
            onPress={onSuggest}
            disabled={saving || connecting || suggesting}>
            {suggesting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>제안 네트워크 등록 (silent)</Text>
            )}
          </TouchableOpacity>
          <View style={{ height: 8 }} />
          <TouchableOpacity
            style={[styles.connectButton, connecting && styles.buttonDisabled]}
            onPress={onConnect}
            disabled={saving || connecting || suggesting}>
            {connecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>직접 연결 (앱 임시)</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.logBox}>
        <Text style={styles.logTitle}>로그</Text>
        <FlatList
          data={logs}
          keyExtractor={(item) => `${item.ts}-${item.text}`}
          renderItem={({ item }) => (
            <Text
              style={[
                styles.logLine,
                item.level === 'error' && styles.logError,
                item.level === 'warn' && styles.logWarn,
              ]}>
              {new Date(item.ts).toLocaleTimeString()} · {item.text}
            </Text>
          )}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  capability: { color: '#9aa', fontSize: 12, marginTop: 4 },
  actionRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8 },
  button: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  settingsButton: {
    backgroundColor: '#c63',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginLeft: 8,
    alignItems: 'center',
  },
  wifiSettingsButton: {
    backgroundColor: '#555',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginLeft: 8,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600' },
  list: { flex: 1, paddingHorizontal: 16 },
  empty: { color: '#777', textAlign: 'center', paddingVertical: 24 },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginVertical: 3,
    backgroundColor: '#1d1d1d',
  },
  rowSelected: { backgroundColor: '#264' },
  ssid: { color: '#fff', fontSize: 15, fontWeight: '600' },
  meta: { color: '#aaa', fontSize: 12, marginTop: 2 },
  formCard: {
    margin: 16,
    padding: 12,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
  },
  formTitle: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 8 },
  formSec: { color: '#9aa', fontWeight: '400' },
  input: {
    backgroundColor: '#000',
    color: '#fff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  saveButton: {
    backgroundColor: '#0a8',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  connectButton: {
    backgroundColor: '#36c',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  suggestButton: {
    backgroundColor: '#85c',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  logBox: {
    height: 140,
    backgroundColor: '#0a0a0a',
    paddingHorizontal: 12,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  logTitle: { color: '#888', fontSize: 11, marginBottom: 4 },
  logLine: { color: '#bcd', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  logWarn: { color: '#fc6' },
  logError: { color: '#f88' },
});
