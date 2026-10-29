export const SOUND_OPTIONS = [
  { id: "task", name: "Task complete", asset: "/sounds/task-complete.ogg", notes: [659.25, 880], type: "sine" },
  { id: "focus", name: "Focus complete", asset: "/sounds/focus-complete.ogg", notes: [659.25, 880, 1174.66], type: "sine" },
  { id: "break", name: "Break finished", notes: [523.25, 659.25], type: "triangle" },
  { id: "streak", name: "Streak extended", notes: [392, 523.25, 783.99], type: "triangle" },
  { id: "achievement", name: "Achievement unlocked", notes: [523.25, 659.25, 783.99, 1046.5], type: "sine" },
  { id: "chime", name: "Soft chime", notes: [880, 1174.66], type: "sine" },
  { id: "bell", name: "Clear bell", notes: [659.25, 987.77, 1318.51], type: "sine" },
  { id: "warm", name: "Warm notes", notes: [392, 493.88, 587.33], type: "triangle" },
  { id: "pulse", name: "Gentle pulse", notes: [523.25, 523.25], type: "sine" },
];
let audio;
const buffers = new Map();
function loadEffect(sound, context) {
  if (!buffers.has(sound.asset)) buffers.set(sound.asset, fetch(sound.asset)
    .then((response) => { if (!response.ok) throw new Error("Sound unavailable"); return response.arrayBuffer(); })
    .then((bytes) => context.decodeAudioData(bytes)).catch(() => null));
  return buffers.get(sound.asset);
}
export function primeSound() {
  try {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return null;
    audio ||= new Audio();
    if (audio.state === "suspended") audio.resume().catch(() => {});
    SOUND_OPTIONS.filter((sound) => sound.asset).forEach((sound) => loadEffect(sound, audio));
    return audio;
  } catch { return null; }
}
export function playSound(id = "chime", volume = .5) {
  const context = primeSound();
  if (!context) return;
  const sound = SOUND_OPTIONS.find((option) => option.id === id) || SOUND_OPTIONS[0];
  const level = Math.max(0, Math.min(1, Number(volume) || 0)) * .2;
  if (!level) return;
  if (sound.asset) {
    loadEffect(sound, context).then((buffer) => {
      if (!buffer) { playSound("chime", volume); return; }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = Math.max(0, Math.min(1, Number(volume) || 0));
      source.connect(gain); gain.connect(context.destination);
      source.start();
      source.onended = () => { source.disconnect(); gain.disconnect(); };
    });
    return;
  }
  sound.notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + index * .22;
    oscillator.type = sound.type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + .02);
    gain.gain.exponentialRampToValueAtTime(.0001, start + .8);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + .85);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}
