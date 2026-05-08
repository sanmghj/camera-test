# 카메라 녹화 앱 개발 가이드

## 사용 라이브러리

| 라이브러리 | 버전 | 용도 |
|---|---|---|
| `react-native-vision-camera` | ^4.7.3 | 카메라 프리뷰, 녹화 시작/중지 |
| `react-native-video` | latest | 녹화된 영상 재생 |
| `expo-router` | ~6.0.23 | 화면 전환 (카메라→재생) |

## 참고할 코드 파일

### 1. 카메라 녹화 + 렌즈 전환 — `app/(tabs)/index.tsx`

핵심 API:

- **카메라 디바이스 탐색**: `useCameraDevice('front')`, `useCameraDevices()` → `physicalDevices.includes('ultra-wide-angle-camera')`로 와이드 카메라 감지
- **권한 처리**: `Camera.getCameraPermissionStatus()`, `Camera.requestCameraPermission()` (정적 메서드 사용, hooks보다 안정적)
- **녹화 시작**: `cameraRef.current.startRecording({ onRecordingFinished, onRecordingError })`
- **녹화 중지**: `cameraRef.current.stopRecording()`
- **카메라 전환**: `position`(전면/후면) + `lens`(일반/와이드) 상태를 분리하여 독립적으로 제어

### 2. 영상 재생 — `app/playback.tsx`

핵심 API:

- `<Video source={{ uri: videoPath }} controls={true} repeat={true} />` — react-native-video 컴포넌트로 네이티브 재생 컨트롤 표시

### 3. 라우팅 설정 — `app/_layout.tsx`

- `playback` 화면을 Stack.Screen으로 등록

### 4. 권한/플러그인 설정 — `app.json`

- plugins: `react-native-vision-camera`, `react-native-video`
- android.permissions: `CAMERA`, `RECORD_AUDIO`

### 5. 네이티브 권한 — `android/app/src/main/AndroidManifest.xml`

- `CAMERA`, `RECORD_AUDIO` 필수 (RECORD_AUDIO 누락 시 마이크 권한 요청 불가)

## 개발 시 주의사항

- `RECORD_AUDIO` 권한이 AndroidManifest에 빠지면 마이크 권한이 OS에 등록되지 않아 항상 denied 됨
- 권한 처리는 hooks(`useCameraPermission`) 대신 정적 메서드(`Camera.getCameraPermissionStatus()`)가 더 안정적
- 와이드 카메라 유무는 기기마다 다르므로 `useCameraDevices()`로 런타임 감지 후 조건부 UI 노출 필요

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

`gradlew clean` 은 Windows 환경에서 자주 실패합니다. `node_modules\react-native-screens\android\build` 같은 라이브러리 build 디렉터리 안의 jar 파일이 Gradle 데몬·Android Studio·백신에 의해 락이 걸려 삭제되지 않기 때문입니다. 부분 clean이 발생하면 codegen 디렉터리가 사라져 다음 빌드에서 CMake 에러가 연쇄로 발생합니다.

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

> ⚠️ `npx expo prebuild` 는 더 이상 실행하지 마세요. WiFi 네이티브 모듈이 추가된 이후로 prebuild 를 돌리면 `android/` 디렉터리가 재생성되면서 `MainApplication.kt` 의 모듈 등록, `build.gradle` 의 SDK 오버라이드, `AndroidManifest.xml` 의 권한 속성이 모두 날아갑니다. android/ 디렉터리는 이미 커밋되어 있으므로 prebuild 단계 없이 gradle 만으로 빌드합니다.

> ⚠️ `npx expo run:android` 는 USB 연결된 기기/에뮬레이터에 디버그 빌드를 직접 설치하는 개발용 명령입니다. APK 파일을 추출해 수동 설치하려는 경우에는 위의 `gradlew assembleRelease` / `assembleDebug` 를 사용하세요.

> ⚠️ `gradlew clean` 은 Windows 에서 권장하지 않습니다. 위 "빌드 이상 시 복구" 절차를 사용하세요. 깨끗한 상태가 필요 없는 일반 빌드에서는 gradle 의 incremental build 가 알아서 처리하므로 clean 자체가 불필요합니다.
