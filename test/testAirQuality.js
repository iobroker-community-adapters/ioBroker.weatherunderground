const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const adapterRequire = createRequire(main);

/**
 * @param {object} [config] Adapter configuration overrides.
 * @param {(url: string, options: object) => Promise<{data: object}>} [get] Synthetic HTTP transport.
 */
function harness(
    config = {},
    get = async url => ({
        data: url.endsWith('/point')
            ? { location: { placeId: 'synthetic-place' } }
            : url.endsWith('/globalAirQuality')
              ? { globalairquality: { airQualityIndex: 42 } }
              : { wxPhraseLong: 'Partly cloudy' },
    }),
) {
    const states = {};
    const logs = [];
    const requests = [];
    const context = vm.createContext({
        require: name => {
            if (name === '@iobroker/adapter-core') {
                return {};
            }
            if (name === 'axios') {
                return {
                    get: (url, options) => {
                        requests.push({ url, options });
                        return get(url, options);
                    },
                };
            }
            return adapterRequire(name);
        },
        module: { parent: true, exports: {} },
        AbortController,
        URL,
        testAdapter: {
            config: { current: true, ...config },
            log: Object.fromEntries(
                ['debug', 'info', 'warn', 'error'].map(level => [level, message => logs.push(message)]),
            ),
            setStateAsync: async (id, state) => {
                assert.equal(state.ack, true);
                states[id] = state.val;
            },
        },
    });
    vm.runInContext(
        `${fs.readFileSync(main, 'utf8')}
        adapter = testAdapter;
        requestAbortController = new AbortController();
        newWebKey = 'synthetic-web-key';
        officialApiKey = 'synthetic-pws-key';
        errorCounter = 2;
        lang = 'de-DE';
    `,
        context,
    );
    return { context, states, logs, requests, run: code => vm.runInContext(code, context) };
}

function observation(lat = 52, lon = 13) {
    return {
        current_observation: {
            lat,
            lon,
            neighborhood: 'Synthetic station',
            stationID: 'TEST0001',
            obsTimeLocal: '2026-10-23 12:00:00',
            obsTimeUtc: '2026-10-23T10:00:00Z',
            humidity: 61,
            winddir: 90,
            solarRadiation: 12,
            uv: 1,
            metric: {
                elev: 10,
                temp: 17,
                windSpeed: 3,
                windGust: 4,
                pressure: 1012,
                dewpt: 9,
                windChill: 16,
                heatIndex: 18,
                precipRate: 0,
                precipTotal: 2,
            },
        },
    };
}

