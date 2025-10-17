import sys
import subprocess
import importlib.util
import os
from datetime import datetime
import traceback
import base64
import time # Needed for polling sleep
import json # Needed for parsing initial response
import re # Ensure re is imported
import shutil # For checking if executable exists

# Try importing Eel, but handle the case where it's not installed
try:
    import eel
    EEL_AVAILABLE = True
except ImportError:
    EEL_AVAILABLE = False

# --- Import Config and API functions ---
from config import API_TOKEN # Import the token from config
from qualtrics_api import (
    extract_survey_data, save_to_csv, 
    get_survey_definition, parse_survey_fields,
    check_export_progress, # New import
    download_export_file,  # New import
    save_final_data,       # New import
    get_survey_list        # New import
)

# Generate favicon
def generate_favicon():
    """Generate a simple favicon.ico file in the web directory"""
    print("Checking for favicon.ico...")
    
    web_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
    favicon_path = os.path.join(web_dir, "favicon.ico")
    
    if os.path.exists(favicon_path):
        print("Favicon already exists.")
        return True
    
    print("Generating favicon.ico file...")
    # Simple red square favicon (base64 encoded)
    favicon_data = "AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAABILAAASCwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAuLi4ALi4uDC4uLksuLi5+Li4ukS4uLnsuLi5HLi4uCi4uLgAAAAAAAAAAAAAAAAAAAAAAAAAALS0tAC0tLQAtLS0gLS0tjy0tLeMtLS38LS0t/S0tLeQtLS2RLS0tIS0tLQAtLS0AAAAAAAAAAAAAAAAAAAAAACoqKgAqKio2KioqxyoqKv8qKir/Kioq/yoqKv8qKir/KioqyCoqKjcqKioAAAAAAAAAAAAAAAAmJiYAJiYmACYmJgAmJiZrJiYm9CYmJv8mJib/JiYm/yYmJv8mJib/JiYm9CYmJmwmJiYAJiYmACYmJgAAAAAAIyMjACMjIw0jIyOEIyMj/yMjI/8jIyP/IyMj/yMjI/8jIyP/IyMj/yMjI/8jIyP/IyMj/yMjI/8jIyOFIyMjDSMjIwAAAAAAHx8fAB8fHwAfHx9QHx8f8R8fH/8fHx//Hx8f/x8fH/8fHx//Hx8f/x8fH/8fHx//Hx8f/x8fH/8fHx//Hx8f8h8fH1EfHx8AHx8fABwcHAAbGxtOGxsb8RsbG/8bGxv/Gxsb/xsbG/8bGxv/Gxsb/xsbG/8bGxv/Gxsb/xsbG/8bGxv/GxsbThwcHAAXFxcAFxcXhRcXF/8XFxf/FxcX/xcXF/8XFxf/FxcX/xcXF/8XFxf/FxcX/xcXF/8XFxf/FxcX/xcXF4UXFxcAExMTDRMTE/4TExP/ExMT/xMTE/8TExP/ExMT/xMTE/8TExP/ExMT/xMTE/8TExP/ExMT/xMTE/8TExP+ExMTDQ8PDwAPDw9rDw8P/w8PD/8PDw//Dw8P/w8PD/8PDw//Dw8P/w8PD/8PDw//Dw8P/w8PD/8PDw//Dw8P/w8PD2sLCwsACwsLAAsLC8gLCwv/CwsL/wsLC/8LCwv/CwsL/wsLC/8LCwv/CwsL/wsLC/8LCwv/CwsL/wsLC/8LCwvIBgYGAAYGBgAGBgY3BgYG/wYGBv8GBgb/BgYG/wYGBv8GBgb/BgYG/wYGBv8GBgb/BgYG/wYGBv8GBgb/BgYGNwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAP//AAD8PwAA+B8AAPAPAADgBwAA4AcAAMADAADAAwAAwAMAAMADAADgBwAA4AcAAPAPAAD//wAA//8AAA=="

    # Ensure web directory exists
    os.makedirs(web_dir, exist_ok=True)
    
    # Decode and save
    try:
        favicon_bin = base64.b64decode(favicon_data)
        with open(favicon_path, "wb") as f:
            f.write(favicon_bin)
        print(f"Favicon created at {favicon_path}")
        return True
    except Exception as e:
        print(f"Error creating favicon: {e}")
        return False

# Check if Eel is installed
def is_eel_installed():
    return importlib.util.find_spec("eel") is not None

