import React, { createContext, useContext } from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';

// Match the website's environment names, wallpaper assets and accent colors.
export const ENVIRONMENTS = {
  'violet-dusk': { name: 'Violet Dusk', accent: '#A996E8', image: require('../../react-app/public/wallpapers/violet-dusk-v2.png') },
  'event-horizon': { name: 'Event Horizon', accent: '#E5B879', image: require('../../react-app/public/wallpapers/event-horizon-v2.png') },
  'obsidian-flow': { name: 'Obsidian Flow', accent: '#B8B8B8', image: require('../../react-app/public/wallpapers/obsidian-flow-v2.png') },
  'ember-horizon': { name: 'Ember Horizon', accent: '#FF7A3D', image: require('../../react-app/public/wallpapers/ember-horizon-v2.png') },
  'monochrome-terrain': { name: 'Monochrome Terrain', accent: '#B0B0B0', image: require('../../react-app/public/wallpapers/monochrome-terrain-v2.png') },
  'sculpted-bronze': { name: 'Sculpted Bronze', accent: '#D2A176', image: require('../../react-app/public/wallpapers/sculpted-bronze-ribbon.png') },
  'luminous-violet': { name: 'Luminous Violet', accent: '#D694FF', image: require('../../react-app/public/wallpapers/luminous-violet-ribbon.png') },
};
export const GLASS = 'rgba(28,29,39,0.66)';
const ThemeContext = createContext(ENVIRONMENTS['violet-dusk']);
export const useMobileTheme = () => useContext(ThemeContext);
export function MobileBackdrop({ profile, children }) {
  const id = profile?.appearance?.id || profile?.theme || 'violet-dusk';
  const environment = ENVIRONMENTS[id] || ENVIRONMENTS['violet-dusk'];
  const source = id === 'custom' && profile?.appearance?.photo?.data
    ? { uri: profile.appearance.photo.data } : environment.image;
  return <ThemeContext.Provider value={id === 'custom' ? { ...environment, accent: '#E8E5F1' } : environment}>
    <ImageBackground source={source} resizeMode="cover" style={{ flex: 1 }}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(7,8,18,0.62)' }]} />
      {children}
    </ImageBackground>
  </ThemeContext.Provider>;
}