describe('current air quality', () => {
    it('resolves the station location and requests EPA air quality with the website key', async () => {
        const h = harness();
        h.context.body = observation(0, 0);
        await h.run('getNewWuDataCurrentConditions(body)');
        assert.equal(h.requests.length, 3);
        const location = h.requests.find(request => request.url.endsWith('/location/point'));
        const quality = h.requests.find(request => request.url.endsWith('/globalAirQuality'));
        assert.equal(location.url, 'https://api.weather.com/v3/location/point');
        assert.equal(location.options.params.geocode, '0,0');
        assert.equal(location.options.params.locationType, 'pws');
        assert.equal(quality.url, 'https://api.weather.com/v3/wx/globalAirQuality');
        assert.equal(quality.options.params.placeid, 'synthetic-place');
        assert.equal(quality.options.params.scale, 'EPA');
        assert.equal(quality.options.params.geocode, undefined);
        assert.equal(quality.options.params.units, undefined);
        for (const { options } of [location, quality]) {
            assert.equal(options.params.apiKey, 'synthetic-web-key');
            assert.equal(options.params.language, 'de-DE');
            assert.equal(options.params.format, 'json');
            assert.equal(options.timeout, 15000);
            assert.equal(options.signal, h.requests[0].options.signal);
            assert.equal(options.validateStatus(200), true);
            for (const status of [204, 401, 403, 500]) {
                assert.equal(options.validateStatus(status), false);
            }
            assert.equal(JSON.stringify(options.params).includes('synthetic-pws-key'), false);
        }
        await h.run('parseNewResult(body)');
        assert.equal(h.states['forecast.current.airQualityIndex'], 42);
        assert.equal(h.states['forecast.current.weather'], 'Partly cloudy');
        assert.equal(h.states['forecast.current.temp'], 17);
    });

    it('creates a read-only numeric air-quality index without physical units', async () => {
        const h = harness();
        const objects = {};
        h.context.testAdapter.setObjectNotExistsAsync = async (id, object) => {
            objects[id] = object;
        };
        h.context.testAdapter.getObjectAsync = async () => null;
        await h.run('checkWeatherVariables()');
        const object = objects['forecast.current.airQualityIndex'];
        assert.equal(object.type, 'state');
        assert.equal(object.common.type, 'number');
        assert.equal(object.common.role, 'value.airquality');
        assert.equal(object.common.read, true);
        assert.equal(object.common.write, false);
        assert.equal(object.common.unit, undefined);
    });

    it('accepts zero and clears stale values for missing or malformed provider indices', async () => {
        const h = harness();
        for (const value of [0, 87, undefined, null, '', '42', NaN, Infinity, {}, []]) {
            h.states['forecast.current.airQualityIndex'] = 99;
            h.context.body = { ...observation(), air_quality: { globalairquality: { airQualityIndex: value } } };
            await h.run('parseNewResult(body)');
            assert.equal(
                h.states['forecast.current.airQualityIndex'],
                typeof value === 'number' && Number.isFinite(value) ? value : null,
            );
        }
        for (const value of [undefined, null, {}, { globalairquality: null }]) {
            h.context.body = { ...observation(), air_quality: value };
            await h.run('parseNewResult(body)');
            assert.equal(h.states['forecast.current.airQualityIndex'], null);
        }
    });

    it('skips air quality when the location response has no valid place ID', async () => {
        for (const placeId of [undefined, null, '', '   ', 123]) {
            const h = harness({}, async url => ({
                data: url.endsWith('/point') ? { location: { placeId } } : { wxPhraseLong: 'Cloudy' },
            }));
            h.context.body = observation();
            await h.run('getNewWuDataCurrentConditions(body)');
            assert.equal(h.requests.length, 2);
            assert.equal(h.context.body.air_quality, undefined);
            assert.equal(h.context.body.current_conditions.wxPhraseLong, 'Cloudy');
        }
    });

    it('isolates location and air-quality failures without losing weather or changing owner-key state', async () => {
        for (const failedPath of ['/point', '/globalAirQuality']) {
            const h = harness({}, async url => {
                if (url.endsWith(failedPath)) {
                    throw Object.assign(new Error('synthetic-web-key 52,13'), { response: { status: 403 } });
                }
                return {
                    data: url.endsWith('/point')
                        ? { location: { placeId: 'synthetic-place' } }
                        : { wxPhraseLong: 'Cloudy' },
                };
            });
            h.context.body = observation();
            await h.run('getNewWuDataCurrentConditions(body)');
            await h.run('parseNewResult(body)');
            assert.equal(h.states['forecast.current.weather'], 'Cloudy');
            assert.equal(h.states['forecast.current.temp'], 17);
            assert.equal(h.states['forecast.current.airQualityIndex'], null);
            assert.equal(h.run('officialApiKey'), 'synthetic-pws-key');
            assert.equal(h.run('errorCounter'), 2);
            assert.equal(h.logs.join(' ').includes('synthetic-web-key'), false);
            assert.equal(h.logs.join(' ').includes('52,13'), false);
        }
    });

    it('retrieves air quality independently when current conditions fail', async () => {
        const h = harness({}, async url => {
            if (url.endsWith('/current')) {
                throw new Error('conditions unavailable');
            }
            return {
                data: url.endsWith('/point')
                    ? { location: { placeId: 'synthetic-place' } }
                    : { globalairquality: { airQualityIndex: 0 } },
            };
        });
        h.context.body = observation();
        await h.run('getNewWuDataCurrentConditions(body)');
        await h.run('parseNewResult(body)');
        assert.equal(h.states['forecast.current.airQualityIndex'], 0);
        assert.equal(h.states['forecast.current.weather'], null);
        assert.equal(h.states['forecast.current.temp'], 17);
    });

    it('does not start air quality after shutdown while location is pending', async () => {
        const location = Promise.withResolvers();
        const h = harness({}, async url =>
            url.endsWith('/point') ? location.promise : { data: { wxPhraseLong: 'Cloudy' } },
        );
        h.context.body = observation();
        const pending = h.run('getNewWuDataCurrentConditions(body)');
        h.run('stopInProgress = true');
        location.resolve({ data: { location: { placeId: 'synthetic-place' } } });
        await pending;
        assert.equal(h.requests.length, 2);
        assert.equal(h.context.body.air_quality, undefined);
    });
});
