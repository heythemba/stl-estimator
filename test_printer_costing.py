"""
Test suite to verify printer costing formulas:
- Two printers with different rates (open standard vs enclosed high-power)
- Short job vs Long job validation
- Confirmation that machine cost is distinct, margin is pure profit, and all differences come strictly from settings
"""
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.database import Base, Material, Machine, GlobalSetting
from backend.estimator import calculate_admin_cost, calculate_public_estimate

def setup_test_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Add materials
    mat_pla = Material(id="pla", name="PLA", density_g_cm3=1.24, price_per_kg=60.0)
    db.add(mat_pla)

    # Add 2 printers with different rates:
    # 1. Open Standard printer (low power, low startup, low hourly)
    mach_open = Machine(
        id="open_std",
        name="Open Standard Printer",
        power_watts=150.0,
        startup_cost=1.0,      # 1.0 TND flat per job
        hourly_rate=1.5,       # 1.5 TND/h
        flat_premium=1.0,
        provider="Standard",
        enclosed=False
    )
    # 2. Enclosed High-Power printer (high power, higher startup, higher hourly)
    mach_enclosed = Machine(
        id="enclosed_hp",
        name="Enclosed High-Power Printer",
        power_watts=350.0,
        startup_cost=4.0,      # 4.0 TND flat per job
        hourly_rate=5.0,       # 5.0 TND/h
        flat_premium=4.0,
        provider="Industrial",
        enclosed=True
    )
    db.add(mach_open)
    db.add(mach_enclosed)

    # Add global settings
    db.add(GlobalSetting(key="electricity_rate", value=0.35))
    db.add(GlobalSetting(key="wear_tear_percent", value=10.0))
    db.add(GlobalSetting(key="margin_percent", value=20.0))
    db.add(GlobalSetting(key="labor_rate_hourly", value=15.0))
    db.add(GlobalSetting(key="labor_modeling_rate", value=15.0))
    db.add(GlobalSetting(key="labor_scanning_rate", value=25.0))
    db.add(GlobalSetting(key="tax_percent", value=19.0))
    db.add(GlobalSetting(key="public_min_price_cap", value=0.0)) # disable floor to test exact math

    db.commit()
    return db

