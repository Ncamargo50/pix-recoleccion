// Sync utilities for PIX Recolección
// Background sync registration and network status management

class SyncManager {
  constructor() {
    this.syncInProgress = false;
    this.lastSyncTime = null;
  }

  // Register for background sync
  async registerBackgroundSync() {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('sync-samples');
        console.log('Background sync registered');
      } catch (e) {
        console.log('Background sync not supported:', e);
      }
    }
  }

  // Auto-sync when coming online
  setupAutoSync() {
    window.addEventListener('online', async () => {
      console.log('Back online - checking for unsynced data');
      const unsynced = await pixDB.getUnsyncedSamples();
      if (unsynced.length > 0 && driveSync.isAuthenticated()) {
        app.toast(`${unsynced.length} muestras pendientes. Sincronizando...`, 'warning');
        setTimeout(() => app.syncToDrive(), 2000);
      }
    });
  }

  // Export to GeoJSON for QGIS/GIS software
  async exportToGeoJSON(fieldId) {
    const samples = await pixDB.getAllByIndex('samples', 'fieldId', fieldId);
    const field = await pixDB.get('fields', fieldId);

    const features = samples.map(s => ({
      type: 'Feature',
      properties: {
        name: s.pointName,
        barcode: s.barcode,
        depth: s.depth,
        sampleType: s.sampleType,
        collector: s.collector,
        notes: s.notes,
        collectedAt: s.collectedAt,
        accuracy: s.accuracy
      },
      geometry: {
        type: 'Point',
        coordinates: [s.lng, s.lat]
      }
    }));

    return {
      type: 'FeatureCollection',
      name: `recoleccion_${field?.name || 'campo'}`,
      features
    };
  }

  // Generate collection report
  async generateReport(fieldId) {
    const field = await pixDB.get('fields', fieldId);
    const points = await pixDB.getAllByIndex('points', 'fieldId', fieldId);
    const samples = await pixDB.getAllByIndex('samples', 'fieldId', fieldId);

    const collected = points.filter(p => p.status === 'collected').length;
    const pending = points.filter(p => p.status === 'pending').length;

    return {
      field: field?.name || 'Sin nombre',
      area: field?.area ? `${field.area.toFixed(1)} ha` : 'N/A',
      totalPoints: points.length,
      collected,
      pending,
      completionRate: points.length > 0 ? Math.round(collected / points.length * 100) : 0,
      samples: samples.map(s => ({
        point: s.pointName,
        depth: s.depth,
        barcode: s.barcode,
        type: s.sampleType,
        collector: s.collector,
        date: s.collectedAt,
        coords: `${s.lat?.toFixed(6)}, ${s.lng?.toFixed(6)}`
      }))
    };
  }
}

const syncManager = new SyncManager();

// Setup auto-sync on load
document.addEventListener('DOMContentLoaded', () => {
  syncManager.setupAutoSync();
});
