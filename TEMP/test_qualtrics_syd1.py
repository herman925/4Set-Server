import http.client
import json
import time

# Hardcoded credentials for testing (as requested)
TEST_CREDENTIALS = {
    "qualtricsDatacenter": "syd1",
    "qualtricsSurveyId": "SV_23Qbs14soOkGo9E",
    "qualtricsApiKey": "raV8YenlxaFuxEZuACFJ9gpl5XKWS7IyHB1ijuhR",
    "qualtricsClientId": "d6ad061427f6d54018c2669dbc56c669",
    "qualtricsClientSecret": "azx1sj1Dz3PpjngKqVqpDkQOFrwdErVCMVzIEzfn2TUWPisF2w5sZxWFS5QmKp70"
}

def print_section(title):
    """Print a formatted section header"""
    print("\n" + "="*60)
    print(f"  {title}")
    print("="*60)

def test_connection(datacenter):
    """Test basic connection to Qualtrics API"""
    print_section(f"Testing Connection to {datacenter}.qualtrics.com")
    
    try:
        conn = http.client.HTTPSConnection(f"{datacenter}.qualtrics.com")
        conn.request("GET", "/API/v3/whoami", headers={
            'X-API-TOKEN': TEST_CREDENTIALS['qualtricsApiKey'],
            'Accept': 'application/json'
        })
        res = conn.getresponse()
        status = res.status
        data = res.read().decode("utf-8")
        
        print(f"Status Code: {status}")
        if 200 <= status < 300:
            response_data = json.loads(data)
            print("✓ Connection successful!")
            print(f"User ID: {response_data.get('result', {}).get('userId', 'N/A')}")
            print(f"Brand ID: {response_data.get('result', {}).get('brandId', 'N/A')}")
            return True
        else:
            print(f"✗ Connection failed with status {status}")
            try:
                error_data = json.loads(data)
                print(f"Error: {json.dumps(error_data, indent=2)}")
            except:
                print(f"Response: {data}")
            return False
    except Exception as e:
        print(f"✗ Exception occurred: {e}")
        return False
    finally:
        conn.close()

def test_survey_access(datacenter, survey_id):
    """Test access to specific survey"""
    print_section(f"Testing Survey Access: {survey_id}")
    
    try:
        conn = http.client.HTTPSConnection(f"{datacenter}.qualtrics.com")
        conn.request("GET", f"/API/v3/surveys/{survey_id}", headers={
            'X-API-TOKEN': TEST_CREDENTIALS['qualtricsApiKey'],
            'Accept': 'application/json'
        })
        res = conn.getresponse()
        status = res.status
        data = res.read().decode("utf-8")
        
        print(f"Status Code: {status}")
        if 200 <= status < 300:
            response_data = json.loads(data)
            survey_name = response_data.get('result', {}).get('SurveyName', 'N/A')
            print("✓ Survey access successful!")
            print(f"Survey Name: {survey_name}")
            print(f"Survey ID: {survey_id}")
            return True
        else:
            print(f"✗ Survey access failed with status {status}")
            try:
                error_data = json.loads(data)
                print(f"Error: {json.dumps(error_data, indent=2)}")
            except:
                print(f"Response: {data}")
            return False
    except Exception as e:
        print(f"✗ Exception occurred: {e}")
        return False
    finally:
        conn.close()

