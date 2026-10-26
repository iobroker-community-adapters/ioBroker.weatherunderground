const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const http = require('node:http');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup({
    apiKey = '0123456789abcdef0123456789abcdef',
    objectFailure = false,
    objectPending = false,
    schedule = '0 * * * *',
    honorAbort = true,
    httpClient = null,
    migration = null,
    currentUrl = 'https://api.weather.com/test/current',
} = {}) {
    const handlers = {};
    const timers = new Map();
    const delays = new Set();
    const requests = [];
    const terminated = [];
    const errors = [];
    const warnings = [];
    const schedules = [];
    let stopped = 0;
    let initialized = 0;
    let timerId = 0;
    let unloaded = false;
    let finishObject;
    const checksum = crypto.createHash('md5').update('test-location').digest('hex');
    const states = {
        currentWebKey: 'synthetic-web-key',
        currentObservationUrl: currentUrl,
        forecastDailyUrl: 'https://api.weather.com/test/daily',
        forecastHourlyUrl: 'https://api.weather.com/test/hourly',
        locationChecksum: checksum,
    };
    const adapter = {
        namespace: 'weatherunderground.0',
        config: {
            apiKey,
            location: 'test-location',
            station: '',
            current: objectFailure || objectPending,
            forecast_periods: false,
            forecast_periods_txt: false,
            forecast_hourly: false,
        },
        on: (event, handler) => {
            handlers[event] =
                event === 'unload'
                    ? callback => {
                          unloaded = true;
                          // The controller clears delay timers without resolving their promises on unload.
                          for (const id of delays) {
                              timers.delete(id);
                          }
                          delays.clear();
                          handler(callback);
                      }
                    : handler;
        },
        log: { debug() {}, info() {}, error: message => errors.push(message), warn: message => warnings.push(message) },
        terminate: code => {
            terminated.push(code);
            handlers.unload(() => {});
        },
        stop: () => {
            stopped++;
            handlers.unload(() => {});
        },
        setTimeout: (fn, ms) => {
            const id = ++timerId;
            timers.set(id, { fn, ms });
            return id;
        },
        clearTimeout: id => timers.delete(id),
        delay: ms =>
            new Promise(resolve => {
                const id = adapter.setTimeout(() => {
                    delays.delete(id);
                    if (!unloaded) {
                        resolve();
                    }
                }, ms);
                delays.add(id);
            }),
        getForeignObjectAsync: async () => ({ common: { schedule } }),
        setForeignObjectAsync: async (id, object) => schedules.push([id, object.common.schedule]),
        setObjectNotExistsAsync: async () => {
            initialized++;
            if (objectFailure) {
                throw new Error('synthetic object DB failure');
            }
            if (objectPending && initialized === 1) {
                await new Promise(resolve => {
                    finishObject = resolve;
                });
            }
        },
        getState: (id, cb) => cb(null, { val: states[id] }),
    };
    const axios = {
        get: (url, options) =>
            new Promise((resolve, reject) => {
                requests.push({ url, options, resolve, reject });
                if (honorAbort) {
                    options.signal?.addEventListener('abort', () => reject({ code: 'ERR_CANCELED' }), { once: true });
                }
            }),
    };
    const factory = vm.runInNewContext(`${source}\nmodule.exports;`, {
        require: name => {
            if (name === '@iobroker/adapter-core') {
                return {
                    Adapter: function () {
                        return adapter;
                    },
                };
            }
            if (name === './lib/migrate-api-key') {
                return migration || (async () => false);
            }
            if (name === 'axios') {
                return httpClient || axios;
            }
            return adapterRequire(name);
        },
        module: { parent: true, exports: {} },
        AbortController,
        setImmediate,
    });
    factory();
    return {
        adapter,
        handlers,
        timers,
        requests,
        terminated,
        errors,
        warnings,
        schedules,
        get stopped() {
            return stopped;
        },
        get initialized() {
            return initialized;
        },
        finishObject: () => finishObject(),
        fire: ms => {
            const entry = [...timers].find(([, timer]) => timer.ms === ms);
            assert.ok(entry, `expected ${ms} ms timer`);
            timers.delete(entry[0]);
            entry[1].fn();
        },
    };
}

