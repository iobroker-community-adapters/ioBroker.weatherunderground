const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);

describe('hourly object metadata', () => {
    for (const imperial of [false, true]) {
        it(`keeps public state IDs and provider paths for ${imperial ? 'imperial' : 'metric'} units`, async () => {
            const objects = new Map();
            await vm.runInNewContext(
                `${source}
                adapter = testAdapter;
                nonMetric = testNonMetric;
                checkWeatherVariables();
            `,
                {
                    require: name => (name === '@iobroker/adapter-core' ? {} : adapterRequire(name)),
                    module: { parent: true, exports: {} },
                    testNonMetric: imperial,
                    testAdapter: {
                        config: { forecast_hourly: true },
                        log: { debug() {} },
                        setObjectNotExistsAsync: async (id, object) => objects.set(id, object),
                    },
                },
            );
            const units = imperial ? 'english' : 'metric';
            for (const h of [0, 35]) {
                for (const [state, field, unit] of [
                    ['heatIndex', 'heatindex', imperial ? '°F' : '°C'],
                    ['feelsLike', 'feelslike', imperial ? '°F' : '°C'],
                    ['precipitation', 'qpf', imperial ? 'in' : 'mm'],
                    ['snow', 'snow', imperial ? 'in' : 'cm'],
                    ['mslp', 'mslp', imperial ? 'inHg' : 'hPa'],
                ]) {
                    const object = objects.get(`forecastHourly.${h}h.${state}`);
                    assert.equal(object.native.id, `forecastHourly.${h}h.${field}.${units}`);
                    assert.equal(object.common.unit, unit);
                    assert.equal(object.common.type, 'number');
                    assert.equal(object.common.write, false);
                }
            }
            for (const h of [6, 12, 24]) {
                assert.equal(
                    objects.get(`forecastHourly.${h}h.sum.precipitation`).native.id,
                    `forecast.${h}h.sum.qpf.${units}`,
                );
            }
        });
    }
});
