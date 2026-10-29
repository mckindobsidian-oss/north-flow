import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("bundled milestone sounds play explicitly, respect zero volume, and retain their licence", async () => {
  const files = new Map();
  for (const name of ["task-complete.ogg", "focus-complete.ogg"]) {
    const bytes = await readFile(new URL(`../react-app/public/sounds/${name}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), "OggS");
    files.set(`/sounds/${name}`, bytes);
  }
  const licence = await readFile(new URL("../react-app/public/sounds/Kenney-License.txt", import.meta.url), "utf8");
  assert.match(licence, /CC0/);
  const oldAudio = globalThis.AudioContext;
  const oldFetch = globalThis.fetch;
  let played = 0;
  globalThis.AudioContext = class {
    state = "running";
    currentTime = 0;
    destination = {};
    decodeAudioData = async () => ({});
    createGain = () => ({ gain: { value: 0 }, connect() {}, disconnect() {} });
    createBufferSource = () => ({ connect() {}, disconnect() {}, start() { played++; } });
  };
  globalThis.fetch = async (url) => ({ ok: files.has(url), arrayBuffer: async () => files.get(url) });
  try {
    const { playSound } = await import("../react-app/src/lib/sounds.js");
    assert.equal(played, 0);
    playSound("task", .5);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(played, 1);
    playSound("focus", 0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(played, 1);
    playSound("focus", .5);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(played, 2);
  } finally { globalThis.AudioContext = oldAudio; globalThis.fetch = oldFetch; }
});
