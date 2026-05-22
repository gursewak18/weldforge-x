import random
import math
import cv2
import numpy as np
import time
from PyQt6.QtWidgets import (
    QMainWindow,
    QWidget,
    QHBoxLayout,
    QVBoxLayout,
    QGridLayout,
    QLabel,
    QSlider,
    QDoubleSpinBox,
    QPushButton,
    QComboBox,
    QListWidget,
    QFrame,
    QGroupBox
)
from PyQt6.QtCore import QTimer, Qt, QSize, QRectF
from PyQt6.QtGui import QImage, QPixmap, QColor, QFont, QPainter, QPen, QBrush
import pyqtgraph as pg

from panda3d.core import Vec3, Vec4
from weldforge_x.ui.viewport_widget import Panda3DViewport
from weldforge_x.core.robotics import KukaRoboticArm, KUKA_ORANGE
from weldforge_x.core.simulation import FactorySimulation
from weldforge_x.core.welding import WeldingEffectsManager
from weldforge_x.database.logger import WeldForgeLogger

# Premium Industrial Color Scheme (Siemens Digital Twin Style)
BG_MAIN = "#0a0c10"
BG_PANEL = "rgba(22, 26, 34, 0.85)"
BORDER_COLOR = "rgba(45, 54, 72, 0.65)"
TEXT_MAIN = "#f7fafc"
TEXT_MUTED = "#a0aec0"
CYAN_GLOW = "#00f0ff"
WARN_YELLOW = "#ffb700"
EMERGENCY_RED = "#ff1744"
SAFE_GREEN = "#00e676"
COBALT_BLUE = "#0066cc"


