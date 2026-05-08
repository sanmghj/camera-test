/**
 * Mielin 이식 메모:
 *  - 이 파일은 그대로 복사. 외부 호출자는 이 파일의 export 함수만 사용.
 *  - 네이티브측은 android/app/src/main/java/<package>/wifi/ 폴더 통째로 복사 + `package` 라인만 수정.
 *  - app.json permissions 4개(ACCESS_WIFI_STATE / CHANGE_WIFI_STATE / ACCESS_FINE_LOCATION / NEARBY_WIFI_DEVICES) 동반 이식.
 *  - MainApplication.kt 의 add(WifiSavedNetworkPackage()) 등록 한 줄 동반 이식.
 *  - 호출 계약(반환 union 타입)은 변경 금지 — 변경 시 mielin 호출부 동기화 필요.
 *
 *  설계 분담 (mielin 참조 구조와 일치):
 *   - 네이티브: raw scan rows 만 반환 (SSID/BSSID/level/frequency/capabilities). 필터/dedup/보안 추정 안 함.
 *   - JS: 권한, 빈/숨김 SSID 필터, SSID dedup, 보안 추정, 정렬을 모두 처리.
 */

import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { Permission } from 'react-native';

const LOG_TAG_WIFI = '[WiFi]';

// ===== Types =====

/** mielin 의 NetRegSec 정의와 동일 (대문자 SCREAMING_SNAKE) */
export type NetRegSec = 'OPEN' | 'WPA_PSK' | 'WPA2_PSK' | 'WPA3_SAE';

export type WifiScanItem = {
  ssid: string;
  sec: NetRegSec;
};

/** 네이티브가 돌려주는 row — Android ScanResult 필드명 그대로 */
export type RawScanRow = {
  SSID: string;
  BSSID: string | null;
  level: number; // dBm
  frequency: number; // MHz
  capabilities: string; // raw Android capabilities string (예: "[WPA2-PSK-CCMP][ESS]")
};

export type WifiScanPermissionStatus = 'granted' | 'denied' | 'blocked' | 'unavailable';

export type Capability = {
  sdkInt: number;
  supportsAddNetworks: boolean;
  supportsSuggestion: boolean;
  needsFineLocationForScan: boolean;
  needsNearbyDevicesForScan: boolean;
};

export type Diagnostics = {
  sdkInt: number;
  wifiEnabled: boolean;
  locationEnabled: boolean;
  cachedScanCount: number;
  cachedScanError?: string;
};

export type ScanDiagnostics = {
  rawCount: number;
  emptySsidCount: number;
  startScanTriggered: boolean;
  receivedBroadcast: boolean;
};

export type AddNetworkResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'unsupported' | 'cancelled' | 'unknown' | 'platform';
      message?: string;
      resultCode?: number;
    };

export type AddSuggestionResult =
  | { ok: true; status: number; reason?: 'duplicate' }
  | {
      ok: false;
      status?: number;
      reason: 'unsupported' | 'platform' | 'internal' | 'app_disallowed' | 'exceeds_max' | 'remove_invalid' | 'error';
      message?: string;
    };

type NativeScanResponse = {
  results: RawScanRow[];
  startScanTriggered: boolean;
  receivedBroadcast: boolean;
};

type NativeModuleShape = {
  getApiCapability(): Promise<Capability>;
  getDiagnostics(): Promise<Diagnostics>;
  scan(): Promise<NativeScanResponse>;
  addSavedNetwork(
    ssid: string,
    password: string,
    security: NetRegSec
  ): Promise<AddNetworkResult>;
  addNetworkSuggestion(
    ssid: string,
    password: string,
    security: NetRegSec
  ): Promise<AddSuggestionResult>;
  openSystemWifiSettings(): Promise<boolean>;
};

const native = NativeModules.WifiSavedNetwork as NativeModuleShape | undefined;

function isAndroidNative(): boolean {
  return Platform.OS === 'android' && !!native;
}

// ===== Last scan diagnostics (state) =====

let lastScanDiagnostics: ScanDiagnostics | null = null;

export function getLastScanDiagnostics(): ScanDiagnostics | null {
  return lastScanDiagnostics;
}

// ===== Permissions =====

function getApiLevel(): number {
  return typeof Platform.Version === 'number'
    ? Platform.Version
    : parseInt(String(Platform.Version), 10);
}

const NEARBY_WIFI_DEVICES = 'android.permission.NEARBY_WIFI_DEVICES' as Permission;

/** 권한 상태만 조회 (요청 팝업 없음) — UI 의 blocked 상태 표시 용도 */
export async function checkAndroidWifiScanPermission(): Promise<WifiScanPermissionStatus> {
  if (Platform.OS !== 'android') return 'unavailable';
  const fineGranted = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );
  if (!fineGranted) return 'denied';
  if (getApiLevel() >= 33) {
    const nearbyGranted = await PermissionsAndroid.check(NEARBY_WIFI_DEVICES);
    return nearbyGranted ? 'granted' : 'denied';
  }
  return 'granted';
}

