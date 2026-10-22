const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);

async function parseHourly(iconCode, enabled = true) {
    const states = new Map();
    const errors = [];
    const hourly = {};
    for (const field of [
        'validTimeUtc',
        'temperature',
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
    if (iconCode !== undefined) hourly.iconCode = iconCode;

    await vm.runInNewContext(source + '\nadapter = testAdapter; parseNewResult(testBody);', {
        require: (name) => (name === '@iobroker/adapter-core' ? {} : adapterRequire(name)),
        module: { parent: true, exports: {} },
        testAdapter: {
            config: { forecast_hourly: enabled },
            log: {
                debug() {},
                error(message) {
                    errors.push(message);
                },
            },
            async setStateAsync(id, state) {
                states.set(id, state);
            },
        },
        testBody: { hourly_forecast: hourly },
    });
    assert.deepEqual(errors, []);
    return states;
}

describe('hourly weather codes', () => {
    it('publishes the API icon code for every forecast hour, including zero', async () => {
        const codes = Array.from({ length: 36 }, (_, hour) => hour);
        const states = await parseHourly(codes);
        for (let hour = 0; hour < 36; hour++) {
            const state = states.get(`forecastHourly.${hour}h.fctcode`);
            assert.equal(state.val, codes[hour], `hour ${hour}`);
            assert.equal(state.ack, true);
        }
    });

    for (const [name, codes] of [
        ['missing', undefined],
        ['null', null],
        ['empty', []],
        ['partial', [32, null]],
    ]) {
        it(`keeps unavailable codes null with a ${name} iconCode field`, async () => {
            const states = await parseHourly(codes);
            for (let hour = 0; hour < 36; hour++) {
                assert.equal(states.get(`forecastHourly.${hour}h.fctcode`).val, codes?.[hour] ?? null);
                assert.equal(states.get(`forecastHourly.${hour}h.temp`).val, 1);
            }
        });
    }

    it('does not write hourly states when hourly forecasts are disabled', async () => {
        const states = await parseHourly(Array(36).fill(32), false);
        assert.equal(states.size, 0);
    });
});
