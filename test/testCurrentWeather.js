const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const adapterRequire = createRequire(main);

function harness(config = {}, get = async (_url, _options) => ({ data: { wxPhraseLong: 'Partly cloudy' } })) {
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
            config: { current: true, regionalCurrent: true, ...config },
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

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('current weather description', () => {
    it('uses zero for missing PWS UV and solar radiation without replacing supplied measurements', async () => {
        const h = harness();
        for (const value of [null, undefined, 0, 12.5]) {
            h.context.body = observation();
            h.context.body.current_observation.solarRadiation = value;
            h.context.body.current_observation.uv = value;
            await h.run('parseNewResult(body)');
            assert.equal(h.states['forecast.current.solarRadiation'], value == null ? 0 : value);
            assert.equal(h.states['forecast.current.UV'], value == null ? 0 : value);
        }
    });

    it('preserves finite provider quality codes and clears unavailable codes', async () => {
        const h = harness();
        for (const qcStatus of [1, 0, -1, 2.5, undefined, null, '', '1', NaN, Infinity]) {
            h.context.body = observation();
            h.context.body.current_observation.qcStatus = qcStatus;
            await h.run('parseNewResult(body)');
            assert.equal(
                h.states['forecast.current.qualityControl'],
                typeof qcStatus === 'number' && Number.isFinite(qcStatus) ? qcStatus : null,
            );
            assert.equal(h.states['forecast.current.temp'], 17);
        }
    });

    it('uses only finite regional visibility, including zero', async () => {
        for (const visibility of [11.27, 0, undefined, null, '', '11.27', NaN, Infinity]) {
            const h = harness();
            h.context.body = { ...observation(), current_conditions: { visibility } };
            await h.run('parseNewResult(body)');
            assert.equal(
                h.states['forecast.current.visibility'],
                typeof visibility === 'number' && Number.isFinite(visibility) ? visibility : null,
            );
            assert.equal(h.states['forecast.current.temp'], 17);
        }
        const h = harness();
        h.context.body = observation();
        await h.run('parseNewResult(body)');
        assert.equal(h.states['forecast.current.visibility'], null);
    });

    it('creates string icon URLs and corrects old number types without changing user metadata', async () => {
        for (const type of [undefined, 'number', 'string']) {
            const h = harness();
            const id = 'forecast.current.iconURL';
            const existing = type && {
                type: 'state',
                common: { type, name: 'My icon', custom: { history: { enabled: true } } },
            };
            const objects = new Map(existing ? [[id, existing]] : []);
            h.context.testAdapter.setObjectNotExistsAsync = async (key, object) => {
                if (!objects.has(key)) {
                    objects.set(key, object);
                }
            };
            h.context.testAdapter.getObjectAsync = async key => objects.get(key);
            h.context.testAdapter.extendObjectAsync = async (key, object) =>
                Object.assign(objects.get(key).common, object.common);
            await h.run('checkWeatherVariables()');
            assert.equal(objects.get(id).common.type, 'string');
            if (existing) {
                assert.equal(objects.get(id).common.name, 'My icon');
                assert.deepEqual(objects.get(id).common.custom, { history: { enabled: true } });
            }
        }
    });

    it('updates only the old stock weather label, preserving custom names', async () => {
        for (const name of ['Weather (engl.)', 'My weather', { en: 'Custom weather' }]) {
            const h = harness();
            const updates = [];
            h.context.testAdapter.setObjectNotExistsAsync = async () => {};
            h.context.testAdapter.getObjectAsync = async id =>
                id === 'forecast.current.weather' ? { common: { name } } : null;
            h.context.testAdapter.extendObjectAsync = async (id, object) => updates.push({ id, object });
            await h.run('checkWeatherVariables()');
            assert.equal(updates.length, name === 'Weather (engl.)' ? 1 : 0);
            if (updates.length) {
                assert.equal(updates[0].id, 'forecast.current.weather');
                assert.equal(updates[0].object.common.name, 'Weather');
            }
        }
    });

    it('clarifies observation channel names without changing IDs or user metadata', async () => {
        for (const custom of [false, true]) {
            const h = harness();
            const objects = new Map([
                [
                    'forecast',
                    {
                        common: {
                            name: custom ? 'My weather' : 'Forecast for next 4 days days and current conditions',
                            custom: { kept: true },
                        },
                    },
                ],
                [
                    'forecast.current',
                    { common: { name: custom ? 'My station' : 'Current conditions', custom: { kept: true } } },
                ],
            ]);
            h.context.testAdapter.setObjectNotExistsAsync = async (id, object) => {
                if (!objects.has(id)) {
                    objects.set(id, object);
                }
            };
            h.context.testAdapter.getObjectAsync = async id => objects.get(id);
            h.context.testAdapter.extendObjectAsync = async (id, patch) =>
                Object.assign(objects.get(id).common, patch.common);
            await h.run('checkWeatherVariables()');
            assert.equal(
                objects.get('forecast').common.name,
                custom ? 'My weather' : 'Weather observations and forecasts',
            );
            assert.equal(
                objects.get('forecast.current').common.name,
                custom ? 'My station' : 'Current weather observations',
            );
            assert.equal(objects.get('forecast').common.custom.kept, true);
            assert.equal(objects.get('forecast.current').common.custom.kept, true);
        }
    });

    it('requests localized conditions using station coordinates and the website key', async () => {
        const h = harness();
        const data = observation(0, 0);
        h.context.body = data;
        await h.run('getNewWuDataCurrentConditions(body)');
        assert.equal(h.requests.length, 2);
        const { url, options } = h.requests[0];
        const request = new URL(url);
        if (options.params) {
            for (const [key, value] of Object.entries(options.params)) {
                request.searchParams.set(key, String(value));
            }
        }
        assert.equal(request.origin + request.pathname, 'https://api.weather.com/v3/wx/observations/current');
        assert.equal(request.searchParams.get('geocode'), '0,0');
        assert.equal(request.searchParams.get('language'), 'de-DE');
        assert.equal(request.searchParams.get('format'), 'json');
        assert.equal(request.searchParams.get('units'), 'm');
        assert.equal(request.searchParams.get('apiKey'), 'synthetic-web-key');
        assert.equal(options.timeout, 15000);
        assert.equal(options.signal instanceof AbortSignal, true);
        assert.equal(options.validateStatus(200), true);
        for (const status of [204, 401, 403, 500]) {
            assert.equal(options.validateStatus(status), false);
        }
        assert.equal(data.current_conditions.wxPhraseLong, 'Partly cloudy');
        assert.equal(data.current_observation.metric.temp, 17);
        assert.equal(h.run('officialApiKey'), 'synthetic-pws-key');
        assert.equal(h.run('errorCounter'), 2);
    });

    it('uses imperial units when configured by the adapter', async () => {
        const h = harness();
        h.context.body = observation();
        h.run('nonMetric = true');
        await h.run('getNewWuDataCurrentConditions(body)');
        const { url, options } = h.requests[0];
        assert.equal(options.params?.units || new URL(url).searchParams.get('units'), 'e');
    });

    it('requires opt-in for regional requests while retaining PWS data and clearing old regional values', async () => {
        for (const regionalCurrent of [undefined, false]) {
            const h = harness({ regionalCurrent });
            h.context.body = {
                ...observation(),
                current_conditions: { wxPhraseLong: 'Cloudy', iconCode: 26, visibility: 10 },
                air_quality: { globalairquality: { airQualityIndex: 42 } },
            };
            await h.run('parseNewResult(body)');
            assert.equal(h.states['forecast.current.airQualityIndex'], 42);

            h.context.body = observation();
            await h.run('getNewWuDataCurrentConditions(body);');
            await h.run('parseNewResult(body)');
            assert.equal(h.requests.length, 0);
            assert.equal(h.states['forecast.current.temp'], 17);
            for (const field of ['weather', 'iconURL', 'visibility', 'airQualityIndex']) {
                assert.equal(h.states[`forecast.current.${field}`], null, field);
            }
        }
    });

    it('skips disabled current data, missing keys and invalid coordinates', async () => {
        for (const { config, key, lat, lon } of [
            { config: { current: false }, key: 'key', lat: 52, lon: 13 },
            { key: '', lat: 52, lon: 13 },
            { key: '   ', lat: 52, lon: 13 },
            { key: 'key', lat: undefined, lon: 13 },
            { key: 'key', lat: 52, lon: null },
            { key: 'key', lat: '52', lon: 13 },
            { key: 'key', lat: NaN, lon: 13 },
            { key: 'key', lat: Infinity, lon: 13 },
            { key: 'key', lat: 91, lon: 13 },
            { key: 'key', lat: 52, lon: -181 },
        ]) {
            const h = harness(config);
            h.context.body = observation();
            h.context.body.current_observation.lat = lat;
            h.context.body.current_observation.lon = lon;
            h.context.key = key;
            h.run('newWebKey = key');
            await h.run('getNewWuDataCurrentConditions(body)');
            assert.equal(h.requests.length, 0, `unexpected request for ${JSON.stringify({ lat, lon })}`);
        }
    });

    it('isolates optional provider errors without leaking request secrets', async () => {
        for (const status of [204, 401, 403, 500, undefined]) {
            const h = harness({}, async () => {
                throw Object.assign(new Error('https://api.weather.com/?apiKey=synthetic-web-key&geocode=52,13'), {
                    response: status ? { status } : undefined,
                });
            });
            const data = observation();
            h.context.body = data;
            await h.run('getNewWuDataCurrentConditions(body)');
            assert.equal(h.requests.length, 2);
            assert.equal(data.current_conditions, undefined);
            assert.equal(data.current_observation.metric.temp, 17);
            assert.equal(h.run('officialApiKey'), 'synthetic-pws-key');
            assert.equal(h.run('errorCounter'), 2);
            assert.equal(h.logs.join(' ').includes('synthetic-web-key'), false);
            assert.equal(h.logs.join(' ').includes('52,13'), false);
        }
    });

    it('ignores an optional response completed after shutdown', async () => {
        const response = Promise.withResolvers();
        const h = harness({}, () => response.promise);
        h.context.body = observation();
        const pending = h.run('getNewWuDataCurrentConditions(body)');
        h.run('stopInProgress = true');
        response.resolve({ data: { wxPhraseLong: 'Late result' } });
        await pending;
        assert.equal(h.context.body.current_conditions, undefined);
    });

    it('cancels the optional request through the shared shutdown signal', async () => {
        const h = harness(
            {},
            (_url, options) =>
                new Promise((_resolve, reject) => {
                    options.signal.addEventListener('abort', () => reject(new Error('Canceled')), { once: true });
                }),
        );
        h.context.body = observation();
        const pending = h.run('getNewWuDataCurrentConditions(body)');
        h.run('stopInProgress = true; requestAbortController.abort()');
        await pending;
        assert.equal(h.requests[0].options.signal.aborted, true);
        assert.equal(h.context.body.current_conditions, undefined);
        assert.deepEqual(h.logs, []);
    });

    it('writes only a nonempty conditions phrase while preserving PWS measurements', async () => {
        for (const phrase of ['Partly cloudy', undefined, null, '', '   ', 123]) {
            const h = harness();
            h.context.body = { ...observation(), current_conditions: { wxPhraseLong: phrase, temperature: 99 } };
            await h.run('parseNewResult(body)');
            assert.equal(h.states['forecast.current.weather'], phrase === 'Partly cloudy' ? phrase : null);
            assert.equal(h.states['forecast.current.temp'], 17);
            assert.equal(h.states['forecast.current.relativeHumidity'], 61);
            assert.equal(h.states['forecast.current.pressure'], 1012);
        }
    });

    it('uses only a valid current conditions icon code, including zero', async () => {
        for (const iconCode of [0, 12, undefined, null, '', '12', -1, 1.5, 10000, NaN]) {
            const h = harness();
            h.context.body = { ...observation(), current_conditions: { iconCode } };
            await h.run('parseNewResult(body)');
            assert.equal(
                h.states['forecast.current.iconURL'],
                iconCode === 0 || iconCode === 12 ? `https://www.wunderground.com/static/i/c/v4/${iconCode}.svg` : null,
            );
        }
    });

    it('does not parse results or call completion after shutdown during requests', async () => {
        const response = Promise.withResolvers();
        const h = harness({}, () => response.promise);
        h.context.body = observation();
        h.context.events = [];
        h.context.finishDaily = undefined;
        h.run(`
            getApiKey = cb => cb();
            getNewWuDataCurrentObservations = cb => cb(body);
            getNewWuDataDailyForecast = (data, cb) => { finishDaily = () => cb(data); };
            getNewWuDataHourlyForecast = (data, cb) => cb(data);
            parseNewResult = async (_data, cb) => { events.push('parse'); cb(); };
            getKeysAndData(() => events.push('callback'));
            stopInProgress = true;
            finishDaily();
        `);
        response.resolve({ data: { wxPhraseLong: 'Late result' } });
        await flush();
        assert.deepEqual(Array.from(h.context.events), []);
    });

    for (const first of ['conditions', 'forecast']) {
        it(`waits for both request branches when ${first} finishes first`, async () => {
            const conditions = Promise.withResolvers();
            const h = harness({}, () => conditions.promise);
            h.context.body = observation();
            h.context.events = [];
            h.context.finishDaily = undefined;
            h.run(`
                getApiKey = cb => cb();
                getNewWuDataCurrentObservations = cb => cb(body);
                getNewWuDataDailyForecast = (data, cb) => { finishDaily = () => cb(data); };
                getNewWuDataHourlyForecast = (data, cb) => { events.push('hourly'); cb(data); };
                parseNewResult = async (data, cb) => { events.push(data.current_conditions.wxPhraseLong); cb(); };
                getKeysAndData(() => events.push('callback'));
            `);
            assert.equal(h.requests.length, 2);
            if (first === 'conditions') {
                conditions.resolve({ data: { wxPhraseLong: 'Cloudy' } });
            } else {
                h.run('finishDaily()');
            }
            await flush();
            assert.equal(h.context.events.includes('callback'), false);
            if (first === 'conditions') {
                h.run('finishDaily()');
            } else {
                conditions.resolve({ data: { wxPhraseLong: 'Cloudy' } });
            }
            await flush();
            assert.deepEqual(Array.from(h.context.events), ['hourly', 'Cloudy', 'callback']);
        });
    }
});