# Install Eel using pip
def install_eel_package():
    try:
        print("Installing Eel via pip...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "eel"])
        return {"success": True}
    except subprocess.CalledProcessError as e:
        print(f"Error installing Eel: {e}")
        return {"success": False}

def get_browser_mode():
    """
    Determine the best browser mode to use, with fallback from Chrome to Edge to default.
    This function checks for browser availability in the following order:
    1. Chrome - preferred browser
    2. Edge - fallback option
    3. Default - uses system default browser if neither Chrome nor Edge is found
    """
    # Common paths for Chrome
    chrome_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expanduser(r"~\AppData\Local\Google\Chrome\Application\chrome.exe")
    ]
    
    # Common paths for Edge
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        os.path.expanduser(r"~\AppData\Local\Microsoft\Edge\Application\msedge.exe")
    ]
    
    # Check if Chrome is available
    chrome_available = any(os.path.exists(path) for path in chrome_paths)
    if chrome_available:
        print("✅ Chrome detected - using Chrome")
        return 'chrome'
    
    # Check if Edge is available
    edge_available = any(os.path.exists(path) for path in edge_paths)
    if edge_available:
        print("✅ Edge detected - falling back to Edge")
        return 'edge'
    
    # Fallback to default mode (will open in default browser)
    print("⚠️ Neither Chrome nor Edge found - using default browser")
    return None

