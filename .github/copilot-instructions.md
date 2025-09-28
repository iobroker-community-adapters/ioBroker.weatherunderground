# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

**WeatherUnderground Adapter Context:**
This adapter connects to Weather Underground (WeatherUnderground.com) to provide weather forecasting data for smart home automation. The adapter:
- Fetches 24-hour weather forecasts for specified locations
- Supports both official PWS owner API keys and extracted web keys
- Provides 15-minute (default), hourly, and daily forecast data
- Handles multiple icon sets and image formats from WeatherUnderground
- Creates ioBroker states for current conditions, forecasts, and weather alerts
- Uses axios for HTTP requests to WeatherUnderground API endpoints
- Supports location-based forecasting using coordinates or weather station IDs

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        resolve();
                    } catch (err) {
                        console.error('❌ Integration test failed:', err);
                        reject(err);
                    }
                });
            });
        });
    }
});
```

#### Weather Adapter Specific Testing
For weather adapters like WeatherUnderground, include these test patterns:
- Test API connectivity with valid and invalid coordinates
- Verify forecast data structure and state creation
- Test icon URL generation and image format handling
- Mock WeatherUnderground API responses for consistent testing
- Test error handling for API rate limits and service outages
- Validate forecast period configuration (15min, hourly, daily)

## Logging

Use the ioBroker logging system with appropriate log levels:
- `error`: Critical errors, API failures, configuration issues
- `warn`: Non-critical warnings, deprecated API endpoints
- `info`: Important information like successful API connections, data updates
- `debug`: Detailed debugging information, API request/response data
- `silly`: Extremely detailed information for debugging

### Weather Adapter Logging Best Practices
```javascript
// Good logging for weather adapters
this.log.info('Successfully fetched weather data for location: ' + this.config.location);
this.log.debug('API response data: ' + JSON.stringify(weatherData, null, 2));
this.log.warn('Using extracted API key instead of official PWS key');
this.log.error('Failed to fetch weather data: ' + error.message);
```

## State Management

### ioBroker State Creation Patterns
Always follow these patterns for creating and updating states:

```javascript
// Create channel first, then states
await this.setObjectNotExistsAsync('forecast', {
    type: 'channel',
    common: {
        name: 'Weather Forecast'
    }
});

// Create states with proper type and role
await this.setObjectNotExistsAsync('forecast.temperature', {
    type: 'state',
    common: {
        name: 'Temperature',
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
        read: true,
        write: false
    }
});

// Always use setStateAsync for state updates
await this.setStateAsync('forecast.temperature', {
    val: temperatureValue,
    ack: true
});
```

### Weather Data State Organization
Organize weather data states logically:
- `currently.*` - Current weather conditions
- `hourly.*` - Hourly forecast data  
- `daily.*` - Daily forecast data
- `alerts.*` - Weather alerts and warnings
- `forecast.*` - General forecast information
- `info.connection` - API connection status

## Configuration Management

### Weather Adapter Configuration
Handle configuration properly with validation:

```javascript
// Validate required configuration
if (!this.config.location && !this.config.coordinates) {
    this.log.error('Location or coordinates must be configured');
    return;
}

// Support multiple location formats
if (this.config.coordinates) {
    // Handle lat,lng format
    const coords = this.config.coordinates.split(',');
    if (coords.length !== 2) {
        this.log.error('Invalid coordinates format. Use: latitude,longitude');
        return;
    }
}

// Handle API key configuration
if (this.config.apiKey) {
    this.log.info('Using provided API key');
} else {
    this.log.warn('No API key provided, using extracted web keys');
}
```

## HTTP Requests and API Integration

Use axios for HTTP requests with proper error handling:

```javascript
const axios = require('axios');

