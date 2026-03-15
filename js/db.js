// IndexedDB - Offline database for Pixadvisor Coleta
const DB_NAME = 'PixColeta';
const DB_VERSION = 2;

class PixDB {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        // Projects (haciendas/fazendas)
        if (!db.objectStoreNames.contains('projects')) {
          const ps = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
          ps.createIndex('name', 'name', { unique: false });
        }
        // Fields (talhões/lotes)
        if (!db.objectStoreNames.contains('fields')) {
          const fs = db.createObjectStore('fields', { keyPath: 'id', autoIncrement: true });
          fs.createIndex('projectId', 'projectId', { unique: false });
          fs.createIndex('name', 'name', { unique: false });
        }
        // Sample points (puntos de muestreo)
        if (!db.objectStoreNames.contains('points')) {
          const pts = db.createObjectStore('points', { keyPath: 'id', autoIncrement: true });
          pts.createIndex('fieldId', 'fieldId', { unique: false });
          pts.createIndex('status', 'status', { unique: false });
        }
        // Collected samples (muestras colectadas)
        if (!db.objectStoreNames.contains('samples')) {
          const ss = db.createObjectStore('samples', { keyPath: 'id', autoIncrement: true });
          ss.createIndex('pointId', 'pointId', { unique: false });
          ss.createIndex('synced', 'synced', { unique: false });
          ss.createIndex('fieldId', 'fieldId', { unique: false });
        }
        // Track/route (recorrido GPS)
        if (!db.objectStoreNames.contains('tracks')) {
          const ts = db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
          ts.createIndex('fieldId', 'fieldId', { unique: false });
        }
        // Sync queue
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
        }
        // Settings
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { this.db = e.target.result; resolve(this.db); };
      req.onerror = e => reject(e.target.error);
    });
  }

  // Generic CRUD
  async add(store, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).add({ ...data, createdAt: new Date().toISOString() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async put(store, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put({ ...data, updatedAt: new Date().toISOString() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get(store, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(store) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllByIndex(store, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const idx = tx.objectStore(store).index(indexName);
      const req = idx.getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(store, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(store) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async count(store) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Get unsynced samples
  async getUnsyncedSamples() {
    return this.getAllByIndex('samples', 'synced', 0);
  }

  // Mark sample as synced
  async markSynced(sampleId) {
    const sample = await this.get('samples', sampleId);
    if (sample) {
      sample.synced = 1;
      sample.syncedAt = new Date().toISOString();
      await this.put('samples', sample);
    }
  }

  // Get setting
  async getSetting(key) {
    const s = await this.get('settings', key);
    return s ? s.value : null;
  }

  // Set setting
  async setSetting(key, value) {
    return this.put('settings', { key, value });
  }
}

// Singleton
const pixDB = new PixDB();