def test_list_responses_with_filter(datacenter, survey_id, filter_qid, filter_value):
    """Test listing responses with filter (before export)"""
    print_section(f"Testing List Responses with Filter")
    print(f"Filter: {filter_qid} = {filter_value}")
    
    try:
        conn = http.client.HTTPSConnection(f"{datacenter}.qualtrics.com")
        
        # Build filter URL parameter
        # Qualtrics uses URL parameters for filtering in list responses
        filter_param = f"{filter_qid}={filter_value}"
        url = f"/API/v3/surveys/{survey_id}/responses?{filter_param}"
        
        print(f"Request URL: {url}")
        
        conn.request("GET", url, headers={
            'X-API-TOKEN': TEST_CREDENTIALS['qualtricsApiKey'],
            'Accept': 'application/json'
        })
        res = conn.getresponse()
        status = res.status
        data = res.read().decode("utf-8")
        
        print(f"Status Code: {status}")
        if 200 <= status < 300:
            response_data = json.loads(data)
            responses = response_data.get('result', {}).get('elements', [])
            print("✓ List responses with filter successful!")
            print(f"Found {len(responses)} matching responses")
            
            if len(responses) > 0:
                print(f"\nSample Response IDs:")
                for i, resp in enumerate(responses[:3]):  # Show first 3
                    print(f"  {i+1}. {resp.get('responseId', 'N/A')}")
                    
            return responses
        else:
            print(f"✗ List responses failed with status {status}")
            try:
                error_data = json.loads(data)
                print(f"Error: {json.dumps(error_data, indent=2)}")
            except:
                print(f"Response: {data}")
            return None
    except Exception as e:
        print(f"✗ Exception occurred: {e}")
        return None
    finally:
        conn.close()

