import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import test from 'node:test';

import { startFakePrinter } from './fake-printer-server.mjs';

const withTimeout = (promise, timeoutMs = 250) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error('test operation timed out')),
        timeoutMs,
      );
      timer.unref?.();
    }),
  ]);

const sendBytes = async (port, bytes) =>
  withTimeout(
    new Promise((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('error', reject);
      socket.once('close', resolve);
      socket.once('connect', () => {
        socket.end(bytes);
      });
    }),
  );

test('captures all bytes and reports their SHA-256', async () => {
  const printer = await startFakePrinter({ mode: 'COMPLETE' });
  const bytes = Buffer.from('bake-mall-printer');

  try {
    await sendBytes(printer.port, bytes);
    const capture = await printer.nextCapture();

    assert.equal(capture.bytesReceived, bytes.length);
    assert.equal(
      capture.sha256,
      createHash('sha256').update(bytes).digest('hex'),
    );
  } finally {
    await printer.close();
  }
});

test('closes promptly while a client socket remains open and idle', async () => {
  const printer = await startFakePrinter({ mode: 'COMPLETE' });
  const client = connect({ host: '127.0.0.1', port: printer.port });
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  });

  try {
    await Promise.race([
      printer.close(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('fake printer close timed out')),
          100,
        ),
      ),
    ]);
    await new Promise((resolve) => client.once('close', resolve));
    assert.equal(client.destroyed, true);
  } finally {
    client.destroy();
  }
});

test('supports connection and mid-write failure modes', async () => {
  const onConnect = await startFakePrinter({ mode: 'DROP_ON_CONNECT' });
  const midWrite = await startFakePrinter({
    mode: 'DROP_AFTER_BYTES',
    bytes: 4,
  });

  try {
    assert.equal(onConnect.mode, 'DROP_ON_CONNECT');
    await assert.rejects(
      sendBytes(onConnect.port, Buffer.from('must-not-arrive')),
      /fake printer dropped connection|ECONNRESET|socket hang up/u,
    );
    await assert.rejects(
      withTimeout(onConnect.nextCapture(), 100),
      /Fake printer socket failed/u,
    );

    assert.equal(midWrite.dropAfterBytes, 4);
    await sendBytes(midWrite.port, Buffer.from('abcdefgh'));
    const capture = await withTimeout(midWrite.nextCapture());
    assert.equal(capture.bytesReceived, 4);
  } finally {
    await Promise.all([onConnect.close(), midWrite.close()]);
  }
});

test('rejects the corresponding capture when a client socket resets', async () => {
  const printer = await startFakePrinter({ mode: 'COMPLETE' });
  const client = connect({ host: '127.0.0.1', port: printer.port });
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  });

  try {
    client.resetAndDestroy();
    await assert.rejects(
      withTimeout(printer.nextCapture()),
      /Fake printer socket failed/u,
    );
  } finally {
    client.destroy();
    await printer.close();
  }
});

test('prioritizes a fatal socket error over captures already queued', async () => {
  const printer = await startFakePrinter({ mode: 'COMPLETE' });
  let client;

  try {
    await sendBytes(printer.port, Buffer.from('queued-before-reset'));
    client = connect({ host: '127.0.0.1', port: printer.port });
    await new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('error', reject);
    });
    client.resetAndDestroy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await assert.rejects(
      withTimeout(printer.nextCapture()),
      /Fake printer socket failed/u,
    );
    await assert.rejects(
      withTimeout(printer.nextCapture()),
      /Fake printer socket failed/u,
    );
  } finally {
    client?.destroy();
    await printer.close();
  }
});

test('prioritizes a fatal server error over captures already queued', async () => {
  const printer = await startFakePrinter({ mode: 'COMPLETE' });
  const secret = 'TOP_SECRET';

  try {
    await sendBytes(printer.port, Buffer.from('queued-before-fatal'));
    printer.emitServerErrorForTest(new Error(secret));
    await assert.rejects(
      withTimeout(printer.nextCapture()),
      (error) =>
        /Fake printer server failed/u.test(error.message) &&
        !`${error}\n${JSON.stringify(error)}`.includes(secret),
    );
    await assert.rejects(
      withTimeout(printer.nextCapture()),
      /Fake printer server failed/u,
    );
  } finally {
    await printer.close();
  }

  assert.equal(printer.serverErrorListenerCountForTest(), 0);
});

test('rejects current capture waiters when a runtime server error becomes fatal', async () => {
  const printer = await startFakePrinter({ mode: 'COMPLETE' });
  try {
    const capture = printer.nextCapture();
    printer.emitServerErrorForTest(new Error('runtime failure'));
    await assert.rejects(withTimeout(capture), /Fake printer server failed/u);
  } finally {
    await printer.close();
  }
});

test('DROP_ON_CONNECT rejects promptly and does not publish a normal capture', async () => {
  const printer = await startFakePrinter({ mode: 'DROP_ON_CONNECT' });
  try {
    await assert.rejects(
      sendBytes(printer.port, Buffer.from('must-not-arrive')),
      /fake printer dropped connection|ECONNRESET|socket hang up/u,
    );
    await assert.rejects(
      withTimeout(printer.nextCapture(), 100),
      /Fake printer socket failed/u,
    );
  } finally {
    await printer.close();
  }
});

test('close rejects pending capture waits and removes runtime listeners', async () => {
  const printer = await startFakePrinter({ mode: 'COMPLETE' });
  const pendingCapture = printer.nextCapture();
  await printer.close();

  await assert.rejects(withTimeout(pendingCapture), /Fake printer closed/u);
  assert.equal(printer.serverErrorListenerCountForTest(), 0);
});
