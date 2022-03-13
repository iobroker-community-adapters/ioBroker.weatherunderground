/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
const expect = require('chai').expect;
const setup  = require('./lib/setup');

let objects = null;
let states  = null;
let onStateChanged = null;
let sendToID = 1;

const adapterShortName = setup.adapterName.substring(setup.adapterName.indexOf('.')+1);

function checkConnectionOfAdapter(cb, counter) {
    counter = counter || 0;
    console.log('Try check #' + counter);
    if (counter > 30) {
        cb && cb('Cannot check connection');
        return;
    }

    states.getState(`system.adapter.${adapterShortName}.0.alive`, (err, state) => {
        err && console.error(err);
        if (state && state.val) {
            cb && cb();
        } else {
            setTimeout(() =>
                checkConnectionOfAdapter(cb, counter + 1), 1000);
        }
    });
}

describe(`Test ${adapterShortName} adapter`, function () {
    before(`Test ${adapterShortName} adapter: Start js-controller`, function (_done) {
        this.timeout(600000); // because of first install from npm

        setup.setupController(async () => {
            const config = await setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';
            config.native.location = 'Berlin';
            config.native.language = 'GE';
            config.native.apikey = '12345678901234567890123456789012';

            await setup.setAdapterConfig(config.common, config.native);

            setup.startController(true,
                (id, obj) => {},
                (id, state) => onStateChanged && onStateChanged(id, state),
                (_objects, _states) => {
                    objects = _objects;
                    states  = _states;
                    _done();
                });
        });
    });

    it(`Test ${adapterShortName} adapter: Check if adapter started`, function (done) {
        this.timeout(60000);

        checkConnectionOfAdapter(res => {
            res && console.log(res);
            expect(res).not.to.be.equal('Cannot check connection');
            done();
        });
    });

    it(`Test ${adapterShortName}: check states`, function (done) {
        this.timeout(35000);

        setTimeout(() => {
            states.getState('weatherunderground.0.forecast.current.temp', (err, state) => {
                expect(err).to.be.not.ok;
                expect(state).to.be.ok;
                expect(state.val).to.be.not.undefined;
                expect(state.val).to.be.a('number');

                states.getState('weatherunderground.0.forecast.current.windDegrees', (err, state) => {
                    expect(err).to.be.not.ok;
                    expect(state).to.be.ok;
                    expect(state.val).to.be.not.undefined;
                    expect(state.val).to.be.a('number');

                    states.getState('weatherunderground.0.forecast.current.feelsLike', (err, state) => {
                        expect(err).to.be.not.ok;
                        expect(state).to.be.ok;
                        expect(state.val).to.be.not.undefined;
                        expect(state.val).to.be.a('number');
                        done();
                    });
                });
            });
        }, 30000);
    });

    after(`Test ${adapterShortName} adapter: Stop js-controller`, function (done) {
        this.timeout(10000);

        setup.stopController(normalTerminated => {
            console.log('Adapter normal terminated: ' + normalTerminated);
            done();
        });
    });
});
