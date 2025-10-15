"""Upload utilities for parsed CSV data."""

from __future__ import annotations

import csv
import json
import time
import platform
import logging
import sys
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator, Any

# Ensure we can import our modules regardless of how the script is run
if __name__ == "__main__":
    # Add parent directory to path for development mode
    parent_dir = Path(__file__).resolve().parent.parent
    if str(parent_dir) not in sys.path:
        sys.path.insert(0, str(parent_dir))

import requests

from data_tool.encryption import decrypt_data
from data_tool.utils.sessionkey import ensure_sessionkey
from data_tool.utils.mapping import (
    load_cached_mapping,
    filter_allowed_fields,
    get_session_qid,
)
from data_tool.utils.normalize import (
    flatten_record,
    normalize_for_upload,
)
from data_tool.clients.jotform_client import (
    search_submission_by_sessionkey as jotform_search_by_sessionkey,
)

log = logging.getLogger(__name__)
netlog = logging.getLogger(__name__ + ".network")

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"

# Mild rate limiting for Jotform API calls (in seconds between calls)
_RATE_LIMIT_MIN_INTERVAL = 0.25
_last_jotform_call_ts: float = 0.0


def _jotform_rate_limit() -> None:
    """Sleep briefly if needed to avoid hitting Jotform too quickly."""
    global _last_jotform_call_ts
    now = time.monotonic()
    wait = _RATE_LIMIT_MIN_INTERVAL - (now - _last_jotform_call_ts)
    if wait > 0:
        time.sleep(wait)
    _last_jotform_call_ts = time.monotonic()


def _request_with_retry(method: str, url: str, *, attempts: int = 3, backoff: float = 0.5, **kwargs):
    """Wrapper around requests.request with basic retries and rate limiting.

    Retries on timeouts, connection errors, HTTP 429, and 5xx responses.
    """
    for i in range(attempts):
        try:
            _jotform_rate_limit()
            resp = requests.request(method, url, **kwargs)
            # Retry on rate-limit or server errors
            if getattr(resp, "status_code", 0) == 429 or getattr(resp, "status_code", 0) >= 500:
                raise requests.HTTPError(f"{resp.status_code} {resp.reason}", response=resp)
            return resp
        except (requests.Timeout, requests.ConnectionError, requests.HTTPError) as e:
            if i == attempts - 1:
                raise
            sleep_s = backoff * (2 ** i)
            log.warning(
                "Request %s %s failed (attempt %d/%d): %s; retrying in %.1fs",
                method,
                url,
                i + 1,
                attempts,
                e,
                sleep_s,
            )
            time.sleep(sleep_s)


def _load_credentials(password: str) -> dict:
    """Decrypt and return the credentials JSON."""
    enc_path = ASSETS_DIR / "credentials.enc"
    if enc_path.exists():
        data = decrypt_data(enc_path.read_bytes(), password)
        return json.loads(data.decode("utf-8"))

    json_path = ASSETS_DIR / "credentials.json"
    if json_path.exists():
        log.warning("Using unencrypted credentials.json")
        return json.loads(json_path.read_text("utf-8"))

    raise FileNotFoundError("No credentials file found")


