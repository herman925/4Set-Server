import http.client
import json
import time # Needed for potential polling later
import zipfile # Needed for unzipping later
import io # Needed for handling zip in memory
import os # Needed for path joining in save_final_data
from config import API_BASE_URL, API_PATH_PREFIX # <--- ADD API_PATH_PREFIX HERE
import traceback

# --- Get Survey List ---

def get_survey_list(api_key):
    """Gets the list of surveys accessible by the API key."""
    print("API: Getting survey list...")
    conn = None # Initialize conn to None
    surveys = []
    endpoint = "/API/v3/surveys"
    headers = {
        'Accept': "application/json",
        'X-API-TOKEN': api_key
    }
    
    try:
        conn = http.client.HTTPSConnection(API_BASE_URL)
        conn.request("GET", endpoint, headers=headers)
        res = conn.getresponse()
        status = res.status
        data = res.read().decode("utf-8")
        print(f"API Response Status (Get Surveys): {status}")
        
        if 200 <= status < 300:
            response_data = json.loads(data)
            survey_elements = response_data.get('result', {}).get('elements', [])
            for item in survey_elements:
                if item and 'id' in item and 'name' in item:
                    surveys.append({"id": item['id'], "name": item['name']})
            print(f"Found {len(surveys)} surveys.")
            # Return successfully parsed list
            return surveys 
        else:
            # Handle non-2xx status codes (API errors)
            error_msg = f"HTTP Error {status}"
            try:
                error_details = json.loads(data)
                error_msg = error_details.get('meta', {}).get('error', {}).get('errorMessage', error_msg)
            except json.JSONDecodeError:
                 # Keep the basic HTTP error if JSON parsing fails
                 error_msg += f": {data}" 
            print(f"Failed to get survey list: {error_msg}")
            raise Exception(f"API Error getting survey list: {error_msg}")
            
    except http.client.HTTPException as http_err:
        # Handle potential connection errors more specifically
        print(f"HTTP connection error getting surveys: {http_err}")
        raise Exception(f"HTTP connection error getting surveys: {http_err}")
    except json.JSONDecodeError as json_err:
        # Handle cases where successful status (2xx) returns invalid JSON
        print(f"Error decoding JSON response for survey list: {json_err}")
        raise Exception(f"Error decoding survey list response: {json_err}")
    except Exception as e:
        # Catch any other unexpected errors
        print(f"Unexpected error during get_survey_list request: {e}")
        traceback.print_exc() # Log full traceback for unexpected errors
        raise Exception(f"Unexpected error getting surveys: {e}")
    finally:
        # Ensure connection is always closed if it was opened
        if conn:
            conn.close()
            print("Connection closed for get_survey_list.")
            
    # Code should not reach here if successful return or exception occurs
    # But as a failsafe, return the potentially empty list
    return surveys 

# --- Get Survey Definition --- 

def get_survey_definition(api_key, survey_id):
    """Gets the survey definition (structure, questions, etc.) from Qualtrics."""
    print(f"API: Getting definition for Survey ID: {survey_id}")
    conn = http.client.HTTPSConnection(API_BASE_URL)
    headers = {
        'Accept': "application/json",
        'X-API-TOKEN': api_key
    }
    endpoint = f"{API_PATH_PREFIX}{survey_id}"
    
    try:
        conn.request("GET", endpoint, headers=headers)
        res = conn.getresponse()
        status = res.status
        data = res.read().decode("utf-8")
        print(f"API Response Status (Get Definition): {status}")
        
        if 200 <= status < 300:
            return json.loads(data)
        else:
            # Try to parse error from response, otherwise raise generic error
            try: 
                error_details = json.loads(data)
                error_msg = error_details.get('meta', {}).get('error', {}).get('errorMessage', 'Unknown API error')
            except json.JSONDecodeError:
                error_msg = f"HTTP Error {status}: {data}"
            raise Exception(f"Failed to get survey definition: {error_msg}")
    except Exception as e:
        print(f"Error in get_survey_definition: {e}")
        raise # Re-raise the exception to be caught upstream
    finally:
        conn.close()

