// GPS Navigation Module for Pixadvisor Coleta
class GPSNavigator {
  constructor() {
    this.watchId = null;
    this.currentPosition = null;
    this.targetPoint = null;
    this.trackPositions = [];
    this.isTracking = false;
    this.onPositionUpdate = null;
    this.onDistanceUpdate = null;
    this.accuracy = null;
  }

  // Start watching position
  startWatch(callback) {
    if (!navigator.geolocation) {
      throw new Error('GPS no disponible en este dispositivo');
    }

    this.onPositionUpdate = callback;

    this.watchId = navigator.geolocation.watchPosition(
      pos => {
        this.currentPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          timestamp: pos.timestamp
        };
        this.accuracy = pos.coords.accuracy;

        // Record track
        if (this.isTracking) {
          this.trackPositions.push({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp
          });
        }

        // Calculate distance to target
        if (this.targetPoint) {
          const dist = this.distanceTo(
            pos.coords.latitude, pos.coords.longitude,
            this.targetPoint.lat, this.targetPoint.lng
          );
          const bearing = this.bearingTo(
            pos.coords.latitude, pos.coords.longitude,
            this.targetPoint.lat, this.targetPoint.lng
          );
          if (this.onDistanceUpdate) {
            this.onDistanceUpdate(dist, bearing);
          }
        }

        if (this.onPositionUpdate) {
          this.onPositionUpdate(this.currentPosition);
        }
      },
      err => {
        console.error('GPS error:', err);
        if (callback) callback(null, err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000
      }
    );
  }

  // Stop watching
  stopWatch() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  // Start tracking route
  startTracking() {
    this.isTracking = true;
    this.trackPositions = [];
  }

  // Stop tracking
  stopTracking() {
    this.isTracking = false;
    return [...this.trackPositions];
  }

  // Set navigation target
  setTarget(lat, lng, name) {
    this.targetPoint = { lat, lng, name };
  }

  // Clear target
  clearTarget() {
    this.targetPoint = null;
  }

  // Haversine distance (meters)
  distanceTo(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Bearing to target (degrees)
  bearingTo(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
      Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }

  // Format distance
  formatDistance(meters) {
    if (meters < 1) return '< 1 m';
    if (meters < 1000) return Math.round(meters) + ' m';
    return (meters / 1000).toFixed(1) + ' km';
  }

  // Compass direction
  compassDirection(bearing) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    return dirs[Math.round(bearing / 45) % 8];
  }

