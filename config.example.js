'use strict';

module.exports = {
    influx: {
        host: '127.0.0.1',
        database: 'nest_tracking'
    },
    sdm: {
        // Device Access Project ID (not the Google Cloud project ID)
        projectId: '',
        clientId: '',
        clientSecret: '',
        refreshToken: '',
        // Map SDM resource name (recommended), SDM device ID, or customName
        // to the existing InfluxDB device_id tag value.
        deviceMappings: {
            // 'enterprises/DEVICE_ACCESS_PROJECT_ID/devices/SDM_DEVICE_ID': 'old-device-id'
        }
    }
};