/**
 * WiFi 스캔에 필요한 권한을 보장 (mielin 패턴).
 *  - 항상 ACCESS_FINE_LOCATION 먼저 요청
 *  - API 33+ 에서 추가로 NEARBY_WIFI_DEVICES 요청
 *  - 어느 하나라도 허용되지 않으면 throw
 *
 * 동작:
 *  - 허용 → resolve void
 *  - 사용자 거부 → throw Error('WiFi 검색을 위해 ... 권한이 필요합니다.')
 *  - "다시 묻지 않음" 또는 차단 → throw Error('PERMISSION_BLOCKED:...')
 */
export async function ensureAndroidWifiScanPermissions(): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('WiFi 권한은 Android에서만 지원됩니다.');
  }

  console.log(LOG_TAG_WIFI, '권한: PermissionsAndroid.request ACCESS_FINE_LOCATION');
  const fine = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );
  console.log(LOG_TAG_WIFI, '권한: ACCESS_FINE_LOCATION 결과 =', fine);
  if (fine !== PermissionsAndroid.RESULTS.GRANTED) {
    if (fine === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      throw new Error('PERMISSION_BLOCKED:ACCESS_FINE_LOCATION');
    }
    throw new Error('WiFi 검색을 위해 위치 권한이 필요합니다.');
  }

  if (getApiLevel() >= 33) {
    console.log(LOG_TAG_WIFI, '권한: PermissionsAndroid.request NEARBY_WIFI_DEVICES');
    const nearby = await PermissionsAndroid.request(NEARBY_WIFI_DEVICES);
    console.log(LOG_TAG_WIFI, '권한: NEARBY_WIFI_DEVICES 결과 =', nearby);
    if (nearby !== PermissionsAndroid.RESULTS.GRANTED) {
      if (nearby === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        throw new Error('PERMISSION_BLOCKED:NEARBY_WIFI_DEVICES');
      }
      throw new Error('WiFi 검색을 위해 주변 기기 권한이 필요합니다.');
    }
  }
}

// ===== Capability / Diagnostics =====

export async function getCapability(): Promise<Capability | null> {
  if (!isAndroidNative()) return null;
  return native!.getApiCapability();
}

export async function getDiagnostics(): Promise<Diagnostics | null> {
  if (!isAndroidNative()) return null;
  return native!.getDiagnostics();
}

/**
 * 시스템 WiFi 설정 패널을 열어 OS 가 fresh scan 을 수행하도록 유도.
 * Android 14+ 에서 startScan() 이 throttle 되고 시스템 캐시도 비어 있을 때의 fallback.
 */
export async function openSystemWifiSettings(): Promise<boolean> {
  if (!isAndroidNative()) return false;
  return native!.openSystemWifiSettings();
}

// ===== Raw scan rows =====

/**
 * 재탐색(startScan + system periodic scan 대기) 후 시스템 캐시의 raw row 목록을 반환.
 * 반환되는 row 는 필터링 전 원본 — 빈 SSID, '(hidden SSID)' 리터럴 등이 포함될 수 있음.
 * 호출 측에서 필요한 후처리(filter/dedup/보안 추정/정렬)를 직접 수행.
 */
export async function loadAndroidWifiScanRowsAfterRescan(): Promise<RawScanRow[]> {
  if (Platform.OS !== 'android' || !native) {
    throw new Error('WiFi 모듈은 Android에서만 지원됩니다.');
  }
  const res = await native.scan();
  const rawCount = res.results.length;
  const emptySsidCount = res.results.reduce(
    (n, r) => (r && typeof r.SSID === 'string' && r.SSID.trim() === '' ? n + 1 : n),
    0
  );
  lastScanDiagnostics = {
    rawCount,
    emptySsidCount,
    startScanTriggered: res.startScanTriggered,
    receivedBroadcast: res.receivedBroadcast,
  };
  return res.results;
}

// ===== Security parsing =====

/**
 * Android ScanResult.capabilities 문자열에서 NetRegSec 추정.
 * mielin 의 guessSecFromCapabilities 와 동일 — 가장 강한 보안부터 우선:
 *  - SAE → WPA3_SAE
 *  - WPA2 / RSN → WPA2_PSK (RSN 은 WPA2 의 별칭)
 *  - WPA → WPA_PSK
 *  - 그 외 → OPEN (WEP 는 별도 처리하지 않음)
 */
export function guessSecFromCapabilities(cap: string | null | undefined): NetRegSec {
  const caps = (cap ?? '').toUpperCase();
  if (caps.includes('SAE')) return 'WPA3_SAE';
  if (caps.includes('WPA2') || caps.includes('RSN')) return 'WPA2_PSK';
  if (caps.includes('WPA')) return 'WPA_PSK';
  return 'OPEN';
}

// ===== Top-level scan (mielin-aligned) =====

