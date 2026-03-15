// PIX Recolección - Main Application
class PixApp {
  constructor() {
    this.currentView = 'projects';
    this.currentProject = null;
    this.currentField = null;
    this.currentPoint = null;
    this.isNavigating = false;
    this.collectForm = {};
    this.isOnline = navigator.onLine;
  }

  async init() {
    // Init IndexedDB
    await pixDB.init();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (e) { console.log('SW not registered:', e); }
    }

    // Online/offline detection
    window.addEventListener('online', () => { this.isOnline = true; this.updateConnectionStatus(); });
    window.addEventListener('offline', () => { this.isOnline = false; this.updateConnectionStatus(); });

    // Init navigation
    this.initNavigation();
    this.updateConnectionStatus();

    // Load saved settings
    const collector = await pixDB.getSetting('collectorName');
    if (collector) document.getElementById('collectorName').value = collector;

    const clientId = await pixDB.getSetting('driveClientId');
    if (clientId) {
      document.getElementById('driveClientId').value = clientId;
      try {
        await driveSync.init(clientId);
        // Try restore token
        const savedToken = localStorage.getItem('pix_drive_token');
        if (savedToken) {
          driveSync.accessToken = savedToken;
          driveSync.isInitialized = true;
        }
      } catch (e) { console.log('Drive init deferred'); }
    }

    // Load projects
    this.loadProjects();

    // Show map view by default
    this.showView('map');

    // Init GPS
    try {
      gpsNav.startWatch(pos => {
        if (pos) {
          pixMap.updateUserPosition(pos.lat, pos.lng, pos.accuracy);
          if (gpsNav.isTracking) {
            pixMap.addTrackPoint(pos.lat, pos.lng);
          }
          this.updateNavPanel();
          this.updateAccuracyDisplay(pos.accuracy);

          // Auto-detect point
          if (this.currentField) {
            this.autoDetectPoint();
          }
        }
      });
    } catch (e) {
      this.toast('GPS no disponible', 'warning');
    }

    // Drive auth callback
    document.addEventListener('drive-authenticated', () => {
      this.toast('Google Drive conectado', 'success');
      this.updateConnectionStatus();
    });

