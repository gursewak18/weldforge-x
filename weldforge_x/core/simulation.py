import math
import numpy as np
from panda3d.core import NodePath, Vec3, Vec4
from weldforge_x.core.robotics import create_cylinder, create_sphere, DARK_GRAY, KUKA_ORANGE, SLATE_GRAY

class Workpiece:
    def __init__(self, parent_node, initial_x, initial_y, initial_z):
        self.node = parent_node.attach_new_node("workpiece")
        self.node.set_pos(initial_x, initial_y, initial_z)
        
        # Build a highly detailed industrial workpiece: steel carrier plate with dual side brackets
        plate = self.node.attach_new_node(create_cylinder(0.25, 0.04, color=SLATE_GRAY))
        plate.look_at(0, 0, 1) # Lay flat
        
        # Flange border accent rings
        border = self.node.attach_new_node(create_cylinder(0.26, 0.015, color=DARK_GRAY))
        border.look_at(0, 0, 1)
        border.set_pos(0, 0, 0.01)
        
        # Heavy central joint rail representing the weld track
        joint = self.node.attach_new_node(create_cylinder(0.025, 0.45, color=SLATE_GRAY))
        joint.set_pos(0, 0, 0.04)
        joint.set_hpr(0, -90, 0) # Lay horizontally along Y-axis
        
        # Side clamp bolts (mock fixtures)
        for dx, dy in [(-0.16, -0.16), (-0.16, 0.16), (0.16, -0.16), (0.16, 0.16)]:
            clamp = self.node.attach_new_node(create_cylinder(0.02, 0.03, color=DARK_GRAY))
            clamp.set_pos(dx, dy, 0.02)
            clamp.look_at(dx, dy, 1.0)
            
        self.weld_completed = False
        self.weld_progress = 0.0
        self.cool_down_age = 0.0