async function fetchWeatherData(url, config) {
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'ioBroker.weatherunderground'
            },
            ...config
        });
        
        if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        if (error.code === 'ENOTFOUND') {
            throw new Error('DNS resolution failed - check internet connection');
        } else if (error.code === 'ETIMEDOUT') {
            throw new Error('Request timeout - WeatherUnderground server may be slow');
        } else if (error.response?.status === 401) {
            throw new Error('Invalid API key or authentication failed');
        } else if (error.response?.status === 429) {
            throw new Error('API rate limit exceeded - reduce update frequency');
        }
        throw error;
    }
}
```

### Weather API Error Handling
Implement robust error handling for weather services:
- Handle API rate limiting gracefully
- Provide fallback behavior for service outages
- Validate API response data structure
- Log detailed error information for debugging
- Implement retry logic with exponential backoff

## Resource Management

### Proper Adapter Lifecycle
```javascript
async unload(callback) {
  try {
    // Clear all intervals and timeouts
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
    
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = undefined;
    }
    // Close connections, clean up resources
    callback();
  } catch (e) {
    callback();
  }
}
```

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### Practical Example: Complete API Testing Implementation
Here's a complete example based on lessons learned from the Discovergy adapter:

#### test/integration-demo.js
```javascript
const path = require("path");
const { tests } = require("@iobroker/testing");

// Helper function to encrypt password using ioBroker's encryption method
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    
    if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    
    return result;
}

// Run integration tests with demo credentials
tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("API Testing with Demo Credentials", (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it("Should connect to API and initialize with demo credentials", async () => {
                console.log("Setting up demo credentials...");
                
                if (harness.isAdapterRunning()) {
                    await harness.stopAdapter();
                }
                
                const encryptedPassword = await encryptPassword(harness, "demo_password");
                
                await harness.changeAdapterConfig("your-adapter", {
                    native: {
                        username: "demo@provider.com",
                        password: encryptedPassword,
                        // other config options
                    }
                });

                console.log("Starting adapter with demo credentials...");
                await harness.startAdapter();
                
                // Wait for API calls and initialization
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
                
                if (connectionState && connectionState.val === true) {
                    console.log("✅ SUCCESS: API connection established");
                    return true;
                } else {
                    throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
                        "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
                }
            }).timeout(120000);
        });
    }
});
```

## WeatherUnderground Adapter Specifics

### API Integration Patterns
```javascript
// Weather data fetching with error handling
async function fetchWeatherUndergroundData() {
    const baseUrl = 'https://api.weather.com/v1/'; // or appropriate endpoint
    
    try {
        // Build URL with location and API key
        const url = `${baseUrl}current/conditions.json`;
        const params = {
            key: this.config.apiKey,
            q: this.config.location,
            format: 'json'
        };
        
        const weatherData = await fetchWeatherData(url, { params });
        
        // Process and validate weather data
        if (!weatherData.current_observation) {
            throw new Error('Invalid weather data structure');
        }
        
        return weatherData;
    } catch (error) {
        this.log.error('Failed to fetch WeatherUnderground data: ' + error.message);
        throw error;
    }
}
```

### Icon URL Handling
Handle different WeatherUnderground icon sets properly:
```javascript
// Support multiple icon base URLs
const iconSets = {
    'a': 'https://www.wunderground.com/static/i/c/a/',
    'b': 'https://www.wunderground.com/static/i/c/b/',
    'c': 'https://www.wunderground.com/static/i/c/c/',
    'custom': this.config.customIconUrl
};

function getIconUrl(iconCode, iconSet = 'a') {
    const baseUrl = iconSets[iconSet] || iconSets['a'];
    return `${baseUrl}${iconCode}.gif`;
}
```

### Forecast Period Handling
Organize forecast data by time periods:
```javascript
// Create forecast states for different time periods  
const forecastPeriods = ['currently', 'hourly', 'daily'];

for (const period of forecastPeriods) {
    if (this.config[`create${period.charAt(0).toUpperCase() + period.slice(1)}`]) {
        await this.createForecastStates(period);
    }
}

async function createForecastStates(period) {
    await this.setObjectNotExistsAsync(period, {
        type: 'channel',
        common: { name: `${period} forecast` }
    });
    
    // Create specific states for this period
    const states = ['temperature', 'humidity', 'condition', 'icon'];
    for (const state of states) {
        await this.setObjectNotExistsAsync(`${period}.${state}`, {
            type: 'state',
            common: {
                name: state,
                type: getStateType(state),
                role: getStateRole(state),
                read: true,
                write: false
            }
        });
    }
}
```

This adapter enables comprehensive weather monitoring and automation integration within ioBroker smart home systems using WeatherUnderground's reliable weather data services.