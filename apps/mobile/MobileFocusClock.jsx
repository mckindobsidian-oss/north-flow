import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useMobileTheme } from './MobileAppearance.jsx';

function FlipDigit({ value, reduced }) {
  const rotation = useRef(new Animated.Value(1)).current;
  const last = useRef(value);
  const [previous, setPrevious] = useState(value);
  useEffect(() => {
    const old = last.current;
    last.current = value;
    if (old === value || reduced) { rotation.setValue(1); return; }
    setPrevious(old);
    rotation.setValue(0);
    const animation = Animated.timing(rotation, { toValue: 1, duration: 280, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [value, reduced, rotation]);
  return <View style={s.digit}>
    <Text allowFontScaling={false} style={s.digitText}>{value}</Text>
    {!reduced && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { borderRadius: 8, backgroundColor: '#44404f', justifyContent: 'center', alignItems: 'center', opacity: rotation.interpolate({ inputRange: [0,.8,1], outputRange: [1,1,0] }), transform: [{ perspective: 600 }, { rotateX: rotation.interpolate({ inputRange: [0,1], outputRange: ['0deg','-90deg'] }) }] }]}><Text allowFontScaling={false} style={s.digitText}>{previous}</Text></Animated.View>}
    <View pointerEvents="none" style={s.seam} />
  </View>;
}
export function MobileFlipClock() {
  const [now, setNow] = useState(() => new Date());
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(timer); listener.remove(); };
  }, []);
  const digits = [now.getHours(), now.getMinutes(), now.getSeconds()].map(v => String(v).padStart(2, '0'));
  return <View accessible accessibilityLabel={now.toLocaleTimeString()} style={s.flipRow}>{digits.map((pair, i) => <React.Fragment key={i}>
    {i > 0 && <Text style={s.colon}>:</Text>}{pair.split('').map((value, j) => <FlipDigit key={j} value={value} reduced={reduced} />)}
  </React.Fragment>)}</View>;
}
export default function MobileFocusClock({ seconds, total, phase, color }) {
  const { accent } = useMobileTheme();
  const { width, height } = useWindowDimensions();
  const size = Math.max(170, Math.min(300, width * .78, height * .44));
  const radius = size * 90 / 220;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(1, Math.max(0, 1 - seconds / Math.max(1, total)));
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return <View accessible accessibilityLabel={`${phase}, ${time}`} style={[s.dial, { width: size, height: size }]}>
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke="#ffffff30" strokeWidth={size * 7 / 220} fill="none" />
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke={color || accent} strokeWidth={size * 7 / 220} fill="none" strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - progress)} rotation={-90} origin={`${size / 2}, ${size / 2}`} />
    </Svg>
    <Text adjustsFontSizeToFit numberOfLines={1} style={[s.time, { maxWidth: size - 50 }]}>{time}</Text>
    <Text style={s.phase}>{phase.toUpperCase()}</Text>
  </View>;
}
const s = StyleSheet.create({
  dial: { alignSelf: 'center', justifyContent: 'center', alignItems: 'center', borderRadius: 180, backgroundColor: '#25252d85', borderWidth: 1, borderColor: '#ffffff45', marginTop: 8, marginBottom: 20 },
  time: { color: '#fff', fontSize: 54, fontWeight: '200', fontVariant: ['tabular-nums'], letterSpacing: -2 },
  phase: { color: '#ddd8e8', fontSize: 11, letterSpacing: 1.4, marginTop: 6 },
  caption: { color: '#d8d5e2', fontSize: 10, letterSpacing: 1, marginTop: 12 },
  flipRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 20 },
  digit: { backgroundColor: '#ffffff20', borderWidth: 1, borderColor: '#ffffff40', borderRadius: 9, width: 32, height: 48, alignItems: 'center', justifyContent: 'center' },
  digitText: { color: '#fff', fontSize: 32, fontWeight: '600', fontVariant: ['tabular-nums'] },
  seam: { position: 'absolute', top: '50%', width: '100%', height: 1, backgroundColor: '#0b0b1544' },
  colon: { color: '#eee', fontSize: 24, marginHorizontal: 1 },
});
