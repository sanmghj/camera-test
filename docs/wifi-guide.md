# WiFi 저장 네트워크/연결 모듈 개발 가이드

## 사용 기술

| 항목 | 내용 | 용도 |
|---|---|---|
| Android `Settings.ACTION_WIFI_ADD_NETWORKS` | API 30+ | 시스템 UI 통한 사용자 승인 → **영구 저장 네트워크** 등록 |
| `WifiManager.addNetworkSuggestions(...)` | API 29+ | UI 없는 silent 제안 등록. 시스템이 신호 강도 보고 자동 연결 결정 |
| `WifiNetworkSuggestion` | API 29+ | 두 등록 경로 공통 페이로드 빌더 (SSID/비밀번호/보안유형) |
| `WifiManager.ScanResultsCallback` | API 30+ | 시스템 자체 주기 스캔까지 포함한 결과 통지 (앱 트리거 broadcast 보다 신뢰성 높음) |
| `WifiManager.startScan()` + `SCAN_RESULTS_AVAILABLE_ACTION` | API 24+ (legacy) | API 30 미만 fallback. API 34+ 에서는 사실상 throttled. |
| `LocationManagerCompat.isLocationEnabled` | androidx.core | 시스템 위치 서비스 활성 여부 진단 (API 32 이하에서 스캔 전제) |
| `react-native-wifi-reborn` | npm package | `connectToProtectedWifiSSID` (앱 스코프 임시 연결, `WifiNetworkSpecifier` 기반) |
| `PermissionsAndroid` | RN 내장 | `ACCESS_FINE_LOCATION` 항상 + API 33+ `NEARBY_WIFI_DEVICES` 추가 요청 (mielin 패턴) |
| RN `ReactPackage` + `ReactContextBaseJavaModule` | RN 0.81 | 네이티브 모듈 등록 (New Architecture interop) |

## 3가지 등록/연결 방식 비교 (핵심)

| 방식 | API 함수 | 시스템 UI | 영구 저장 | 자동 연결 | 사용 시점 |
|---|---|---|---|---|---|
| **저장 네트워크에 추가** | `addSavedNetwork()` → `Settings.ACTION_WIFI_ADD_NETWORKS` | ✅ 풀 다이얼로그 1회 | ✅ 사용자 저장 네트워크 (앱 무관) | ✅ 시스템 자동 | 사용자에게 명확하게 등록 사실 알리고 싶을 때 |
| **제안 네트워크 등록** | `addNetworkSuggestion()` → `WifiManager.addNetworkSuggestions` | ⚠️ 첫 호출 시 알림 1회만 | ✅ 앱 제안 네트워크로 저장 | ✅ 시스템이 우선순위 결정 | UI 부담 없이 silent 등록하고 싶을 때 |
| **직접 연결** | `connectAndroidToUserWifi()` → `react-native-wifi-reborn` `connectToProtectedWifiSSID` (`WifiNetworkSpecifier`) | ✅ 1회 다이얼로그 | ❌ 앱 스코프만 (영구 ❌) | ❌ 앱 종료 시 끊김. "앱을 통해 연결됨" 표시 | **이미 저장된 WiFi 로 재연결** 용도 (mielin 의 카메라 등록 후 사용자 홈 WiFi 복귀 시나리오) |

> ⚠️ Android 10+ (API 29+) 부터 앱이 임의로 영구 WiFi 프로파일을 만들 수 없습니다. `connectToProtectedWifiSSID` 는 내부적으로 `WifiNetworkSpecifier` 를 사용해 **앱 스코프 임시 연결**을 만들 뿐이며, 새 SSID 에 대해 호출하면 "앱을 통해 연결됨"으로 표시되고 시스템 저장 네트워크에는 추가되지 않습니다. 영구 저장이 필요하면 위 1번/2번 사용.

## 참고할 코드 파일

### 1. 네이티브 모듈 — `android/app/src/main/java/<package>/wifi/WifiSavedNetworkModule.kt`

