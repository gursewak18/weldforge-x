import math
from panda3d.core import (
    NodePath,
    Vec3,
    Vec4,
    Geom,
    GeomNode,
    GeomVertexData,
    GeomVertexFormat,
    GeomVertexWriter,
    GeomTriangles,
    LRotationf
)

# KUKA Color Palette
KUKA_ORANGE = Vec4(1.0, 0.31, 0.0, 1.0)
SLATE_GRAY = Vec4(0.2, 0.22, 0.25, 1.0)
DARK_GRAY = Vec4(0.1, 0.11, 0.12, 1.0)
BRASS_GOLD = Vec4(0.85, 0.65, 0.12, 1.0)

# Procedural Geometry Generators
def create_cylinder(radius, height, num_segments=16, color=KUKA_ORANGE):
    """
    Procedurally generate a cylinder along the Z-axis, centered at base.
    """
    format_spec = GeomVertexFormat.get_v3n3c4()
    vdata = GeomVertexData("cylinder", format_spec, Geom.UH_static)
    vdata.set_num_rows((num_segments + 1) * 2)
    
    vertex = GeomVertexWriter(vdata, "vertex")
    normal = GeomVertexWriter(vdata, "normal")
    color_writer = GeomVertexWriter(vdata, "color")
    
    # Generate vertices
    for i in range(num_segments + 1):
        angle = (float(i) / num_segments) * 2.0 * math.pi
        cos_a = math.cos(angle)
        sin_a = math.sin(angle)
        
        # Bottom ring
        vertex.add_data3(radius * cos_a, radius * sin_a, 0.0)
        normal.add_data3(cos_a, sin_a, 0.0)
        color_writer.add_data4(color)
        
        # Top ring
        vertex.add_data3(radius * cos_a, radius * sin_a, height)
        normal.add_data3(cos_a, sin_a, 0.0)
        color_writer.add_data4(color)
        
    # Generate triangles
    tris = GeomTriangles(Geom.UH_static)
    for i in range(num_segments):
        b0 = i * 2
        t0 = i * 2 + 1
        b1 = (i + 1) * 2
        t1 = (i + 1) * 2 + 1
        
        # Side Triangles
        tris.add_vertices(b0, t0, b1)
        tris.add_vertices(t0, t1, b1)
        
    geom = Geom(vdata)
    geom.add_primitive(tris)
    geom_node = GeomNode("cylinder_geom")
    geom_node.add_geom(geom)
    return geom_node

def create_sphere(radius, num_segments=12, color=SLATE_GRAY):
    """
    Procedurally generate a sphere centered at origin.
    """
    format_spec = GeomVertexFormat.get_v3n3c4()
    vdata = GeomVertexData("sphere", format_spec, Geom.UH_static)
    vertex = GeomVertexWriter(vdata, "vertex")
    normal = GeomVertexWriter(vdata, "normal")
    color_writer = GeomVertexWriter(vdata, "color")
    
    # Vertices
    for i in range(num_segments + 1):
        lat = (float(i) / num_segments) * math.pi - (math.pi / 2.0)
        cos_lat = math.cos(lat)
        sin_lat = math.sin(lat)
        for j in range(num_segments + 1):
            lon = (float(j) / num_segments) * 2.0 * math.pi
            cos_lon = math.cos(lon)
            sin_lon = math.sin(lon)
            
            x = cos_lon * cos_lat
            y = sin_lon * cos_lat
            z = sin_lat
            
            vertex.add_data3(radius * x, radius * y, radius * z)
            normal.add_data3(x, y, z)
            color_writer.add_data4(color)
            
    # Triangles
    tris = GeomTriangles(Geom.UH_static)
    for i in range(num_segments):
        for j in range(num_segments):
            r0 = i * (num_segments + 1)
            r1 = (i + 1) * (num_segments + 1)
            
            tris.add_vertices(r0 + j, r0 + j + 1, r1 + j)
            tris.add_vertices(r0 + j + 1, r1 + j + 1, r1 + j)
            
    geom = Geom(vdata)
    geom.add_primitive(tris)
    geom_node = GeomNode("sphere_geom")
    geom_node.add_geom(geom)
    return geom_node


