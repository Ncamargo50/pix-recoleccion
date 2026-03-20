// IndexedDB - Offline database for PIX Muestreo v2.0
const DB_NAME = 'PixMuestreo';
const DB_VERSION = 3;

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
        // v3: Photos store (separate from samples for better performance)
        if (!db.objectStoreNames.contains('photos')) {
          const ph = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
          ph.createIndex('sampleId', 'sampleId', { unique: false });
          ph.createIndex('fieldId', 'fieldId', { unique: false });
        }
        // v3: Users store (multi-user auth)
        if (!db.objectStoreNames.contains('users')) {
          const us = db.createObjectStore('users', { keyPath: 'username' });
          us.createIndex('role', 'role', { unique: false });
        }
        // v3: Sync control (bidirectional sync tracking)
        if (!db.objectStoreNames.contains('syncControl')) {
          const sc = db.createObjectStore('syncControl', { keyPath: 'id', autoIncrement: true });
          sc.createIndex('entityType', 'entityType', { unique: false });
          sc.createIndex('entityId', 'entityId', { unique: false });
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

  // ===== ATOMIC OPERATIONS =====
  async saveSampleAtomic(sample, point, photoData) {
    // Prepare photo blob outside transaction (fetch is async)
    let photoBlob = null;
    if (photoData) {
      if (typeof photoData === 'string' && photoData.startsWith('data:')) {
        const resp = await fetch(photoData);
        photoBlob = await resp.blob();
      } else {
        photoBlob = photoData;
      }
    }

    return new Promise((resolve, reject) => {
      const storeNames = ['samples', 'points'];
      if (photoBlob) storeNames.push('photos');
      const tx = this.db.transaction(storeNames, 'readwrite');

      const sampleStore = tx.objectStore('samples');
      const sampleData = { ...sample, createdAt: new Date().toISOString() };
      const sampleReq = sampleStore.add(sampleData);

      sampleReq.onsuccess = () => {
        const sampleId = sampleReq.result;
        // Save photo in same transaction
        if (photoBlob) {
          const photoStore = tx.objectStore('photos');
          const thumbnail = typeof photoData === 'string' ? photoData.substring(0, 200) + '...' : '';
          photoStore.add({ sampleId, fieldId: point.fieldId, blob: photoBlob, thumbnail, synced: 0, createdAt: new Date().toISOString() });
        }
        // Update point status
        const pointStore = tx.objectStore('points');
        pointStore.put({ ...point, updatedAt: new Date().toISOString() });
      };

      tx.oncomplete = () => resolve(sampleReq.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Sample save transaction aborted'));
    });
  }

  // ===== PHOTOS STORE =====
  async savePhoto(sampleId, fieldId, photoData) {
    // Convert base64 to blob for efficient storage
    let blob = photoData;
    if (typeof photoData === 'string' && photoData.startsWith('data:')) {
      const resp = await fetch(photoData);
      blob = await resp.blob();
    }
    // Create thumbnail (small base64 for list display)
    const thumbnail = typeof photoData === 'string' ? photoData.substring(0, 200) + '...' : '';
    return this.add('photos', { sampleId, fieldId, blob, thumbnail, synced: 0 });
  }

  async getPhotosBySample(sampleId) {
    return this.getAllByIndex('photos', 'sampleId', sampleId);
  }

  async cleanupOldPhotos(olderThanDays = 90) {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    const all = await this.getAll('photos');
    let cleaned = 0;
    for (const p of all) {
      if (p.synced === 1 && p.createdAt < cutoff) {
        await this.delete('photos', p.id);
        cleaned++;
      }
    }
    return cleaned;
  }

  // ===== USERS (Multi-user auth) =====
  async createUser(username, password, role = 'collector') {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    const hash = await this._hashPassword(password, saltHex);
    return this.put('users', { username, passwordHash: hash, salt: saltHex, role, createdAt: new Date().toISOString() });
  }

  async verifyUser(username, password) {
    const user = await this.get('users', username);
    if (!user) return null;
    const hash = await this._hashPassword(password, user.salt);
    if (hash === user.passwordHash) return user;
    // Fallback: try legacy SHA-256 hash for migration
    const legacyHash = await this._legacyHashPassword(password, user.salt);
    if (legacyHash === user.passwordHash) {
      // Upgrade to PBKDF2 transparently
      user.passwordHash = hash;
      await this.put('users', user);
      return user;
    }
    return null;
  }

  async _hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const saltBytes = new Uint8Array(salt.match(/.{2}/g).map(b => parseInt(b, 16)));
    const hashBuffer = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
      keyMaterial, 256
    );
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async _legacyHashPassword(password, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(salt + password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async getAllUsers() {
    return this.getAll('users');
  }

  async deleteUser(username) {
    return this.delete('users', username);
  }

  async hasUsers() {
    const count = await this.count('users');
    return count > 0;
  }

  // ===== BATCH OPERATIONS =====
  async addBatch(storeName, items) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const now = new Date().toISOString();
      for (const item of items) {
        store.add({ ...item, createdAt: now });
      }
      tx.oncomplete = () => resolve(items.length);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ===== SYNC CONTROL =====
  async logSync(entityType, entityId, direction, status = 'success') {
    return this.add('syncControl', {
      entityType, entityId, direction, status,
      lastSyncAt: new Date().toISOString()
    });
  }

  async getLastSync(entityType, entityId) {
    const all = await this.getAllByIndex('syncControl', 'entityId', entityId);
    return all.filter(s => s.entityType === entityType).sort((a, b) => b.lastSyncAt.localeCompare(a.lastSyncAt))[0] || null;
  }

  // ===== ENCRYPTION (AES-GCM) =====
  async encrypt(data, password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
    return { salt: Array.from(salt), iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
  }

  async decrypt(encryptedObj, password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new Uint8Array(encryptedObj.salt), iterations: 100000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(encryptedObj.iv) }, key, new Uint8Array(encryptedObj.data));
    return JSON.parse(new TextDecoder().decode(decrypted));
  }
}

// Singleton
const pixDB = new PixDB();
