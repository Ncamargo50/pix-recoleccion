// GPS Navigation Module for PIX Muestreo v2.0
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

    // Kalman filter state for position smoothing
    this.kalman = { lat: null, lng: null, variance: 1, processNoise: 0.0001, initialized: false };

    // GPS warm-up detection
    this.warmupReadings = [];
    this.isWarmedUp = false;
    this.warmupThreshold = 5; // need 5 readings under 10m accuracy

    // Position stabilization detection
    this.recentPositions = []; // last 10 positions
    this.isStabilized = false;

    // Wake Lock for background GPS (prevents screen/CPU sleep)
    this._wakeLock = null;
    this._webLock = null;
  }

  // Request Wake Lock to keep GPS active with screen off
  async requestWakeLock() {
    // Screen Wake Lock API
    if ('wakeLock' in navigator) {
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => {
          console.log('[GPS] Wake lock released');
          // Re-acquire on visibility change
          if (this.isTracking) this._reacquireWakeLock();
        });
        console.log('[GPS] Wake lock acquired');
      } catch (e) { console.log('[GPS] Wake lock failed:', e.message); }
    }
    // Web Locks API (keeps service worker alive)
    if ('locks' in navigator) {
      try {
        navigator.locks.request('pix-gps-tracking', { mode: 'exclusive' }, () => {
          return new Promise(resolve => { this._webLock = resolve; });
        });
        console.log('[GPS] Web lock acquired');
      } catch (e) { console.log('[GPS] Web lock failed:', e.message); }
    }
  }

  async _reacquireWakeLock() {
    if (document.visibilityState === 'visible' && this.isTracking) {
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
        console.log('[GPS] Wake lock re-acquired');
      } catch (e) { /* silently fail */ }
    }
  }

  releaseWakeLock() {
    if (this._wakeLock) { try { this._wakeLock.release(); } catch(e){} this._wakeLock = null; }
    if (this._webLock) { this._webLock(); this._webLock = null; }
    console.log('[GPS] All locks released');
  }

  // Start watching position
  startWatch(callback) {
    if (!navigator.geolocation) {
      throw new Error('GPS no disponible en este dispositivo');
    }

    this.onPositionUpdate = callback;

    // Re-acquire wake lock when app comes back to foreground
    document.addEventListener('visibilitychange', () => this._reacquireWakeLock());

    this.watchId = navigator.geolocation.watchPosition(
      pos => {
        // Check GPS warm-up status
        this._checkWarmup(pos.coords.accuracy);

        // Apply Kalman filter for position smoothing
        const smoothed = this._kalmanUpdate(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          pos.coords.accuracy
        );

        this.currentPosition = {
          lat: smoothed.lat,
          lng: smoothed.lng,
          accuracy: pos.coords.accuracy, // keep raw accuracy for display
          altitude: pos.coords.altitude,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          timestamp: pos.timestamp,
          raw: { lat: pos.coords.latitude, lng: pos.coords.longitude }
        };
        this.accuracy = pos.coords.accuracy;

        // Check position stabilization using RAW (unfiltered) positions
        this._checkStabilization(pos.coords.latitude, pos.coords.longitude);

        // Record track (circular buffer, max 10000 positions to prevent memory growth)
        if (this.isTracking) {
          if (this.trackPositions.length >= 10000) {
            this.trackPositions.shift();
          }
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
        maximumAge: 0,       // Force fresh readings for max precision
        timeout: 15000       // More time for better fix
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

            // ── Outlier rejection: reject readings >2 std deviations from median ──
            const sortedLats = readings.map(r => r.lat).sort((a, b) => a - b);
            const sortedLngs = readings.map(r => r.lng).sort((a, b) => a - b);
            const medianLat = sortedLats[Math.floor(sortedLats.length / 2)];
            const medianLng = sortedLngs[Math.floor(sortedLngs.length / 2)];

            // Compute distances from median and standard deviation
            const distsFromMedian = readings.map(r => this.distanceTo(medianLat, medianLng, r.lat, r.lng));
            const meanDist = distsFromMedian.reduce((s, d) => s + d, 0) / distsFromMedian.length;
            const distStdDev = Math.sqrt(distsFromMedian.reduce((s, d) => s + (d - meanDist) ** 2, 0) / distsFromMedian.length);
            const outlierThreshold = meanDist + 2 * distStdDev;

            // Filter out outliers (keep at least 3 readings)
            let filtered = readings.filter((r, i) => distsFromMedian[i] <= outlierThreshold);
            if (filtered.length < 3) filtered = readings; // fallback if too aggressive

            // Calcular promedio ponderado por inverso de accuracy
            // (lecturas más precisas pesan más)
            let totalWeight = 0;
            let wLat = 0, wLng = 0, wAlt = 0;
            let bestAcc = Infinity;

            for (const r of filtered) {
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

            // Calcular dispersión real de las lecturas filtradas (desvío estándar en metros)
            let sumSqDist = 0;
            for (const r of filtered) {
              const d = this.distanceTo(avgLat, avgLng, r.lat, r.lng);
              sumSqDist += d * d;
            }
            const stdDev = Math.sqrt(sumSqDist / filtered.length);

            // Precisión estimada: mejor entre el desvío y la mejor accuracy reportada
            const estimatedAccuracy = Math.min(stdDev, bestAcc);
            const avgReportedAcc = filtered.reduce((s, r) => s + r.accuracy, 0) / filtered.length;

            resolve({
              lat: avgLat,
              lng: avgLng,
              altitude: avgAlt,
              accuracy: Math.round(estimatedAccuracy * 100) / 100,
              avgReportedAccuracy: Math.round(avgReportedAcc * 100) / 100,
              bestAccuracy: Math.round(bestAcc * 100) / 100,
              stdDevMeters: Math.round(stdDev * 100) / 100,
              samples: readings.length,
              samplesUsed: filtered.length,
              outliersRejected: readings.length - filtered.length,
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
          timeout: 15000       // Más tiempo para mejor fix
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

  // ═══════════════════════════════════════════════════════════
  // KALMAN FILTER - Suavizado de posición en tiempo real
  // ═══════════════════════════════════════════════════════════

  /**
   * Aplica un filtro Kalman simplificado a una lectura GPS.
   * Suaviza el ruido de posición manteniendo respuesta rápida a movimientos reales.
   *
   * @param {{lat: number, lng: number}} measurement - Posición medida
   * @param {number} accuracy - Precisión reportada en metros
   * @returns {{lat: number, lng: number, accuracy: number}} Posición suavizada
   */
  _kalmanUpdate(measurement, accuracy) {
    if (!this.kalman.initialized) {
      this.kalman.lat = measurement.lat;
      this.kalman.lng = measurement.lng;
      this.kalman.variance = accuracy * accuracy;
      this.kalman.initialized = true;
      return { lat: measurement.lat, lng: measurement.lng, accuracy: accuracy };
    }

    // Predict step: variance increases with process noise
    this.kalman.variance += this.kalman.processNoise;

    // Update step: compute Kalman gain
    const measurementVariance = accuracy * accuracy;
    const kalmanGain = this.kalman.variance / (this.kalman.variance + measurementVariance);

    // Update estimate
    this.kalman.lat += kalmanGain * (measurement.lat - this.kalman.lat);
    this.kalman.lng += kalmanGain * (measurement.lng - this.kalman.lng);
    this.kalman.variance *= (1 - kalmanGain);

    return {
      lat: this.kalman.lat,
      lng: this.kalman.lng,
      accuracy: Math.sqrt(this.kalman.variance)
    };
  }

  // ═══════════════════════════════════════════════════════════
  // GPS WARM-UP DETECTION - Detecta cuando el GPS se estabiliza
  // ═══════════════════════════════════════════════════════════

  /**
   * Verifica si el GPS ya pasó el período de calentamiento.
   * El GPS necesita varias lecturas buenas consecutivas antes de ser confiable.
   *
   * @param {number} accuracy - Precisión de la lectura actual en metros
   */
  _checkWarmup(accuracy) {
    this.warmupReadings.push(accuracy);

    // Mantener solo las últimas 10 lecturas
    if (this.warmupReadings.length > 10) {
      this.warmupReadings.shift();
    }

    // Si las últimas 5 lecturas son todas < 10m → GPS calentado
    if (this.warmupReadings.length >= this.warmupThreshold) {
      const lastN = this.warmupReadings.slice(-this.warmupThreshold);
      this.isWarmedUp = lastN.every(a => a < 10);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // POSITION STABILIZATION - Detecta posición estable
  // ═══════════════════════════════════════════════════════════

  /**
   * Verifica si la posición GPS se ha estabilizado.
   * Las últimas 5 posiciones deben estar dentro de 2m entre sí.
   */
  _checkStabilization(rawLat, rawLng) {
    if (rawLat == null || rawLng == null) return;

    this.recentPositions.push({
      lat: rawLat,
      lng: rawLng,
      timestamp: Date.now()
    });

    // Mantener solo las últimas 10 posiciones
    if (this.recentPositions.length > 10) {
      this.recentPositions.shift();
    }

    // Verificar si las últimas 5 están dentro de 2m
    if (this.recentPositions.length >= 5) {
      const last5 = this.recentPositions.slice(-5);
      let maxSpread = 0;
      for (let i = 0; i < last5.length; i++) {
        for (let j = i + 1; j < last5.length; j++) {
          const d = this.distanceTo(last5[i].lat, last5[i].lng, last5[j].lat, last5[j].lng);
          if (d > maxSpread) maxSpread = d;
        }
      }
      this.isStabilized = maxSpread <= 2;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ACCURACY GATE - Control de calidad para recolección
  // ═══════════════════════════════════════════════════════════

  /**
   * Verifica si las condiciones GPS son suficientes para recolectar datos.
   *
   * @param {number} requiredAccuracy - Precisión mínima requerida en metros (default 5)
   * @returns {boolean} true si se puede recolectar
   */
  canCollect(requiredAccuracy = 5) {
    return this.isWarmedUp && this.accuracy !== null && this.accuracy <= requiredAccuracy;
  }

  /**
   * Devuelve el estado actual para recolección con mensaje y color.
   *
   * @param {number} requiredAccuracy - Precisión mínima requerida en metros (default 5)
   * @returns {{ok: boolean, msg: string, color: string}}
   */
  getCollectionStatus(requiredAccuracy = 5) {
    if (!this.accuracy) return { ok: false, msg: 'Sin señal GPS', color: '#F44336' };
    if (!this.isWarmedUp) return { ok: false, msg: 'GPS calentando...', color: '#FF9800' };
    if (this.accuracy > requiredAccuracy) return { ok: false, msg: `Precisión insuficiente (${this.accuracy.toFixed(1)}m > ${requiredAccuracy}m)`, color: '#FF9800' };
    return { ok: true, msg: `Listo (${this.accuracy.toFixed(1)}m)`, color: '#4CAF50' };
  }

  // ═══════════════════════════════════════════════════════════
  // HDOP ESTIMATION - Estimación de HDOP desde accuracy
  // ═══════════════════════════════════════════════════════════

  /**
   * Estima el HDOP (Horizontal Dilution of Precision) a partir de la precisión reportada.
   * La API web no expone HDOP directamente, pero accuracy ≈ HDOP * UERE (5m típico).
   *
   * @returns {number|null} HDOP estimado, o null si no hay señal
   */
  getEstimatedHDOP() {
    if (!this.accuracy) return null;
    return Math.round(this.accuracy / 5 * 10) / 10;
  }
}

const gpsNav = new GPSNavigator();
