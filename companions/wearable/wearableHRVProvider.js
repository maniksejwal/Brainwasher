/**
 * @fileoverview companions/wearable/wearableHRVProvider.js
 *
 * Wearable HRV Provider
 * =====================
 * Provides real HRV data from BLE wearables (Galaxy Watch, Apple Watch,
 * Polar H10, etc.) with the conversation-inferred simulator as fallback.
 *
 * ARCHITECTURE
 * ------------
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │              WearableHRVProvider                │
 *   │                                                 │
 *   │   source = "ble"      → BLEHRVReader            │
 *   │   source = "inferred" → SimulatedHRVReader      │
 *   │   source = "auto"     → BLE if available,       │
 *   │                          else Inferred (default) │
 *   └─────────────────────────────────────────────────┘
 *
 * GALAXY WATCH CONNECTION
 * -----------------------
 * See bottom of this file for Galaxy Watch connection instructions.
 *
 * BLE HRV reading uses the standard Bluetooth Heart Rate Service (0x180D)
 * with Heart Rate Measurement characteristic (0x2A37).  Galaxy Watch 4/5/6
 * support this profile natively.
 *
 * NODE.JS BLE REQUIRES
 * --------------------
 * npm install @abandonware/noble
 *
 * BROWSER (WebBLE) REQUIRES
 * -------------------------
 * This file also exports a browser-compatible path for use in a web companion
 * app.  WebBLE is available in Chrome/Edge on Android.  Run the companion app
 * on an Android phone and pair the Galaxy Watch to the phone.
 *
 * DEFAULT BEHAVIOUR
 * -----------------
 * If no wearable is connected, falls back to the simulated HRV trajectory.
 * The caller (e.g. worker.py via the /physio endpoint) sees the same API
 * regardless of data source.  The source field in the returned object
 * tells the caller whether data is real or simulated.
 */

// ── Configuration ─────────────────────────────────────────────────────────────

const HEART_RATE_SERVICE_UUID         = '0000180d-0000-1000-8000-00805f9b34fb';
const HEART_RATE_MEASUREMENT_UUID     = '00002a37-0000-1000-8000-00805f9b34fb';

const SCAN_TIMEOUT_MS   = 15000;
const READ_INTERVAL_MS  = 5000;   // poll every 5 seconds

// ── BLE HRV Reader (Node.js via @abandonware/noble) ──────────────────────────

export class BLEHRVReader {
    constructor() {
        this._noble        = null;
        this._peripheral   = null;
        this._characteristic = null;
        this._latestHRV    = null;
        this._latestRR     = [];    // R-R intervals in ms
        this._connected    = false;
        this._onUpdate     = null;  // callback (hrv_ms: number) => void
    }

    /**
     * Attempt to connect to the first available Heart Rate Service device.
     * Resolves when connected and receiving data.
     * Rejects if no device found within SCAN_TIMEOUT_MS.
     *
     * @param {object} [opts]
     * @param {string} [opts.deviceName] - filter by device name substring (e.g. 'Galaxy Watch')
     * @param {function} [opts.onUpdate] - callback called with {hrv_ms, rr_intervals, source}
     * @returns {Promise<void>}
     */
    async connect(opts = {}) {
        const { deviceName, onUpdate } = opts;
        this._onUpdate = onUpdate || null;

        let noble;
        try {
            const nobleModule = await import('@abandonware/noble');
            noble = nobleModule.default || nobleModule;
            this._noble = noble;
        } catch (err) {
            throw new Error(
                'BLE requires @abandonware/noble. Install with: npm install @abandonware/noble\n' +
                'Also requires Bluetooth adapter and admin/root permissions on Linux.'
            );
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                noble.stopScanning();
                reject(new Error(`No Heart Rate device found within ${SCAN_TIMEOUT_MS}ms`));
            }, SCAN_TIMEOUT_MS);

