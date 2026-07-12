"""
Migration script: adds email, is_active, activation_token, reset_token, reset_token_expires
columns to the existing users table if they don't already exist.
"""
import sqlite3

DB_PATH = "replica_estimator_v2.db"

def column_exists(cursor, table, column):
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())

def run():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    migrations = [
        ("email",                "VARCHAR"),
        ("is_active",            "BOOLEAN NOT NULL DEFAULT 0"),
        ("activation_token",     "VARCHAR"),
        ("reset_token",          "VARCHAR"),
        ("reset_token_expires",  "DATETIME"),
    ]
    
    for col_name, col_type in migrations:
        if not column_exists(c, "users", col_name):
            print(f"  Adding column: users.{col_name}")
            c.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}")
        else:
            print(f"  Column already exists: users.{col_name}")
    
    # Activate existing users (so old accounts still work)
    c.execute("UPDATE users SET is_active = 1 WHERE is_active IS NULL OR is_active = 0")
    
    conn.commit()
    conn.close()
    print("Migration complete.")

if __name__ == "__main__":
    run()
