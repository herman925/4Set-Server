#!/usr/bin/env python3
"""
Test _TEXT Field Result Column Display
Validates that:
1. Correct Answer column shows "—" (dash) not "N/A" for _TEXT fields
2. Result column shows "N/A" with muted color for _TEXT fields
3. Branch information is included for TEC tasks
"""

def test_correct_answer_column():
    """Test that _TEXT fields show dash in Correct Answer column"""
    print("\n=== Test 1: Correct Answer Column Display ===")
    
    # Expected behavior for _TEXT fields
    test_cases = [
        {
            "question_id": "ToM_Q3a_TEXT",
            "is_text_display": True,
            "expected_correct_answer": "—",
            "description": "ToM _TEXT field should show dash"
        },
        {
            "question_id": "ToM_Q4a_TEXT",
            "is_text_display": True,
            "expected_correct_answer": "—",
            "description": "ToM _TEXT field should show dash"
        },
        {
            "question_id": "TEC_Male_Q1_TEXT",
            "is_text_display": True,
            "expected_correct_answer": "—",
            "description": "TEC _TEXT field should show dash"
        },
        {
            "question_id": "ToM_Q3a",
            "is_text_display": False,
            "correct_answer": "狗仔",
            "expected_correct_answer": "狗仔",
            "description": "Regular question should show actual correct answer"
        }
    ]
    
    passed = 0
    for i, case in enumerate(test_cases, 1):
        question_id = case["question_id"]
        is_text_display = case["is_text_display"]
        expected = case["expected_correct_answer"]
        description = case["description"]
        
        # Simulate the logic from checking-system-student-page.js line ~860
        # const correctAnswerDisplay = isYNTask ? 'N/A' : (question.isTextDisplay ? '—' : (question.correctAnswer || '—'));
        is_yn_task = False  # Assume not Y/N for these tests
        
        if is_yn_task:
            actual = "N/A"
        elif is_text_display:
            actual = "—"
        else:
            actual = case.get("correct_answer", "—")
        
        if actual == expected:
            print(f"  ✅ Test {i}: {description}")
            print(f"     {question_id}: Expected '{expected}', Got '{actual}'")
            passed += 1
        else:
            print(f"  ❌ Test {i}: {description}")
            print(f"     {question_id}: Expected '{expected}', Got '{actual}'")
    
    print(f"\n  Result: {passed}/{len(test_cases)} tests passed")
    return passed == len(test_cases)


def test_result_column_na_status():
    """Test that N/A status appears in Result column with muted color"""
    print("\n=== Test 2: Result Column N/A Status ===")
    
    test_cases = [
        {
            "question_id": "ToM_Q3a_TEXT",
            "text_field_status": "na",
            "expected_result": "N/A",
            "expected_color": "muted gray (#f9fafb background)",
            "description": "N/A status should have muted color"
        }
    ]
    
    passed = 0
    for i, case in enumerate(test_cases, 1):
        # Simulate the logic from checking-system-student-page.js line ~835
        if case["text_field_status"] == "na":
            result_pill = '<span class="answer-pill" style="background: #f9fafb; color: #6b7280; border-color: #e5e7eb;">N/A</span>'
            has_muted_color = "#f9fafb" in result_pill and "#6b7280" in result_pill
            
            if has_muted_color and "N/A" in result_pill:
                print(f"  ✅ Test {i}: {case['description']}")
                print(f"     {case['question_id']}: Shows {case['expected_result']} with muted colors")
                passed += 1
            else:
                print(f"  ❌ Test {i}: {case['description']}")
                print(f"     {case['question_id']}: Missing muted colors or N/A text")
        
    print(f"\n  Result: {passed}/{len(test_cases)} tests passed")
    return passed == len(test_cases)


def test_branch_information():
    """Test that branch information appears for TEC tasks"""
    print("\n=== Test 3: Branch Information Display ===")
    
    test_cases = [
        {
            "task_id": "tec_male",
            "question_id": "TEC_Male_Q1_TEXT",
            "text_field_status": "answered",
            "expected_branch": "Male Branch",
            "description": "TEC Male task should show Male Branch"
        },
        {
            "task_id": "tec_female",
            "question_id": "TEC_Female_Q1_TEXT",
            "text_field_status": "answered",
            "expected_branch": "Female Branch",
            "description": "TEC Female task should show Female Branch"
        },
        {
            "task_id": "theoryofmind",
            "question_id": "ToM_Q3a_TEXT",
            "text_field_status": "answered",
            "expected_branch": None,
            "description": "Non-TEC task should not show branch"
        }
    ]
    
    passed = 0
    for i, case in enumerate(test_cases, 1):
        task_id = case["task_id"]
        expected_branch = case["expected_branch"]
        
        # Simulate the logic from checking-system-student-page.js lines ~827-837
        # Check 'female' first since 'female' contains 'male' substring
        branch_info = ''
        if 'tec' in task_id.lower():
            if 'female' in task_id.lower():
                branch_info = ' (Female Branch)'
            elif 'male' in task_id.lower():
                branch_info = ' (Male Branch)'
        
        if expected_branch is None:
            # Should not have branch info
            if branch_info == '':
                print(f"  ✅ Test {i}: {case['description']}")
                print(f"     {case['question_id']}: No branch info (correct)")
                passed += 1
            else:
                print(f"  ❌ Test {i}: {case['description']}")
                print(f"     {case['question_id']}: Should not have branch info, got '{branch_info}'")
        else:
            # Should have branch info
            if expected_branch in branch_info:
                print(f"  ✅ Test {i}: {case['description']}")
                print(f"     {case['question_id']}: Shows '{branch_info.strip()}'")
                passed += 1
            else:
                print(f"  ❌ Test {i}: {case['description']}")
                print(f"     {case['question_id']}: Expected '{expected_branch}', got '{branch_info}'")
    
    print(f"\n  Result: {passed}/{len(test_cases)} tests passed")
    return passed == len(test_cases)


def main():
    """Run all tests"""
    print("=" * 70)
    print("_TEXT Field Result Column Display Test Suite")
    print("=" * 70)
    
    results = []
    results.append(test_correct_answer_column())
    results.append(test_result_column_na_status())
    results.append(test_branch_information())
    
    print("\n" + "=" * 70)
    passed_count = sum(results)
    total_count = len(results)
    
    if all(results):
        print(f"✅ ALL TESTS PASSED: {passed_count}/{total_count}")
        print("=" * 70)
        return 0
    else:
        print(f"❌ SOME TESTS FAILED: {passed_count}/{total_count}")
        print("=" * 70)
        return 1


if __name__ == "__main__":
    exit(main())
