import React, { useState } from 'react';
import { Image, Pressable, Text, View, Switch } from 'react-native';
import { ENVIRONMENTS, GLASS, useMobileTheme } from './MobileAppearance.jsx';
import NorthIcon from './NorthIcon.jsx';
import { device } from './lib/device.js';
const text = { color: '#eeeaf5', fontSize: 14, lineHeight: 21 };
const panel = { padding: 16, borderRadius: 18, gap: 12, backgroundColor: GLASS, borderWidth: 1, borderColor: '#ffffff30' };
export default function MobileSettings({ user, profile, save, rows, cue, onLogout, openSetup, nativeStatus, refresh }) {
  const { accent } = useMobileTheme();
  const [width, setWidth] = useState(0);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const selected = profile.appearance?.id || profile.theme || 'violet-dusk';
  const tile = Math.max(60, Math.floor((width - 20) / 3));
  const button = (label, action) => <Pressable accessibilityRole="button" onPress={action} style={{ minHeight: 44, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#ffffff30' }}><Text style={text}>{label}</Text></Pressable>;
  const observed = new Map(rows.map(r => [r.kind === 'app' ? `app:${r.name}` : r.name, r.name]));
  for (const key of profile.hiddenUsageSites || []) if (!observed.has(key)) observed.set(key, key.replace(/^app:/, ''));
  return <>
    <View style={panel}><Text style={[text, { fontSize: 18, fontWeight: '700' }]}>{profile.name || user.name}</Text><Text style={text}>{user.email}</Text>{button('Sign out', onLogout)}</View>
    <View style={panel}><Text style={[text, { fontWeight: '700' }]}>Wallpapers</Text><View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {width > 0 && Object.entries(ENVIRONMENTS).map(([id, env]) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Use ${env.name}`} accessibilityState={{ selected: selected === id }} onPress={() => save({ theme: id, appearance: { id, at: Date.now() } })} style={{ width: tile, gap: 5 }}>
        <Image source={env.image} resizeMode="cover" style={{ width: tile, height: 64, borderRadius: 10, borderWidth: selected === id ? 2 : 1, borderColor: selected === id ? accent : '#ffffff40' }} />
        <Text numberOfLines={2} style={{ ...text, fontSize: 11, lineHeight: 15, height: 32 }}>{env.name}{selected === id ? ' ✓' : ''}</Text>
      </Pressable>)}
    </View></View>
    <View style={panel}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={[text, { fontWeight: '700' }]}>Completion sounds</Text><Switch accessibilityLabel="Completion sounds" trackColor={{ true: accent }} value={Boolean(profile.pm?.interfaceSounds)} onValueChange={value => save({ pm: { ...profile.pm, interfaceSounds: value } })} /></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>{button('−', () => save({ pm: { ...profile.pm, soundVolume: Math.max(0, (profile.pm?.soundVolume ?? .5) - .1) } }))}<Text style={[text, { flex: 1, textAlign: 'center' }]}>{Math.round((profile.pm?.soundVolume ?? .5) * 100)}%</Text>{button('+', () => save({ pm: { ...profile.pm, soundVolume: Math.min(1, (profile.pm?.soundVolume ?? .5) + .1) } }))}</View>
      {button('Preview task sound', () => cue({ ...profile, pm: { ...profile.pm, interfaceSounds: true } }, 'task'))}
    </View>
    <View style={panel}><Text style={[text, { fontWeight: '700' }]}>Device tracking</Text><Text style={text}>{nativeStatus.monitoring ? 'Active · foreground apps only' : 'Paused · focus and account sync still work'}</Text>{button('Manage tracking setup', openSetup)}{nativeStatus.monitoring && button('Pause tracking', async () => { await device?.stop(); await refresh(); })}{nativeStatus.vpn && button('Turn off extra VPN filter', async () => { await device.stopWebsiteBlocking(); await refresh(); })}</View>
    <View style={panel}><Pressable accessibilityRole="button" accessibilityState={{ expanded: hiddenOpen }} onPress={() => setHiddenOpen(!hiddenOpen)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}><View style={{ flex: 1 }}><Text style={[text, { fontWeight: '700' }]}>Hidden usage</Text><Text style={text}>{(profile.hiddenUsageSites || []).length} hidden · excluded from totals</Text></View><NorthIcon name={hiddenOpen ? 'close' : 'chevron-down'} /></Pressable>
      {hiddenOpen && [...observed].sort((a,b) => a[1].localeCompare(b[1])).map(([key, name]) => <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text style={[text, { flex: 1 }]} numberOfLines={2}>{name}</Text><Switch accessibilityLabel={`Hide ${name}`} trackColor={{ true: accent }} value={(profile.hiddenUsageSites || []).includes(key)} onValueChange={value => save({ hiddenUsageSites: value ? [...new Set([...(profile.hiddenUsageSites || []), key])] : (profile.hiddenUsageSites || []).filter(x => x !== key) })} /></View>)}
    </View>
  </>;
}