/** 스캔 결과에서 SSID 목록 + 보안 추정 (빈 문자열·중복 제거) */
export async function scanWifiSsidList(): Promise<WifiScanItem[]> {
  if (Platform.OS !== 'android') {
    throw new Error('WiFi 목록 스캔은 Android에서만 지원됩니다.');
  }
  await ensureAndroidWifiScanPermissions();
  console.log(LOG_TAG_WIFI, 'scanWifiSsidList: 재탐색 후 loadWifiList 경로 호출');
  const list = await loadAndroidWifiScanRowsAfterRescan();
  console.log(LOG_TAG_WIFI, 'WiFi 스캔 행 개수:', list.length);

  const outBySsid = new Map<string, NetRegSec>();
  for (const row of list) {
    if (row == null || typeof row !== 'object' || typeof row.SSID !== 'string') {
      continue;
    }
    const s = row.SSID.trim();
    if (!s || s === '(hidden SSID)') continue;
    if (!outBySsid.has(s)) {
      outBySsid.set(s, guessSecFromCapabilities(row.capabilities));
    }
  }
  return [...outBySsid.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ssid, sec]) => ({ ssid, sec }));
}

// ===== Save network =====

export async function addSavedNetwork(
  ssid: string,
  password: string,
  security: NetRegSec
): Promise<AddNetworkResult> {
  if (!isAndroidNative()) {
    return { ok: false, reason: 'platform', message: 'Android only' };
  }
  return native!.addSavedNetwork(ssid, password, security);
}

/**
 * UI 없는 silent 등록 — WifiNetworkSuggestion 으로 시스템에 네트워크를 제안.
 * 첫 호출 시 OS 가 "App suggests Wi-Fi networks" 알림을 띄울 수 있고, 이후로는 silent.
 * 시스템이 신호 강도/우선순위 보고 자동 연결 결정. 동일 SSID 재등록 시 ok=true (duplicate).
 *
 * 영구 프로파일이 필요하지만 전체 시스템 UI 띄우기 싫을 때 사용.
 */
export async function addNetworkSuggestion(
  ssid: string,
  password: string,
  security: NetRegSec
): Promise<AddSuggestionResult> {
  if (!isAndroidNative()) {
    return { ok: false, reason: 'platform', message: 'Android only' };
  }
  return native!.addNetworkSuggestion(ssid, password, security);
}

// ===== Direct connect (mielin 와 동일 시그니처) =====

/**
 * 사용자가 입력한 WiFi 로 단말을 직접 연결.
 * mielin 의 connectAndroidToUserWifi 와 동일한 동작 — react-native-wifi-reborn 의
 * connectToProtectedWifiSSID 사용. OPEN 은 password 무시, 그 외는 비밀번호 필수.
 *
 * mielin 이식 메모: 이 파일 그대로 복사 시 react-native-wifi-reborn 이 mielin 에도
 * 설치되어 있어야 동작. 미설치 시 require 시점에서 throw.
 */
export async function connectAndroidToUserWifi(
  ssid: string,
  password: string,
  sec: NetRegSec
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('WiFi 재연결은 Android에서만 자동 지원됩니다.');
  }
  await ensureAndroidWifiScanPermissions();

  const WifiManager = require('react-native-wifi-reborn').default as {
    connectToProtectedWifiSSID: (o: {
      ssid: string;
      password: string | null;
      isWEP?: boolean;
      isHidden?: boolean;
      timeout?: number;
    }) => Promise<void>;
  };

  const trimmed = ssid.trim();
  if (!trimmed) {
    throw new Error('SSID를 입력해 주세요.');
  }

  if (sec === 'OPEN') {
    console.log(
      LOG_TAG_WIFI,
      '네이티브 API 호출: connectToProtectedWifiSSID',
      JSON.stringify({
        ssid: trimmed,
        password: null,
        sec,
        isWEP: false,
        isHidden: false,
        timeout: 30,
      })
    );
    await WifiManager.connectToProtectedWifiSSID({
      ssid: trimmed,
      password: null,
      isWEP: false,
      isHidden: false,
      timeout: 30,
    });
    console.log(LOG_TAG_WIFI, 'connectToProtectedWifiSSID 완료 (OPEN), ssid=', trimmed);
    return;
  }

  if (!password) {
    throw new Error('보안이 OPEN이 아니면 비밀번호가 필요합니다.');
  }

  console.log(
    LOG_TAG_WIFI,
    '네이티브 API 호출: connectToProtectedWifiSSID',
    JSON.stringify({
      ssid: trimmed,
      password: '***',
      password_len: password.length,
      sec,
      isWEP: false,
      isHidden: false,
      timeout: 30,
    })
  );
  await WifiManager.connectToProtectedWifiSSID({
    ssid: trimmed,
    password,
    isWEP: false,
    isHidden: false,
    timeout: 30,
  });
  console.log(LOG_TAG_WIFI, 'connectToProtectedWifiSSID 완료, ssid=', trimmed);
}
