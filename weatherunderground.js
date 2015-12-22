/**
 *
 * weatherunderground adapter
 *
 * Adapter loading the json forecast of weatherunderground
 *
 * note: you need an account and an api key to get the forecast. This is free for non excess usage: 500 requests/d
 * see: http://www.wunderground.com/weather/api/d/pricing
 *
 * register for a key:
 * http://www.wunderground.com/weather/api/d/questionnaire.html?plan=a&level=0&history=undefined
 *
 * see http://www.wunderground.com/weather/api/d/docs?d=data/hourly
 * for reference of the possible values from hourly WU forecast
 *
 */

"use strict";

var utils = require(__dirname + '/lib/utils'); // Get common adapter utils

var request = require('request');

var adapter = utils.adapter({
    name: 'weatherunderground',

    unload: function (callback) {
        adapter.log.info("adapter weatherunderground is unloading");
    },
    discover: function (callback) {
        adapter.log.info("adapter weatherunderground discovered");
    },
    install: function (callback) {
        adapter.log.info("adapter weatherunderground installed");
    },
    uninstall: function (callback) {
        adapter.log.info("adapter weatherunderground UN-installed");
    },
    objectChange: function (id, obj) {
        adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
    },
    stateChange: function (id, state) {
        adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));
    },
    ready: function () {
        adapter.log.info("Adapter weatherunderground got 'Ready' Signal - starting scheduler to look for forecasts");
        adapter.log.info("adapter weatherunderground initializing objects");
        checkWeatherVariables();
        getWuForecastData();
    }
});

function getWuForecastData() {

    //debug

    var url = "http://api.wunderground.com/api/" + adapter.config.apikey + "/hourly/q/" + adapter.config.location + ".json";


    request({url: url, json: true}, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            var qpf_sum = 0;
            var pop_max = 0;
            var uvi_sum = 0;

            for (var i = 0; i < 24; i++) {
                try {
                    //adapter.log.info("WU-Response Body: " + JSON.stringify(body.hourly_forecast[0].FCTTIME)); // Print the json response
                    //var forecast = JSON.parse(body.jsonData);
                    //adapter.log.info("version: " + body.response.version);
                    // see http://www.wunderground.com/weather/api/d/docs?d=resources/phrase-glossary for infos about properties and codes
                    adapter.setState("forecast." + i + "h.time", {ack: true, val: body.hourly_forecast[i].FCTTIME.pretty});
                    adapter.setState("forecast." + i + "h.temp", {ack: true, val: body.hourly_forecast[i].temp.metric});
                    adapter.setState("forecast." + i + "h.fctcode", {ack: true, val: body.hourly_forecast[i].fctcode}); //forecast description number -> see link above
                    adapter.setState("forecast." + i + "h.sky", {ack: true, val: body.hourly_forecast[i].sky}); //?
                    adapter.setState("forecast." + i + "h.wspd", {ack: true, val: body.hourly_forecast[i].wspd.metric}); // windspeed in kmh
                    adapter.setState("forecast." + i + "h.wdir", {ack: true, val: body.hourly_forecast[i].wdir.degrees}); //wind dir in degrees
                    adapter.setState("forecast." + i + "h.uvi", {ack: true, val: body.hourly_forecast[i].uvi}); //UV Index -> wikipedia
                    adapter.setState("forecast." + i + "h.humidity", {ack: true, val: body.hourly_forecast[i].humidity});
                    adapter.setState("forecast." + i + "h.heatindex", {ack: true, val: body.hourly_forecast[i].heatindex.metric}); // -> wikipedia
                    adapter.setState("forecast." + i + "h.feelslike", {ack: true, val: body.hourly_forecast[i].feelslike.metric}); // -> wikipedia
                    adapter.setState("forecast." + i + "h.qpf", {ack: true, val: body.hourly_forecast[i].qpf.metric}); // Quantitative precipitation forecast
                    adapter.setState("forecast." + i + "h.snow", {ack: true, val: body.hourly_forecast[i].snow.metric});
                    adapter.setState("forecast." + i + "h.pop", {ack: true, val: body.hourly_forecast[i].pop}); // probability of Precipitation
                    adapter.setState("forecast." + i + "h.mslp", {ack: true, val: body.hourly_forecast[i].mslp.metric}); // mean sea level pressure

                    qpf_sum += Number(body.hourly_forecast[i].qpf.metric);
                    uvi_sum += Number(body.hourly_forecast[i].uvi);
                    if (Number(body.hourly_forecast[i].uvi) > pop_max) {
                        pop_max = Number(body.hourly_forecast[i].uvi);
                    }

                    // 6h
                    if (i == 5) {
                        adapter.setState("forecast.6h.sum.qpf", {ack: true, val: qpf_sum});
                        adapter.setState("forecast.6h.sum.pop", {ack: true, val: pop_max});
                        adapter.setState("forecast.6h.sum.uvi", {ack: true, val: uvi_sum/6});
                    }
                    // 12h
                    if (i == 11) {
                        adapter.setState("forecast.12h.sum.qpf", {ack: true, val: qpf_sum});
                        adapter.setState("forecast.12h.sum.pop", {ack: true, val: pop_max});
                        adapter.setState("forecast.12h.sum.uvi", {ack: true, val: uvi_sum/12});
                    }
                    // 24h
                    if (i == 23) {
                        adapter.setState("forecast.24h.sum.qpf", {ack: true, val: qpf_sum});
                        adapter.setState("forecast.24h.sum.pop", {ack: true, val: pop_max});
                        adapter.setState("forecast.24h.sum.uvi", {ack: true, val: uvi_sum/24});
                    }
                } catch (error) {
                    adapter.log.error("Could not parse Forecast-Data: " + error);
                }
            }
            adapter.log.info("all forecast values set");
        } else
        {
            // ERROR
            adapter.log.error("Wunderground reported an error: " + error);
        }
    });
}

