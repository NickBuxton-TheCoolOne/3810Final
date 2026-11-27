'use strict';
const { requirePlayerInMatch } = require('../api/authHooks');

function fakeReply() {
  const reply = { statusCode: null, body: null };
  reply.code = (c) => { reply.statusCode = c; return reply; };
  reply.send = (b) => { reply.body = b; return reply; };
  return reply;
}

const upper = 'A1B2C3D4-E5F6-4711-8899-AABBCCDDEEFF';

describe('requirePlayerInMatch', () => {
  test('allows a player whose token matchId differs only in case', async () => {
    const reply = fakeReply();
    await requirePlayerInMatch(
      { auth: { role: 'player', matchId: upper }, params: { matchId: upper.toLowerCase() } },
      reply,
    );
    expect(reply.statusCode).toBeNull();
  });

  test('returns 404 for a player on another match', async () => {
    const reply = fakeReply();
    await requirePlayerInMatch(
      { auth: { role: 'player', matchId: upper }, params: { matchId: '00000000-0000-0000-0000-000000000000' } },
      reply,
    );
    expect(reply.statusCode).toBe(404);
  });

  test('returns 404 for a player when the route has no matchId', async () => {
    const reply = fakeReply();
    await requirePlayerInMatch({ auth: { role: 'player', matchId: upper }, params: {} }, reply);
    expect(reply.statusCode).toBe(404);
  });

  test('ignores staff roles', async () => {
    const reply = fakeReply();
    await requirePlayerInMatch({ auth: { role: 'host' }, params: { matchId: upper } }, reply);
    expect(reply.statusCode).toBeNull();
  });
});
