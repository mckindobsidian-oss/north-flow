import test from 'node:test';
import assert from 'node:assert/strict';
import { readRestBody } from '../apps/extension/lib/rest-body.js';
test('successful minimal writes and table RPC JSON are both readable', async () => {
  assert.equal(await readRestBody(new Response('', { status: 201 })), null);
  assert.equal(await readRestBody(new Response(null, { status: 204 })), null);
  assert.deepEqual(await readRestBody(new Response('[{"rank":1}]')), [{ rank: 1 }]);
  await assert.rejects(readRestBody(new Response('invalid JSON')), SyntaxError);
});
