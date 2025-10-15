# Termination Rules

This document summarizes task termination rules used by the survey.

## Implementation Status

**Server Pipeline (TestWatchFolder)**: ✅ **Implemented**
- Termination outcomes calculated during field enrichment in `processor_agent.ps1`
- Function: `Add-TerminationOutcomes`
- Output fields: `term_ERV_Ter1`, `term_CM_Ter1`, etc.
- Output values: `"1"` = terminated (threshold not met), `"0"` = continued (threshold met)
- Input scoring: `"1"` = correct answer, `"0"` = incorrect answer
- **Calculation Logic - Absolute Certainty Principle**:
  - Values are set **only when mathematically certain**:
    1. Set `"0"` if: `correct ≥ threshold` (already passed)
    2. Set `"1"` if: `correct + unanswered < threshold` (impossible to pass even if all remaining are correct)
    3. Otherwise: **Don't set** - still mathematically possible to pass
  - Empty/unanswered questions treated as missing data, never assumed to be failures
  - Example (ERV_Ter1, need ≥5 correct out of 12):
    - 6 correct, 6 unanswered → Set `"0"` (already passed threshold)
    - 3 correct, 1 unanswered → Max possible = 4 < 5 → Set `"1"` (impossible to pass)
    - 3 correct, 3 unanswered → Max possible = 6 ≥ 5 → **Don't set** (still possible)
    - 0 correct, 12 unanswered → Max possible = 12 ≥ 5 → **Don't set** (not started)
  - If PDF already contains termination value (filled during survey), it is preserved

**Desktop GUI**: Refer to web GUI logic for current behavior in the data tool parser.

## ERV (English Reading Vocabulary)

| Termination ID | Question Range | Requirement to Continue | Triggered When |
| --- | --- | --- | --- |
| `ERV_Ter1` | `ERV_Q1`–`ERV_Q12` | ≥5 correct | Fewer than 5 correct in Q1–Q12 |
| `ERV_Ter2` | `ERV_Q13`–`ERV_Q24` | ≥5 correct | Fewer than 5 correct in Q13–Q24 |
| `ERV_Ter3` | `ERV_Q25`–`ERV_Q36` | ≥5 correct | Fewer than 5 correct in Q25–Q36 |

Only scored items `ERV_Q1`–`ERV_Q36` participate in termination checks; instruction screens and other prompts are ignored.

## CM (Chinese Morphology)

| Termination ID | Question Range | Requirement to Continue | Triggered When |
| --- | --- | --- | --- |
| `CM_Ter1` | `CM_Q1`–`CM_Q7` | ≥4 correct | Fewer than 4 correct in Q1–Q7 |
| `CM_Ter2` | `CM_Q8`–`CM_Q12` | ≥4 correct | Fewer than 4 correct in Q8–Q12 |
| `CM_Ter3` | `CM_Q13`–`CM_Q17` | ≥4 correct | Fewer than 4 correct in Q13–Q17 |
| `CM_Ter4` | `CM_Q18`–`CM_Q22` | ≥4 correct | Fewer than 4 correct in Q18–Q22 |
| `CM_S5`  | `CM_Q23`–`CM_Q27` | N/A (score only) | Reports total correct for Part 5; does not terminate |

Termination rules reference only the real question IDs `CM_Q1`–`CM_Q27`. Practice items (`CM_P*`) and text prompts (`*_TEXT`) are skipped for scoring and termination.

## Chinese Word Reading (CWR)

- **Termination ID:** `CWR_10Incorrect`
- **Question Range:** `CWR_Q1` onward (currently up to `CWR_Q60`)
- **Logic:** Terminates the section after 10 consecutive incorrect responses.

## Fine Motor

| Termination ID | Question Range | Requirement to Continue | Triggered When |
| --- | --- | --- | --- |
| `FM_Ter` | `FM_squ_1`–`FM_squ_3` | Score > 0 | No correct responses in the square-cutting trial |

Only the square-cutting items participate in this rule. If all are scored `0`, the subsequent tree-cutting items (`FM_tree_*`) are skipped.

## Timed Terminations

Some tasks end automatically when their allotted time expires:

- **Symbolic Relations:** `SYM.json` and `NONSYM.json` each run on a 120‑second timer. When time is up, a `SYM_timeout` or `NONSYM_timeout` screen appears and remaining questions are skipped. These timers do not use termination IDs but are logged in the parser.

## Notes

- Termination outcomes are exported as `term_<TerminationID>` fields.