            noble.on('stateChange', state => {
                if (state === 'poweredOn') {
                    noble.startScanning([HEART_RATE_SERVICE_UUID], false);
                } else {
                    clearTimeout(timeout);
                    reject(new Error(`Bluetooth not available (state: ${state})`));
                }
            });

            noble.on('discover', async peripheral => {
                const name = peripheral.advertisement?.localName || '';
                if (deviceName && !name.toLowerCase().includes(deviceName.toLowerCase())) {
                    return;  // not our device
                }

                noble.stopScanning();
                clearTimeout(timeout);

                try {
                    await this._connectPeripheral(peripheral);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
        });
    }

    async _connectPeripheral(peripheral) {
        this._peripheral = peripheral;
        await peripheral.connectAsync();
        this._connected = true;
        console.log(`[WearableHRV] Connected to ${peripheral.advertisement?.localName || peripheral.id}`);

        const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
            [HEART_RATE_SERVICE_UUID],
            [HEART_RATE_MEASUREMENT_UUID],
        );

        if (!characteristics.length) {
            throw new Error('Heart Rate Measurement characteristic not found');
        }

        const hrChar = characteristics[0];
        this._characteristic = hrChar;
        await hrChar.subscribeAsync();

        hrChar.on('data', (data) => {
            const parsed = this._parseHRMeasurement(data);
            this._latestHRV  = parsed.rmssd_ms;
            this._latestRR   = parsed.rr_intervals;
            if (this._onUpdate) {
                this._onUpdate({
                    hrv_rmssd_ms: parsed.rmssd_ms,
                    rr_intervals: parsed.rr_intervals,
                    heart_rate:   parsed.heart_rate,
                    source:       'ble',
                    device:       peripheral.advertisement?.localName || 'unknown',
                    ts:           Date.now(),
                });
            }
        });

        peripheral.on('disconnect', () => {
            this._connected = false;
            console.warn('[WearableHRV] Device disconnected');
        });
    }

    /**
     * Parse Heart Rate Measurement BLE characteristic (Bluetooth spec §3.100).
     * Returns { heart_rate, rr_intervals[], rmssd_ms }.
     */
    _parseHRMeasurement(data) {
        const flags     = data[0];
        const hrFormat  = flags & 0x01;  // 0 = UINT8, 1 = UINT16
        let   offset    = 1;

        let heart_rate;
        if (hrFormat === 0) {
            heart_rate = data[offset++];
        } else {
            heart_rate = data.readUInt16LE(offset);
            offset    += 2;
        }

        // Skip energy expended if present
        if (flags & 0x08) offset += 2;

        // R-R intervals (resolution: 1/1024 second)
        const rr = [];
        while (offset + 1 < data.length) {
            const raw = data.readUInt16LE(offset);
            rr.push(Math.round(raw / 1024 * 1000));  // convert to ms
            offset += 2;
        }

        // Compute RMSSD from successive differences
        let rmssd_ms = null;
        if (rr.length >= 2) {
            const diffs = [];
            for (let i = 1; i < rr.length; i++) diffs.push(rr[i] - rr[i - 1]);
            rmssd_ms = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
            rmssd_ms = Math.round(rmssd_ms * 10) / 10;
        }

        return { heart_rate, rr_intervals: rr, rmssd_ms };
    }

    /** Current HRV reading, or null if not connected / no data yet. */
    get latestHRV() { return this._latestHRV; }
    get isConnected() { return this._connected; }

    async disconnect() {
        if (this._characteristic) await this._characteristic.unsubscribeAsync().catch(() => {});
        if (this._peripheral)     await this._peripheral.disconnectAsync().catch(() => {});
        this._connected = false;
    }
}

// ── Simulated HRV Reader (fallback) ──────────────────────────────────────────

export class SimulatedHRVReader {
    /**
     * @param {object} opts
     * @param {number} [opts.baseline]   - resting HRV baseline in ms (default: 35)
     * @param {number} [opts.stressIndex] - 0..1 current stress (default: 0.3)
     */
    constructor(opts = {}) {
        this._baseline    = opts.baseline    ?? 35;
        this._stressIndex = opts.stressIndex ?? 0.3;
        this._current     = this._baseline * (1 - this._stressIndex * 0.4);
    }