def _parse_single_csv(csv_path: Path) -> dict:
    """Parse a two-column key,value CSV into a dictionary."""
    data: dict[str, str] = {}
    with open(csv_path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        for row in reader:
            if len(row) >= 2:
                data[row[0]] = row[1]
    return data


def _parse_multi_csv(csv_path: Path) -> list[dict]:
    """Parse a CSV with headers into a list of dictionaries."""
    with open(csv_path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        return [dict(row) for row in reader]


def _parse_csv(csv_path: Path) -> Iterator[dict]:
    """Auto-detect whether the CSV is single-record or multi-row."""
    with open(csv_path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.reader(fh))
    
    # Never treat as two-column if a 'sessionkey' header is present
    header = rows[0] if rows else []
    has_sessionkey_header = any(str(c).strip().lower() == "sessionkey" for c in header)
    is_two_column = bool(rows) and all(len(r) == 2 for r in rows) and not has_sessionkey_header

    if is_two_column:
        yield _parse_single_csv(csv_path)
    else:
        for rec in _parse_multi_csv(csv_path):
            yield rec

_jotform_mapping_cache: dict[Path, dict[str, str]] = {}


def _load_jotform_mapping(path: Path | None = None) -> dict[str, str]:
    """Return a `{field_name: qid}` map from a Jotform question export.

    The default mapping file is ``assets/jotformquestions.json`` but the
    function can load any similarly structured JSON, such as the upload log
    form reference.
    """
    global _jotform_mapping_cache
    if path is None:
        path = ASSETS_DIR / "jotformquestions.json"
    if path in _jotform_mapping_cache:
        return _jotform_mapping_cache[path]
    mapping = load_cached_mapping(path)
    _jotform_mapping_cache[path] = mapping
    return mapping


def _build_jotform_submission_payload(record: dict, name_to_qid: dict[str, str]) -> dict:
    """Return a Jotform submission payload using only mapped fields.

    Keys in the returned dict are Jotform QIDs (as strings) and values are the
    corresponding answers. Special handling for ``sessionkey``: if a mapping
    exists, we will include the answer under the sessionkey QID. ``record`` keys
    like ``jotformsubmissionid`` are excluded.
    """
    submission: dict[str, str] = {}
    session_qid = name_to_qid.get("sessionkey")

    for k, v in record.items():
        if k == "jotformsubmissionid":
            continue
        qid = name_to_qid.get(k)
        if qid:
            submission[qid] = v

    # Ensure sessionkey is present if we have a mapping
    if session_qid and record.get("sessionkey") is not None:
        submission.setdefault(session_qid, record["sessionkey"])

    return submission


def _search_submission_by_sessionkey(
    api_key: str,
    form_id: str,
    sessionkey: str,
    session_qid: str | None,
) -> str | None:
    """Search for submission by sessionkey using filter API (fast) with pagination fallback.
    
    Returns submission ID if found, None otherwise.
    """
    if not session_qid:
        log.warning("Cannot search without session_qid")
        return None
    
    # METHOD 1: Try filter API first (much faster for large datasets)
    try:
        import urllib.parse
        filter_json = f'{{"{session_qid}:eq":"{sessionkey}"}}'
        encoded_filter = urllib.parse.quote(filter_json)
        filter_url = f"https://api.jotform.com/form/{form_id}/submissions"
        params = {
            "apiKey": api_key,
            "filter": filter_json,  # requests will handle encoding
            "limit": "1000",
            "orderby": "created_at",
            "direction": "ASC"
        }
        
        netlog.info("GET %s (filter)", filter_url)
        resp = requests.get(filter_url, params=params, timeout=30)
        netlog.info("<- %s %s", resp.status_code, resp.reason)
        resp.raise_for_status()
        
        data = resp.json()
        if data.get("content"):
            # Verify exact match (filter might return similar results)
            for submission in data["content"]:
                answers = submission.get("answers", {})
                qid_data = answers.get(session_qid, {})
                
                # Extract value from answer field
                candidate = qid_data.get("answer") if isinstance(qid_data, dict) else qid_data
                if candidate is None and isinstance(qid_data, dict):
                    candidate = qid_data.get("text")
                
                # Normalize whitespace and compare
                if candidate and str(candidate).strip().replace("  ", " ") == sessionkey:
                    submission_id = submission.get("id")
                    log.info("Found submission via filter: %s (sessionkey=%s)", submission_id, sessionkey)
                    return submission_id
        
        log.debug("Filter returned no exact match for sessionkey=%s", sessionkey)
    except Exception as e:
        log.warning("Filter search failed for sessionkey=%s: %s, falling back to pagination", sessionkey, e)
    
    # METHOD 2: Fallback to pagination scan
    try:
        return jotform_search_by_sessionkey(api_key, form_id, sessionkey, session_qid)
    except Exception as e:  # pragma: no cover - network variability
        log.warning("Pagination search failed for sessionkey=%s: %s", sessionkey, e)
        return None


def _load_records(data_path: Path) -> Iterator[dict]:
    """Yield records from a CSV or JSON file."""
    if data_path.suffix.lower() == ".json":
        data = json.loads(data_path.read_text("utf-8"))
        if isinstance(data, list):
            for rec in data:
                if isinstance(rec, dict):
                    yield rec
        elif isinstance(data, dict):
            yield data
    else:
        yield from _parse_csv(data_path)


def _load_mapping() -> dict[str, str]:
    mapping_path = ASSETS_DIR / "jotformquestions.json"
    try:
        return json.loads(mapping_path.read_text("utf-8"))
    except Exception:
        return {}


def _to_form_body(submission: dict[str, Any]) -> dict[str, str]:
    """Return application/x-www-form-urlencoded body for Jotform.

    Transforms {qid: value} into {f"submission[{qid}]": str(value)}.
    None values become empty strings.
    """
    form: dict[str, str] = {}
    for qid, value in submission.items():
        key = f"submission[{qid}]"
        form[key] = "" if value is None else str(value)
    return form


def _filter_nonempty_values(d: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of dict without None/empty-string values (whitespace-only treated as empty)."""
    return {k: v for k, v in d.items() if v is not None and str(v).strip() != ""}


def _post_update_in_chunks(
    url: str,
    *,
    params: dict,
    payload: dict[str, Any],
    timeout: int = 90,
    attempts: int = 5,
    chunk_size: int = 80,
) -> None:
    """POST update payload to Jotform in smaller chunks to avoid large request timeouts.

    Sends multiple POSTs to the same submission URL, each with a subset of fields.
    Jotform treats repeated POSTs as partial updates.
    """
    items = list(payload.items())
    total = len(items)
    if total == 0:
        # Nothing to update
        netlog.info("Skipping update: empty payload")
        return
    for i in range(0, total, chunk_size):
        part = dict(items[i : i + chunk_size])
        netlog.info("POST %s (fields %d-%d of %d)", url, i + 1, min(i + chunk_size, total), total)
        resp = _request_with_retry(
            "POST",
            url,
            params=params,
            data=_to_form_body(part),
            timeout=timeout,
            attempts=attempts,
        )
        netlog.info("<- %s %s", getattr(resp, "status_code", "?"), getattr(resp, "reason", ""))
        resp.raise_for_status()


def _verify_submission(
    api_key: str,
    submission_id: str,
    *,
    session_qid: str | None,
    expected_sessionkey: str | None,
) -> bool:
    """Fetch the submission and confirm sessionkey if possible; log outcome.

    Returns True if verified or unverifiable, False on negative verification.
    """
    if not session_qid or not expected_sessionkey:
        return True
    try:
        url = f"https://api.jotform.com/submission/{submission_id}"
        netlog.info("GET %s", url)
        resp = _request_with_retry("GET", url, params={"apiKey": api_key}, timeout=30)
        netlog.info("<- %s %s", getattr(resp, "status_code", "?"), getattr(resp, "reason", ""))
        resp.raise_for_status()
        payload = resp.json()
        answers = (payload.get("content") or {}).get("answers") or {}
        ans = answers.get(str(session_qid))
        candidate = None
        if isinstance(ans, dict):
            candidate = ans.get("answer") if ans.get("answer") is not None else ans.get("text")
        else:
            candidate = ans
        ok = str(candidate) == str(expected_sessionkey)
        log.info(
            "Verification %s for submission %s (sessionkey=%s)",
            "passed" if ok else "failed",
            submission_id,
            expected_sessionkey,
        )
        return ok
    except Exception as e:  # pragma: no cover - network variability
        log.warning("Verification skipped due to error: %s", e)
        return True
def refresh_jotform_questions(system_password: str, *, form_id: str | None = None, api_key: str | None = None, out_path: Path | None = None) -> Path:
    """Fetch Jotform questions and write `assets/jotformquestions.json`.

    If `form_id` or `api_key` are not provided, they are taken from credentials.
    Returns the written file path.
    """
    creds = _load_credentials(system_password)
    api_key = api_key or creds.get("jotformApiKey") or creds.get("jotform", {}).get("apiKey")
    form_id = form_id or creds.get("jotformFormId") or creds.get("jotform", {}).get("formId")
    if not api_key or not form_id:
        raise RuntimeError("Jotform API key or Form ID missing in credentials or parameters")

    url = f"https://api.jotform.com/form/{form_id}/questions"
    params = {"apiKey": api_key}
    netlog.info("GET %s", url)
    resp = _request_with_retry("GET", url, params=params, timeout=30)
    netlog.info("<- %s %s", resp.status_code, resp.reason)
    resp.raise_for_status()
    payload = resp.json()
    content = payload.get("content", {}) or {}

    # Build name -> qid mapping; fall back to text if name absent
    mapping: dict[str, str] = {}
    for q in content.values():
        name = q.get("name") or q.get("text")
        qid = q.get("qid") or q.get("name")
        if name and qid:
            mapping[str(name)] = str(qid)

    target = out_path or (ASSETS_DIR / "jotformquestions.json")
    target.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), "utf-8")
    log.info("Wrote %d Jotform question mappings to %s", len(mapping), target)
    # Invalidate cache
    global _jotform_mapping_cache
    _jotform_mapping_cache.pop(target, None)
    return target
def _upload_to_jotform_core(data_path: Path, system_password: str) -> tuple[tuple[str | None, str | None], list[dict]]:
    """Core implementation for uploading to Jotform.

    Returns ((first_sessionkey, first_submissionid), per_record_results).
    """
    creds = _load_credentials(system_password)
    api_key = creds.get("jotformApiKey") or creds.get("jotform", {}).get("apiKey")
    form_id = creds.get("jotformFormId") or creds.get("jotform", {}).get("formId")

    if not api_key or not form_id:
        raise RuntimeError("Jotform credentials missing in credentials file")

    mapping = _load_jotform_mapping()
    log.info("Uploading %s to Jotform form '%s'", data_path, form_id)

    raw_data: Any | None = None
    if data_path.suffix.lower() == ".json":
        raw_data = json.loads(data_path.read_text("utf-8"))
        if isinstance(raw_data, list):
            records = raw_data
        elif isinstance(raw_data, dict):
            records = [raw_data]
        else:
            log.error("Unsupported JSON structure in %s", data_path)
            return (None, None), []
    else:
        records = list(_load_records(data_path))

    if not records:
        log.warning("No records found in %s", data_path)
        return (None, None), []

    params = {"apiKey": api_key}
    create_url = f"https://api.jotform.com/form/{form_id}/submissions"
    results = {"created": 0, "updated": 0}
    session_key_out: str | None = None
    submission_id_out: str | None = None
    session_qid = get_session_qid(mapping)
    if not session_qid:
        log.warning("'sessionkey' field not found in Jotform mapping; preflight search will be disabled.")

    per_record: list[dict] = []

    for rec in records:
        # Use inner autosave payload if present (snapshot shape): { "data": { ...fields... }, ... }
        base_rec = rec.get("data") if isinstance(rec, dict) and isinstance(rec.get("data"), dict) else rec

        # Ensure sessionkey derived canonically. Only write back when input is JSON to avoid corrupting CSVs.
        autosave_arg = data_path if (raw_data is not None and data_path.suffix.lower() == ".json") else None
        session_key = ensure_sessionkey(rec, autosave_path=autosave_arg)
        if not session_key:
            log.warning("Record missing sessionkey; skipping")
            continue
        # Build a unified view that merges top-level fields (e.g., computerno) with nested data fields
        # Nested keys override top-level on conflict to preserve explicit input within data{}
        if isinstance(rec, dict):
            unified_source = dict(rec)
        else:
            unified_source = {}
        if isinstance(base_rec, dict):
            unified_source.update(base_rec)
        # Ensure the submission source has sessionkey available for mapping
        if not unified_source.get("sessionkey"):
            unified_source["sessionkey"] = session_key

        if session_key_out is None:
            session_key_out = session_key
        log.debug("Processing record for sessionkey=%s", session_key)

        # Strict field filtering to mapped QIDs + sessionkey from the unified source (handles top-level fields like 'computerno')
        submission = filter_allowed_fields(unified_source, mapping, include_extras=("sessionkey",))
        # For updates, exclude sessionkey from payload per PRD
        update_submission = dict(submission)
        if session_qid and session_qid in update_submission:
            update_submission.pop(session_qid, None)
        # Minimize update payload: drop empty/None values to avoid clearing fields and reduce size
        update_submission = {
            k: v for k, v in update_submission.items() if v is not None and str(v).strip() != ""
        }

        # Prefer explicit jotformsubmissionid at top-level; fallback to any present in the base record
        sub_id = rec.get("jotformsubmissionid") or (base_rec.get("jotformsubmissionid") if isinstance(base_rec, dict) else None)
        current_result = {
            "sessionkey": session_key,
            "action": None,
            "submissionid": None,
            "status": "pending",
            "message": "",
        }
        if sub_id:
            upd_url = f"https://api.jotform.com/submission/{sub_id}"
            _post_update_in_chunks(upd_url, params=params, payload=update_submission, timeout=90, attempts=5, chunk_size=80)
            results["updated"] += 1
            log.debug("Updated Jotform submission %s", sub_id)
            if submission_id_out is None:
                submission_id_out = str(sub_id)
            _verify_submission(api_key, str(sub_id), session_qid=session_qid, expected_sessionkey=session_key)
            current_result.update(action="updated", submissionid=str(sub_id), status="success")
        else:
            # Preflight search by sessionkey if possible (via client helper)
            found_id = jotform_search_by_sessionkey(api_key, form_id, session_key, session_qid)
            if found_id:
                upd_url = f"https://api.jotform.com/submission/{found_id}"
                _post_update_in_chunks(upd_url, params=params, payload=update_submission, timeout=90, attempts=5, chunk_size=80)
                results["updated"] += 1
                rec["jotformsubmissionid"] = found_id
                if submission_id_out is None:
                    submission_id_out = found_id
                log.debug("Preflight matched; updated Jotform submission %s", found_id)
                _verify_submission(api_key, found_id, session_qid=session_qid, expected_sessionkey=session_key)
                current_result.update(action="updated", submissionid=found_id, status="success")
            else:
                # Create then capture submission ID; on uniqueness error, fallback to search+update
                try:
                    # Create with non-empty fields to reduce payload size
                    create_payload = _filter_nonempty_values(submission)
                    netlog.info("POST %s", create_url)
                    resp = _request_with_retry("POST", create_url, params=params, data=_to_form_body(create_payload), timeout=90)
                    netlog.info("<- %s %s", resp.status_code, resp.reason)
                    resp.raise_for_status()
                    result_json = resp.json()
                    new_id = (
                        result_json.get("content", {}).get("submissionID")
                        or result_json.get("content", {}).get("id")
                    )
                    if new_id:
                        rec["jotformsubmissionid"] = str(new_id)
                        if submission_id_out is None:
                            submission_id_out = str(new_id)
                        log.debug("Created Jotform submission %s", new_id)
                    results["created"] += 1
                    if new_id:
                        _verify_submission(api_key, str(new_id), session_qid=session_qid, expected_sessionkey=session_key)
                    current_result.update(action="created", submissionid=str(new_id) if new_id else None, status="success")
                except requests.HTTPError as e:
                    # Fallback: try searching and updating in case of unique key collision
                    log.warning("Create failed for sessionkey=%s: %s. Trying search+update.", session_key, e)
                    fallback_id = _search_submission_by_sessionkey(api_key, form_id, session_key, session_qid)
                    if fallback_id:
                        upd_url = f"https://api.jotform.com/submission/{fallback_id}"
                        _post_update_in_chunks(upd_url, params=params, payload=update_submission, timeout=90, attempts=5, chunk_size=80)
                        results["updated"] += 1
                        rec["jotformsubmissionid"] = fallback_id
                        if submission_id_out is None:
                            submission_id_out = fallback_id
                        log.debug("Conflict handled; updated existing submission %s", fallback_id)
                        _verify_submission(api_key, fallback_id, session_qid=session_qid, expected_sessionkey=session_key)
                        current_result.update(action="updated", submissionid=fallback_id, status="success", message="create failed; updated existing")
                    else:
                        current_result.update(action="create_failed", status="error", message=str(e))
                        per_record.append(current_result)
                        raise

        if current_result["status"] == "pending":
            current_result["status"] = "success"
        per_record.append(current_result)

    if raw_data is not None:
        # JSON inputs: write back updated data including jotformsubmissionid
        data_path.write_text(
            json.dumps(raw_data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    elif data_path.suffix.lower() == ".csv":
        # CSV inputs: write back jotformsubmissionid
        try:
            # Detect if the original CSV was two-column (key,value) or multi-row with headers
            with open(data_path, newline="", encoding="utf-8-sig") as fh:
                reader_peek = list(csv.reader(fh))
            # Never treat as two-column if a 'sessionkey' header is present
            header = reader_peek[0] if reader_peek else []
            has_sessionkey_header = any(str(c).strip().lower() == "sessionkey" for c in header)
            is_two_column = bool(reader_peek) and all(len(r) == 2 for r in reader_peek) and not has_sessionkey_header

            if is_two_column:
                # Single-record key/value CSV: records is a single dict
                rec_dict = records[0] if records else {}
                with open(data_path, "w", newline="", encoding="utf-8-sig") as fh:
                    w = csv.writer(fh)
                    for k, v in rec_dict.items():
                        w.writerow([k, v])
            else:
                # Multi-row CSV:
                # - If the original CSV has a 'sessionkey' column, update only the matching row's 'jotformsubmissionid'.
                # - Otherwise, fall back to writing processed records (adds sessionkey and jotformsubmissionid if needed).
                with open(data_path, newline="", encoding="utf-8-sig") as in_fh:
                    dr = csv.DictReader(in_fh)
                    orig_headers = dr.fieldnames or []

                # Build a lookup from sessionkey -> jotformsubmissionid from processed records
                id_by_session = {}
                for r in records:
                    sk = r.get("sessionkey")
                    sid = r.get("jotformsubmissionid")
                    if sk and sid:
                        id_by_session[str(sk).strip()] = str(sid)

                if "sessionkey" in orig_headers:
                    headers = list(orig_headers)
                    if "jotformsubmissionid" not in headers:
                        # Insert immediately after 'sessionkey' to preserve expected structure
                        try:
                            idx = headers.index("sessionkey") + 1
                        except ValueError:
                            idx = len(headers)
                        headers.insert(idx, "jotformsubmissionid")
                    # Create the temporary file in the SAME directory as the target CSV
                    tmp_dir = str(Path(data_path).parent)
                    tmp = tempfile.NamedTemporaryFile(
                        "w",
                        delete=False,
                        newline="",
                        encoding="utf-8-sig",
                        dir=tmp_dir,
                        prefix=f".{Path(data_path).stem}_",
                        suffix=".tmp",
                    )
                    tmp_name = tmp.name
                    # Diagnostic: log where the temp file is created, and the system temp
                    try:
                        log.info(
                            "CSV write-back temp: dir=%s file=%s sys_temp=%s",
                            tmp_dir,
                            tmp_name,
                            tempfile.gettempdir(),
                        )
                    except Exception:
                        pass
                    try:
                        dw = csv.DictWriter(tmp, fieldnames=headers, extrasaction="ignore", restval="")
                        dw.writeheader()
                        # Re-open input for iteration while writing to temp
                        with open(data_path, newline="", encoding="utf-8-sig") as in_rows:
                            dr_rows = csv.DictReader(in_rows)
                            for row in dr_rows:
                                sk = row.get("sessionkey")
                                if sk is not None:
                                    sid = id_by_session.get(str(sk).strip())
                                    if sid is not None:
                                        row["jotformsubmissionid"] = sid
                                dw.writerow(row)
                    finally:
                        tmp.close()
                    # Replace atomically within the same volume; if that still fails, fallback to a move
                    try:
                        try:
                            os.replace(tmp_name, data_path)
                        except OSError as e:
                            try:
                                log.debug("os.replace failed (%s); falling back to shutil.move for %s", e, data_path)
                            except Exception:
                                pass
                            shutil.move(tmp_name, data_path)
                    finally:
                        # Best-effort cleanup: if temp still exists (i.e., replace/move failed), remove it
                        try:
                            if os.path.exists(tmp_name):
                                os.unlink(tmp_name)
                                try:
                                    log.debug("Removed leftover temp file: %s", tmp_name)
                                except Exception:
                                    pass
                        except Exception:
                            pass
                else:
                    # As per product rule, 'sessionkey' should always exist; if not, skip write-back
                    log.warning("CSV %s has no 'sessionkey' column; skipping write-back of jotformsubmissionid", data_path)
        except Exception as e:
            log.warning("Failed to write back Jotform IDs to CSV %s: %s", data_path, e)

    log.info(
        "Created %d and updated %d record(s) in Jotform form '%s'",
        results["created"],
        results["updated"],
        form_id,
    )
    return (session_key_out, submission_id_out), per_record


def upload_to_jotform_with_results(data_path: Path, system_password: str) -> dict:
    """Upload records to Jotform and return detailed per-record results.

    Returns a dict with keys:
      - first_sessionkey, first_submissionid
      - results: list of per-record statuses
    """
    (first_sessionkey, first_submissionid), per_record = _upload_to_jotform_core(data_path, system_password)
    return {
        "first_sessionkey": first_sessionkey,
        "first_submissionid": first_submissionid,
        "results": per_record,
    }


def upload_to_jotform(data_path: Path, system_password: str) -> tuple[str | None, str | None]:
    """Backward-compatible wrapper: returns only (sessionkey, submissionid)."""
    (first_sessionkey, first_submissionid), _ = _upload_to_jotform_core(data_path, system_password)
    return first_sessionkey, first_submissionid


def log_upload_record(
    filename: str | Path,
    session_key: str | None,
    jotform_submission_id: str | None,
    system_password: str,
) -> None:
    """Optionally log upload metadata to Supabase and/or a Jotform log form.

    No local file is created. External logging is controlled by feature flags
    in credentials under `uploadLogging`:
      {
        "uploadLogging": { "enabled": false, "supabase": false, "jotform": false }
      }
    """
    creds = _load_credentials(system_password)
    logging_cfg = (creds.get("uploadLogging") or creds.get("upload_logging") or {})
    enabled = bool(logging_cfg.get("enabled", False))
    jotform_enabled = bool(logging_cfg.get("jotform", False))

    if not (enabled and jotform_enabled):
        log.debug("Upload logging disabled; skipping external logging")
        return

    api_key = creds.get("jotformApiKey") or creds.get("jotform", {}).get("apiKey")
    form_id = creds.get("jotformUploadLogFormId")
    if not api_key or not form_id:
        log.debug("Upload logging enabled but Jotform credentials are missing; skipping")
        return
            log.warning("Failed to fetch Jotform log form questions: %s", e)
            mapping = {}

        for key, value in record.items():
            qid = mapping.get(key)
            if qid is not None:
                submission[qid] = value if value is not None else ""
        if submission:
            try:
                netlog.info("POST %s", create_url)
                response = requests.post(
                    create_url,
                    params=params,
                    json={"submission": submission},
                    headers=headers,
                    timeout=30,
                )
                netlog.info("<- %s %s", response.status_code, response.reason)
                response.raise_for_status()
                log.debug("Logged upload record to Jotform form '%s'", form_id)
            except requests.RequestException as e:
                log.warning("Failed to log upload to Jotform: %s", e)
def import_from_jotform(student_id: str, system_password: str) -> list[dict]:
    """Fetch records for ``student_id`` from Jotform."""
    creds = _load_credentials(system_password)
    api_key = creds.get("jotformApiKey") or creds.get("jotform", {}).get("apiKey")
    form_id = creds.get("jotformFormId") or creds.get("jotform", {}).get("formId")

    if not api_key or not form_id:
        raise RuntimeError("Jotform credentials missing in credentials file")

    filter_param = json.dumps({"studentId": student_id})
    url = f"https://api.jotform.com/form/{form_id}/submissions"
    headers = {"APIKEY": api_key}
    resp = requests.get(url, params={"filter": filter_param}, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json().get("content", [])
    records: list[dict] = []
    for sub in data:
        answers = sub.get("answers") or {}
        rec: dict[str, str] = {}
        for key, val in answers.items():
            if isinstance(val, dict) and "answer" in val:
                rec[key] = val["answer"]
            else:
                rec[key] = val
        records.append(rec)
    return records


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Upload and maintenance utilities")
    parser.add_argument("data_path", type=Path, nargs="?", help="Path to CSV or JSON data file")
    parser.add_argument("--password", required=True, help="System password for decrypting credentials")
    # Upload targets
    parser.add_argument("--jotform", action="store_true", help="Upload data_path to Jotform")
    parser.add_argument("--refresh-jotform-questions", action="store_true", help="Fetch Jotform form questions and update assets/jotformquestions.json")
    parser.add_argument("--jotform-form-id", dest="jotform_form_id", help="Override Jotform Form ID for refresh")
    parser.add_argument("--jotform-api-key", dest="jotform_api_key", help="Override Jotform API Key for refresh")
    args = parser.parse_args()

    ran_any = False
    if args.jotform:
        if not args.data_path:
            parser.error("data_path is required for uploads")
        if args.jotform:
            upload_to_jotform(args.data_path, args.password)
            ran_any = True

    if args.refresh_jotform_questions:
        path = refresh_jotform_questions(
            args.password,
            form_id=args.jotform_form_id,
            api_key=args.jotform_api_key,
        )
        print(f"Updated Jotform mapping at {path}")
        ran_any = True

    if not ran_any:
        parser.error("No action selected. Use --jotform for uploads.")
