# Batch Poster Monitor

The Batch Poster Monitor is a package that allows you to monitor the progress of batch poster jobs in real-time. It provides a simple and intuitive interface to track the status of your batch poster jobs and view detailed information about each job.

## Installation

To install the Batch Poster Monitor package, simply run the following command:

```bash
npm install @orbit-retryable-tracker/batch-poster-monitor
```

## Usage

To use the Batch Poster Monitor package, follow these steps:

1. Import the package into your project:

```javascript
import { BatchPosterMonitor } from '@orbit-retryable-tracker/batch-poster-monitor'
```

2. Initialize the monitor with the necessary configuration:

```javascript
const monitor = new BatchPosterMonitor({
  endpoint: 'https://api.example.com/batch-poster',
  apiKey: 'YOUR_API_KEY',
})
```

3. Start monitoring the batch poster jobs:

```javascript
monitor.start()
```

4. Access the monitor's UI to view the progress and details of the jobs:

```javascript
monitor.openUI()
```

## Configuration Options

The Batch Poster Monitor package supports the following configuration options:

- `endpoint` (required): The API endpoint for the batch poster service.
- `apiKey` (required): Your API key for authentication with the batch poster service.
- `refreshInterval` (optional): The interval (in milliseconds) at which the monitor should refresh the job status. Default is 5000ms.

## Contributing

Contributions are welcome! If you have any ideas, suggestions, or bug reports, please open an issue or submit a pull request on the [GitHub repository](https://github.com/Orbit-retryable-tracker/batch-poster-monitor).

## License

This package is licensed under the [MIT License](https://opensource.org/licenses/MIT).
