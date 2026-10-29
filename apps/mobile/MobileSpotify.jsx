import React, { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { GLASS } from './MobileAppearance.jsx';
import NorthIcon from './NorthIcon.jsx';
const PLAYLIST = 'https://open.spotify.com/playlist/37i9dQZF1DX8NTLI2TtZa6';
export default function MobileSpotify() {
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <View style={{ backgroundColor: GLASS, borderRadius: 18, padding: 12, gap: 10, borderWidth: 1, borderColor: '#ffffff30', overflow: 'hidden' }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 12 }}><NorthIcon name="musical-notes" /><View style={{ flex: 1 }}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Study soundtrack</Text><Text style={{ color: '#ded9e8', fontSize: 13 }}>Spotify · Intense Studying</Text></View><NorthIcon name={expanded ? 'close' : 'chevron-down'} /></Pressable>
    {expanded && !failed && <View style={{ height: 352, borderRadius: 12, overflow: 'hidden' }}><WebView source={{ uri: 'https://open.spotify.com/embed/playlist/37i9dQZF1DX8NTLI2TtZa6?utm_source=north&theme=0' }} style={{ flex: 1, backgroundColor: 'transparent' }} javaScriptEnabled allowsInlineMediaPlayback mediaPlaybackRequiresUserAction originWhitelist={['https://open.spotify.com']} mixedContentMode="never" allowFileAccess={false} onError={() => setFailed(true)} onShouldStartLoadWithRequest={request => {
      if (request.url.startsWith('https://open.spotify.com/embed/')) return true;
      if (/^https:\/\/(open|accounts)\.spotify\.com\//.test(request.url)) Linking.openURL(request.url);
      return false;
    }} /></View>}
    {expanded && <><Text style={{ color: '#ded9e8', fontSize: 12 }}>{failed ? 'Player unavailable here. Open the playlist in Spotify.' : 'Playback availability is controlled by Spotify.'}</Text><Pressable accessibilityRole="button" onPress={() => Linking.openURL(PLAYLIST)} style={{ padding: 12 }}><Text style={{ color: '#fff' }}>Open in Spotify ↗</Text></Pressable></>}
  </View>;
}
