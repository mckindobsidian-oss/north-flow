import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from './NorthIcon.jsx';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMobileTheme } from './MobileAppearance.jsx';

export default function MobileNavigation({ tabs, active, onChange }) {
  const { width } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const { accent } = useMobileTheme();
  const compact = width < 560;
  const rows = compact ? [tabs.slice(0, 4), tabs.slice(4)] : [tabs];
  return <View style={[s.position, { bottom: Math.max(10, bottom) }]}>
    <View accessibilityLabel="Main navigation" style={s.dock}>{rows.map((row, index) => <View key={index} style={s.row}>
      {row.map(([id, icon, label]) => {
        const selected = active === id;
        return <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => onChange(id)}
          style={({ pressed }) => [s.tab, selected && s.selected, pressed && { opacity: .72, transform: [{ scale: .96 }] }]}>
          <Ionicons name={selected ? icon.replace('-outline', '') : icon} size={21} color={selected ? accent : '#dbd8e3'} />
          <Text style={[s.label, selected && { color: accent }]}>{label}</Text>
        </Pressable>;
      })}
    </View>)}</View>
  </View>;
}
const s = StyleSheet.create({
  position: { position: 'absolute', left: 10, right: 10, alignItems: 'center' },
  dock: { width: '100%', maxWidth: 720, padding: 5, gap: 3, borderRadius: 20, borderWidth: 1, borderColor: '#ffffff38', backgroundColor: '#25252fe8', elevation: 12, shadowColor: '#000', shadowOpacity: .24, shadowRadius: 22, shadowOffset: { width: 0, height: 8 } },
  row: { flexDirection: 'row', gap: 3 },
  tab: { flex: 1, minHeight: 50, paddingHorizontal: 3, paddingVertical: 7, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: 'transparent' },
  selected: { backgroundColor: '#ffffff16', borderColor: '#ffffff30' },
  label: { color: '#dbd8e3', fontSize: 11, fontWeight: '600', textAlign: 'center' },
});
