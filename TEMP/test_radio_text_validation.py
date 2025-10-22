#!/usr/bin/env python3
"""
Test script for radio_text validation logic with _TEXT fields.

This script simulates various scenarios for Theory of Mind (ToM) questions
to ensure proper handling of radio_text fields and their associated _TEXT fields.
"""

import json

# Test scenarios for ToM_Q3a + ToM_Q3a_TEXT
test_cases = [
    {
        "name": "Scenario 1: Correct answer selected, no text",
        "ToM_Q3a": "狗仔",  # Correct answer
        "ToM_Q3a_TEXT": None,
        "expected_ToM_Q3a": {"isCorrect": True, "status": "Correct"},
        "expected_ToM_Q3a_TEXT": {"status": "N/A", "reason": "Correct answer selected on radio question"}
    },
    {
        "name": "Scenario 2: Correct answer selected, text filled (mistyped)",
        "ToM_Q3a": "狗仔",  # Correct answer
        "ToM_Q3a_TEXT": "貓仔",  # Mistyped text should be ignored
        "expected_ToM_Q3a": {"isCorrect": True, "status": "Correct"},
        "expected_ToM_Q3a_TEXT": {"status": "N/A", "reason": "Correct answer selected on radio question"}
    },
    {
        "name": "Scenario 3: Other option selected, text filled",
        "ToM_Q3a": "其他",  # Other option
        "ToM_Q3a_TEXT": "貓仔",  # Text filled
        "expected_ToM_Q3a": {"isCorrect": False, "status": "Incorrect"},
        "expected_ToM_Q3a_TEXT": {"status": "Answered", "reason": "Text field has content"}
    },
    {
        "name": "Scenario 4: Other option selected, no text",
        "ToM_Q3a": "其他",  # Other option
        "ToM_Q3a_TEXT": None,
        "expected_ToM_Q3a": {"isCorrect": False, "status": "Incorrect"},
        "expected_ToM_Q3a_TEXT": {"status": "Not answered", "reason": "No text provided"}
    },
    {
        "name": "Scenario 5: No radio answer, text filled",
        "ToM_Q3a": None,
        "ToM_Q3a_TEXT": "貓仔",
        "expected_ToM_Q3a": {"isCorrect": False, "status": "Not answered"},
        "expected_ToM_Q3a_TEXT": {"status": "Answered", "reason": "Text field has content"}
    },
    {
        "name": "Scenario 6: No radio answer, no text",
        "ToM_Q3a": None,
        "ToM_Q3a_TEXT": None,
        "expected_ToM_Q3a": {"isCorrect": False, "status": "Not answered"},
        "expected_ToM_Q3a_TEXT": {"status": "Not answered", "reason": "No text provided"}
    }
]

def simulate_validation(radio_answer, text_answer):
    """
    Simulate the validation logic from task-validator.js
    """
    correct_answer = "狗仔"
    
    # Radio question validation
    radio_is_correct = False
    if radio_answer is not None and str(radio_answer).strip() == str(correct_answer).strip():
        radio_is_correct = True
    
    # Text field status
    text_status = None
    if radio_is_correct:
        text_status = "N/A"  # Correct answer selected, text not needed
    elif text_answer is not None and str(text_answer).strip() != '':
        text_status = "Answered"
    else:
        text_status = "Not answered"
    
    return {
        "radio": {
            "isCorrect": radio_is_correct,
            "status": "Correct" if radio_is_correct else ("Not answered" if radio_answer is None else "Incorrect")
        },
        "text": {
            "status": text_status
        }
    }

def run_tests():
    """Run all test cases and display results"""
    print("=" * 80)
    print("RADIO_TEXT VALIDATION TEST SUITE")
    print("=" * 80)
    print()
    
    passed = 0
    failed = 0
    
    for i, test in enumerate(test_cases, 1):
        print(f"Test Case {i}: {test['name']}")
        print("-" * 80)
        print(f"  Input:")
        print(f"    ToM_Q3a: {test['ToM_Q3a']}")
        print(f"    ToM_Q3a_TEXT: {test['ToM_Q3a_TEXT']}")
        print()
        
        # Run simulation
        result = simulate_validation(test['ToM_Q3a'], test['ToM_Q3a_TEXT'])
        
        # Check radio question
        radio_expected = test['expected_ToM_Q3a']
        radio_passed = (
            result['radio']['isCorrect'] == radio_expected['isCorrect'] and
            result['radio']['status'] == radio_expected['status']
        )
        
        # Check text field
        text_expected = test['expected_ToM_Q3a_TEXT']
        text_passed = result['text']['status'] == text_expected['status']
        
        # Display results
        print(f"  Results:")
        print(f"    ToM_Q3a:")
        print(f"      Expected: isCorrect={radio_expected['isCorrect']}, status={radio_expected['status']}")
        print(f"      Actual:   isCorrect={result['radio']['isCorrect']}, status={result['radio']['status']}")
        print(f"      Result:   {'✅ PASS' if radio_passed else '❌ FAIL'}")
        print()
        print(f"    ToM_Q3a_TEXT:")
        print(f"      Expected: status={text_expected['status']} ({text_expected['reason']})")
        print(f"      Actual:   status={result['text']['status']}")
        print(f"      Result:   {'✅ PASS' if text_passed else '❌ FAIL'}")
        print()
        
        if radio_passed and text_passed:
            passed += 1
            print(f"  Overall: ✅ PASS")
        else:
            failed += 1
            print(f"  Overall: ❌ FAIL")
        
        print()
        print()
    
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total: {len(test_cases)}")
    print(f"Passed: {passed} ✅")
    print(f"Failed: {failed} ❌")
    print(f"Success Rate: {(passed/len(test_cases)*100):.1f}%")
    print()

if __name__ == "__main__":
    run_tests()