핵심 메서드:

- **`getApiCapability()`** — `{ sdkInt, supportsAddNetworks(API≥30), supportsSuggestion(API≥29), needsFineLocationForScan(API<33), needsNearbyDevicesForScan(API≥33) }`
- **`getDiagnostics()`** — `{ sdkInt, wifiEnabled, locationEnabled, cachedScanCount, cachedScanError? }` — 0개 결과 진단용
- **`scan()`** — raw row 응답 (`{ results: [{SSID, BSSID, level, frequency, capabilities}, ...], startScanTriggered, receivedBroadcast }`). 필터/dedup/보안 추정은 모두 JS 에서 수행.
  - 캐시가 비어있지 않으면 즉시 반환
  - 비어있으면 `ScanResultsCallback`(API 30+) 또는 `BroadcastReceiver`(legacy) 등록 + 1초 간격 캐시 폴링 + 15초 타임아웃
  - `startScan()` 은 hint 로만 호출 (Android 14+ throttle 시 무시)
- **`addSavedNetwork(ssid, password, security)`** — `Settings.ACTION_WIFI_ADD_NETWORKS` 인텐트로 시스템 UI 호출. 결과: `{ ok, reason?, message?, resultCode? }`
- **`addNetworkSuggestion(ssid, password, security)`** — `WifiManager.addNetworkSuggestions` 호출. silent. ADD_DUPLICATE 는 ok=true 로 정상 처리.
- **`openSystemWifiSettings()`** — `Settings.ACTION_WIFI_SETTINGS` 인텐트. Android 14+ 캐시 비어있을 때 fallback.

NetRegSec 값 처리(security 파라미터): `'OPEN' | 'WPA_PSK' | 'WPA2_PSK' | 'WPA3_SAE'` (mielin 정의), 호환을 위해 소문자/구표기도 함께 매핑.

### 2. 네이티브 패키지 — `android/app/src/main/java/<package>/wifi/WifiSavedNetworkPackage.kt`

- `ReactPackage` 구현체. `createNativeModules()`에서 `WifiSavedNetworkModule` 인스턴스 반환.

### 3. 패키지 등록 — `android/app/src/main/java/<package>/MainApplication.kt`

- `getPackages()` 의 `PackageList(this).packages.apply { add(WifiSavedNetworkPackage()) }` 한 줄로 등록.
- `import <package>.wifi.WifiSavedNetworkPackage` 도 함께.

### 4. JS 계약 레이어 — `services/wifi/android-saved-wifi.ts`

타입 (mielin 정의 그대로):
- `NetRegSec = 'OPEN' | 'WPA_PSK' | 'WPA2_PSK' | 'WPA3_SAE'`
- `WifiScanItem = { ssid, sec }`
- `RawScanRow = { SSID, BSSID, level, frequency, capabilities }` — 네이티브 응답 그대로
- `ScanDiagnostics`, `Diagnostics`, `Capability`, `AddNetworkResult`, `AddSuggestionResult`, `WifiScanPermissionStatus`

핵심 함수 (mielin 시그니처와 동일):
- `scanWifiSsidList()` — `WifiScanItem[]` 반환. `ensureAndroidWifiScanPermissions` 호출 → `loadAndroidWifiScanRowsAfterRescan` → SSID 단일 키 dedup + 알파벳 정렬 + `(hidden SSID)` 필터.
- `loadAndroidWifiScanRowsAfterRescan()` — raw rows 반환 + 마지막 진단 정보를 모듈 내부에 저장.
- `guessSecFromCapabilities(cap)` — capabilities 문자열 → `NetRegSec`. SAE → WPA3_SAE / WPA2|RSN → WPA2_PSK / WPA → WPA_PSK / 그 외 OPEN.
- `ensureAndroidWifiScanPermissions()` — `ACCESS_FINE_LOCATION` 항상 요청 + API 33+ `NEARBY_WIFI_DEVICES` 추가. 거부 시 `Error('PERMISSION_DENIED')` / 차단 시 `Error('PERMISSION_BLOCKED:...')` throw.
- `checkAndroidWifiScanPermission()` — 요청 없이 상태만 조회 (`'granted'|'denied'|'blocked'|'unavailable'`).
- `addSavedNetwork(ssid, password, sec)` — 시스템 UI 등록.
- `addNetworkSuggestion(ssid, password, sec)` — silent 제안 등록.
- `connectAndroidToUserWifi(ssid, password, sec)` — `react-native-wifi-reborn` 의 `connectToProtectedWifiSSID` 호출 (mielin 동일).
- `getCapability()` / `getDiagnostics()` / `getLastScanDiagnostics()` / `openSystemWifiSettings()`.

