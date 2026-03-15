// Map Module for Pixadvisor Coleta - Leaflet based
class PixMap {
  constructor() {
    this.map = null;
    this.userMarker = null;
    this.accuracyCircle = null;
    this.pointMarkers = [];
    this.fieldLayers = [];
    this.trackLine = null;
    this.navigationLine = null;
    this.selectedPoint = null;
  }

  // Initialize map
  init(containerId) {
    this.map = L.map(containerId, {
      zoomControl: false,
      attributionControl: false
    }).setView([-17.78, -63.18], 13); // Default: Santa Cruz, Bolivia

    // Satellite layer (Google)
    const satellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      maxZoom: 22,
      attribution: 'Google Satellite'
    });

    // Hybrid (satellite + labels)
    const hybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      maxZoom: 22,
      attribution: 'Google Hybrid'
    });

    // Street map (OSM)
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: 'OpenStreetMap'
    });

    // Default to hybrid
    hybrid.addTo(this.map);

    // Layer control
    L.control.layers({
      'Satélite': satellite,
      'Híbrido': hybrid,
      'Calles': streets
    }, null, { position: 'topright' }).addTo(this.map);

    // Zoom control
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Scale
    L.control.scale({ metric: true, imperial: false }).addTo(this.map);

    return this.map;
  }

  // Update user position marker
  updateUserPosition(lat, lng, accuracy) {
    if (!this.map) return;

    if (!this.userMarker) {
      const userIcon = L.divIcon({
        className: 'user-marker',
        html: `<div class="user-marker-dot"></div><div class="user-marker-pulse"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      this.userMarker = L.marker([lat, lng], { icon: userIcon, zIndex: 1000 }).addTo(this.map);
      this.accuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: '#00BFA5',
        fillColor: '#00BFA5',
        fillOpacity: 0.1,
        weight: 1
      }).addTo(this.map);
    } else {
      this.userMarker.setLatLng([lat, lng]);
      this.accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
    }
  }

  // Center map on user
  centerOnUser() {
    if (this.userMarker) {
      this.map.setView(this.userMarker.getLatLng(), 17);
    }
  }

  // Add field boundary (polygon)
  addFieldBoundary(geojson, name, color = '#00BFA5') {
    const layer = L.geoJSON(geojson, {
      style: {
        color: color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.1,
        dashArray: '5, 5'
      }
    }).addTo(this.map);

    if (name) {
      layer.bindTooltip(name, { permanent: true, direction: 'center', className: 'field-label' });
    }

    this.fieldLayers.push(layer);
    return layer;
  }

  // Zone class to color mapping for zonas de manejo
  // Baja=red, Media-Baja=orange, Media=yellow, Media-Alta=lightgreen, Alta=green
  _getZonaColor(clase) {
    if (!clase) return '#00BFA5'; // default teal
    const c = clase.toLowerCase().trim();
    if (c === 'baja' || c === 'low') return '#F44336';           // red
    if (c === 'media-baja' || c === 'media baja' || c === 'medium-low') return '#FF9800'; // orange
    if (c === 'media' || c === 'medium') return '#FFEB3B';       // yellow
    if (c === 'media-alta' || c === 'media alta' || c === 'medium-high') return '#8BC34A'; // lightgreen
    if (c === 'alta' || c === 'high') return '#4CAF50';          // green
    // If class contains partial matches
    if (c.includes('baja') && c.includes('media')) return '#FF9800';
    if (c.includes('alta') && c.includes('media')) return '#8BC34A';
    if (c.includes('baja')) return '#F44336';
    if (c.includes('alta')) return '#4CAF50';
    if (c.includes('media')) return '#FFEB3B';
    return '#00BFA5'; // default
  }

  // Add colored zonas de manejo (from project JSON import)
  addZonasColored(zonasFc, zonasMetadata) {
    if (!zonasFc || !zonasFc.features) return;

    zonasFc.features.forEach((feature, idx) => {
      const meta = (zonasMetadata && zonasMetadata[idx]) || {};
      const color = this._getZonaColor(meta.clase);
      const zoneName = meta.name || `Zona ${idx + 1}`;

      const layer = L.geoJSON(feature, {
        style: {
          color: color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.25,
          dashArray: null
        }
      }).addTo(this.map);

      // Show zone name and class as tooltip
      const label = meta.clase ? `${zoneName} (${meta.clase})` : zoneName;
      layer.bindTooltip(label, {
        permanent: false,
        direction: 'center',
        className: 'field-label'
      });

      this.fieldLayers.push(layer);
    });
  }

  // Add sample points with type-based colors (principal/submuestra)
  // Red=principal(pending), Yellow=submuestra(pending), Green=collected
  addTypedSamplePoints(points, onPointClick) {
    this.clearPoints();

    points.forEach(point => {
      const tipo = point.tipo || (point.properties && point.properties.tipo) || 'principal';
      const status = point.status || 'pending';

      // Color logic: green if collected, otherwise red for principal, yellow for submuestra
      let color;
      if (status === 'collected') {
        color = '#4CAF50'; // green
      } else if (tipo === 'submuestra') {
        color = '#FFEB3B'; // yellow
      } else {
        color = '#F44336'; // red for principal
      }

      const labelText = point.name || point.id;
      // Shorter label for map display
      const shortLabel = labelText.length > 8 ? labelText.slice(-6) : labelText;

      const icon = L.divIcon({
        className: 'sample-point-marker',
        html: `<div class="point-dot" style="background:${color};border-color:${color}">
          <span class="point-label">${shortLabel}</span>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([point.lat, point.lng], { icon }).addTo(this.map);

      // Rich popup with point info
      const zonaStr = point.zona ? `Zona ${point.zona}` : '';
      const tipoStr = tipo === 'principal' ? 'Principal' : 'Submuestra';
      marker.bindPopup(
        `<b>${labelText}</b><br>${tipoStr} ${zonaStr}<br>` +
        `<small>${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}</small>`
      );

      marker.on('click', () => {
        this.selectedPoint = point;
        if (onPointClick) onPointClick(point);
      });

      marker.pointData = point;
      this.pointMarkers.push(marker);
    });
  }

  // Add sample points
  addSamplePoints(points, onPointClick) {
    this.clearPoints();

    points.forEach(point => {
      const status = point.status || 'pending'; // pending, collected, skipped
      const colors = {
        pending: '#FF9800',
        collected: '#4CAF50',
        skipped: '#F44336',
        current: '#00BFA5'
      };
      const color = colors[status] || colors.pending;

      const icon = L.divIcon({
        className: 'sample-point-marker',
        html: `<div class="point-dot" style="background:${color};border-color:${color}">
          <span class="point-label">${point.name || point.id}</span>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([point.lat, point.lng], { icon }).addTo(this.map);

      marker.on('click', () => {
        this.selectedPoint = point;
        if (onPointClick) onPointClick(point);
      });

      marker.pointData = point;
      this.pointMarkers.push(marker);
    });
  }

  // Update point status
  updatePointStatus(pointId, status) {
    const marker = this.pointMarkers.find(m => m.pointData.id === pointId);
    if (!marker) return;

    const colors = { pending: '#FF9800', collected: '#4CAF50', skipped: '#F44336', current: '#00BFA5' };
    const color = colors[status] || colors.pending;
    const point = marker.pointData;
    point.status = status;

    marker.setIcon(L.divIcon({
      className: 'sample-point-marker',
      html: `<div class="point-dot" style="background:${color};border-color:${color}">
        <span class="point-label">${point.name || point.id}</span>
      </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    }));
  }

  // Draw navigation line from user to target
  drawNavigationLine(fromLat, fromLng, toLat, toLng) {
    if (this.navigationLine) {
      this.map.removeLayer(this.navigationLine);
    }
    this.navigationLine = L.polyline([
      [fromLat, fromLng], [toLat, toLng]
    ], {
      color: '#00BFA5',
      weight: 3,
      dashArray: '10, 10',
      opacity: 0.8
    }).addTo(this.map);
  }

  // Clear navigation line
  clearNavigationLine() {
    if (this.navigationLine) {
      this.map.removeLayer(this.navigationLine);
      this.navigationLine = null;
    }
  }

  // Draw GPS track
  drawTrack(positions) {
    if (this.trackLine) this.map.removeLayer(this.trackLine);
    if (!positions || positions.length < 2) return;

    const coords = positions.map(p => [p.lat, p.lng]);
    this.trackLine = L.polyline(coords, {
      color: '#1565C0',
      weight: 3,
      opacity: 0.7
    }).addTo(this.map);
  }

  // Add track point
  addTrackPoint(lat, lng) {
    if (!this.trackLine) {
      this.trackLine = L.polyline([[lat, lng]], {
        color: '#1565C0',
        weight: 3,
        opacity: 0.7
      }).addTo(this.map);
    } else {
      this.trackLine.addLatLng([lat, lng]);
    }
  }

  // Fit map to all content
  fitBounds() {
    const group = L.featureGroup([
      ...this.pointMarkers,
      ...this.fieldLayers
    ]);
    if (group.getLayers().length > 0) {
      this.map.fitBounds(group.getBounds().pad(0.1));
    }
  }

  // Clear all points
  clearPoints() {
    this.pointMarkers.forEach(m => this.map.removeLayer(m));
    this.pointMarkers = [];
  }

  // Clear all layers
  clearAll() {
    this.clearPoints();
    this.fieldLayers.forEach(l => this.map.removeLayer(l));
    this.fieldLayers = [];
    if (this.trackLine) { this.map.removeLayer(this.trackLine); this.trackLine = null; }
    this.clearNavigationLine();
  }

  // Destroy map
  destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}

const pixMap = new PixMap();
