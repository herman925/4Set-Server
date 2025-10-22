#!/usr/bin/env python3
"""
Test script for the JotForm CORS proxy server.
This script verifies that the proxy correctly forwards requests to the JotForm API.
"""

import requests
import sys
import json

PROXY_BASE_URL = "http://127.0.0.1:3000"
FORM_ID = "252152307582049"  # From the error log
API_KEY = "f45162cb1d42e5e725ef38c9ccc06915"  # From the error log (test/demo key)

def test_health_check():
    """Test the health check endpoint."""
    print("Testing health check endpoint...")
    try:
        response = requests.get(f"{PROXY_BASE_URL}/health", timeout=5)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data["status"] == "ok", f"Expected status 'ok', got {data['status']}"
        print("✅ Health check passed")
        return True
    except Exception as e:
        print(f"❌ Health check failed: {e}")
        return False

def test_submissions_endpoint():
    """Test the submissions proxy endpoint."""
    print("\nTesting submissions endpoint...")
    try:
        url = f"{PROXY_BASE_URL}/api/jotform/form/{FORM_ID}/submissions"
        params = {
            "apiKey": API_KEY,
            "limit": 1,
            "offset": 0,
            "orderby": "created_at",
            "direction": "DESC"
        }
        
        print(f"Making request to: {url}")
        response = requests.get(url, params=params, timeout=30)
        
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Response keys: {list(data.keys())}")
            
            # Check for expected JotForm response structure
            if "content" in data or "responseCode" in data:
                print("✅ Submissions endpoint passed - got valid JotForm response")
                
                # Print some basic info if available
                if "content" in data and isinstance(data["content"], list):
                    print(f"   Found {len(data['content'])} submissions")
                    if data["content"]:
                        print(f"   First submission ID: {data['content'][0].get('id', 'N/A')}")
                
                return True
            else:
                print(f"⚠️  Got response but unexpected structure: {json.dumps(data, indent=2)[:200]}")
                return False
        else:
            print(f"❌ Submissions endpoint failed with status {response.status_code}")
            print(f"   Response: {response.text[:200]}")
            return False
            
    except Exception as e:
        print(f"❌ Submissions endpoint failed: {e}")
        return False

def test_questions_endpoint():
    """Test the questions proxy endpoint."""
    print("\nTesting questions endpoint...")
    try:
        url = f"{PROXY_BASE_URL}/api/jotform/form/{FORM_ID}/questions"
        params = {"apiKey": API_KEY}
        
        print(f"Making request to: {url}")
        response = requests.get(url, params=params, timeout=30)
        
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Response keys: {list(data.keys())}")
            
            # Check for expected JotForm response structure
            if "content" in data or "responseCode" in data:
                print("✅ Questions endpoint passed - got valid JotForm response")
                
                # Print some basic info if available
                if "content" in data and isinstance(data["content"], dict):
                    print(f"   Found {len(data['content'])} questions")
                
                return True
            else:
                print(f"⚠️  Got response but unexpected structure")
                return False
        else:
            print(f"❌ Questions endpoint failed with status {response.status_code}")
            print(f"   Response: {response.text[:200]}")
            return False
            
    except Exception as e:
        print(f"❌ Questions endpoint failed: {e}")
        return False

def main():
    """Run all tests."""
    print("=" * 60)
    print("JotForm CORS Proxy Server Test Suite")
    print("=" * 60)
    
    results = []
    
    # Test 1: Health check
    results.append(("Health Check", test_health_check()))
    
    # Test 2: Submissions endpoint
    results.append(("Submissions Endpoint", test_submissions_endpoint()))
    
    # Test 3: Questions endpoint
    results.append(("Questions Endpoint", test_questions_endpoint()))
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name}: {status}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())