### 5. 테스트 UI — `app/(tabs)/wifi.tsx`

- 마운트 시 capability 조회 + `ensureAndroidWifiScanPermissions` 자동 호출 → 권한 팝업 즉시 노출
- 스캔 → 결과 리스트 (SSID + 보안 타입) → 항목 선택 → 비밀번호 입력 폼
- **3개 액션 버튼**:
  - "저장 네트워크에 추가 (시스템 UI)" — 초록
  - "제안 네트워크 등록 (silent)" — 보라
  - "직접 연결 (앱 임시)" — 파랑
- 결과 0개 시 자동으로 `getDiagnostics()` 호출 → 위치 서비스/WiFi 상태/캐시 카운트 진단 메시지 출력
- 권한 차단 상태에서만 "권한 설정 열기" 버튼 노출
- 항상 노출되는 "WiFi 설정" 버튼 — Android 14+ throttle 회피용 시스템 패널 트리거
- 하단 50줄 로그 패널 (info / warn / error 색상 구분, 시간순)

### 6. 권한/플러그인 설정 — `app.json`

- `android.permissions`: `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`, `ACCESS_FINE_LOCATION`, `NEARBY_WIFI_DEVICES`

### 7. 네이티브 권한 — `android/app/src/main/AndroidManifest.xml`

mielin 환경과 동일하게:
- `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE` (always)
- `ACCESS_FINE_LOCATION` — 모든 API 레벨에 선언 (mielin 이 API 33+ 에서도 위치 권한 요청하므로 매니페스트에 살아있어야 함)
- `NEARBY_WIFI_DEVICES` — 플래그 없음 (mielin 환경 일치)

### 8. SDK 버전 오버라이드 — `android/build.gradle`

- `buildscript.ext` + 루트 `ext` 양쪽에 `minSdkVersion=24`, `compileSdkVersion=36`, `targetSdkVersion=36`, `buildToolsVersion="36.0.0"` 선언.
- Expo 의 `setIfNotExist` 우선순위를 이용해 기본값(35) 오버라이드.

### 9. npm 의존성

- `react-native-wifi-reborn` — `connectAndroidToUserWifi` 의 `connectToProtectedWifiSSID` 호출용. autolinking 으로 빌드 자동 통합.

## 개발 시 주의사항

### 영구 프로파일 / 앱 스코프 구분 (가장 흔한 혼동)

- `connectAndroidToUserWifi` (`connectToProtectedWifiSSID`) 는 **새로운 SSID 에 대해서는 영구 저장 안 됨**. 시스템 → 연결 → WiFi 목록에서 "앱을 통해 연결됨" 으로 표시되고 앱 종료 시 끊어짐. 새 네트워크 영구 등록이 필요하면 `addSavedNetwork` 또는 `addNetworkSuggestion` 사용.
- mielin 의 `connectAndroidToUserWifi` 가 정상 동작하는 이유는 **이미 저장된 사용자 홈 WiFi 로 재연결**하기 때문. 카메라 SoftAP 로 잠깐 옮겼다가 원래 저장된 네트워크로 돌아오는 시나리오.

### 권한

