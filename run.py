"""
Bootstrapper Script

This script initializes the environment for the Replica Cost Estimator.
It automatically creates a Python virtual environment (if missing),
installs required dependencies from requirements.txt, and starts the FastAPI backend server using Uvicorn.
"""
import os
import sys
import subprocess

def main():
    print("====================================================")
    print(" Replica Cost Estimation System - Bootstrapper")
    print("====================================================")
    
    # 1. Determine paths
    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    venv_dir = os.path.join(workspace_dir, "venv")
    
    # Choose python and pip executables
    if os.name == "nt":
        python_bin = os.path.join(venv_dir, "Scripts", "python.exe")
        pip_bin = os.path.join(venv_dir, "Scripts", "pip.exe")
        uvicorn_bin = os.path.join(venv_dir, "Scripts", "uvicorn.exe")
    else:
        python_bin = os.path.join(venv_dir, "bin", "python")
        pip_bin = os.path.join(venv_dir, "bin", "pip")
        uvicorn_bin = os.path.join(venv_dir, "bin", "uvicorn")

    # 2. Check if virtual environment exists, if not create it
    if not os.path.exists(venv_dir):
        print("Virtual environment not found. Creating it...")
        try:
            subprocess.run([sys.executable, "-m", "venv", "venv"], check=True)
            print("Virtual environment created.")
        except Exception as e:
            print(f"Error creating virtual environment: {e}")
            sys.exit(1)

    # 3. Check and install dependencies
    print("Verifying python dependencies...")
    try:
        # Check if we can run pip
        subprocess.run([pip_bin, "install", "-r", "requirements.txt"], check=True)
        print("Dependencies verified.")
    except Exception as e:
        print("Warning: pip install failed. Attempting to install fallback dependencies without pins...")
        try:
            # Fallback to installing latest packages without pins to see if wheels are available
            subprocess.run([pip_bin, "install", "fastapi", "uvicorn", "trimesh", "numpy", "sqlalchemy", "python-multipart"], check=True)
            print("Dependencies installed successfully via fallback.")
        except Exception as e2:
            print(f"Critical Error: Failed to install dependencies: {e2}")
            sys.exit(1)

    # 4. Start Uvicorn Server
    print("Starting FastAPI Backend Server...")
    print("Open http://localhost:8000 in your browser to access the Estimator.")
    print("Access API Docs at http://localhost:8000/docs")
    print("Press Ctrl+C to terminate.")
    print("----------------------------------------------------")
    
    try:
        # Run uvicorn inside virtual env
        subprocess.run([uvicorn_bin, "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"], check=True)
    except KeyboardInterrupt:
        print("\nServer stopped by user.")
    except Exception as e:
        print(f"Error launching server: {e}")

if __name__ == "__main__":
    main()
