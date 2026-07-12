import os
import time
import secrets
import shutil
import hashlib
from datetime import datetime, timedelta
from collections import defaultdict
from fastapi import FastAPI, Depends, UploadFile, File, Form, HTTPException, Header, status, Request
from fastapi.security import APIKeyHeader, APIKeyQuery, HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Dict, Optional
from sqlalchemy.orm import Session

from backend.database import get_db, seed_database, Material, Machine, GlobalSetting, TimeBracket, ApiKey, User, UserSession, StlUpload, UserSetting, UserMaterial, UserMachine
from backend.estimator import parse_stl_volume, calculate_public_estimate, calculate_admin_cost

# In-memory dictionary to track upload timestamps: IP -> List of timestamps (datetime objects)
upload_tracker = defaultdict(list)

# Make sure uploads directory exists
os.makedirs("uploads", exist_ok=True)

# Password Hashing Helpers using standard hashlib (no external compilation dependencies)
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    return salt.hex() + ":" + key.hex()
    
def verify_password(password: str, hashed: str) -> bool:
    try:
        salt_hex, key_hex = hashed.split(":")
        salt = bytes.fromhex(salt_hex)
        key = bytes.fromhex(key_hex)
        new_key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
        return secrets.compare_digest(key, new_key)
    except Exception:
        return False

# Security setups for API keys
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
api_key_query = APIKeyQuery(name="api_key", auto_error=False)

def verify_api_key_optional(
    header_key: Optional[str] = Depends(api_key_header),
    query_key: Optional[str] = Depends(api_key_query),
    db: Session = Depends(get_db)
) -> Optional[ApiKey]:
    key = header_key or query_key
    if not key:
        return None
    api_key = db.query(ApiKey).filter(ApiKey.key == key).first()
    if not api_key or not api_key.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or inactive API key."
        )
    # Increment calls count
    api_key.calls_count += 1
    db.commit()
    return api_key

def verify_api_key(
    header_key: Optional[str] = Depends(api_key_header),
    query_key: Optional[str] = Depends(api_key_query),
    db: Session = Depends(get_db)
) -> ApiKey:
    key = header_key or query_key
    if not key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key is missing. Please provide X-API-Key header or api_key query parameter."
        )
    api_key = db.query(ApiKey).filter(ApiKey.key == key).first()
    if not api_key or not api_key.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or inactive API key."
        )
    # Increment calls count
    api_key.calls_count += 1
    db.commit()
    return api_key

# HTTP Bearer Auth for User Sessions
security_bearer = HTTPBearer(auto_error=False)