# Main application setup
def main():
    global EEL_AVAILABLE
    
    # Generate favicon to avoid 404 errors
    generate_favicon()
    
    if not EEL_AVAILABLE:
        print("Eel is not installed. Installing...")
        result = install_eel_package()
        if result["success"]:
            print("Eel installed successfully. Attempting to import...")
            try:
                import eel
                EEL_AVAILABLE = True
                print("Eel import successful after installation.")
            except ImportError:
                print("Failed to import Eel after installation. Please restart the application.")
                sys.exit(1)
        else:
            print("Failed to install Eel. Please run 'pip install eel' manually.")
            sys.exit(1)
    
    # Initialize Eel
    try:
        print("Initializing Eel...")
        import eel 
        
        web_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
        eel.init(web_dir, allowed_extensions=['.js', '.html', '.css', '.ico', '.png'])
        print("Eel initialized successfully")
        
        # --- Eel Exposed Functions --- 

        @eel.expose
        def install_eel():
            """Exposed function to install Eel from the frontend"""
            return install_eel_package()
        
        @eel.expose
        def get_surveys():
            """Gets the list of surveys accessible via API_TOKEN."""
            print("Fetching survey list...")
            try:
                survey_list = get_survey_list(API_TOKEN)
                return {"success": True, "surveys": survey_list}
            except Exception as e:
                print(f"Error getting survey list: {e}")
                # Don't print traceback here usually, just log the error
                # traceback.print_exc()
                return {"success": False, "message": f"Error getting survey list: {str(e)}"}

        @eel.expose
        def get_survey_fields(survey_id):
            """Gets the survey definition using API_TOKEN from config."""
            print(f"Fetching fields for survey: {survey_id}")
            try:
                survey_definition = get_survey_definition(API_TOKEN, survey_id)
                fields = parse_survey_fields(survey_definition)
                print(f"Successfully parsed fields: Q:{len(fields.get('questions',[]))}, ED:{len(fields.get('embeddedData',[]))}, M:{len(fields.get('metadata',[]))}")
                return {"success": True, "fields": fields}
            except Exception as e:
                print(f"Error getting/parsing survey fields: {e}")
                traceback.print_exc()
                return {"success": False, "message": f"Error getting survey fields: {str(e)}"}

        @eel.expose
        def get_survey_data(survey_id, export_options):
            """Starts export, handles invalid columns, polls, downloads, saves."""
            print(f"Starting export process for survey: {survey_id} with options: {export_options}")
            initial_response_str = None
            skipped_fields = []
            current_export_options = export_options.copy()
            survey_name = "Unknown Survey" # Default survey name

            try:
                # --- Get Survey Name ---
                try:
                    all_surveys = get_survey_list(API_TOKEN) # Fetches all surveys
                    for survey in all_surveys:
                        if survey.get('id') == survey_id:
                            survey_name = survey.get('name', "Unknown Survey")
                            break
                    print(f"Survey Name: {survey_name}")
                except Exception as e:
                    print(f"Warning: Could not fetch survey name for {survey_id}: {e}")
                    # Continue with default name if fetching fails

                # --- Try starting the export (potentially multiple attempts) ---
                max_attempts = 2 # Allow one retry
                for attempt in range(max_attempts):
                    try:
                        print(f"Attempt {attempt + 1}/{max_attempts}: Exporting with options: {current_export_options}")
                        initial_response_str = extract_survey_data(API_TOKEN, survey_id, current_export_options)
                        print(f"Attempt {attempt + 1} successful.")
                        # If successful, break the retry loop
                        break 
                    except Exception as e:
                        error_message = str(e)
                        print(f"Attempt {attempt + 1} failed: {error_message}")
                        
                        # If this was the last attempt, re-raise the error to be caught by outer block
                        if attempt == max_attempts - 1:
                            raise e

                        # --- Check for specific invalid columns error --- 
                        # Regex updated to be more flexible and capture IDs
                        # Looks for variations of "invalid columns? ... requested: [ <IDs> ]"
                        match = re.search(r"invalid columns?(?:.+?)requested:\s*\[([^\]]+)\]", error_message, re.IGNORECASE)
                        
                        if match:
                            invalid_ids_str = match.group(1)
                            # Split potentially comma-separated IDs and strip whitespace/quotes
                            invalid_ids = [qid.strip().strip('\'"') for qid in invalid_ids_str.split(',')]
                            
                            if invalid_ids: 
                                print(f"Identified invalid field(s) in error: {invalid_ids}")
                                # Add newly found invalid IDs to the overall skipped list
                                new_skips = [qid for qid in invalid_ids if qid not in skipped_fields]
                                if new_skips:
                                     skipped_fields.extend(new_skips)
                                
                                # Modify options for the *next* attempt
                                # Handle potential absence of keys gracefully
                                for key_to_check in ['questionIds', 'embeddedDataIds', 'surveyMetadataIds']:
                                     if key_to_check in current_export_options:
                                        original_ids = current_export_options.get(key_to_check, [])
                                        # Filter out *all* known invalid IDs found so far
                                        valid_ids = [qid for qid in original_ids if qid not in skipped_fields]
                                        current_export_options[key_to_check] = valid_ids
                                        print(f"Removed invalid IDs from {key_to_check}. New list: {valid_ids}")
                                
                                print("Proceeding to next attempt with modified options...")
                                # Continue to the next iteration of the loop for the retry
                                continue 
                            else:
                                print("Warning: Matched 'invalid columns' error but couldn't parse IDs. Raising error.")
                                raise e # Re-raise original error if parsing failed
                        else:
                            # If it's a different error, break the retry loop and re-raise immediately
                            raise e 
                # --- End of Retry Loop ---

                # Check if we broke the loop due to success
                if initial_response_str is None:
                     # This should only happen if all attempts failed with non-retryable errors
                     raise Exception("Export failed after all attempts.")

                # --- Proceed with successful response --- 
                initial_response = json.loads(initial_response_str)
                
                progress_id = initial_response.get('result', {}).get('progressId')
                if not progress_id:
                    raise Exception(f"Could not find progressId in initial response: {initial_response_str}")
                
                print(f"Export polling started. Progress ID: {progress_id}")
                # Optional: Save initial response for debugging - COMMENTED OUT
                # debug_filename = f"survey_{survey_id}_export_start_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
                # save_to_csv(initial_response, os.path.join(os.path.dirname(os.path.abspath(__file__)), debug_filename))

                # Step 2: Poll for Completion
                file_id = None
                start_time = time.time()
                timeout_seconds = 300 # 5 minutes timeout for polling
                poll_interval_seconds = 5 # Check every 5 seconds
                
                while time.time() - start_time < timeout_seconds:
                    progress_status = check_export_progress(API_TOKEN, survey_id, progress_id)
                    
                    if progress_status is None:
                        # Error during check, maybe retry or fail?
                        print(f"Polling failed for {progress_id}. Retrying in {poll_interval_seconds}s...")
                        time.sleep(poll_interval_seconds)
                        continue # Retry the check
                    
                    status = progress_status.get('result', {}).get('status')
                    percent = progress_status.get('result', {}).get('percentComplete', 0)
                    print(f"Polling Status ({progress_id}): {status}, Progress: {percent}%")
                    
                    if status == "complete":
                        file_id = progress_status.get('result', {}).get('fileId')
                        if not file_id:
                            raise Exception(f"Export complete, but fileId missing in status: {progress_status}")
                        print(f"Export complete! File ID: {file_id}")
                        break # Exit polling loop
                    elif status == "failed":
                        raise Exception(f"Export failed. Status check response: {progress_status}")
                    elif status == "inProgress" or status is None:
                        # Wait before checking again
                        time.sleep(poll_interval_seconds)
                    else: 
                        # Unexpected status
                        raise Exception(f"Unexpected export status '{status}'. Response: {progress_status}")
                else:
                    # Loop finished without break - timeout!
                    raise Exception(f"Export polling timed out after {timeout_seconds} seconds for progressId {progress_id}.")

                # Step 3: Download the File
                if not file_id:
                    raise Exception("Polling loop finished unexpectedly without a fileId.")
                
                file_content_bytes = download_export_file(API_TOKEN, survey_id, file_id)

                # Step 4: Save the Final File
                # Use the format requested in options for the final filename extension
                file_format_extension = current_export_options.get('format', 'csv').lower()
                # Handle potential zip content - filename should reflect final format
                if current_export_options.get('compress', False) and file_format_extension != 'zip':
                    # API might have zipped it even if we didn't ask, or download function unzipped it.
                    # We assume download_export_file returns the unzipped content bytes.
                    # So the final filename uses the requested format.
                    pass # Filename already correct
                    
                timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
                # final_filename = f"survey_{survey_id}_data_{timestamp}.{file_format_extension}"
                # New filename format: YYYYMMDDHHMMSS - Survey Name (Survey ID).extension
                sanitized_survey_name = "".join(c if c.isalnum() or c in " .-_()" else "_" for c in survey_name) # Sanitize survey name
                #final_filename = f"{timestamp} - {sanitized_survey_name} ({survey_id}).{file_format_extension}"
                final_filename = f"{sanitized_survey_name} ({survey_id}).{file_format_extension}"
                final_filepath = os.path.join(os.path.dirname(os.path.abspath(__file__)), final_filename)
                
                save_final_data(file_content_bytes, final_filepath)
                
                # --- Construct Final Message --- (Append skipped fields info)
                success_message = f"Survey data successfully downloaded and saved to {final_filename}"
                if skipped_fields:
                    success_message += f" (Note: Processing failed after identifying invalid fields: {', '.join(skipped_fields)})"
                
                return {
                    "success": True,
                    "message": success_message,
                    "filepath": final_filepath
                }

            except Exception as e:
                print(f"Error during export process: {e}")
                traceback.print_exc()
                # Include skipped fields in the error message if any were identified before failure
                error_detail = str(e)
                if skipped_fields:
                    error_detail += f" (Note: Processing failed after identifying invalid fields: {', '.join(skipped_fields)})"
                return {
                    "success": False,
                    "message": f"Error during export process: {error_detail}"
                }
        
        # --- Online View API for Eel ---
        if EEL_AVAILABLE:
            import eel
            
            @eel.expose
            def get_survey_list_online():
                try:
                    surveys = get_survey_list(API_TOKEN)
                    return {"success": True, "surveys": surveys}
                except Exception as e:
                    return {"success": False, "message": str(e)}

            @eel.expose
            def get_survey_responses_online(survey_id):
                try:
                    # Use JSON export format, do NOT include useLabels (not allowed)
                    export_options = {
                        'format': 'json',
                        'compress': False
                    }
                    initial_response = extract_survey_data(API_TOKEN, survey_id, export_options)
                    # The extract_survey_data returns initial API response, need to poll for completion
                    progress_id = None
                    try:
                        resp_json = json.loads(initial_response)
                        progress_id = resp_json.get('result', {}).get('progressId')
                    except Exception as e:
                        return {"success": False, "message": f"Error parsing initial response: {e}"}
                    if not progress_id:
                        return {"success": False, "message": "No progressId in initial response."}
                    # Poll for completion (reuse check_export_progress)
                    timeout_seconds = 60
                    poll_interval = 2
                    waited = 0
                    while waited < timeout_seconds:
                        progress_status = check_export_progress(API_TOKEN, survey_id, progress_id)
                        status = progress_status.get('result', {}).get('status')
                        if status == 'complete':
                            file_id = progress_status.get('result', {}).get('fileId')
                            break
                        elif status == 'failed':
                            return {"success": False, "message": "Qualtrics export failed."}
                        time.sleep(poll_interval)
                        waited += poll_interval
                    else:
                        return {"success": False, "message": "Timed out waiting for export to complete."}
                    # Download the file (should be JSON)
                    file_bytes = download_export_file(API_TOKEN, survey_id, file_id)
                    # Parse JSON from bytes
                    try:
                        data_str = file_bytes.decode('utf-8-sig')
                        data_json = json.loads(data_str)
                        responses = data_json.get('responses', [])
                        # Each response is a dict; flatten as needed
                        flat_responses = []
                        for r in responses:
                            entry = r.get('values', {})
                            entry['responseId'] = r.get('responseId', '')
                            flat_responses.append(entry)
                        return {"success": True, "responses": flat_responses}
                    except Exception as e:
                        return {"success": False, "message": f"Error parsing downloaded JSON: {e}"}
                except Exception as e:
                    return {"success": False, "message": str(e)}
        
        # Start the application
        print("Starting Eel application...")
        browser_mode = get_browser_mode()
        
        if browser_mode:
            # Use specific browser mode
            eel.start('index.html', mode=browser_mode, host='localhost', port=8000, size=(1000, 900))
        else:
            # Use default mode (opens in default browser)
            eel.start('index.html', host='localhost', port=8000, size=(1000, 900))
        
    except Exception as e:
        print(f"Error initializing the application: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    print("Starting application...")
    main()
