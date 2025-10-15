"""PDF utilities for generating, monitoring and parsing survey PDFs."""

import csv
import json
import logging
import subprocess
from pathlib import Path
from io import StringIO
from typing import Any, Dict, Optional, List, Tuple
import xml.etree.ElementTree as ET

# Configure logging to show INFO level messages for detailed process tracking.
# To see even more verbose output (like raw data dictionaries), the level
# would need to be changed to logging.DEBUG in a future implementation.
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
log = logging.getLogger(__name__)

# External packages would be required for real implementation
# Try modern pypdf first, then fallback to PyPDF2 for compatibility
try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import BooleanObject, NameObject
    log.info("Using modern pypdf library for better form field support")
except ImportError:
    try:
        from PyPDF2 import PdfReader, PdfWriter
        from PyPDF2.generic import BooleanObject, NameObject
        log.info("Using PyPDF2 library - consider upgrading to pypdf for better form field support")
    except ImportError:  # pragma: no cover - package might not be installed
        PdfReader = PdfWriter = BooleanObject = NameObject = None  # type: ignore
        log.warning("No PDF library available - PDF operations will not work")

# GUI dependency removed for standalone CLI usage
# from pdf_parser_gui.encryption import decrypt_data
decrypt_data = None  # Not needed for CLI parsing


def _normalize_lookup_key(key: str) -> str:
    """Normalizes a key for fuzzy matching.

    Strips quotes/whitespace, converts to lowercase and removes **all**
    non-alphanumeric characters. This ensures that variations like
    ``"School ID"``, ``"school-id"`` and ``"School_ID"`` all normalize to
    ``"schoolid"`` for robust mapping comparisons.
    """

    cleaned = key.strip().replace('"', "").lower()
    return "".join(ch for ch in cleaned if ch.isalnum())


def _strip_tgmd_trial_suffix(name: str) -> str:
    """Return canonical TGMD field name without trial-specific markers.

    TGMD task names may include explicit trial suffixes (``_t1``/``_t2``) or
    encode the second trial by bumping the middle digit of the numeric code
    (e.g. ``TGMD_121_Hop`` or ``TGMD_521_Cat`` for the second trial of
    ``TGMD_111_Hop``/``TGMD_511_Cat``). This helper normalizes all such
    variants to their base task names so that mappings treat them equivalently
    and adds debug logging to show any conversions that occur.
    """

    if not name.startswith("TGMD_"):
        return name

    base = name.split("_t")[0]
    parts = base.split("_")
    if len(parts) >= 3:
        code = parts[1]
        if len(code) == 3 and code.isdigit() and code[1] == "2":
            # Some PDFs encode second trials by bumping the middle digit
            # (e.g. 121 -> 111, 521 -> 511).
            parts[1] = str(int(code) - 10)
            base = "_".join(parts)

    if base != name:
        log.debug("TGMD normalization: '%s' -> '%s'", name, base)

    return base


def _choose_best_field_name(field_names: List[str]) -> str:
    """Choose the most meaningful field name from a list of candidates."""
    meaningful_names = [name for name in field_names if not name.startswith('field_')]
    if meaningful_names:
        return sorted(meaningful_names, key=len)[0]
    return sorted(field_names, key=len)[0]


def deduplicate_fields(fields: Dict[str, str]) -> Dict[str, str]:
    """Remove duplicate placeholder fields and normalize termination-prefixed names."""

    value_to_fields: Dict[str, List[str]] = {}
    for field_name, field_value in fields.items():
        value_to_fields.setdefault(field_value, []).append(field_name)

    deduplicated: Dict[str, str] = {}
    for field_value, field_names in value_to_fields.items():
        if len(field_names) == 1:
            deduplicated[field_names[0]] = field_value
            continue

        # Only collapse entries when placeholder field names are involved.
        # This prevents legitimate fields with identical values from being
        # dropped during parsing (e.g. ERV_P1/ERV_P2 both containing "4").
        if all(not name.startswith('field_') for name in field_names):
            for name in field_names:
                deduplicated[name] = field_value
        else:
            best_name = _choose_best_field_name(field_names)
            deduplicated[best_name] = field_value

    normalized: Dict[str, str] = {}
    for name, value in deduplicated.items():
        if name.startswith('term_'):
            base_name = name[5:]
            if base_name in deduplicated or base_name in normalized:
                continue
            normalized[base_name] = value
        else:
            normalized[name] = value

    return normalized

def _detect_pdf_type(reader: "PdfReader") -> str:
    """Return a simple string describing the PDF form type."""
    try:
        root = reader.trailer.get("/Root", {})
        acro_form = root.get("/AcroForm")
        if acro_form is None:
            return "No AcroForm"
        if acro_form.get("/XFA"):
            return "XFA"
        return "AcroForm"
    except Exception:
        return "Unknown"

def _fuzzy_find_in_mapping(normalized_text: str, sorted_keys: List[str]) -> Optional[str]:
    """Find the best substring match for ``normalized_text`` in ``sorted_keys``.

    Both the search text and keys are normalised using
    :func:`_normalize_lookup_key` so that spacing differences (spaces vs.
    hyphens/underscores) do not prevent a match.
    """

    normalized_text = _normalize_lookup_key(normalized_text)
    for key in sorted_keys:
        if _normalize_lookup_key(key) in normalized_text:
            return key
    return None