def get_current_user(
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    db: Session = Depends(get_db)
) -> User:
    if not auth or not auth.credentials:
        raise HTTPException(status_code=401, detail="Not authenticated. Please log in.")
    session = db.query(UserSession).filter(UserSession.token == auth.credentials).first()
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid. Please log in again.")
    user = db.query(User).filter(User.id == session.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")
    return user

def get_current_user_optional(
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    db: Session = Depends(get_db)
) -> Optional[User]:
    if not auth or not auth.credentials:
        return None
    session = db.query(UserSession).filter(UserSession.token == auth.credentials).first()
    if not session:
        return None
    return db.query(User).filter(User.id == session.user_id).first()

# Admin Authorization & Session Management
admin_sessions = {}
admin_token_header = APIKeyHeader(name="X-Admin-Token", auto_error=False)

class AdminAuthRequest(BaseModel):
    password: str

def verify_admin_token(
    token_header: Optional[str] = Depends(admin_token_header),
    admin_token: Optional[str] = None
):
    token = token_header or admin_token
    if not token or token not in admin_sessions:
        raise HTTPException(status_code=401, detail="Unauthorized Super Admin access. Please unlock.")
    session_time = admin_sessions[token]
    if datetime.now() - session_time > timedelta(hours=2):
        if token in admin_sessions:
            del admin_sessions[token]
        raise HTTPException(status_code=401, detail="Session expired. Please unlock again.")
    admin_sessions[token] = datetime.now()
    return token

# Initialize app
app = FastAPI(
    title="Replica Cost Estimation API",
    description="API service to calculate 3D printing cost estimates for public and admin operations.",
    version="1.0.0"
)

import traceback
# datetime imported at top

@app.middleware("http")
async def catch_exceptions_middleware(request, call_next):
    try:
        return await call_next(request)
    except Exception as e:
        with open("backend_error.log", "a") as f:
            f.write(f"\n--- Exception ---\n")
            traceback.print_exc(file=f)
            f.flush()
        raise e

# Seed database tables and initial records
seed_database()

# CORS configuration for integration with other websites
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for simple integration
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Admin Authorization passcode
ADMIN_PASSCODE = os.environ.get("ADMIN_PASSCODE", "Hey1994Ba25")

# Pydantic Schemas for requests/responses
class AdminEstimateRequest(BaseModel):
    weight_g: float
    print_time_mins: float
    material_id: str
    machine_id: str
    labor_hours: float = 0.0

class SettingsUpdateRequest(BaseModel):
    passcode: Optional[str] = None
    global_settings: Dict[str, float]
    materials: List[Dict]
    machines: List[Dict]

# API Endpoints

@app.post("/api/estimate/scan")
async def scan_stl_file(file: UploadFile = File(...)):
    if not file.filename.lower().endswith('.stl'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only STL files are supported. Please upload an STL file."
        )
    try:
        contents = await file.read()
        mesh_analysis = parse_stl_volume(contents)
        if mesh_analysis["error"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Could not parse STL file: {mesh_analysis['error']}"
            )
        return {
            "success": True,
            "filename": file.filename,
            "volume_cm3": round(mesh_analysis["volume_cm3"], 3),
            "surface_area_cm2": round(mesh_analysis["surface_area_cm2"], 2),
            "is_watertight": mesh_analysis["is_watertight"]
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error scanning file: {str(e)}"
        )

@app.post("/api/estimate/public")
async def public_estimate(
    request: Request,
    material_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    api_key: Optional[ApiKey] = Depends(verify_api_key_optional)
):
    """
    Public Estimate Endpoint:
    Accepts an STL file and material type, returns price range and metrics.
    """
    # Rate Limiting
    limit_count_setting = db.query(GlobalSetting).filter(GlobalSetting.key == "upload_limit_count").first()
    cooldown_setting = db.query(GlobalSetting).filter(GlobalSetting.key == "upload_cooldown_seconds").first()
    
    limit_count = int(limit_count_setting.value) if limit_count_setting else 5
    cooldown_secs = int(cooldown_setting.value) if cooldown_setting else 60
    
    now = datetime.now()
    client_ip = request.client.host if request.client else "unknown"
    
    # Filter out timestamps older than cooldown_secs
    cooldown_delta = timedelta(seconds=cooldown_secs)
    upload_tracker[client_ip] = [t for t in upload_tracker[client_ip] if now - t < cooldown_delta]
    
    if len(upload_tracker[client_ip]) >= limit_count:
        oldest_time = upload_tracker[client_ip][0]
        wait_time = int(cooldown_secs - (now - oldest_time).total_seconds())
        wait_time = max(1, wait_time)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Upload limit reached. Please wait {wait_time} seconds before uploading again."
        )

    if not file.filename.lower().endswith('.stl'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only STL files are supported for instant estimation. Please upload an STL file."
        )
        
    try:
        contents = await file.read()
        mesh_analysis = parse_stl_volume(contents)
        
        if mesh_analysis["error"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Could not parse STL file: {mesh_analysis['error']}"
            )
            
        user_id = api_key.user_id if api_key else None
        
        estimate = calculate_public_estimate(
            db=db, 
            volume_cm3=mesh_analysis["volume_cm3"], 
            material_id=material_id,
            user_id=user_id
        )
        
        # Save file to uploads/ folder with timestamp prefix
        timestamp = int(time.time())
        stored_filename = f"{timestamp}_{file.filename}"
        stored_path = os.path.join("uploads", stored_filename)
        
        with open(stored_path, "wb") as buffer:
            buffer.write(contents)
            
        # Log upload in db
        new_upload = StlUpload(
            original_filename=file.filename,
            stored_filename=stored_filename,
            volume_cm3=mesh_analysis["volume_cm3"],
            estimated_weight_g=estimate["estimated_weight_g"],
            price_range=f"{estimate['price_min']} - {estimate['price_max']} TND",
            api_key_used=api_key.key if api_key else None
        )
        db.add(new_upload)
        db.commit()
        
        # Record successful upload in the tracker
        upload_tracker[client_ip].append(now)
        
        return {
            "success": True,
            "filename": file.filename,
            "volume_cm3": round(mesh_analysis["volume_cm3"], 3),
            "surface_area_cm2": round(mesh_analysis["surface_area_cm2"], 2),
            "is_watertight": mesh_analysis["is_watertight"],
            "estimated_weight_g": estimate["estimated_weight_g"],
            "estimated_time_mins": estimate["estimated_time_mins"],
            "machine": estimate["machine"],
            "price_min": estimate["price_min"],
            "price_max": estimate["price_max"]
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while processing the file: {str(e)}"
        )

