"""
Estimator Module

This module is responsible for the core mathematical operations of the 3D Printing Cost Estimator.
It handles:
1. STL file parsing and volume extraction (using trimesh).
2. Public widget cost estimation (calculating price ranges based on volume).
3. Admin precise cost calculation (factoring in electricity, labor, wear & tear).
"""
import io
import trimesh
import numpy as np
import scipy
from sqlalchemy.orm import Session
from backend.database import Material, Machine, GlobalSetting, TimeBracket, UserSetting, UserMaterial, UserMachine

def parse_stl_volume(file_bytes: bytes):
    """
    Parses STL file bytes to calculate mesh volume and surface area.
    
    Args:
        file_bytes (bytes): The raw binary content of an uploaded STL file.
        
    Returns:
        dict: Contains calculated volume_cm3, surface_area_cm2, is_watertight status, and any error message.
    """
    try:
        # Load the STL data into memory so trimesh can parse it without a physical file
        file_obj = io.BytesIO(file_bytes)
        mesh = trimesh.load(file_obj, file_type='stl')
        
        is_watertight = bool(mesh.is_watertight)
        
        volume_mm3 = mesh.volume
        
        if np.isnan(volume_mm3) or volume_mm3 <= 0:
            # Fallback if volume calculation fails (e.g. non-watertight mesh)
            if mesh.is_empty:
                volume_cm3 = 0.0
            else:
                # Try convex hull volume as fallback
                volume_cm3 = abs(mesh.convex_hull.volume) / 1000.0
        else:
            volume_cm3 = abs(volume_mm3) / 1000.0
            
        surface_area_cm2 = mesh.area / 100.0 # mm^2 to cm^2
        
        return {
            "volume_cm3": volume_cm3,
            "surface_area_cm2": surface_area_cm2,
            "is_watertight": is_watertight,
            "error": None
        }
    except Exception as e:
        return {
            "volume_cm3": 0.0,
            "surface_area_cm2": 0.0,
            "is_watertight": False,
            "error": str(e)
        }

def get_setting(db: Session, key: str, default: float) -> float:
    """Helper function to fetch a global setting from the DB, returning a default if not found."""
    setting = db.query(GlobalSetting).filter(GlobalSetting.key == key).first()
    return setting.value if setting else default

def get_user_setting(db: Session, user_id: int, key: str, default: float) -> float:
    """Helper function to fetch a user-specific setting from the DB, returning a default if not found."""
    setting = db.query(UserSetting).filter(UserSetting.user_id == user_id, UserSetting.key == key).first()
    return setting.value if setting else default

def calculate_public_estimate(db: Session, volume_cm3: float, material_id: str, user_id: int = None):
    """
    Calculates the public estimate range, print time, and machine selection based on mesh volume.
    
    This function auto-selects a machine based on whether the material requires an enclosure (e.g. ABS).
    It then estimates print time using configured "Time Brackets" and calculates a min-max price range.
    Supports user overrides if user_id is provided.
    
    Args:
        db (Session): Database session.
        volume_cm3 (float): The calculated volume of the part in cubic centimeters.
        material_id (str): The ID of the requested material (e.g. "pla", "petg").
        user_id (int, optional): The ID of a developer user, if requested via developer API key.
        
    Returns:
        dict: A dictionary containing weight, time, machine name, price_min, price_max, and material_cost.
    """
    # 1. Fetch material info
    if user_id:
        material = db.query(UserMaterial).filter(UserMaterial.user_id == user_id, UserMaterial.material_id == material_id.lower()).first()
    else:
        material = None
        
    if not material:
        material = db.query(Material).filter(Material.id == material_id.lower()).first()
    if not material:
        material = Material(id="pla", name="PLA", density_g_cm3=1.24, price_per_kg=60.0)

    # 2. Fetch settings
    if user_id:
        infill_ratio = get_user_setting(db, user_id, "infill_ratio", 20.0) / 100.0
        support_buffer = get_user_setting(db, user_id, "support_buffer_percent", 10.0) / 100.0
        margin_percent = get_user_setting(db, user_id, "margin_percent", 20.0) / 100.0
        min_price_cap = 15.0
        min_offset_mult = 0.90
        max_offset_mult = 1.15
    else:
        infill_ratio = get_setting(db, "public_infill_ratio", 20.0) / 100.0
        support_buffer = get_setting(db, "public_support_buffer_percent", 10.0) / 100.0
        margin_percent = get_setting(db, "margin_percent", 20.0) / 100.0
        min_price_cap = get_setting(db, "public_min_price_cap", 15.0)
        min_offset_mult = get_setting(db, "public_price_range_min_offset", 90.0) / 100.0
        max_offset_mult = get_setting(db, "public_price_range_max_offset", 115.0) / 100.0
    
    # 3. Calculate weight (g)
    base_weight = volume_cm3 * material.density_g_cm3 * infill_ratio
    est_weight = base_weight * (1.0 + support_buffer)
    
    # 4. Auto-select Machine
    needs_enclosed = material_id.lower() not in ["pla", "petg"]
    
    machine = None
    if user_id:
        # Try to find a user machine matching the enclosed requirement
        machine = db.query(UserMachine).filter(
            UserMachine.user_id == user_id,
            UserMachine.enclosed == needs_enclosed
        ).first()
        if not machine:
            machine = db.query(UserMachine).filter(UserMachine.user_id == user_id).first()
            
    if not machine:
        # Try to find a global machine matching the enclosed requirement
        machine = db.query(Machine).filter(Machine.enclosed == needs_enclosed).first()
        
    if not machine:
        machine = db.query(Machine).first()
        
    if not machine:
        machine = Machine(id="a1_combo", name="Default Machine", power_watts=200.0, flat_premium=0.0, enclosed=False)
        
    machine_id = machine.machine_id if hasattr(machine, 'machine_id') else machine.id

    # 5. Estimate Print Time via Bracket Lookup
    bracket = (
        db.query(TimeBracket)
        .filter(TimeBracket.machine_id == machine_id, TimeBracket.max_weight_g >= est_weight)
        .order_by(TimeBracket.max_weight_g.asc())
        .first()
    )
    if not bracket:
        bracket = (
            db.query(TimeBracket)
            .filter(TimeBracket.machine_id == machine_id)
            .order_by(TimeBracket.max_weight_g.desc())
            .first()
        )
    
    if bracket:
        est_time_mins = bracket.base_time_mins + (bracket.time_per_g_mins * est_weight)
    else:
        est_time_mins = 45.0 + (2.0 * est_weight)

    # 6. Calculate Pricing
    material_cost = (est_weight / 1000.0) * material.price_per_kg
    base_price = material_cost * (1.0 + margin_percent) + machine.flat_premium
    
    if base_price < min_price_cap:
        base_price = min_price_cap
        
    price_min = max(min_price_cap, round(base_price * min_offset_mult))
    price_max = max(min_price_cap + 5, round(base_price * max_offset_mult))

    return {
        "estimated_weight_g": round(est_weight, 1),
        "estimated_time_mins": round(est_time_mins),
        "machine": machine.name,
        "price_min": price_min,
        "price_max": price_max,
        "material_cost": round(material_cost, 2)
    }