def _scan_page_annotations(reader: "PdfReader") -> Dict[str, str]:
    """Manually scan page annotations for form fields."""
    fields: Dict[str, str] = {}
    
    for page in reader.pages:
        # Some PDFs have /Annots as a direct object, others as an indirect reference
        try:
            annots = page.get("/Annots", [])
            if not annots:
                continue
            
            for annot_ref in annots:
                annot = annot_ref.get_object()
                
                field_name = annot.get("/T")
                if not field_name:
                    continue
                
                field_name_str = str(field_name)
                
                # Check for alternate field name in /TU (tooltip/user) or /TM (mapping name)
                # These might contain the QID values
                alt_name = annot.get("/TU") or annot.get("/TM")
                if alt_name:
                    alt_name_str = str(alt_name)
                    # If alternate name looks like a QID, use it instead
                    if "QID" in alt_name_str.upper():
                        log.debug(f"Using alternate field name: {alt_name_str} (original: {field_name_str})")
                        field_name_str = alt_name_str
                
                field_type = annot.get("/FT")

                # Handle Radio Buttons (/Btn field type with Radio flag)
                is_radio = False
                if field_type == "/Btn":
                    field_flags = annot.get("/Ff", 0)
                    # The Radio flag is bit 16 (1-based index), so 1 << 15
                    if field_flags & (1 << 15):
                        is_radio = True

                if is_radio:
                    # For a radio button group, only the selected widget will have
                    # an Appearance State (/AS) that is not /Off. This state name
                    # is the export value for the entire group.
                    appearance_state = annot.get("/AS")
                    if appearance_state and str(appearance_state) != "/Off":
                        fields[field_name_str] = str(appearance_state)
                else:
                    # For other fields (like text or checkboxes), get value from /V.
                    value = annot.get("/V")
                    if field_name_str not in fields:
                        fields[field_name_str] = "" if value is None else str(value)
        except Exception as e:
            log.warning(f"Could not process annotations on a page: {e}")

    return fields


def _extract_acro_fields(reader: "PdfReader") -> Dict[str, Any]:
    """Extract form fields from an AcroForm PDF using available methods."""
    fields: Optional[Dict[str, Any]] = None
    log.info("Trying primary parsing method: get_fields()")
    try:
        fields = reader.get_fields()
        if fields:
            log.info(f"get_fields() found {len(fields)} fields.")
            # Log first few field names for debugging
            sample_fields = list(fields.keys())[:5]
            log.info(f"Sample field names: {sample_fields}")
    except Exception as e:
        log.warning(f"get_fields() failed: {e}")
        fields = None

    if not fields:
        log.info("Primary method failed. Trying fallback: Scanning page annotations.")
        fields = _scan_page_annotations(reader)
        if fields:
            log.info(f"Annotation scan found {len(fields)} fields")

    return fields or {}


