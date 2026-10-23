const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);
// Forecast fields from https://github.com/user-attachments/files/16717269/JSON_Responseof_Wu.txt
const fixture = require('./fixtures/issue250-daily-forecast.json');

async function parseDaily(forecast) {
    const states = new Map();
    const errors = [];
    await vm.runInNewContext(`${source}\nadapter = testAdapter; parseNewResult(testBody);`, {
        require: name => (name === '@iobroker/adapter-core' ? {} : adapterRequire(name)),
        module: { parent: true, exports: {} },
        testBody: { daily_forecast: forecast },
        testAdapter: {
            config: { forecast_periods: true },
            log: {
                debug() {},
                error(message) {
                    errors.push(message);
                },
            },
            setStateAsync: async (id, state) => states.set(id, state),
        },
    });
    assert.deepEqual(errors, []);
    return states;
}

describe('daily forecast temperatures', () => {
    it('uses the matching calendar-day extremes for all six dates, including the expired first daytime', async () => {
        const forecast = structuredClone(fixture.daily_forecast);
        const states = await parseDaily(forecast);
        for (let i = 0; i < 6; i++) {
            assert.equal(states.get(`forecast.${i}d.tempMax`).val, forecast.calendarDayTemperatureMax[i]);
            assert.equal(states.get(`forecast.${i}d.tempMin`).val, forecast.calendarDayTemperatureMin[i]);
        }
        assert.equal(states.get('forecast.0d.tempMax').ack, true);
        assert.equal(states.get('forecast.0d.tempMin').ack, true);
    });

    it('preserves zero calendar-day temperatures', async () => {
        const forecast = structuredClone(fixture.daily_forecast);
        forecast.calendarDayTemperatureMax[0] = 0;
        forecast.calendarDayTemperatureMin[0] = 0;
        const states = await parseDaily(forecast);
        assert.equal(states.get('forecast.0d.tempMax').val, 0);
        assert.equal(states.get('forecast.0d.tempMin').val, 0);
    });

    for (const absent of ['arrays', 'entries', 'null']) {
        it(`retains temperatureMax/temperatureMin when calendar-day ${absent} are unavailable`, async () => {
            const forecast = structuredClone(fixture.daily_forecast);
            for (const field of ['calendarDayTemperatureMax', 'calendarDayTemperatureMin']) {
                if (absent === 'arrays') {
                    delete forecast[field];
                } else {
                    forecast[field] = absent === 'entries' ? [] : Array(6).fill(null);
                }
            }
            const states = await parseDaily(forecast);
            for (let i = 0; i < 6; i++) {
                assert.equal(states.get(`forecast.${i}d.tempMax`).val, forecast.temperatureMax[i]);
                assert.equal(states.get(`forecast.${i}d.tempMin`).val, forecast.temperatureMin[i]);
            }
        });
    }
});
