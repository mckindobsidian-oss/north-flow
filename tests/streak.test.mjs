import test from 'node:test';
import assert from 'node:assert/strict';
import { recordStreakDay, streakSummary } from '../react-app/src/lib/streak.js';
test('simultaneous task and focus completions retain both objectives, once per day', async () => {
  let value = { un: 'alice' };
  const store = { get: async () => structuredClone(value), set: async (_, next) => { await Promise.resolve(); value = next; } };
  const now = new Date(2026,9,24,12);
  await Promise.all([recordStreakDay(store,'alice','focus',now),recordStreakDay(store,'alice','task',now)]);
  assert.equal(streakSummary(value.streakDays,now).current,1);
  assert.equal(await recordStreakDay(store,'alice','task',now),null);
  assert.equal(streakSummary(value.streakDays,new Date(2026,9,26,12)).current,0);
  assert.equal(streakSummary(value.streakDays,new Date(2026,9,26,12)).best,1);
});
