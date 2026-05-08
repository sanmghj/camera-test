import React from 'react';
import { FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';

type FeatureItem = {
  key: string;
  title: string;
  description: string;
  icon: 'camera.fill' | 'wifi';
  href: Href;
};

const FEATURES: FeatureItem[] = [
  {
    key: 'camera',
    title: '카메라',
    description: '권한 · 녹화 · 재생 (vision-camera)',
    icon: 'camera.fill',
    href: '/camera',
  },
  {
    key: 'wifi',
    title: 'WiFi',
    description: '스캔 · 저장 · 제안 · 직접 연결',
    icon: 'wifi',
    href: '/wifi',
  },
];

export default function MenuScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>camera-test</Text>
        <Text style={styles.subtitle}>기능별 단위 테스트</Text>
      </View>

      <FlatList
        data={FEATURES}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push(item.href)}
            activeOpacity={0.7}>
            <View style={styles.iconBox}>
              <IconSymbol name={item.icon} size={28} color="#2196F3" />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowDesc}>{item.description}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
  },
  title: { color: '#fff', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#9aa', fontSize: 13, marginTop: 4 },
  listContent: { paddingHorizontal: 16 },
  separator: { height: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1d1d1d',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  rowText: { flex: 1 },
  rowTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  rowDesc: { color: '#9aa', fontSize: 12, marginTop: 3 },
  chevron: { color: '#666', fontSize: 28, fontWeight: '300', paddingLeft: 8 },
});
