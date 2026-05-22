import sqlite3
import os
import time

class WeldForgeLogger:
    def __init__(self, db_path=None):
        if db_path is None:
            # Set default database location inside package directory
            base_dir = os.path.dirname(os.path.abspath(__file__))
            db_path = os.path.join(base_dir, "telemetry.db")
            
        self.db_path = db_path
        self.initialize_database()
        
    def initialize_database(self):
        """
        Create tables for telemetry records and event history if they do not already exist.
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 1. Telemetry Log Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS telemetry_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                mode TEXT,
                status TEXT,
                j1 REAL,
                j2 REAL,
                j3 REAL,
                j4 REAL,
                j5 REAL,
                j6 REAL
            )
        """)
        
        # 2. Event Log Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS event_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                event_description TEXT
            )
        """)
        
        conn.commit()
        conn.close()
        
    def log_telemetry(self, mode, status, j1, j2, j3, j4, j5, j6):
        """
        Log current 6-joint motor states and operational metrics to the database.
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO telemetry_logs (mode, status, j1, j2, j3, j4, j5, j6)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (mode, status, j1, j2, j3, j4, j5, j6))
            conn.commit()
            conn.close()
        except sqlite3.Error as e:
            print(f"Database error during telemetry logging: {e}")
            
    def log_event(self, description):
        """
        Log critical occurrences, sensor alerts, and machine alarms.
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO event_logs (event_description)
                VALUES (?)
            """, (description,))
            conn.commit()
            conn.close()
        except sqlite3.Error as e:
            print(f"Database error during event logging: {e}")
            
    def fetch_latest_events(self, limit=50):
        """
        Retrieve recent event logs to display in the user interface.
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT timestamp, event_description FROM event_logs
                ORDER BY id DESC LIMIT ?
            """, (limit,))
            rows = cursor.fetchall()
            conn.close()
            return rows
        except sqlite3.Error as e:
            print(f"Database error fetching events: {e}")
            return []