- API 33+ 에서 `NEARBY_WIFI_DEVICES` 권한이 없으면 `getScanResults()` 의 SSID 가 빈 문자열로 반환됩니다. mielin 패턴은 `ACCESS_FINE_LOCATION` + `NEARBY_WIFI_DEVICES` 둘 다 요청.
- `Settings.ACTION_WIFI_ADD_NETWORKS` 는 **API 30+ 전용**. API 29 이하는 `addNetworkSuggestion` (API 29+) 사용.
- 매니페스트에 `ACCESS_FINE_LOCATION` 가 있으면 위치 권한이 OS 에서 요구되므로, 사용자 거부 시 스캔 자체가 동작 안 함. mielin 이 이 패턴을 사용 중.

### 스캔

- `WifiManager.startScan()` 은 API 28+ 부터 throttling(2분당 4회), **API 34+ 에서는 사실상 차단** (대부분 false 반환). `ScanResultsCallback` (API 30+) 로 시스템 자체 주기 스캔(15-30초) 결과를 받는 게 표준.
- 시스템 캐시가 비어있고 시스템도 최근 스캔을 안 한 상태(절전 모드/롱슬립)면 15초 타임아웃 후에도 0개. 이 경우 `openSystemWifiSettings()` 로 시스템 패널을 잠깐 열어 OS 강제 fresh scan 트리거.
- 한글/특수문자 SSID: API 33+ 는 `ScanResult.wifiSsid` 사용 권장 (구버전 `r.SSID` 는 따옴표 포함됨). 코드에서 `trim('"')` 필수.
- `BroadcastReceiver` 등록 시 API 34+ 부터 `RECEIVER_EXPORTED` / `RECEIVER_NOT_EXPORTED` 플래그 필수 → `ContextCompat.registerReceiver(..., RECEIVER_NOT_EXPORTED)` 사용.

### 보안 / 등록

- `WifiNetworkSuggestion.Builder` 는 **WEP 미지원**. `NetRegSec` enum 에 WEP 가 없는 이유.
- 동일 SSID 재호출 시:
  - `addSavedNetwork`: 시스템 UI 동작이 OS 버전마다 다름 (덮어쓰기/거절/수정).
  - `addNetworkSuggestion`: `STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_DUPLICATE` 반환 → 우리 wrapper 는 `ok: true, reason: 'duplicate'` 로 처리.

### 빌드 환경

- New Architecture(`newArchEnabled=true`) 환경에서도 legacy `ReactPackage` 는 bridge interop 으로 동작. 이 모듈은 codegen TurboModule 스펙 없이 작성됨.
- `npx expo prebuild --clean` 실행 시 `android/` 디렉터리 전체가 재생성되어 직접 편집한 Manifest/Kt 파일이 사라집니다. **prebuild 절대 금지.**

## 빌드 방법

릴리즈 APK:

```powershell
cd camera-test
npm install
cd android
.\gradlew.bat assembleRelease
```

APK 출력 경로: `android/app/build/outputs/apk/release/app-release.apk`

디버그 APK (서명 키 없이 추출):

```powershell
cd camera-test\android
.\gradlew.bat assembleDebug
```

APK 출력 경로: `android/app/build/outputs/apk/debug/app-debug.apk`

### 빌드 이상 시 복구 (Windows)

`gradlew clean` 은 Windows 환경에서 자주 실패합니다. `node_modules\react-native-screens\android\build` 같은 라이브러리 build 디렉터리 안의 jar 파일이 Gradle 데몬·Android Studio·백신에 의해 락이 걸려 삭제되지 않기 때문입니다. 부분 clean이 발생하면 codegen 디렉터리가 사라져 다음 빌드에서 `add_subdirectory given source ... which is not an existing directory` 같은 CMake 에러가 연쇄로 발생합니다.

clean 대신 다음 순서로 복구:

