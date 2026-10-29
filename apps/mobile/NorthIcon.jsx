import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
const paths = {
  home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
  timer: 'M9 2h6M12 6v2m0 5 3-3M19 5l2 2',
  checkbox: 'm7 12 3 3 7-7', checkmark: 'm4 12 5 5L20 6',
  calendar: 'M4 8h16M8 2v4m8-4v4', shield: 'M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6Z',
  people: 'M3 21v-2a5 5 0 0 1 10 0v2m2-7a5 5 0 0 1 6 5v2',
  settings: 'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  refresh: 'M20 8a8 8 0 1 0 0 8M20 3v5h-5', play: 'm8 4 12 8-12 8Z',
  pause: 'M8 5v14m8-14v14', 'play-skip-forward': 'm4 5 11 7-11 7Zm15 0v14',
  expand: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6',
  contract: 'M3 9h6V3m12 6h-6V3M3 15h6v6m12-6h-6v6',
  close: 'm6 6 12 12M6 18 18 6', 'chevron-down': 'm6 9 6 6 6-6',
  'chevron-forward': 'm9 6 6 6-6 6', add: 'M12 4v16M4 12h16',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  pencil: 'm4 16-1 5 5-1L21 7l-5-5Zm10-12 5 5',
  'musical-notes': 'M9 18V5l11-2v13M9 8l11-2', open: 'M14 3h7v7M21 3 11 13M10 5H3v16h16v-7',
  trophy: 'M7 3h10v6a5 5 0 0 1-10 0ZM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4m-5 2v6m-5 1h10',
};
export default function NorthIcon({ name, size = 22, color = '#fff' }) {
  const key = name.replace(/-outline$/, '');
  const base = key === 'play-circle' ? 'play' : key;
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" accessible={false}>
    {['timer','settings'].includes(base) && <Circle cx={12} cy={base === 'timer' ? 14 : 12} r={base === 'timer' ? 8 : 6} />}
    {base === 'people' && <><Circle cx={8} cy={7} r={4}/><Circle cx={18} cy={8} r={3}/></>}
    {['calendar','checkbox'].includes(base) && <Rect x={3} y={4} width={18} height={17} rx={3}/>}
    {key === 'play-circle' && <Circle cx={12} cy={12} r={10}/>}
    <Path d={paths[base] || 'M19 6a9 9 0 1 0 1 10v-5h-8'} />
  </Svg>;
}