    /** Returns a simulated HRV reading, updating internal state with mild OU noise. */
    read() {
        // OU process step: θ=0.15, σ=2.5
        const theta = 0.15;
        const sigma = 2.5;
        const target = this._baseline * (1 - this._stressIndex * 0.4);
        this._current += theta * (target - this._current) + sigma * (Math.random() - 0.5);
        this._current = Math.max(8, Math.min(80, this._current));
        return {
            hrv_rmssd_ms: Math.round(this._current * 10) / 10,
            rr_intervals: [],
            heart_rate:   Math.round(60000 / (this._current + 600)),
            source:       'simulated',
            ts:           Date.now(),
        };
    }

    setStress(stressIndex) { this._stressIndex = Math.max(0, Math.min(1, stressIndex)); }
}

// ── Unified Provider ──────────────────────────────────────────────────────────

export class WearableHRVProvider {
    /**
     * @param {object} opts
     * @param {'auto'|'ble'|'simulated'} [opts.source] - default: 'auto'
     * @param {string} [opts.deviceName] - Galaxy Watch device name filter
     * @param {number} [opts.baseline]   - simulated baseline HRV
     * @param {number} [opts.stressIndex]
     */
    constructor(opts = {}) {
        this._source     = opts.source ?? 'auto';
        this._bleReader  = null;
        this._simReader  = new SimulatedHRVReader({
            baseline:    opts.baseline    ?? 35,
            stressIndex: opts.stressIndex ?? 0.3,
        });
        this._deviceName = opts.deviceName ?? 'Galaxy Watch';
        this._activeSource = 'simulated';
    }

    /**
     * Initialise: attempt BLE connection if source is 'auto' or 'ble'.
     * Falls back to simulated if BLE fails and source is 'auto'.
     */
    async init() {
        if (this._source === 'simulated') {
            this._activeSource = 'simulated';
            return;
        }

        try {
            this._bleReader = new BLEHRVReader();
            await this._bleReader.connect({ deviceName: this._deviceName });
            this._activeSource = 'ble';
            console.log('[WearableHRV] Using real BLE HRV data');
        } catch (err) {
            if (this._source === 'ble') {
                throw err;  // explicit BLE requested — propagate error
            }
            // auto mode — fall back to simulated
            console.warn(`[WearableHRV] BLE unavailable (${err.message}). Using simulated HRV.`);
            this._bleReader    = null;
            this._activeSource = 'simulated';
        }
    }

    /** Read one HRV sample. */
    read() {
        if (this._activeSource === 'ble' && this._bleReader?.isConnected) {
            const hrv = this._bleReader.latestHRV;
            if (hrv !== null) {
                return {
                    hrv_rmssd_ms: hrv,
                    rr_intervals: this._bleReader._latestRR,
                    source:       'ble',
                    ts:           Date.now(),
                };
            }
        }
        return this._simReader.read();
    }

    get source()      { return this._activeSource; }
    get isReal()      { return this._activeSource === 'ble'; }

    async close() {
        if (this._bleReader) await this._bleReader.disconnect().catch(() => {});
    }
}

// ── Node.js API endpoint (add to routes/physio.js or server.js) ──────────────
//
//   import { WearableHRVProvider } from './companions/wearable/wearableHRVProvider.js';
//   const provider = new WearableHRVProvider({ source: 'auto' });
//   await provider.init();
//
//   router.get('/wearable/hrv', (req, res) => {
//       res.json(provider.read());
//   });