def parse_survey_fields(survey_definition):
    """Parses the survey definition JSON to extract structured field lists."""
    fields = {
        "questions": [],
        "embeddedData": [],
        "metadata": []
    }
    
    if not survey_definition or 'result' not in survey_definition:
        print("Warning: Invalid or empty survey definition received.")
        return fields
        
    survey_info = survey_definition['result']
    
    # Extract Questions
    if 'questions' in survey_info:
        for qid, q_data in survey_info['questions'].items():
            # Simple text extraction, might need refinement for complex questions
            q_text = q_data.get('questionText', '').replace('\n', ' ').strip()
            # Remove HTML tags crudely
            while '<' in q_text and '>' in q_text:
                start = q_text.find('<')
                end = q_text.find('>')
                if start < end:
                    q_text = q_text[:start] + q_text[end+1:]
                else:
                    break # Avoid infinite loop on malformed tags
            q_text = q_text[:100] + '...' if len(q_text) > 100 else q_text # Truncate long text
            fields['questions'].append({"id": qid, "name": q_text or f"Question {qid}"})

    # Extract Embedded Data Fields (from Flow)
    if 'flow' in survey_info:
        for flow_item in survey_info['flow']:
            if flow_item.get('type') == 'EmbeddedData' and 'field' in flow_item:
                 # Check if field already exists by id (name)
                if not any(f['id'] == flow_item['field'] for f in fields['embeddedData']):
                    fields['embeddedData'].append({"id": flow_item['field'], "name": flow_item['field']})

    # Standard Metadata Fields (these are predefined by Qualtrics)
    # List from: https://api.qualtrics.com/reference/createresponseexport
    standard_metadata = [
        {"id": "startDate", "name": "Start Date"},
        {"id": "endDate", "name": "End Date"},
        {"id": "status", "name": "Response Type"},
        {"id": "ipAddress", "name": "IP Address"},
        {"id": "progress", "name": "Progress"},
        {"id": "duration", "name": "Duration (in seconds)"},
        {"id": "finished", "name": "Finished"},
        {"id": "recordedDate", "name": "Recorded Date"},
        {"id": "_recordId", "name": "Response ID"}, # Note: _recordId is often used internally
        {"id": "locationLatitude", "name": "Location Latitude"},
        {"id": "locationLongitude", "name": "Location Longitude"},
        {"id": "recipientLastName", "name": "Recipient Last Name"},
        {"id": "recipientFirstName", "name": "Recipient First Name"},
        {"id": "recipientEmail", "name": "Recipient Email"},
        {"id": "externalDataReference", "name": "External Data Reference"},
        {"id": "distributionChannel", "name": "Distribution Channel"},
    ]
    fields['metadata'] = standard_metadata
    
    return fields

# --- Start Response Export --- 

def extract_survey_data(api_key, survey_id, export_options):
    """
    Starts the process of extracting survey data from Qualtrics API 
    based on provided options and returns the initial response JSON string.
    
    Args:
        api_key: The Qualtrics API Token.
        survey_id: The ID of the Qualtrics survey.
        export_options: Dictionary containing export parameters like 
                        'format', 'useLabels', 'compress', 'questionIds', etc.
        
    Returns:
        The decoded initial API response string (likely containing progress info).
    """
    print(f"API: Starting export for Survey ID: {survey_id}")
    conn = http.client.HTTPSConnection(API_BASE_URL)
    
    # Construct the payload from export_options (ensure format is present)
    payload_dict = {'format': export_options.get('format', 'csv')}
    payload_dict.update(export_options) # Merge all options
    
    # Remove format key again if it was None initially and got added by update
    if 'format' in payload_dict and payload_dict['format'] is None:
        del payload_dict['format']
        payload_dict['format'] = 'csv' # Ensure it exists

    payload = json.dumps(payload_dict)
    print(f"API Payload (Start Export): {payload}") 
    
    headers = {
        'Content-Type': "application/json",
        'Accept': "application/json",
        'X-API-TOKEN': api_key # Use the provided API key
    }
    
    endpoint = f"{API_PATH_PREFIX}{survey_id}/export-responses"
    
    try:
        conn.request("POST", endpoint, payload, headers)
        res = conn.getresponse()
        status = res.status
        data = res.read().decode("utf-8")
        print(f"API Response Status (Start Export): {status}")

        if 200 <= status < 300:
            # Success - response body contains progress info
            return data
        else:
            # Try to parse error from response
            try: 
                error_details = json.loads(data)
                error_msg = error_details.get('meta', {}).get('error', {}).get('errorMessage', 'Unknown API error')
            except json.JSONDecodeError:
                error_msg = f"HTTP Error {status}: {data}"
            raise Exception(f"Failed to start export: {error_msg}")

    except Exception as e:
        print(f"Error in extract_survey_data: {e}")
        raise
    finally:
        conn.close()

# --- Check Export Progress ---

