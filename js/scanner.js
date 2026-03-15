// QR/Barcode Scanner for Pixadvisor Coleta
class BarcodeScanner {
  constructor() {
    this.scanner = null;
    this.isScanning = false;
    this.onScanSuccess = null;
  }

  // Initialize scanner
  async init(containerId, onSuccess) {
    this.onScanSuccess = onSuccess;

    this.scanner = new Html5Qrcode(containerId);

    const config = {
      fps: 10,
      qrbox: { width: 280, height: 120 },
      aspectRatio: 1.777,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.DATA_MATRIX
      ]
    };

    try {
      await this.scanner.start(
        { facingMode: 'environment' },
        config,
        (decodedText, decodedResult) => {
          // Vibrate on success
          if (navigator.vibrate) navigator.vibrate(200);

          this.isScanning = true;
          if (this.onScanSuccess) {
            this.onScanSuccess(decodedText, decodedResult);
          }
        },
        () => {} // ignore errors during scan
      );
      this.isScanning = true;
    } catch (err) {
      console.error('Scanner init error:', err);
      throw err;
    }
  }

  // Stop scanning
  async stop() {
    if (this.scanner && this.isScanning) {
      try {
        await this.scanner.stop();
      } catch (e) {
        // ignore
      }
      this.isScanning = false;
    }
  }

  // Take photo using camera
  static async takePhoto() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';

      input.onchange = e => {
        const file = e.target.files[0];
        if (!file) { reject('No file'); return; }

        const reader = new FileReader();
        reader.onload = ev => {
          // Compress image
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxSize = 1200;
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
              if (w > h) { h = h * maxSize / w; w = maxSize; }
              else { w = w * maxSize / h; h = maxSize; }
            }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      };

      input.click();
    });
  }
}

const barcodeScanner = new BarcodeScanner();
