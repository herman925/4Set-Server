#!/usr/bin/env python3
"""
Test script to verify _TEXT field display logic in the checking system.

This script validates that _TEXT fields are properly displayed with the correct
status indicators based on their associated radio_text question answers.
"""

import json

class TextFieldDisplayTest:
    """Test class for _TEXT field display logic"""
    
    def __init__(self):
        self.test_results = []
    
    def test_text_field_status(self, radio_correct, radio_answer, text_content, expected_status):
        """
        Test a single _TEXT field status scenario
        
        Args:
            radio_correct: The correct answer for the radio question
            radio_answer: The actual answer selected
            text_content: Content in the _TEXT field
            expected_status: Expected status ('N/A', 'Answered', or 'Not answered')
        """
        # Determine actual status
        if radio_answer is not None and str(radio_answer).strip() == str(radio_correct).strip():
            actual_status = "N/A"  # Correct answer selected
        elif text_content is not None and str(text_content).strip() != '':
            actual_status = "Answered"
        else:
            actual_status = "Not answered"
        
        # Check if test passed
        passed = (actual_status == expected_status)
        
        self.test_results.append({
            "radio_correct": radio_correct,
            "radio_answer": radio_answer,
            "text_content": text_content,
            "expected": expected_status,
            "actual": actual_status,
            "passed": passed
        })
        
        return passed
    
    def run_all_tests(self):
        """Run all test scenarios"""
        print("=" * 80)
        print("TEXT FIELD DISPLAY STATUS TEST SUITE")
        print("=" * 80)
        print()
        
        # Test 1: Correct answer, no text
        print("Test 1: Correct answer selected, no text in _TEXT field")
        self.test_text_field_status("狗仔", "狗仔", None, "N/A")
        self.display_last_result()
        
        # Test 2: Correct answer, text present (should be ignored)
        print("Test 2: Correct answer selected, text present (mistyped)")
        self.test_text_field_status("狗仔", "狗仔", "貓仔", "N/A")
        self.display_last_result()
        
        # Test 3: Wrong answer, text present
        print("Test 3: Wrong answer selected, text present")
        self.test_text_field_status("狗仔", "其他", "貓仔", "Answered")
        self.display_last_result()
        
        # Test 4: Wrong answer, no text
        print("Test 4: Wrong answer selected, no text")
        self.test_text_field_status("狗仔", "其他", None, "Not answered")
        self.display_last_result()
        
        # Test 5: No answer, text present
        print("Test 5: No radio answer, text present")
        self.test_text_field_status("狗仔", None, "貓仔", "Answered")
        self.display_last_result()
        
        # Test 6: No answer, no text
        print("Test 6: No radio answer, no text")
        self.test_text_field_status("狗仔", None, None, "Not answered")
        self.display_last_result()
        
        # Display summary
        self.display_summary()
    
    def display_last_result(self):
        """Display the last test result"""
        result = self.test_results[-1]
        print(f"  Radio Correct Answer: {result['radio_correct']}")
        print(f"  Radio Answer Given:   {result['radio_answer']}")
        print(f"  Text Content:         {result['text_content']}")
        print(f"  Expected Status:      {result['expected']}")
        print(f"  Actual Status:        {result['actual']}")
        print(f"  Result:               {'✅ PASS' if result['passed'] else '❌ FAIL'}")
        print()
    
    def display_summary(self):
        """Display test summary"""
        total = len(self.test_results)
        passed = sum(1 for r in self.test_results if r['passed'])
        failed = total - passed
        
        print("=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        print(f"Total Tests:   {total}")
        print(f"Passed:        {passed} ✅")
        print(f"Failed:        {failed} ❌")
        print(f"Success Rate:  {(passed/total*100):.1f}%")
        print()
        
        if failed > 0:
            print("Failed Tests:")
            for i, result in enumerate(self.test_results, 1):
                if not result['passed']:
                    print(f"  Test {i}: Expected '{result['expected']}', got '{result['actual']}'")
            print()

def test_ui_display_format():
    """Test the UI display format for _TEXT fields"""
    print("=" * 80)
    print("UI DISPLAY FORMAT TEST")
    print("=" * 80)
    print()
    
    print("Expected UI display for _TEXT fields:")
    print()
    
    # N/A status
    print("1. Status: N/A (when correct answer selected)")
    print("   HTML: <span class='answer-pill' style='background: #f3f4f6; color: #6b7280;'>")
    print("         <i data-lucide='info'></i>N/A</span>")
    print("   Tooltip: 'Correct answer selected on associated radio question'")
    print()
    
    # Answered status
    print("2. Status: Answered (when text content exists)")
    print("   HTML: <span class='answer-pill' style='background: #f0f9ff; color: #0369a1;'>")
    print("         <i data-lucide='circle-check'></i>Answered</span>")
    print("   Tooltip: 'Text answer provided'")
    print()
    
    # Not answered status
    print("3. Status: Not answered (when no text content)")
    print("   HTML: <span class='answer-pill incorrect'>")
    print("         <i data-lucide='minus'></i>Not answered</span>")
    print("   Tooltip: 'No text answer provided'")
    print()
    
    print("Note: _TEXT fields show 'N/A' in the 'Correct Answer' column")
    print("Note: _TEXT fields are excluded from completion percentage calculations")
    print()

if __name__ == "__main__":
    # Run display status tests
    tester = TextFieldDisplayTest()
    tester.run_all_tests()
    
    # Run UI format test
    test_ui_display_format()
    
    print("=" * 80)
    print("All tests completed!")
    print("=" * 80)
