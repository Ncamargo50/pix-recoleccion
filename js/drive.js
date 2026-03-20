// Google Drive Integration for PIX Muestreo
const DRIVE_CONFIG = {
  CLIENT_ID: '1012775070766-ai7lgup2lvgn8kj6oop24b1smt75hlls.apps.googleusercontent.com',
  API_KEY: '',
  SCOPES: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',
  DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
  FOLDER_NAME: 'PIX Muestreo'
};

class DriveSync {
  constructor() {
    this.tokenClient = null;
    this.accessToken = null;
    this.folderId = null;
    this.isInitialized = false;
    this._tokenExpiresAt = null;
    this._refreshTimer = null;
  }

  // Initialize Google Identity Services
  async init(clientId) {
    if (clientId) DRIVE_CONFIG.CLIENT_ID = clientId;

    return new Promise((resolve, reject) => {
      // Load GIS script
      if (typeof google !== 'undefined' && google.accounts) {
        this._initTokenClient();
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => {
        this._initTokenClient();
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  _initTokenClient() {
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CONFIG.CLIENT_ID,
      scope: DRIVE_CONFIG.SCOPES,
      callback: (response) => {
        if (response.error) {
          console.error('Auth error:', response);
          return;
        }
        this.accessToken = response.access_token;
        this.isInitialized = true;
        sessionStorage.setItem('pix_drive_token', response.access_token);
        // Track token expiry for proactive refresh
        const expiresIn = response.expires_in || 3600; // default 1 hour
        this._tokenExpiresAt = Date.now() + (expiresIn * 1000);
        sessionStorage.setItem('pix_drive_token_expires', this._tokenExpiresAt.toString());
        this._scheduleTokenRefresh(expiresIn);
        document.dispatchEvent(new Event('drive-authenticated'));
      }
    });
  }

  // Proactive token refresh - refreshes 5 minutes before expiry
  _scheduleTokenRefresh(expiresInSeconds) {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    const refreshIn = Math.max((expiresInSeconds - 300) * 1000, 60000); // 5 min before expiry, min 1 min
    this._refreshTimer = setTimeout(() => {
      console.log('[Drive] Proactive token refresh triggered');
      this._silentRefresh();
    }, refreshIn);
    console.log(`[Drive] Token refresh scheduled in ${Math.round(refreshIn/60000)} min`);
  }

  async _silentRefresh() {
    if (!this.tokenClient) return;
    try {
      this.tokenClient.requestAccessToken({ prompt: '' }); // empty prompt = silent refresh
    } catch (e) {
      console.log('[Drive] Silent refresh failed, will re-auth on next use');
    }
  }

  // Check if token is still valid (with 2 min buffer)
  isTokenValid() {
    if (!this.accessToken) return false;
    if (!this._tokenExpiresAt) {
      // Try to restore from localStorage
      const saved = sessionStorage.getItem('pix_drive_token_expires');
      if (saved) this._tokenExpiresAt = parseInt(saved);
      else return true; // no expiry info, assume valid
    }
    return Date.now() < (this._tokenExpiresAt - 120000); // 2 min buffer
  }

  // Ensure valid token before API call
  async ensureValidToken() {
    if (!this.isTokenValid()) {
      console.log('[Drive] Token expired or near expiry, refreshing...');
      await this._silentRefresh();
      // Wait a bit for the callback
      await new Promise(r => setTimeout(r, 1000));
      if (!this.isTokenValid()) {
        throw new Error('Token refresh failed. Please re-authenticate.');
      }
    }
  }

  // Request authentication
  async authenticate() {
    if (!this.tokenClient) {
      throw new Error('Drive not initialized. Set Client ID in settings.');
    }
    this.tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  // Check if authenticated
  isAuthenticated() {
    return !!this.accessToken;
  }

  // API call helper
  async _fetch(url, options = {}) {
    if (!this.accessToken) throw new Error('Not authenticated');
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        ...options.headers
      }
    });
    if (resp.status === 401) {
      this.accessToken = null;
      throw new Error('Token expired. Please re-authenticate.');
    }
    return resp;
  }

  // Find or create PIX Muestreo folder
  async ensureFolder() {
    if (this.folderId) return this.folderId;

    // Search for existing folder
    const q = encodeURIComponent(`name='${DRIVE_CONFIG.FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const resp = await this._fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
    const data = await resp.json();

    if (data.files && data.files.length > 0) {
      this.folderId = data.files[0].id;
      return this.folderId;
    }

    // Create folder
    const createResp = await this._fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: DRIVE_CONFIG.FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const folder = await createResp.json();
    this.folderId = folder.id;
    return this.folderId;
  }

  // List files in Pixadvisor folder
  async listFiles(mimeType = null) {
    const folderId = await this.ensureFolder();
    let q = `'${folderId}' in parents and trashed=false`;
    if (mimeType) q += ` and mimeType='${mimeType}'`;
    const resp = await this._fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,size)&orderBy=modifiedTime desc`
    );
    return (await resp.json()).files || [];
  }

  // List importable files (GeoJSON, KML, KMZ, SHP, CSV)
  async listImportableFiles() {
    const folderId = await this.ensureFolder();
    const resp = await this._fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=files(id,name,mimeType,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=100`
    );
    const data = await resp.json();
    const files = data.files || [];
    const importable = ['.geojson', '.json', '.kml', '.kmz', '.csv', '.shp', '.zip'];
    return files.filter(f => importable.some(ext => f.name.toLowerCase().endsWith(ext)));
  }

  // Download file content
  async downloadFile(fileId) {
    const resp = await this._fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    );
    return resp;
  }

  // Download and parse GeoJSON/KML
  async importGeoFile(fileId, fileName) {
    const resp = await this.downloadFile(fileId);
    const text = await resp.text();

    if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
      return JSON.parse(text);
    }
    if (fileName.endsWith('.kml')) {
      return this._parseKML(text);
    }
    if (fileName.endsWith('.csv')) {
      return this._parseCSV(text);
    }
    throw new Error('Formato no soportado: ' + fileName);
  }

  // Parse KML to GeoJSON
  _parseKML(kmlText) {
    const parser = new DOMParser();
    const kml = parser.parseFromString(kmlText, 'text/xml');
    const features = [];

    // Parse Placemarks
    const placemarks = kml.querySelectorAll('Placemark');
    placemarks.forEach(pm => {
      const name = pm.querySelector('name')?.textContent || '';
      const desc = pm.querySelector('description')?.textContent || '';

      // Point
      const point = pm.querySelector('Point coordinates');
      if (point) {
        const [lng, lat, alt] = point.textContent.trim().split(',').map(Number);
        features.push({
          type: 'Feature',
          properties: { name, description: desc },
          geometry: { type: 'Point', coordinates: [lng, lat] }
        });
      }

      // Polygon
      const polygon = pm.querySelector('Polygon outerBoundaryIs LinearRing coordinates');
      if (polygon) {
        const coords = polygon.textContent.trim().split(/\s+/).map(c => {
          const [lng, lat] = c.split(',').map(Number);
          return [lng, lat];
        });
        features.push({
          type: 'Feature',
          properties: { name, description: desc },
          geometry: { type: 'Polygon', coordinates: [coords] }
        });
      }
    });

    return { type: 'FeatureCollection', features };
  }

  // Parse CSV with lat/lng columns
  _parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(/[,;\t]/).map(h => h.trim().toLowerCase());
    const latIdx = headers.findIndex(h => ['lat', 'latitude', 'latitud', 'y'].includes(h));
    const lngIdx = headers.findIndex(h => ['lng', 'lon', 'longitude', 'longitud', 'long', 'x'].includes(h));
    const nameIdx = headers.findIndex(h => ['name', 'nombre', 'nome', 'id', 'punto', 'point', 'ponto'].includes(h));

    if (latIdx === -1 || lngIdx === -1) throw new Error('CSV debe tener columnas lat/lng');

    const features = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(/[,;\t]/).map(v => v.trim());
      const lat = parseFloat(vals[latIdx]);
      const lng = parseFloat(vals[lngIdx]);
      if (isNaN(lat) || isNaN(lng)) continue;

      const props = {};
      headers.forEach((h, idx) => { props[h] = vals[idx]; });
      if (nameIdx >= 0) props.name = vals[nameIdx];
      else props.name = `P${i}`;

      features.push({
        type: 'Feature',
        properties: props,
        geometry: { type: 'Point', coordinates: [lng, lat] }
      });
    }
    return { type: 'FeatureCollection', features };
  }

  // Upload JSON data to Drive
  async uploadJSON(fileName, data) {
    const folderId = await this.ensureFolder();
    const metadata = {
      name: fileName,
      mimeType: 'application/json',
      parents: [folderId]
    };

    // Check if file exists, update it
    const q = encodeURIComponent(`name='${fileName}' and '${folderId}' in parents and trashed=false`);
    const existing = await this._fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
    const existingData = await existing.json();

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

    if (existingData.files && existingData.files.length > 0) {
      // Update existing
      const fileId = existingData.files[0].id;
      const resp = await this._fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        { method: 'PATCH', body: blob }
      );
      return resp.json();
    }

    // Create new - multipart upload
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const resp = await this._fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', body: form }
    );
    return resp.json();
  }

  // Upload photo (base64)
  async uploadPhoto(fileName, base64Data) {
    const folderId = await this.ensureFolder();

    // Create photos subfolder
    let photosFolderId;
    const q = encodeURIComponent(`name='Fotos' and '${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const existing = await this._fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
    const existingData = await existing.json();

    if (existingData.files && existingData.files.length > 0) {
      photosFolderId = existingData.files[0].id;
    } else {
      const createResp = await this._fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Fotos', mimeType: 'application/vnd.google-apps.folder', parents: [folderId] })
      });
      const folder = await createResp.json();
      photosFolderId = folder.id;
    }

    // Convert base64 to blob
    const byteStr = atob(base64Data.split(',')[1]);
    const ab = new ArrayBuffer(byteStr.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
    const blob = new Blob([ab], { type: 'image/jpeg' });

    const metadata = { name: fileName, mimeType: 'image/jpeg', parents: [photosFolderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const resp = await this._fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', body: form }
    );
    return resp.json();
  }

  // Sync all unsynced samples to Drive
  async syncAll() {
    const unsynced = await pixDB.getUnsyncedSamples();
    if (unsynced.length === 0) return { synced: 0 };

    // Group by field
    const byField = {};
    for (const s of unsynced) {
      const fId = s.fieldId || 'general';
      if (!byField[fId]) byField[fId] = [];
      byField[fId].push(s);
    }

    let totalSynced = 0;

    for (const [fieldId, samples] of Object.entries(byField)) {
      // Get field info
      let fieldName = 'campo';
      if (fieldId !== 'general') {
        const field = await pixDB.get('fields', parseInt(fieldId));
        if (field) fieldName = field.name;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `muestreo_${fieldName}_${timestamp}.json`;

      // Get track data
      const tracks = await pixDB.getAllByIndex('tracks', 'fieldId', parseInt(fieldId));

      const exportData = {
        app: 'PIX Muestreo',
        version: '1.0',
        exportDate: new Date().toISOString(),
        field: fieldName,
        fieldId: fieldId,
        totalSamples: samples.length,
        samples: samples.map(s => ({
          pointName: s.pointName,
          lat: s.lat,
          lng: s.lng,
          depth: s.depth,
          barcode: s.barcode,
          sampleType: s.sampleType,
          collector: s.collector,
          notes: s.notes,
          photo: s.photo ? '(foto adjunta)' : null,
          collectedAt: s.collectedAt
        })),
        track: tracks.length > 0 ? tracks[0].positions : []
      };

      exportData.syncVersion = Date.now();
      await this.uploadJSON(fileName, exportData);

      // Upload photos first, then mark synced only on success
      for (const s of samples) {
        let photoOk = true;
        if (s.photo) {
          const photoName = `foto_${s.pointName || s.id}_${timestamp}.jpg`;
          try {
            await this.uploadPhoto(photoName, s.photo);
          } catch (e) {
            console.warn('Error uploading photo, sample NOT marked synced:', e);
            photoOk = false;
          }
        }
        if (photoOk) {
          await pixDB.markSynced(s.id);
          totalSynced++;
        }
      }
    }

    return { synced: totalSynced };
  }
}

const driveSync = new DriveSync();
