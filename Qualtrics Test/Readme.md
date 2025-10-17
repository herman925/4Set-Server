# Api References

List Out Surveys: https://api.qualtrics.com/2c55b7ff8b0c7-list-surveys
Survey Data Retrieval: https://api.qualtrics.com/1179a68b7183c-retrieve-a-survey-response

## Operational Mindset

This web application is designed with the following principles in mind:

1.  **User-Centricity:** Focus on a smooth, intuitive interface for downloading survey data.
2.  **Efficiency:** Automate fetching survey responses to save user time.
3.  **Reliability:** Use the official Qualtrics API for consistent and accurate data retrieval.
4.  **Security:** Handle API tokens and data securely. (Note: Specify security details elsewhere if needed).
5.  **Maintainability:** Keep the code organized and documented for easy updates.

## How it Works

This application uses Python with the `eel` library to create a simple web-based graphical user interface (GUI).

1.  **Launch:** Running `Run App.py` checks for the `eel` library (installing it if needed) and then starts `app.py`.
2.  **Backend (`app.py`):** 
    *   Initializes the `eel` web server (serving files from `web/`).
    *   Exposes Python functions to the frontend using `eel.expose`.
    *   Orchestrates the main workflow: fetches survey lists and fields, starts exports, polls for completion, downloads, and saves data. It uses `qualtrics_api.py` for API calls and `config.py` for credentials.
    *   Manages the full export process, including polling and downloading.
    *   Includes error handling, like retrying exports if the API reports invalid columns.
3.  **Frontend (`web/` directory - mainly `index.html` and associated JS/CSS):
    *   Provides the UI for survey selection and export options.
    *   Calls backend Python functions (e.g., `eel.get_surveys()`) to perform actions.
    *   Displays status updates and results.
4.  **API Interaction (`qualtrics_api.py`):
    *   Contains functions making direct HTTPS requests to Qualtrics API v3 endpoints (using `http.client`).
    *   Handles fetching survey lists/definitions, starting exports (`/export-responses`), checking progress, and downloading files.
    *   Includes logic to automatically unzip downloaded archives.
5.  **Configuration (`config.py`):** Stores the Qualtrics API token and base URL.

## Technical Details

Here's a breakdown of the key scripts:

### `Run App.py`
*   **Entry Point:** This is the script users should run to start the application.
*   **Dependency Check:** Verifies if the `eel` library is installed using `importlib.util.find_spec`.
*   **Dependency Installation:** If `eel` is missing, it attempts to install it using `subprocess.check_call` with `pip`.
*   **Application Launch:** Executes `app.py` using `subprocess.call` to start the main web application.

### `app.py`
*   **Web Framework:** Uses `eel` to bridge Python and a web frontend (HTML/JS/CSS). `eel.init()` sets up the web root, and `eel.start()` launches the server and browser window.
*   **Frontend Communication:** Functions decorated with `@eel.expose` can be called directly from JavaScript in the frontend. It returns data (like survey lists or status messages) as dictionaries, often converted to JSON implicitly by `eel`.
*   **Workflow Orchestration:** Manages the multi-step process of downloading survey data:
    *   Calls `get_surveys()` (exposed) -> `qualtrics_api.get_survey_list()`.
    *   Calls `get_survey_fields()` (exposed) -> `qualtrics_api.get_survey_definition()` -> `qualtrics_api.parse_survey_fields()`.
    *   Calls `get_survey_data()` (exposed):
        *   Calls `qualtrics_api.extract_survey_data()` to initiate the export.
        *   Enters a polling loop, calling `qualtrics_api.check_export_progress()` periodically (`time.sleep`).
        *   If successful, calls `qualtrics_api.download_export_file()`.
        *   Calls `qualtrics_api.save_final_data()` to write the file to disk.
*   **Error Handling:** Includes `try...except` blocks. Notably, it uses `re.search` to detect "invalid columns" errors from the API response, modifies the `export_options` to remove those columns, and retries the `extract_survey_data` call.
*   **Favicon:** Contains a function `generate_favicon()` to create a default `favicon.ico` in the `web` directory if one doesn't exist, preventing 404 errors.

### `qualtrics_api.py`
*   **API Client:** Uses Python's built-in `http.client.HTTPSConnection` for making requests to the Qualtrics API (`API_BASE_URL` from `config.py`).
*   **Request Structure:** Sets appropriate headers (`X-API-TOKEN`, `Content-Type`, `Accept`) for each request. Payloads for POST requests (like starting an export) are created using `json.dumps`.
*   **Response Handling:** Reads response status codes and body content (`res.read().decode('utf-8')`). Parses JSON responses using `json.loads`. Checks for non-2xx status codes and attempts to extract error messages from the API response body.
*   **File Download & Unzip:** The `download_export_file` function checks the `Content-Type` header. If it indicates a zip file (`application/zip`), it uses `io.BytesIO` and the `zipfile` module to extract the first file from the archive in memory before returning its content as bytes. Otherwise, it returns the raw response bytes.
*   **Saving:** `save_final_data` simply writes the received bytes to a local file using standard file I/O (`open(..., 'wb')`).

### `config.py`
*   **Configuration Storage:** A simple module holding global constants: `API_TOKEN`, `API_BASE_URL`, and `API_PATH_PREFIX`. These are imported by other modules.

### `favicon_generator.py`
*   **Standalone Script:** If run directly (`if __name__ == "__main__":`), it generates the `favicon.ico` file in the `web` directory. Its core logic (`generate_favicon` function) is duplicated within `app.py` for convenience when running the main application.







