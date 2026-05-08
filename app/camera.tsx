import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Alert, Linking, AppState } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraDevices,
} from 'react-native-vision-camera';
import { useRouter } from 'expo-router';

import {
  ensureCameraPermissions,
  getCameraPermissionStatus,
} from '@/services/camera/camera-permissions';

type Position = 'front' | 'back';
type Lens = 'normal' | 'wide';

export default function CameraScreen() {
  const router = useRouter();
  const cameraRef = useRef<Camera>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [position, setPosition] = useState<Position>('front');
  const [lens, setLens] = useState<Lens>('normal');

  const devices = useCameraDevices();
  const frontDevice = useCameraDevice('front');
  const backDevice = useCameraDevice('back');

  const frontWideDevice = useMemo(() => {
    return devices.find(
      (d) => d.position === 'front' && d.physicalDevices.includes('ultra-wide-angle-camera')
    );
  }, [devices]);

  const backWideDevice = useMemo(() => {
    return devices.find(
      (d) => d.position === 'back' && d.physicalDevices.includes('ultra-wide-angle-camera')
    );
  }, [devices]);

  const hasWide = position === 'front' ? !!frontWideDevice : !!backWideDevice;

  const device = useMemo(() => {
    if (position === 'front') {
      return lens === 'wide' && frontWideDevice ? frontWideDevice : frontDevice;
    }
    return lens === 'wide' && backWideDevice ? backWideDevice : backDevice;
  }, [position, lens, frontDevice, backDevice, frontWideDevice, backWideDevice]);

  const togglePosition = useCallback(() => {
    if (isRecording) return;
    setPosition((prev) => (prev === 'front' ? 'back' : 'front'));
    setLens('normal');
  }, [isRecording]);

  const toggleLens = useCallback(() => {
    if (isRecording) return;
    setLens((prev) => (prev === 'normal' ? 'wide' : 'normal'));
  }, [isRecording]);

  const requestPermissions = useCallback(async () => {
    const result = await ensureCameraPermissions();
    setHasPermission(result.granted);
  }, []);

  useEffect(() => {
    requestPermissions();
  }, [requestPermissions]);

  // 설정에서 돌아왔을 때 권한 재확인 (팝업 없이 상태만 조회)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setHasPermission(getCameraPermissionStatus().granted);
      }
    });
    return () => sub.remove();
  }, []);

  const startRecording = useCallback(() => {
    if (!cameraRef.current) return;
    setIsRecording(true);
    cameraRef.current.startRecording({
      onRecordingFinished: (video) => {
        setIsRecording(false);
        router.push({ pathname: '/playback', params: { videoPath: video.path } });
      },
      onRecordingError: (error) => {
        setIsRecording(false);
        Alert.alert('녹화 오류', error.message);
      },
    });
  }, [router]);

  const stopRecording = useCallback(async () => {
    if (!cameraRef.current) return;
    await cameraRef.current.stopRecording();
  }, []);

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>카메라/마이크 권한이 필요합니다</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermissions}>
          <Text style={styles.buttonText}>다시 요청</Text>
        </TouchableOpacity>
        <View style={{ height: 12 }} />
        <TouchableOpacity
          style={[styles.button, { backgroundColor: '#c63' }]}
          onPress={() => Linking.openSettings()}>
          <Text style={styles.buttonText}>설정에서 권한 허용</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>전면 카메라를 찾을 수 없습니다</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        video={true}
        audio={true}
      />
      <View style={styles.topControls}>
        <TouchableOpacity
          style={[styles.switchButton, isRecording && styles.switchButtonDisabled]}
          onPress={togglePosition}
          disabled={isRecording}>
          <Text style={styles.switchButtonText}>
            {position === 'front' ? '전면 ⟳' : '후면 ⟳'}
          </Text>
        </TouchableOpacity>
        {hasWide && (
          <TouchableOpacity
            style={[styles.lensButton, lens === 'wide' && styles.lensButtonActive, isRecording && styles.switchButtonDisabled]}
            onPress={toggleLens}
            disabled={isRecording}>
            <Text style={[styles.lensButtonText, lens === 'wide' && styles.lensButtonTextActive]}>
              {lens === 'wide' ? 'W' : '1x'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.recordButton, isRecording && styles.recordButtonActive]}
          onPress={isRecording ? stopRecording : startRecording}>
          <View style={isRecording ? styles.stopIcon : styles.recordIcon} />
        </TouchableOpacity>
        <Text style={styles.label}>
          {isRecording ? '녹화 중... 탭하여 중지' : '탭하여 녹화 시작'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    padding: 20,
  },
  text: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  controls: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  recordButtonActive: {
    backgroundColor: 'rgba(255,0,0,0.3)',
  },
  recordIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#ff0000',
  },
  stopIcon: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#ff0000',
  },
  label: {
    color: '#fff',
    marginTop: 12,
    fontSize: 14,
  },
  topControls: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    zIndex: 10,
  },
  switchButton: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  switchButtonDisabled: {
    opacity: 0.4,
  },
  switchButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  lensButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  lensButtonActive: {
    backgroundColor: '#fff',
  },
  lensButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  lensButtonTextActive: {
    color: '#000',
  },
});