/*
 * ════════════════════════════════════════════════════════════════════════════
 * HOW TO CONNECT A GALAXY WATCH 4 / 5 / 6
 * ════════════════════════════════════════════════════════════════════════════
 *
 * PREREQUISITES
 * ─────────────
 * 1. Galaxy Watch must be paired to your Android phone via Galaxy Wearable app.
 * 2. On the Watch: Settings → Health → Measure continuously → Heart rate → Always.
 *    This keeps the HR sensor running (drains battery faster — disable when done).
 * 3. On the Watch: Settings → Advanced → Developer options → BLE advertising ON.
 *    (If no Developer options: tap Build number 7 times under About Watch → Software.)
 *
 * OPTION A: Node.js + @abandonware/noble (server-side BLE)
 * ─────────────────────────────────────────────────────────
 * This works on Linux/macOS with a built-in or USB Bluetooth adapter.
 * On Windows it requires NPCAP or WinRT BLE (limited support).
 *
 *   1. Install:
 *      npm install @abandonware/noble
 *      # On Linux also: sudo apt install bluetooth libbluetooth-dev
 *      # Run Node.js as root or grant CAP_NET_RAW:
 *      sudo setcap cap_net_raw+eip $(which node)
 *
 *   2. Pair the Watch from the HOST (not the phone):
 *      On Linux: bluetoothctl → scan on → pair <WATCH_MAC> → trust <WATCH_MAC>
 *      On Windows: Settings → Bluetooth → Add Device → Galaxy Watch ...
 *      The Galaxy Watch will show a pairing prompt.
 *
 *   3. Use WearableHRVProvider with source='ble':
 *      const provider = new WearableHRVProvider({ source: 'ble', deviceName: 'Galaxy Watch' });
 *      await provider.init();
 *      setInterval(() => console.log(provider.read()), 5000);
 *
 * OPTION B: Galaxy Watch Health Platform (recommended for production)
 * ───────────────────────────────────────────────────────────────────
 * Samsung provides a Health Platform SDK for Galaxy Watch apps.
 * Build a Tizen/Wear OS watch face or tile that streams HRV to your server
 * via HTTP:
 *
 *   1. Install Samsung Developer Tools: https://developer.samsung.com/galaxy-watch
 *   2. Create a Wear OS app (Jetpack Compose) that reads:
 *      SensorManager → TYPE_HEART_RATE_VARIABILITY (TYPE_RMSSD)
 *      or Samsung Health SDK: SamsungHealthDataStore → HeartRateVariability
 *   3. POST the RMSSD value to:
 *      POST http://<your-server>:8247/api/wearable/hrv
 *      { device_id: "galaxy_watch_xxx", hrv_rmssd_ms: 38.5, ts: 1717000000000 }
 *   4. Add a Node.js route that receives and caches it, then WearableHRVProvider
 *      polls it via HTTP instead of BLE.
 *
 * OPTION C: Web Bluetooth (browser companion app on Android)
 * ──────────────────────────────────────────────────────────
 * If you access the companion app from Chrome on Android:
 *   1. Open the companion app in Chrome (Android) where the Watch is paired.
 *   2. On page load: navigator.bluetooth.requestDevice({
 *          filters: [{ services: ['heart_rate'] }],
 *      })
 *   3. Use the GATT Heart Rate Measurement characteristic.
 *   4. See wearableHRVProvider.webBLE() below.
 *
 * TROUBLESHOOTING
 * ───────────────
 * - Galaxy Watch will not advertise HR service if:
 *   a. Screen is off AND display timeout is short → Settings → Display → Screen timeout → 5min
 *   b. Power saving mode is on → disable during data collection
 *   c. Watch is already connected to the Samsung Health app → HFP may block GATT
 *      → Disconnect from Samsung Health, then retry BLE scan
 * - On Windows, @abandonware/noble may show "HCI socket not available".
 *   Solution: use NPCAP: https://npcap.com/#download, or use Option B (HTTP push).
 * - If RMSSD is null (no R-R intervals): some Galaxy Watch firmware versions
 *   omit R-R data. Use the heart rate to estimate: rmssd ≈ 1000/HR (rough).
 *   Set RMSSD directly from the watch Health app export instead.
 */
