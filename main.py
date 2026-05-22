import sys
from PyQt6.QtWidgets import QApplication
from weldforge_x.core.engine import WeldForgeEngine
from weldforge_x.ui.dashboard import IndustrialDashboard

def main():
    """
    Main bootstrapping entry point.
    """
    # 1. Initialize the central PyQt6 application
    app = QApplication(sys.argv)
    app.setStyle("Fusion") # Fusion theme yields clean industrial shapes
    
    # 2. Boot the Panda3D 3D graphics rendering engine in background mode
    print("[WELDFORGE-X] Booting Panda3D graphics pipelines...")
    engine = WeldForgeEngine()
    
    # 3. Create and configure the main Siemens-style industrial dashboard UI
    print("[WELDFORGE-X] Initializing industrial dashboard widgets...")
    dashboard = IndustrialDashboard(engine)
    
    # 4. Display the dashboard and start the application loops
    dashboard.show()
    print("[WELDFORGE-X] Digital Twin running at 60 FPS.")
    
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