  // Get current position once
  async getCurrentPosition() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }),
        reject,
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  // Find nearest point from a list
  findNearest(points) {
    if (!this.currentPosition || !points.length) return null;
    let nearest = null;
    let minDist = Infinity;
    for (const p of points) {
      const d = this.distanceTo(
        this.currentPosition.lat, this.currentPosition.lng,
        p.lat, p.lng
      );
      if (d < minDist) {
        minDist = d;
        nearest = { ...p, distance: d };
      }
    }
    return nearest;
  }

  // Auto-detect which point we're at (within radius)
  detectPoint(points, radiusMeters = 15) {
    if (!this.currentPosition) return null;
    for (const p of points) {
      const d = this.distanceTo(
        this.currentPosition.lat, this.currentPosition.lng,
        p.lat, p.lng
      );
      if (d <= radiusMeters) return { ...p, distance: d };
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // POINT AVERAGING - Mejora la precisión promediando lecturas
  // ═══════════════════════════════════════════════════════════

  /**
   * Toma múltiples lecturas GPS y las promedia para mejorar precisión.
   * En un celular Android con GPS dual-band puede bajar de ±5m a ±1-2m.
   *
   * @param {number} samples - Cantidad de lecturas (default 10)
   * @param {number} intervalMs - Intervalo entre lecturas en ms (default 1500)
   * @param {function} onProgress - Callback(samplesTaken, totalSamples, currentAccuracy)
   * @returns {Promise<{lat, lng, accuracy, samples, avgAccuracy}>}
   */
  async averagePosition(samples = 10, intervalMs = 1500, onProgress = null) {
    return new Promise((resolve, reject) => {
      const readings = [];
      let watchId = null;
      let timeoutId = null;
      const maxWait = (samples * intervalMs) + 15000; // timeout total

      // Filtro: solo aceptar lecturas con accuracy < 20m
      const maxAcceptableAccuracy = 20;

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const acc = pos.coords.accuracy;

          // Solo aceptar lecturas con buena precisión
          if (acc <= maxAcceptableAccuracy) {
            readings.push({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: acc,
              altitude: pos.coords.altitude,
              timestamp: pos.timestamp
            });

            if (onProgress) {
              onProgress(readings.length, samples, acc);
            }
          }

          if (readings.length >= samples) {
            navigator.geolocation.clearWatch(watchId);
            clearTimeout(timeoutId);

            // Calcular promedio ponderado por inverso de accuracy
            // (lecturas más precisas pesan más)
            let totalWeight = 0;
            let wLat = 0, wLng = 0, wAlt = 0;
            let bestAcc = Infinity;

            for (const r of readings) {
              const weight = 1 / (r.accuracy * r.accuracy); // peso cuadrático inverso
              totalWeight += weight;
              wLat += r.lat * weight;
              wLng += r.lng * weight;
              if (r.altitude !== null) wAlt += r.altitude * weight;
              if (r.accuracy < bestAcc) bestAcc = r.accuracy;
            }

            const avgLat = wLat / totalWeight;
            const avgLng = wLng / totalWeight;
            const avgAlt = wAlt / totalWeight;

            // Calcular dispersión real de las lecturas (desvío estándar en metros)
            let sumSqDist = 0;
            for (const r of readings) {
              const d = this.distanceTo(avgLat, avgLng, r.lat, r.lng);
              sumSqDist += d * d;
            }
            const stdDev = Math.sqrt(sumSqDist / readings.length);

            // Precisión estimada: mejor entre el desvío y la mejor accuracy reportada
            const estimatedAccuracy = Math.min(stdDev, bestAcc);
            const avgReportedAcc = readings.reduce((s, r) => s + r.accuracy, 0) / readings.length;

            resolve({
              lat: avgLat,
              lng: avgLng,
              altitude: avgAlt,
              accuracy: Math.round(estimatedAccuracy * 100) / 100,
              avgReportedAccuracy: Math.round(avgReportedAcc * 100) / 100,
              bestAccuracy: Math.round(bestAcc * 100) / 100,
              stdDevMeters: Math.round(stdDev * 100) / 100,
              samples: readings.length,
              durationMs: readings[readings.length - 1].timestamp - readings[0].timestamp
            });
          }
        },
        (err) => {
          if (watchId) navigator.geolocation.clearWatch(watchId);
          clearTimeout(timeoutId);
          // Si tenemos al menos 3 lecturas, usamos lo que hay
          if (readings.length >= 3) {
            let totalWeight = 0, wLat = 0, wLng = 0;
            for (const r of readings) {
              const w = 1 / (r.accuracy * r.accuracy);
              totalWeight += w; wLat += r.lat * w; wLng += r.lng * w;
            }
            resolve({
              lat: wLat / totalWeight,
              lng: wLng / totalWeight,
              accuracy: readings.reduce((s, r) => s + r.accuracy, 0) / readings.length,
              samples: readings.length,
              partial: true
            });
          } else {
            reject(new Error('GPS: no se pudieron obtener suficientes lecturas'));
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,       // Forzar lecturas frescas
          timeout: 10000
        }
      );

      // Timeout global
      timeoutId = setTimeout(() => {
        navigator.geolocation.clearWatch(watchId);
        if (readings.length >= 3) {
          let totalWeight = 0, wLat = 0, wLng = 0;
          for (const r of readings) {
            const w = 1 / (r.accuracy * r.accuracy);
            totalWeight += w; wLat += r.lat * w; wLng += r.lng * w;
          }
          resolve({
            lat: wLat / totalWeight,
            lng: wLng / totalWeight,
            accuracy: readings.reduce((s, r) => s + r.accuracy, 0) / readings.length,
            samples: readings.length,
            partial: true
          });
        } else {
          reject(new Error('GPS timeout: precisión insuficiente'));
        }
      }, maxWait);
    });
  }

  // Precisión del GPS actual en texto legible
  getAccuracyLabel() {
    if (!this.accuracy) return 'Sin señal';
    if (this.accuracy <= 2) return `⭐ Excelente (${this.accuracy.toFixed(1)}m)`;
    if (this.accuracy <= 5) return `✅ Buena (${this.accuracy.toFixed(1)}m)`;
    if (this.accuracy <= 10) return `⚠️ Aceptable (${this.accuracy.toFixed(1)}m)`;
    if (this.accuracy <= 20) return `⚠️ Baja (${this.accuracy.toFixed(1)}m)`;
    return `❌ Mala (${this.accuracy.toFixed(0)}m) - esperá mejor señal`;
  }

  // Indicador de calidad GPS (0-100)
  getGPSQuality() {
    if (!this.accuracy) return 0;
    if (this.accuracy <= 1) return 100;
    if (this.accuracy <= 3) return 90;
    if (this.accuracy <= 5) return 75;
    if (this.accuracy <= 10) return 50;
    if (this.accuracy <= 20) return 25;
    return 10;
  }
}

const gpsNav = new GPSNavigator();
