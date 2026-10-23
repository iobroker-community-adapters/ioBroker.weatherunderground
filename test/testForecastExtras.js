const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);
const hourlyNames = ['windGust', 'dewPoint', 'windChill', 'stateShort', 'precipitationType'];
const dailyNames = ['sunrise', 'sunset', 'moonrise', 'moonset', 'moonPhase'];

// Synthetic v3 hourly/2day and daily/5day arrays, as captured in issue #220.
function forecast() {
    const hourly = {};
    for (const field of [
        'validTimeUtc',
        'temperature',
        'iconCode',
        'cloudCover',
        'windSpeed',
        'windDirection',
        'uvIndex',
        'relativeHumidity',
        'temperatureHeatIndex',
        'temperatureFeelsLike',
        'qpf',
        'qpfSnow',
        'precipChance',
        'pressureMeanSeaLevel',
        'visibility',
    ]) {
        hourly[field] = Array(36).fill(1);
    }
    Object.assign(hourly, {
        windGust: Array(36).fill(24),
        temperatureDewPoint: Array(36).fill(4),
        temperatureWindChill: Array(36).fill(-2),
        wxPhraseLong: Array(36).fill('Partly Cloudy'),
        precipType: Array(36).fill('rain'),
    });
    hourly.windGust[35] = 39;
    hourly.temperatureDewPoint[35] = 7;
    hourly.temperatureWindChill[35] = -8;
    hourly.wxPhraseLong[35] = 'Snow Showers';
    hourly.precipType[35] = 'snow';
    const daypart = {};
    for (const field of [
        'daypartName',
        'narrative',
        'wxPhraseLong',
        'iconCode',
        'precipChance',
        'qpf',
        'cloudCover',
        'qpfSnow',
        'windSpeed',
        'windDirection',
        'relativeHumidity',
    ]) {
        daypart[field] = Array(12).fill(1);
    }
    const daily = {
        validTimeLocal: Array(6).fill('2026-01-15T07:00:00+0100'),
        temperatureMax: Array(6).fill(8),
        temperatureMin: Array(6).fill(-1),
        qpf: Array(6).fill(2),
        qpfSnow: Array(6).fill(0),
        daypart: [daypart],
        sunriseTimeLocal: Array(6).fill('2026-01-15T08:13:00+0100'),
        sunsetTimeLocal: Array(6).fill('2026-01-15T16:42:00+0100'),
        moonriseTimeLocal: Array(6).fill('2026-01-15T05:12:00+0100'),
        moonsetTimeLocal: Array(6).fill('2026-01-15T13:07:00+0100'),
        moonPhase: Array(6).fill('Waning Crescent'),
    };
    daily.sunriseTimeLocal[5] = '2026-01-20T08:09:00+0100';
    daily.moonPhase[5] = 'New Moon';
    return { hourly_forecast: hourly, daily_forecast: daily };
}

async function run(body, config = {}, objects = new Map(), states = new Map(), imperial = false) {
    const errors = [];
    await vm.runInNewContext(
        `${source}\nadapter = testAdapter; nonMetric = testImperial;
        (async () => { await checkWeatherVariables(); await parseNewResult(testBody); })();`,
        {
            require: name => (name === '@iobroker/adapter-core' ? {} : adapterRequire(name)),
            module: { parent: true, exports: {} },
            testImperial: imperial,
            testBody: body,
            testAdapter: {
                config: { forecast_hourly: true, forecast_periods: true, ...config },
                log: { debug() {}, error: message => errors.push(message) },
                getObjectAsync: async id => objects.get(id),
                extendObjectAsync: async (id, patch) => Object.assign(objects.get(id).common, patch.common),
                setObjectNotExistsAsync: async (id, object) => {
                    if (!objects.has(id)) {
                        objects.set(id, object);
                    }
                },
                setStateAsync: async (id, state) => states.set(id, state),
            },
        },
    );
    assert.deepEqual(errors, []);
    return { objects, states };
}

function value(states, id, expected) {
    assert.ok(states.has(id), `missing ${id}`);
    assert.equal(states.get(id).val, expected, id);
    assert.equal(states.get(id).ack, true, `${id} acknowledgement`);
}

