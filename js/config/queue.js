'use strict';

// BullMQ / Redis setup (AGENTS.md §2). The API process adds jobs through
// roundResolutionQueue; workers/ processes call createRedisConnection() for
// their own connection (BullMQ wants separate connections for Queue and Worker).

const IORedis = require('ioredis');
const { Queue } = require('bullmq');

const ROUND_RESOLUTION_QUEUE = 'roundResolution';

// BullMQ requires maxRetriesPerRequest: null on worker connections;
// using it everywhere keeps the two kinds of connection identical.
function createRedisConnection() {
  return new IORedis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });
}

// Every queue key starts with REDIS_KEY_PREFIX so several deployments can share
// one Redis (SPEC.md: namespaced queues). BullMQ adds its own ':' after the
// prefix, so a trailing ':' in the env value is dropped.
function queuePrefix() {
  return (process.env.REDIS_KEY_PREFIX || 'bull').replace(/:+$/, '');
}

let queueConnection = null;
let roundResolutionQueue = null;

function getRoundResolutionQueue() {
  if (!roundResolutionQueue) {
    queueConnection = createRedisConnection();
    roundResolutionQueue = new Queue(ROUND_RESOLUTION_QUEUE, {
      connection: queueConnection,
      prefix: queuePrefix(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return roundResolutionQueue;
}

// One job per match and round. The fixed jobId makes a repeat call a no-op,
// and the worker's DB claim (resolvedAt IS NULL) makes a retry harmless.
// BullMQ rejects ':' in custom job IDs, so the parts are joined with '-'.
function roundJobId(matchId, roundNumber) {
  return `${matchId}-${roundNumber}`;
}

function enqueueRoundResolution({ matchId, roundNumber, delayMs }) {
  return getRoundResolutionQueue().add(
    'resolveRound',
    { matchId, roundNumber },
    { jobId: roundJobId(matchId, roundNumber), delay: Math.max(0, delayMs || 0) },
  );
}

async function closeQueue() {
  if (roundResolutionQueue) {
    await roundResolutionQueue.close();
    roundResolutionQueue = null;
  }
  if (queueConnection) {
    await queueConnection.quit();
    queueConnection = null;
  }
}

module.exports = {
  ROUND_RESOLUTION_QUEUE,
  createRedisConnection,
  queuePrefix,
  getRoundResolutionQueue,
  roundJobId,
  enqueueRoundResolution,
  closeQueue,
};
