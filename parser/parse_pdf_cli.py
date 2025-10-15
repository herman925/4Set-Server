#!/usr/bin/env python3
"""CLI wrapper for PDF parsing - called by PowerShell processor agent."""

import sys
import json
import logging
from pathlib import Path
from datetime import datetime

# Add parent directory to path to import pdf_tools
sys.path.insert(0, str(Path(__file__).parent))

try:
    from pdf_tools import parse_pdf_to_csv
except ImportError as e:
    print(f"ERROR: Could not import pdf_tools: {e}", file=sys.stderr)
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
log = logging.getLogger(__name__)


def main():
    """Parse PDF and write JSON output."""
    if len(sys.argv) < 3:
        print("Usage: parse_pdf_cli.py <input_pdf> <output_json>", file=sys.stderr)
        sys.exit(1)
    
    input_pdf = Path(sys.argv[1])
    output_json = Path(sys.argv[2])
    
    if not input_pdf.exists():
        print(f"ERROR: PDF file not found: {input_pdf}", file=sys.stderr)
        sys.exit(1)
    
    try:
        log.info(f"Parsing PDF: {input_pdf}")
        
        # NOTE: pdfmapping.json is NOT USED in practice because:
        # 1. PDF form fields use display labels ("Student ID") or friendly names ("MPT_Com")
        # 2. They do NOT use QID identifiers ("QID125287935_TEXT")
        # 3. The HEADER_MAPPING fallback in pdf_tools.py handles the actual field name normalization
        # 4. This mapping file is kept for compatibility but has zero matches in real PDFs
        
        # pdfmapping.json is theoretically for QID -> friendly name mapping
        # File format: {"student-id": "QID125287935_TEXT", ...}
        # Reversed would be: {"QID125287935_TEXT": "student-id", ...}
        # But PDF fields are named "Student ID", "School ID", etc. - not QIDs!
        
        mapping_file = Path(__file__).parent.parent / "assets" / "pdfmapping.json"
        
        if mapping_file.exists():
            with open(mapping_file, 'r', encoding='utf-8') as f:
                friendly_to_pdf = json.load(f)
            
            # Reverse the mapping: PDF field name -> friendly name
            pdf_to_friendly = {v: k for k, v in friendly_to_pdf.items()}
            log.info(f"Loaded {len(pdf_to_friendly)} field mappings (NOTE: typically 0 matches - HEADER_MAPPING is used instead)")
        else:
            log.warning(f"Mapping file not found: {mapping_file} (Not critical - HEADER_MAPPING handles actual field names)")
            pdf_to_friendly = {}
        
        # Parse PDF with mapping (will fall back to HEADER_MAPPING for actual field names)
        data = parse_pdf_to_csv(input_pdf, pdf_to_friendly)
        
        log.info(f"Extracted {len(data)} fields from PDF")
        
        # Create output structure
        result = {
            "timestamp": datetime.now().isoformat(),
            "data": data
        }
        
        # Write JSON output
        with open(output_json, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        
        log.info(f"Successfully wrote JSON to: {output_json}")
        print(f"SUCCESS: {output_json}")
        sys.exit(0)
        
    except Exception as e:
        log.error(f"Failed to parse PDF: {e}", exc_info=True)
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
