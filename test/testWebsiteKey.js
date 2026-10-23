const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);
const key = '0123456789abcdef0123456789abcdef';

/**
 * @param {string} body Synthetic website HTML.
 * @param {boolean} [products] Fetch station and forecast products after discovery.
 */
function discover(body, products = false) {
    const requests = [];
    const states = {};
    const logs = [];
    return new Promise(resolve => {
        vm.runInNewContext(
            `${source}
            adapter = testAdapter;
            lang = 'de-DE';
            getWebsiteKey(() => {
                if (!testProducts) { testDone(); return; }
                getNewWuDataCurrentObservations(data =>
                    getNewWuDataDailyForecast(data, data =>
                        getNewWuDataHourlyForecast(data, testDone)));
            });`,
            {
                require: name => {
                    if (name === '@iobroker/adapter-core') {
                        return {};
                    }
                    if (name === 'axios') {
                        return {
                            get: async requested => {
                                requests.push(requested);
                                const url = new URL(requested);
                                if (url.hostname === 'www.wunderground.com') {
                                    return { data: body };
                                }
                                if (url.pathname === '/v2/pws/observations/current') {
                                    return { data: { observations: [{ lat: 51.4, lon: 6.7 }] } };
                                }
                                return { data: { dayOfWeek: ['Monday'], temperature: [8] } };
                            },
                        };
                    }
                    return adapterRequire(name);
                },
                module: { parent: true, exports: {} },
                testAdapter: {
                    config: {
                        station: 'TEST1',
                        location: 'Testville',
                        country: 'DE',
                        current: true,
                        forecast_periods: true,
                        forecast_hourly: true,
                    },
                    log: {
                        debug: message => logs.push(message),
                        info: message => logs.push(message),
                        error: message => logs.push(message),
                    },
                    setObjectNotExists: (id, object, callback) => callback(),
                    setState: (id, state) => {
                        states[id] = state.val;
                    },
                },
                testProducts: products,
                testDone: () => resolve({ requests, states, logs }),
            },
        );
    });
}

describe('website key discovery', () => {
    it('extracts the key from inline configuration with whitespace', async () => {
        const { states, logs } = await discover(
            `<script>const data = { "API_KEY" : "${key}", "API_URL":"https://api.weather.com" };</script>`,
        );
        assert.equal(states.currentWebKey, key);
        assert.ok(logs.every(message => !message.includes(key)));
    });

    for (const value of ['short', `${key}a`, `${key.slice(1)}-`]) {
        it(`rejects malformed inline key ${JSON.stringify(value)}`, async () => {
            const { states } = await discover(`{"API_KEY":"${value}"}`);
            assert.equal(Object.hasOwn(states, 'currentWebKey'), false);
        });
    }

    it('does not use the Mapbox key as the weather key', async () => {
        const { states } = await discover(`{"MAPBOX_API_KEY":"${key}"}`);
        assert.equal(Object.hasOwn(states, 'currentWebKey'), false);
    });

    it('uses an inline key for station and forecast requests without extracted product URLs', async () => {
        const { requests, logs } = await discover(`{"API_KEY":"${key}","API_URL":"https://api.weather.com"}`, true);
        const products = requests.slice(1).map(request => new URL(request));
        assert.deepEqual(
            products.map(url => url.pathname),
            ['/v2/pws/observations/current', '/v3/wx/forecast/daily/5day', '/v3/wx/forecast/hourly/2day'],
        );
        for (const url of products) {
            assert.equal(url.searchParams.get('apiKey'), key);
        }
        assert.equal(products[0].searchParams.get('stationId'), 'TEST1');
        for (const url of products.slice(1)) {
            assert.equal(url.searchParams.get('geocode'), '51.4,6.7');
        }
        assert.ok(logs.every(message => !message.includes(key)));
    });
});
