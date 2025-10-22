import requests
import json
import time
from datetime import datetime

# Configuration
JOTFORM_API_KEY = "f45162cb1d42e5e725ef38c9ccc06915"
JOTFORM_FORM_ID = "252152307582049"
API_BASE_URL = "https://api.jotform.com"

def print_header(text):
    """Print formatted header"""
    print("\n" + "=" * 60)
    print(f"  {text}")
    print("=" * 60)

def test_api_basic():
    """Test 1: Basic API connectivity"""
    print_header("Test 1: Basic API Connectivity")
    
    try:
        url = f"{API_BASE_URL}/user"
        params = {"apiKey": JOTFORM_API_KEY}
        
        print(f"[TEST] Connecting to: {url}")
        print(f"[TEST] Timeout: 10 seconds")
        
        start_time = time.time()
        response = requests.get(url, params=params, timeout=10)
        elapsed = time.time() - start_time
        
        print(f"[RESULT] Status Code: {response.status_code}")
        print(f"[RESULT] Response Time: {elapsed:.2f}s")
        print(f"[RESULT] Content-Type: {response.headers.get('content-type', 'unknown')}")
        
        if response.status_code == 200:
            try:
                data = response.json()
                if 'content' in data:
                    print(f"[SUCCESS] ✅ API is responding correctly")
                    print(f"[INFO] User: {data['content'].get('username', 'unknown')}")
                    return True
            except json.JSONDecodeError as e:
                print(f"[ERROR] ❌ Invalid JSON response: {str(e)}")
                print(f"[DEBUG] Response preview: {response.text[:200]}")
                return False
        else:
            print(f"[ERROR] ❌ API returned error status: {response.status_code}")
            print(f"[DEBUG] Response: {response.text[:500]}")
            return False
            
    except requests.exceptions.Timeout:
        print(f"[ERROR] ❌ Request timed out after 10 seconds")
        return False
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] ❌ Connection failed: {str(e)}")
        return False