def check_export_progress(api_key, survey_id, progress_id):
    """Checks the progress of an ongoing survey response export."""
    print(f"API: Checking progress for Export ID: {progress_id}")
    conn = http.client.HTTPSConnection(API_BASE_URL)
    headers = {
        'Accept': "application/json",
        'X-API-TOKEN': api_key
    }
    endpoint = f"{API_PATH_PREFIX}{survey_id}/export-responses/{progress_id}"
    progress_data = None
    try:
        conn.request("GET", endpoint, headers=headers)
        res = conn.getresponse()
        status = res.status
        data = res.read().decode("utf-8")
        print(f"API Response Status (Check Progress): {status}")
        
        if 200 <= status < 300:
            progress_data = json.loads(data)
        else:
            try: 
                error_details = json.loads(data)
                error_msg = error_details.get('meta', {}).get('error', {}).get('errorMessage', f'HTTP Error {status}')
            except json.JSONDecodeError:
                error_msg = f"HTTP Error {status}: {data}"
            print(f"Failed to check progress: {error_msg}")
            progress_data = None # Keep as None on failure
    except Exception as e:
        print(f"Error during check_export_progress request: {e}")
        progress_data = None # Indicate failure
    finally:
        conn.close()
    # Returns dict with status, percentComplete, fileId (if ready), or None on failure
    return progress_data 

# --- Download Export File ---

def download_export_file(api_key, survey_id, file_id):
    """Downloads the generated export file (CSV, JSON, ZIP etc.). Returns file content as bytes."""
    print(f"API: Downloading file ID: {file_id}")
    conn = http.client.HTTPSConnection(API_BASE_URL)
    headers = {
        'Accept': "application/octet-stream, application/json",
        'X-API-TOKEN': api_key
    }
    endpoint = f"{API_PATH_PREFIX}{survey_id}/export-responses/{file_id}/file"
    
    try:
        conn.request("GET", endpoint, headers=headers)
        res = conn.getresponse()
        status = res.status
        response_headers = res.getheaders()
        print(f"API Response Status (Download File): {status}")
        
        if 200 <= status < 300:
            file_data = res.read()
            print(f"Successfully downloaded {len(file_data)} bytes.")
            content_type = dict(response_headers).get('Content-Type', '')
            is_zip = 'application/zip' in content_type or dict(response_headers).get('Content-Disposition', '').endswith('.zip')
            print(f"Is Zip File: {is_zip} (Content-Type: {content_type})")
            
            if is_zip:
                print("Attempting to unzip downloaded file...")
                try:
                    with io.BytesIO(file_data) as zip_buffer:
                        with zipfile.ZipFile(zip_buffer, 'r') as zip_ref:
                            file_list = zip_ref.namelist()
                            if not file_list:
                                raise Exception("ZIP file is empty.")
                            extracted_filename = file_list[0]
                            print(f"Extracting {extracted_filename} from ZIP...")
                            return zip_ref.read(extracted_filename) 
                except Exception as zip_e:
                     print(f"Error during unzipping: {zip_e}")
                     raise Exception(f"Failed to unzip downloaded file: {zip_e}")
            else:
                return file_data # Return raw bytes if not zip
        else:
            error_data = res.read().decode('utf-8', errors='ignore')
            try: 
                error_details = json.loads(error_data)
                error_msg = error_details.get('meta', {}).get('error', {}).get('errorMessage', 'Unknown API error')
            except json.JSONDecodeError:
                error_msg = f"HTTP Error {status}: {error_data}"
            raise Exception(f"Failed to download file ({file_id}): {error_msg}")

    except Exception as e:
        print(f"Error in download_export_file function: {e}")
        raise # Re-raise exception
    finally:
        conn.close()

# --- Save Final Data --- 

def save_final_data(file_content_bytes, filename):
    """Saves the final downloaded survey data (bytes) to a file."""
    print(f"Saving final data ({len(file_content_bytes)} bytes) to {filename}")
    try:
        # Check if this is a CSV file
        if filename.lower().endswith('.csv'):
            # For CSV files, add UTF-8 BOM and ensure proper encoding
            print(f"Adding UTF-8 BOM to CSV file: {filename}")
            # UTF-8 BOM is the byte sequence: EF BB BF
            utf8_bom = b'\xef\xbb\xbf'
            # If the file doesn't already have a BOM, add it
            if not file_content_bytes.startswith(utf8_bom):
                file_content_bytes = utf8_bom + file_content_bytes
        
        # Write the file with BOM if it's a CSV
        with open(filename, 'wb') as file:
            file.write(file_content_bytes)
        print(f"Successfully saved final data to {filename}")
        return filename
    except Exception as e:
        print(f"Error saving final data to {filename}: {e}")
        raise

# --- Save Initial Response (for Debugging) --- 

def save_to_csv(data, filename):
    """Saves the initial API response JSON string or other debug data to a file."""
    print(f"DEBUG: Saving initial response/debug data to: {filename}")
    try:
        content_to_write = data
        if not isinstance(data, str):
            try:
                content_to_write = json.dumps(data, indent=4)
            except TypeError as json_err:
                print(f"Warning: Could not serialize debug data to JSON: {json_err}")
                content_to_write = str(data)
                
        with open(filename, 'w', encoding='utf-8') as file:
            file.write(content_to_write)
    except Exception as e:
        print(f"Error saving debug data to {filename}: {e}")
    return filename
