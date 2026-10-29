import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { localDay, streakSummary, STREAK_MILESTONES } from '../../react-app/src/lib/streak.js';
import { GLASS } from './MobileAppearance.jsx';

export default function MobileStreak({ days = {}, onFocus, onTasks }) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const glow = useRef(new Animated.Value(1)).current;
  const progress = streakSummary(days, now);
  const goals = Number(Boolean(progress.today.focus)) + Number(Boolean(progress.today.task));
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(id); }, []);
  useEffect(() => {
    let disposed = false, animation;
    glow.setValue(1);
    AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (reduced || disposed || !progress.lit) return;
      animation = Animated.sequence([
        Animated.timing(glow, { toValue: 1.15, duration: 260, useNativeDriver: true }),
        Animated.spring(glow, { toValue: 1, useNativeDriver: true, friction: 5 })
      ]);
      animation.start();
    });
    return () => { disposed = true; animation?.stop(); };
  }, [progress.lit, glow]);
  return <View style={s.card}>
    <View style={s.row}><Text style={s.kicker}>YOUR DAILY SPARK</Text><Text style={s.hint}>Best · {progress.best} days</Text></View>
    <View style={[s.row, { marginVertical: 16 }]}>
      <Animated.Text style={[s.flame, !progress.lit && { opacity: .6 }, { transform: [{ scale: glow }] }]} accessibilityLabel={progress.lit ? 'Flame lit today' : 'Flame not lit yet'}>🔥</Animated.Text>
      <View style={{ flex: 1 }}><Text style={s.count}>{progress.current}<Text style={s.unit}> day{progress.current === 1 ? '' : 's'}</Text></Text><Text style={s.hint}>{progress.lit ? 'Flame lit. Keep growing tomorrow.' : goals ? 'Halfway there. One more goal.' : 'Every streak starts with a spark.'}</Text></View>
    </View>
    {[[progress.today.focus, 'Complete a Pomodoro', onFocus], [progress.today.task, 'Finish one task', onTasks]].map(([done, label, action]) => <Pressable key={label} accessibilityRole="button" onPress={action} style={[s.goal, done && s.done]}><Text style={s.text}>{done ? '✓' : '○'}  {label}</Text><Text style={s.hint}>{done ? 'Complete' : 'Start →'}</Text></Pressable>)}
    <Text style={[s.hint, { marginTop: 10 }]}>{goals} of 2 goals complete today</Text>
    <View style={[s.row, { marginVertical: 16 }]}>{Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now); date.setDate(date.getDate() - 6 + i);
      const day = days[localDay(date)] || {};
      const lit = day.focus && day.task;
      return <View key={i} style={s.weekDay}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={[s.hint, { height: 20, width: '100%', textAlign: 'center' }]}>{i === 6 ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'narrow' })}</Text><View style={[s.circle, i === 6 && s.current, lit && s.done]}><Text style={s.text}>{lit ? '🔥' : day.focus || day.task ? '◐' : date.getDate()}</Text></View></View>;
    })}</View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={s.goal}><Text style={s.text}>{expanded ? 'Hide rewards −' : 'Explore your rewards +'}</Text></Pressable>
    {expanded && STREAK_MILESTONES.map(([n, name]) => <View key={n} style={[s.goal, progress.best >= n && s.done]}><Text style={s.text}>{progress.best >= n ? '🔥' : '◇'} {name}</Text><Text style={s.hint}>{progress.best >= n ? 'Earned' : `${Math.min(progress.current, n)} / ${n} days`}</Text></View>)}
  </View>;
}
const s = StyleSheet.create({
  card: { padding: 20, borderRadius: 22, backgroundColor: GLASS, borderWidth: 1, borderColor: '#ffffff30', marginVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  kicker: { color: '#efce9a', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  hint: { color: '#ddd7e6', fontSize: 12, lineHeight: 18 },
  text: { color: '#fff', fontSize: 13, fontWeight: '600' },
  flame: { fontSize: 49, padding: 9, backgroundColor: '#f3b66a15', borderRadius: 20 },
  count: { color: '#fff', fontSize: 43, fontWeight: '700', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 19, fontWeight: '500' },
  goal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 13, minHeight: 48, marginTop: 8, borderWidth: 1, borderColor: '#ffffff30', borderRadius: 13 },
  done: { backgroundColor: '#f3b66a20', borderColor: '#f3b66a88' },
  weekDay: { flex: 1, alignItems: 'center', gap: 8 },
  circle: { width: 31, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff22' },
  current: { borderColor: '#c3b0ff', borderWidth: 2 }
});