def _convert_xfa_with_pdfcpu(input_path: Path, output_path: Path) -> bool:
    """Attempt to convert an XFA PDF to AcroForm using pdfcpu CLI."""
    try:
        try:
            original = PdfReader(str(input_path))
            had_bookmarks = "/Outlines" in original.trailer.get("/Root", {})
        except Exception:
            had_bookmarks = False

        result = subprocess.run(
            ["pdfcpu", "optimize", "-xfa", "off", str(input_path), str(output_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0 and output_path.exists():
            try:
                converted = PdfReader(str(output_path))
                root = converted.trailer.get("/Root", {})
                if "/AcroForm" not in root:
                    log.warning("Converted PDF missing AcroForm catalog")
                if had_bookmarks and "/Outlines" not in root:
                    log.warning("Converted PDF lost bookmarks")
            except Exception as e:
                log.warning(f"Post-conversion validation failed: {e}")
            log.info("pdfcpu conversion succeeded")
            return True
        log.warning(f"pdfcpu conversion failed: {result.stderr.strip()}")
    except FileNotFoundError:
        log.warning("pdfcpu CLI not found; skipping XFA conversion")
    except Exception as e:
        log.warning(f"pdfcpu conversion error: {e}")
    return False


def _extract_xfa_xml(reader: "PdfReader") -> Dict[str, str]:
    """Parse XFA XML packet and return field name/value pairs."""
    fields: Dict[str, str] = {}
    try:
        root = reader.trailer["/Root"]["/AcroForm"]
        xfa = root.get("/XFA")
        if isinstance(xfa, list):
            xml_obj = xfa[-1].get_object()
        else:
            xml_obj = xfa
        xml_data = xml_obj.get_data()
        xml_root = ET.fromstring(xml_data)
        for node in xml_root.iter():
            name = node.attrib.get("name")
            text = node.text.strip() if node.text else ""
            if name and text:
                segment = name.split(".")[-1]
                segment = segment.split("[")[0]
                fields[segment] = text
    except Exception as e:
        log.warning(f"Failed to extract XFA XML: {e}")
    return fields

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
ID_MAPPING_DIR = ASSETS_DIR / "id_mapping"

# This maps common CSV headers to the internal IDs used by the application.
# It's case-insensitive and handles spaces.
# Also used as fallback for PDF field display labels
HEADER_MAPPING = {
    # coreid.csv specific (keep core-id distinct from student-id)
    'core id': 'core-id',
    'student name': 'child-name',
    'class id 25/26': 'class-id',

    # General / from other files (also used for PDF field labels)
    'student id': 'student-id',
    'school id': 'school-id',
    'school code': 'school-id',  # PDF field label variant
    'school name (chinese)': 'school-name',
    'class id': 'class-id',
    'actual class name': 'class-name',
    'gender': 'gender',
    'group': 'group',
}

def _normalize_header(header: str) -> str:
    """Normalizes a CSV header to a standard internal format."""
    normalized = header.strip().replace('"', '').lower()
    mapped_header = HEADER_MAPPING.get(normalized, normalized)
    if header != mapped_header:
        log.info(f"CSV Header Mapping: Normalized '{header}' -> Mapped to '{mapped_header}'")
    else:
        log.debug(f"CSV Header Mapping: Kept original (normalized) header '{header}'")
    return mapped_header


def generate_custom_pdf(
    session_key: str,
    output_path: Path,
    front_page: Optional[Path] = None,
    fill_data: Optional[Dict[str, str]] = None,
) -> None:
    """Create a PDF copy with preserved form fields, bookmarks, and pre-filled data.
    
    This function addresses the issue where form fields and bookmarks were being destroyed
    during PDF customization by using a robust preservation approach with proper object handling.
    """
    if PdfWriter is None or PdfReader is None or BooleanObject is None or NameObject is None:
        raise RuntimeError(
            "PDF library not available. Please install: pip install pypdf>=3.0.0 (recommended) "
            "or pip install PyPDF2 (legacy support)"
        )

    base_pdf_path = ASSETS_DIR / "pdf" / "4set.pdf"
    if not base_pdf_path.exists():
        raise FileNotFoundError(f"Base PDF template not found at {base_pdf_path}")

    reader = PdfReader(str(base_pdf_path))
    writer = PdfWriter()

    # === PDF FORMAT DETECTION FOR PROPER HANDLING ===
    pdf_type = _detect_pdf_type(reader)
    log.info(f"📋 PDF format detected: {pdf_type}")
    
    # Enhanced logging for XFA PDFs with fallback information
    if pdf_type == "XFA":
        log.warning("⚠️ XFA PDF detected - This format may require special handling")
        log.info("💡 XFA PDFs use XML-based forms which may not preserve correctly with standard methods")
        log.info("🔧 Consider flattening or converting XFA to AcroForm for better compatibility")
        
        # Check if XFA data exists and log details
        try:
            root = reader.trailer.get("/Root", {})
            acro_form = root.get("/AcroForm")
            if acro_form and acro_form.get("/XFA"):
                xfa_data = acro_form.get("/XFA")
                if isinstance(xfa_data, list):
                    log.info(f"📊 XFA contains {len(xfa_data)} data elements")
                else:
                    log.info("📊 XFA contains embedded XML form data")
        except Exception as xfa_error:
            log.warning(f"⚠️ Could not analyze XFA structure: {xfa_error}")
    elif pdf_type == "AcroForm":
        log.info("✅ Standard AcroForm PDF - Full form field preservation supported")
    elif pdf_type == "No AcroForm":
        log.info("📄 PDF has no form fields - Document preservation only")
    else:
        log.warning(f"⚠️ Unknown PDF format detected - Proceeding with standard preservation")

    # === FIXED PDF PRESERVATION USING RECOMMENDED APPROACH ===
    log.info("🔧 Starting PDF customization with proper form field preservation")
    log.info("Sessionkey policy: autosave/pdf filename anchors identity; will embed /sessionkey metadata")
    
    # Step 1: Handle front page insertion FIRST (if needed)
    front_page_count = 0
    if front_page and front_page.exists():
        log.info(f"📄 Adding front page: {front_page}")
        try:
            front_reader = PdfReader(str(front_page))
            # For front pages, we can use add_page since they typically don't have form fields
            for page_num, page in enumerate(front_reader.pages):
                writer.add_page(page)
                front_page_count += 1
                log.debug(f"   Added front page {page_num + 1}")
        except Exception as e:
            log.error(f"❌ Failed to add front page: {e}")
            # Continue without front page rather than failing

    # Step 2: Use PROPER approach - clone entire document to preserve form fields
    log.info("📋 Cloning main document with complete form field preservation")
    
    # METHOD 1: Try modern pypdf clone_document_from_reader (recommended approach)
    clone_success = False
    try:
        if hasattr(writer, 'clone_document_from_reader'):
            if front_page_count > 0:
                # If we have front pages, we need to clone into a temporary writer first
                temp_writer = PdfWriter()
                temp_writer.clone_document_from_reader(reader)
                
                # Then insert all pages from temp_writer after the front pages
                for page in temp_writer.pages:
                    writer.add_page(page)
                
                # Copy the document structure (AcroForm, bookmarks) from temp_writer
                if hasattr(temp_writer, '_root_object') and hasattr(writer, '_root_object'):
                    for key in ["/AcroForm", "/Outlines"]:
                        if key in temp_writer._root_object:
                            writer._root_object[key] = temp_writer._root_object[key]
                            log.debug(f"   Copied document structure: {key}")
            else:
                # No front pages, can clone directly
                writer.clone_document_from_reader(reader)
            
            clone_success = True
            log.info("✅ Successfully cloned document with clone_document_from_reader")
            
        elif hasattr(writer, 'append'):
            # Alternative method: append the entire reader
            writer.append(reader)
            clone_success = True
            log.info("✅ Successfully cloned document with append method")
            
    except Exception as clone_error:
        log.warning(f"⚠️ Document cloning failed: {clone_error}")
        clone_success = False

    # METHOD 2: Fallback to add_page + reattach_fields approach
    if not clone_success:
        log.info("🔄 Falling back to add_page + reattach_fields approach")
        try:
            # Add all pages from the main document
            for page_num, page in enumerate(reader.pages):
                writer.add_page(page)
                log.debug(f"   Added main document page {page_num + 1}")
            
            # CRITICAL FIX: Reattach form fields after adding all pages
            if hasattr(writer, 'reattach_fields'):
                writer.reattach_fields()
                log.info("✅ Successfully reattached form fields using reattach_fields()")
            else:
                # Manual form field preservation for older pypdf versions
                log.info("📝 Attempting manual form field preservation")
                if reader.trailer and "/Root" in reader.trailer:
                    root_ref = reader.trailer["/Root"]
                    root_obj = root_ref.get_object() if hasattr(root_ref, 'get_object') else root_ref
                    
                    if "/AcroForm" in root_obj and hasattr(writer, '_root_object'):
                        acroform_ref = root_obj["/AcroForm"]
                        try:
                            if hasattr(writer, '_import_object'):
                                imported_acroform = writer._import_object(acroform_ref)
                                writer._root_object[NameObject("/AcroForm")] = imported_acroform
                                log.info("✅ Manually preserved AcroForm structure")
                        except Exception as manual_error:
                            log.warning(f"⚠️ Manual AcroForm preservation failed: {manual_error}")
                    
                    # Also try to preserve bookmarks
                    if "/Outlines" in root_obj and hasattr(writer, '_root_object'):
                        outlines_ref = root_obj["/Outlines"]
                        try:
                            if hasattr(writer, '_import_object'):
                                imported_outlines = writer._import_object(outlines_ref)
                                writer._root_object[NameObject("/Outlines")] = imported_outlines
                                log.info("✅ Manually preserved bookmark structure")
                        except Exception as bookmark_error:
                            log.warning(f"⚠️ Manual bookmark preservation failed: {bookmark_error}")
                            
        except Exception as fallback_error:
            log.error(f"❌ Fallback method also failed: {fallback_error}")
            raise RuntimeError(f"All PDF preservation methods failed: {fallback_error}")

    # Step 3: Form field filling (now with preserved structure)
    if fill_data:
        log.info(f"✏️ Filling {len(fill_data)} form fields with preserved form structure")
        
        # Log the fields we're trying to fill
        for field_name, field_value in fill_data.items():
            log.debug(f"   📝 Target field '{field_name}' = '{field_value}'")
        
        # Use the simplified form field filling approach
        filled_fields = set()
        try:
            # Method 1: Use the writer's global form field update method
            if hasattr(writer, 'update_page_form_field_values'):
                log.info("🔧 Using page-by-page form field filling")
                pages_with_fields = 0
                
                for page_num, page in enumerate(writer.pages):
                    # Skip front pages for field filling
                    if page_num < front_page_count:
                        log.debug(f"   ⏭️ Skipping front page {page_num + 1} for field filling")
                        continue
                    
                    try:
                        # Try filling with enhanced error handling
                        try:
                            writer.update_page_form_field_values(page, fill_data, auto_regenerate=False)
                            log.debug(f"   ✅ Successfully updated fields on page {page_num + 1}")
                            pages_with_fields += 1
                            
                            # Track which fields were filled (we can't easily detect which ones)
                            for field_name in fill_data.keys():
                                filled_fields.add(field_name)
                                
                        except TypeError:
                            # Fallback for older versions without auto_regenerate
                            writer.update_page_form_field_values(page, fill_data)
                            log.debug(f"   ✅ Updated fields on page {page_num + 1} (legacy method)")
                            pages_with_fields += 1
                            
                    except Exception as page_error:
                        # Only log actual errors, not "no fields" situations
                        if "No fields" not in str(page_error):
                            log.warning(f"   ⚠️ Error filling fields on page {page_num + 1}: {page_error}")
                
                log.info(f"📊 Form field filling completed: attempted on {pages_with_fields} pages")
                
                # Report on fields that were targeted
                if filled_fields:
                    log.info(f"✅ Attempted to fill fields: {list(filled_fields)}")
            else:
                log.warning("⚠️ PyPDF version does not support form field updating")
                
        except Exception as fill_error:
            log.error(f"❌ Form field filling error: {fill_error}")

    # Step 4: Add session metadata
    try:
        writer.add_metadata({"/sessionkey": session_key})
        log.debug(f"✅ Added session metadata: {session_key}")
    except Exception as metadata_error:
        log.warning(f"⚠️ Could not add session metadata: {metadata_error}")

    # Step 7: Final validation and output with comprehensive status reporting
    log.info("📤 Writing final PDF with preserved structure")
    try:
        # Enhanced validation before writing
        total_pages = len(writer.pages)
        log.info(f"📄 Final PDF contains {total_pages} pages ({front_page_count} front + {total_pages - front_page_count} main)")
        
        # Check final AcroForm status
        acroform_status = "❌ No AcroForm"
        bookmark_status = "📑 No bookmarks"
        
        if hasattr(writer, '_root_object'):
            if NameObject("/AcroForm") in writer._root_object:
                acroform_status = "✅ AcroForm structure confirmed"
                try:
                    acroform = writer._root_object[NameObject("/AcroForm")]
                    if hasattr(acroform, 'get_object'):
                        acroform = acroform.get_object()
                    if "/Fields" in acroform:
                        field_count = len(acroform["/Fields"])
                        acroform_status += f" ({field_count} fields)"
                except Exception:
                    pass
            
            if NameObject("/Outlines") in writer._root_object:
                bookmark_status = "✅ Bookmark structure confirmed"
                try:
                    outlines = writer._root_object[NameObject("/Outlines")]
                    outline_obj = outlines.get_object() if hasattr(outlines, 'get_object') else outlines
                    if "/Count" in outline_obj:
                        bookmark_count = outline_obj["/Count"]
                        bookmark_status += f" ({bookmark_count} bookmarks)"
                except Exception:
                    pass
        
        log.info(acroform_status)
        log.info(bookmark_status)
        
        # Write the file with error handling
        with open(output_path, "wb") as fh:
            writer.write(fh)
        
        # Final file validation
        if output_path.exists():
            file_size = output_path.stat().st_size
            log.info(f"🎉 Successfully generated PDF: {output_path}")
            log.info(f"📊 Output file size: {file_size:,} bytes")
            
            # Quick validation by trying to read the generated file
            try:
                test_reader = PdfReader(str(output_path))
                test_page_count = len(test_reader.pages)
                log.info(f"✅ Generated PDF validation: {test_page_count} pages readable")
                
                # Check if form fields are actually preserved
                try:
                    test_fields = test_reader.get_fields()
                    if test_fields:
                        log.info(f"✅ Form fields confirmed in generated PDF: {len(test_fields)} fields")
                    else:
                        log.warning("⚠️ No form fields detected in generated PDF")
                except Exception:
                    log.warning("⚠️ Could not check form fields in generated PDF")
                    
            except Exception as validation_error:
                log.error(f"❌ Generated PDF validation failed: {validation_error}")
        else:
            raise FileNotFoundError(f"Generated PDF file not found at {output_path}")
        
    except Exception as write_error:
        log.error(f"❌ Error writing PDF file: {write_error}")
        raise


def parse_pdf_to_csv(pdf_path: Path, mapping: Dict[str, str]) -> Dict[str, str]:
    """Extract form fields from a completed PDF."""
    if PdfReader is None:
        raise RuntimeError('PyPDF2 not installed')

    reader = PdfReader(str(pdf_path))
    pdf_type = _detect_pdf_type(reader)
    log.info(f'📋 PDF format detected during parsing: {pdf_type}')
    log.info("Sessionkey derivation order: autosave filename > PDF filename > form-field > generated")

    raw_fields: Dict[str, Any] = {}

    if pdf_type == 'AcroForm':
        log.info('✅ Standard AcroForm PDF - Full field extraction supported')
        raw_fields = _extract_acro_fields(reader)
    elif pdf_type == 'XFA':
        log.warning('⚠️ XFA PDF detected during parsing - attempting conversion')
        temp_path = pdf_path.with_suffix('.acro.pdf')
        if _convert_xfa_with_pdfcpu(pdf_path, temp_path):
            log.info('📄 Conversion successful - parsing converted AcroForm')
            reader = PdfReader(str(temp_path))
            raw_fields = _extract_acro_fields(reader)
        else:
            log.info('📄 Falling back to direct XFA XML extraction')
            raw_fields = _extract_xfa_xml(reader)
    else:
        raise ValueError('PDF contains no form data')

    if not raw_fields:
        raise ValueError(
            'No form fields found in the selected PDF. Please ensure you are using a valid completed survey PDF.'
        )

    data: Dict[str, str] = {}
    sorted_mapping_keys = sorted(mapping.keys(), key=len, reverse=True)

    for field_name, value_obj in raw_fields.items():
        # Check if value_obj has alternate field name properties (for pypdf field objects)
        actual_field_name = field_name
        if hasattr(value_obj, 'get'):
            # Try to get alternate field name from /TU or /TM
            alt_name = value_obj.get("/TU") or value_obj.get("/TM")
            if alt_name and "QID" in str(alt_name).upper():
                actual_field_name = str(alt_name)
                log.debug(f"Using alternate field name: {actual_field_name} (original: {field_name})")
        
        normalized_full_name = _normalize_lookup_key(actual_field_name)
        mapped_key = mapping.get(normalized_full_name) or mapping.get(actual_field_name.lower())

        if mapped_key is None:
            found_key = _fuzzy_find_in_mapping(normalized_full_name, sorted_mapping_keys)
            if found_key:
                mapped_key = mapping[found_key]
                log.info(
                    f"PDF Field Mapping: Fuzzy matched full name '{actual_field_name}' to internal ID '{mapped_key}' using key '{found_key}'"
                )

        if mapped_key is None:
            partial_name = actual_field_name.split('.')[-1]
            if partial_name != actual_field_name:
                normalized_partial_name = _normalize_lookup_key(partial_name)
                mapped_key = mapping.get(normalized_partial_name)
                if mapped_key is None:
                    found_key = _fuzzy_find_in_mapping(normalized_partial_name, sorted_mapping_keys)
                    if found_key:
                        mapped_key = mapping[found_key]
                        log.info(
                            f"PDF Field Mapping: Fuzzy matched partial name '{partial_name}' to internal ID '{mapped_key}' using key '{found_key}'"
                        )

        # TGMD fields may include trial suffixes like `_t1`/`_t2`. If no match
        # was found yet, try resolving the base task name.
        if mapped_key is None and actual_field_name.startswith("TGMD_"):
            base_name = _strip_tgmd_trial_suffix(actual_field_name)
            normalized_base = _normalize_lookup_key(base_name)
            mapped_key = mapping.get(normalized_base)
            if mapped_key is None:
                found_key = _fuzzy_find_in_mapping(normalized_base, sorted_mapping_keys)
                if found_key:
                    mapped_key = mapping[found_key]
                    log.info(
                        "PDF Field Mapping: Resolved TGMD field '%s' to internal ID '%s' using base '%s'",
                        actual_field_name,
                        mapped_key,
                        found_key,
                    )

        # Fallback: Try HEADER_MAPPING for display labels (e.g., "Student ID" -> "student-id")
        if mapped_key is None:
            normalized_field = actual_field_name.strip().replace('"', '').lower()
            header_mapped = HEADER_MAPPING.get(normalized_field)
            if header_mapped:
                mapped_key = header_mapped
                log.info(f"PDF Field Mapping: Applied header mapping '{actual_field_name}' -> '{mapped_key}'")

        key = mapped_key if mapped_key else actual_field_name
        if isinstance(key, str) and key.upper().startswith("QID"):
            key = key.lower()
        if not mapped_key:
            log.debug(f"PDF Field Mapping: No mapping found for '{actual_field_name}'. Using original name.")

        raw_value = value_obj
        if not isinstance(raw_value, str):
            raw_value = getattr(raw_value, 'value', None)

        if raw_value is not None:
            value_str = str(raw_value)
            processed_value = value_str[1:] if value_str.startswith('/') else value_str
            data[key] = processed_value
        else:
            data[key] = ''

    autosave_path = pdf_path.with_suffix('.json')
    if autosave_path.exists():
        try:
            autosave_data = json.loads(autosave_path.read_text('utf-8'))
            autosave_fields = autosave_data.get('data', {})
            if isinstance(autosave_fields, dict):
                for k, v in autosave_fields.items():
                    # Only use autosave values as a fallback – do not overwrite freshly parsed values
                    if isinstance(v, str):
                        key = k.lower() if isinstance(k, str) and k.upper().startswith("QID") else k
                        existing = data.get(key)
                        if existing is None or existing == "":
                            data[key] = v
                        else:
                            log.debug(
                                "Autosave fallback skipped for '%s' – keeping parsed value '%s'",
                                key,
                                existing,
                            )
        except Exception as e:
            log.error(f'Failed to read autosave file {autosave_path}: {e}')

    data = deduplicate_fields(data)
    # --- Sessionkey Handling for Server Pipeline ------------------------------------
    # SERVER MODE: Do NOT overwrite sessionkey from filename!
    # Rationale: The server validator (Invoke-Phase2Validation) needs to compare the
    # ORIGINAL sessionkey from the PDF form against the filename to detect mismatches.
    # If we overwrite here, validation can't catch data corruption or filing errors.
    #
    # The sessionkey field from the PDF should be preserved as-is for validation.
    # After validation passes, the PowerShell enrichment step will ensure sessionkey
    # matches the filename (line 1658 in processor_agent.ps1).
    #
    # DESKTOP MODE: If you need auto-correction for desktop tools, add a flag parameter
    # to enable the old behavior conditionally.
    
    # Log the sessionkey status for diagnostics
    try:
        canonical_key = None
        autosave_path = pdf_path.with_suffix('.json')
        if autosave_path.exists():
            canonical_key = autosave_path.stem
        if not canonical_key:
            canonical_key = pdf_path.stem

        if canonical_key:
            current_key = data.get("sessionkey")
            if current_key != canonical_key:
                log.warning(
                    "SESSIONKEY MISMATCH: PDF has '%s' but filename indicates '%s'. "
                    "Server validator will reject this file.",
                    current_key,
                    canonical_key,
                )
                # DO NOT OVERWRITE - let validator catch this!
                # Old behavior (disabled): data["sessionkey"] = canonical_key
            else:
                log.info(
                    "Sessionkey validation: PDF sessionkey '%s' matches filename ✓",
                    current_key,
                )

            # Write-back into autosave JSON for resilience (DISABLED for server mode)
            # In server mode, we want to preserve the original PDF sessionkey for validation
            # Uncomment the block below if needed for desktop tools
            # if autosave_path.exists():
            #     try:
            #         autosave_data = json.loads(autosave_path.read_text('utf-8'))
            #     except Exception:
            #         autosave_data = {}
            #     if not isinstance(autosave_data, dict):
            #         autosave_data = {}
            #     inner = autosave_data.get('data')
            #     if not isinstance(inner, dict):
            #         inner = {}
            #     if inner.get('sessionkey') != canonical_key:
            #         inner['sessionkey'] = canonical_key
            #         autosave_data['data'] = inner
            #         try:
            #             autosave_path.write_text(
            #                 json.dumps(autosave_data, ensure_ascii=False, indent=2) + "\n",
            #                 encoding='utf-8',
            #             )
            #         except Exception as e:
            #             log.warning("Failed to write sessionkey to autosave '%s': %s", autosave_path, e)
    except Exception as e:
        log.warning("Sessionkey preservation check failed: %s", e)

    return data


def map_pdf_field_data(raw_fields: Dict[str, str], mapping: Dict[str, str]) -> Dict[str, str]:
    """Map raw PDF field names to internal IDs using improved matching logic.

    This helper mirrors the field-name normalization logic used in
    :func:`parse_pdf_to_csv` but operates on an already extracted dictionary of
    field values. It is intended for live monitoring where form data is
    captured directly from an open PDF application rather than a saved file.

    Args:
        raw_fields: Mapping of PDF form field names to their string values.
        mapping: Normalized mapping of PDF field names to internal IDs.

    Returns:
        Dictionary keyed by internal IDs (or original field name if no mapping
        exists) containing the corresponding string values.
    """

    sorted_mapping_keys = sorted(mapping.keys(), key=len, reverse=True)
    data: Dict[str, str] = {}
    unmapped_count = 0
    unmapped_fields = []

    for field_name, value in raw_fields.items():
        mapped_key = None
        
        # Step 1: Try exact normalized lookup first (highest priority)
        normalized_full_name = _normalize_lookup_key(field_name)
        mapped_key = mapping.get(normalized_full_name)

        # Step 2: If no exact match, try fuzzy matching as fallback
        if mapped_key is None:
            found_key = _fuzzy_find_in_mapping(normalized_full_name, sorted_mapping_keys)
            if found_key:
                mapped_key = mapping[found_key]
                log.debug(
                    "PDF Field Mapping: Fuzzy matched full name '%s' to internal ID '%s' using key '%s'",
                    field_name,
                    mapped_key,
                    found_key,
                )

        # Step 3: Try partial name matching if still no match
        if mapped_key is None:
            partial_name = field_name.split('.')[-1]
            if partial_name != field_name:
                normalized_partial_name = _normalize_lookup_key(partial_name)
                mapped_key = mapping.get(normalized_partial_name)
                if mapped_key is None:
                    found_key = _fuzzy_find_in_mapping(normalized_partial_name, sorted_mapping_keys)
                    if found_key:
                        mapped_key = mapping[found_key]
                        log.debug(
                            "PDF Field Mapping: Fuzzy matched partial name '%s' to internal ID '%s' using key '%s'",
                            partial_name,
                            mapped_key,
                            found_key,
                        )

        # TGMD fields may include trial suffixes like `_t1`/`_t2`. If still
        # unresolved, attempt to match the base task name without the suffix.
        if mapped_key is None and field_name.startswith("TGMD_"):
            base_name = _strip_tgmd_trial_suffix(field_name)
            normalized_base = _normalize_lookup_key(base_name)
            mapped_key = mapping.get(normalized_base)
            if mapped_key is None:
                found_key = _fuzzy_find_in_mapping(normalized_base, sorted_mapping_keys)
                if found_key:
                    mapped_key = mapping[found_key]
                    log.debug(
                        "PDF Field Mapping: Resolved TGMD field '%s' to internal ID '%s' using base '%s'",
                        field_name,
                        mapped_key,
                        found_key,
                    )

        # Use mapped key if found, otherwise use original field name
        key = mapped_key if mapped_key else field_name
        if isinstance(key, str) and key.upper().startswith("QID"):
            key = key.lower()
        if not mapped_key:
            unmapped_count += 1
            unmapped_fields.append(field_name)
            # Downgrade to debug level to reduce noise as suggested
            log.debug(
                "PDF Field Mapping: No mapping found for '%s'. Using original name.",
                field_name,
            )

        value_str = str(value)
        processed_value = value_str[1:] if value_str.startswith('/') else value_str
        data[key] = processed_value

    data = deduplicate_fields(data)

    # Enhanced summary logging with list of unmapped fields
    if unmapped_count > 0:
        log.info(f"PDF Field Mapping: {unmapped_count} fields used original names (no mapping found)")
        if unmapped_count <= 5:  # Show details for small numbers
            log.info(f"Unmapped fields: {', '.join(unmapped_fields)}")
        else:  # Just show count for large numbers to avoid log spam
            log.debug(f"Unmapped fields: {', '.join(unmapped_fields)}")

    # Reorder output according to mapping insertion order so that snapshots
    # follow the field order defined in the mapping/JSON. Any fields not present
    # in the mapping are appended afterwards in their original order.
    if mapping:
        ordered: Dict[str, str] = {}
        for normalized_key in mapping:
            internal_id = mapping[normalized_key]
            internal_id_key = (
                internal_id.lower()
                if isinstance(internal_id, str) and internal_id.upper().startswith("QID")
                else internal_id
            )
            if internal_id_key in data:
                ordered[internal_id_key] = data.pop(internal_id_key)
        # Append remaining unmapped fields
        for k, v in data.items():
            ordered[k] = v
        data = ordered

    return data


def _load_secure_csv_content(filename: str, password: str) -> Optional[str]:
    """A helper to load and decrypt a CSV file, returning its content."""
    enc_path = ID_MAPPING_DIR / f"{Path(filename).stem}.enc"
    csv_content = None

    if enc_path.exists():
        try:
            encrypted_data = enc_path.read_bytes()
            decrypted_bytes = decrypt_data(encrypted_data, password)
            csv_content = decrypted_bytes.decode("utf-8-sig")
            print(f"INFO: Loaded and decrypted {enc_path.name}")
        except Exception as e:
            print(f"ERROR: Failed to decrypt {enc_path.name}: {e}. Falling back.")

    if csv_content is None:
        csv_path = ID_MAPPING_DIR / filename
        if csv_path.exists():
            print(f"WARNING: Loading unencrypted CSV {csv_path.name}")
            csv_content = csv_path.read_text("utf-8-sig")
    
    return csv_content


def load_secure_csv(filename: str, password: str) -> List[Dict[str, str]]:
    """Load and decrypt a CSV file into a list of dictionaries."""
    csv_content = _load_secure_csv_content(filename, password)
    if csv_content is None:
        enc_name = f"{Path(filename).stem}.enc"
        raise FileNotFoundError(f"Neither {enc_name} nor {filename} found in id_mapping.")

    # The web GUI's CSV parser manually trims whitespace and quotes.
    # We replicate that behavior here to ensure compatibility with the data files.
    reader = csv.DictReader(StringIO(csv_content))

    # Clean and normalize fieldnames (headers) to match internal application IDs
    if reader.fieldnames:
        # Apply header normalization to all loaded CSVs
        reader.fieldnames = [_normalize_header(name) for name in reader.fieldnames]

    cleaned_data: List[Dict[str, str]] = []
    for row in reader:
        # Clean values for each row to match JS behavior: v.trim().replace(/"/g, '')
        cleaned_row: Dict[str, str] = {
            key: value.strip().replace('"', '') for key, value in row.items() if key is not None
        }
        cleaned_data.append(cleaned_row)

    return cleaned_data


def load_pdf_qualtrics_mapping(password: str) -> Tuple[Dict[str, str], Dict[str, str]]:
    """Load field mappings from ``qualtrics-mapping.json``.

    The JSON file maps internal field names to the identifiers used in
    Qualtrics and the PDF forms. This function converts that structure into
    two lookup dictionaries:

    - ``mapping``: normalized PDF/QID field name -> internal field name
    - ``reverse_mapping``: internal field name -> original PDF/QID field name

    The ``password`` argument is accepted for backwards compatibility but is
    unused because the JSON file is not encrypted.
    """

    json_path = ASSETS_DIR / "qualtrics-mapping.json"
    try:
        mapping_data = json.loads(json_path.read_text("utf-8"))
    except Exception as exc:
        log.warning(f"qualtrics-mapping.json not found or unreadable: {exc}")
        return {}, {}

    mapping: Dict[str, str] = {}
    reverse_mapping: Dict[str, str] = {}

    for internal_name, pdf_field in mapping_data.items():
        if not pdf_field:
            continue

        base_internal = _strip_tgmd_trial_suffix(str(internal_name))
        normalized_pdf = _normalize_lookup_key(str(pdf_field))
        mapping[normalized_pdf] = base_internal

        normalized_internal = _normalize_lookup_key(base_internal)
        mapping.setdefault(normalized_internal, base_internal)

        # TGMD tasks have optional trial suffixes. Map both trial variants and
        # the base task name to the same internal ID for easier lookup.
        if base_internal.startswith("TGMD_"):
            base_pdf = _strip_tgmd_trial_suffix(str(pdf_field))
            for variant in (base_pdf, f"{base_pdf}_t1", f"{base_pdf}_t2"):
                mapping[_normalize_lookup_key(variant)] = base_internal

        # Support legacy TEC PDFs that use G/B for girls/boys instead of F/M.
        # When the internal name is TEC_F_* or TEC_M_*, also map TEC_G_* or
        # TEC_B_* respectively so these fields resolve correctly.
        if base_internal.startswith("TEC_F_"):
            alt_name = base_internal.replace("TEC_F_", "TEC_G_", 1)
            mapping[_normalize_lookup_key(alt_name)] = base_internal
        elif base_internal.startswith("TEC_M_"):
            alt_name = base_internal.replace("TEC_M_", "TEC_B_", 1)
            mapping[_normalize_lookup_key(alt_name)] = base_internal

        reverse_mapping.setdefault(base_internal, str(pdf_field))

    log.info(
        "Loaded %d field mappings from qualtrics-mapping.json", len(mapping_data)
    )
    return mapping, reverse_mapping
