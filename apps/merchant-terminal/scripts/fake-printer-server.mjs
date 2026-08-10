import { createHash } from 'node:crypto';
import { createServer } from 'node:net';

const MODES = new Set(['COMPLETE', 'DROP_ON_CONNECT', 'DROP_AFTER_BYTES']);

const listen = (server) =>
  new Promise((resolve, reject) => {
    const onStartupError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onStartupError);
      resolve();
    };
    server.once('error', onStartupError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const createCaptureQueue = () => {
  const outcomes = [];
  const waiters = [];
  let fatalError = null;

  const deliver = (outcome) => {
    if (fatalError) return;
    const waiter = waiters.shift();
    if (waiter) {
      if (outcome.error) waiter.reject(outcome.error);
      else waiter.resolve(outcome.capture);
    } else {
      outcomes.push(outcome);
    }
  };

  return Object.freeze({
    publish(capture) {
      deliver({ capture });
    },
    reject(error) {
      deliver({ error });
    },
    fail(error) {
      if (fatalError) return;
      fatalError = error;
      outcomes.length = 0;
      for (const waiter of waiters.splice(0)) waiter.reject(fatalError);
    },
    next() {
      if (fatalError) return Promise.reject(fatalError);
      const outcome = outcomes.shift();
      if (outcome) {
        return outcome.error
          ? Promise.reject(outcome.error)
          : Promise.resolve(outcome.capture);
      }

      return new Promise((resolve, reject) =>
        waiters.push({ resolve, reject }),
      );
    },
  });
};

const toCapture = (chunks) => {
  const bytes = Buffer.concat(chunks);

  return Object.freeze({
    bytesReceived: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
};

const createSocketHandler = (options, captures, sockets) => (socket) => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
  let settled = false;
  socket.once('error', () => {
    if (settled) return;
    settled = true;
    captures.fail(new Error('Fake printer socket failed.'));
  });
  if (options.mode === 'DROP_ON_CONNECT') {
    settled = true;
    captures.fail(new Error('Fake printer socket failed.'));
    socket.destroy(new Error('fake printer dropped connection'));
    return;
  }

  const chunks = [];
  let bytesReceived = 0;

  const publishOnce = () => {
    if (settled) return;
    settled = true;
    captures.publish(toCapture(chunks));
  };

  socket.on('data', (chunk) => {
    if (options.mode !== 'DROP_AFTER_BYTES') {
      chunks.push(Buffer.from(chunk));
      bytesReceived += chunk.length;
      return;
    }

    const remaining = Math.max(0, options.bytes - bytesReceived);
    const accepted = chunk.subarray(0, remaining);
    if (accepted.length > 0) chunks.push(Buffer.from(accepted));
    bytesReceived += accepted.length;

    if (bytesReceived >= options.bytes) {
      publishOnce();
      socket.destroy();
    }
  });
  socket.once('end', publishOnce);
  socket.once('close', publishOnce);
};

export const startFakePrinter = async (options) => {
  if (!MODES.has(options?.mode)) {
    throw new Error('Unsupported fake printer mode');
  }
  if (
    options.mode === 'DROP_AFTER_BYTES' &&
    (!Number.isInteger(options.bytes) || options.bytes < 1)
  ) {
    throw new Error('DROP_AFTER_BYTES requires a positive byte count');
  }

  const captures = createCaptureQueue();
  const sockets = new Set();
  const server = createServer(createSocketHandler(options, captures, sockets));
  await listen(server);
  const onRuntimeError = () => {
    captures.fail(new Error('Fake printer server failed.'));
  };
  server.on('error', onRuntimeError);
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Fake printer did not expose a TCP address');
  }

  return Object.freeze({
    mode: options.mode,
    port: address.port,
    dropAfterBytes: options.mode === 'DROP_AFTER_BYTES' ? options.bytes : null,
    nextCapture: () => captures.next(),
    emitServerErrorForTest: (error) => server.emit('error', error),
    serverErrorListenerCountForTest: () => server.listenerCount('error'),
    close: async () => {
      captures.fail(new Error('Fake printer closed.'));
      for (const socket of sockets) socket.destroy();
      try {
        await closeServer(server);
      } finally {
        server.off('error', onRuntimeError);
      }
    },
  });
};