@app.post("/api/estimate/admin")
def admin_estimate(
    request: AdminEstimateRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
    api_key: Optional[ApiKey] = Depends(verify_api_key_optional)
):
    """
    Admin Precise Estimate Endpoint (Private):
    Accepts specific sliced statistics and returns a detailed cost breakdown.
    Requires user session or valid developer API Key.
    """
    user_id = None
    if current_user:
        user_id = current_user.id
    elif api_key:
        user_id = api_key.user_id
        
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required to run precise calculator.")
        
    try:
        breakdown = calculate_admin_cost(
            db=db,
            weight_g=request.weight_g,
            print_time_mins=request.print_time_mins,
            material_id=request.material_id,
            machine_id=request.machine_id,
            labor_hours=request.labor_hours,
            user_id=user_id
        )
        return {
            "success": True,
            "breakdown": breakdown
        }
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@app.get("/api/settings")
def get_settings(db: Session = Depends(get_db)):
    """
    Retrieves all settings, materials, machines, and brackets.
    """
    # Fetch global settings as a dictionary
    settings = db.query(GlobalSetting).all()
    settings_dict = {s.key: s.value for s in settings}
    
    materials = db.query(Material).all()
    machines = db.query(Machine).all()
    brackets = db.query(TimeBracket).all()
    
    return {
        "global_settings": settings_dict,
        "materials": [
            {
                "id": m.id,
                "name": m.name,
                "density_g_cm3": m.density_g_cm3,
                "price_per_kg": m.price_per_kg
            } for m in materials
        ],
        "machines": [
            {
                "id": m.id,
                "name": m.name,
                "power_watts": m.power_watts,
                "flat_premium": m.flat_premium
            } for m in machines
        ],
        "time_brackets": [
            {
                "id": b.id,
                "machine_id": b.machine_id,
                "max_weight_g": b.max_weight_g,
                "base_time_mins": b.base_time_mins,
                "time_per_g_mins": b.time_per_g_mins
            } for b in brackets
        ]
    }

@app.put("/api/settings")
def update_settings(
    request: SettingsUpdateRequest,
    db: Session = Depends(get_db),
    admin_token: str = Depends(verify_admin_token)
):
    """
    Updates global settings, materials, and machines. Secured by Super Admin session token.
    """
    try:
        # Update global settings
        for key, val in request.global_settings.items():
            setting = db.query(GlobalSetting).filter(GlobalSetting.key == key).first()
            if setting:
                setting.value = val
            else:
                db.add(GlobalSetting(key=key, value=val))
                
        # Update materials
        for mat_data in request.materials:
            mat = db.query(Material).filter(Material.id == mat_data["id"]).first()
            if mat:
                mat.name = mat_data["name"]
                mat.density_g_cm3 = mat_data["density_g_cm3"]
                mat.price_per_kg = mat_data["price_per_kg"]
            else:
                db.add(Material(
                    id=mat_data["id"], 
                    name=mat_data["name"], 
                    density_g_cm3=mat_data["density_g_cm3"], 
                    price_per_kg=mat_data["price_per_kg"]
                ))
                
        # Update machines
        for mach_data in request.machines:
            mach = db.query(Machine).filter(Machine.id == mach_data["id"]).first()
            if mach:
                mach.name = mach_data["name"]
                mach.power_watts = mach_data["power_watts"]
                mach.flat_premium = mach_data["flat_premium"]
            else:
                db.add(Machine(
                    id=mach_data["id"], 
                    name=mach_data["name"], 
                    power_watts=mach_data["power_watts"], 
                    flat_premium=mach_data["flat_premium"]
                ))
                
        db.commit()
        return {"success": True, "message": "Global settings updated successfully."}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update settings: {str(e)}"
        )
# Resend API configuration
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "re_PBbRoq9j_4JZLgZQ1RmtYUNRZT5S5GmGA")