    console.log('PIX Recolección initialized');
  }

  // Navigation between views
  initNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        this.showView(view);
      });
    });
  }

  showView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.view === viewName);
    });

    // Init map when showing map view
    if (viewName === 'map' && !pixMap.map) {
      setTimeout(() => {
        pixMap.init('map');
        if (gpsNav.currentPosition) {
          pixMap.updateUserPosition(
            gpsNav.currentPosition.lat,
            gpsNav.currentPosition.lng,
            gpsNav.currentPosition.accuracy
          );
          pixMap.map.setView([gpsNav.currentPosition.lat, gpsNav.currentPosition.lng], 15);
        }
        // Load current field data
        if (this.currentField) {
          this.loadFieldOnMap(this.currentField);
        }
      }, 100);
    }

    if (viewName === 'sync') this.updateSyncStats();
    if (viewName === 'projects') this.loadProjects();
  }

  // Connection status
  updateConnectionStatus() {
    const dot = document.getElementById('connectionDot');
    const label = document.getElementById('connectionLabel');
    if (this.isOnline) {
      dot.className = 'status-dot online';
      label.textContent = 'Online';
    } else {
      dot.className = 'status-dot offline';
      label.textContent = 'Offline';
    }
  }

  // ===== PROJECTS =====
  async loadProjects() {
    const projects = await pixDB.getAll('projects');
    const container = document.getElementById('projectsList');

    if (projects.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
          </svg>
          <h3>Sin proyectos</h3>
          <p>Importá mapas desde Google Drive o creá un proyecto manual</p>
          <button class="action-btn primary" onclick="app.showImportModal()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            Importar desde Drive
          </button>
        </div>`;
      return;
    }

    let html = '';
    for (const proj of projects) {
      const fields = await pixDB.getAllByIndex('fields', 'projectId', proj.id);
      let totalPoints = 0, collectedPoints = 0;
      for (const f of fields) {
        const points = await pixDB.getAllByIndex('points', 'fieldId', f.id);
        totalPoints += points.length;
        collectedPoints += points.filter(p => p.status === 'collected').length;
      }
      const pct = totalPoints > 0 ? Math.round(collectedPoints / totalPoints * 100) : 0;
      const badge = pct === 100 ? 'complete' : pct > 0 ? 'active' : 'pending';

      html += `
        <div class="card" onclick="app.openProject(${proj.id})">
          <div class="card-header">
            <div>
              <div class="card-title">${proj.name}</div>
              <div class="card-subtitle">${proj.client || ''}</div>
            </div>
            <span class="card-badge badge-${badge}">${pct}%</span>
          </div>
          <div class="card-stats">
            <span class="stat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              <strong>${fields.length}</strong> campos
            </span>
            <span class="stat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg>
              <strong>${collectedPoints}/${totalPoints}</strong> puntos
            </span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>`;
    }
    container.innerHTML = html;
  }

  async openProject(projectId) {
    this.currentProject = await pixDB.get('projects', projectId);
    const fields = await pixDB.getAllByIndex('fields', 'projectId', projectId);

    const container = document.getElementById('projectsList');
    let html = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <button class="fab-btn secondary" onclick="app.loadProjects()" style="width:36px;height:36px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div>
          <div class="card-title">${this.currentProject.name}</div>
          <div class="card-subtitle">${fields.length} campos</div>
        </div>
      </div>`;

    for (const field of fields) {
      const points = await pixDB.getAllByIndex('points', 'fieldId', field.id);
      const collected = points.filter(p => p.status === 'collected').length;
      const pct = points.length > 0 ? Math.round(collected / points.length * 100) : 0;

      html += `
        <div class="card" onclick="app.openField(${field.id})">
          <div class="card-header">
            <div>
              <div class="card-title">${field.name}</div>
              <div class="card-subtitle">${field.area ? field.area.toFixed(1) + ' ha' : ''}</div>
            </div>
            <span class="card-badge badge-${pct === 100 ? 'complete' : pct > 0 ? 'active' : 'pending'}">${collected}/${points.length}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>`;
    }

    container.innerHTML = html;
  }

  async openField(fieldId) {
    this.currentField = await pixDB.get('fields', fieldId);
    this.loadFieldOnMap(this.currentField);
    this.showView('map');
  }

  async loadFieldOnMap(field) {
    if (!pixMap.map) return;
    pixMap.clearAll();

    // Check if field has zonas metadata (from project JSON import)
    if (field.boundary && field.zonasMetadata && field.zonasMetadata.length > 0) {
      // Draw each zone polygon with color based on its class
      pixMap.addZonasColored(field.boundary, field.zonasMetadata);
    } else if (field.boundary) {
      // Standard field boundary
      pixMap.addFieldBoundary(field.boundary, field.name);
    }

    // Load points
    const points = await pixDB.getAllByIndex('points', 'fieldId', field.id);
    if (points.length > 0) {
      // Check if points have tipo info (from project JSON) for color coding
      const hasTypes = points.some(p => p.tipo || (p.properties && p.properties.tipo));
      if (hasTypes) {
        pixMap.addTypedSamplePoints(points, point => this.onPointClick(point));
      } else {
        pixMap.addSamplePoints(points, point => this.onPointClick(point));
      }
      pixMap.fitBounds();
    }

    // Update header
    const areaStr = field.area ? ` (${field.area.toFixed(1)} ha)` : '';
    document.getElementById('currentFieldName').textContent = field.name + areaStr;
    document.getElementById('navPanel').style.display = 'block';
  }

  // ===== POINT INTERACTION =====
  onPointClick(point) {
    this.currentPoint = point;

    if (point.status === 'collected') {
      this.toast(`Punto ${point.name} ya recolectado`, 'warning');
      return;
    }

    // Start navigation to point
    gpsNav.setTarget(point.lat, point.lng, point.name);
    document.getElementById('navTargetName').textContent = `Punto ${point.name}`;
    pixMap.updatePointStatus(point.id, 'current');
    this.isNavigating = true;
  }

  updateNavPanel() {
    if (!gpsNav.targetPoint || !gpsNav.currentPosition) return;

    const dist = gpsNav.distanceTo(
      gpsNav.currentPosition.lat, gpsNav.currentPosition.lng,
      gpsNav.targetPoint.lat, gpsNav.targetPoint.lng
    );
    const bearing = gpsNav.bearingTo(
      gpsNav.currentPosition.lat, gpsNav.currentPosition.lng,
      gpsNav.targetPoint.lat, gpsNav.targetPoint.lng
    );

    document.getElementById('navDistance').innerHTML =
      dist < 1000 ? `${Math.round(dist)}<small>m</small>` : `${(dist/1000).toFixed(1)}<small>km</small>`;
    document.getElementById('navDirection').textContent =
      `Dirección: ${gpsNav.compassDirection(bearing)} (${Math.round(bearing)}°)`;

    // Draw nav line
    pixMap.drawNavigationLine(
      gpsNav.currentPosition.lat, gpsNav.currentPosition.lng,
      gpsNav.targetPoint.lat, gpsNav.targetPoint.lng
    );

    // Auto-open collect form when close
    if (dist < 10 && this.isNavigating) {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      this.toast('¡Llegaste al punto!', 'success');
    }
  }

  updateAccuracyDisplay(accuracy) {
    const el = document.getElementById('navAccuracy');
    const rounded = Math.round(accuracy);
    el.textContent = `Precisión GPS: ±${rounded}m`;
    el.className = 'nav-accuracy ' + (rounded <= 5 ? 'good' : rounded <= 15 ? 'medium' : 'poor');
  }

  autoDetectPoint() {
    // Not implemented in simplified version
  }

  // ===== COLLECT SAMPLE =====
  async openCollectForm() {
    if (!this.currentPoint) {
      this.toast('Seleccioná un punto en el mapa', 'warning');
      return;
    }

    document.getElementById('collectPointName').textContent = `Punto ${this.currentPoint.name}`;
    document.getElementById('collectCoords').textContent =
      `${this.currentPoint.lat.toFixed(6)}, ${this.currentPoint.lng.toFixed(6)}`;

    // Reset form
    document.getElementById('barcodeValue').textContent = 'Sin escanear';
    document.getElementById('barcodeDisplay').classList.remove('scanned');
    const ibraDetailsEl = document.getElementById('ibraDetails');
    if (ibraDetailsEl) ibraDetailsEl.style.display = 'none';
    document.getElementById('sampleNotes').value = '';
    document.getElementById('photoPreviewImg').style.display = 'none';
    document.getElementById('photoPlaceholder').style.display = 'flex';
    this.collectForm = { barcode: null, photo: null, parsedIBRA: null };

    // Set default collector
    const collector = await pixDB.getSetting('collectorName');
    if (collector) document.getElementById('collectorField').value = collector;

    // Show modal
    document.getElementById('collectModal').classList.add('active');
  }

  closeCollectForm() {
    document.getElementById('collectModal').classList.remove('active');
  }

  // Scan barcode - with IBRA Megalab QR parsing
  async scanBarcode() {
    document.getElementById('scannerOverlay').classList.add('active');
    try {
      await barcodeScanner.init('scannerViewfinder', (code) => {
        // Parse the scanned code (detect IBRA Megalab format)
        const parsed = BarcodeScanner.parseIBRA(code);
        this.collectForm.barcode = code;
        this.collectForm.parsedIBRA = parsed;

        // Update barcode display
        const barcodeValue = document.getElementById('barcodeValue');
        const barcodeDisplay = document.getElementById('barcodeDisplay');
        barcodeDisplay.classList.add('scanned');

        if (parsed.isIBRA && parsed.sampleId) {
          // Show IBRA parsed info
          barcodeValue.innerHTML = `
            <span class="ibra-badge">IBRA</span> ${parsed.sampleId}
          `;

          // Show details below the barcode display
          const detailsEl = document.getElementById('ibraDetails');
          const summary = BarcodeScanner.formatIBRADisplay(parsed);
          if (summary && detailsEl) {
            detailsEl.textContent = summary;
            detailsEl.style.display = 'block';
          }

          // Auto-fill depth if IBRA QR provides it
          if (parsed.depth) {
            const depthNorm = parsed.depth.replace(/\s/g, '');
            const depthBtn = document.querySelector(`.depth-chip[data-depth="${depthNorm}"]`);
            if (depthBtn) {
              this.selectDepth(depthBtn, depthNorm);
            }
          }

          // Auto-fill sample type if IBRA QR provides it
          if (parsed.sampleType) {
            const typeMap = {
              'quimico': 'quimico', 'quimica': 'quimico', 'chemical': 'quimico',
              'fertilidade': 'fertilidad', 'fertilidad': 'fertilidad',
              'fisico': 'fisico', 'fisica': 'fisico', 'physical': 'fisico',
              'micro': 'microbiologico', 'microbiologico': 'microbiologico',
              'nematodo': 'nematodos', 'nematodos': 'nematodos', 'nematoide': 'nematodos',
              'carbono': 'carbono', 'carbon': 'carbono',
              'completo': 'completo', 'complete': 'completo'
            };
            const mapped = typeMap[parsed.sampleType.toLowerCase()] || null;
            if (mapped) {
              document.getElementById('sampleType').value = mapped;
            }
          }

          this.toast(`IBRA Megalab: ${parsed.sampleId}`, 'success');
        } else {
          // Generic barcode/QR
          barcodeValue.textContent = code;
          const detailsEl = document.getElementById('ibraDetails');
          if (detailsEl) detailsEl.style.display = 'none';
          this.toast(`Código: ${code}`, 'success');
        }

        this.closeScannerOverlay();
      });
    } catch (e) {
      this.toast('Error al iniciar cámara', 'error');
      this.closeScannerOverlay();
    }
  }

  async closeScannerOverlay() {
    await barcodeScanner.stop();
    document.getElementById('scannerOverlay').classList.remove('active');
  }

  // Take photo
  async takePhoto() {
    try {
      const photo = await BarcodeScanner.takePhoto();
      this.collectForm.photo = photo;
      const img = document.getElementById('photoPreviewImg');
      img.src = photo;
      img.style.display = 'block';
      document.getElementById('photoPlaceholder').style.display = 'none';
    } catch (e) {
      console.error('Photo error:', e);
    }
  }

  // Select depth
  selectDepth(btn, depth) {
    document.querySelectorAll('.depth-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    this.collectForm.depth = depth;
  }

  // Save sample
  async saveSample() {
    const depth = this.collectForm.depth || document.querySelector('.depth-chip.active')?.dataset.depth || '0-20';
    const sampleType = document.getElementById('sampleType').value;
    const collector = document.getElementById('collectorField').value;
    const notes = document.getElementById('sampleNotes').value;

    // Save collector name
    if (collector) await pixDB.setSetting('collectorName', collector);

    // Build IBRA metadata if available
    const ibraData = this.collectForm.parsedIBRA || null;

    const sample = {
      pointId: this.currentPoint.id,
      fieldId: this.currentField.id,
      pointName: this.currentPoint.name,
      lat: gpsNav.currentPosition?.lat || this.currentPoint.lat,
      lng: gpsNav.currentPosition?.lng || this.currentPoint.lng,
      accuracy: gpsNav.currentPosition?.accuracy || null,
      depth: depth,
      sampleType: sampleType,
      barcode: this.collectForm.barcode,
      ibraSampleId: ibraData?.sampleId || null,
      ibraLabOrder: ibraData?.labOrder || null,
      ibraSource: ibraData?.source || null,
      ibraRaw: ibraData?.raw || null,
      collector: collector,
      notes: notes,
      photo: this.collectForm.photo,
      collectedAt: new Date().toISOString(),
      synced: 0
    };

    await pixDB.add('samples', sample);

    // Update point status
    this.currentPoint.status = 'collected';
    await pixDB.put('points', this.currentPoint);
    pixMap.updatePointStatus(this.currentPoint.id, 'collected');

    this.closeCollectForm();
    this.toast(`Muestra guardada: ${this.currentPoint.name}`, 'success');

    // Navigate to next pending point
    const points = await pixDB.getAllByIndex('points', 'fieldId', this.currentField.id);
    const nextPending = points.find(p => p.status === 'pending');
    if (nextPending) {
      this.onPointClick(nextPending);
    } else {
      gpsNav.clearTarget();
      pixMap.clearNavigationLine();
      this.isNavigating = false;
      this.toast('¡Todos los puntos recolectados!', 'success');
    }
  }

  // ===== IMPORT FROM DRIVE =====
  async showImportModal() {
    if (!driveSync.isAuthenticated()) {
      const clientId = await pixDB.getSetting('driveClientId');
      if (!clientId) {
        this.toast('Configurá Google Drive en Ajustes primero', 'warning');
        this.showView('settings');
        return;
      }
      try {
        await driveSync.init(clientId);
        await driveSync.authenticate();
        // Wait for auth callback
        return;
      } catch (e) {
        this.toast('Error de autenticación', 'error');
        return;
      }
    }

    document.getElementById('importModal').classList.add('active');
    document.getElementById('importFileList').innerHTML = '<p style="text-align:center;color:var(--text-muted)">Cargando archivos...</p>';

    try {
      const files = await driveSync.listImportableFiles();
      if (files.length === 0) {
        document.getElementById('importFileList').innerHTML = `
          <div class="empty-state" style="padding:24px">
            <p>No hay archivos en la carpeta "PIX Recolección" de Drive.<br>
            Subí archivos GeoJSON, KML o CSV con tus mapas y puntos.</p>
          </div>`;
        return;
      }

      let html = '';
      for (const f of files) {
        const ext = f.name.split('.').pop().toUpperCase();
        html += `
          <div class="file-list-item" onclick="app.importFile('${f.id}', '${f.name}')">
            <div class="file-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
            </div>
            <div class="file-info">
              <div class="file-name">${f.name}</div>
              <div class="file-meta">${ext} · ${new Date(f.modifiedTime).toLocaleDateString()}</div>
            </div>
          </div>`;
      }
      document.getElementById('importFileList').innerHTML = html;
    } catch (e) {
      document.getElementById('importFileList').innerHTML = `<p style="color:var(--danger);text-align:center">${e.message}</p>`;
    }
  }

  closeImportModal() {
    document.getElementById('importModal').classList.remove('active');
  }

  async importFile(fileId, fileName) {
    this.toast('Importando ' + fileName + '...', '');
    try {
      const geojson = await driveSync.importGeoFile(fileId, fileName);
      await this.processGeoJSON(geojson, fileName);
      this.closeImportModal();
      this.loadProjects();
      this.toast('Importado: ' + fileName, 'success');
    } catch (e) {
      this.toast('Error: ' + e.message, 'error');
    }
  }

  // Import from local file (supports GeoJSON, KML, CSV, and Project JSON)
  async importLocalFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geojson,.json,.kml,.csv';

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const text = await file.text();

      try {
        // Check if this is a PIX project JSON file (has project + lotes structure)
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          if (parsed.project && parsed.lotes && Array.isArray(parsed.lotes)) {
            await this.importProjectJSON(parsed);
            this.loadProjects();
            this.toast(`Proyecto importado: ${parsed.project.name} (${parsed.lotes.length} lotes)`, 'success');
            return;
          }
          // Not a project JSON, fall through to GeoJSON processing
          await this.processGeoJSON(parsed, file.name);
          this.loadProjects();
          this.toast('Importado: ' + file.name, 'success');
          return;
        }

        let geojson;
        if (file.name.endsWith('.kml')) {
          geojson = driveSync._parseKML(text);
        } else if (file.name.endsWith('.csv')) {
          geojson = driveSync._parseCSV(text);
        } else {
          geojson = JSON.parse(text);
        }

        await this.processGeoJSON(geojson, file.name);
        this.loadProjects();
        this.toast('Importado: ' + file.name, 'success');
      } catch (err) {
        this.toast('Error al importar: ' + err.message, 'error');
      }
    };
    input.click();
  }

  // ===== IMPORT PROJECT JSON =====
  // Imports a consolidated project JSON (from convert_project.py)
  // Creates a project with all lotes as fields, each with zonas and puntos
  async importProjectJSON(data) {
    const proj = data.project;

    // Create the project entry
    const projectId = await pixDB.add('projects', {
      name: proj.name,
      client: proj.client || '',
      source: 'proyecto_hacienda.json',
      totalLotes: proj.totalLotes,
      totalPoints: proj.totalPoints,
      importDate: proj.date || new Date().toISOString().slice(0, 10)
    });

    let totalPointsImported = 0;

    // Create a field for each lote
    for (const lote of data.lotes) {
      // Store zonas as the field boundary (FeatureCollection of zone polygons)
      const boundary = (lote.zonas && lote.zonas.features && lote.zonas.features.length > 0)
        ? lote.zonas
        : null;

      const fieldId = await pixDB.add('fields', {
        projectId: projectId,
        name: lote.name || lote.id,
        loteId: lote.id,
        area: lote.area_ha || null,
        boundary: boundary,
        // Store zone metadata for color-coding
        zonasMetadata: this._extractZonasMetadata(lote.zonas)
      });

      // Create points for this lote
      if (lote.puntos && Array.isArray(lote.puntos)) {
        for (const punto of lote.puntos) {
          await pixDB.add('points', {
            fieldId: fieldId,
            name: punto.id || punto.name || '',
            lat: punto.lat,
            lng: punto.lng,
            zona: punto.zona,
            tipo: punto.tipo || 'principal',
            status: (punto.status === 'pendiente' || punto.status === 'pending') ? 'pending' : punto.status,
            properties: {
              zona: punto.zona,
              tipo: punto.tipo
            }
          });
          totalPointsImported++;
        }
      }
    }

    console.log(`[PIX] Proyecto importado: ${proj.name}, ${data.lotes.length} lotes, ${totalPointsImported} puntos`);
  }

  // Extract zone class info from zonas features for color coding
  _extractZonasMetadata(zonas) {
    if (!zonas || !zonas.features) return [];
    return zonas.features.map((f, idx) => {
      const props = f.properties || {};
      // Try common property names for zone class
      const clase = props.clase || props.class || props.Clase || props.CLASS
        || props.categoria || props.zona || props.Zona || '';
      return {
        index: idx,
        clase: clase,
        name: props.name || props.Name || props.nombre || `Zona ${idx + 1}`,
        properties: props
      };
    });
  }

  // Process imported GeoJSON into projects/fields/points
  async processGeoJSON(geojson, sourceName) {
    const projectName = sourceName.replace(/\.\w+$/, '').replace(/[_-]/g, ' ');

    // Create project
    const projectId = await pixDB.add('projects', {
      name: projectName,
      client: '',
      source: sourceName
    });

    // Separate polygons (fields) and points
    const polygons = [];
    const points = [];

    const features = geojson.features || (geojson.type === 'Feature' ? [geojson] : []);

    features.forEach(f => {
      if (!f.geometry) return;
      if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
        polygons.push(f);
      } else if (f.geometry.type === 'Point') {
        points.push(f);
      }
    });

    // If we have polygons, create fields from them
    if (polygons.length > 0) {
      for (let i = 0; i < polygons.length; i++) {
        const poly = polygons[i];
        const fieldName = poly.properties?.name || poly.properties?.Name || `Campo ${i + 1}`;
        const area = this.calculateArea(poly.geometry);

        const fieldId = await pixDB.add('fields', {
          projectId,
          name: fieldName,
          area: area,
          boundary: { type: 'FeatureCollection', features: [poly] }
        });

        // Assign points that fall inside this polygon (or all if only 1 polygon)
        const fieldPoints = polygons.length === 1 ? points :
          points.filter(p => this.pointInPolygon(p.geometry.coordinates, poly.geometry));

        for (let j = 0; j < fieldPoints.length; j++) {
          const pt = fieldPoints[j];
          await pixDB.add('points', {
            fieldId,
            name: pt.properties?.name || pt.properties?.Name || pt.properties?.id || `P${j + 1}`,
            lat: pt.geometry.coordinates[1],
            lng: pt.geometry.coordinates[0],
            status: 'pending',
            properties: pt.properties
          });
        }
      }
    } else if (points.length > 0) {
      // No polygons, create a single field from points
      const fieldId = await pixDB.add('fields', {
        projectId,
        name: projectName,
        area: null,
        boundary: null
      });

      for (let j = 0; j < points.length; j++) {
        const pt = points[j];
        await pixDB.add('points', {
          fieldId,
          name: pt.properties?.name || pt.properties?.Name || pt.properties?.id || `P${j + 1}`,
          lat: pt.geometry.coordinates[1],
          lng: pt.geometry.coordinates[0],
          status: 'pending',
          properties: pt.properties
        });
      }
    }
  }

  // Calculate polygon area (approximate, in hectares)
  calculateArea(geometry) {
    const coords = geometry.type === 'MultiPolygon'
      ? geometry.coordinates[0][0]
      : geometry.coordinates[0];
    if (!coords || coords.length < 3) return 0;

    let area = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const [lng1, lat1] = coords[i];
      const [lng2, lat2] = coords[i + 1];
      area += lng1 * lat2 - lng2 * lat1;
    }
    area = Math.abs(area) / 2;
    // Convert degrees² to hectares (approximate)
    const latMid = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos(latMid * Math.PI / 180);
    return (area * metersPerDegreeLat * metersPerDegreeLng) / 10000;
  }

  // Point in polygon test
  pointInPolygon(point, polygon) {
    const coords = polygon.type === 'MultiPolygon'
      ? polygon.coordinates[0][0]
      : polygon.coordinates[0];
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const [xi, yi] = coords[i];
      const [xj, yj] = coords[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // ===== SYNC =====
  async updateSyncStats() {
    const allSamples = await pixDB.getAll('samples');
    const unsynced = allSamples.filter(s => s.synced === 0);
    const synced = allSamples.filter(s => s.synced === 1);

    document.getElementById('syncPending').textContent = unsynced.length;
    document.getElementById('syncCompleted').textContent = synced.length;
    document.getElementById('syncTotal').textContent = allSamples.length;

    const projects = await pixDB.getAll('projects');
    document.getElementById('syncProjects').textContent = projects.length;
  }

  async syncToDrive() {
    if (!driveSync.isAuthenticated()) {
      this.toast('Conectá Google Drive primero', 'warning');
      return;
    }

    const btn = document.getElementById('syncBtn');
    btn.disabled = true;
    btn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Sincronizando...';

    this.addSyncLog('Iniciando sincronización...');

    try {
      const result = await driveSync.syncAll();
      this.addSyncLog(`✓ ${result.synced} muestras sincronizadas a Drive`);
      this.toast(`${result.synced} muestras sincronizadas`, 'success');
    } catch (e) {
      this.addSyncLog(`✗ Error: ${e.message}`);
      this.toast('Error al sincronizar', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/><path d="M21 3v9h-9"/></svg> Sincronizar con Drive';
    this.updateSyncStats();
  }

  // Export all data as JSON (offline backup)
  async exportLocalBackup() {
    const data = {
      app: 'PIX Recolección',
      exportDate: new Date().toISOString(),
      projects: await pixDB.getAll('projects'),
      fields: await pixDB.getAll('fields'),
      points: await pixDB.getAll('points'),
      samples: await pixDB.getAll('samples'),
      tracks: await pixDB.getAll('tracks')
    };

    // Remove photos from backup (too large)
    data.samples.forEach(s => { if (s.photo) s.photo = '(foto omitida)'; });

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pix_recoleccion_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    this.toast('Backup descargado', 'success');
  }

  addSyncLog(message) {
    const log = document.getElementById('syncLog');
    const time = new Date().toLocaleTimeString().slice(0, 5);
    log.innerHTML += `<div class="sync-log-entry"><span class="time">${time}</span>${message}</div>`;
    log.scrollTop = log.scrollHeight;
  }

  // ===== SETTINGS =====
  async saveDriveClientId() {
    const id = document.getElementById('driveClientId').value.trim();
    if (!id) return;
    await pixDB.setSetting('driveClientId', id);
    try {
      await driveSync.init(id);
      this.toast('Client ID guardado', 'success');
    } catch (e) {
      this.toast('Error: ' + e.message, 'error');
    }
  }

  async connectDrive() {
    const clientId = document.getElementById('driveClientId').value.trim();
    if (!clientId) {
      this.toast('Ingresá el Client ID primero', 'warning');
      return;
    }
    await pixDB.setSetting('driveClientId', clientId);
    try {
      await driveSync.init(clientId);
      await driveSync.authenticate();
    } catch (e) {
      this.toast('Error: ' + e.message, 'error');
    }
  }

  async saveCollectorName() {
    const name = document.getElementById('collectorName').value.trim();
    if (name) {
      await pixDB.setSetting('collectorName', name);
      this.toast('Nombre guardado', 'success');
    }
  }

  // Track toggle
  toggleTracking() {
    const btn = document.getElementById('trackBtn');
    if (gpsNav.isTracking) {
      const positions = gpsNav.stopTracking();
      if (this.currentField && positions.length > 0) {
        pixDB.add('tracks', {
          fieldId: this.currentField.id,
          positions: positions,
          startTime: positions[0]?.timestamp,
          endTime: positions[positions.length - 1]?.timestamp
        });
      }
      btn.classList.remove('active');
      this.toast('Recorrido guardado', 'success');
    } else {
      gpsNav.startTracking();
      btn.classList.add('active');
      this.toast('Grabando recorrido GPS', '');
    }
  }

  // Center map
  centerMap() {
    pixMap.centerOnUser();
  }

  // Navigate to next pending
  async nextPoint() {
    if (!this.currentField) return;
    const points = await pixDB.getAllByIndex('points', 'fieldId', this.currentField.id);
    const pending = points.filter(p => p.status === 'pending');

    if (pending.length === 0) {
      this.toast('Todos los puntos recolectados', 'success');
      return;
    }

    // Find nearest pending
    const nearest = gpsNav.findNearest(pending);
    if (nearest) {
      this.onPointClick(nearest);
      this.toast(`Navegando a ${nearest.name}`, '');
    }
  }

  // Delete project
  async deleteProject(projectId) {
    if (!confirm('¿Eliminar este proyecto y todos sus datos?')) return;

    const fields = await pixDB.getAllByIndex('fields', 'projectId', projectId);
    for (const f of fields) {
      const points = await pixDB.getAllByIndex('points', 'fieldId', f.id);
      for (const p of points) await pixDB.delete('points', p.id);
      const samples = await pixDB.getAllByIndex('samples', 'fieldId', f.id);
      for (const s of samples) await pixDB.delete('samples', s.id);
      await pixDB.delete('fields', f.id);
    }
    await pixDB.delete('projects', projectId);
    this.loadProjects();
    this.toast('Proyecto eliminado', '');
  }

  // Toast notification
  toast(message, type = '') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// Init app
const app = new PixApp();
document.addEventListener('DOMContentLoaded', () => app.init());
