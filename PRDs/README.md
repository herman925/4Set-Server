# PRD Tree - Dynamic Document Index

This directory contains Product Requirements Documents (PRDs) for the 4Set System. The index page (`index.html`) automatically discovers and displays all markdown and JSON files in this directory.

## How It Works

The PRD Tree uses a dynamic loading system:

1. **`manifest.json`** - Contains metadata for all PRD documents including titles, descriptions, categories, and icons
2. **`index.html`** - Dynamically loads and displays documents from the manifest
3. **`generate_manifest.py`** - Python script that scans the directory and generates the manifest

## Adding New PRDs

When you add, remove, or rename PRD files:

1. Add your `.md` or `.json` file to the `/PRDs` directory
2. Run the manifest generator:
   ```bash
   cd PRDs
   python3 generate_manifest.py
   ```
3. Commit both your new file and the updated `manifest.json`

The index page will automatically display your new document!

## Customizing Document Metadata

To customize how a document appears in the index, edit `generate_manifest.py`:

- **Category**: Update the `categorize_file()` function to assign the correct category
- **Title**: Modify `get_title_from_filename()` or add to the descriptions dict
- **Description**: Add an entry in the `get_description()` function's descriptions dict
- **Icon**: Add an emoji in the `get_icon()` function's icons dict

After making changes, run `python3 generate_manifest.py` to regenerate the manifest.

## Categories

Documents are organized into these categories:

- **Core System Documents**: Foundational architecture and specifications
- **Processor Agent**: Agent specifications and operational procedures
- **Feature Specifications**: Individual feature requirements
- **Integration & External Systems**: External integrations and data exchange
- **User Guide Specifications**: User guide design and documentation

## Manual Manifest Generation

If you prefer to maintain the manifest manually, you can edit `manifest.json` directly. The structure is:

```json
{
  "generated": "auto",
  "version": "1.0",
  "categories": { /* category definitions */ },
  "documents": [
    {
      "filename": "example.md",
      "title": "Example Document",
      "description": "Description of the document",
      "category": "core",
      "icon": "📄"
    }
  ]
}
```

## Search Functionality

The index page includes a search box that filters documents by:
- Document title
- Description text  
- Filename

This makes it easy to find specific documents quickly.
