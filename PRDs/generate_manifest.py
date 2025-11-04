#!/usr/bin/env python3
"""
PRD Manifest Generator

This script scans the PRDs directory and generates a manifest.json file
that lists all markdown and JSON files with metadata for dynamic loading.

Usage:
    python3 generate_manifest.py

The manifest is automatically loaded by index.html to display all PRD documents.
Run this script whenever you add, remove, or rename PRD files.
"""

import os
import json
import sys
from pathlib import Path

# Get the directory where this script is located
SCRIPT_DIR = Path(__file__).parent.absolute()
PRD_DIR = SCRIPT_DIR

# Category mapping based on filename patterns
def categorize_file(filename):
    """Categorize files based on naming patterns"""
    if filename in ["overview_prd.md", "data-pipeline.md", "data_security_prd.md", "calculation_bible.md"]:
        return "core"
    elif "processor_agent" in filename:
        return "processor"
    elif filename in ["checking_system_prd.md", "checking_system_pipeline_prd.md", "assessment_uploader_prd.md", 
                      "upload_monitoring_prd.md", "pdfpipeline_prd.md", "termination-rules.md", 
                      "task_completion_calculation_logic_prd.md"]:
        return "features"
    elif filename in ["jotform_qualtrics_integration_prd.md", "qualtrics_implementation_plan.md", 
                      "survey_structure.md", "qualtrics_schema_example.json"]:
        return "integration"
    elif "user_guide" in filename or filename == "guideline_prd.md":
        return "guides"
    else:
        return "other"

def get_title_from_filename(filename):
    """Generate a human-readable title from filename"""
    # Remove file extension
    name = filename.replace('.md', '').replace('.json', '')
    
    # Replace underscores and hyphens with spaces
    name = name.replace('_', ' ').replace('-', ' ')
    
    # Capitalize words
    words = name.split()
    title = ' '.join(word.capitalize() for word in words)
    
    return title

def get_description(filename, category):
    """Generate description based on filename and category"""
    descriptions = {
        "overview_prd.md": "Complete system architecture, goals, user journey, and functional requirements for the 4Set platform",
        "data-pipeline.md": "End-to-end data flow architecture from PDF ingestion to JotForm submission",
        "data_security_prd.md": "AES-256-GCM encryption, credential management, and security protocols",
        "calculation_bible.md": "Complete calculation and validation reference for assessment scoring and termination logic",
        "processor_agent_prd.md": "Detailed requirements and specifications for the processor agent",
        "processor_agent_runbook_prd.md": "Step-by-step operational procedures for agent deployment and maintenance",
        "processor_agent_debugmsg_prd.md": "Standardized debug message formats and logging conventions",
        "checking_system_prd.md": "Quality assurance validation rules and checking system architecture",
        "checking_system_pipeline_prd.md": "Pipeline architecture for validation and quality checks",
        "assessment_uploader_prd.md": "Web-based PDF upload interface specifications",
        "upload_monitoring_prd.md": "Upload failure detection and monitoring system",
        "pdfpipeline_prd.md": "PDF extraction and processing pipeline specifications",
        "termination-rules.md": "Assessment termination logic and conditions",
        "task_completion_calculation_logic_prd.md": "Calculation logic for task completion tracking",
        "jotform_qualtrics_integration_prd.md": "Complete integration specifications for JotForm and Qualtrics systems",
        "qualtrics_implementation_plan.md": "Detailed implementation plan for Qualtrics integration",
        "survey_structure.md": "Survey data structure and field definitions",
        "qualtrics_schema_example.json": "Example JSON schema for Qualtrics survey data",
        "guideline_prd.md": "Design patterns and components for the user guide system",
        "checking_system_user_guide_prd.md": "User guide specifications for the checking system",
        "assessment_uploader_user_guide_prd.md": "User guide specifications for the assessment uploader",
        "qualtrics_tgmd_user_guide_prd.md": "User guide for Qualtrics TGMD assessment integration",
        "data_conflicts_user_guide_prd.md": "User guide for handling data conflicts and overwrites",
    }
    return descriptions.get(filename, f"Documentation for {get_title_from_filename(filename)}")

def get_icon(filename, category):
    """Get emoji icon based on file content or category"""
    icons = {
        "overview_prd.md": "📋",
        "data-pipeline.md": "🔄",
        "data_security_prd.md": "🔒",
        "calculation_bible.md": "📐",
        "processor_agent_prd.md": "⚙️",
        "processor_agent_runbook_prd.md": "📚",
        "processor_agent_debugmsg_prd.md": "🐛",
        "checking_system_prd.md": "✅",
        "checking_system_pipeline_prd.md": "🔍",
        "assessment_uploader_prd.md": "📤",
        "upload_monitoring_prd.md": "📊",
        "pdfpipeline_prd.md": "📄",
        "termination-rules.md": "🛑",
        "task_completion_calculation_logic_prd.md": "🎯",
        "jotform_qualtrics_integration_prd.md": "🔗",
        "qualtrics_implementation_plan.md": "📝",
        "survey_structure.md": "📋",
        "qualtrics_schema_example.json": "💾",
        "guideline_prd.md": "🎨",
        "checking_system_user_guide_prd.md": "📖",
        "assessment_uploader_user_guide_prd.md": "📚",
        "qualtrics_tgmd_user_guide_prd.md": "🏃",
        "data_conflicts_user_guide_prd.md": "⚠️",
    }
    return icons.get(filename, "📄")

def generate_manifest():
    """Generate the PRD manifest file"""
    # Scan PRD directory for markdown and json files
    files = []
    excluded_files = {'manifest.json', 'generate_manifest.py', 'index.html', 'index_old.html', 'README.md'}
    
    for filename in os.listdir(PRD_DIR):
        if filename.endswith(('.md', '.json')) and filename not in excluded_files:
            category = categorize_file(filename)
            files.append({
                "filename": filename,
                "title": get_title_from_filename(filename),
                "description": get_description(filename, category),
                "category": category,
                "icon": get_icon(filename, category)
            })

    # Sort files by category and then by title
    category_order = ["core", "processor", "features", "integration", "guides", "other"]
    files.sort(key=lambda x: (category_order.index(x["category"]), x["title"]))

    # Create manifest
    manifest = {
        "generated": "auto",
        "version": "1.0",
        "categories": {
            "core": {
                "name": "Core System Documents",
                "icon": "layers",
                "description": "Foundational system architecture and core specifications"
            },
            "processor": {
                "name": "Processor Agent",
                "icon": "cpu",
                "description": "Processor agent specifications and operational procedures"
            },
            "features": {
                "name": "Feature Specifications",
                "icon": "package",
                "description": "Individual feature requirements and implementations"
            },
            "integration": {
                "name": "Integration & External Systems",
                "icon": "link",
                "description": "External system integrations and data exchange"
            },
            "guides": {
                "name": "User Guide Specifications",
                "icon": "book-open",
                "description": "User guide design patterns and documentation"
            }
        },
        "documents": files
    }

    # Write manifest to file
    output_path = PRD_DIR / "manifest.json"
    with open(output_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f"✓ Generated manifest with {len(files)} documents")
    print(f"✓ Manifest saved to: {output_path}")
    
    # List categories and document counts
    category_counts = {}
    for doc in files:
        cat = doc['category']
        category_counts[cat] = category_counts.get(cat, 0) + 1
    
    print("\nDocument breakdown by category:")
    for cat_key in category_order:
        if cat_key in category_counts:
            cat_name = manifest['categories'][cat_key]['name']
            print(f"  • {cat_name}: {category_counts[cat_key]} documents")

if __name__ == '__main__':
    try:
        generate_manifest()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