def send_resend_email(to_email: str, subject: str, html_content: str) -> bool:
    """
    Sends an email using Resend REST API.
    """
    url = "https://api.resend.com/emails"
    headers = {
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "from": "Replica Estimator <onboarding@resend.dev>",
        "to": [to_email],
        "subject": subject,
        "html": html_content
    }
    try:
        import requests
        response = requests.post(url, json=payload, headers=headers)
        if response.status_code in [200, 201]:
            print(f"[Resend Email] Successfully sent email to {to_email}")
            return True
        else:
            print(f"[Resend Email Error] API responded with status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print(f"[Resend Email Error] Failed to connect to Resend API: {e}")
        return False

# Developer Authentication Schema
class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    
class LoginRequest(BaseModel):
    identity: str  # username or email
    password: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

# Developer API Keys Schema
class CreateDeveloperKeyRequest(BaseModel):
    owner: str

# API Key Management (Passcode-Protected Admin schemas)
class CreateKeyRequest(BaseModel):
    passcode: Optional[str] = None
    owner: str

class ToggleKeyRequest(BaseModel):
    passcode: Optional[str] = None

# --- Developer Authentication Endpoints ---

@app.post("/api/auth/register")
def register_developer(req: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    username_clean = req.username.strip()
    email_clean = req.email.strip().lower()
    
    if not username_clean:
        raise HTTPException(status_code=400, detail="Username cannot be empty.")
    if not email_clean:
        raise HTTPException(status_code=400, detail="Email cannot be empty.")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
        
    existing_user = db.query(User).filter(User.username == username_clean).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username is already taken.")
        
    existing_email = db.query(User).filter(User.email == email_clean).first()
    if existing_email:
        raise HTTPException(status_code=400, detail="Email address is already registered.")
        
    # Generate activation token
    activation_token = secrets.token_hex(20)
    hashed = hash_password(req.password)
    
    new_user = User(
        username=username_clean,
        email=email_clean,
        hashed_password=hashed,
        is_active=False,
        activation_token=activation_token
    )
    db.add(new_user)
    db.commit()
    
    # Seed default user settings
    db.add(UserSetting(user_id=new_user.id, key="electricity_rate", value=0.0))
    db.add(UserSetting(user_id=new_user.id, key="wear_tear_percent", value=10.0))
    db.add(UserSetting(user_id=new_user.id, key="margin_percent", value=20.0))
    db.add(UserSetting(user_id=new_user.id, key="labor_rate_hourly", value=15.0))
    db.add(UserSetting(user_id=new_user.id, key="infill_ratio", value=20.0))
    db.add(UserSetting(user_id=new_user.id, key="support_buffer_percent", value=10.0))
    
    # Seed default user materials
    db.add(UserMaterial(user_id=new_user.id, material_id="pla", name="PLA", density_g_cm3=1.24, price_per_kg=60.0))
    db.add(UserMaterial(user_id=new_user.id, material_id="petg", name="PETG", density_g_cm3=1.27, price_per_kg=65.0))
    db.add(UserMaterial(user_id=new_user.id, material_id="abs", name="ABS", density_g_cm3=1.04, price_per_kg=70.0))
    db.add(UserMaterial(user_id=new_user.id, material_id="asa", name="ASA", density_g_cm3=1.07, price_per_kg=75.0))
    db.add(UserMaterial(user_id=new_user.id, material_id="tpu", name="TPU", density_g_cm3=1.21, price_per_kg=85.0))
    
    # Seed default user machines
    db.add(UserMachine(user_id=new_user.id, machine_id="a1_combo", name="A1 Combo", power_watts=150.0, flat_premium=0.0))
    db.add(UserMachine(user_id=new_user.id, machine_id="h2s", name="H2S", power_watts=350.0, flat_premium=15.0))
    
    db.commit()
    
    # Send verification email
    base_url = str(request.base_url).rstrip("/")
    activation_link = f"{base_url}/api/auth/activate?token={activation_token}"
    
    # Log to terminal for easy copy-paste
    print(f"\n[SIGNUP ACTIVATION LINK] User: {username_clean} | Link: {activation_link}\n")
    
    email_html = f"""
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; color: #1a202c;">
        <h2 style="color: #4f46e5; margin-bottom: 20px;">Welcome to Replica Cost Estimator!</h2>
        <p>Thank you for registering. Please click the button below to verify your email and activate your account:</p>
        <p style="margin: 30px 0; text-align: center;">
            <a href="{activation_link}" style="display: inline-block; background: #4f46e5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Verify & Activate Account</a>
        </p>
        <p style="font-size: 0.85rem; color: #718096;">If the button doesn't work, copy and paste this URL into your browser:</p>
        <p style="font-size: 0.85rem; color: #4f46e5; word-break: break-all; background: #f7fafc; padding: 10px; border-radius: 6px; font-family: monospace;">{activation_link}</p>
        <br>
        <p style="border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 0.9rem; color: #4a5568;">Regards,<br><strong>Replica Team</strong></p>
    </div>
    """
    
    send_resend_email(email_clean, "Verify Your Email - Replica Estimator", email_html)
    
    return {"success": True, "message": "Account created! Please check your email to verify and activate your account."}

from fastapi.responses import HTMLResponse

@app.get("/api/auth/activate", response_class=HTMLResponse)
def activate_account(token: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.activation_token == token).first()
    if not user:
        return """
        <html>
            <head>
                <title>Activation Failed</title>
                <style>
                    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .card { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.05); padding: 2.5rem; border-radius: 16px; max-width: 450px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                    h1 { color: #f43f5e; margin-bottom: 1rem; }
                    p { color: #94a3b8; line-height: 1.6; margin-bottom: 2rem; }
                    .btn { background: #3b82f6; color: white; padding: 0.8rem 1.5rem; text-decoration: none; border-radius: 8px; font-weight: 600; transition: 0.2s; }
                    .btn:hover { background: #2563eb; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>Activation Link Invalid</h1>
                    <p>The activation link is invalid or has already been used. Please try registering again or contact support.</p>
                    <a href="/" class="btn">Go to Home Page</a>
                </div>
            </body>
        </html>
        """
        
    user.is_active = True
    user.activation_token = None
    db.commit()
    
    return """
    <html>
        <head>
            <title>Activation Successful</title>
            <style>
                body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.05); padding: 2.5rem; border-radius: 16px; max-width: 450px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                h1 { color: #10b981; margin-bottom: 1rem; }
                p { color: #94a3b8; line-height: 1.6; margin-bottom: 2rem; }
                .btn { background: #10b981; color: white; padding: 0.8rem 1.5rem; text-decoration: none; border-radius: 8px; font-weight: 600; transition: 0.2s; }
                .btn:hover { background: #059669; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>Account Activated!</h1>
                <p>Your email address has been successfully verified. You can now log in to the Developer Portal using your credentials.</p>
                <a href="/" class="btn">Go to Login</a>
            </div>
        </body>
    </html>
    """

@app.post("/api/auth/login")
def login_developer(req: LoginRequest, db: Session = Depends(get_db)):
    identity_clean = req.identity.strip()
    user = db.query(User).filter(
        (User.username == identity_clean) | (User.email == identity_clean.lower())
    ).first()
    
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid username/email or password.")
        
    if not user.is_active:
        raise HTTPException(
            status_code=400,
            detail="Please verify your email address to activate your account."
        )
        
    token = f"sess_{secrets.token_hex(24)}"
    session = UserSession(token=token, user_id=user.id)
    db.add(session)
    db.commit()
    return {"success": True, "token": token, "username": user.username}

@app.post("/api/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    email_clean = req.email.strip().lower()
    user = db.query(User).filter(User.email == email_clean).first()
    
    # For security reasons, don't reveal if user exists or not
    if not user:
        return {"success": True, "message": "If that email is registered, we have sent a reset link."}
        
    reset_token = secrets.token_hex(20)
    user.reset_token = reset_token
    user.reset_token_expires = datetime.utcnow() + timedelta(hours=1)
    db.commit()
    
    base_url = str(request.base_url).rstrip("/")
    reset_link = f"{base_url}/reset-password.html?token={reset_token}"
    
    # Log to terminal for easy copy-paste
    print(f"\n[PASSWORD RESET LINK] User: {user.username} | Link: {reset_link}\n")
    
    email_html = f"""
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; color: #1a202c;">
        <h2 style="color: #059669; margin-bottom: 20px;">Password Reset Request</h2>
        <p>We received a request to reset your password. Click the button below to set a new password:</p>
        <p style="margin: 30px 0; text-align: center;">
            <a href="{reset_link}" style="display: inline-block; background: #059669; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
        </p>
        <p style="font-size: 0.85rem; color: #718096;">If the button doesn't work, copy and paste this URL into your browser:</p>
        <p style="font-size: 0.85rem; color: #059669; word-break: break-all; background: #f7fafc; padding: 10px; border-radius: 6px; font-family: monospace;">{reset_link}</p>
        <p style="font-size: 0.8rem; color: #a0aec0; margin-top: 10px;">This reset link is valid for 1 hour.</p>
        <br>
        <p style="border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 0.9rem; color: #4a5568;">Regards,<br><strong>Replica Team</strong></p>
    </div>
    """
    
    send_resend_email(email_clean, "Reset Your Password - Replica Estimator", email_html)
    
    return {"success": True, "message": "If that email is registered, we have sent a reset link."}

@app.post("/api/auth/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        User.reset_token == req.token,
        User.reset_token_expires > datetime.utcnow()
    ).first()
    
    if not user:
        raise HTTPException(
            status_code=400,
            detail="Reset token is invalid or has expired."
        )
        
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
        
    user.hashed_password = hash_password(req.new_password)
    user.reset_token = None
    user.reset_token_expires = None
    db.commit()
    
    return {"success": True, "message": "Password reset successfully. You can now log in."}

@app.post("/api/auth/logout")
def logout_developer(
    auth: HTTPAuthorizationCredentials = Depends(security_bearer),
    db: Session = Depends(get_db)
):
    if auth and auth.credentials:
        session = db.query(UserSession).filter(UserSession.token == auth.credentials).first()
        if session:
            db.delete(session)
            db.commit()
    return {"success": True}

# --- Developer Key Management Endpoints ---

@app.get("/api/developer/keys")
def get_developer_keys(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    keys = db.query(ApiKey).filter(ApiKey.user_id == user.id).all()
    return [{
        "key": k.key,
        "owner": k.owner,
        "is_active": k.is_active,
        "calls_count": k.calls_count,
        "created_at": k.created_at.isoformat()
    } for k in keys]

@app.post("/api/developer/keys")
def create_developer_key(
    req: CreateDeveloperKeyRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    owner_clean = req.owner.strip()
    if not owner_clean:
        raise HTTPException(status_code=400, detail="Description/Owner cannot be empty.")
        
    new_key_str = f"rep_dev_{secrets.token_hex(16)}"
    new_key = ApiKey(key=new_key_str, owner=owner_clean, is_active=True, user_id=user.id)
    db.add(new_key)
    db.commit()
    return {
        "success": True,
        "key": {
            "key": new_key.key,
            "owner": new_key.owner,
            "is_active": new_key.is_active,
            "calls_count": new_key.calls_count,
            "created_at": new_key.created_at.isoformat()
        }
    }

@app.delete("/api/developer/keys/{key}")
def delete_developer_key(
    key: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    api_key = db.query(ApiKey).filter(ApiKey.key == key, ApiKey.user_id == user.id).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found or not owned by you.")
    db.delete(api_key)
    db.commit()
    return {"success": True, "message": "Key deleted successfully."}

# --- Admin Panel Oversight Endpoints (Passcode-Protected) ---

# --- Developer custom settings & uploads endpoints ---

@app.get("/api/developer/settings")
def get_developer_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Fetch user settings
    user_settings = db.query(UserSetting).filter(UserSetting.user_id == current_user.id).all()
    settings_dict = {s.key: s.value for s in user_settings}
    
    # Check if we need to seed settings for legacy users
    required_keys = ["electricity_rate", "wear_tear_percent", "margin_percent", "labor_rate_hourly", "infill_ratio", "support_buffer_percent"]
    seeded_any = False
    for k in required_keys:
        if k not in settings_dict:
            val = 0.0
            if k == "wear_tear_percent" or k == "support_buffer_percent":
                val = 10.0
            elif k == "margin_percent" or k == "infill_ratio":
                val = 20.0
            elif k == "labor_rate_hourly":
                val = 15.0
            new_s = UserSetting(user_id=current_user.id, key=k, value=val)
            db.add(new_s)
            settings_dict[k] = val
            seeded_any = True
            
    # Fetch materials and machines
    materials = db.query(UserMaterial).filter(UserMaterial.user_id == current_user.id).all()
    if not materials:
        db.add(UserMaterial(user_id=current_user.id, material_id="pla", name="PLA", density_g_cm3=1.24, price_per_kg=60.0))
        db.add(UserMaterial(user_id=current_user.id, material_id="petg", name="PETG", density_g_cm3=1.27, price_per_kg=65.0))
        db.add(UserMaterial(user_id=current_user.id, material_id="abs", name="ABS", density_g_cm3=1.04, price_per_kg=70.0))
        db.add(UserMaterial(user_id=current_user.id, material_id="asa", name="ASA", density_g_cm3=1.07, price_per_kg=75.0))
        db.add(UserMaterial(user_id=current_user.id, material_id="tpu", name="TPU", density_g_cm3=1.21, price_per_kg=85.0))
        seeded_any = True
        materials = db.query(UserMaterial).filter(UserMaterial.user_id == current_user.id).all()
        
    machines = db.query(UserMachine).filter(UserMachine.user_id == current_user.id).all()
    if not machines:
        db.add(UserMachine(user_id=current_user.id, machine_id="a1_combo", name="A1 Combo", power_watts=150.0, flat_premium=0.0))
        db.add(UserMachine(user_id=current_user.id, machine_id="h2s", name="H2S", power_watts=350.0, flat_premium=15.0))
        seeded_any = True
        machines = db.query(UserMachine).filter(UserMachine.user_id == current_user.id).all()
        
    if seeded_any:
        db.commit()
        
    return {
        "global_settings": settings_dict,
        "materials": [
            {
                "id": m.material_id,
                "name": m.name,
                "density_g_cm3": m.density_g_cm3,
                "price_per_kg": m.price_per_kg
            } for m in materials
        ],
        "machines": [
            {
                "id": m.machine_id,
                "name": m.name,
                "power_watts": m.power_watts,
                "flat_premium": m.flat_premium
            } for m in machines
        ]
    }

class SaveDeveloperSettingsRequest(BaseModel):
    global_settings: Dict[str, float]
    materials: List[Dict]
    machines: List[Dict]

@app.put("/api/developer/settings")
def save_developer_settings(
    req: SaveDeveloperSettingsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    for key, val in req.global_settings.items():
        setting = db.query(UserSetting).filter(UserSetting.user_id == current_user.id, UserSetting.key == key).first()
        if setting:
            setting.value = val
        else:
            db.add(UserSetting(user_id=current_user.id, key=key, value=val))
            
    for mat in req.materials:
        material = db.query(UserMaterial).filter(UserMaterial.user_id == current_user.id, UserMaterial.material_id == mat["id"].lower()).first()
        if material:
            material.density_g_cm3 = mat["density_g_cm3"]
            material.price_per_kg = mat["price_per_kg"]
            
    for mach in req.machines:
        machine = db.query(UserMachine).filter(UserMachine.user_id == current_user.id, UserMachine.machine_id == mach["id"].lower()).first()
        if machine:
            machine.power_watts = mach["power_watts"]
            machine.flat_premium = mach["flat_premium"]
            
    db.commit()
    return {"success": True}

@app.get("/api/developer/uploads")
def get_developer_uploads(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_keys = db.query(ApiKey).filter(ApiKey.user_id == user.id).all()
    key_strings = [k.key for k in user_keys]
    
    if not key_strings:
        return []
        
    uploads = db.query(StlUpload).filter(StlUpload.api_key_used.in_(key_strings)).order_by(StlUpload.created_at.desc()).all()
    return [
        {
            "id": u.id,
            "original_filename": u.original_filename,
            "volume_cm3": u.volume_cm3,
            "estimated_weight_g": u.estimated_weight_g,
            "price_range": u.price_range,
            "api_key_used": u.api_key_used or "Unknown Key",
            "created_at": u.created_at.isoformat()
        } for u in uploads
    ]

# --- Admin Panel Oversight Endpoints (Passcode-Session Protected) ---

@app.post("/api/admin/auth")
def admin_auth(req: AdminAuthRequest):
    if req.password == "Hey1994Ba25":
        token = secrets.token_hex(24)
        admin_sessions[token] = datetime.now()
        return {"success": True, "token": token}
    raise HTTPException(status_code=401, detail="Invalid admin password.")

@app.get("/api/admin/users")
def get_admin_users(
    db: Session = Depends(get_db),
    admin_token: str = Depends(verify_admin_token)
):
    users = db.query(User).all()
    results = []
    for u in users:
        keys = db.query(ApiKey).filter(ApiKey.user_id == u.id).all()
        keys_count = len(keys)
        total_calls = sum(k.calls_count for k in keys)
        results.append({
            "id": u.id,
            "username": u.username,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "keys_count": keys_count,
            "total_calls": total_calls
        })
    return results

@app.delete("/api/admin/users/{id}")
def delete_admin_user(
    id: int,
    db: Session = Depends(get_db),
    admin_token: str = Depends(verify_admin_token)
):
    user = db.query(User).filter(User.id == id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    db.delete(user)
    db.commit()
    return {"success": True, "message": "User deleted successfully."}

class ResetPasswordRequest(BaseModel):
    new_password: str

@app.post("/api/admin/users/{id}/reset-password")
def reset_admin_user_password(
    id: int,
    req: ResetPasswordRequest,
    db: Session = Depends(get_db),
    admin_token: str = Depends(verify_admin_token)
):
    user = db.query(User).filter(User.id == id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    user.hashed_password = hash_password(req.new_password)
    db.commit()
    return {"success": True, "message": "Password reset successfully."}

@app.get("/api/admin/keys")
def get_api_keys(db: Session = Depends(get_db), admin_token: str = Depends(verify_admin_token)):
    keys = db.query(ApiKey).all()
    results = []
    for k in keys:
        creator = "System Seeded"
        if k.user_id:
            user = db.query(User).filter(User.id == k.user_id).first()
            if user:
                creator = user.username
        results.append({
            "key": k.key,
            "owner": k.owner,
            "is_active": k.is_active,
            "calls_count": k.calls_count,
            "creator": creator,
            "created_at": k.created_at.isoformat()
        })
    return results

class CreateGlobalKeyRequest(BaseModel):
    owner: str

@app.post("/api/admin/keys")
def create_api_key(request: CreateGlobalKeyRequest, db: Session = Depends(get_db), admin_token: str = Depends(verify_admin_token)):
    if not request.owner.strip():
        raise HTTPException(status_code=400, detail="Owner name cannot be empty.")
        
    new_key_str = f"rep_live_{secrets.token_hex(16)}"
    new_key = ApiKey(key=new_key_str, owner=request.owner, is_active=True)
    db.add(new_key)
    db.commit()
    return {
        "success": True,
        "key": {
            "key": new_key.key,
            "owner": new_key.owner,
            "is_active": new_key.is_active,
            "calls_count": new_key.calls_count,
            "creator": "Super Admin",
            "created_at": new_key.created_at.isoformat()
        }
    }

@app.put("/api/admin/keys/{key}/toggle")
def toggle_api_key(key: str, db: Session = Depends(get_db), admin_token: str = Depends(verify_admin_token)):
    api_key = db.query(ApiKey).filter(ApiKey.key == key).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found.")
    api_key.is_active = not api_key.is_active
    db.commit()
    return {"success": True, "is_active": api_key.is_active}

@app.delete("/api/admin/keys/{key}")
def delete_api_key(key: str, db: Session = Depends(get_db), admin_token: str = Depends(verify_admin_token)):
    api_key = db.query(ApiKey).filter(ApiKey.key == key).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found.")
    if key == "replica_default_key":
        raise HTTPException(status_code=400, detail="Cannot delete default key.")
    db.delete(api_key)
    db.commit()
    return {"success": True, "message": "Key deleted successfully."}

@app.get("/api/admin/uploads")
def get_uploads_history(db: Session = Depends(get_db), admin_token: str = Depends(verify_admin_token)):
    uploads = db.query(StlUpload).order_by(StlUpload.created_at.desc()).all()
    return [{
        "id": u.id,
        "original_filename": u.original_filename,
        "volume_cm3": u.volume_cm3,
        "estimated_weight_g": u.estimated_weight_g,
        "price_range": u.price_range,
        "api_key_used": u.api_key_used or "Anonymous Visitor",
        "created_at": u.created_at.isoformat()
    } for u in uploads]

@app.get("/api/admin/uploads/{id}/download")
def download_stl_file(id: int, db: Session = Depends(get_db), admin_token: str = Depends(verify_admin_token)):
    record = db.query(StlUpload).filter(StlUpload.id == id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Upload record not found.")
    file_path = os.path.join("uploads", record.stored_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Physical file not found on disk.")
    return FileResponse(
        path=file_path,
        filename=record.original_filename,
        media_type="application/octet-stream"
    )

class BulkDeleteUploadsRequest(BaseModel):
    ids: List[int]

@app.post("/api/admin/uploads/bulk-delete")
def bulk_delete_uploads(request: BulkDeleteUploadsRequest, db: Session = Depends(get_db), admin_token: str = Depends(verify_admin_token)):
    if not request.ids:
        return {"success": True, "deleted_count": 0}
        
    records = db.query(StlUpload).filter(StlUpload.id.in_(request.ids)).all()
    deleted_count = 0
    for record in records:
        stored_path = os.path.join("uploads", record.stored_filename)
        if os.path.exists(stored_path):
            try:
                os.remove(stored_path)
            except Exception as e:
                print(f"Error removing file {stored_path}: {e}")
        db.delete(record)
        deleted_count += 1
        
    db.commit()
    return {"success": True, "deleted_count": deleted_count}

# Serve Frontend static assets
if os.path.exists("frontend"):
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