def test_form_access():
    """Test 2: Form metadata access"""
    print_header("Test 2: Form Metadata Access")
    
    try:
        url = f"{API_BASE_URL}/form/{JOTFORM_FORM_ID}"
        params = {"apiKey": JOTFORM_API_KEY}
        
        print(f"[TEST] Fetching form: {JOTFORM_FORM_ID}")
        
        start_time = time.time()
        response = requests.get(url, params=params, timeout=10)
        elapsed = time.time() - start_time
        
        print(f"[RESULT] Status Code: {response.status_code}")
        print(f"[RESULT] Response Time: {elapsed:.2f}s")
        
        if response.status_code == 200:
            try:
                data = response.json()
                if 'content' in data:
                    form = data['content']
                    print(f"[SUCCESS] ✅ Form accessible")
                    print(f"[INFO] Title: {form.get('title', 'N/A')}")
                    print(f"[INFO] Status: {form.get('status', 'N/A')}")
                    print(f"[INFO] Created: {form.get('created_at', 'N/A')}")
                    return True
            except json.JSONDecodeError as e:
                print(f"[ERROR] ❌ Invalid JSON: {str(e)}")
                return False
        else:
            print(f"[ERROR] ❌ Cannot access form: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"[ERROR] ❌ Request failed: {str(e)}")
        return False

def test_submissions_small():
    """Test 3: Small submissions fetch (10 records)"""
    print_header("Test 3: Small Submissions Fetch (10 records)")
    
    try:
        url = f"{API_BASE_URL}/form/{JOTFORM_FORM_ID}/submissions"
        params = {
            "apiKey": JOTFORM_API_KEY,
            "limit": 10,
            "offset": 0,
            "orderby": "created_at"
        }
        
        print(f"[TEST] Fetching 10 submissions...")
        
        start_time = time.time()
        response = requests.get(url, params=params, timeout=15)
        elapsed = time.time() - start_time
        
        print(f"[RESULT] Status Code: {response.status_code}")
        print(f"[RESULT] Response Time: {elapsed:.2f}s")
        print(f"[RESULT] Response Size: {len(response.content)} bytes")
        
        if response.status_code == 200:
            try:
                data = response.json()
                if 'content' in data:
                    count = len(data['content'])
                    print(f"[SUCCESS] ✅ Retrieved {count} submissions")
                    if count > 0:
                        print(f"[INFO] First submission ID: {data['content'][0].get('id', 'N/A')}")
                    return True
            except json.JSONDecodeError as e:
                print(f"[ERROR] ❌ JSON parse error: {str(e)}")
                print(f"[DEBUG] Content-Type: {response.headers.get('content-type')}")
                print(f"[DEBUG] First 200 chars: {response.text[:200]}")
                return False
        else:
            print(f"[ERROR] ❌ Request failed: {response.status_code}")
            if response.status_code == 504:
                print(f"[INFO] 504 = Gateway Timeout - JotForm server is slow/down")
            print(f"[DEBUG] Response: {response.text[:300]}")
            return False
            
    except requests.exceptions.Timeout:
        print(f"[ERROR] ❌ Request timed out")
        return False
    except Exception as e:
        print(f"[ERROR] ❌ Unexpected error: {str(e)}")
        return False

def test_submissions_large():
    """Test 4: Large submissions fetch (1000 records)"""
    print_header("Test 4: Large Submissions Fetch (1000 records)")
    
    try:
        url = f"{API_BASE_URL}/form/{JOTFORM_FORM_ID}/submissions"
        params = {
            "apiKey": JOTFORM_API_KEY,
            "limit": 1000,
            "offset": 0,
            "orderby": "created_at"
        }
        
        print(f"[TEST] Fetching up to 1000 submissions...")
        print(f"[TEST] Timeout: 60 seconds")
        
        start_time = time.time()
        response = requests.get(url, params=params, timeout=60)
        elapsed = time.time() - start_time
        
        print(f"[RESULT] Status Code: {response.status_code}")
        print(f"[RESULT] Response Time: {elapsed:.2f}s")
        print(f"[RESULT] Response Size: {len(response.content):,} bytes ({len(response.content)/1024/1024:.2f} MB)")
        
        if response.status_code == 200:
            try:
                # Force UTF-8 encoding
                response.encoding = 'utf-8'
                text = response.text
                print(f"[INFO] Text length: {len(text):,} characters")
                
                # Try to parse JSON
                data = json.loads(text)
                
                if 'content' in data:
                    count = len(data['content'])
                    print(f"[SUCCESS] ✅ Retrieved {count} submissions")
                    print(f"[INFO] Average response time: {elapsed/count:.3f}s per submission")
                    return True
                else:
                    print(f"[ERROR] ❌ Response missing 'content' field")
                    return False
                    
            except json.JSONDecodeError as e:
                print(f"[ERROR] ❌ JSON parse error at position {e.pos}")
                print(f"[ERROR] Message: {str(e)}")
                print(f"[DEBUG] Content-Type: {response.headers.get('content-type')}")
                print(f"[DEBUG] First 300 chars:")
                print(text[:300])
                print(f"[DEBUG] Last 300 chars:")
                print(text[-300:] if len(text) > 300 else text)
                
                # Check if it's an HTML error page
                if text.strip().startswith('<!DOCTYPE') or text.strip().startswith('<html'):
                    print(f"[ANALYSIS] Response is HTML error page, not JSON")
                    if '504' in text or 'not available' in text.lower():
                        print(f"[ANALYSIS] JotForm service is experiencing downtime")
                
                return False
                
        else:
            print(f"[ERROR] ❌ Request failed: {response.status_code}")
            if response.status_code == 504:
                print(f"[ANALYSIS] 504 Gateway Timeout - JotForm backend is overloaded")
            elif response.status_code == 503:
                print(f"[ANALYSIS] 503 Service Unavailable - JotForm is down for maintenance")
            print(f"[DEBUG] Response preview: {response.text[:500]}")
            return False
            
    except requests.exceptions.Timeout:
        print(f"[ERROR] ❌ Request timed out after 60 seconds")
        print(f"[ANALYSIS] JotForm API is too slow or unresponsive")
        return False
    except Exception as e:
        print(f"[ERROR] ❌ Unexpected error: {str(e)}")
        return False

def test_submissions_medium():
    """Test 5: Medium submissions fetch (100 records) - Production batch size"""
    print_header("Test 5: Medium Submissions Fetch (100 records)")
    
    try:
        url = f"{API_BASE_URL}/form/{JOTFORM_FORM_ID}/submissions"
        params = {
            "apiKey": JOTFORM_API_KEY,
            "limit": 100,
            "offset": 0,
            "orderby": "created_at"
        }
        
        print(f"[TEST] Fetching 100 submissions (production batch size)...")
        print(f"[TEST] Timeout: 30 seconds")
        
        start_time = time.time()
        response = requests.get(url, params=params, timeout=30)
        elapsed = time.time() - start_time
        
        print(f"[RESULT] Status Code: {response.status_code}")
        print(f"[RESULT] Response Time: {elapsed:.2f}s")
        print(f"[RESULT] Response Size: {len(response.content):,} bytes ({len(response.content)/1024/1024:.2f} MB)")
        
        if response.status_code == 200:
            try:
                response.encoding = 'utf-8'
                data = response.json()
                
                if 'content' in data:
                    count = len(data['content'])
                    print(f"[SUCCESS] ✅ Retrieved {count} submissions")
                    print(f"[INFO] This is the recommended batch size for production")
                    return True
                else:
                    print(f"[ERROR] ❌ Response missing 'content' field")
                    return False
                    
            except json.JSONDecodeError as e:
                print(f"[ERROR] ❌ JSON parse error: {str(e)}")
                return False
                
        else:
            print(f"[ERROR] ❌ Request failed: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"[ERROR] ❌ Unexpected error: {str(e)}")
        return False

def main():
    """Run all tests"""
    print("\n")
    print("╔════════════════════════════════════════════════════════════╗")
    print("║         JotForm API Health Check Diagnostic Tool          ║")
    print("╠════════════════════════════════════════════════════════════╣")
    print(f"║  Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}                          ║")
    print(f"║  Form ID: {JOTFORM_FORM_ID}                             ║")
    print("╚════════════════════════════════════════════════════════════╝")
    
    results = []
    
    # Run tests
    results.append(("Basic API", test_api_basic()))
    results.append(("Form Access", test_form_access()))
    results.append(("Small Fetch (10)", test_submissions_small()))
    results.append(("Medium Fetch (100)", test_submissions_medium()))
    results.append(("Large Fetch (1000)", test_submissions_large()))
    
    # Summary
    print_header("Test Summary")
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name:20} {status}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed! JotForm API is fully operational.")
    elif passed > 0:
        print("\n⚠️  Partial failure. JotForm API has limited functionality.")
    else:
        print("\n🚨 All tests failed. JotForm API is down or unreachable.")
        print("Recommendation: Wait 10-15 minutes and try again.")
        print("Check status: https://status.jotform.com/")
    
    print("\n")

if __name__ == "__main__":
    main()
