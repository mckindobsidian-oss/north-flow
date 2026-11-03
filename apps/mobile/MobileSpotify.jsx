import React, { useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useMobileTheme, GLASS } from './MobileAppearance.jsx';
import NorthIcon from './NorthIcon.jsx';
const PLAYLIST = 'https://open.spotify.com/playlist/37i9dQZF1DX8NTLI2TtZa6';
export default function MobileSpotify({ profile, save }) {
  const { ink, surface, light } = useMobileTheme();
  const playlist = profile?.pm?.spotifyPlaylist || PLAYLIST;
  const [draft, setDraft] = useState(playlist);
  const [error, setError] = useState('');
  const match = /^https:\/\/open\.spotify\.com\/(playlist|album|track)\/([A-Za-z0-9]+)(?:\?.*)?$/.exec(playlist);
  const uri = match ? `https://open.spotify.com/embed/${match[1]}/${match[2]}?theme=${light ? 1 : 0}` : '';
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <View style={{ backgroundColor: surface, borderRadius: 18, padding: 12, gap: 10, borderWidth: 1, borderColor: '#ffffff30', overflow: 'hidden' }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 12 }}><NorthIcon name="musical-notes" /><View style={{ flex: 1 }}><Text style={{ color: ink, fontSize: 16, fontWeight: '600' }}>Study soundtrack</Text><Text style={{ color: ink, fontSize: 13 }}>Spotify · Your playlist</Text></View><NorthIcon name={expanded ? 'close' : 'chevron-down'} /></Pressable>
    {expanded && <><TextInput accessibilityLabel="Spotify playlist link" value={draft} onChangeText={setDraft} autoCapitalize="none" style={{ color: ink, borderWidth: 1, borderColor: '#ffffff60', padding: 12, borderRadius: 10 }} /><Pressable accessibilityRole="button" onPress={async () => { if (!/^https:\/\/open\.spotify\.com\/(playlist|album|track)\/[A-Za-z0-9]+(?:\?.*)?$/.test(draft.trim())) return setError('Enter a Spotify playlist, album or track link.'); try { await save({ pm: { ...profile.pm, spotifyPlaylist: draft.trim() } }); setFailed(false); setError(''); } catch { setError('Could not save. Please retry.'); } }} style={{ padding: 12 }}><Text style={{ color: ink }}>Save playlist to account</Text></Pressable>{!!error && <Text style={{ color: '#ffc6c6' }}>{error}</Text>}</>}
    {expanded && !failed && uri && <View style={{ height: 440, borderRadius: 12, overflow: 'hidden' }}><WebView key={uri} nestedScrollEnabled scrollEnabled source={{ uri }} style={{ flex: 1, backgroundColor: 'transparent' }} javaScriptEnabled allowsInlineMediaPlayback mediaPlaybackRequiresUserAction originWhitelist={['https://open.spotify.com']} mixedContentMode="never" allowFileAccess={false} onError={() => setFailed(true)} onShouldStartLoadWithRequest={request => {
      if (request.url.startsWith('https://open.spotify.com/embed/')) return true;
      if (/^https:\/\/(open|accounts)\.spotify\.com\//.test(request.url)) Linking.openURL(request.url);
      return false;
    }} /></View>}
    {expanded && <><Text style={{ color: ink, fontSize: 12 }}>{failed ? 'Player unavailable here. Open the playlist in Spotify.' : 'Playback availability is controlled by Spotify.'}</Text><Pressable accessibilityRole="button" onPress={() => Linking.openURL(playlist)} style={{ padding: 12 }}><Text style={{ color: ink }}>Open in Spotify ↗</Text></Pressable></>}
  </View>;
}
