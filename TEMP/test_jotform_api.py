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
    """Test 4: Large submissions fetch (500 records)"""
    print_header("Test 4: Large Submissions Fetch (500 records)")
    
    try:
        url = f"{API_BASE_URL}/form/{JOTFORM_FORM_ID}/submissions"
        params = {
            "apiKey": JOTFORM_API_KEY,
            "limit": 500,
            "offset": 0,
            "orderby": "created_at"
        }
        
        print(f"[TEST] Fetching up to 500 submissions...")
        print(f"[TEST] Timeout: 45 seconds")
        
        start_time = time.time()
        response = requests.get(url, params=params, timeout=45)
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

def determine_grade_from_sessionkey(sessionkey):
    """Determine grade from sessionkey using Aug-Jul school year cycle"""
    if not sessionkey or '_' not in sessionkey:
        return 'Unknown'
    
    try:
        # Extract date from sessionkey format: "10034_20250916_10_45"
        parts = sessionkey.split('_')
        if len(parts) < 2:
            return 'Unknown'
        
        date_str = parts[1]
        if len(date_str) != 8:
            return 'Unknown'
        
        year = int(date_str[:4])
        month = int(date_str[4:6])
        
        # School year starts in August
        if month >= 8:
            school_year_start = year
        else:
            school_year_start = year - 1
        
        # K1: Aug 2023 - Jul 2024
        # K2: Aug 2024 - Jul 2025
        # K3: Aug 2025 - Jul 2026
        if school_year_start == 2023:
            return 'K1'
        elif school_year_start == 2024:
            return 'K2'
        elif school_year_start == 2025:
            return 'K3'
        else:
            return 'Unknown'
    except:
        return 'Unknown'