class FactorySimulation:
    def __init__(self, engine):
        self.engine = engine
        self.root = engine.render.attach_new_node("factory_simulation")
        
        # Lists for dynamic assets
        self.workpieces = []
        self.rollers = []
        self.agv = None
        self.laser_beam = None
        
        # Safety systems
        self.safety_status = "SECURED"
        
        self.build_factory_elements()
        
    def build_factory_elements(self):
        """
        Construct high-fidelity industrial factory environment procedurally.
        """
        # 1. Main Conveyor Belt
        # A long steel track centered along Y-axis, offset slightly from the robot center
        conveyor = self.root.attach_new_node("conveyor_belt")
        conveyor.set_pos(-1.8, 0, 0.4) # Shifted to the side of the loader robot
        
        # Flat belt slide plate
        belt_plate = conveyor.attach_new_node(create_cylinder(0.29, 10.0, color=DARK_GRAY))
        belt_plate.look_at(0, 1, 0) # Lay along Y axis
        belt_plate.set_scale(1.0, 1.0, 0.08) # Flatten Z-axis to make it a flat track
        
        # Conveyor heavy steel side frames (Aluminum profile rails)
        side_rail_left = conveyor.attach_new_node(create_cylinder(0.04, 10.0, color=SLATE_GRAY))
        side_rail_left.set_pos(-0.31, 0, 0.02)
        side_rail_left.look_at(-0.31, 10.0, 0.02)
        
        side_rail_right = conveyor.attach_new_node(create_cylinder(0.04, 10.0, color=SLATE_GRAY))
        side_rail_right.set_pos(0.31, 0, 0.02)
        side_rail_right.look_at(0.31, 10.0, 0.02)
        
        # Render animated rotating rollers (conveyor rollers) underneath the belt surface
        self.rollers = []
        for y_pos in np.linspace(-4.8, 4.8, 14):
            roller = conveyor.attach_new_node(create_cylinder(0.04, 0.58, color=SLATE_GRAY))
            roller.set_pos(0, y_pos, 0.0)
            roller.set_hpr(90, 0, 0) # Mount horizontally across belt
            self.rollers.append(roller)
            
        # Conveyor structural T-slot support legs with cross-bracing and rubber feet
        for y_leg in [-4.5, -1.5, 1.5, 4.5]:
            leg_post = conveyor.attach_new_node(create_cylinder(0.05, 0.4, color=SLATE_GRAY))
            leg_post.set_pos(0, y_leg, -0.4)
            
            # Mounting feet base plates
            foot = leg_post.attach_new_node(create_cylinder(0.12, 0.02, color=DARK_GRAY))
            foot.set_pos(0, 0, 0)
            foot.look_at(0, 0, -1)
            
            # 45-degree angle bracing bars
            brace1 = leg_post.attach_new_node(create_cylinder(0.02, 0.2, color=DARK_GRAY))
            brace1.set_pos(0, 0, 0.2)
            brace1.set_hpr(0, 45, 0)
            
            brace2 = leg_post.attach_new_node(create_cylinder(0.02, 0.2, color=DARK_GRAY))
            brace2.set_pos(0, 0, 0.2)
            brace2.set_hpr(0, -45, 0)
            
        # 2. Automated Guided Vehicle (AGV) in the background
        self.agv = self.root.attach_new_node("agv_vehicle")
        self.agv.set_pos(-3.5, -6.0, 0.15) # Far left side
        
        # Procedural AGV chassis (Premium warning yellow with hazard patterns)
        agv_chassis = self.agv.attach_new_node(create_cylinder(0.35, 0.22, color=Vec4(0.9, 0.8, 0.0, 1.0)))
        agv_chassis.set_scale(1.0, 1.3, 1.0) # Oval scale
        
        # Dark top electronics/battery lid
        agv_lid = self.agv.attach_new_node(create_cylinder(0.33, 0.05, color=DARK_GRAY))
        agv_lid.set_pos(0, 0, 0.22)
        agv_lid.set_scale(1.0, 1.3, 1.0)
        
        # Four tiny dark wheels
        for dx, dy in [(-0.28, -0.32), (-0.28, 0.32), (0.28, -0.32), (0.28, 0.32)]:
            wheel = self.agv.attach_new_node(create_cylinder(0.09, 0.05, color=DARK_GRAY))
            wheel.set_pos(dx, dy, -0.07)
            wheel.look_at(dx + 1.0, dy, -0.07)
            
        # Flashing safety warning beacon on AGV
        self.agv_beacon = self.agv.attach_new_node(create_cylinder(0.05, 0.08, color=Vec4(1.0, 0.8, 0.0, 1.0)))
        self.agv_beacon.set_pos(0, 0, 0.27)
        
        # 3. Active Industrial Photo-Eye Proximity Laser Sensor
        # Projects a green beam across the belt, turning red when interrupted by a workpiece
        self.sensor_emitter = conveyor.attach_new_node(create_cylinder(0.04, 0.08, color=SLATE_GRAY))
        self.sensor_emitter.set_pos(0.42, 2.0, 0.1)
        self.sensor_emitter.look_at(-0.42, 2.0, 0.1)
        
        self.sensor_receiver = conveyor.attach_new_node(create_cylinder(0.04, 0.08, color=SLATE_GRAY))
        self.sensor_receiver.set_pos(-0.42, 2.0, 0.1)
        self.sensor_receiver.look_at(0.42, 2.0, 0.1)
        
        # The glowing laser beam cylinder
        self.laser_beam = conveyor.attach_new_node(create_cylinder(0.008, 0.84, color=Vec4(0.0, 1.0, 0.0, 0.7)))
        self.laser_beam.set_pos(0.42, 2.0, 0.1)
        self.laser_beam.look_at(-0.42, 2.0, 0.1)
        self.laser_beam.set_light_off() # Self-illuminated glow
        
        # 4. Power & Control Cabinet (Electronics unit in background corner)
        self.cabinet = self.root.attach_new_node("control_cabinet")
        self.cabinet.set_pos(-2.6, -2.8, 0.0)
        
        # Steel cabinet chassis
        cabinet_body = self.cabinet.attach_new_node(create_cylinder(0.35, 1.3, color=DARK_GRAY))
        cabinet_body.set_scale(1.2, 0.7, 1.0) # Scaled as an upright rectangular unit
        
        # Glowing green status LEDs on panel
        for offset_z in [1.0, 1.1, 1.2]:
            led = self.cabinet.attach_new_node(create_sphere(0.025, color=Vec4(0.0, 0.9, 0.3, 1.0)))
            led.set_pos(0.2, 0.36, offset_z)
            led.set_light_off()
            
        # 5. Heavy Steel Mesh Safety Fencing surrounding cell (U-Shape)
        fence_poles = [
            (-2.2, -3.2), (-2.2, 3.2),
            (2.8, -3.2), (2.8, 3.2),
            (-3.2, 0.0), (3.2, 0.0)
        ]
        
        # Yellow fence boundary posts
        for idx, (px, py) in enumerate(fence_poles):
            post = self.root.attach_new_node(create_cylinder(0.06, 1.35, color=Vec4(0.85, 0.8, 0.0, 1.0)))
            post.set_pos(px, py, 0.0)
            
            # Post warning beacon at top
            beacon = post.attach_new_node(create_sphere(0.04, color=Vec4(0.0, 0.9, 0.3, 1.0))) # Green safe beacon
            beacon.set_pos(0, 0, 1.35)
            beacon.set_light_off()
            
            # Add dynamic guard rail profiles between posts to mock mesh fencing
            if idx % 2 == 0:
                rail = post.attach_new_node(create_cylinder(0.02, 3.5, color=SLATE_GRAY))
                rail.set_pos(0, 0, 0.6)
                rail.set_hpr(0, 90, 0)
                
                rail2 = post.attach_new_node(create_cylinder(0.02, 3.5, color=SLATE_GRAY))
                rail2.set_pos(0, 0, 1.1)
                rail2.set_hpr(0, 90, 0)
                
        # 6. Spawn initial workpieces on conveyor belt
        # Welding station centers at Y = 0 on the conveyor
        self.workpieces.append(Workpiece(conveyor, 0, -4.5, 0.05)) # Loading zone
        self.workpieces.append(Workpiece(conveyor, 0, 0.0, 0.05))  # Active weld zone
        self.workpieces.append(Workpiece(conveyor, 0, 4.5, 0.05))  # Unloading zone
        
        # 7. High-Fidelity Pneumatic Welding Jig Table [NEW]
        self.jig_table = self.root.attach_new_node("welding_jig_table")
        self.jig_table.set_pos(0.0, 0.4, 0.4)
        
        # Steel top plate
        jig_plate = self.jig_table.attach_new_node(create_cylinder(0.35, 0.06, color=DARK_GRAY))
        jig_plate.look_at(0, 0.4, 1.0) # Lay flat
        
        # Heavy steel base stand
        jig_stand = self.jig_table.attach_new_node(create_cylinder(0.12, 0.4, color=SLATE_GRAY))
        jig_stand.set_pos(0, 0, -0.4)
        
        # Clamping pivots
        self.clamp_left_pivot = self.jig_table.attach_new_node("clamp_left_pivot")
        self.clamp_left_pivot.set_pos(-0.25, 0.0, 0.03)
        
        # Left lever arms
        clamp_arm1 = self.clamp_left_pivot.attach_new_node(create_cylinder(0.02, 0.1, color=DARK_GRAY))
        clamp_arm1.set_hpr(0, 90, 0) # Orient horizontal cylinder
        clamp_pad1 = clamp_arm1.attach_new_node(create_cylinder(0.03, 0.04, color=Vec4(0.85, 0.8, 0.0, 1.0)))
        clamp_pad1.set_pos(0, 0, 0.1)
        
        self.clamp_right_pivot = self.jig_table.attach_new_node("clamp_right_pivot")
        self.clamp_right_pivot.set_pos(0.24, 0.0, 0.03)
        
        # Right lever arms
        clamp_arm2 = self.clamp_right_pivot.attach_new_node(create_cylinder(0.02, 0.1, color=DARK_GRAY))
        clamp_arm2.set_hpr(0, -90, 0) # Orient horizontal cylinder
        clamp_pad2 = clamp_arm2.attach_new_node(create_cylinder(0.03, 0.04, color=Vec4(0.85, 0.8, 0.0, 1.0)))
        clamp_pad2.set_pos(0, 0, 0.1)
        
        self.jig_clamp_pct = 0.0
        self.set_jig_clamps(0.0)
        
        # State tracking variables
        self.agv_t = 0.0
        
    def set_jig_clamps(self, pct):
        """
        Adjust table pneumatic hold-down clamps percentage (0.0 = fully open, 1.0 = fully clamped).
        """
        self.jig_clamp_pct = max(0.0, min(1.0, pct))
        # Left clamp swings in pitch
        self.clamp_left_pivot.set_p(-55.0 * (1.0 - self.jig_clamp_pct))
        # Right clamp swings in pitch (opposite direction)
        self.clamp_right_pivot.set_p(55.0 * (1.0 - self.jig_clamp_pct))
        
    def update(self, dt, conveyor_running=True):
        """
        Perform high-fidelity physical animation frames for rollers, AGV, and proximity sensors.
        """
        # 1. Update AGV back-and-forth movement oscillation
        self.agv_t += dt * 0.45
        y_pos = -6.0 + 12.0 * (0.5 + 0.5 * math.sin(self.agv_t))
        self.agv.set_y(y_pos)
        
        # Safety warning flash beacon logic
        beacon_glow = 0.5 + 0.5 * math.sin(self.agv_t * 9.0)
        self.agv_beacon.set_color(Vec4(1.0, 0.85 * beacon_glow, 0.0, 1.0))
        
        # 2. Spin conveyor rollers continuously when belt is moving
        if conveyor_running:
            # Roller rotational velocity matched to conveyor speed (0.8 units/sec)
            roller_rot_speed = 360.0 * 0.8 / (2.0 * math.pi * 0.04) # deg/sec
            for roller in self.rollers:
                roller.set_h(roller.get_h() + roller_rot_speed * dt)
                
        # 3. Dynamic Laser Proximity Sensor beam logic
        # Inspect if any workpiece intersects the photo-eye sensor axis (Y is close to 2.0)
        sensor_interrupted = False
        for wp in self.workpieces:
            # Check Y-axis bounds of metal plates crossing Y=2.0 (inspection station)
            if 1.78 < wp.node.get_y() < 2.22:
                sensor_interrupted = True
                break
                
        # Update laser color (Green = Clear, Glowing Red = Part Interrupted/Aligned)
        if sensor_interrupted:
            self.laser_beam.set_color(Vec4(1.0, 0.0, 0.0, 1.0))
        else:
            self.laser_beam.set_color(Vec4(0.0, 1.0, 0.0, 0.7))
            
        # 4. Advance conveyor workpieces
        if conveyor_running:
            conveyor_speed = 0.8 # Units per second
            for wp in self.workpieces:
                wp.node.set_y(wp.node.get_y() + conveyor_speed * dt)
                
                # Recycle plates once they fall off the track (Y > 5.0)
                if wp.node.get_y() > 5.0:
                    wp.node.set_y(-5.0) # Loop back to starting zone
                    wp.weld_completed = False
                    wp.weld_progress = 0.0
                    wp.cool_down_age = 0.0
                    wp.node.set_color(Vec4(1.0, 1.0, 1.0, 1.0))
