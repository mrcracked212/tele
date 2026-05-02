const fs = require("fs/promises");
const path = require("path");

const cache = new Map();
const writeQueues = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function atomicSaveJSON(filePath, data) {
  const absolutePath = path.resolve(filePath);
  const dirPath = path.dirname(absolutePath);
  await ensureDir(dirPath);

  const tempPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, absolutePath);
}

async function ensureFile(filePath, defaultData) {
  const absolutePath = path.resolve(filePath);
  const dirPath = path.dirname(absolutePath);
  await ensureDir(dirPath);

  try {
    await fs.access(absolutePath);
  } catch {
    await atomicSaveJSON(absolutePath, defaultData);
  }
}

async function loadJSON(filePath, defaultData = {}) {
  const absolutePath = path.resolve(filePath);

  if (cache.has(absolutePath)) {
    return cache.get(absolutePath);
  }

  await ensureFile(absolutePath, defaultData);

  try {
    const raw = await fs.readFile(absolutePath, "utf8");
    const parsed = raw.trim() ? JSON.parse(raw) : clone(defaultData);
    cache.set(absolutePath, parsed);
    return parsed;
  } catch (error) {
    const corruptPath = `${absolutePath}.corrupt-${Date.now()}.json`;

    try {
      await fs.rename(absolutePath, corruptPath);
    } catch {
      // Abaikan jika rename gagal, akan tetap menulis ulang file default.
    }

    const fallback = clone(defaultData);
    await atomicSaveJSON(absolutePath, fallback);
    cache.set(absolutePath, fallback);
    return fallback;
  }
}

async function saveJSON(filePath, data) {
  const absolutePath = path.resolve(filePath);
  const payload = clone(data);
  cache.set(absolutePath, data);

  const lastQueue = writeQueues.get(absolutePath) || Promise.resolve();

  const nextQueue = lastQueue
    .then(() => atomicSaveJSON(absolutePath, payload))
    .catch((error) => {
      console.error("Gagal menulis JSON:", absolutePath, error.message);
      throw error;
    })
    .finally(() => {
      if (writeQueues.get(absolutePath) === nextQueue) {
        writeQueues.delete(absolutePath);
      }
    });

  writeQueues.set(absolutePath, nextQueue);
  return nextQueue;
}

module.exports = {
  loadJSON,
  saveJSON,
  ensureFile,
  atomicSaveJSON
};
