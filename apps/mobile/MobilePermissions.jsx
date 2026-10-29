import React, { useEffect, useState } from 'react';
import { AppState, Modal, PermissionsAndroid, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { device } from './lib/device.js';
import { GLASS, MobileBackdrop } from './MobileAppearance.jsx';
export default function MobilePermissions({ visible, profile, configure, onClose }) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const read = () => device?.status().then(setStatus).catch(e => setError(e.message));
    if (visible) read();
    const listener = AppState.addEventListener('change', value => { if (visible && value === 'active') read(); });
    return () => listener.remove();
  }, [visible]);
  const button = (title, action) => <Pressable accessibilityRole="button" onPress={() => Promise.resolve().then(action).catch(e => setError(e.message))} style={{ minHeight: 48, padding: 14, borderRadius: 14, backgroundColor: '#ffffff18', borderWidth: 1, borderColor: '#ffffff40' }}><Text style={{ color: '#fff', fontSize: 16 }}>{title}</Text></Pressable>;
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><MobileBackdrop profile={profile}><ScrollView contentContainerStyle={{ padding: 22, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32, gap: 18 }}>
    <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700' }}>Set up tracking</Text>
    <Text style={{ color: '#eee', fontSize: 15, lineHeight: 23 }}>North times only the app you are using while your screen is unlocked. Android asks you to approve each permission. You can skip setup and use focus, tasks and account sync.</Text>
    <View style={{ backgroundColor: GLASS, borderRadius: 18, padding: 18, gap: 14 }}>
      {button(`${status.usageAccess ? '✓' : '1'} Usage access · foreground app time`, () => device?.openUsageAccess())}
      {button(`${status.overlay ? '✓' : '2'} Display over apps · blocking screen`, () => device?.openOverlayAccess())}
      {button(`${status.browserAccess ? '✓' : '3'} Browser access · optional website limits`, () => device?.openBrowserAccess())}
      <Text style={{ color: '#ded9e8', lineHeight: 21 }}>Browser access uses Android Accessibility to read supported browsers’ address-bar hostname. It does not collect page text or passwords. Monitoring shows a persistent notification.</Text>
    </View>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#ffbdc5' }}>{error}</Text>}
    {button(busy ? 'Starting…' : 'Start tracking', async () => {
      if (busy) return; setBusy(true); setError('');
      try {
        const next = await device?.status();
        if (!next?.usageAccess || !next?.overlay) throw Error('Approve Usage access and Display over apps first, or skip for now.');
        if (Platform.OS === 'android' && Platform.Version >= 33) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        await configure(); await device.start(); await onClose();
      } finally { setBusy(false); }
    })}
    {button('Skip for now', onClose)}
  </ScrollView></MobileBackdrop></Modal>;
}
