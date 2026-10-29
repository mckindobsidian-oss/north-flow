// Render the existing web completion melodies for native audio playback.
import { writeFileSync } from 'node:fs';
import { SOUND_OPTIONS } from '../react-app/src/lib/sounds.js';
const rate = 22050;
for (const id of ['break', 'streak', 'achievement']) {
  const sound = SOUND_OPTIONS.find(option => option.id === id);
  const samples = Math.ceil((sound.notes.length * .22 + .85) * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    let value = 0;
    sound.notes.forEach((frequency, index) => {
      const time = i / rate - index * .22;
      if (time < 0 || time > .85) return;
      const sine = Math.sin(2 * Math.PI * frequency * time);
      const wave = sound.type === 'triangle' ? 2 / Math.PI * Math.asin(sine) : sine;
      value += wave * Math.min(1, time / .02) * Math.exp(-time * 7) * .18;
    });
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  writeFileSync(new URL(`../react-app/public/sounds/${id}-complete.wav`, import.meta.url), Buffer.concat([header, data]));
  console.log(`Rendered ${id} completion melody`);
}
