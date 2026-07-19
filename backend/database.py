"""
Database Module

This module handles the database connection, SQLAlchemy ORM model definitions,
and initial data seeding. It defaults to SQLite but can be overridden with a Postgres URL.
"""
import os
from datetime import datetime
from sqlalchemy import create_engine, Column, String, Float, Integer, Boolean, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# Database Configuration
# Default to local SQLite, but can be overridden by DATABASE_URL (e.g. Supabase/PostgreSQL)
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///replica_estimator_v4.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# For SQLite, we need to allow multithreading, but PostgreSQL doesn't need it.
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    """
    Represents a developer or admin user registered in the system.
    """
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=False, nullable=False)
    activation_token = Column(String, nullable=True)
    reset_token = Column(String, nullable=True)
    reset_token_expires = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class UserSession(Base):
    """
    Tracks active login sessions for developer/admin users.
    """
    __tablename__ = "user_sessions"
    token = Column(String, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class ApiKey(Base):
    __tablename__ = "api_keys"
    key = Column(String, primary_key=True, index=True)
    owner = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    calls_count = Column(Integer, default=0, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class StlUpload(Base):
    __tablename__ = "stl_uploads"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    original_filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False)
    volume_cm3 = Column(Float, nullable=False)
    estimated_weight_g = Column(Float, nullable=False)
    price_range = Column(String, nullable=False)
    api_key_used = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

# Core Pricing Models
class Material(Base):
    """
    Represents a global 3D printing material (e.g., PLA, PETG) available to all users.
    Used for volume-to-weight and base cost calculations.
    """
    __tablename__ = "materials"
    id = Column(String, primary_key=True, index=True) # e.g., 'pla'
    name = Column(String, nullable=False)            # e.g., 'PLA'
    density_g_cm3 = Column(Float, nullable=False)    # e.g., 1.24
    price_per_kg = Column(Float, nullable=False)     # e.g., 60.0 (TND)

class Machine(Base):
    """
    Represents a global 3D printer available in the system.
    Includes power consumption and enclosure requirements to auto-select the right machine.
    """
    __tablename__ = "machines"
    id = Column(String, primary_key=True, index=True) # e.g., 'a1_combo'
    name = Column(String, nullable=False)            # e.g., 'A1 Combo'
    power_watts = Column(Float, nullable=False)      # e.g., 150.0
    flat_premium = Column(Float, nullable=False)     # e.g., 0.0 (TND)
    provider = Column(String, nullable=True)         # e.g., 'Bambulab'
    enclosed = Column(Boolean, default=False, nullable=False)

class GlobalSetting(Base):
    __tablename__ = "global_settings"
    key = Column(String, primary_key=True, index=True) # e.g., 'margin_percent'
    value = Column(Float, nullable=False)

class TimeBracket(Base):
    __tablename__ = "time_brackets"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    machine_id = Column(String, nullable=False)
    max_weight_g = Column(Float, nullable=False)      # Maximum weight in grams for this bracket
    base_time_mins = Column(Float, nullable=False)    # Base print time in minutes
    time_per_g_mins = Column(Float, nullable=False)   # Extra minutes per gram of weight

class UserSetting(Base):
    __tablename__ = "user_settings"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key = Column(String, nullable=False)
    value = Column(Float, nullable=False)

class UserMaterial(Base):
    __tablename__ = "user_materials"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    material_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    density_g_cm3 = Column(Float, nullable=False)
    price_per_kg = Column(Float, nullable=False)

class UserMachine(Base):
    __tablename__ = "user_machines"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    machine_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    power_watts = Column(Float, nullable=False)
    flat_premium = Column(Float, nullable=False)
    provider = Column(String, nullable=True)         # e.g., 'Bambulab'
    enclosed = Column(Boolean, default=False, nullable=False)

class AdminSession(Base):
    """
    Tracks active login sessions for the Super Admin to persist across server reloads.
    """
    __tablename__ = "admin_sessions"
    token = Column(String, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

# Dependency to get db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Seeding Logic
def seed_database():
    """
    Initializes the database by creating tables and injecting default
    materials, machines, and configuration settings if the database is empty.
    """
    Base.metadata.create_all(bind=engine)
    
    # Run migrations for SQLite/existing databases if needed (e.g. adding missing columns)
    # since SQLAlchemy create_all does not add columns to existing tables.
    from sqlalchemy import text, inspect
    
    db = SessionLocal()
    try:
        inspector = inspect(engine)
        if "api_keys" in inspector.get_table_names():
            columns = [c["name"] for c in inspector.get_columns("api_keys")]
            if "user_id" not in columns:
                print("Migration: adding 'user_id' column to 'api_keys' table.")
                db.execute(text("ALTER TABLE api_keys ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL"))
                db.commit()

        if "machines" in inspector.get_table_names():
            columns = [c["name"] for c in inspector.get_columns("machines")]
            if "provider" not in columns:
                print("Migration: adding 'provider' column to 'machines' table.")
                db.execute(text("ALTER TABLE machines ADD COLUMN provider VARCHAR"))
                db.commit()
            if "enclosed" not in columns:
                print("Migration: adding 'enclosed' column to 'machines' table.")
                try:
                    db.execute(text("ALTER TABLE machines ADD COLUMN enclosed BOOLEAN DEFAULT FALSE"))
                    db.commit()
                except Exception:
                    db.rollback()
                    db.execute(text("ALTER TABLE machines ADD COLUMN enclosed BOOLEAN DEFAULT 0"))
                    db.commit()
                try:
                    db.execute(text("UPDATE machines SET enclosed = 1 WHERE id = 'h2s'"))
                    db.commit()
                except Exception:
                    db.rollback()

        if "user_machines" in inspector.get_table_names():
            columns = [c["name"] for c in inspector.get_columns("user_machines")]
            if "provider" not in columns:
                print("Migration: adding 'provider' column to 'user_machines' table.")
                db.execute(text("ALTER TABLE user_machines ADD COLUMN provider VARCHAR"))
                db.commit()
            if "enclosed" not in columns:
                print("Migration: adding 'enclosed' column to 'user_machines' table.")
                try:
                    db.execute(text("ALTER TABLE user_machines ADD COLUMN enclosed BOOLEAN DEFAULT FALSE"))
                    db.commit()
                except Exception:
                    db.rollback()
                    db.execute(text("ALTER TABLE user_machines ADD COLUMN enclosed BOOLEAN DEFAULT 0"))
                    db.commit()
    except Exception as migration_error:
        print(f"Migration warning: {migration_error}")
        db.rollback()

    try:
        # Default seeding disabled. Administrator must configure settings.
        pass
            
    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
    finally:
        db.close()
