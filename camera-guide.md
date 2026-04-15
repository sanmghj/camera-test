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

```powershell
cd camera-test
npm install
npx expo prebuild --platform android
cd android
.\gradlew.bat assembleRelease
```

APK 출력 경로: `android/app/build/outputs/apk/release/app-release.apk`
