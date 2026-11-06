const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);
const key = '0123456789abcdef0123456789abcdef';
const placeId = 'abcdef0123456789'.repeat(4);

/**
 * @param {string | Error} body Synthetic website HTML or request failure.
 * @param {boolean} [products] Fetch station and forecast products after discovery.
 * @param {object} [config] Configuration overrides.
 * @param {string} [cachedObservationUrl] Previously stored observations URL.
 */
function discover(body, products = false, config = {}, cachedObservationUrl) {
    const requests = [];
    const states = {};
    const logs = [];
    const errors = [];
    return new Promise(resolve => {
        vm.runInNewContext(
            `${source}
            adapter = testAdapter;
            lang = 'de-DE';
            officialApiKey = adapter.config.apiKey;
            currentObservationUrl = testObservationUrl;
            parseNewResult = (_data, cb) => cb();
            if (testProducts) { getKeysAndData(testDone); }
            else { getWebsiteKey(testDone); }`,
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
                                    if (body instanceof Error) {
                                        throw body;
                                    }
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
                        ...config,
                    },
                    log: {
                        debug: message => logs.push(message),
                        info: message => logs.push(message),
                        error: message => {
                            logs.push(message);
                            errors.push(message);
                        },
                    },
                    setObjectNotExists: (id, object, callback) => callback(),
                    setState: (id, state) => {
                        states[id] = state.val;
                    },
                },
                testProducts: products,
                testObservationUrl: cachedObservationUrl,
                testDone: () => resolve({ requests, states, logs, errors }),
            },
        );
    });
}

describe('website key discovery', () => {
    for (const status of [404, 503]) {
        it(`reports a website HTTP ${status} once without cascading URL or data errors`, async () => {
            const failure = Object.assign(new Error('Synthetic website failure'), { response: { status } });
            const { requests, errors } = await discover(failure, true, { station: '' });
            assert.equal(requests.length, status === 404 ? 2 : 1);
            assert.equal(errors.length, 1);
        });
    }

    it('retains owner-key station requests when website discovery fails', async () => {
        const failure = Object.assign(new Error('Synthetic website failure'), { response: { status: 503 } });
        const { requests, errors } = await discover(failure, true, {
            apiKey: 'synthetic-owner-key',
            forecast_hourly: false,
        });
        assert.equal(requests.length, 3);
        for (const url of requests.slice(1)) {
            assert.equal(new URL(url).searchParams.get('apiKey'), 'synthetic-owner-key');
        }
        assert.equal(errors.length, 1);
    });

    for (const url of [undefined, '/relative', 'file:///tmp/weather']) {
        it(`stops with one actionable error without a station and with observations URL ${JSON.stringify(url)}`, async () => {
            const { requests, errors } = await discover(`{"API_KEY":"${key}"}`, true, { station: '' }, url);
            assert.equal(requests.length, 1);
            assert.equal(errors.length, 1);
            assert.ok(errors[0].includes('PWS station ID'));
        });
    }

    it('builds station and place forecasts from the current website location element', async () => {
        const body = `<script>{"API_KEY":"${key}"}</script>
            <location-fav-button-view data-placeid="${placeId}" data-coordinate="51.4,6.7" data-pwsid="TEST1"></location-fav-button-view>`;
        const { requests, errors, states, logs } = await discover(body, true, { station: '' });
        assert.equal(requests.length, 4);
        assert.equal(errors.length, 0);
        const products = requests.slice(1).map(url => new URL(url));
        assert.equal(products[0].pathname, '/v2/pws/observations/current');
        assert.equal(products[0].searchParams.get('stationId'), 'TEST1');
        assert.equal(products[0].searchParams.get('numericPrecision'), 'decimal');
        assert.equal(products[1].pathname, '/v3/wx/forecast/daily/5day');
        assert.equal(products[2].pathname, '/v3/wx/forecast/hourly/2day');
        for (const product of products.slice(1)) {
            assert.equal(product.searchParams.get('placeid'), placeId);
        }
        for (const product of products) {
            assert.equal(product.searchParams.get('apiKey'), key);
            assert.equal(product.searchParams.get('units'), 'm');
            assert.equal(product.searchParams.get('language'), 'de-DE');
        }
        assert.equal(states.currentObservationUrl, requests[1]);
        assert.equal(states.forecastDailyUrl, requests[2]);
        assert.equal(states.forecastHourlyUrl, requests[3]);
        assert.ok(logs.every(message => !message.includes(key)));
    });

    for (const attributes of [
        `data-pwsid="bad/id" data-placeid="${placeId}"`,
        'data-pwsid="TEST1" data-placeid="invalid"',
    ]) {
        it(`rejects malformed website station metadata ${attributes}`, async () => {
            const { requests, errors } = await discover(
                `{"API_KEY":"${key}"}<location-fav-button-view ${attributes}>`,
                true,
                { station: '' },
            );
            assert.equal(requests.length, 1);
            assert.equal(errors.length, 1);
        });
    }

    it('does not require forecast URLs when all forecasts are disabled', async () => {
        const { requests, errors } = await discover(
            `{"API_KEY":"${key}"}<location-fav-button-view data-pwsid="TEST1">`,
            true,
            { station: '', forecast_periods: false, forecast_periods_txt: false, forecast_hourly: false },
        );
        assert.equal(requests.length, 2);
        assert.equal(errors.length, 0);
    });

    it('retains location-only requests when the website provides valid product URLs', async () => {
        const urls = [
            'https://api.weather.com/v2/pws/observations/current?stationId=TEST1',
            'https://api.weather.com/v3/wx/forecast/daily/5day?geocode=51.4,6.7',
            'https://api.weather.com/v3/wx/forecast/hourly/2day?geocode=51.4,6.7',
        ];
        const { requests, errors } = await discover(JSON.stringify({ API_KEY: key, urls }), true, { station: '' });
        assert.equal(requests.length, 4);
        assert.equal(errors.length, 0);
    });

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
