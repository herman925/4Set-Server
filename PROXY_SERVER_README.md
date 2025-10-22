# JotForm CORS Proxy Server

## Overview

This proxy server solves CORS (Cross-Origin Resource Sharing) issues when making JotForm API requests from browser-based applications. The JotForm API doesn't include CORS headers, which prevents direct API calls from web browsers. This proxy forwards requests to the JotForm API and adds the necessary CORS headers.

## Why is this needed?

When you try to make a direct fetch request to `https://api.jotform.com` from a browser, you'll encounter this error:

```
Access to fetch at 'https://api.jotform.com/...' from origin 'http://127.0.0.1:3000' 
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present 
on the requested resource.
```

The proxy server acts as an intermediary that:
1. Receives requests from your browser application
2. Forwards them to the JotForm API
3. Returns the response with proper CORS headers

## Installation

### Prerequisites

- Python 3.7 or higher
- pip (Python package manager)

### Install Dependencies

```bash
pip install -r requirements.txt
```

This will install:
- Flask (web framework)
- Flask-CORS (CORS handling)
- requests (HTTP client)

## Usage

### Start the Proxy Server

**Basic Usage:**
```bash
python proxy_server.py
```

This starts the server on `http://127.0.0.1:3000` (default).

**Custom Port:**
```bash
python proxy_server.py --port 8080
```

**Custom Host:**
```bash
python proxy_server.py --host 0.0.0.0 --port 3000
```

**Debug Mode:**
```bash
python proxy_server.py --debug
```

### Command Line Options

- `--port`: Port to listen on (default: 3000)
- `--host`: Host to bind to (default: 127.0.0.1)
- `--debug`: Enable Flask debug mode

## API Endpoints

### 1. Form Submissions

**Endpoint:** `/api/jotform/form/<form_id>/submissions`

**Method:** GET

**Example:**
```
http://127.0.0.1:3000/api/jotform/form/252152307582049/submissions?apiKey=YOUR_API_KEY&limit=1000&offset=0
```

**Parameters:**
- `apiKey` (required): Your JotForm API key
- `limit` (optional): Number of submissions per page (default: 1000)
- `offset` (optional): Offset for pagination (default: 0)
- `orderby` (optional): Field to order by (e.g., created_at)
- `direction` (optional): Sort direction (ASC or DESC)

### 2. Form Questions

**Endpoint:** `/api/jotform/form/<form_id>/questions`

**Method:** GET

**Example:**
```
http://127.0.0.1:3000/api/jotform/form/252152307582049/questions?apiKey=YOUR_API_KEY
```

**Parameters:**
- `apiKey` (required): Your JotForm API key

### 3. Health Check

**Endpoint:** `/health`

**Method:** GET

**Returns:**
```json
{
  "status": "ok",
  "service": "jotform-proxy"
}
```

### 4. Service Info

**Endpoint:** `/`

**Method:** GET

**Returns:** Service information and available endpoints

## Configuration in JavaScript

The proxy is configured in the JavaScript files with these settings:

```javascript
const PROXY_CONFIG = {
  enabled: true,  // Set to false to use direct API calls (will fail due to CORS)
  baseUrl: 'http://127.0.0.1:3000'  // Proxy server URL
};
```

**Files using the proxy:**
- `assets/js/jotform-cache.js`
- `assets/js/jotform-resync.js`

## Security Considerations

⚠️ **Important Security Notes:**

1. **API Key Exposure:** This proxy passes API keys as URL parameters. In production, consider:
   - Using environment variables for API keys on the server side
   - Implementing authentication for the proxy itself
   - Using HTTPS for encrypted communication

2. **Access Control:** The proxy currently allows all CORS origins. For production:
   - Restrict CORS to specific domains
   - Implement rate limiting
   - Add authentication/authorization

3. **Local Development Only:** This proxy is designed for local development. For production:
   - Deploy to a secure server with HTTPS
   - Use environment variables for sensitive configuration
   - Implement proper logging and monitoring

## Troubleshooting

### Port Already in Use

If you see an error like:
```
OSError: [Errno 48] Address already in use
```

Either:
1. Stop the other process using port 3000
2. Use a different port: `python proxy_server.py --port 8080`

### Connection Refused

If the browser shows "Failed to fetch" or "Connection refused":
1. Ensure the proxy server is running
2. Check that the port matches in both the server and JavaScript configuration
3. Verify the `baseUrl` in `PROXY_CONFIG` matches the server address

### CORS Errors Still Occurring

If you still see CORS errors:
1. Verify `PROXY_CONFIG.enabled` is set to `true` in the JavaScript files
2. Check that the proxy server is running and accessible
3. Clear browser cache and reload the page

### JotForm API Errors

If you get 401 Unauthorized or 403 Forbidden:
- Verify your JotForm API key is correct
- Check that your JotForm account has access to the form
- Ensure the form ID is correct

## Development

### Running Tests

```bash
# Test the health endpoint
curl http://127.0.0.1:3000/health

# Test with a real form (replace with your credentials)
curl "http://127.0.0.1:3000/api/jotform/form/YOUR_FORM_ID/submissions?apiKey=YOUR_API_KEY&limit=1"
```

### Logging

The server logs all requests and responses to stdout. In debug mode, you'll see detailed Flask debug information.

## Production Deployment

For production use, consider:

1. **Use a Production WSGI Server:**
   ```bash
   pip install gunicorn
   gunicorn -w 4 -b 0.0.0.0:3000 proxy_server:app
   ```

2. **Environment Variables:**
   Store sensitive configuration in environment variables instead of hardcoding.

3. **Reverse Proxy:**
   Use nginx or Apache as a reverse proxy in front of the Flask app.

4. **HTTPS:**
   Always use HTTPS in production to encrypt API keys in transit.

5. **Rate Limiting:**
   Implement rate limiting to prevent abuse.

## License

This proxy server is part of the 4Set System project.
