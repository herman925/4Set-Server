"""
Simple launcher script for the Qualtrics Survey Data Extractor application
"""
import os
import sys
import subprocess

def check_dependencies():
    """Check that Python dependencies are installed"""
    try:
        import eel
        print("✅ Eel is installed")
        return True
    except ImportError:
        print("⚠️ Eel is not installed")
        try:
            print("Installing Eel...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", "eel"])
            print("✅ Eel installed successfully")
            return True
        except Exception as e:
            print(f"❌ Failed to install Eel: {e}")
            return False

def main():
    """Run the application"""
    if not check_dependencies():
        print("Please install dependencies by running: pip install eel")
        input("Press Enter to exit...")
        return
    
    # Run the main app
    try:
        print("Starting application...")
        app_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.py")
        subprocess.call([sys.executable, app_path])
    except Exception as e:
        print(f"Error running application: {e}")
        input("Press Enter to exit...")

if __name__ == "__main__":
    main()
