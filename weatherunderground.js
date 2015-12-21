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

var adapter = utils.adapter({
    name: 'weatherunderground',

    unload: function (callback) {
        adapter.log.info("adapter weatherunderground is unloading");
    },
    discover: function (callback) {
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
        getWuForecastData();
    },
    message: function (obj) {
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
        } else
        {
            // ERROR
            adapter.log.error("Wunderground reported an error: " + error);
        }
    });
}

