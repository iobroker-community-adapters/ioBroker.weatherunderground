const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);

async function initialize(objects, imperial, legacy, updates) {
    await vm.runInNewContext(`${source}\nadapter = testAdapter; nonMetric = testNonMetric; checkWeatherVariables();`, {
        require: name => (name === '@iobroker/adapter-core' ? {} : adapterRequire(name)),
        module: { parent: true, exports: {} },
        testNonMetric: imperial,
        testAdapter: {
            config: {
                current: true,
                forecast_periods: true,
                forecast_periods_txt: true,
                forecast_hourly: true,
                useLegacyApi: legacy,
            },
            log: { debug() {} },
            setObjectNotExistsAsync: async (id, object) => {
                if (!objects.has(id)) {
                    objects.set(id, JSON.parse(JSON.stringify(object)));
                }
            },
            getObjectAsync: async id => objects.get(id),
            extendObjectAsync: async (id, patch) => {
                updates.push([id, patch]);
                Object.assign(objects.get(id).common, patch.common);
            },
        },
    });
}

describe('state roles (#328)', () => {
    for (const imperial of [false, true]) {
        for (const legacy of [false, true]) {
            it(`uses documented roles and migrates only roles (imperial=${imperial}, legacy=${legacy})`, async () => {
                const objects = new Map();
                const updates = [];
                await initialize(objects, imperial, legacy, updates);
                assert.equal(objects.get('forecast.current.windDirection').common.role, 'weather.direction.wind');
                assert.equal(objects.get('forecast.current.displayLocationLatitude').common.role, 'value.gps.latitude');
                for (let day = 0; day < 6; day++) {
                    const id = `forecast.${day}d.`;
                    for (const [state, role] of Object.entries({
                        cloudCover: 'value.clouds',
                        precipitationChance: 'value.precipitation.chance',
                        precipitationAllDay: `value.precipitation.forecast.${day}`,
                        precipitationDay: `value.precipitation.day.forecast.${day}`,
                        precipitationNight: `value.precipitation.night.forecast.${day}`,
                        snowAllDay: 'value.snow',
                        snowDay: 'value',
                        snowNight: 'value',
                        windSpeedMax: 'value.speed.max.wind',
                        windDirectionMax: 'value',
                        windDegreesMax: 'value.direction.max.wind',
                        humidityMin: 'value.humidity.min',
                        icon: 'value',
                        windDirection: `weather.direction.wind.forecast.${day}`,
                    })) {
                        assert.equal(objects.get(id + state).common.role, role, id + state);
                    }
                }
                for (let period = 0; period < 12; period++) {
                    const id = `forecastPeriod.${period}p.`;
                    for (const [state, role] of Object.entries({
                        date: 'date',
                        icon: 'value',
                        iconURL: 'weather.icon',
                        title: 'weather.title',
                        state: 'weather.state',
                        precipitationChance: 'value.precipitation.chance',
                    })) {
                        assert.equal(objects.get(id + state).common.role, role, id + state);
                    }
                }
                for (let hour = 0; hour < 36; hour++) {
                    assert.equal(objects.get(`forecastHourly.${hour}h.windSpeed`).common.role, 'value.speed.wind');
                    assert.equal(
                        objects.get(`forecastHourly.${hour}h.precipitationChance`).common.role,
                        'value.precipitation.chance',
                    );
                }
                for (const hour of [6, 12, 24]) {
                    assert.equal(
                        objects.get(`forecastHourly.${hour}h.sum.precipitationChance`).common.role,
                        'value.precipitation.chance',
                    );
                }

                for (let day = 0; day < 6; day++) {
                    const roles = [...objects]
                        .filter(
                            ([id, object]) => id.startsWith(`forecast.${day}d.`) && object.common.role.includes('.'),
                        )
                        .map(([, object]) => object.common.role);
                    assert.equal(new Set(roles).size, roles.length, `unique detailed roles for day ${day}`);
                }

                const previous = new Map();
                for (const [id, object] of objects) {
                    if (object.type !== 'state') {
                        continue;
                    }
                    object.common.name = 'User label';
                    object.common.custom = { history: { enabled: true } };
                    previous.set(id, JSON.parse(JSON.stringify(object)));
                    object.common.role = 'old.invalid.role';
                }
                updates.length = 0;
                await initialize(objects, imperial, legacy, updates);
                assert.ok(updates.length > 0, 'existing installations must receive role corrections');
                for (const [id, patch] of updates) {
                    assert.deepEqual(Object.keys(patch), ['common']);
                    assert.deepEqual(Object.keys(patch.common), ['role']);
                    assert.deepEqual(objects.get(id), previous.get(id), `preserve all other metadata: ${id}`);
                }
                updates.length = 0;
                await initialize(objects, imperial, legacy, updates);
                assert.equal(updates.length, 0, 'unchanged roles must not be rewritten');
            });
        }
    }
});