function checkWeatherVariables() {
    adapter.log.info("init forecast objects");

    adapter.setObjectNotExists('forecast', {
        type: 'channel',
        role: 'forecast',
        common: {name: 'weatherunderground 24h forecast'},
        native: {location: adapter.config.location}
    });

    for (var h=0; h < 24; h++) {
        var id = "forecast." + h + "h.";
        adapter.setObjectNotExists('forecast.' + h + 'h', {
            type: 'channel',
            role: 'forecast',
            common: {name: 'in ' + h + 'h'},
            native: {location: adapter.config.location}
        });
        adapter.setObjectNotExists(id + 'time', {
            type: 'state',
            common: {name: 'forecast for', type: 'string', read: true, write: false},
            native: {id: id + 'time'}
        });
        adapter.setObjectNotExists(id + 'temp', {
            type: 'state',
            common: {name: 'Temperature', type: 'number', role: 'value.temperature', unit: 'C°', read: true, write: false},
            native: {id: id + 'temp'}
        });
        adapter.setObjectNotExists(id + 'fctcode', {
            type: 'state',
            common: {name: 'forecast description code', type: 'number', read: true, write: false},
            native: {id: id + 'fctcode'}
        });
        adapter.setObjectNotExists(id + 'sky', {
            type: 'state',
            common: {name: 'Sky (clear-covered)', type: 'number', unit: '%', read: true, write: false},
            native: {id: id + 'sky'}
        });
        adapter.setObjectNotExists(id + 'wspd', {
            type: 'state',
            common: {name: 'Windspeed', type: 'number', role: 'value.wind', unit: 'km/h', read: true, write: false},
            native: {id: id + 'wspd'}
        });
        adapter.setObjectNotExists(id + 'wdir', {
            type: 'state',
            common: {name: 'Wind direction', type: 'number', role: 'value.winddir', unit: '°', read: true, write: false},
            native: {id: id + 'wdir'}
        });
        adapter.setObjectNotExists(id + 'uvi', {
            type: 'state',
            common: {name: 'UV Index (0..~10)', type: 'number', role: 'value.index', read: true, write: false},
            native: {id: id + 'uvi'}
        });
        adapter.setObjectNotExists(id + 'humidity', {
            type: 'state',
            common: {name: 'Humidity', type: 'number', role: 'value.humidity', unit: '%', read: true, write: false},
            native: {id: id + 'humidity'}
        });
        adapter.setObjectNotExists(id + 'heatindex', {
            type: 'state',
            common: {name: 'Heatindex', type: 'number', role: 'value.temperature', unit: 'C°', read: true, write: false},
            native: {id: id + 'heatindex'}
        });
        adapter.setObjectNotExists(id + 'feelslike', {
            type: 'state',
            common: {name: 'Feels like', type: 'number', role: 'value.temperature', unit: 'C°', read: true, write: false},
            native: {id: id + 'feelslike'}
        });
        adapter.setObjectNotExists(id + 'qpf', {
            type: 'state',
            common: {name: 'Quantitative precipitation forecast', type: 'number', role: 'value.rain', unit: 'mm', read: true, write: false},
            native: {id: id + 'qpf'}
        });
        adapter.setObjectNotExists(id + 'snow', {
            type: 'state',
            common: {name: 'Snow precipitation', type: 'number', role: 'value.snow', unit: 'mm', read: true, write: false},
            native: {id: id + 'snow'}
        });
        adapter.setObjectNotExists(id + 'pop', {
            type: 'state',
            common: {name: 'Percentage of precipitation', type: 'number', role: 'value.rain', unit: '%', read: true, write: false},
            native: {id: id + 'pop'}
        });
        adapter.setObjectNotExists(id + 'mslp', {
            type: 'state',
            common: {name: 'Mean sea level pressure', type: 'number', role: 'value.pressure', unit: 'hPa', read: true, write: false},
            native: {id: id + 'mslp'}
        });
    }

    adapter.setObjectNotExists('forecast.6h.sum.qpf', {
        type: 'state',
        common: {name: 'sum of qpf', type: 'number', role: 'value.rain', unit: 'mm', read: true, write: false},
        native: {id: 'forecast.6h.sum.qpf'}
    });
    adapter.setObjectNotExists('forecast.12h.sum.qpf', {
        type: 'state',
        common: {name: 'sum of qpf', type: 'number', role: 'value.rain', unit: 'mm', read: true, write: false},
        native: {id: 'forecast.12h.sum.qpf'}
    });
    adapter.setObjectNotExists('forecast.24h.sum.qpf', {
        type: 'state',
        common: {name: 'sum of qpf', type: 'number', role: 'value.rain', unit: 'mm', read: true, write: false},
        native: {id: 'forecast.24h.sum.qpf'}
    });

    adapter.setObjectNotExists('forecast.6h.sum.pop', {
        type: 'state',
        common: {name: 'max of pop', type: 'number', role: 'value.rain', unit: '%', read: true, write: false},
        native: {id: 'forecast.6h.sum.pop'}
    });
    adapter.setObjectNotExists('forecast.12h.sum.pop', {
        type: 'state',
        common: {name: 'max of pop', type: 'number', role: 'value.rain', unit: '%', read: true, write: false},
        native: {id: 'forecast.12h.sum.pop'}
    });
    adapter.setObjectNotExists('forecast.24h.sum.pop', {
        type: 'state',
        common: {name: 'max of pop', type: 'number', role: 'value.rain', unit: '%', read: true, write: false},
        native: {id: 'forecast.24h.sum.pop'}
    });

    adapter.setObjectNotExists('forecast.6h.sum.uvi', {
        type: 'state',
        common: {name: 'max of pop', type: 'number', role: 'value.rain', unit: '%', read: true, write: false},
        native: {id: 'forecast.6h.sum.uvi'}
    });
    adapter.setObjectNotExists('forecast.12h.sum.uvi', {
        type: 'state',
        common: {name: 'max of pop', type: 'number', role: 'value.rain', unit: '%', read: true, write: false},
        native: {id: 'forecast.12h.sum.uvi'}
    });
    adapter.setObjectNotExists('forecast.24h.sum.uvi', {
        type: 'state',
        common: {name: 'max of pop', type: 'number', role: 'value.rain', unit: '%', read: true, write: false},
        native: {id: 'forecast.24h.sum.uvi'}
    });
}

