const store = new Map();

function now() {
  return Date.now();
}

function isFresh(entry) {
  return entry && entry.expiresAt > now();
}

function cleanupExpiredEntries() {
  const currentTime = now();
  for (const [key, entry] of store.entries()) {
    if (!entry || entry.expiresAt <= currentTime) {
      store.delete(key);
    }
  }
}

export async function getCachedValue(key, ttlMs, producer) {
  cleanupExpiredEntries();

  const existing = store.get(key);
  if (isFresh(existing) && Object.prototype.hasOwnProperty.call(existing, 'value')) {
    return existing.value;
  }

  if (existing?.promise) {
    return existing.promise;
  }

  const promise = Promise.resolve()
    .then(producer)
    .then((value) => {
      store.set(key, {
        value,
        expiresAt: now() + ttlMs,
      });
      return value;
    })
    .catch((error) => {
      store.delete(key);
      throw error;
    });

  store.set(key, {
    promise,
    expiresAt: now() + ttlMs,
  });

  return promise;
}

export function invalidateCacheByPrefix(prefix) {
  for (const key of store.keys()) {
    if (String(key).startsWith(prefix)) {
      store.delete(key);
    }
  }
}