def calculate_admin_cost(
    db: Session, 
    weight_g: float, 
    print_time_mins: float, 
    material_id: str, 
    machine_id: str,
    labor_hours: float = 0.0,
    user_id: int = None
):
    """
    Calculates precise internal cost breakdown and final selling price for the Dashboard.
    
    Unlike public estimate, this function uses exact metrics provided by a slicer (weight and time)
    to calculate precise direct costs (electricity, material) and indirect costs (labor, wear and tear).
    Supports user overrides if user_id is provided.
    
    Args:
        db (Session): Database session.
        weight_g (float): The exact print weight in grams.
        print_time_mins (float): The exact print time in minutes.
        material_id (str): The specific material used.
        machine_id (str): The specific machine used.
        labor_hours (float, optional): Labor hours spent setting up/post-processing. Defaults to 0.0.
        user_id (int, optional): The ID of a developer user.
        
    Returns:
        dict: A highly detailed breakdown including material_cost, electricity_cost, direct_cost, wear_tear, labor_cost, subtotal, and final selling_price.
    """
    # 1. Fetch material info
    if user_id:
        material = db.query(UserMaterial).filter(UserMaterial.user_id == user_id, UserMaterial.material_id == material_id.lower()).first()
    else:
        material = None
        
    if not material:
        material = db.query(Material).filter(Material.id == material_id.lower()).first()
    if not material:
        raise ValueError(f"Material '{material_id}' not found.")

    # 2. Fetch machine info
    if user_id:
        machine = db.query(UserMachine).filter(UserMachine.user_id == user_id, UserMachine.machine_id == machine_id.lower()).first()
    else:
        machine = None
        
    if not machine:
        machine = db.query(Machine).filter(Machine.id == machine_id.lower()).first()
    if not machine:
        raise ValueError(f"Machine '{machine_id}' not found.")

    # 3. Fetch settings
    if user_id:
        electricity_rate = get_user_setting(db, user_id, "electricity_rate", 0.0)
        wear_tear_percent = get_user_setting(db, user_id, "wear_tear_percent", 10.0) / 100.0
        margin_percent = get_user_setting(db, user_id, "margin_percent", 20.0) / 100.0
        labor_rate_hourly = get_user_setting(db, user_id, "labor_rate_hourly", 15.0)
    else:
        electricity_rate = get_setting(db, "electricity_rate", 0.0)
        wear_tear_percent = get_setting(db, "wear_tear_percent", 10.0) / 100.0
        margin_percent = get_setting(db, "margin_percent", 20.0) / 100.0
        labor_rate_hourly = get_setting(db, "labor_rate_hourly", 15.0)

    # 4. Perform calculations
    material_cost = (weight_g / 1000.0) * material.price_per_kg
    
    # Calculate electricity cost based on print time and machine power consumption
    print_time_hours = print_time_mins / 60.0
    machine_power_kw = machine.power_watts / 1000.0
    electricity_cost = machine_power_kw * print_time_hours * electricity_rate
    
    # Base manufacturing cost
    direct_cost = material_cost + electricity_cost
    
    # Overhead costs
    wear_tear = direct_cost * wear_tear_percent
    labor_cost = labor_hours * labor_rate_hourly
    
    # Final Pricing calculations
    subtotal = direct_cost + wear_tear + labor_cost
    selling_price = subtotal * (1.0 + margin_percent) + machine.flat_premium

    return {
        "material_cost": round(material_cost, 2),
        "electricity_cost": round(electricity_cost, 2),
        "direct_cost": round(direct_cost, 2),
        "wear_tear": round(wear_tear, 2),
        "labor_cost": round(labor_cost, 2),
        "subtotal": round(subtotal, 2),
        "selling_price": round(selling_price, 2)
    }
