const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);

function forecast(expiredDaytime) {
    const daypart = {};
    for (const [key, value] of Object.entries({
        daypartName: 'Today',
        iconCode: 32,
        narrative: 'Sunny',
        wxPhraseLong: 'Sunny',
        wxPhraseShort: '',
        precipChance: 10,
        qpf: 1,
        cloudCover: 20,
        qpfSnow: 0,
        windSpeed: 12,
        windDirection: 270,
        relativeHumidity: 50,
    })) {
        daypart[key] = Array(12).fill(value);
    }
    Object.assign(daypart, {
        iconCode: [32, 31, ...daypart.iconCode.slice(2)],
        narrative: ['Sunny', 'Clear tonight', ...daypart.narrative.slice(2)],
        wxPhraseLong: ['Sunny', 'Clear', ...daypart.wxPhraseLong.slice(2)],
        relativeHumidity: [50, 65, ...daypart.relativeHumidity.slice(2)],
        windDirection: [270, 90, ...daypart.windDirection.slice(2)],
    });
    if (expiredDaytime) {
        for (const values of Object.values(daypart)) {
            values[0] = null;
        }
    }
    return {
        daily_forecast: {
            validTimeLocal: Array.from({ length: 6 }, (_, i) => `2026-10-${22 + i}T07:00:00+0200`),
            temperatureMax: [18, 19, 20, 21, 22, 23],
            temperatureMin: [8, 9, 10, 11, 12, 13],
            qpf: Array(6).fill(2),
            qpfSnow: Array(6).fill(0),
            daypart: [daypart],
        },
    };
}

function parse(body, enabled = true) {
    const states = {};
    const errors = [];
    return new Promise((resolve, reject) => {
        vm.runInNewContext(
            `${source}
            adapter = testAdapter;
            parseNewResult(testBody).then(testDone, testReject);
        `,
            {
                require: name => (name === '@iobroker/adapter-core' ? {} : adapterRequire(name)),
                module: { parent: true, exports: {} },
                testAdapter: {
                    config: { forecast_periods: enabled },
                    log: {
                        debug() {},
                        error(message) {
                            errors.push(message);
                        },
                    },
                    setStateAsync: async (id, state) => {
                        assert.equal(state.ack, true);
                        states[id] = state.val;
                    },
                },
                testBody: body,
                testDone: () => resolve({ states, errors }),
                testReject: reject,
            },
        );
    });
}