describe('additional modern forecast states', () => {
    it('publishes provider values through the last hour and day, preserving ISO offsets', async () => {
        const { states } = await run(forecast());
        for (const [hour, expected] of [
            [0, [24, 4, -2, 'Partly Cloudy', 'rain']],
            [35, [39, 7, -8, 'Snow Showers', 'snow']],
        ]) {
            hourlyNames.forEach((name, i) => value(states, `forecastHourly.${hour}h.${name}`, expected[i]));
        }
        const expected = [
            '2026-01-15T08:13:00+0100',
            '2026-01-15T16:42:00+0100',
            '2026-01-15T05:12:00+0100',
            '2026-01-15T13:07:00+0100',
            'Waning Crescent',
        ];
        dailyNames.forEach((name, i) => value(states, `forecast.0d.${name}`, expected[i]));
        value(states, 'forecast.5d.sunrise', '2026-01-20T08:09:00+0100');
        value(states, 'forecast.5d.moonPhase', 'New Moon');
    });

    it('clears stale values for missing or malformed provider entries while retaining numeric zero', async () => {
        const body = forecast();
        const { objects, states } = await run(body);
        for (const field of ['windGust', 'temperatureDewPoint', 'temperatureWindChill']) {
            body.hourly_forecast[field] = [0, null, '', '12', NaN, Infinity, false, {}];
        }
        for (const field of ['wxPhraseLong', 'precipType']) {
            body.hourly_forecast[field] = [null, '', '   ', 12, false, {}];
        }
        for (const field of [
            'sunriseTimeLocal',
            'sunsetTimeLocal',
            'moonriseTimeLocal',
            'moonsetTimeLocal',
            'moonPhase',
        ]) {
            body.daily_forecast[field] = [null, '', '   ', 12, false];
        }
        await run(body, {}, objects, states);
        hourlyNames.slice(0, 3).forEach(name => value(states, `forecastHourly.0h.${name}`, 0));
        for (let hour = 1; hour < 36; hour++) {
            hourlyNames.forEach(name => value(states, `forecastHourly.${hour}h.${name}`, null));
        }
        hourlyNames.slice(3).forEach(name => value(states, `forecastHourly.0h.${name}`, null));
        for (let day = 0; day < 6; day++) {
            dailyNames.forEach(name => value(states, `forecast.${day}d.${name}`, null));
        }
        delete body.hourly_forecast.windGust;
        delete body.daily_forecast.moonPhase;
        await run(body, {}, objects, states);
        value(states, 'forecastHourly.0h.windGust', null);
        value(states, 'forecast.0d.moonPhase', null);
    });

    it('respects independent hourly and daily switches for objects and writes', async () => {
        for (const hourly of [false, true]) {
            const { objects, states } = await run(forecast(), {
                forecast_hourly: hourly,
                forecast_periods: !hourly,
            });
            for (const [id, enabled] of [
                ['forecastHourly.0h.windGust', hourly],
                ['forecast.0d.sunrise', !hourly],
            ]) {
                assert.equal(objects.has(id), enabled, `${id} object`);
                assert.equal(states.has(id), enabled, `${id} state`);
            }
        }
    });

    it('creates read-only typed objects in the selected units and preserves user metadata', async () => {
        for (const imperial of [false, true]) {
            const custom = { type: 'state', common: { name: 'My gust', custom: { history: { enabled: true } } } };
            const expected = structuredClone(custom);
            const { objects } = await run(
                forecast(),
                {},
                new Map([['forecastHourly.0h.windGust', custom]]),
                new Map(),
                imperial,
            );
            const fields = [
                ['forecastHourly.35h.windGust', 'number', 'value.speed.wind.gust', imperial ? 'm/h' : 'km/h'],
                ['forecastHourly.35h.dewPoint', 'number', 'value.temperature.dewpoint', imperial ? '°F' : '°C'],
                ['forecastHourly.35h.windChill', 'number', 'value.temperature.windchill', imperial ? '°F' : '°C'],
                ['forecastHourly.35h.stateShort', 'string', 'weather.title'],
                ['forecastHourly.35h.precipitationType', 'string', 'text'],
                ['forecast.5d.sunrise', 'string', 'date.sunrise.forecast.5'],
                ['forecast.5d.sunset', 'string', 'date.sunset.forecast.5'],
                ['forecast.5d.moonrise', 'string', 'date'],
                ['forecast.5d.moonset', 'string', 'date'],
                ['forecast.5d.moonPhase', 'string', 'text'],
            ];
            for (const [id, type, role, unit] of fields) {
                const object = objects.get(id);
                assert.ok(object, id);
                assert.equal(object.type, 'state', id);
                assert.equal(object.common.type, type, id);
                assert.equal(object.common.role, role, id);
                assert.equal(object.common.unit, unit, id);
                assert.equal(object.common.read, true, id);
                assert.equal(object.common.write, false, id);
            }
            assert.deepEqual(objects.get('forecastHourly.0h.windGust'), expected);
        }
    });
});
