![Logo](admin/wu.png)
# ioBroker.weatherunderground

![Number of Installations](https://iobroker.live/badges/weatherunderground-installed.svg)
![Number of Installations](https://iobroker.live/badges/weatherunderground-stable.svg)
[![NPM version](https://img.shields.io/npm/v/iobroker.weatherunderground.svg)](https://www.npmjs.com/package/iobroker.weatherunderground)
![Test and Release](https://github.com/iobroker-community-adapters/iobroker.weatherunderground/workflows/Test%20and%20Release/badge.svg)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/weatherunderground/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![Downloads](https://img.shields.io/npm/dm/iobroker.weatherunderground.svg)](https://www.npmjs.com/package/iobroker.weatherunderground)

Current station measurements, up to 36 hourly forecasts and six daily forecasts from [Weather Underground](https://www.wunderground.com/), with optional regional weather and air-quality data from Weather Company.

Data is retrieved once per hour by default. Change the instance schedule to adjust the frequency.

**Sentry reports exceptions and code errors to the developers.** See the [Sentry plugin documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry) for details and how to disable reporting.

## Requirements

The current development version requires Node.js **22+**, js-controller **6.0.11+** and Admin **7.7.22+**.

## Configuration

PWS means **Personal Weather Station**, a private weather station. Station measurements describe observed weather; forecasts describe expected weather.

### Data switches

| Key | Default | Data and state IDs |
| --- | --- | --- |
| `current` | `true` | Station temperature, humidity, wind, pressure, precipitation, UV, solar radiation and quality control under `forecast.current.*`. |
| `regionalCurrent` | `false` | **Additional weather and air-quality data** from Weather Company: weather description, icon, visibility and air quality for the surrounding area. Requires `current: true`, valid station coordinates and the website key. Uses `forecast.current.*` and adds up to three requests per run. |
| `forecast_hourly` | `true` | Up to 36 hourly entries under `forecastHourly.0h`–`forecastHourly.35h`, plus summary states. |
| `forecast_periods` | `true` | Six calendar dates under `forecast.0d`–`forecast.5d`, starting with today. |
| `forecast_periods_txt` | `true` | Up to 12 successive day/night text and icon periods under `forecastPeriod.0p`–`forecastPeriod.11p`. Shares the daily response with `forecast_periods`. |

### Location and display

| Key | Meaning |
| --- | --- |
| `country` | Two-letter country code for location lookup; default `DE`. |
| `language` | Weather-text language: `DL` German, `EN` English, `RU` Russian or `NL` Dutch. Independent of the Admin interface language. |
| `location` | Location name, airport code or coordinates. A blank initial location is filled from ioBroker system coordinates where available. |
| `station` | Optional preferred station ID. If empty, the provider selects a station for the location. The field is shown when `current` is enabled. |
| `nonMetric` | `false` for metric values; `true` for imperial values such as °F and miles. When initializing a blank location, the dialog also follows the system temperature unit. Air-quality concentrations always use µg/m³. |
| `iconSet` | Hidden compatibility setting. A–K use the same v4 SVG icons when no custom URL is configured. |
| `custom_icon_base_url` | Optional base URL for numeric icon files. A nonempty URL enables custom icons; leave empty for standard icons. |
| `custom_icon_format` | Custom extension: GIF, PNG, SVG or JPG; defaults to GIF when absent. |

Hidden settings retain their saved values. The dialog groups Country/Language and Location/Station.

### API keys

`apiKey` is an optional PWS owner key, encrypted in storage and protected from ordinary foreign-adapter access. Existing keys migrate automatically; see [API-key upgrades](#api-key-upgrades).

The adapter also reads the key used by the Weather Underground website:

- Station observations use the owner key when a station and `current` are configured; otherwise they use the website key.
- Daily forecasts use the owner key when a station, its coordinates and an owner key are available; otherwise they use the extracted website URL/key.
- Hourly forecasts and regional products use the website key, even with an owner key configured.

Key and product availability are controlled by the provider. The retained `useLegacyApi` key has no effect: the runtime always disables the former API.

## Data sources and requests

The direct product endpoints use `https://api.weather.com`:

| Endpoint | Requested when | Provides |
| --- | --- | --- |
| `/v2/pws/observations/current` | Each acquisition run, including when `current` is off | Station observations and coordinates needed for forecasts. `current` controls publication of the measurements. |
| `/v3/wx/forecast/daily/5day` | `forecast_periods` or `forecast_periods_txt` is on | Six calendar dates and their day/night periods. |
| `/v3/wx/forecast/hourly/2day` | `forecast_hourly` is on | Hourly data; the adapter publishes the first 36 entries. |
| `/v3/wx/observations/current` | `current` and `regionalCurrent` are on, with valid coordinates and a website key | Regional weather description, icon and visibility. |
| `/v3/location/point` | Same regional prerequisites | A `placeId` for the station coordinates, used by the air-quality request. |
| `/v3/wx/globalAirQuality` | Location resolution returned a valid `placeId` | EPA air-quality index, advice and six pollutant details. |

If the direct station/coordinate path is unavailable, the adapter uses provider URLs extracted from the Weather Underground page. Regional products use the coordinates from the station response and can represent a different source and observation time from the station measurements.

### Reducing requests

- Keep `regionalCurrent` off to avoid all three regional requests.
- Turn `forecast_hourly` off to avoid the hourly request.
- Turn **both** `forecast_periods` and `forecast_periods_txt` off to avoid the shared daily request.
- Turning `current` off stops station state updates and prevents regional requests, but the station request still runs to obtain forecast coordinates.

A successful direct run with forecasts enabled uses three product requests: station, daily and hourly. Regional data adds up to three more; location failure prevents the subsequent air-quality request. Website/key discovery, retries and recovery can cause additional HTTP requests.

## State reference

| States | Meaning |
| --- | --- |
| `forecast.current.*` | Current observations despite the historical `forecast` prefix. Temperature, humidity, wind and precipitation come from the station. `qualityControl` is its raw quality-control code. |
| `forecast.current.weather`, `.iconURL`, `.visibility` | Optional regional weather description, numeric-code icon URL and visibility. |
| `forecast.current.airQualityIndex` | Optional numeric EPA index, without a physical unit. Category, primary pollutant, source and general/sensitive-group advice are separate states. |
| `forecast.current.airQuality.CO`, `.NO2`, `.O3`, `.PM10`, `.PM2_5`, `.SO2` | Each pollutant has `amount` in µg/m³, its EPA `index` and `category`. These are regional products, not station measurements. |
| `forecastHourly.0h`–`forecastHourly.35h` | Hourly values including `windGust`, `dewPoint`, `windChill`, `stateShort` and `precipitationType` (for example `rain` or `snow`). `0h` means **Next hourly forecast**, the first API entry; check `.time` for its timestamp. |
| `forecast.0d`–`forecast.5d` | Daily values including complete narrative `.state`, short description `.stateShort`, `sunrise`, `sunset`, `moonrise`, `moonset` and `moonPhase`. Sun/moon times preserve the provider UTC offset. |

Daily short text, narrative and icon use the same daytime or remaining nighttime period. Descriptions follow `language`. Regional descriptions do not replace station measurements, and forecasts are not substituted for current observations. Existing IDs and custom object names are preserved.

### Missing data and disabled options

- Missing or `null` station UV and solar radiation produce `0`.
- Missing or invalid regional values produce `null`. Regional fields also clear to `null` when station observations are processed with `regionalCurrent` off. Optional regional failures do not discard station measurements or forecasts.
- Without a processable station observation, existing current values can remain unchanged.
- Disabled switches retain their objects and previously stored values; they do not delete historical data. Regional clearing follows the rule above.

## Icons

The current API returns numeric codes. Saved built-in A–K settings all use the same v4 SVG icons, such as [32.svg](https://www.wunderground.com/static/i/c/v4/32.svg). The redundant selector is hidden. Enter a custom base URL to use your own icons, or clear it to use standard icons.

The custom URL and format fields are always editable, independent of the saved `iconSet` value. Existing nonempty custom URLs take precedence over A–K settings. For example, base URL `https://example.com/weather-icons/` and PNG format resolve code `32` to `https://example.com/weather-icons/32.png`. The host must provide files for every code returned by the provider; preview codes `0`, `12`, `26` and `32` are only samples.

Legacy named icons such as `clear.gif` and `nt_clear.gif` do not match numeric codes. The adapter does not translate codes into those filenames; old A–K directories are unsuitable as Custom bases for the current API.

## API-key upgrades

Older releases stored the key in plaintext `apikey`. The adapter now uses encrypted/protected `apiKey`. On first start or settings save, the old value is transferred and `apikey` is cleared; weather requests wait for a startup migration to finish. Existing nonempty `apiKey` values are preserved. If both fields contain different nonempty keys, neither is discarded automatically; migration failures stop requests and log a message without key values.

Until first start/save, the legacy field retains its old plaintext storage and access behavior. Disabled instances migrate only when started or saved. Reopen settings after an adapter upgrade rather than saving an old dialog.

Keep an ioBroker backup before upgrading. To roll back to a version that reads only `apikey`, restore its corresponding configuration backup too. Manually encrypted keys from modified/unreleased versions require their original encryption metadata and cannot be identified reliably after that metadata has been overwritten.

## Development build

Source builds require Node.js **22.12+** within the supported runtime range; Vite has a higher minimum than the adapter runtime. CI checks/builds on Node.js 24 and tests on 22/24/26.

```sh
npm ci
npm run build
npm test
npm pack
```

Admin sources live in `admin/src/`. Generated `admin/custom/` files are ignored by Git and must not be committed. Build before testing, packing or uploading; ordinary `npm pack` does not build automatically. The published npm package contains the UI assets, and `prepublishOnly` rebuilds them for publication. For a source/Git installation, install the built tarball through ioBroker; an unbuilt checkout has no generated configuration UI.

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
- (reloxx13) Explain configuration switches, data sources, provider endpoints and request counts; simplify translated help texts and group location fields as Country/Language and Location/Station
- (reloxx13) Hide the redundant icon-set selector; show custom URL/format fields and let a nonempty URL select custom icons in runtime and preview
- (reloxx13) Make regional current weather, visibility and air quality opt-in; clarify PWS, forecast coverage and icon settings
- (reloxx13) Show zero UV index and solar radiation instead of blank readings
- (reloxx13) Add hourly gust, dew point, wind chill, weather text and precipitation type; daily sun/moon events; PWS quality status and detailed EPA pollutant states
- (reloxx13) Restore current visibility and maximum-wind direction values; correct existing current icon URL objects to string type while preserving user metadata
- (reloxx13) Refresh documented requirements, forecast coverage, API-key usage and build instructions
- (reloxx13) Display the first hourly forecast as "Next hourly forecast" while preserving its 0h ID and custom channel names
- (reloxx13) Correct weather state roles and update existing object roles without changing IDs, types, units or user metadata (#328)
- (reloxx13) Fix numeric weather icon URLs and align the settings preview (#216)
- (reloxx13) Add the current EPA air quality index without replacing PWS measurements (#220)
- (reloxx13) Add localized current weather descriptions and separate short daily forecast descriptions while preserving PWS measurements and full narratives (#388)
- (reloxx13) End failed or stalled initialization reliably and cancel startup delays and provider requests during shutdown (#224)
- (reloxx13) Automatically migrate existing API keys to a new encrypted and protected configuration field
- (reloxx13) Replace the legacy settings dialog with JSON Config and preserve existing translations and options
- (reloxx13) Correct hourly forecast provider paths for metric and non-metric units
- (reloxx13) Limit the npm package to runtime and configuration assets and enable shared ESLint checks in CI
- (reloxx13) Fix hourly forecast requests using the supported endpoint and current station coordinates (#497)
- (reloxx13) Skip the unused PWS dashboard request when using the new API (#498)
- (reloxx13) Populate hourly forecast weather codes, including code zero (#499)
- (reloxx13) Use calendar-day minimum and maximum forecast temperatures (#500)
- (reloxx13) Correct the documented default refresh interval to once per hour (#501)
- (copilot) Adapter requires node.js >= 22 now
- (copilot) Adapter requires admin >= 7.7.22 now
- (copilot) Adapter requires js-controller >= 6.0.11 now

### 3.7.0 (2024-04-13)
* (mcm1957) Adapter requires node.js 18 and js-controller >= 5 now
* (mcm1957) Dependencies have been updated

### 3.6.0 (2023-09-09)
* (mcm1957) Icon urls at admin ui have been adapted to weatherunderground website changes (#158)
* (mcm1957) Forecast periods have been extended

### 3.5.0 (2023-09-08)
* (mcm1957) Adapter now requires node 16 or newer
* (mcm1957) Dependencies have been updated
* (waldmensch1) Cloudcover states have been added (PR #178)
* (mcm1957) Date format has been fixed to avoid incorrect display with newer admin versions (#191)
* (mcm1957) Forecast urls have been adapted to weatherunderground website changes (#158)

### 3.4.3 (2023-08-15)
* (Aplollon77) Translations have been updated (#159)
* (mcm1957) The testenvironment has been updated to use node 16/18/20
* (bluefox) Dependencies have been updated

### 3.4.2 (2022-04-26)
* (Apollon77) Added special logging when no current observation data are available because Station most likely offline to reduce confusion

### 3.4.1 (2022-03-13)
* (bluefox) Use axios for communication
* (bluefox) make sure date states are filled correctly

### 3.4.0 (2022-03-10)
* (Apollon77) If no official API-Key is used: Move schedule if default is used to better spread the requests over time to prevent peaks; Additionally add a random delay in the start minute
* (Apollon77) Further optimizations and additional logging

### 3.3.1 (2021-06-28)
* (Apollon77) Optimize for js-controller 3.3

### 3.3.0 (2021-01-22)
* (Apollon77) Optimize for js-controller 3.2
* (Apollon77) js-controller 2.0 is now required at least

### 3.2.5 (2020-12-27)
* (Apollon77) Prevent crash case (Sentry IOBROKER-WEATHERUNDERGROUND-1, IOBROKER-WEATHERUNDERGROUND-2)

### 3.2.3 (2020-12-26)
* (Apollon77) make sure adapter do not crash when no data could be read
* (Apollon77) Add Sentry error reporting

### 3.2.2 (2020-12-02)
* (Apollon77) icons sometimes did not have a correct extension
* (Apollon77) Correct some cases with different types of locations when reading data

### 3.2.1
* (raintonr) Corrected 'Imperial' terminology.

### 3.2.0 (2019-12-28)
* (StrathCole) fix forecast expiry time
* (StrathCole) add visibility index to objects on hourly forecast

### 3.1.6 (2019-10-16)
* (Bjoern3003) adjust to WU changes, now v3 API for hourly data
* (Apollon77) run once after installation/update

### 3.1.3
* (Apollon77) text correction

### 3.1.2 (2019-07-27)
* (Apollon77) use new parameters to get decimal precision values

### 3.1.1 (2019-07-14)
* (Apollon77) add windDirection as string calculated based on degrees

### 3.1.0 (2019-07-12)
* (Apollon77) remove option for legacy API because disabled by WU

### 3.0.14 (2019-07-11)
* (Apollon77) optimize checking of pws station id

### 3.0.13 (2019-07-10)
* (Apollon77) Fix error in image url handling

### 3.0.12 (2019-07-09)
* (Apollon77) Re-Fetch PWS station key on Error 401

### 3.0.11 (2019-06-04)
* (Apollon77) Use a fallback ID after the dashboard fallback page became unavailable

### 3.0.10 (2019-05-27)
* (Apollon77) Adopt logic to WU changes

### 3.0.8 (2019-03-23)
* (Apollon77) Add additional guidance when location is not found by WU

### 3.0.7 (2019-03-22)
* (Apollon77) implement to extract used "legacy" API keys out of WU website to allow restore of functionality for now
* (Apollon77) Also extract API keys for newer API version from website to be usable together with real "PWS owner keys" in future
* (Apollon77) optionally get data using the New APIs (as well as the officially available PWS-Owner APIs as also additional ones to restore functionality)
* (Apollon77) Admin 2 support removed and adapted the Admin 3 texts as needed for now

### 2.0.4 (2018-08-19)
* (René) some typos
* (bluefox) Write only numbers and not strings

### 2.0.3 (2018-07-30)
* (bluefox) Warning! Breaking changes! States are renamed.
* (bluefox) Refactoring of states and roles

### 1.1.2 (2017-11-24)
* (Apollon77) Add option to specify image format for custom image urls

### 1.1.1 (2017-11-08)
* (Apollon77) Optimize API usage by getting all data with one call instead of two
* (Apollon77) Add support for multiple API-Keys

### 1.1.0 (2017-10-30)
* (Apollon77) Add option to overwrite Icon Base URL

### 1.0.8 (2017-07-12)
* (DeepCoreSystem) add 2 current observation values, fixes of some datapoint caps.

### 1.0.7 (2017-06-19)
* (Dutchman) add Dutch language suppport

### 1.0.6 (2017-05-16)
* (Rene) bug fixing
	+ all 4 sets are enabled as default
	+ change of checkbox enables saves button

### 1.0.5 (2017-05-14)
* (Rene) hourly forecast extend to 36h

### 1.0.4 (2017-04-09)
* (Rene) parse much more data
   + today's 24 h
   + next 4 days / nights as text
   + next 4 days
   + current values
   each can be enabled or disabled

### 1.0.3 (2016-11-01)
* (bluefox) Catch parse errors

### 1.0.2 (2016-10-29)
* (Apollon77) make sure precip values are always integers

### 1.0.1 (2016-07-21)
* (jens-maus) conversion from feet to meter for observation_location

### 1.0.0 (2016-07-12)
* (Apollon77) add daily rain level forecast

### 0.2.0 (2016-07-01)
* (Apollon77) Add Error handling and station-usage for forcasts

### 0.1.1 (2016-06-07)
* (ploebb) Fix forecast api URL

### 0.1.0 (2016-05-07)
* (bluefox) convert text to floats
* (bluefox) support languages

### 0.0.5
corrected humidity value within current weather info (slice + unit)

### 0.0.4
checking for spaces in location
added current conditions

### 0.0.3
bugfix in summed pop-value.

### 0.0.2
config dialog fixed

### 0.0.1
initial release with all basics to load WU-forecast data

[Older changelogs can be found there](CHANGELOG_OLD.md)

## License

The MIT License (MIT)

Copyright (c) 2024-2026 iobroker-community-adapters <iobroker-community-adapters@gmx.de>  
Copyright (c) 2015-2023 dschaedl <daniel.schaedler@gmail.com>, iobroker-community-adapters

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
