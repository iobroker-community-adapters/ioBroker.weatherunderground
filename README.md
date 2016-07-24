![Logo](admin/wu.png)
# ioBroker.weatherunderground
===============

[![NPM version](http://img.shields.io/npm/v/iobroker.weatherunderground.svg)](https://www.npmjs.com/package/iobroker.weatherunderground)
[![Downloads](https://img.shields.io/npm/dm/iobroker.weatherunderground.svg)](https://www.npmjs.com/package/iobroker.weatherunderground)

[![NPM](https://nodei.co/npm/iobroker.weatherunderground.png?downloads=true)](https://nodei.co/npm/iobroker.weatherunderground/)

ioBroker Adapter to load 24h weather forecast for your location from [Weather Underground](http://www.wunderground.com/).
The adapter loads all 15min (default) hourly forecast data for the next 24h. Additionally it calculates sum/avg/max values of the most used data for 6, 12, 24h.

## Notes
An api-key from WU is needed to use this adapter:
* Register/Login at http://www.wunderground.com/weather/api/d/login.html
* get your apikey at http://www.wunderground.com/weather/api/d/pricing . purchase a free developer key.

As location see docu: http://www.wunderground.com/weather/api/d/docs?d=data/index (-> query)

##in ioBroker Forum (German)
http://forum.iobroker.org/viewtopic.php?f=20&t=2042&sid=a863d19838bc49439759bef89fcad1c3

## ToDo
There is a still a problem with encoding. The addresses with "äüöß" will be shown wrong.

# changelog
## 1.0.1 (2016-07-21)
* (jens-maus) conversion from feet to meter for observation_location

## 1.0.0 (2016-07-12)
* (Apollon77) add daily rain level forecast

## 0.2.0 (2016-07-01)
* (Apollon77) Add Error handling and station-usage for forcasts

## 0.1.1 (2016-06-07)
* (ploebb) Fix forecast api URL

## 0.1.0 (2016-05-07)
* (bluefox) convert text to floats
* (bluefox) support languages

## 0.0.5
corrected humidity value within current weather info (slice + unit)

## 0.0.4
checking for spaces in location
added current conditions

## 0.0.3
bugfix in summed pop-value.

## 0.0.2
config dialog fixed

## 0.0.1
initial release with all basics to load WU-forecast data

# Todo
TODO


# License

The MIT License (MIT)

Copyright (c) 2015-2016 dschaedl <daniel.schaedler@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
