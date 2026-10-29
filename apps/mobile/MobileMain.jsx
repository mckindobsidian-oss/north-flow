import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Linking, Modal, PermissionsAndroid, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Switch as NativeSwitch, Text, TextInput, View } from 'react-native';
import Ionicons from './NorthIcon.jsx';
import MobileSettings from './MobileSettings.jsx';
import MobilePermissions from './MobilePermissions.jsx';
import MobileSpotify from './MobileSpotify.jsx';
import { createAudioPlayer } from 'expo-audio';
import { S, SYNC, subscribeStore, newUuid } from './lib/auth.js';
import { supabase } from './lib/supabase.js';
import Constants from 'expo-constants';
import MobileCharts from './MobileCharts.jsx';
import MobileStreak from './MobileStreak.jsx';
import MobileNavigation from './MobileNavigation.jsx';
import MobileFocusClock, { MobileFlipClock } from './MobileFocusClock.jsx';
import { ENVIRONMENTS, GLASS, MobileBackdrop, useMobileTheme } from './MobileAppearance.jsx';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { device, deviceSession } from './lib/device.js';
import { normalizeState, defaultBlocking, newRule, upsertRule, removeRule, upsertUsageLimit, removeUsageLimit, newSchedule, upsertSchedule, evaluateBlocking, WORKDAYS, WEEKDAY_LABELS } from './shared/blocking.js';
import { localDay, streakSummary, STREAK_MILESTONES, recordStreakDay } from '../../react-app/src/lib/streak.js';
import { formatTaskDateInput, parseTaskDate, taskDateText } from '../../react-app/src/lib/task-date.js';
import { readUsageHistory, mergeUsageSources } from '../../react-app/src/lib/usage-history.js';
import { isHiddenUsageSite } from '../../react-app/src/lib/analytics.js';
const WALLS = Object.fromEntries(Object.entries(ENVIRONMENTS).map(([id, value]) => [id, value.image]));
const TABS = [['home', 'home-outline', 'Home'], ['focus', 'timer-outline', 'Focus'], ['tasks', 'checkbox-outline', 'Tasks'], ['calendar', 'calendar-outline', 'Calendar'], ['flow', 'shield-outline', 'Flow'], ['social', 'people-outline', 'Social'], ['settings', 'settings-outline', 'Settings']];
const duration = seconds => {
  const n = Math.max(0, Math.round(seconds));
  return n >= 3600 ? `${Math.floor(n / 3600)}h ${Math.floor(n % 3600 / 60)}m` : n >= 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n}s`;
};
const dateKey = () => new Date().toISOString().slice(0, 10);
function Button({
  children,
  onPress,
  secondary,
  disabled,
  label
}) {
  const { accent } = useMobileTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={({
    pressed
  }) => [s.button, { backgroundColor: accent }, secondary && s.secondary, disabled && {
    opacity: .4
  }, pressed && {
    opacity: .7
  }]}><Text style={[s.buttonText, secondary && {
      color: '#f7f3ff'
    }]}>{children}</Text></Pressable>;
}
function Field({
  label,
  ...props
}) {
  return <View style={{
    gap: 7,
    marginBottom: 12
  }}><Text style={s.small}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#a6a0bb" style={s.input} {...props} /></View>;
}
function Card({
  children
}) {
  return <View style={s.card}>{children}</View>;
}
function IconAction({ label, icon, onPress }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.iconButton, { borderRadius: 12, backgroundColor: '#ffffff14', borderWidth: 1, borderColor: '#ffffff30', opacity: pressed ? .65 : 1 }]}><Ionicons name={icon} size={22} /></Pressable>;
}
function Switch(props) {
  const { accent } = useMobileTheme();
  return <NativeSwitch trackColor={{ false: '#ffffff40', true: accent }} thumbColor="#fff" {...props} />;
}
async function markDay(user, kind, now = new Date()) {
  const progress = await recordStreakDay(S, user.un, kind, now);
  if (progress?.lit) {
    const profile = await S.get(`u:${user.un}`);
    setTimeout(() => cue(profile, STREAK_MILESTONES.some(([n]) => n === progress.current) ? 'achievement' : 'streak'), 1100);
  }
  return progress;
}
function cue(profile, kind) {
  if (!profile?.pm?.interfaceSounds) return;
  const sounds = { task: require('../../react-app/public/sounds/task-complete.ogg'), focus: require('../../react-app/public/sounds/focus-complete.ogg'), break: require('../../react-app/public/sounds/break-complete.wav'), streak: require('../../react-app/public/sounds/streak-complete.wav'), achievement: require('../../react-app/public/sounds/achievement-complete.wav') };
  const player = createAudioPlayer(sounds[kind] || sounds.focus);
  player.volume = profile.pm.soundVolume ?? .5;
  player.play();
  setTimeout(() => player.remove(), 3500);
}
export default function MobileMain({
  user,
  onLogout
}) {
  const insets=useSafeAreaInsets();
  const [tab, setTab] = useState('home');
  const [profile, setProfile] = useState(user);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [setup, setSetup] = useState(false);
  useEffect(() => { S.get(`setup:${user.id}`).then(done => { if (!done && device) setSetup(true); }); }, [user.id]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 10000); return () => clearTimeout(timer); }, [message]);
  const [nativeStatus, setNativeStatus] = useState({});
  const syncLock = useRef(false);
  const scroll = useRef(null);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [tab]);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    const p = await S.get(`u:${user.un}`);
    if (p && mounted.current) setProfile({
      ...p,
      un: user.un
    });
  }, [user.un]);
  const refresh = useCallback(async (manual = false) => {
    if (syncLock.current) return;
    syncLock.current = true; setBusy(true);
    const errors = [];
    let history = await S.get(`usage-cache:${user.id}`).catch(() => []) || [];
    try {
      try { if (device && supabase) await deviceSession(supabase, user.id); } catch (e) { errors.push(e.message); }
      const results = await Promise.allSettled([
        (async () => {
          const result = await SYNC.flush('mobile refresh');
          if (!result.ok) throw Error('Some account changes are waiting to upload.');
          if (!(await SYNC.pull(user.un))) throw Error('Account settings could not refresh. Local edits are preserved.');
          await load();
        })(),
        (async () => {
          if (device) {
            const status = await device.status();
            if (mounted.current) setNativeStatus(status);
            if (manual === true && status.monitoring) await device.sync();
          }
          const fresh = await readUsageHistory(supabase, user.id, '1970-01-01', dateKey());
          history = fresh; await S.set(`usage-cache:${user.id}`, fresh);
        })()
      ]);
      for (const r of results) if (r.status === 'rejected') errors.push(r.reason?.message || 'Sync failed.');
      let local = [];
      if (device) { try { local = JSON.parse(await device.usage(user.id)); } catch {} }
      if (mounted.current) setRows(mergeUsageSources([...history, ...local]));
      if (errors.length) setMessage(errors.join(' '));
      else if (manual === true) setMessage('Account settings and usage refreshed.');
    } finally { syncLock.current = false; if (mounted.current) setBusy(false); }
  }, [user.id, user.un, load]);
  useEffect(() => {
    mounted.current = true;
    load();
    S.get(`usage-cache:${user.id}`).then(cached => { if (mounted.current && cached) setRows(mergeUsageSources(cached)); });
    refresh();
    const unsub = subscribeStore(key => {
      if (key === `u:${user.un}`) load();
    });
    SYNC.startRealtime(() => refresh());
    const interval = setInterval(() => refresh(), 30000);
    const state = AppState.addEventListener('change', value => {
      if (value === 'active') {
        supabase?.auth.startAutoRefresh();
        refresh();
      } else supabase?.auth.stopAutoRefresh();
    });
    return () => {
      mounted.current = false;
      unsub();
      clearInterval(interval);
      state.remove();
      SYNC.stopRealtime();
    };
  }, [refresh, load, user.un]);
  const save = async patch => {
    const key = `u:${user.un}`;
    const p = await S.get(key);
    const next = {
      ...p,
      ...patch
    };
    await S.set(key, next);
    setProfile({
      ...next,
      un: user.un
    });
  };
  const configureNative = async () => {
    if (!device) throw Error('Native monitoring is available in the Android APK.');
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) throw Error('Sign in before enabling monitoring.');
    const p = await S.get(`u:${user.un}`);
    await device.configure(JSON.stringify({
      owner: user.id,
      url: Constants.expoConfig.extra.supabaseUrl,
      key: Constants.expoConfig.extra.supabaseAnonKey,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      blocking: p.blocking || defaultBlocking()
    }));
  };
  useEffect(() => {
    if (!device || !user.authLinked) return;
    let live = true;
    (async () => {
      const status = await device.status();
      if (live) {
        setNativeStatus(status);
        if (status.monitoring) await configureNative();
      }
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [profile.blocking, user.id]);
  const configureRef = useRef(configureNative);
  configureRef.current = configureNative;
  useEffect(() => {
    const result = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session?.user?.id === user.id) setTimeout(() => configureRef.current().catch(() => {}), 0);
    });
    return () => result?.data.subscription.unsubscribe();
  }, [user.id]);
  const appearance = profile.appearance;
  const progress = streakSummary(profile.streakDays);
  const tasks = profile.tasks || [];
  return <MobileBackdrop profile={profile}><View style={{
      flex: 1
    }}>
    <ScrollView ref={scroll} contentContainerStyle={[s.body, { paddingTop: insets.top + 16 }]} keyboardShouldPersistTaps="handled" refreshControl={tab === 'flow' ? <RefreshControl refreshing={busy} onRefresh={() => refresh(true)} tintColor="#c3b0ff" /> : undefined}>
      {!['focus','home'].includes(tab) && <Text style={s.title}>{TABS.find(([id]) => id === tab)?.[2]}</Text>}
      {tab === 'flow' && <Button secondary disabled={busy} onPress={() => refresh(true)}>{busy ? 'Syncing…' : '↻ Refresh sync'}</Button>}
      {tab === 'home' && <><Text style={s.hero}>Hi, {profile.name || user.name} 👋</Text><Text style={s.muted}>Make room for what matters.</Text><Pressable accessibilityRole="button" onPress={() => setTab('focus')} style={[s.card, s.row]}><View style={{ flex: 1 }}><Text style={s.subtitle}>Start focus session</Text><Text style={s.muted}>{profile.pm?.w || 25} min · Pomodoro</Text></View><Ionicons name="play-circle" size={48} color="#fff" /></Pressable><Card><View style={s.sectionHeading}><Text style={s.subtitle}>Today</Text><Pressable accessibilityRole="button" onPress={() => setTab('calendar')} style={s.iconButton}><Text style={s.text}>Calendar →</Text></Pressable></View>{tasks.filter(t => !t.completed && (!t.due || t.due <= localDay())).slice(0, 5).map(t => <Text key={t.id} style={s.text}>○ {t.title}</Text>)}<Text style={s.small}>{tasks.filter(t => !t.completed && (!t.due || t.due <= localDay())).length === 0 ? 'All clear for today.' : 'Choose a task in Focus to get started.'}</Text></Card><FocusHistory user={user} /><MobileStreak days={profile.streakDays} onFocus={() => setTab('focus')} onTasks={() => setTab('tasks')} /></>}
      <View style={tab === 'focus' ? undefined : {
          display: 'none'
        }}><MobileFocus user={user} profile={profile} save={save} onMessage={setMessage} /></View>
      {tab === 'tasks' && <MobileTasks user={user} profile={profile} save={save} onMessage={setMessage} onOpenEditor={() => scroll.current?.scrollTo({ y: 0, animated: true })} />}
      {tab === 'calendar' && <MobileCalendar tasks={tasks} />}
      {tab === 'flow' && <MobileFlow user={user} profile={profile} save={save} rows={rows} />}
      {tab === 'social' && <MobileSocial user={user} onMessage={setMessage} />}
      {tab === 'settings' && <MobileSettings user={user} profile={profile} save={save} rows={rows} cue={cue} onLogout={async () => { await device?.stop(); await onLogout(); }} openSetup={() => setSetup(true)} nativeStatus={nativeStatus} refresh={() => refresh(true)} />}
    </ScrollView>
    {message && <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notification" onPress={() => setMessage('')} style={{ position:'absolute', top:insets.top+8, left:14, right:14, padding:14, borderRadius:14, backgroundColor:'#252530f5', borderWidth:1, borderColor:'#ffffff40', zIndex:30 }}><Text accessibilityLiveRegion="polite" style={s.text}>{message}  ×</Text></Pressable>}
    <MobilePermissions visible={setup} profile={profile} configure={configureNative} onClose={async () => { await S.set(`setup:${user.id}`, true); setSetup(false); setNativeStatus(await device.status()); }} />
    <MobileNavigation tabs={TABS} active={tab} onChange={setTab} />
  </View></MobileBackdrop>;
}
function MobileTasks({
  user,
  profile,
  save,
  onMessage,
  onOpenEditor
}) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('medium');
  const [editId, setEditId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [category, setCategory] = useState('Personal');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const tasks = profile.tasks || [];
  const submit = async () => {
    const date = parseTaskDate(due);
    if (!title.trim() || date === null) return onMessage('Enter a title and a valid due date.');
    const previous = tasks.find(t => t.id === editId);
    const task = {
      ...previous,
      id: editId || newUuid(),
      title: title.trim(),
      due: date,
      pri: priority,
      cat: category,
      diff: difficulty,
      desc: description,
      completed: previous?.completed || false,
      at: previous?.at || Date.now()
    };
    await save({
      tasks: editId ? tasks.map(t => t.id === editId ? task : t) : [...tasks, task]
    });
    setTitle('');
    setDue('');
    setDescription('');
    setEditId(null);
    setFormOpen(false);
  };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="New task" accessibilityState={{ expanded: formOpen }} onPress={() => setFormOpen(!formOpen)} style={[s.card,s.row]}><Ionicons name={formOpen ? 'close' : 'add'} /><Text style={s.subtitle}>New task</Text></Pressable>
    {formOpen && <Card><Text style={s.subtitle}>{editId ? 'Edit task' : 'New task'}</Text>
      <Field label="Task title" value={title} onChangeText={setTitle} maxLength={200} />
      <Field label="Due date · DD/MM/YYYY" value={due} onChangeText={v => setDue(formatTaskDateInput(v))} keyboardType="number-pad" maxLength={10} />
      <Text style={s.small}>Priority</Text><View style={s.wrap}>{['low', 'medium', 'high'].map(p => <Button key={p} secondary={priority !== p} onPress={() => setPriority(p)}>{p}</Button>)}</View>
      <Text style={s.small}>Difficulty</Text><View style={s.wrap}>{['easy', 'medium', 'hard'].map(p => <Button key={p} secondary={difficulty !== p} onPress={() => setDifficulty(p)}>{p}</Button>)}</View>
      <Text style={s.small}>Category</Text><View style={s.wrap}>{['Personal', 'Work', 'Study', 'Health'].map(p => <Button key={p} secondary={category !== p} onPress={() => setCategory(p)}>{p}</Button>)}</View>
      <Field label="Description" value={description} onChangeText={setDescription} multiline maxLength={2000} />
      <Button onPress={submit}>{editId ? 'Save task' : 'Add task'}</Button>
    </Card>}
    {tasks.map(task => <Card key={task.id}>
      <Text style={[s.subtitle, task.completed && {
        textDecorationLine: 'line-through',
        opacity: .6
      }]}>{task.title}</Text>
      <Text style={s.small}>{task.due ? taskDateText(task.due) : 'No due date'} · {task.pri} · {task.cat}</Text>
      <View style={s.wrap}>
        <IconAction label={task.completed ? 'Reopen task' : 'Complete task'} icon="checkmark" onPress={async () => {
          await save({
            tasks: tasks.map(t => t.id === task.id ? {
              ...t,
              completed: !t.completed
            } : t)
          });
          if (!task.completed) {
            await markDay(user, 'task');
            cue(profile, 'task');
          }
        }} />
        <IconAction label="Edit task" icon="pencil" onPress={() => {
          setFormOpen(true);
          onOpenEditor?.();
          setEditId(task.id);
          setTitle(task.title);
          setDue(taskDateText(task.due));
          setPriority(task.pri || 'medium');
          setCategory(task.cat || 'Personal');
          setDifficulty(task.diff || 'medium');
          setDescription(task.desc || '');
        }} />
        <IconAction label="Delete task" icon="trash" onPress={() => Alert.alert('Delete task?', task.title, [{
          text: 'Cancel',
          style: 'cancel'
        }, {
          text: 'Delete',
          style: 'destructive',
          onPress: () => save({
            tasks: tasks.filter(t => t.id !== task.id)
          })
        }])} />
      </View>
    </Card>)}
    <MobileSpotify />
  </>;
}
function MobileFocus({
  user,
  profile,
  save,
  onMessage
}) {
  const pm = {
    w: 25,
    sb: 5,
    lb: 15,
    ...profile.pm
  };
  const phases = ['Focus', 'Short break', 'Long break'];
  const durations = [pm.w, pm.sb, pm.lb].map(n => n * 60);
  const [phase, setPhase] = useState(0);
  const [left, setLeft] = useState(durations[0]);
  const [deadline, setDeadline] = useState(0);
  const [taskId, setTaskId] = useState('');
  const [picker, setPicker] = useState(false);
  const [settings, setSettings] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const { accent } = useMobileTheme();
  const phaseColors = [accent, '#30D158', '#FF9F0A'];
  const started = useRef(0);
  const finishing = useRef(false);
  const timerKey = `north:timer:${user.id}`;
  const planned = useRef(durations[0]);
  const sessionId = useRef(newUuid());
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    S.get(timerKey).then(value => {
      if (value && Number.isInteger(value.phase) && value.phase >= 0 && value.phase <= 2 && Number.isFinite(value.left) && value.left >= 0 && Number.isFinite(value.deadline)) {
        setPhase(value.phase);
        setLeft(value.left);
        setDeadline(value.deadline);
        started.current = value.started;
        planned.current = value.planned || durations[0];
        sessionId.current = value.id || newUuid();
        setTaskId(value.taskId || '');
      }
    }).catch(() => onMessage('Saved timer could not be restored. You can start a new session.')).finally(() => setRestored(true));
  }, [timerKey]);
  useEffect(() => {
    if (restored) S.set(timerKey, {
      phase,
      left,
      deadline,
      started: started.current,
      taskId,
      planned: planned.current,
      id: sessionId.current
    });
  }, [phase, left, deadline, taskId, restored]);
  useEffect(() => {
    if (!deadline && !started.current) setLeft(durations[phase]);
  }, [pm.w, pm.sb, pm.lb]);
  const finish = async () => {
    if (finishing.current) return;
    finishing.current = true;
    try {
      const finishedAt = deadline || Date.now();
      setDeadline(0);
      await save({
        blocking: {
          ...normalizeState(profile.blocking),
          focus: null
        }
      });
      if (phase === 0) {
        const day = localDay(new Date(finishedAt));
        const key = `fs:${user.un}:${day}`;
        const records = (await S.get(key)) || [];
        if (!records.some(r => r.id === sessionId.current)) {
          records.push({
            id: sessionId.current,
            type: 'focus',
            start: started.current,
            end: finishedAt,
            planned: planned.current,
            actual: planned.current,
            completed: true,
            ...(taskId ? {
              taskId
            } : {})
          });
          await S.set(key, records);
          const total = (await S.get(`fo:${user.un}:${day}`)) || {
            s: 0
          };
          await S.set(`fo:${user.un}:${day}`, {
            s: total.s + planned.current
          });
        }
        await markDay(user, 'focus', new Date(finishedAt));
        setPhase(1);
        setLeft(durations[1]);
        onMessage('Pomodoro complete. Enjoy your break.');
      } else {
        setPhase(0);
        setLeft(durations[0]);
        onMessage('Break complete. Ready to focus.');
      }
      cue(profile, phase === 0 ? 'focus' : 'break');
      started.current = 0;
      sessionId.current = newUuid();
    } finally {
      finishing.current = false;
    }
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    if (!deadline) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setLeft(seconds);
      if (!seconds) finishRef.current();
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [deadline]);
  const choosePhase = async index => {
    setDeadline(0);
    setPhase(index);
    setLeft(durations[index]);
    started.current = 0;
    await save({
      blocking: {
        ...normalizeState(profile.blocking),
        focus: null
      }
    });
  };
  const toggle = async () => {
    if (deadline) {
      setDeadline(0);
      await save({
        blocking: {
          ...normalizeState(profile.blocking),
          focus: null
        }
      });
    } else {
      if (!started.current) {
        started.current = Date.now();
        planned.current = durations[phase];
      }
      setDeadline(Date.now() + left * 1000);
      if (phase === 0) await save({
        blocking: {
          ...normalizeState(profile.blocking),
          focus: {
            startedAt: started.current,
            minutes: left / 60,
            endAt: Date.now() + left * 1000
          }
        }
      });
    }
  };
  const controls = <View style={s.timerControls}>{[
    { label: 'Reset timer', icon: 'refresh-outline', action: () => choosePhase(phase) },
    { label: deadline ? 'Pause' : 'Start', icon: deadline ? 'pause-outline' : 'play-outline', action: toggle, primary: true },
    { label: 'Skip session', icon: 'play-skip-forward-outline', action: () => choosePhase(phase === 0 ? 1 : 0) },
    { label: immersive ? 'Exit focus mode' : 'Enter focus mode', icon: immersive ? 'contract-outline' : 'expand-outline', action: () => setImmersive(!immersive) },
  ].map(control => <Pressable key={control.label} disabled={!restored} accessibilityRole="button" accessibilityLabel={control.label} accessibilityState={{ disabled: !restored }} onPress={control.action} style={({ pressed }) => [s.timerControl, control.primary && { width: 80, backgroundColor: phaseColors[phase], borderColor: 'transparent', borderRadius: 16 }, pressed && { opacity: .7 }, !restored && { opacity: .4 }]}><Ionicons name={control.icon} size={control.primary ? 24 : 19} color={control.primary ? '#0b0b0e' : '#ece8f1'} /></Pressable>)}</View>;
  const phaseTabs = <View accessibilityLabel="Pomodoro phase" style={s.phaseTabs}>{phases.map((name, index) => <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: phase === index }} onPress={() => choosePhase(index)} style={[s.phaseTab, phase === index && { borderColor: phaseColors[index], backgroundColor: `${phaseColors[index]}20` }]}><Text style={[s.phaseText, phase === index && { color: phaseColors[index] }]}>{name}</Text></Pressable>)}</View>;
  const dial = <><MobileFlipClock />{phaseTabs}<MobileFocusClock seconds={left} total={deadline || started.current ? planned.current : durations[phase]} phase={phases[phase]} color={phaseColors[phase]} />{controls}</>;
  return <>
    <View style={s.sectionHeading}><View style={s.row}><Pressable accessibilityRole="button" accessibilityLabel="Enter focus mode" onPress={() => setImmersive(true)} style={s.iconButton}><Ionicons name="expand-outline" size={19} color="#fff" /></Pressable><Text style={s.title}>Focus</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Session settings" accessibilityState={{ expanded: settings }} onPress={() => setSettings(!settings)} style={s.iconButton}><Ionicons name="settings-outline" size={19} color="#fff" /></Pressable></View>
    <Text style={s.small}>Working on</Text><Pressable accessibilityRole="button" accessibilityLabel="Choose focus task" onPress={() => setPicker(true)} style={[s.input, s.row]}><Text style={[s.text, { flex: 1 }]}>{(profile.tasks || []).find(t => t.id === taskId && !t.completed)?.title || 'No task — just focus'}</Text><Ionicons name="chevron-down" size={17} color="#ddd8e8" /></Pressable>
    {dial}
      {taskId && (profile.tasks || []).some(t => t.id === taskId && !t.completed) && <Button secondary onPress={async () => {
        await save({
          tasks: profile.tasks.map(t => t.id === taskId ? {
            ...t,
            completed: true
          } : t)
        });
        await markDay(user, 'task');
        cue(profile, 'task');
        setTaskId('');
        onMessage('Task completed.');
      }}>Complete selected task</Button>}
    {settings && <Card><Text style={s.subtitle}>Session lengths</Text>{[['w', 'Focus'], ['sb', 'Short break'], ['lb', 'Long break']].map(([key, label]) => <View style={s.row} key={key}><Text style={[s.text, {
          flex: 1
        }]}>{label}</Text><Button secondary onPress={() => save({
          pm: {
            ...pm,
            [key]: Math.max(1, pm[key] - 1)
          }
        })}>−</Button><Text style={s.text}>{pm[key]}m</Text><Button secondary onPress={() => save({
          pm: {
            ...pm,
            [key]: Math.min(120, pm[key] + 1)
          }
        })}>+</Button></View>)}</Card>}
    <MobileSpotify />
    <Modal visible={immersive} animationType="fade" onRequestClose={() => setImmersive(false)}><MobileBackdrop profile={profile}><SafeAreaView style={{ flex: 1 }}><View style={{ alignItems: 'flex-start', paddingTop: 20, paddingHorizontal: 12 }}><Pressable accessibilityRole="button" accessibilityLabel="Exit focus mode" onPress={() => setImmersive(false)} style={s.iconButton}><Ionicons name="close" size={25} color="#fff" /></Pressable></View><ScrollView contentContainerStyle={[s.body, { flexGrow: 1, justifyContent: 'center', paddingBottom: 32 }]}><Text style={[s.muted, { textAlign: 'center' }]}>{(profile.tasks || []).find(t => t.id === taskId && !t.completed)?.title ? `Working on ${(profile.tasks || []).find(t => t.id === taskId)?.title}` : 'Make room for what matters.'}</Text>{dial}</ScrollView></SafeAreaView></MobileBackdrop></Modal>
    <Modal transparent visible={picker} animationType="fade" onRequestClose={() => setPicker(false)}><View style={s.modal}><View style={s.sheet}><Text style={s.subtitle}>Choose a task</Text><ScrollView><Button secondary onPress={() => {
              setTaskId('');
              setPicker(false);
            }}>Just focus</Button>{(profile.tasks || []).filter(t => !t.completed).map(t => <Button secondary key={t.id} onPress={() => {
              setTaskId(t.id);
              setPicker(false);
            }}>{t.title}</Button>)}</ScrollView><Button onPress={() => setPicker(false)}>Close</Button></View></View></Modal>
  </>;
}
function MobileCalendar({
  tasks
}) {
  const { accent } = useMobileTheme();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(localDay());
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = month.getDay();
  return <><Card><View style={s.row}><Button secondary onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</Button><Text style={[s.subtitle, {
          flex: 1,
          textAlign: 'center'
        }]}>{month.toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric'
          })}</Text><Button secondary onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</Button></View><View style={s.grid}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Text key={i} style={s.day}>{d}</Text>)}{Array.from({
          length: offset
        }, (_, i) => <View style={s.day} key={`blank${i}`} />)}{Array.from({
          length: days
        }, (_, i) => {
          const key = localDay(new Date(month.getFullYear(), month.getMonth(), i + 1));
          return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${key}, ${tasks.filter(t => t.due === key).length} tasks`} onPress={() => setSelected(key)} style={[s.day, key === selected && {
            backgroundColor: `${accent}55`,
            borderRadius: 10
          }]}><Text style={s.text}>{i + 1}</Text><Text style={{ color: '#eee', fontSize: 12, lineHeight: 14, height: 14 }}>{tasks.some(t => t.due === key) ? '•' : ' '}</Text></Pressable>;
        })}</View></Card><Text style={s.subtitle}>{taskDateText(selected)}</Text>{tasks.filter(t => t.due === selected).map(t => <Card key={t.id}><Text style={s.text}>{t.completed ? '✓' : '○'} {t.title}</Text></Card>)}{!tasks.some(t => t.due === selected) && <Text style={s.muted}>No tasks due on this day.</Text>}</>;
}
function FocusHistory({
  user
}) {
  const [days, setDays] = useState([]);
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeStore(key => {
    if (key.startsWith(`fo:${user.un}:`) || key === `u:${user.un}`) setRevision(n => n + 1);
  }), [user.un]);
  useEffect(() => {
    let live = true;
    Promise.all(Array.from({
      length: 28
    }, async (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - 27 + i);
      const key = localDay(date);
      return {
        day: key,
        seconds: (await S.get(`fo:${user.un}:${key}`))?.s || 0
      };
    })).then(value => {
      if (live) setDays(value);
    });
    return () => {
      live = false;
    };
  }, [user.un, revision]);
  return <Card><Text style={s.subtitle}>Focus activity · 4 weeks</Text><View style={s.wrap}>{days.map(d => <Pressable accessibilityLabel={`${d.day}: ${duration(d.seconds)}`} key={d.day} onPress={() => Alert.alert(d.day, duration(d.seconds) + ' focused')} style={{
        width: 24,
        height: 24,
        borderRadius: 5,
        backgroundColor: d.seconds ? '#c3b0ff' : '#ffffff1c',
        opacity: d.seconds ? Math.min(1, .3 + d.seconds / 5400) : 1
      }} />)}</View></Card>;
}
function MobileFlow({
  user,
  profile,
  save,
  rows
}) {
  const [from, setFrom] = useState(dateKey());
  const [to, setTo] = useState(dateKey());
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState(null);
  const [customTarget, setCustomTarget] = useState('');
  const [mode, setMode] = useState('daily');
  const [minutes, setMinutes] = useState('25');
  const [name, setName] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  const [days, setDays] = useState(WORKDAYS);
  const [error, setError] = useState('');
  const blocking = normalizeState(profile.blocking);
  const hidden = profile.hiddenUsageSites || [];
  const visible = rows.filter(r => r.day >= from && r.day <= to && !isHiddenUsageSite(r.kind === 'app' ? `app:${r.name}` : r.name, hidden));
  const total = visible.reduce((n, r) => n + r.seconds, 0);
  const totals = new Map();
  for (const r of visible) {
    const key = `${r.kind}:${r.name}`;
    const entry = totals.get(key) || {
      ...r,
      seconds: 0
    };
    entry.seconds += r.seconds;
    totals.set(key, entry);
  }
  const targets = [...new Map(rows.map(r => [`${r.kind}:${r.name}`, {
    kind: r.kind,
    name: r.name
  }])).values()];
  const current = evaluateBlocking(blocking, Date.now());
  const dayButton = offset => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);
    const key = date.toISOString().slice(0, 10);
    setFrom(key);
    setTo(key);
  };
  const yesterdayKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return <><View style={s.wrap}><Button secondary={from !== dateKey() || to !== from} onPress={() => dayButton(0)}>Today</Button><Button secondary={from !== yesterdayKey || to !== from} onPress={() => dayButton(-1)}>Yesterday</Button><Button onPress={() => setCreating(true)}>Create limit</Button></View><View style={{gap:14}}><Field label="From · YYYY-MM-DD" value={from} onChangeText={setFrom} maxLength={10} /><Field label="To · YYYY-MM-DD" value={to} onChangeText={setTo} maxLength={10} /><Text style={s.hero}>{duration(total)}</Text>{!visible.length && <Text style={s.muted}>{rows.length ? `No uploaded activity in this range. Latest account activity: ${[...rows].sort((a,b) => b.day.localeCompare(a.day))[0].day}. Refresh sync on the device recording your usage.` : 'No account usage received yet. Enable tracking for this phone, or refresh sync on your connected browser/desktop.'}</Text>}<MobileCharts rows={visible} from={from} to={to}/></View>{[...totals.values()].sort((a, b) => b.seconds - a.seconds).map(r => <View style={s.usageRow} key={`${r.kind}:${r.name}`}><View style={{
        flex: 1
      }}><Text style={s.text}>{r.name}</Text><Text style={s.small}>{r.kind === 'app' ? 'App' : 'Website'}</Text><View style={[s.usageBar, {
          width: `${Math.max(1, r.seconds / Math.max(1, total) * 100)}%`
        }]} /></View><Text style={s.text}>{duration(r.seconds)}</Text></View>)}<Text style={s.subtitle}>Usage limits</Text>{blocking.rules.map(rule => <Card key={rule.id}><Text style={s.text}>{rule.name || rule.target}</Text><Text style={s.small}>{rule.kind} · {rule.when} · {current.reasons?.[rule.id] ? 'Blocking now' : 'Configured'}</Text><Button secondary onPress={() => save({
        blocking: removeRule(blocking, rule.id)
      })}>Remove</Button></Card>)}{blocking.usageLimits.map(limit => <Card key={limit.id}><Text style={s.text}>{limit.name || limit.target}</Text><Text style={s.small}>{limit.kind} · {limit.dailyLimitMinutes}m · {limit.mode}</Text><Button secondary onPress={() => save({
        blocking: removeUsageLimit(blocking, limit.id)
      })}>Remove</Button></Card>)}
    <Modal visible={creating} animationType="slide" onRequestClose={() => setCreating(false)}><SafeAreaView style={s.modalPage}><ScrollView contentContainerStyle={s.body}><Text style={s.title}>Create a usage limit</Text><Text style={s.subtitle}>1 · Choose an observed website or app</Text>{targets.map(t => <Button secondary={target?.name !== t.name || target?.kind !== t.kind} key={`${t.kind}:${t.name}`} onPress={() => setTarget(t)}>{t.name} · {t.kind}</Button>)}{!targets.length && <Text style={s.muted}>Tracked websites and apps appear here after account sync. Open tracking setup in Settings to discover Android apps. You can also enter a website below.</Text>}<Field label="Or enter a website" value={customTarget} onChangeText={value => { setCustomTarget(value); const host=value.trim().toLowerCase().replace('https://','').replace('http://','').split('/')[0]; setTarget(host ? {kind:'website',name:host}:null); }} autoCapitalize="none" /><Text style={s.subtitle}>2 · Choose how to limit it</Text>{[['permanent', 'Block permanently'], ['scheduled', 'Block on a schedule'], ['daily', 'Daily allowance'], ['session', 'Per-session allowance']].map(([id, label]) => <Button key={id} secondary={mode !== id} onPress={() => setMode(id)}>{label}</Button>)}{['daily', 'session'].includes(mode) && <Field label="Minutes" value={minutes} onChangeText={v => setMinutes(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />}{mode === 'scheduled' && <><View style={s.wrap}>{WEEKDAY_LABELS.map((label, i) => <Button key={i} secondary={!days.includes(i)} onPress={() => setDays(days.includes(i) ? days.filter(d => d !== i) : [...days, i])}>{label}</Button>)}</View><Field label="Start · HH:MM" value={start} onChangeText={setStart} maxLength={5} /><Field label="End · HH:MM" value={end} onChangeText={setEnd} maxLength={5} /></>}<Field label="3 · Limit name" value={name} onChangeText={setName} />{error ? <Text style={s.error}>{error}</Text> : null}<Button onPress={async () => {
            if (!target) return setError('Choose an item.');
            const maximum = mode === 'session' ? 240 : 1440;
            if ((mode === 'daily' || (mode === 'session' && target.kind === 'app')) && (!Number(minutes) || Number(minutes) > maximum)) return setError(`Choose between 1 and ${maximum} minutes.`);
            let next = blocking;
            if (mode === 'permanent' || mode === 'scheduled') {
              let ids = [];
              if (mode === 'scheduled') {
                if (!days.length || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || start === end) return setError('Choose valid days and different start/end times.');
                const schedule = newSchedule({
                  name: name || target.name,
                  days,
                  start,
                  end
                });
                next = upsertSchedule(next, schedule);
                ids = [schedule.id];
              }
              next = upsertRule(next, newRule({
                kind: target.kind,
                target: target.name,
                when: mode === 'permanent' ? 'always' : 'scheduled',
                name: name || target.name,
                scheduleIds: ids
              }));
            } else {
              next = upsertUsageLimit(next, {
                id: newUuid(),
                kind: target.kind,
                target: target.name,
                mode,
                dailyLimitMinutes: Number(minutes),
                name: name || target.name,
                enabled: true
              });
            }
            await save({
              blocking: next
            });
            setCreating(false);
            setError('');
          }}>Create limit</Button><Button secondary onPress={() => setCreating(false)}>Cancel</Button></ScrollView></SafeAreaView></Modal></>;
}
function MobileSocial({
  user,
  onMessage
}) {
  const [name, setName] = useState('');
  const [requests, setRequests] = useState([]);
  const [feed, setFeed] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [rankError, setRankError] = useState('');
  const load = async () => {
    const board = await SYNC.leaderboard(25);
    if (board) { setRanking(board); setRankError(''); }
    else setRankError('Global rankings could not load. Refresh sync and retry.');
    const [r, f] = await Promise.all([supabase.rpc('friend_requests'), supabase.rpc('friend_feed')]);
    if (r.error || f.error) throw Error(r.error?.message || f.error.message);
    setRequests(r.data || []);
    setFeed(f.data || []);
  };
  useEffect(() => {
    load().catch(e => onMessage(e.message));
  }, [user.id]);
  const act = async (un, action) => {
    try {
      await SYNC.friendAction(un, action);
      await load();
      onMessage('Friends updated.');
    } catch (e) {
      onMessage(e.message);
    }
  };
  return <><Card><View style={s.row}><Ionicons name="trophy" /><Text style={s.subtitle}>Global focus leaderboard</Text></View>{ranking.find(r => r.un === user.un) && <Text style={s.hero}>Your rank #{ranking.find(r => r.un === user.un).rank || ranking.findIndex(r => r.un === user.un) + 1}</Text>}<Text style={s.small}>Ranked by recorded focus time across North.</Text>{rankError ? <Text style={s.error}>{rankError}</Text> : ranking.map((r,i) => <View key={r.un} style={s.usageRow}><Text style={s.text}>#{r.rank || i+1}</Text><Text style={[s.text,{flex:1}]}>{r.name || r.un}{r.un === user.un ? ' · you' : ''}</Text><Text style={s.text}>{duration(r.fm * 60)}</Text></View>)}<Button secondary onPress={() => load().catch(e => onMessage(e.message))}>Refresh rankings</Button></Card><Card><Field label="Friend’s North username" value={name} onChangeText={setName} autoCapitalize="none" /><Button onPress={() => act(name.trim().toLowerCase(), 'request')}>Add friend</Button></Card>{requests.map((r, i) => <Card key={`${r.un}:${i}`}><Text style={s.text}>{r.un} · {r.direction}</Text>{r.direction === 'incoming' ? <View style={s.wrap}><Button onPress={() => act(r.un, 'accept')}>Accept</Button><Button secondary onPress={() => act(r.un, 'reject')}>Decline</Button></View> : <Button secondary onPress={() => act(r.un, 'cancel')}>Cancel request</Button>}</Card>)}{feed.map((f, i) => <Card key={f.un || i}><Text style={s.subtitle}>{f.name || f.un}</Text><Text style={s.muted}>{f.focus_minutes ?? f.fm ?? 0} focused minutes</Text><Button secondary onPress={() => act(f.un, 'remove')}>Remove friend</Button></Card>)}</>;
}
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#171121'
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#100b1bb8'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 30 : 8,
    paddingBottom: 8
  },
  brand: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800'
  },
    body: {
    width: '100%',
    maxWidth: 920,
    alignSelf: 'center',
    padding: 18,
    paddingBottom: 180,
    gap: 14
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -.7
  },
  hero: {
    fontSize: 30,
    fontWeight: '700',
    color: '#fff'
  },
  subtitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6
  },
  text: {
    color: '#f6f1ff',
    fontSize: 14,
    lineHeight: 21
  },
  muted: {
    color: '#d0c9dd',
    fontSize: 13,
    lineHeight: 20
  },
  small: {
    color: '#ded9e8',
    fontSize: 13,
    lineHeight: 19
  },
  card: {
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: '#ffffff30',
    borderRadius: 20,
    padding: 16,
    gap: 10
  },
  button: {
    backgroundColor: '#c3b0ff',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 13,
    justifyContent: 'center',
    minHeight: 44
  },
  secondary: {
    backgroundColor: '#ffffff12',
    borderWidth: 1,
    borderColor: '#ffffff33'
  },
  buttonText: {
    color: '#211731',
    fontWeight: '700',
    fontSize: 13,
    textAlign: 'center'
  },
  input: {
    color: '#fff',
    fontSize: 16,
    backgroundColor: '#ffffff16',
    borderWidth: 1,
    borderColor: '#ffffff44',
    borderRadius: 12,
    padding: 12,
    minHeight: 46
  },
  nav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#15151fef',
    paddingTop: 8,
    paddingHorizontal: 8,
    paddingBottom: Platform.OS === 'android' ? 20 : 28,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: '#ffffff22'
  },
  tab: {
    flex: 1,
    minHeight: 52,
    justifyContent: 'center',
    borderRadius: 14,
    alignItems: 'center',
    gap: 5
  },
  navText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#d6d3df'
  },
  activeTab: { backgroundColor: '#ffffff1c' },
  iconButton: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  timerControls: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 28 },
  timerControl: { width: 48, height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#ffffff30', backgroundColor: '#ffffff10', alignItems: 'center', justifyContent: 'center' },
  phaseTabs: { flexDirection: 'row', gap: 6, width: '100%', maxWidth: 620, alignSelf: 'center', marginTop: 8, marginBottom: 18 },
  phaseTab: { flex: 1, minHeight: 44, borderRadius: 24, borderWidth: 1, borderColor: '#ffffff38', backgroundColor: '#ffffff10', paddingHorizontal: 3, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  phaseText: { fontSize: 11, color: '#ddd8e8', fontWeight: '600', textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  badge: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#ffffff33',
    borderRadius: 13,
    minWidth: 130,
    flexGrow: 1
  },
  earned: {
    borderColor: '#f3ac57',
    backgroundColor: '#a5651722'
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 1.4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffffff44'
  },
  clock: {
    fontSize: 76,
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
    color: '#fff',
    textAlign: 'center',
    paddingVertical: 28
  },
  modal: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#0009'
  },
  sheet: {
    backgroundColor: '#24232ff5',
    borderRadius: 22,
    padding: 20,
    maxHeight: '80%',
    gap: 14
  },
  modalPage: {
    flex: 1,
    backgroundColor: '#171121'
  },
  error: {
    color: '#ffb5bc',
    fontSize: 13
  },
  status: {
    color: '#e3d5ff',
    fontSize: 12,
    paddingHorizontal: 18,
    paddingVertical: 5
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  day: {
    width: '14.2857%',
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    color: '#d7cce7'
  },
  usageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#ffffff22'
  },
  usageBar: {
    height: 4,
    backgroundColor: '#c3b0ff',
    borderRadius: 3,
    marginTop: 7
  }
});
