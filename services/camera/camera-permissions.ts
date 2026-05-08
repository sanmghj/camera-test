/**
 * Mielin 이식 메모:
 *  - 이 파일은 그대로 복사. 카메라/마이크 권한 처리 로직을 한 곳에 격리.
 *  - 호출 계약(반환 union 타입)은 변경 금지 — 변경 시 mielin 호출부 동기화 필요.
 *  - react-native-vision-camera 의존성은 mielin 도 동일하게 사용한다고 가정.
 */

import { Camera, type CameraPermissionStatus } from 'react-native-vision-camera';

export type CameraPermissionResult = {
  granted: boolean;
  camera: CameraPermissionStatus;
  microphone: CameraPermissionStatus;
};

/**
 * 카메라/마이크 권한을 확인하고 미허용 상태면 자동으로 시스템 팝업 요청 (WiFi 권한과 동일 패턴).
 *  - 'not-determined': 처음 요청 → OS 팝업 표시
 *  - 'denied': 이전에 거절됨 → 다시 요청 (사용자가 "다시 묻지 않음" 안 골랐다면 팝업 다시 표시)
 *  - 'granted' / 'restricted': 그대로 반환
 *
 * 최종 'denied' 가 반환되면 호출자가 blocked 상태로 간주하고 설정 이동 UI 노출.
 */
export async function ensureCameraPermissions(): Promise<CameraPermissionResult> {
  let camera = Camera.getCameraPermissionStatus();
  let microphone = Camera.getMicrophonePermissionStatus();

  if (camera === 'not-determined' || camera === 'denied') {
    camera = await Camera.requestCameraPermission();
  }
  if (microphone === 'not-determined' || microphone === 'denied') {
    microphone = await Camera.requestMicrophonePermission();
  }

  return {
    granted: camera === 'granted' && microphone === 'granted',
    camera,
    microphone,
  };
}

/**
 * 권한 상태 조회만 수행. 팝업 요청 없음 — AppState 'active' 복귀 시 재확인 등에 사용.
 */
export function getCameraPermissionStatus(): CameraPermissionResult {
  const camera = Camera.getCameraPermissionStatus();
  const microphone = Camera.getMicrophonePermissionStatus();
  return {
    granted: camera === 'granted' && microphone === 'granted',
    camera,
    microphone,
  };
}
