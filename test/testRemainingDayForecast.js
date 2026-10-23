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
    it('uses tonight when the provider has removed the expired daytime period', async () => {
        const { states, errors } = await parse(forecast(true));
        assert.deepEqual(errors, []);
        assert.equal(states['forecast.0d.icon'], 31);
        assert.equal(states['forecast.0d.iconURL'], 'https://www.wunderground.com/static/i/c/v4/31.svg');
        assert.equal(states['forecast.0d.state'], 'Clear tonight');
        assert.equal(states['forecast.0d.cloudCover'], 20);
        assert.equal(states['forecast.0d.windSpeed'], 12);
        assert.equal(states['forecast.0d.windDirection'], 'O');
        assert.equal(states['forecast.0d.windDegrees'], 90);
        assert.equal(states['forecast.0d.humidity'], 65);
        assert.equal(states['forecast.0d.humidityMin'], 65);
        assert.equal(states['forecast.0d.precipitationDay'], null);
        assert.equal(states['forecast.0d.snowDay'], null);
        assert.equal(states['forecast.1d.icon'], 32);
        assert.equal(states['forecast.1d.state'], 'Sunny');
    });

    it('keeps daytime values while that period is still available', async () => {
        const { states, errors } = await parse(forecast(false));
        assert.deepEqual(errors, []);
        assert.equal(states['forecast.0d.icon'], 32);
        assert.equal(states['forecast.0d.state'], 'Sunny');
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
});