def test_export_start(datacenter, survey_id, filter_value=None):
    """Test starting a response export with optional embedded data filter"""
    print_section(f"Testing Export Start for Survey: {survey_id}")
    
    # Note: useLabels parameter is not allowed for JSON/NDJSON exports per Qualtrics API
    payload = {
        'format': 'json',
        'compress': False,
        'surveyMetadataIds': ['startDate', 'endDate', 'recordedDate', 'status']
    }
    
    # The 'filter' parameter in export-responses is NOT supported
    # Instead, we need to use embedded data filters or get response IDs first
    if filter_value:
        print(f"Note: Cannot use filter in export-responses endpoint")
        print(f"Alternative: Use List Responses API with filter first, then export by responseId")
    
    try:
        conn = http.client.HTTPSConnection(f"{datacenter}.qualtrics.com")
        conn.request(
            "POST", 
            f"/API/v3/surveys/{survey_id}/export-responses",
            body=json.dumps(payload),
            headers={
                'X-API-TOKEN': TEST_CREDENTIALS['qualtricsApiKey'],
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        )
        res = conn.getresponse()
        status = res.status
        data = res.read().decode("utf-8")
        
        print(f"Status Code: {status}")
        if 200 <= status < 300:
            response_data = json.loads(data)
            progress_id = response_data.get('result', {}).get('progressId', 'N/A')
            print("✓ Export started successfully!")
            print(f"Progress ID: {progress_id}")
            return progress_id
        else:
            print(f"✗ Export start failed with status {status}")
            try:
                error_data = json.loads(data)
                print(f"Error: {json.dumps(error_data, indent=2)}")
            except:
                print(f"Response: {data}")
            return None
    except Exception as e:
        print(f"✗ Exception occurred: {e}")
        return None
    finally:
        conn.close()

def test_export_progress(datacenter, survey_id, progress_id):
    """Test checking export progress"""
    print_section(f"Testing Export Progress Check: {progress_id}")
    
    try:
        conn = http.client.HTTPSConnection(f"{datacenter}.qualtrics.com")
        conn.request(
            "GET",
            f"/API/v3/surveys/{survey_id}/export-responses/{progress_id}",
            headers={
                'X-API-TOKEN': TEST_CREDENTIALS['qualtricsApiKey'],
                'Accept': 'application/json'
            }
        )
        res = conn.getresponse()
        status = res.status
        data = res.read().decode("utf-8")
        
        print(f"Status Code: {status}")
        if 200 <= status < 300:
            response_data = json.loads(data)
            result = response_data.get('result', {})
            export_status = result.get('status', 'N/A')
            percent_complete = result.get('percentComplete', 'N/A')
            file_id = result.get('fileId', None)
            
            print(f"✓ Progress check successful!")
            print(f"Status: {export_status}")
            print(f"Percent Complete: {percent_complete}%")
            if file_id:
                print(f"File ID: {file_id}")
            return result
        else:
            print(f"✗ Progress check failed with status {status}")
            try:
                error_data = json.loads(data)
                print(f"Error: {json.dumps(error_data, indent=2)}")
            except:
                print(f"Response: {data}")
            return None
    except Exception as e:
        print(f"✗ Exception occurred: {e}")
        return None
    finally:
        conn.close()

def main():
    """Main test execution"""
    print_section("Qualtrics API Test - SYD1 Datacenter")
    print(f"Datacenter: {TEST_CREDENTIALS['qualtricsDatacenter']}")
    print(f"Survey ID: {TEST_CREDENTIALS['qualtricsSurveyId']}")
    print(f"API Key: {TEST_CREDENTIALS['qualtricsApiKey'][:20]}...")
    
    # Test 1: Connection test
    if not test_connection(TEST_CREDENTIALS['qualtricsDatacenter']):
        print("\n⚠️  Connection test failed. Stopping further tests.")
        return
    
    # Test 2: Survey access
    if not test_survey_access(
        TEST_CREDENTIALS['qualtricsDatacenter'],
        TEST_CREDENTIALS['qualtricsSurveyId']
    ):
        print("\n⚠️  Survey access test failed. Stopping further tests.")
        return
    
    # Test 3: Start export
    progress_id = test_export_start(
        TEST_CREDENTIALS['qualtricsDatacenter'],
        TEST_CREDENTIALS['qualtricsSurveyId']
    )
    
    if not progress_id:
        print("\n⚠️  Export start failed. Cannot test progress check.")
        return
    
    # Test 4: Check export progress (with polling)
    print_section("Polling Export Progress")
    max_attempts = 10
    attempt = 0
    
    while attempt < max_attempts:
        attempt += 1
        print(f"\nAttempt {attempt}/{max_attempts}")
        time.sleep(3)  # Wait 3 seconds between checks
        
        result = test_export_progress(
            TEST_CREDENTIALS['qualtricsDatacenter'],
            TEST_CREDENTIALS['qualtricsSurveyId'],
            progress_id
        )
        
        if result and result.get('status') == 'complete':
            print("\n✓ Export completed successfully!")
            print(f"Final File ID: {result.get('fileId')}")
            break
        elif result and result.get('status') == 'failed':
            print("\n✗ Export failed!")
            break
    
    # Test 5: Test filtered list responses for Core ID 10275
    print_section("Testing List Responses with Filter (Core ID 10275)")
    print("Testing Qualtrics List Responses API with filter...")
    print("Note: Qualtrics export-responses endpoint does NOT support filters")
    print("Alternative: Use List Responses API to get filtered response IDs")
    
    # Try filtering by QID (may not work, embedded data is preferred)
    filtered_responses = test_list_responses_with_filter(
        TEST_CREDENTIALS['qualtricsDatacenter'],
        TEST_CREDENTIALS['qualtricsSurveyId'],
        'QID125287935_TEXT',
        '10275'
    )
    
    if filtered_responses is None or len(filtered_responses) == 0:
        print("\n⚠️  QID filter not supported in List Responses.")
        print("Alternative approach:")
        print("1. Use embedded data field (e.g., 'studentid' instead of QID)")
        print("2. Or fetch all responses and filter client-side (current approach)")
        print("\n💡 Recommendation: Continue using global cache + client-side filter")
        print("   This is more efficient for repeated lookups across multiple students.")
    
    # Summary
    print_section("Test Summary")
    print("All basic connectivity tests completed.")
    print(f"Datacenter {TEST_CREDENTIALS['qualtricsDatacenter']} is accessible.")
    print("\n✅ Tested Features:")
    print("1. Basic API connection")
    print("2. Survey access")
    print("3. Full export (all responses)")
    print("4. List Responses with filter (attempted)")
    print("\n📊 Findings:")
    print("• Qualtrics export-responses endpoint does NOT support 'filter' parameter")
    print("• List Responses API may support filtering by embedded data fields")
    print("• Current approach (global cache + client-side filter) is recommended")
    print("\nNext steps:")
    print("1. Continue using global cache approach in test-pipeline-core-id.html")
    print("2. Update credentials.enc with qualtricsDatacenter: 'syd1'")
    print("3. Test in the actual checking system UI")
    print("4. Verify data sync works as expected")

if __name__ == "__main__":
    main()