class CircularGauge(QWidget):
    def __init__(self, title, min_val, max_val, suffix="%", parent=None):
        super().__init__(parent)
        self.title = title
        self.min_val = min_val
        self.max_val = max_val
        self.suffix = suffix
        self.value = min_val
        self.setMinimumSize(80, 85)
        
    def set_value(self, val):
        self.value = max(self.min_val, min(self.max_val, val))
        self.update()
        
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        width = self.width()
        height = self.height()
        size = min(width, height - 15) - 6
        rect = QRectF((width - size)/2, 4, size, size)
        
        # Radial background disk
        painter.setPen(QPen(QColor(36, 42, 54), 1.5))
        painter.setBrush(QBrush(QColor(13, 16, 22)))
        painter.drawEllipse(rect)
        
        # Draw base background arc line (270 degree span)
        span = 270.0
        start_angle = -135.0
        painter.setPen(QPen(QColor(45, 54, 72, 100), 4, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
        painter.drawArc(rect, int(start_angle * 16), int(-span * 16))
        
        # Compute value ratio
        ratio = (self.value - self.min_val) / (self.max_val - self.min_val) if (self.max_val > self.min_val) else 0.0
        active_span = -span * ratio
        
        # Glowing color selection based on value
        glow_color = QColor(0, 240, 255) # Cyan stable
        if "RUL" in self.title:
            if ratio < 0.3:
                glow_color = QColor(255, 23, 68) # Red
            elif ratio < 0.7:
                glow_color = QColor(255, 183, 0) # Warning
            else:
                glow_color = QColor(0, 230, 118) # Safe
        else: # Temp or other gauges
            if ratio > 0.8:
                glow_color = QColor(255, 23, 68)
            elif ratio > 0.55:
                glow_color = QColor(255, 183, 0)
                
        # Draw active value arc line
        pen = QPen(glow_color, 4, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap)
        painter.setPen(pen)
        painter.drawArc(rect, int(start_angle * 16), int(active_span * 16))
        
        # Label Title text
        painter.setPen(QPen(QColor(TEXT_MUTED)))
        painter.setFont(QFont("Consolas", 6, QFont.Weight.Bold))
        painter.drawText(self.rect(), Qt.AlignmentFlag.AlignBottom | Qt.AlignmentFlag.AlignHCenter, self.title)
        
        # Value string
        painter.setPen(QPen(QColor(TEXT_MAIN)))
        painter.setFont(QFont("Consolas", 8, QFont.Weight.Bold))
        painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, f"{self.value:.1f}{self.suffix}")


class IndustrialDashboard(QMainWindow):
    def __init__(self, engine):
        super().__init__()
        self.engine = engine
        self.setWindowTitle("WELDFORGE-X // Collaborative Dual-Robot Digital Twin Cell")
        self.resize(1620, 960)
        self.setStyleSheet(f"""
            QMainWindow {{
                background-color: {BG_MAIN};
            }}
            QWidget {{
                color: {TEXT_MAIN};
                font-family: 'Consolas', 'Segoe UI', monospace;
            }}
            QGroupBox {{
                background-color: {BG_PANEL};
                border: 1px solid {BORDER_COLOR};
                border-radius: 6px;
                margin-top: 15px;
                font-weight: bold;
                font-size: 11px;
                letter-spacing: 1px;
                text-transform: uppercase;
                color: {CYAN_GLOW};
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                subcontrol-position: top left;
                padding: 0 8px;
                left: 15px;
            }}
            QLabel {{
                font-size: 11px;
            }}
            QSlider::groove:horizontal {{
                height: 5px;
                background: #2a2f3b;
                border-radius: 2px;
            }}
            QSlider::handle:horizontal {{
                background: {CYAN_GLOW};
                width: 14px;
                margin-top: -5px;
                margin-bottom: -5px;
                border-radius: 7px;
            }}
            QPushButton {{
                background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #2d3748, stop:1 #1a202c);
                border: 1px solid {BORDER_COLOR};
                border-radius: 4px;
                padding: 7px;
                font-weight: bold;
                font-size: 10px;
                letter-spacing: 0.5px;
            }}
            QPushButton:hover {{
                border-color: {CYAN_GLOW};
                background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #3a475c, stop:1 #222a36);
            }}
            QListWidget {{
                background-color: #06080b;
                border: 1px solid {BORDER_COLOR};
                border-radius: 4px;
                font-size: 10px;
                color: #cbd5e0;
                padding: 4px;
            }}
        """)
        
        # 1. Initialize core system modules
        self.db_logger = WeldForgeLogger()
        
        # Instantiate both robotic arms symmetrically
        self.welder_robot = KukaRoboticArm(self.engine.render, arm_type="WELDER", base_pos=Vec3(0.9, 0.4, 0.0), arm_color=KUKA_ORANGE)
        self.loader_robot = KukaRoboticArm(self.engine.render, arm_type="LOADER", base_pos=Vec3(-0.9, 0.4, 0.0), arm_color=Vec4(0.0, 0.55, 1.0, 1.0))
        
        # Point self.robot to the current manual override control target
        self.robot = self.welder_robot
        
        self.sim = FactorySimulation(self.engine)
        self.welding_mgr = WeldingEffectsManager(self.engine.render, self.engine.lights['weld_glow'])
        
        # Setup telemetry history arrays for Welder & Loader comparative tracks
        self.time_history = list(np.linspace(-10, 0, 100))
        self.telemetry_history_welder = {
            'torque': [list(np.zeros(100)) for _ in range(6)],
            'temperature': [list(np.ones(100) * 35.0) for _ in range(6)],
            'current': [list(np.zeros(100)) for _ in range(6)]
        }
        self.telemetry_history_loader = {
            'torque': [list(np.zeros(100)) for _ in range(6)],
            'temperature': [list(np.ones(100) * 32.0) for _ in range(6)],
            'current': [list(np.zeros(100)) for _ in range(6)]
        }
        self.vibe_history = list(np.zeros(100))
        
        # Automated Collaborative Weld Cycle Variables
        self.operation_mode = "MANUAL"
        self.auto_step = "WAIT_FOR_PART"
        self.auto_timer = 0.0
        self.active_workpiece = None
        self.weld_start = None
        self.weld_end = None
        
        # Predefined robot coordinate targets
        self.loader_home_target = Vec3(-0.9, 1.2, 1.4)
        self.welder_home_target = Vec3(0.9, 1.2, 1.4)
        
        # Build UI layout
        self.setup_ui_layout()
        
        # Start main loop timer for UI telemetry and automated logic
        self.ui_timer = QTimer(self)
        self.ui_timer.timeout.connect(self.system_tick)
        self.ui_timer.start(33) # 30 FPS Update tick
        
        self.log_event("Dual-arm collaborative digital twin interface initialized successfully.")
        
    def setup_ui_layout(self):
        """
        Create dynamic side-by-side glassmorphic panels layout.
        """
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        main_layout = QHBoxLayout(main_widget)
        main_layout.setContentsMargins(10, 10, 10, 10)
        main_layout.setSpacing(8)
        
        # LEFT PANEL: Controls (Joint manual, IK path, operational modes)
        left_layout = QVBoxLayout()
        left_layout.setSpacing(6)
        
        # Group 1: System Status & Modes
        mode_box = QGroupBox("Cell Operations Manager")
        mode_layout = QVBoxLayout(mode_box)
        mode_layout.setSpacing(8)
        
        self.lbl_status = QLabel("STATUS: TELEMETRY READY (IDLE)")
        self.lbl_status.setStyleSheet(f"color: {SAFE_GREEN}; font-size: 12px; font-weight: bold; padding: 4px;")
        mode_layout.addWidget(self.lbl_status)
        
        self.combo_mode = QComboBox()
        self.combo_mode.addItems(["Manual Joint Override", "Full Auto Collaborative Run"])
        self.combo_mode.setStyleSheet("""
            QComboBox {
                background-color: #1a202c;
                border: 1px solid rgba(45, 54, 72, 0.65);
                border-radius: 4px;
                padding: 6px;
                color: #e2e8f0;
                font-weight: bold;
            }
        """)
        self.combo_mode.currentIndexChanged.connect(self.change_system_mode)
        mode_layout.addWidget(self.combo_mode)
        
        self.btn_estop = QPushButton("EMERGENCY SHUTDOWN")
        self.btn_estop.setStyleSheet(f"background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 {EMERGENCY_RED}, stop:1 #b3001e); color: white; padding: 12px; font-size: 12px; border-radius: 4px;")
        self.btn_estop.clicked.connect(self.trigger_estop)
        mode_layout.addWidget(self.btn_estop)
        left_layout.addWidget(mode_box)
        
        # Group 2: Manual 6-Axis Sliders with Target Selector
        self.manual_box = QGroupBox("Manual Servo Override")
        manual_layout = QVBoxLayout(self.manual_box)
        
        self.combo_manual_target = QComboBox()
        self.combo_manual_target.addItems(["Control: Welder Robotic Arm", "Control: Loader Robotic Arm"])
        self.combo_manual_target.setStyleSheet("""
            QComboBox {
                background-color: #0e1117;
                border: 1px solid rgba(45, 54, 72, 0.5);
                border-radius: 4px;
                padding: 4px;
                color: #cbd5e0;
                font-weight: bold;
                font-size: 10px;
            }
        """)
        self.combo_manual_target.currentIndexChanged.connect(self.change_manual_control_target)
        manual_layout.addWidget(self.combo_manual_target)
        
        manual_grid = QGridLayout()
        manual_grid.setVerticalSpacing(4)
        
        self.sliders = []
        self.spinboxes = []
        for i in range(6):
            lbl = QLabel(f"Axis J{i+1}")
            lbl.setStyleSheet(f"color: {TEXT_MUTED}; font-weight: bold;")
            slider = QSlider(Qt.Orientation.Horizontal)
            low, high = self.robot.joint_limits[i]
            slider.setRange(int(low), int(high))
            slider.setValue(int(self.robot.joint_angles[i]))
            
            spin = QDoubleSpinBox()
            spin.setRange(low, high)
            spin.setValue(self.robot.joint_angles[i])
            spin.setSingleStep(1.0)
            spin.setFixedWidth(65)
            spin.setStyleSheet("background-color: #0e1117; border: 1px solid rgba(45,54,72,0.65); border-radius: 3px; padding: 2px;")
            
            # Hook together
            slider.valueChanged.connect(lambda val, idx=i: self.sync_slider_spin(idx, val, True))
            spin.valueChanged.connect(lambda val, idx=i: self.sync_slider_spin(idx, val, False))
            
            manual_grid.addWidget(lbl, i, 0)
            manual_grid.addWidget(slider, i, 1)
            manual_grid.addWidget(spin, i, 2)
            
            self.sliders.append(slider)
            self.spinboxes.append(spin)
        manual_layout.addLayout(manual_grid)
        left_layout.addWidget(self.manual_box)
        
        # Group 3: Real-Time IK Coordinate inputs
        self.ik_box = QGroupBox("IK Teach Coordinates")
        ik_grid = QGridLayout(self.ik_box)
        
        self.ik_inputs = []
        labels = ["TCP Coordinate X", "TCP Coordinate Y", "TCP Coordinate Z"]
        defaults = [0.0, 1.8, 1.5]
        ranges = [(-2.5, 2.5), (0.5, 3.5), (0.0, 3.0)]
        
        for i, name in enumerate(labels):
            lbl = QLabel(name)
            lbl.setStyleSheet(f"color: {TEXT_MUTED}; font-weight: bold;")
            spin = QDoubleSpinBox()
            low, high = ranges[i]
            spin.setRange(low, high)
            spin.setValue(defaults[i])
            spin.setSingleStep(0.05)
            spin.setStyleSheet("background-color: #0e1117; border: 1px solid rgba(45,54,72,0.65); border-radius: 3px; padding: 2px;")
            spin.valueChanged.connect(self.trigger_ik_solve)
            
            ik_grid.addWidget(lbl, i, 0)
            ik_grid.addWidget(spin, i, 1)
            self.ik_inputs.append(spin)
            
        self.btn_weld_manual = QPushButton("TRIGGER MANUAL CYCLIC STEP")
        self.btn_weld_manual.clicked.connect(self.trigger_manual_weld)
        ik_grid.addWidget(self.btn_weld_manual, 3, 0, 1, 2)
        left_layout.addWidget(self.ik_box)
        
        left_frame = QFrame()
        left_frame.setLayout(left_layout)
        left_frame.setFixedWidth(350)
        main_layout.addWidget(left_frame)
        
        # CENTER PANEL: Embedded 3D Viewport
        center_layout = QVBoxLayout()
        self.viewport = Panda3DViewport(self.engine)
        center_layout.addWidget(self.viewport, stretch=3)
        
        # Bottom of Center Panel: AI Seam Camera & Predictive Maintenance logs
        bottom_row = QHBoxLayout()
        
        # Weld Seam Camera Feed (AI Seam Vision Feed)
        ai_box = QGroupBox("AI Coaxial Seam Camera Feed")
        ai_layout = QVBoxLayout(ai_box)
        self.cam_feed_lbl = QLabel()
        self.cam_feed_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.cam_feed_lbl.setMinimumSize(250, 160)
        self.cam_feed_lbl.setStyleSheet("background-color: #06080b; border: 1px solid rgba(45,54,72,0.65); border-radius: 4px;")
        ai_layout.addWidget(self.cam_feed_lbl)
        bottom_row.addWidget(ai_box, stretch=1)
        
        # Predictive Maintenance remaining useful life dial gauges
        pred_box = QGroupBox("Predictive Maintenance (Active Joint RUL)")
        pred_grid = QGridLayout(pred_box)
        self.rul_gauges = []
        for i in range(6):
            gauge = CircularGauge(f"WELDER J{i+1} RUL", 0.0, 100.0, "%")
            pred_grid.addWidget(gauge, i // 3, i % 3)
            self.rul_gauges.append(gauge)
            
        bottom_row.addWidget(pred_box, stretch=2)
        
        center_layout.addLayout(bottom_row, stretch=1)
        main_layout.addLayout(center_layout, stretch=3)
        
        # RIGHT PANEL: Live Graphs & Telemetry Plots
        right_layout = QVBoxLayout()
        right_layout.setSpacing(6)
        
        graph_box = QGroupBox("Real-Time Telemetry Analytics")
        graph_grid = QGridLayout(graph_box)
        
        pg.setConfigOption('background', '#0a0c10')
        pg.setConfigOption('foreground', '#718096')
        
        # ComboBox to Filter Graph Telemetry
        self.combo_telemetry_filter = QComboBox()
        self.combo_telemetry_filter.addItems(["Focus: Welder Robotic Arm", "Focus: Loader Robotic Arm", "Focus: Dual Arm Comparative Overlay"])
        self.combo_telemetry_filter.setStyleSheet("""
            QComboBox {
                background-color: #1a202c;
                border: 1px solid rgba(45, 54, 72, 0.65);
                border-radius: 4px;
                padding: 4px;
                color: #e2e8f0;
                font-size: 10px;
                font-weight: bold;
            }
        """)
        self.combo_telemetry_filter.currentIndexChanged.connect(self.change_telemetry_focus)
        graph_grid.addWidget(self.combo_telemetry_filter, 0, 0, 1, 2)
        
        # J1-J6 Torques Plot
        self.plot_torque = pg.PlotWidget(title="Joint Transmitted Torques (Nm)")
        self.plot_torque.showGrid(x=True, y=True, alpha=0.15)
        self.torque_curves = [self.plot_torque.plot(pen=pg.mkPen(color=c, width=1.5)) for c in ['#00f0ff', '#ff5000', '#00e676', '#ffb700', '#d500f9', '#ffffff']]
        self.torque_overlay_curves = [self.plot_torque.plot(pen=pg.mkPen(color=c, width=1.0, style=Qt.PenStyle.DashLine)) for c in ['#00a2ff', '#ff1a00', '#00ff8c', '#ffea00', '#a200ff', '#e2e8f0']]
        graph_grid.addWidget(self.plot_torque, 1, 0)
        
        # Vibrations Plot
        self.plot_vibe = pg.PlotWidget(title="Tool TCP Vibro-Acoustic Sensor (mm/s²)")
        self.plot_vibe.showGrid(x=True, y=True, alpha=0.15)
        self.vibe_curve = self.plot_vibe.plot(pen=pg.mkPen(color='#ff1744', width=1.5))
        graph_grid.addWidget(self.plot_vibe, 1, 1)
        
        # Thermal Profile Plot
        self.plot_temp = pg.PlotWidget(title="Servo Motor Thermal Sensors (°C)")
        self.plot_temp.showGrid(x=True, y=True, alpha=0.15)
        self.temp_curves = [self.plot_temp.plot(pen=pg.mkPen(color=c, width=1.5)) for c in ['#00f0ff', '#ff5000', '#00e676', '#ffb700', '#d500f9', '#ffffff']]
        self.temp_overlay_curves = [self.plot_temp.plot(pen=pg.mkPen(color=c, width=1.0, style=Qt.PenStyle.DashLine)) for c in ['#00a2ff', '#ff1a00', '#00ff8c', '#ffea00', '#a200ff', '#e2e8f0']]
        graph_grid.addWidget(self.plot_temp, 2, 0)
        
        # Current consumption J1-J6
        self.plot_current = pg.PlotWidget(title="Actuator Drive Currents (Amps)")
        self.plot_current.showGrid(x=True, y=True, alpha=0.15)
        self.current_curves = [self.plot_current.plot(pen=pg.mkPen(color=c, width=1.5)) for c in ['#00f0ff', '#ff5000', '#00e676', '#ffb700', '#d500f9', '#ffffff']]
        self.current_overlay_curves = [self.plot_current.plot(pen=pg.mkPen(color=c, width=1.0, style=Qt.PenStyle.DashLine)) for c in ['#00a2ff', '#ff1a00', '#00ff8c', '#ffea00', '#a200ff', '#e2e8f0']]
        graph_grid.addWidget(self.plot_current, 2, 1)
        
        right_layout.addWidget(graph_box, stretch=3)
        
        # Logs List Widget
        log_box = QGroupBox("Cell Diagnostic Console Log")
        log_box_layout = QVBoxLayout(log_box)
        self.log_list = QListWidget()
        log_box_layout.addWidget(self.log_list)
        right_layout.addWidget(log_box, stretch=1)
        
        right_frame = QFrame()
        right_frame.setLayout(right_layout)
        right_frame.setFixedWidth(460)
        main_layout.addWidget(right_frame)

    def change_manual_control_target(self, index):
        """
        Switch which arm is manually controlled by the sliders and IK coordinates.
        """
        self.robot = self.welder_robot if index == 0 else self.loader_robot
        self.log_event(f"Manual override target switched to: {self.robot.arm_type} robot.")
        
        # Sync sliders and spinboxes with the newly targeted robot's configuration
        for i in range(6):
            self.sliders[i].blockSignals(True)
            self.spinboxes[i].blockSignals(True)
            
            low, high = self.robot.joint_limits[i]
            self.sliders[i].setRange(int(low), int(high))
            self.spinboxes[i].setRange(low, high)
            
            self.sliders[i].setValue(int(self.robot.joint_angles[i]))
            self.spinboxes[i].setValue(self.robot.joint_angles[i])
            
            self.sliders[i].blockSignals(False)
            self.spinboxes[i].blockSignals(False)

    def change_telemetry_focus(self, index):
        """
        Switches visual focus of telemetry graphs and circular gauges.
        """
        label_prefix = "WELDER" if index == 0 else ("LOADER" if index == 1 else "COMP")
        for i in range(6):
            self.rul_gauges[i].title = f"{label_prefix} J{i+1} RUL"
            self.rul_gauges[i].update()
            
        if index == 0:
            self.plot_torque.setTitle("Welder Joint Transmitted Torques (Nm)")
            self.plot_temp.setTitle("Welder Servo Motor Thermal Sensors (°C)")
            self.plot_current.setTitle("Welder Actuator Drive Currents (Amps)")
            # Hide overlay curves
            for curve in self.torque_overlay_curves + self.temp_overlay_curves + self.current_overlay_curves:
                curve.setData([], [])
        elif index == 1:
            self.plot_torque.setTitle("Loader Joint Transmitted Torques (Nm)")
            self.plot_temp.setTitle("Loader Servo Motor Thermal Sensors (°C)")
            self.plot_current.setTitle("Loader Actuator Drive Currents (Amps)")
            for curve in self.torque_overlay_curves + self.temp_overlay_curves + self.current_overlay_curves:
                curve.setData([], [])
        else:
            self.plot_torque.setTitle("Comparative Joint Torques (Welder=Solid, Loader=Dash)")
            self.plot_temp.setTitle("Comparative Motor Temperatures (Welder=Solid, Loader=Dash)")
            self.plot_current.setTitle("Comparative Drive Currents (Welder=Solid, Loader=Dash)")

    def sync_slider_spin(self, index, value, from_slider):
        if self.operation_mode != "MANUAL":
            return
            
        if from_slider:
            self.spinboxes[index].blockSignals(True)
            self.spinboxes[index].setValue(float(value))
            self.spinboxes[index].blockSignals(False)
        else:
            self.sliders[index].blockSignals(True)
            self.sliders[index].setValue(int(value))
            self.sliders[index].blockSignals(False)
            
        self.robot.joint_angles[index] = float(value)
        self.robot.update_joint_transforms()
        
    def trigger_ik_solve(self):
        if self.operation_mode != "MANUAL":
            return
            
        target = Vec3(
            self.ik_inputs[0].value(),
            self.ik_inputs[1].value(),
            self.ik_inputs[2].value()
        )
        self.robot.solve_ccd_ik(target)
        
        for i in range(6):
            self.sliders[i].blockSignals(True)
            self.spinboxes[i].blockSignals(True)
            self.sliders[i].setValue(int(self.robot.joint_angles[i]))
            self.spinboxes[i].setValue(self.robot.joint_angles[i])
            self.sliders[i].blockSignals(False)
            self.spinboxes[i].blockSignals(False)

    def change_system_mode(self, index):
        if index == 0:
            self.operation_mode = "MANUAL"
            self.lbl_status.setText("STATUS: TELEMETRY READY (IDLE)")
            self.lbl_status.setStyleSheet(f"color: {SAFE_GREEN}; font-weight: bold;")
            self.manual_box.setEnabled(True)
            self.ik_box.setEnabled(True)
            self.welding_mgr.stop_welding()
            self.log_event("Switched to MANUAL override mode.")
        else:
            self.operation_mode = "AUTO"
            self.lbl_status.setText("STATUS: COLLABORATIVE AUTOMATION CYCLE ACTIVE")
            self.lbl_status.setStyleSheet(f"color: {CYAN_GLOW}; font-weight: bold;")
            self.manual_box.setEnabled(False)
            self.ik_box.setEnabled(False)
            self.auto_step = "WAIT_FOR_PART"
            self.auto_timer = 0.0
            self.log_event("Switched to FULL AUTOMATED PRODUCTION cycle.")
            
    def trigger_estop(self):
        self.operation_mode = "ESTOP"
        self.lbl_status.setText("STATUS: EMERGENCY STOP (CELL LOCKED)")
        self.lbl_status.setStyleSheet(f"color: {EMERGENCY_RED}; font-size: 12px; font-weight: bold;")
        
        self.manual_box.setEnabled(False)
        self.ik_box.setEnabled(False)
        self.combo_mode.setEnabled(False)
        
        self.welding_mgr.stop_welding()
        self.log_event("EMERGENCY SHUTDOWN TRIGGERED! CELL LOCK ACTIVE.")
        self.db_logger.log_telemetry("ESTOP", "CRITICAL", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

    def trigger_manual_weld(self):
        if self.operation_mode != "MANUAL":
            return
        self.operation_mode = "MANUAL_WELD_SWEEP"
        self.auto_timer = 0.0
        self.log_event("Triggered manual weld seam sweep sequence.")
        
    def log_event(self, msg):
        t_str = time.strftime("[%H:%M:%S]")
        self.log_list.insertItem(0, f"{t_str} {msg}")
        self.db_logger.log_event(msg)

    def system_tick(self):
        dt = 0.033
        
        if self.operation_mode == "ESTOP":
            glow = int(127 + 128 * math.sin(self.auto_timer * 15.0))
            self.btn_estop.setStyleSheet(f"background-color: rgb({glow}, 0, 20); color: white; padding: 12px; font-size: 12px; border-radius: 4px;")
            self.auto_timer += dt
            self.update_telemetry_plots(dt, idle=True)
            self.render_ai_camera_view(None, 0.0)
            return

        conveyor_running = True
        if self.operation_mode == "AUTO":
            # State machine dictates conveyor velocity
            if self.auto_step not in ["WAIT_FOR_PART", "CONVEYOR_EXIT"]:
                conveyor_running = False
            
        self.sim.update(dt, conveyor_running)
        
        if self.operation_mode == "AUTO":
            self.run_automation_state_machine(dt)
        elif self.operation_mode == "MANUAL_WELD_SWEEP":
            self.run_manual_weld_sweep_sequence(dt)
            
        # Update welding sparks centered at welding tip (welder arm)
        tcp_pos = self.welder_robot.get_tcp_world_pos()
        self.welding_mgr.update(dt, tcp_pos)
        
        self.update_telemetry_plots(dt)
        self.run_ai_weld_detection_feed()
        
    def run_automation_state_machine(self, dt):
        """
        9-State synchronized collaborative automation state machine.
        Coordinated loader picks raw plates, jig table clamps them, welder lays cooling bead, loader unloads back to belt.
        """
        self.auto_timer += dt
        
        if self.auto_step == "WAIT_FOR_PART":
            # Wait for raw part to arrive at pick point on the conveyor (Y = -2.0)
            target = None
            for wp in self.sim.workpieces:
                if -2.15 < wp.node.get_y() < -1.85 and not wp.weld_completed and not hasattr(wp, 'loader_picked'):
                    target = wp
                    break
                    
            if target:
                self.active_workpiece = target
                self.auto_step = "LOADER_PICK_APPROACH"
                self.auto_timer = 0.0
                self.log_event("Raw workpiece detected at inlet pick zone. Halting conveyor.")
                
        elif self.auto_step == "LOADER_PICK_APPROACH":
            # Loader arm reaches down to pick workpiece from the belt
            progress = min(self.auto_timer / 1.0, 1.0)
            pick_pos = Vec3(-1.8, self.active_workpiece.node.get_y(), 0.45)
            current_target = self.loader_home_target * (1.0 - progress) + pick_pos * progress
            self.loader_robot.solve_ccd_ik(current_target)
            self.loader_robot.set_gripper_close(0.0) # Jaws fully open
            
            if progress >= 1.0:
                self.auto_step = "LOADER_PICK_CLAMP"
                self.auto_timer = 0.0
                self.log_event("Loader Arm aligned. Activating pneumatic gripper jaws.")
                
        elif self.auto_step == "LOADER_PICK_CLAMP":
            # Jaws close over 0.5s
            close_pct = min(self.auto_timer / 0.5, 1.0)
            self.loader_robot.set_gripper_close(close_pct)
            
            if close_pct >= 1.0:
                # Parent the workpiece to loader gripper TCP node
                self.active_workpiece.node.reparent_to(self.loader_robot.tcp_node)
                self.active_workpiece.node.set_pos(0, 0, 0)
                self.active_workpiece.node.set_hpr(0, 90, 0) # align with gripper jaws
                
                self.auto_step = "LOADER_TRANSFER_TO_JIG"
                self.auto_timer = 0.0
                self.log_event("Workpiece secured. Loading central welding jig fixture.")
                
        elif self.auto_step == "LOADER_TRANSFER_TO_JIG":
            # Loader moves piece to the central Jig Table
            progress = min(self.auto_timer / 1.5, 1.0)
            pick_pos = Vec3(-1.8, -2.0, 0.45)
            jig_pos = Vec3(0.0, 0.4, 0.46)
            current_target = pick_pos * (1.0 - progress) + jig_pos * progress
            self.loader_robot.solve_ccd_ik(current_target)
            
            if progress >= 1.0:
                self.auto_step = "JIG_CLAMPING"
                self.auto_timer = 0.0
                self.log_event("Workpiece seated. Engaging table locator clamps.")
                
        elif self.auto_step == "JIG_CLAMPING":
            # Close Jig clamps, open gripper jaws
            clamp_pct = min(self.auto_timer / 0.5, 1.0)
            self.sim.set_jig_clamps(clamp_pct)
            self.loader_robot.set_gripper_close(1.0 - clamp_pct)
            
            if clamp_pct >= 1.0:
                # Reparent workpiece back to the Jig Table
                self.active_workpiece.node.reparent_to(self.sim.jig_table)
                self.active_workpiece.node.set_pos(0.0, 0.0, 0.04) # seated flat on table surface
                self.active_workpiece.node.set_hpr(0, -90, 0)
                
                self.auto_step = "LOADER_STANDBY"
                self.auto_timer = 0.0
                
        elif self.auto_step == "LOADER_STANDBY":
            # Loader retracts to safe standby home position
            progress = min(self.auto_timer / 1.0, 1.0)
            jig_pos = Vec3(0.0, 0.4, 0.46)
            current_target = jig_pos * (1.0 - progress) + self.loader_home_target * progress
            self.loader_robot.solve_ccd_ik(current_target)
            
            if progress >= 1.0:
                self.auto_step = "WELDER_APPROACH"
                self.auto_timer = 0.0
                self.log_event("Jig table locked. Loader retracted. Welder entering seam start.")
                
        elif self.auto_step == "WELDER_APPROACH":
            # Welder swings to weld seam start
            progress = min(self.auto_timer / 1.2, 1.0)
            self.weld_start = Vec3(-0.24, 0.4, 0.48)
            self.weld_end = Vec3(0.24, 0.4, 0.48)
            current_target = self.welder_home_target * (1.0 - progress) + self.weld_start * progress
            self.welder_robot.solve_ccd_ik(current_target)
            
            if progress >= 1.0:
                self.auto_step = "WELDING"
                self.auto_timer = 0.0
                self.welding_mgr.start_welding(self.weld_start, self.active_workpiece.node)
                self.log_event("Welder aligned. Electrical arc active. Depositing cooling beads.")
                
        elif self.auto_step == "WELDING":
            # Sweep along gap seam
            progress = min(self.auto_timer / 3.0, 1.0)
            current_target = self.weld_start * (1.0 - progress) + self.weld_end * progress
            self.welder_robot.solve_ccd_ik(current_target)
            self.active_workpiece.weld_progress = progress
            
            if progress >= 1.0:
                self.welding_mgr.stop_welding()
                self.active_workpiece.weld_completed = True
                self.auto_step = "WELDER_RETRACT"
                self.auto_timer = 0.0
                self.log_event("Weld bead complete. Extinguishing arc. Welder returning home.")
                
        elif self.auto_step == "WELDER_RETRACT":
            # Welder moves back to standby home
            progress = min(self.auto_timer / 1.2, 1.0)
            current_target = self.weld_end * (1.0 - progress) + self.welder_home_target * progress
            self.welder_robot.solve_ccd_ik(current_target)
            
            if progress >= 1.0:
                self.auto_step = "JIG_UNCLAMPING"
                self.auto_timer = 0.0
                self.log_event("Welder in safe home clearance. Releasing table clamps.")
                
        elif self.auto_step == "JIG_UNCLAMPING":
            # Open Jig Clamps, Loader approaches Jig to grab finished part
            progress = min(self.auto_timer / 1.0, 1.0)
            jig_pos = Vec3(0.0, 0.4, 0.46)
            current_target = self.loader_home_target * (1.0 - progress) + jig_pos * progress
            self.loader_robot.solve_ccd_ik(current_target)
            
            clamp_pct = max(0.0, 1.0 - (self.auto_timer / 0.5))
            self.sim.set_jig_clamps(clamp_pct)
            
            if progress >= 1.0:
                self.auto_step = "LOADER_GRAB_FINISHED"
                self.auto_timer = 0.0
                
        elif self.auto_step == "LOADER_GRAB_FINISHED":
            # Close Loader jaws on the finished plate
            close_pct = min(self.auto_timer / 0.5, 1.0)
            self.loader_robot.set_gripper_close(close_pct)
            
            if close_pct >= 1.0:
                # Parent workpiece back to loader TCP
                self.active_workpiece.node.reparent_to(self.loader_robot.tcp_node)
                self.active_workpiece.node.set_pos(0, 0, 0)
                self.active_workpiece.node.set_hpr(0, 90, 0)
                
                self.auto_step = "LOADER_UNLOAD_TO_CONVEYOR"
                self.auto_timer = 0.0
                self.log_event("Finished workpiece secured. Transferring to conveyor outlet.")
                
        elif self.auto_step == "LOADER_UNLOAD_TO_CONVEYOR":
            # Loader moves hot part from Jig to conveyor landing zone
            progress = min(self.auto_timer / 1.5, 1.0)
            jig_pos = Vec3(0.0, 0.4, 0.46)
            land_pos = Vec3(-1.8, 0.5, 0.45)
            current_target = jig_pos * (1.0 - progress) + land_pos * progress
            self.loader_robot.solve_ccd_ik(current_target)
            
            if progress >= 1.0:
                self.auto_step = "LOADER_RELEASE"
                self.auto_timer = 0.0
                
        elif self.auto_step == "LOADER_RELEASE":
            # Open Loader jaws to drop part on the belt
            progress = min(self.auto_timer / 0.5, 1.0)
            self.loader_robot.set_gripper_close(1.0 - progress)
            
            if progress >= 1.0:
                # Reparent to the conveyor belt node
                self.active_workpiece.node.reparent_to(self.sim.sensor_emitter.get_parent())
                self.active_workpiece.node.set_pos(0.0, 0.5, 0.05) # seated on the belt
                self.active_workpiece.node.set_hpr(0, -90, 0)
                self.active_workpiece.loader_picked = True
                
                self.auto_step = "LOADER_RETURN_HOME"
                self.auto_timer = 0.0
                self.log_event("Workpiece seated on conveyor belt. Restarting line rollers.")
                
        elif self.auto_step == "LOADER_RETURN_HOME":
            # Loader retracts to home, conveyor restarts moving piece to outlet
            progress = min(self.auto_timer / 1.0, 1.0)
            land_pos = Vec3(-1.8, 0.5, 0.45)
            current_target = land_pos * (1.0 - progress) + self.loader_home_target * progress
            self.loader_robot.solve_ccd_ik(current_target)
            
            if progress >= 1.0:
                self.active_workpiece = None
                self.auto_step = "WAIT_FOR_PART"
                self.auto_timer = 0.0

    def run_manual_weld_sweep_sequence(self, dt):
        """
        Sweeps the welder robot through a manual test joint seam.
        """
        self.auto_timer += dt
        w_start = Vec3(-0.25, 0.4, 0.48)
        w_end = Vec3(0.25, 0.4, 0.48)
        
        if self.auto_timer < 1.0:
            prog = self.auto_timer / 1.0
            cur = self.welder_home_target * (1.0 - prog) + w_start * prog
            self.welder_robot.solve_ccd_ik(cur)
        elif self.auto_timer < 4.0:
            if not self.welding_mgr.is_welding:
                self.welding_mgr.start_welding(w_start, self.sim.root)
            prog = (self.auto_timer - 1.0) / 3.0
            cur = w_start * (1.0 - prog) + w_end * prog
            self.welder_robot.solve_ccd_ik(cur)
        elif self.auto_timer < 5.0:
            self.welding_mgr.stop_welding()
            prog = (self.auto_timer - 4.0) / 1.0
            cur = w_end * (1.0 - prog) + self.welder_home_target * prog
            self.welder_robot.solve_ccd_ik(cur)
        else:
            self.operation_mode = "MANUAL"
            self.log_event("Manual weld sweep completed.")

    def update_telemetry_plots(self, dt, idle=False):
        self.time_history.pop(0)
        new_t = self.time_history[-1] + dt
        self.time_history.append(new_t)
        
        weld_factor = 3.5 if (self.welding_mgr.is_welding and not idle) else 0.2
        motion_factor_welder = 1.0 if (self.operation_mode == "AUTO" and self.auto_step == "WELDING") else (0.4 if not idle else 0.0)
        motion_factor_loader = 1.0 if (self.operation_mode == "AUTO" and "LOADER" in self.auto_step) else (0.3 if not idle else 0.0)
        
        vibe_val = random.uniform(0.02, 0.08)
        if weld_factor > 1.0:
            vibe_val += random.uniform(0.9, 1.9)
        elif motion_factor_welder > 0.4 or motion_factor_loader > 0.3:
            vibe_val += random.uniform(0.1, 0.35)
            
        self.vibe_history.pop(0)
        self.vibe_history.append(vibe_val)
        self.vibe_curve.setData(self.time_history, self.vibe_history)
        
        # Calculate datasets for both arms
        for i in range(6):
            # WELDER
            t_delta_w = abs(self.welder_robot.joint_angles[i]) * 0.05 if not idle else 0.0
            torque_w = (math.sin(new_t * (i+1)) * 5.0 + random.uniform(-1.0, 1.0)) * motion_factor_welder + (weld_factor * 8.0 if i < 3 else 0.0)
            current_w = abs(torque_w) * 0.25 + (weld_factor * 1.5 if i < 3 else 0.0) + (0.5 if not idle else 0.0)
            
            temp_w = self.telemetry_history_welder['temperature'][i][-1]
            if weld_factor > 1.0 and i < 3:
                temp_w += dt * random.uniform(1.4, 2.8)
            elif motion_factor_welder > 0.0:
                temp_w += dt * random.uniform(0.12, 0.32)
            else:
                temp_w -= dt * (temp_w - 35.0) * 0.035
            temp_w = min(temp_w, 95.0)
            
            self.telemetry_history_welder['torque'][i].pop(0)
            self.telemetry_history_welder['torque'][i].append(torque_w)
            
            self.telemetry_history_welder['current'][i].pop(0)
            self.telemetry_history_welder['current'][i].append(current_w)
            
            self.telemetry_history_welder['temperature'][i].pop(0)
            self.telemetry_history_welder['temperature'][i].append(temp_w)
            
            # LOADER
            t_delta_l = abs(self.loader_robot.joint_angles[i]) * 0.05 if not idle else 0.0
            torque_l = (math.cos(new_t * (i+1)) * 4.5 + random.uniform(-0.8, 0.8)) * motion_factor_loader
            current_l = abs(torque_l) * 0.22 + (0.4 if not idle else 0.0)
            
            temp_l = self.telemetry_history_loader['temperature'][i][-1]
            if motion_factor_loader > 0.0:
                temp_l += dt * random.uniform(0.15, 0.38)
            else:
                temp_l -= dt * (temp_l - 32.0) * 0.035
            temp_l = min(temp_l, 80.0)
            
            self.telemetry_history_loader['torque'][i].pop(0)
            self.telemetry_history_loader['torque'][i].append(torque_l)
            
            self.telemetry_history_loader['current'][i].pop(0)
            self.telemetry_history_loader['current'][i].append(current_l)
            
            self.telemetry_history_loader['temperature'][i].pop(0)
            self.telemetry_history_loader['temperature'][i].append(temp_l)
            
        # Draw focused/overlay curves
        focus_index = self.combo_telemetry_filter.currentIndex()
        
        for i in range(6):
            if focus_index == 0: # WELDER FOCUS
                self.torque_curves[i].setData(self.time_history, self.telemetry_history_welder['torque'][i])
                self.temp_curves[i].setData(self.time_history, self.telemetry_history_welder['temperature'][i])
                self.current_curves[i].setData(self.time_history, self.telemetry_history_welder['current'][i])
                
                rul_val = 100.0 - (self.telemetry_history_welder['temperature'][i][-1] - 35.0) * 0.95 - (vibe_val * 0.25)
                self.rul_gauges[i].set_value(max(0.0, min(100.0, rul_val)))
                
            elif focus_index == 1: # LOADER FOCUS
                self.torque_curves[i].setData(self.time_history, self.telemetry_history_loader['torque'][i])
                self.temp_curves[i].setData(self.time_history, self.telemetry_history_loader['temperature'][i])
                self.current_curves[i].setData(self.time_history, self.telemetry_history_loader['current'][i])
                
                rul_val = 100.0 - (self.telemetry_history_loader['temperature'][i][-1] - 32.0) * 1.1 - (vibe_val * 0.2)
                self.rul_gauges[i].set_value(max(0.0, min(100.0, rul_val)))
                
            else: # COMPARATIVE OVERLAY
                # Welder curves = solid line curves
                self.torque_curves[i].setData(self.time_history, self.telemetry_history_welder['torque'][i])
                self.temp_curves[i].setData(self.time_history, self.telemetry_history_welder['temperature'][i])
                self.current_curves[i].setData(self.time_history, self.telemetry_history_welder['current'][i])
                
                # Loader curves = dashed overlay curves
                self.torque_overlay_curves[i].setData(self.time_history, self.telemetry_history_loader['torque'][i])
                self.temp_overlay_curves[i].setData(self.time_history, self.telemetry_history_loader['temperature'][i])
                self.current_overlay_curves[i].setData(self.time_history, self.telemetry_history_loader['current'][i])
                
                rul_val = 100.0 - (self.telemetry_history_welder['temperature'][i][-1] - 35.0) * 0.95
                self.rul_gauges[i].set_value(max(0.0, min(100.0, rul_val)))

        if random.random() < 0.035 and not idle:
            self.db_logger.log_telemetry(
                "AUTO" if self.operation_mode == "AUTO" else "MANUAL",
                "STABLE",
                self.welder_robot.joint_angles[0],
                self.welder_robot.joint_angles[1],
                self.welder_robot.joint_angles[2],
                self.welder_robot.joint_angles[3],
                self.welder_robot.joint_angles[4],
                self.welder_robot.joint_angles[5]
            )

    def run_ai_weld_detection_feed(self):
        """
        OpenCV Video feed overlay showing synthetic weld camera close-up with real-time deep learning defect classification bounding boxes.
        """
        t_now = self.time_history[-1]
        
        # Base plate
        frame = np.ones((160, 240, 3), dtype=np.uint8) * 38
        
        # Add metallic surface scratch noise (linear grain lines)
        for y in range(0, 160, 4):
            frame[y:y+2, :, :] = 42 # Surface rolling marks
            
        # Draw central heavy dark seam gap track
        cv2.line(frame, (0, 80), (240, 80), (12, 14, 16), 10)
        
        # Horizontal scrolling grain marks (rolling sheet simulator)
        grain_shift = int(t_now * 45) % 240
        for gx in range(grain_shift - 240, 240, 60):
            cv2.line(frame, (gx, 40), (gx + 15, 60), (46, 48, 52), 1)
            cv2.line(frame, (gx + 30, 100), (gx + 45, 120), (46, 48, 52), 1)
            
        is_welding = self.welding_mgr.is_welding
        defect_class = "STDBY"
        conf = 0.0
        
        if is_welding:
            # Welding arc blinding core glow
            cv2.circle(frame, (120, 80), 22, (0, 160, 255), -1) # Glowing outer pool
            cv2.circle(frame, (120, 80), 12, (200, 240, 255), -1) # Super hot arc core
            
            # Ripple welds to the left (already cooling beads)
            for rx in range(15, 110, 15):
                cv2.circle(frame, (rx, 80), 9, (65, 70, 75), -1)
                cv2.circle(frame, (rx - 2, 80), 8, (48, 51, 55), -1) # Ripple ripple
                
            # Synthesize cyclic defect anomalies to make AI feel active
            cycle_phase = int(t_now) % 16
            if cycle_phase > 12:
                defect_class = "CRACK DETECTED"
                conf = 0.88 + 0.1 * random.random()
                
                # Draw dynamic red defect overlays (crack lines)
                cv2.line(frame, (50, 77), (70, 83), (0, 0, 255), 2)
                cv2.line(frame, (65, 80), (80, 75), (0, 0, 255), 2)
            else:
                defect_class = "GOOD BEAD"
                conf = 0.96 + 0.03 * random.random()
        else:
            # Standby feed: fully cooled ripple beads
            for rx in range(15, 230, 18):
                cv2.circle(frame, (rx, 80), 9, (60, 62, 65), -1)
                cv2.circle(frame, (rx - 2, 80), 8, (42, 45, 48), -1)
            defect_class = "STDBY"
            conf = 1.0
            
        # Draw sci-fi scanlines
        scan_y = int(t_now * 80) % 160
        cv2.line(frame, (0, scan_y), (240, scan_y), (100, 240, 0), 1) # Green scanning beam
        
        # Render overlays
        self.render_ai_camera_view(frame, conf, defect_class, is_welding)
 
    def render_ai_camera_view(self, frame, confidence, class_name="GOOD", is_welding=False):
        if frame is None:
            frame = np.zeros((160, 240, 3), dtype=np.uint8)
            cv2.putText(frame, "CAM LINK OFFLINE", (25, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
            class_name = "OFFLINE"
            confidence = 0.0
        else:
            # Glowing targets overlay
            box_color = (0, 240, 0) # Safe green
            if class_name == "CRACK DETECTED":
                box_color = (0, 0, 255) # Red danger
                if random.random() < 0.08:
                    self.log_event("AI ANALYTICS: SURFACE DEFECT IDENTIFIED! DATA FLAGGED.")
            elif is_welding:
                box_color = (255, 220, 0) # Cyan tracking
                
            # L-Corner Target Reticles
            h_len = 12
            cv2.line(frame, (20, 35), (20 + h_len, 35), box_color, 1)
            cv2.line(frame, (20, 35), (20, 35 + h_len), box_color, 1)
            
            cv2.line(frame, (220, 35), (220 - h_len, 35), box_color, 1)
            cv2.line(frame, (220, 35), (220, 35 + h_len), box_color, 1)
            
            cv2.line(frame, (20, 125), (20 + h_len, 125), box_color, 1)
            cv2.line(frame, (20, 125), (20, 125 - h_len), box_color, 1)
            
            cv2.line(frame, (220, 125), (220 - h_len, 125), box_color, 1)
            cv2.line(frame, (220, 125), (220, 125 - h_len), box_color, 1)
            
            # HUD text inside OpenCV frame
            cv2.putText(frame, "LENS: COAXIAL SEAM CAM", (12, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (180, 180, 180), 1)
            cv2.putText(frame, f"AI PROC: {class_name} ({confidence*100:.1f}%)", (25, 142), cv2.FONT_HERSHEY_SIMPLEX, 0.4, box_color, 1)
            
        # Convert frame matrix to PyQt QImage
        rgb_img = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        h, w, ch = rgb_img.shape
        bytes_per_line = ch * w
        q_img = QImage(rgb_img.data, w, h, bytes_per_line, QImage.Format.Format_RGB888)
        
        scaled_pixmap = QPixmap.fromImage(q_img).scaled(
            self.cam_feed_lbl.width(),
            self.cam_feed_lbl.height(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation
        )
        self.cam_feed_lbl.setPixmap(scaled_pixmap)
        
    def closeEvent(self, event):
        self.ui_timer.stop()
        self.viewport.closeEvent(event)
        super().closeEvent(event)