describe('scheduled termination (#224)', () => {
    it('terminates object initialization errors without an unhandled rejection or requests', async () => {
        const run = setup({ objectFailure: true });
        await run.handlers.ready();
        assert.deepEqual(run.terminated, [1]);
        assert.equal(run.requests.length, 0);
        assert.equal(run.timers.size, 0);
        assert.match(run.errors[0], /synthetic object DB failure/);
    });

    it('arms the 60 second watchdog before awaiting object initialization', async () => {
        const run = setup({ objectPending: true });
        const ready = run.handlers.ready();
        await flush();
        run.fire(60000);
        run.finishObject();
        await ready;
        assert.deepEqual(run.terminated, [0]);
        assert.equal(run.timers.size, 0);
        assert.equal(run.requests.length, 0);
    });

    it('unloads during the randomized startup delay without starting work', async () => {
        const run = setup({ apiKey: '' });
        run.handlers.ready();
        await flush();
        assert.equal(run.timers.size, 1);
        let unloaded = false;
        run.handlers.unload(() => {
            unloaded = true;
        });
        assert.equal(unloaded, true);
        assert.equal(run.timers.size, 0);
        await flush();
        assert.equal(run.initialized, 0);
        assert.equal(run.requests.length, 0);
        assert.equal(run.terminated.length, 0);
    });

    it('does not start work if a startup delay resolves after unload', async () => {
        const run = setup({ apiKey: '' });
        const { promise, resolve } = Promise.withResolvers();
        run.adapter.delay = () => promise;
        const ready = run.handlers.ready();
        await flush();
        run.handlers.unload(() => {});
        resolve();
        await ready;
        assert.equal(run.initialized, 0);
        assert.equal(run.requests.length, 0);
        assert.equal(run.timers.size, 0);
    });

    for (const schedule of ['0 * * * *', '12 * * * *']) {
        it(`does not adjust schedule or create a delay after unload during schedule read (${schedule})`, async () => {
            const run = setup({ apiKey: '' });
            const { promise, resolve: finishRead } = Promise.withResolvers();
            run.adapter.getForeignObjectAsync = () => promise;
            const ready = run.handlers.ready();
            await flush();
            run.handlers.unload(() => {});
            finishRead({ common: { schedule } });
            await flush();
            assert.equal(run.timers.size, 0);
            await ready;
            assert.equal(run.schedules.length, 0);
            assert.equal(run.requests.length, 0);
            assert.deepEqual(run.terminated, []);
        });
    }

    it('does not resume startup after unload during key migration', async () => {
        const { promise, resolve: finishMigration } = Promise.withResolvers();
        const run = setup({
            migration: () => promise,
        });
        const ready = run.handlers.ready();
        run.handlers.unload(() => {});
        finishMigration(false);
        await ready;
        assert.equal(run.timers.size, 0);
        assert.equal(run.requests.length, 0);
        assert.deepEqual(run.terminated, []);
    });

    it('continues after the startup delay expires normally', async () => {
        const run = setup({ apiKey: '' });
        const ready = run.handlers.ready();
        await flush();
        const delay = [...run.timers.values()][0].ms;
        assert.ok(delay >= 0 && delay < 30000);
        run.fire(delay);
        await ready;
        assert.equal(run.requests.length, 1);
        run.handlers.unload(() => {});
        await flush();
        assert.equal(run.timers.size, 0);
    });

    it('preserves default schedule spreading and ends before requesting weather', async () => {
        const run = setup({ apiKey: '', schedule: '12 * * * *' });
        await run.handlers.ready();
        assert.equal(run.schedules.length, 1);
        assert.match(run.schedules[0][1], /^(?:[0-9]|[1-5][0-9]) \* \* \* \*$/);
        assert.deepEqual(run.terminated, [0]);
        assert.equal(run.requests.length, 0);
        assert.equal(run.timers.size, 0);
    });

    for (const response of ['success', '204', 'network error']) {
        it(`stops normally after ${response} and clears the watchdog`, async () => {
            const run = setup();
            await run.handlers.ready();
            assert.equal(run.requests.length, 1);
            const request = run.requests[0];
            assert.equal(request.options.timeout, 15000);
            if (response === 'success') {
                request.resolve({ data: { observations: [] } });
            } else {
                request.reject(response === '204' ? { response: { status: 204 } } : { code: 'ECONNRESET' });
            }
            await flush();
            assert.equal(run.timers.size, 1);
            run.fire(2000);
            assert.equal(run.stopped, 1);
            assert.deepEqual(run.terminated, []);
            assert.equal(run.timers.size, 0);
            assert.equal(run.warnings.length, 0);
        });
    }

    for (const exit of ['unload', 'watchdog']) {
        it(`aborts pending HTTP on ${exit} without retrying or scheduling a new stop`, async () => {
            const run = setup();
            await run.handlers.ready();
            const request = run.requests[0];
            if (exit === 'unload') {
                run.handlers.unload(() => {});
            } else {
                run.fire(60000);
            }
            assert.equal(request.options.signal?.aborted, true);
            await flush();
            assert.equal(run.requests.length, 1);
            assert.equal(run.timers.size, 0);
            assert.equal(run.errors.length, 0);
            assert.deepEqual(run.terminated, exit === 'watchdog' ? [0] : []);
        });
    }

    it('retains active 401 recovery and remains bounded by the watchdog', async () => {
        const run = setup();
        await run.handlers.ready();
        run.requests[0].reject({ response: { status: 401 } });
        await flush();
        await flush();
        assert.equal(run.requests.length, 2);
        assert.equal(run.requests[1].url, run.requests[0].url);
        run.requests[1].reject({ response: { status: 401 } });
        await flush();
        await flush();
        assert.equal(run.requests.length, 3);
        assert.match(run.requests[2].url, /www\.wunderground\.com/);
        run.fire(60000);
        await flush();
        assert.equal(run.timers.size, 0);
        assert.deepEqual(run.terminated, [0]);
    });

    it('ignores late successful data after unload', async () => {
        const run = setup({ honorAbort: false });
        await run.handlers.ready();
        run.handlers.unload(() => {});
        run.requests[0].resolve({ data: { observations: [] } });
        await flush();
        assert.equal(run.timers.size, 0);
        assert.equal(run.requests.length, 1);
        assert.equal(run.stopped, 0);
    });

    it('ignores a late 401 response after unload', async () => {
        const run = setup({ honorAbort: false });
        await run.handlers.ready();
        run.handlers.unload(() => {});
        run.requests[0].reject({ response: { status: 401 } });
        await flush();
        assert.equal(run.requests.length, 1);
        assert.equal(run.errors.length, 0);
        assert.equal(run.timers.size, 0);
    });

    it('closes a pending local HTTP connection on unload using installed Axios', async () => {
        let received;
        let closed;
        const requestReceived = new Promise(resolve => {
            received = resolve;
        });
        const responseClosed = new Promise(resolve => {
            closed = resolve;
        });
        const server = http.createServer((request, response) => {
            response.on('close', closed);
            received();
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)));
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const run = setup({
            httpClient: adapterRequire('axios'),
            currentUrl: `http://127.0.0.1:${address.port}/observations`,
        });
        try {
            await run.handlers.ready();
            await requestReceived;
            run.handlers.unload(() => {});
            await responseClosed;
            await flush();
            assert.equal(run.timers.size, 0);
            assert.equal(run.errors.length, 0);
            assert.equal(run.stopped, 0);
        } finally {
            run.handlers.unload(() => {});
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    });
});