describe('remaining daily forecast', () => {
    const windCases = [
        { speeds: [30, 10], directions: [10, 350], expectedSpeed: 30, expectedDirection: 10 },
        { speeds: [10, 30], directions: [350, 10], expectedSpeed: 30, expectedDirection: 10 },
        { speeds: [20, 20], directions: [10, 350], expectedSpeed: 20, expectedDirection: 10 },
        { speeds: [0, null], directions: [0, 350], expectedSpeed: 0, expectedDirection: 0 },
        { speeds: [null, 0], directions: [350, 0], expectedSpeed: 0, expectedDirection: 0 },
        { speeds: [NaN, Infinity], directions: [10, 350], expectedSpeed: null, expectedDirection: null },
        { speeds: [null, undefined], directions: [10, 350], expectedSpeed: null, expectedDirection: null },
        { speeds: ['30', 10], directions: [350, 10], expectedSpeed: 10, expectedDirection: 10 },
        { speeds: [30, 10], directions: [null, 350], expectedSpeed: 30, expectedDirection: null },
        { speeds: [30, 10], directions: [NaN, 350], expectedSpeed: 30, expectedDirection: null },
        { speeds: [30, 10], directions: ['10', 350], expectedSpeed: 30, expectedDirection: null },
    ];
    for (const { speeds, directions, expectedSpeed, expectedDirection } of windCases) {
        it(`keeps maximum wind directions with the strongest valid period (${JSON.stringify([speeds, directions])})`, async () => {
            const body = forecast(false);
            body.daily_forecast.daypart[0].windSpeed.splice(0, 2, ...speeds);
            body.daily_forecast.daypart[0].windDirection.splice(0, 2, ...directions);
            const { states, errors } = await parse(body);
            assert.deepEqual(errors, []);
            assert.equal(states['forecast.0d.windSpeedMax'], expectedSpeed);
            assert.equal(states['forecast.0d.windDirectionMax'], expectedDirection);
            assert.equal(states['forecast.0d.windDegreesMax'], expectedDirection);
        });
    }

    it('uses tonight when the provider has removed the expired daytime period', async () => {
        const { states, errors } = await parse(forecast(true));
        assert.deepEqual(errors, []);
        assert.equal(states['forecast.0d.icon'], 31);
        assert.equal(states['forecast.0d.iconURL'], 'https://www.wunderground.com/static/i/c/v4/31.svg');
        assert.equal(states['forecast.0d.state'], 'Clear tonight');
        assert.equal(states['forecast.0d.stateShort'], 'Clear');
        assert.equal(states['forecast.0d.cloudCover'], 20);
        assert.equal(states['forecast.0d.windSpeed'], 12);
        assert.equal(states['forecast.0d.windDirection'], 'O');
        assert.equal(states['forecast.0d.windDegrees'], 90);
        assert.equal(states['forecast.0d.windSpeedMax'], 12);
        assert.equal(states['forecast.0d.windDirectionMax'], 90);
        assert.equal(states['forecast.0d.windDegreesMax'], 90);
        assert.equal(states['forecast.0d.humidity'], 65);
        assert.equal(states['forecast.0d.humidityMin'], 65);
        assert.equal(states['forecast.0d.precipitationDay'], null);
        assert.equal(states['forecast.0d.snowDay'], null);
        assert.equal(states['forecast.1d.icon'], 32);
        assert.equal(states['forecast.1d.state'], 'Sunny');
        assert.equal(states['forecast.1d.stateShort'], 'Sunny');
    });

    it('keeps daytime values while that period is still available', async () => {
        const { states, errors } = await parse(forecast(false));
        assert.deepEqual(errors, []);
        assert.equal(states['forecast.0d.icon'], 32);
        assert.equal(states['forecast.0d.state'], 'Sunny');
        assert.equal(states['forecast.0d.stateShort'], 'Sunny');
        assert.equal(states['forecast.0d.humidity'], 50);
        assert.equal(states['forecast.0d.humidityMin'], 50);
        assert.equal(states['forecast.0d.windDirection'], 'W');
    });

    it('preserves available daytime data when period names are absent', async () => {
        const body = forecast(false);
        delete body.daily_forecast.daypart[0].daypartName;
        const { states, errors } = await parse(body);
        assert.deepEqual(errors, []);
        assert.equal(states['forecast.0d.icon'], 32);
        assert.equal(states['forecast.0d.state'], 'Sunny');
    });

    it('writes no daily forecast when forecast_periods is disabled', async () => {
        const { states, errors } = await parse(forecast(true), false);
        assert.deepEqual(errors, []);
        assert.deepEqual(states, {});
    });

    for (const phrase of [undefined, null, '', '   ', 123]) {
        it(`clears an unavailable short phrase (${String(phrase)}) without replacing the narrative`, async () => {
            const body = forecast(true);
            body.daily_forecast.daypart[0].wxPhraseLong[1] = phrase;
            const { states, errors } = await parse(body);
            assert.deepEqual(errors, []);
            assert.equal(states['forecast.0d.stateShort'], null);
            assert.equal(states['forecast.0d.state'], 'Clear tonight');
        });
    }

    it('handles providers without short phrase arrays', async () => {
        const body = forecast(true);
        delete body.daily_forecast.daypart[0].wxPhraseLong;
        const { states, errors } = await parse(body);
        assert.deepEqual(errors, []);
        assert.equal(states['forecast.0d.stateShort'], null);
        assert.equal(states['forecast.0d.state'], 'Clear tonight');
    });

    it('creates daily short phrase objects only for enabled forecasts and preserves user metadata', async () => {
        const objects = new Map();
        const existing = { type: 'state', common: { name: 'User label', custom: { history: { enabled: true } } } };
        const expected = structuredClone(existing);
        objects.set('forecast.0d.stateShort', existing);
        for (const enabled of [false, true]) {
            await vm.runInNewContext(`${source}\nadapter = testAdapter; checkWeatherVariables();`, {
                require: name => (name === '@iobroker/adapter-core' ? {} : adapterRequire(name)),
                module: { parent: true, exports: {} },
                testAdapter: {
                    config: { forecast_periods: enabled },
                    log: { debug() {} },
                    getObjectAsync: async id => objects.get(id),
                    extendObjectAsync: async (id, patch) => Object.assign(objects.get(id).common, patch.common),
                    setObjectNotExistsAsync: async (id, object) => {
                        if (!objects.has(id)) {
                            objects.set(id, object);
                        }
                    },
                },
            });
            assert.equal(objects.has('forecast.1d.stateShort'), enabled);
        }
        const object = objects.get('forecast.1d.stateShort');
        assert.equal(object.type, 'state');
        assert.equal(object.common.type, 'string');
        assert.equal(object.common.role, 'weather.title.forecast.1');
        assert.equal(object.common.read, true);
        assert.equal(object.common.write, false);
        assert.equal(objects.has('forecastPeriod.0p.stateShort'), false);
        assert.deepEqual(objects.get('forecast.0d.stateShort'), expected);
    });
});