def test_total_submission_count():
    """Test 6: Get total raw submission count with within-source merge simulation"""
    print_header("Test 6: Total Raw Submission Count + Merge Simulation")
    
    try:
        url = f"{API_BASE_URL}/form/{JOTFORM_FORM_ID}/submissions"
        
        print(f"[TEST] Fetching ALL submissions with pagination")
        print(f"[TEST] URL: {url}")
        
        all_submissions = []
        offset = 0
        limit = 100
        page = 1
        
        while True:
            params = {
                "apiKey": JOTFORM_API_KEY,
                "limit": limit,
                "offset": offset,
                "orderby": "created_at"
            }
            
            print(f"[INFO] Fetching page {page} (offset={offset}, limit={limit})...")
            
            start_time = time.time()
            response = requests.get(url, params=params, timeout=30)
            elapsed = time.time() - start_time
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    if 'content' in data:
                        submissions = data['content']
                        count = len(submissions)
                        all_submissions.extend(submissions)
                        
                        print(f"[RESULT] Page {page}: {count} submissions ({elapsed:.2f}s)")
                        
                        # If we got fewer than limit, we're done
                        if count < limit:
                            break
                        
                        offset += limit
                        page += 1
                        
                        # Small delay to respect rate limits
                        time.sleep(0.5)
                    else:
                        print(f"[ERROR] ❌ Missing 'content' field in response")
                        return False
                        
                except json.JSONDecodeError as e:
                    print(f"[ERROR] ❌ JSON parse error: {str(e)}")
                    return False
            else:
                print(f"[ERROR] ❌ Request failed: {response.status_code}")
                return False
        
        total_raw = len(all_submissions)
        print(f"\n[SUCCESS] ✅ Total raw submissions: {total_raw}")
        print(f"[INFO] Fetched across {page} pages")
        
        # Simulate within-source merge (same logic as DataMerger)
        print(f"\n[ANALYSIS] Simulating within-source merge...")
        
        # Group by (coreId, grade)
        submission_map = {}
        grade_distribution_raw = {}
        skipped_no_student_id = 0
        skipped_no_sessionkey = 0
        
        # Debug: Show C10034 submission structure if exists
        c10034_found = False
        for sub in all_submissions:
            answers = sub.get('answers', {})
            if '20' in answers:
                answer_obj = answers['20']
                student_id = answer_obj.get('answer') if isinstance(answer_obj, dict) else answer_obj
                if student_id == '10034':
                    print(f"\n[DEBUG] Found C10034 submission:")
                    print(f"  Submission ID: {sub.get('id')}")
                    print(f"  Created: {sub.get('created_at')}")
                    
                    if '3' in answers:
                        sessionkey_val = answers['3'].get('answer') if isinstance(answers['3'], dict) else answers['3']
                        print(f"  Sessionkey: {sessionkey_val}")
                    
                    c10034_found = True
                    break
        
        if not c10034_found:
            print(f"\n[WARNING] C10034 not found in submissions")
        
        for sub in all_submissions:
            # Extract student ID (QID 20)
            answers = sub.get('answers', {})
            student_id = None
            
            # Look for QID 20 (student-id)
            if '20' in answers:
                answer_obj = answers['20']
                if isinstance(answer_obj, dict):
                    student_id = answer_obj.get('answer') or answer_obj.get('text', '')
                elif isinstance(answer_obj, str):
                    student_id = answer_obj
            
            if not student_id:
                skipped_no_student_id += 1
                continue
            
            # Normalize student ID: add 'C' prefix if missing
            if not student_id.startswith('C'):
                student_id = f'C{student_id}'
            
            # Extract sessionkey (QID 3)
            sessionkey = None
            
            # Look for QID 3 (sessionkey)
            if '3' in answers:
                answer_obj = answers['3']
                if isinstance(answer_obj, dict):
                    sessionkey = answer_obj.get('answer') or answer_obj.get('text', '')
                elif isinstance(answer_obj, str):
                    sessionkey = answer_obj
            
            if not sessionkey or '_' not in sessionkey:
                skipped_no_sessionkey += 1
                continue
            
            # Determine grade
            grade = determine_grade_from_sessionkey(sessionkey)
            
            # Count raw distribution
            grade_distribution_raw[grade] = grade_distribution_raw.get(grade, 0) + 1
            
            # Group by composite key
            key = f"{student_id}_{grade}"
            
            if key not in submission_map:
                submission_map[key] = []
            
            submission_map[key].append({
                'id': sub.get('id'),
                'created_at': sub.get('created_at'),
                'student_id': student_id,
                'grade': grade,
                'sessionkey': sessionkey
            })
        
        # Count after merge (one record per key)
        total_after_merge = len(submission_map)
        
        # Count grade distribution after merge
        grade_distribution_merged = {}
        multiple_submissions = 0
        total_duplicates = 0
        
        for key, submissions in submission_map.items():
            grade = submissions[0]['grade']
            grade_distribution_merged[grade] = grade_distribution_merged.get(grade, 0) + 1
            
            if len(submissions) > 1:
                multiple_submissions += 1
                total_duplicates += len(submissions) - 1
        
        # Results
        print(f"\n{'='*60}")
        print(f"  WITHIN-SOURCE MERGE SIMULATION RESULTS")
        print(f"{'='*60}")
        
        print(f"\n📊 RAW SUBMISSIONS:")
        print(f"  Total fetched: {total_raw}")
        print(f"  Skipped (no student ID): {skipped_no_student_id}")
        print(f"  Skipped (no sessionkey): {skipped_no_sessionkey}")
        print(f"  Valid for processing: {total_raw - skipped_no_student_id - skipped_no_sessionkey}")
        
        print(f"\n📊 RAW GRADE DISTRIBUTION:")
        for grade in sorted(grade_distribution_raw.keys()):
            count = grade_distribution_raw[grade]
            print(f"  {grade}: {count} submissions")
        
        print(f"\n🔄 AFTER WITHIN-SOURCE MERGE:")
        print(f"  Unique (coreId, grade) pairs: {total_after_merge}")
        print(f"  Students with multiple submissions: {multiple_submissions}")
        print(f"  Total submissions merged away: {total_duplicates}")
        
        print(f"\n📊 MERGED GRADE DISTRIBUTION:")
        for grade in sorted(grade_distribution_merged.keys()):
            count = grade_distribution_merged[grade]
            raw_count = grade_distribution_raw.get(grade, 0)
            consolidated = raw_count - count
            percent = (consolidated / raw_count * 100) if raw_count > 0 else 0
            print(f"  {grade}: {raw_count} → {count} ({consolidated} merged, {percent:.1f}%)")
        
        print(f"\n📈 OVERALL CONSOLIDATION:")
        valid_submissions = total_raw - skipped_no_student_id - skipped_no_sessionkey
        consolidation_rate = (total_duplicates / valid_submissions * 100) if valid_submissions > 0 else 0
        print(f"  Valid submissions: {valid_submissions}")
        print(f"  Final unique records: {total_after_merge}")
        print(f"  Consolidation rate: {consolidation_rate:.1f}%")
        
        print(f"\n🎯 COMPARISON WITH ACTUAL CACHE:")
        print(f"  Simulated result: {total_after_merge} records")
        print(f"  Actual cache (from analysis): 375 JotForm-sourced records")
        diff = abs(total_after_merge - 375)
        print(f"  Difference: {diff} records")
        
        if diff <= 5:
            print(f"  ✅ MATCH! Simulation confirms within-source merge behavior")
        else:
            print(f"  ⚠️  Discrepancy detected - may indicate additional filtering")
        
        print(f"\n{'='*60}")
        
        return True
        
    except Exception as e:
        print(f"[ERROR] ❌ Unexpected error: {str(e)}")
        import traceback
        traceback.print_exc()
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
    results.append(("Large Fetch (500)", test_submissions_large()))
    results.append(("Total Count", test_total_submission_count()))
    
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