class KukaRoboticArm:
    def __init__(self, parent_node, arm_type="WELDER", base_pos=Vec3(0, 0, 0), arm_color=None):
        self.arm_type = arm_type
        
        # Color palettes
        if arm_color is not None:
            self.arm_color = arm_color
        else:
            self.arm_color = KUKA_ORANGE if arm_type == "WELDER" else Vec4(0.0, 0.4, 0.8, 1.0) # Cobalt Blue for Loader
            
        self.root = parent_node.attach_new_node(f"kuka_{arm_type.lower()}_arm")
        self.root.set_pos(base_pos)
        
        # Initial joint angles in degrees
        # [Joint 1, Joint 2, Joint 3, Joint 4, Joint 5, Joint 6]
        if self.arm_type == "WELDER":
            self.joint_angles = [0.0, 20.0, -45.0, 0.0, 25.0, 0.0]
        else:
            self.joint_angles = [0.0, 15.0, -35.0, 0.0, 20.0, 0.0]
            
        # Joint safety constraints (limits in degrees)
        self.joint_limits = [
            (-170.0, 170.0), # J1: Base Roll
            (-45.0, 85.0),   # J2: Shoulder Pitch
            (-120.0, 60.0),  # J3: Elbow Pitch
            (-185.0, 185.0), # J4: Wrist Roll
            (-120.0, 120.0), # J5: Wrist Pitch
            (-350.0, 350.0)  # J6: Flange/Torch Roll
        ]
        
        self.build_kuka_robot()
        self.update_joint_transforms()
        
    def build_kuka_robot(self):
        """
        Assemble the KUKA robotic arm procedurally using high-fidelity links and joints.
        Supports Welder configuration or Loader configuration.
        """
        # --- LINK 0: Base Pedestal (Static) ---
        self.base_pedestal = self.root.attach_new_node(create_cylinder(0.5, 0.4, color=DARK_GRAY))
        
        # Bold hazard accents around Base Pedestal
        stripe_color = Vec4(0.8, 0.8, 0.0, 1.0) if self.arm_type == "WELDER" else Vec4(0.0, 0.7, 0.9, 1.0)
        for angle in range(0, 360, 45):
            rad = math.radians(angle)
            stripe = self.base_pedestal.attach_new_node(create_cylinder(0.04, 0.4, color=stripe_color))
            stripe.set_pos(0.48 * math.cos(rad), 0.48 * math.sin(rad), 0.0)
            
        # Pedestal mounting bolts circle
        for angle in range(22, 360, 45):
            rad = math.radians(angle)
            bolt = self.base_pedestal.attach_new_node(create_cylinder(0.025, 0.05, color=SLATE_GRAY))
            bolt.set_pos(0.43 * math.cos(rad), 0.43 * math.sin(rad), 0.4)
            bolt.look_at(0.43 * math.cos(rad), 0.43 * math.sin(rad), 1.0)
            
        # --- JOINT 1 & LINK 1: Base Rotation Column ---
        self.j1_node = self.base_pedestal.attach_new_node("joint1_pivot")
        self.j1_node.set_pos(0, 0, 0.4)
        
        # Assembly mesh for J1 column (Heavy rotating tower)
        j1_mesh = self.j1_node.attach_new_node(create_cylinder(0.4, 0.6, color=self.arm_color))
        
        # Heavy bearing gear ring ornament on J1 tower base
        gear_ring = self.j1_node.attach_new_node(create_cylinder(0.44, 0.1, color=SLATE_GRAY))
        gear_ring.set_pos(0, 0, 0.02)
        
        # Servo housing accent box on J1 tower
        servo1 = self.j1_node.attach_new_node(create_cylinder(0.18, 0.3, color=SLATE_GRAY))
        servo1.set_pos(0.3, 0, 0.2)
        servo1.look_at(0.3, 0, 1) # Mount horizontally
        
        # --- JOINT 2 & LINK 2: Shoulder Joint & Upper Arm ---
        self.j2_node = self.j1_node.attach_new_node("joint2_pivot")
        self.j2_node.set_pos(0, 0, 0.6) # Offset at top of J1 column
        
        # Shoulder heavy casing (Spherical node)
        j2_casing = self.j2_node.attach_new_node(create_sphere(0.32, color=SLATE_GRAY))
        
        # Long orange/blue Upper Arm link (Link 2)
        link2 = self.j2_node.attach_new_node(create_cylinder(0.22, 1.8, color=self.arm_color))
        
        # Add decorative warning sticker stripe along Upper Arm (Link 2)
        warning_stripe = link2.attach_new_node(create_cylinder(0.225, 0.2, color=Vec4(0.15, 0.15, 0.15, 1.0)))
        warning_stripe.set_pos(0, 0, 0.8)
        
        # --- JOINT 3 & LINK 3: Elbow Joint & Forearm ---
        self.j3_node = self.j2_node.attach_new_node("joint3_pivot")
        self.j3_node.set_pos(0, 0, 1.8) # Extend along the upper arm length
        
        # Elbow rotating casing
        j3_casing = self.j3_node.attach_new_node(create_sphere(0.25, color=SLATE_GRAY))
        
        # Orange/blue Forearm Link (Link 3)
        link3 = self.j3_node.attach_new_node(create_cylinder(0.16, 1.6, color=self.arm_color))
        
        # Servo 3 assembly mounted at elbow back
        servo3 = self.j3_node.attach_new_node(create_cylinder(0.12, 0.25, color=DARK_GRAY))
        servo3.set_pos(-0.2, 0, 0)
        
        # --- HIGH-FIDELITY PARALLEL HYDRAULIC ACTUATORS ---
        # Shoulder Actuator J2 (Casing on Column, Rod on Upper Arm)
        self.actuator2_base = self.j1_node.attach_new_node(create_cylinder(0.07, 0.9, color=SLATE_GRAY))
        self.actuator2_base.set_pos(-0.32, 0.15, 0.15)
        
        self.actuator2_rod_target = self.j2_node.attach_new_node("actuator2_rod_target")
        self.actuator2_rod_target.set_pos(-0.22, 0.15, 0.95)
        self.actuator2_rod = self.actuator2_rod_target.attach_new_node(create_cylinder(0.04, 0.8, color=BRASS_GOLD))
        
        # Elbow Actuator J3 (Casing on Upper Arm, Rod on Elbow pivot)
        self.actuator3_base = self.j2_node.attach_new_node(create_cylinder(0.055, 0.8, color=DARK_GRAY))
        self.actuator3_base.set_pos(0.18, -0.15, 0.4)
        
        self.actuator3_rod_target = self.j3_node.attach_new_node("actuator3_rod_target")
        self.actuator3_rod_target.set_pos(0.12, -0.15, 0.65)
        self.actuator3_rod = self.actuator3_rod_target.attach_new_node(create_cylinder(0.03, 0.7, color=BRASS_GOLD))
        
        # --- FOREARM WIRE FEEDER & ROTATING SPOOL (Only for welder) ---
        if self.arm_type == "WELDER":
            # Dark metallic wire-feeder electronics enclosure
            self.wire_feeder = self.j3_node.attach_new_node(create_cylinder(0.14, 0.35, color=DARK_GRAY))
            self.wire_feeder.set_pos(-0.16, 0.0, 0.5)
            self.wire_feeder.set_hpr(0, 90, 0) # Orient horizontal cylinder
            
            # High-visibility rotating wire spool wheel (coiled copper welding wire)
            self.spool_wheel = self.wire_feeder.attach_new_node(create_cylinder(0.12, 0.08, color=Vec4(0.85, 0.45, 0.25, 1.0)))
            self.spool_wheel.set_pos(0, 0, 0.19)
            self.spool_rot = 0.0
            
        # --- JOINT 4: Forearm Roll ---
        self.j4_node = self.j3_node.attach_new_node("joint4_pivot")
        self.j4_node.set_pos(0, 0, 1.6)
        
        # J4 Casing
        j4_casing = self.j4_node.attach_new_node(create_sphere(0.15, color=SLATE_GRAY))
        
        # --- JOINT 5: Wrist Pitch ---
        self.j5_node = self.j4_node.attach_new_node("joint5_pivot")
        self.j5_node.set_pos(0, 0, 0.2)
        
        j5_casing = self.j5_node.attach_new_node(create_sphere(0.12, color=DARK_GRAY))
        
        # --- JOINT 6: Flange & Torch/Gripper Assembly ---
        self.j6_node = self.j5_node.attach_new_node("joint6_pivot")
        self.j6_node.set_pos(0, 0, 0.15)
        
        # Flange rotating disc
        flange_disc = self.j6_node.attach_new_node(create_cylinder(0.09, 0.05, color=SLATE_GRAY))
        
        # --- END-EFFECTOR TCP TOOL ---
        if self.arm_type == "WELDER":
            # Angle torch at 45 degrees
            self.torch_base = self.j6_node.attach_new_node("torch_base")
            self.torch_base.set_pos(0, 0, 0.05)
            self.torch_base.set_hpr(0, -45, 0) # Slanted welding tool
            
            # Torch body cooling fins decorations
            for offset in [0.08, 0.16, 0.24]:
                fin = self.torch_base.attach_new_node(create_cylinder(0.055, 0.03, color=DARK_GRAY))
                fin.set_pos(0, 0, offset)
                
            # Torch cylindrical body
            torch_body = self.torch_base.attach_new_node(create_cylinder(0.04, 0.35, color=SLATE_GRAY))
            # Golden brass nozzle nozzle tip
            torch_nozzle = self.torch_base.attach_new_node(create_cylinder(0.02, 0.12, color=BRASS_GOLD))
            torch_nozzle.set_pos(0, 0, 0.35)
            
            # Tool Center Point (TCP) represents the actual welding tip location
            self.tcp_node = self.torch_base.attach_new_node("tcp_node")
            self.tcp_node.set_pos(0, 0, 0.47) # Extends to the very tip of the nozzle
        else:
            # Loader Gripper Tool
            self.gripper_base = self.j6_node.attach_new_node("gripper_base")
            self.gripper_base.set_pos(0, 0, 0.05)
            
            # Gripper neck heavy flange cylinder
            neck = self.gripper_base.attach_new_node(create_cylinder(0.05, 0.06, color=DARK_GRAY))
            
            # Horizontal heavy-duty cross-beam slide frame
            cross_beam = self.gripper_base.attach_new_node(create_cylinder(0.045, 0.28, color=SLATE_GRAY))
            cross_beam.set_pos(0, 0, 0.06)
            cross_beam.set_hpr(90, 0, 0) # Orient horizontal along local X axis
            
            # Left pneumatic finger slide assembly
            self.left_finger = self.gripper_base.attach_new_node("left_finger")
            self.left_finger.set_pos(-0.13, 0, 0.06)
            
            # Left finger guide slider sleeve
            sleeve1 = self.left_finger.attach_new_node(create_cylinder(0.03, 0.04, color=DARK_GRAY))
            sleeve1.set_hpr(0, 90, 0)
            
            # Left L-shaped structural finger bracket pointing down
            pad1 = self.left_finger.attach_new_node(create_cylinder(0.025, 0.16, color=self.arm_color))
            pad1.set_pos(0, 0, 0.04)
            pad1.set_hpr(0, 180, 0) # point Z-down
            
            # Black hard rubber high-friction grip pad
            grip1 = pad1.attach_new_node(create_cylinder(0.015, 0.1, color=DARK_GRAY))
            grip1.set_pos(0.015, 0, 0.04)
            
            # Right pneumatic finger slide assembly
            self.right_finger = self.gripper_base.attach_new_node("right_finger")
            self.right_finger.set_pos(0.13, 0, 0.06)
            
            # Right finger guide slider sleeve
            sleeve2 = self.right_finger.attach_new_node(create_cylinder(0.03, 0.04, color=DARK_GRAY))
            sleeve2.set_hpr(0, -90, 0)
            
            # Right L-shaped structural finger bracket pointing down
            pad2 = self.right_finger.attach_new_node(create_cylinder(0.025, 0.16, color=self.arm_color))
            pad2.set_pos(0, 0, 0.04)
            pad2.set_hpr(0, 180, 0) # point Z-down
            
            # Black hard rubber high-friction grip pad
            grip2 = pad2.attach_new_node(create_cylinder(0.015, 0.1, color=DARK_GRAY))
            grip2.set_pos(-0.015, 0, 0.04)
            
            # Tool Center Point (TCP) positioned at the center of the grip pads
            self.tcp_node = self.gripper_base.attach_new_node("tcp_node")
            self.tcp_node.set_pos(0, 0, 0.20)
            
            self.gripper_close_pct = 0.0
            self.set_gripper_close(0.0)
            
        # --- DYNAMIC CABLING HARNESSES ---
        # 1. Main sagging heavy umbilical cable between rotating tower base and forearm elbow joint
        self.cable_segments = []
        for i in range(12):
            seg = self.root.attach_new_node(create_sphere(0.045, num_segments=8, color=DARK_GRAY))
            self.cable_segments.append(seg)
            
        # 2. Sleek glowing cyan pneumatic conduit from spool feeder to torch body base (Welder only)
        if self.arm_type == "WELDER":
            self.energy_hose_segments = []
            for i in range(8):
                seg = self.root.attach_new_node(create_sphere(0.02, num_segments=6, color=Vec4(0.0, 0.9, 1.0, 1.0)))
                self.energy_hose_segments.append(seg)
                
    def set_gripper_close(self, pct):
        """
        Adjust pneumatic gripper fingers sliding clamping percentage (0.0 = fully open, 1.0 = fully closed).
        """
        self.gripper_close_pct = max(0.0, min(1.0, pct))
        if self.arm_type == "LOADER":
            # Slide jaws along local X axis closer together
            close_offset = self.gripper_close_pct * 0.075 # Slide up to 7.5 cm inward
            self.left_finger.set_x(-0.13 + close_offset)
            self.right_finger.set_x(0.13 - close_offset)
            
    def update_joint_transforms(self):
        """
        Apply forward kinematics: orient each joint node based on self.joint_angles.
        Also update parallel hydraulic actuator alignments and dynamic heavy cable loops.
        """
        # Joint 1: Rotates around base vertical Z-axis (heading)
        self.j1_node.set_h(self.joint_angles[0])
        
        # Joint 2: Shoulder pitch around local Y-axis
        self.j2_node.set_p(self.joint_angles[1])
        
        # Joint 3: Elbow pitch around local Y-axis
        self.j3_node.set_p(self.joint_angles[2])
        
        # Joint 4: Forearm roll around local Z-axis (local axis of link 3)
        self.j4_node.set_h(self.joint_angles[3])
        
        # Joint 5: Wrist pitch around local Y-axis
        self.j5_node.set_p(self.joint_angles[4])
        
        # Joint 6: Flange / Torch roll around local Z-axis
        self.j6_node.set_h(self.joint_angles[5])
        
        # 1. Align J2 Actuator (Piston + Rod) using look_at pointing logic
        self.actuator2_base.look_at(self.actuator2_rod_target)
        self.actuator2_rod.look_at(self.actuator2_base)
        
        # 2. Align J3 Actuator (Piston + Rod) using look_at pointing logic
        self.actuator3_base.look_at(self.actuator3_rod_target)
        self.actuator3_rod.look_at(self.actuator3_base)
        
        # 3. Rotate copper spool wheel dynamically to simulate active wire feed
        if self.arm_type == "WELDER":
            self.spool_rot += 1.5
            self.spool_wheel.set_h(self.spool_rot)
            
        # 4. Dynamic Umbilical Bezier Cable loop (J1 base column to J3 elbow)
        p0 = self.j1_node.get_pos(self.root) + self.j1_node.get_relative_vector(self.root, Vec3(0, -0.45, 0.25))
        p2 = self.j3_node.get_pos(self.root) + self.j3_node.get_relative_vector(self.root, Vec3(-0.15, -0.2, 0.1))
        # Sag vector under gravity influence
        p1 = (p0 + p2) * 0.5 + Vec3(0, 0, -0.9)
        
        for i, seg in enumerate(self.cable_segments):
            t = i / 11.0
            pos = p0 * ((1.0 - t)**2) + p1 * (2.0 * (1.0 - t) * t) + p2 * (t**2)
            seg.set_pos(pos)
            
        # 5. Glowing Cyan Energy supply hose (J3 Forearm to TCP Torch Base)
        if self.arm_type == "WELDER":
            h0 = self.j3_node.get_pos(self.root) + self.j3_node.get_relative_vector(self.root, Vec3(-0.12, 0.05, 1.3))
            h2 = self.torch_base.get_pos(self.root)
            h1 = (h0 + h2) * 0.5 + Vec3(0, 0.2, -0.25)
            
            for i, seg in enumerate(self.energy_hose_segments):
                t = i / 7.0
                pos = h0 * ((1.0 - t)**2) + h1 * (2.0 * (1.0 - t) * t) + h2 * (t**2)
                seg.set_pos(pos)
                
    def set_joint_angles(self, angles):
        """
        Set and clamp joint angles within safety limits.
        """
        for i in range(min(len(angles), 6)):
            low, high = self.joint_limits[i]
            self.joint_angles[i] = max(low, min(high, angles[i]))
        self.update_joint_transforms()
        
    def get_tcp_world_pos(self):
        """
        Retrieve the 3D position of the Tool Center Point (TCP) in World Coordinates.
        """
        return self.tcp_node.get_pos(self.root)
        
    def solve_ccd_ik(self, target_pos, tolerance=0.02, max_iterations=12):
        """
        Fast numerical CCD (Cyclic Coordinate Descent) Inverse Kinematics solver.
        Directly updates self.joint_angles to guide the tool tip to the target position.
        """
        joints = [
            (self.j1_node, Vec3(0, 0, 1), 0),  # J1: Z-axis
            (self.j2_node, Vec3(0, 1, 0), 1),  # J2: Y-axis
            (self.j3_node, Vec3(0, 1, 0), 2),  # J3: Y-axis
            (self.j4_node, Vec3(0, 0, 1), 3),  # J4: Z-axis (Z acts as longitudinal roll axis)
            (self.j5_node, Vec3(0, 1, 0), 4),  # J5: Y-axis
            (self.j6_node, Vec3(0, 0, 1), 5),  # J6: Z-axis
        ]
        
        for _ in range(max_iterations):
            # Compute current TCP tip position
            tip_pos = self.get_tcp_world_pos()
            dist = (target_pos - tip_pos).length()
            if dist < tolerance:
                break
                
            # Iterate backward from J6 to J1
            for pivot_node, axis, idx in reversed(joints):
                # TCP tip in pivot local space
                local_tip = self.tcp_node.get_pos(pivot_node)
                # Target in pivot local space
                local_target = pivot_node.get_relative_point(self.root, target_pos)
                
                # Project vectors onto the plane perpendicular to the joint axis
                if axis == Vec3(0, 0, 1): # Z axis rotation
                    v_tip = Vec3(local_tip.x, local_tip.y, 0)
                    v_target = Vec3(local_target.x, local_target.y, 0)
                else: # Y axis rotation (pitch)
                    v_tip = Vec3(local_tip.x, 0, local_tip.z)
                    v_target = Vec3(local_target.x, 0, local_target.z)
                    
                v_tip.normalize()
                v_target.normalize()
                
                # Compute angle between current tip vector and target vector
                cos_theta = v_tip.dot(v_target)
                cos_theta = max(-1.0, min(1.0, cos_theta))
                angle_diff = math.acos(cos_theta)
                
                # Check rotation direction using cross product
                cross_prod = v_tip.cross(v_target)
                sign = 1.0
                if axis == Vec3(0, 0, 1):
                    if cross_prod.z < 0: sign = -1.0
                else:
                    if cross_prod.y < 0: sign = -1.0
                    
                delta_angle = math.degrees(angle_diff) * sign
                
                # Apply angle correction and clamp to joint limits
                new_angle = self.joint_angles[idx] + delta_angle
                low, high = self.joint_limits[idx]
                self.joint_angles[idx] = max(low, min(high, new_angle))
                
                # Re-apply transforms dynamically inside solver iteration
                self.update_joint_transforms()
                
        # Sync final result
        self.update_joint_transforms()
        return (self.get_tcp_world_pos() - target_pos).length() < tolerance