def run_tests():
    db = setup_test_db()

    print("=" * 60)
    print("RUNNING PRINTER COSTING VERIFICATION TESTS")
    print("=" * 60)

    # -------------------------------------------------------------
    # TEST 1: Short Job (20 mins = 1/3 hour, 15 grams)
    # -------------------------------------------------------------
    short_time_mins = 20.0
    short_time_hours = 20.0 / 60.0
    short_weight = 15.0

    print("\n--- TEST 1: SHORT JOB (20 mins, 15g PLA) ---")
    calc_open_short = calculate_admin_cost(
        db=db,
        weight_g=short_weight,
        print_time_mins=short_time_mins,
        material_id="pla",
        machine_id="open_std"
    )

    calc_enclosed_short = calculate_admin_cost(
        db=db,
        weight_g=short_weight,
        print_time_mins=short_time_mins,
        material_id="pla",
        machine_id="enclosed_hp"
    )

    # Expected calculations for Open Standard:
    # machine_cost = 1.0 + (1.5 * (20/60)) = 1.0 + 0.5 = 1.50 TND
    expected_mach_open_short = 1.0 + (1.5 * short_time_hours)
    assert abs(calc_open_short["machine_cost"] - expected_mach_open_short) < 0.01, f"Expected {expected_mach_open_short}, got {calc_open_short['machine_cost']}"
    assert calc_open_short["startup_cost"] == 1.0
    assert abs(calc_open_short["hourly_machine_cost"] - 0.50) < 0.01

    # Expected calculations for Enclosed High-Power:
    # machine_cost = 4.0 + (5.0 * (20/60)) = 4.0 + 1.6667 = 5.67 TND
    expected_mach_enclosed_short = 4.0 + (5.0 * short_time_hours)
    assert abs(calc_enclosed_short["machine_cost"] - round(expected_mach_enclosed_short, 2)) < 0.01, f"Expected {expected_mach_enclosed_short}, got {calc_enclosed_short['machine_cost']}"
    assert calc_enclosed_short["startup_cost"] == 4.0

    # Margin check: margin_val must be strictly subtotal * margin_percent (20%)
    assert abs(calc_open_short["margin_val"] - round(calc_open_short["subtotal"] * 0.20, 2)) <= 0.01
    assert abs(calc_enclosed_short["margin_val"] - round(calc_enclosed_short["subtotal"] * 0.20, 2)) <= 0.01

    print(f"Open Standard Short Job Machine Cost: {calc_open_short['machine_cost']} TND (Subtotal: {calc_open_short['subtotal']} TND, Margin: {calc_open_short['margin_val']} TND, Total TTC: {calc_open_short['selling_price']} TND)")
    print(f"Enclosed HP Short Job Machine Cost:   {calc_enclosed_short['machine_cost']} TND (Subtotal: {calc_enclosed_short['subtotal']} TND, Margin: {calc_enclosed_short['margin_val']} TND, Total TTC: {calc_enclosed_short['selling_price']} TND)")

    # -------------------------------------------------------------
    # TEST 2: Long Job (600 mins = 10 hours, 250 grams)
    # -------------------------------------------------------------
    long_time_mins = 600.0
    long_time_hours = 10.0
    long_weight = 250.0

    print("\n--- TEST 2: LONG JOB (10 hours, 250g PLA) ---")
    calc_open_long = calculate_admin_cost(
        db=db,
        weight_g=long_weight,
        print_time_mins=long_time_mins,
        material_id="pla",
        machine_id="open_std"
    )

    calc_enclosed_long = calculate_admin_cost(
        db=db,
        weight_g=long_weight,
        print_time_mins=long_time_mins,
        material_id="pla",
        machine_id="enclosed_hp"
    )

    # Expected calculations for Open Standard:
    # machine_cost = 1.0 + (1.5 * 10) = 1.0 + 15.0 = 16.0 TND
    expected_mach_open_long = 1.0 + (1.5 * 10.0)
    assert abs(calc_open_long["machine_cost"] - expected_mach_open_long) < 0.01, f"Expected {expected_mach_open_long}, got {calc_open_long['machine_cost']}"
    assert calc_open_long["startup_cost"] == 1.0
    assert abs(calc_open_long["hourly_machine_cost"] - 15.0) < 0.01

    # Expected calculations for Enclosed High-Power:
    # machine_cost = 4.0 + (5.0 * 10) = 4.0 + 50.0 = 54.0 TND
    expected_mach_enclosed_long = 4.0 + (5.0 * 10.0)
    assert abs(calc_enclosed_long["machine_cost"] - expected_mach_enclosed_long) < 0.01, f"Expected {expected_mach_enclosed_long}, got {calc_enclosed_long['machine_cost']}"
    assert calc_enclosed_long["startup_cost"] == 4.0
    assert abs(calc_enclosed_long["hourly_machine_cost"] - 50.0) < 0.01

    # Margin check: margin_val must be strictly subtotal * margin_percent (20%)
    assert abs(calc_open_long["margin_val"] - round(calc_open_long["subtotal"] * 0.20, 2)) <= 0.01
    assert abs(calc_enclosed_long["margin_val"] - round(calc_enclosed_long["subtotal"] * 0.20, 2)) <= 0.01

    print(f"Open Standard Long Job Machine Cost:  {calc_open_long['machine_cost']} TND (Subtotal: {calc_open_long['subtotal']} TND, Margin: {calc_open_long['margin_val']} TND, Total TTC: {calc_open_long['selling_price']} TND)")
    print(f"Enclosed HP Long Job Machine Cost:    {calc_enclosed_long['machine_cost']} TND (Subtotal: {calc_enclosed_long['subtotal']} TND, Margin: {calc_enclosed_long['margin_val']} TND, Total TTC: {calc_enclosed_long['selling_price']} TND)")

    # -------------------------------------------------------------
    # TEST 3: Verification of dynamic scaling without hardcoding
    # -------------------------------------------------------------
    # Machine rate ratio: (5.0 / 1.5) = 3.33x hourly cost
    # Electricity ratio: (350W / 150W) = 2.33x power cost
    assert calc_enclosed_long["electricity_cost"] > calc_open_long["electricity_cost"]
    assert calc_enclosed_long["machine_cost"] > calc_open_long["machine_cost"]
    assert calc_open_long["material_cost"] == calc_enclosed_long["material_cost"] # Same material weight

    print("\nALL VERIFICATIONS PASSED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