```powershell
cd camera-test\android

# 1) Gradle 데몬 종료 (파일 락 해제)
.\gradlew.bat --stop

# 2) 앱 모듈의 build/네이티브 산출물만 수동 삭제 (node_modules 는 건드리지 않음)
Remove-Item -Recurse -Force app\build, app\.cxx -ErrorAction SilentlyContinue

# 3) 곧바로 빌드
.\gradlew.bat assembleRelease
```

추가로 점검:

- Android Studio 가 열려 있다면 닫고 빌드. IDE 가 build 디렉터리를 잠그는 경우가 많습니다.
- Windows Defender / 백신의 실시간 보호가 `D:\git\android\camera-test` 를 스캔 중이면 일시적으로 제외 경로 추가.
- Explorer 창으로 `node_modules\...\build\` 하위를 보고 있지 않은지 확인.

> ⚠️ `npx expo prebuild` 는 사용 금지. 이 명령을 돌리면 `android/` 디렉터리가 재생성되면서 `MainApplication.kt` 의 `add(WifiSavedNetworkPackage())` 등록과 `build.gradle` 의 SDK ext 오버라이드가 모두 사라집니다. android/ 디렉터리는 이미 커밋되어 있으므로 prebuild 없이 gradle 만으로 빌드합니다.

> ⚠️ `npx expo run:android` 는 USB 연결된 기기/에뮬레이터에 디버그 빌드를 직접 설치하는 개발용 명령입니다. APK 파일을 추출해 수동 설치하려는 경우에는 위의 `gradlew assembleRelease` / `assembleDebug` 를 사용하세요.

> ⚠️ `gradlew clean` 은 Windows 에서 권장하지 않습니다. 위 "빌드 이상 시 복구" 절차를 사용하세요. 깨끗한 상태가 필요 없는 일반 빌드에서는 gradle 의 incremental build 가 알아서 처리하므로 clean 자체가 불필요합니다.

## Mielin 이식 절차 (요약)

1. `android/app/src/main/java/com/sanghyeonkim/cameratest/wifi/` 폴더 통째로 mielin 의 `android/app/src/main/java/<mielin-package>/wifi/` 로 복사.
2. 복사된 두 .kt 파일의 첫 줄 `package com.sanghyeonkim.cameratest.wifi` → `package <mielin-package>.wifi` 로 변경.
3. mielin 의 `MainApplication.kt` 에 `import <mielin-package>.wifi.WifiSavedNetworkPackage` 와 `add(WifiSavedNetworkPackage())` 추가.
4. mielin `app.json` 의 `android.permissions` 배열에 4개 권한(`ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`, `ACCESS_FINE_LOCATION`, `NEARBY_WIFI_DEVICES`) 추가.
5. mielin `AndroidManifest.xml` 에 동일한 4개 `uses-permission` 항목 복사.
6. mielin 에 `react-native-wifi-reborn` 이 이미 설치되어 있는지 확인. 없으면 `npm install react-native-wifi-reborn`.
7. `services/wifi/android-saved-wifi.ts` 파일은 **그대로 복사** — 호출 계약(`NetRegSec`/`WifiScanItem` 등) 변경 금지.
8. mielin 의 settings 플로우 (예: `/net/reg` 성공 직후) 에서:
   - 영구 등록 + 시스템 UI 안내가 필요하면 → `addSavedNetwork(ssid, password, sec)` 호출
   - silent 등록을 원하면 → `addNetworkSuggestion(ssid, password, sec)` 호출
   - 이미 저장된 사용자 WiFi 로 재연결만 하면 됨 → `connectAndroidToUserWifi(ssid, password, sec)` 호출
9. 검증 순서:
   - `getCapability()` 가 정상 반환 → 모듈 등록 OK
   - `scanWifiSsidList()` 로 주변 SSID 보임 → 권한 + 스캔 OK
   - 위 8번의 시나리오에 맞는 함수로 등록/연결 → 시스템 설정에서 결과 확인 (저장 여부 / 앱 스코프 여부)
