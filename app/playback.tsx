import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Video from 'react-native-video';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function PlaybackScreen() {
  const router = useRouter();
  const { videoPath } = useLocalSearchParams<{ videoPath: string }>();

  if (!videoPath) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>영상 경로가 없습니다</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>돌아가기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Video
        source={{ uri: videoPath }}
        style={styles.video}
        controls={true}
        resizeMode="contain"
        repeat={true}
      />
      <View style={styles.controls}>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>다시 녹화하기</Text>
        </TouchableOpacity>
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
  video: {
    flex: 1,
  },
  controls: {
    padding: 20,
    paddingBottom: 40,
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
