import random
import math
from panda3d.core import NodePath, Vec3, Vec4, CardMaker, PointLight
from weldforge_x.core.robotics import create_sphere, create_cylinder, SLATE_GRAY, DARK_GRAY

class WeldSpark:
    def __init__(self, parent_node, start_pos, velocity, spark_type="SPATTER"):
        self.node = parent_node.attach_new_node("spark")
        self.node.set_pos(start_pos)
        self.spark_type = spark_type
        
        # Create particle card representing the glowing spark
        cm = CardMaker("spark_card")
        
        if spark_type == "BURST":
            # Blinding cyan-white electrical arc burst
            cm.set_frame(-0.06, 0.06, -0.06, 0.06)
            card = self.node.attach_new_node(cm.generate())
            card.set_color(Vec4(0.8, 0.95, 1.0, 1.0))
            self.max_life = 0.08 + random.uniform(0.0, 0.04)
            self.gravity = Vec3(0, 0, 0) # Fades instantly in place
            
        elif spark_type == "EMBER":
            # Fine hot ember floating upward on thermal air drafts
            cm.set_frame(-0.012, 0.012, -0.012, 0.012)
            card = self.node.attach_new_node(cm.generate())
            card.set_color(Vec4(1.0, 0.85, 0.1, 1.0)) # Bright yellow-orange
            self.max_life = 0.6 + random.uniform(0.0, 0.8)
            self.gravity = Vec3(random.uniform(-0.2, 0.2), random.uniform(-0.2, 0.2), 0.8) # Rising thermal drift!
            
        else: # "SPATTER"
            # Heavy spatter droplet spraying and falling rapidly under gravity
            cm.set_frame(-0.025, 0.025, -0.025, 0.025)
            card = self.node.attach_new_node(cm.generate())
            card.set_color(Vec4(1.0, 0.42, 0.0, 1.0)) # Radiant orange
            self.max_life = 0.4 + random.uniform(0.0, 0.5)
            self.gravity = Vec3(0, 0, -9.81) # Standard gravity drop
            
        card.set_billboard_point_eye()
        card.set_light_off() # Self-luminous
        
        self.velocity = velocity
        self.life = 0.0

    def update(self, dt):
        """
        Advance spark particle kinematics. Return False when particle dies.
        """
        self.life += dt
        if self.life >= self.max_life:
            self.node.remove_node()
            return False
            
        # Physics kinematics
        if self.spark_type == "EMBER":
            # Embers rise slowly
            self.velocity += self.gravity * dt
        else:
            # Spatter falls
            self.velocity += self.gravity * dt
            
        self.node.set_pos(self.node.get_pos() + self.velocity * dt)
        
        # Exponential opacity fadeout
        alpha = 1.0 - (self.life / self.max_life)
        self.node.set_alpha(max(0.0, alpha))
        return True


class WeldSeamNode:
    def __init__(self, parent_node, start_pos):
        self.parent = parent_node
        self.points = []
        self.nodes = []
        self.start_pos = Vec3(start_pos)
        
    def add_weld_point(self, current_pos):
        """
        Dynamically spawn high-fidelity overlapping spherical weld bead segments.
        Creates a realistic ripple-pattern weld seam.
        """
        last_pos = self.points[-1] if self.points else self.start_pos
        dist = (current_pos - last_pos).length()
        
        # Spawn small overlapping metallic spheres (ripple beads)
        # 0.035 units ensures beautiful overlap ripple patterns
        if dist > 0.035:
            self.points.append(Vec3(current_pos))
            
            # Create a high-fidelity spherical bead dome
            bead = self.parent.attach_new_node(create_sphere(0.032, num_segments=8, color=Vec4(2.0, 2.0, 2.0, 1.0)))
            bead.set_pos(current_pos)
            bead.set_light_off() # Glowing melt pool!
            
            self.nodes.append((bead, 0.0)) # (NodePath, cool_down_time)

    def update(self, dt):
        """
        Cool down the overlapping weld bead segments using a beautiful 5-stage thermal gradient.
        """
        updated_nodes = []
        for bead, age in self.nodes:
            new_age = age + dt
            
            if new_age < 3.0: # Cooling transition takes 3 seconds
                ratio = new_age / 3.0
                
                # 5-Stage Thermal Cooling Color Interpolation
                if ratio < 0.08:
                    # Stage 1: Blinding White-Hot melt pool
                    glow_color = Vec4(2.0, 2.0, 2.0, 1.0)
                elif ratio < 0.25:
                    # Stage 2: Glowing Amber-Yellow
                    t = (ratio - 0.08) / 0.17
                    glow_color = Vec4(2.0 * (1.0 - t) + 1.0 * t, 2.0 * (1.0 - t) + 0.85 * t, 2.0 * (1.0 - t) + 0.1 * t, 1.0)
                elif ratio < 0.5:
                    # Stage 3: Radiant Incandescent Orange
                    t = (ratio - 0.25) / 0.25
                    glow_color = Vec4(1.0, 0.85 * (1.0 - t) + 0.38 * t, 0.1 * (1.0 - t) + 0.0 * t, 1.0)
                elif ratio < 0.85:
                    # Stage 4: Deep Red cooling
                    t = (ratio - 0.5) / 0.35
                    glow_color = Vec4(1.0 * (1.0 - t) + 0.55 * t, 0.38 * (1.0 - t) + 0.08 * t, 0.0, 1.0)
                else:
                    # Stage 5: Transitioning to solid dark steel-gray slag
                    t = (ratio - 0.85) / 0.15
                    glow_color = Vec4(0.55 * (1.0 - t) + 0.25 * t, 0.08 * (1.0 - t) + 0.26 * t, 0.0 * (1.0 - t) + 0.28 * t, 1.0)
                
                bead.set_color(glow_color)
                updated_nodes.append((bead, new_age))
            else:
                # Fully cooled weld bead: responds to ambient/directional scene lighting
                bead.set_color(Vec4(0.24, 0.26, 0.28, 1.0)) # Dark metallic steel gray
                bead.clear_light_off() # Restores normal lighting shader pipeline
                updated_nodes.append((bead, new_age))
                
        self.nodes = updated_nodes


class WeldingEffectsManager:
    def __init__(self, render_node, weld_light_ref):
        self.render = render_node
        self.weld_light = weld_light_ref
        self.sparks = []
        self.active_seam = None
        self.is_welding = False
        self.flicker_t = 0.0
        
    def start_welding(self, start_pos, target_workpiece_np):
        """
        Activate welding arc light, particle engine, and attach a new weld seam to the workpiece.
        """
        self.is_welding = True
        self.active_seam = WeldSeamNode(target_workpiece_np, start_pos)
        
    def stop_welding(self):
        """
        Deactivate welding state.
        """
        self.is_welding = False
        self.weld_light.set_color(Vec4(0, 0, 0, 1)) # Extinguish light
        
    def update(self, dt, torch_tip_pos):
        """
        Update the flickering welding neon arc, dynamic particles, and weld seam cooling logic.
        """
        # 1. Update active seam
        if self.is_welding and self.active_seam:
            self.active_seam.add_weld_point(torch_tip_pos)
            
            # Position the flickering weld pointlight at the torch tip
            self.weld_light.set_pos(torch_tip_pos)
            
            # 2. Electric arc light flicker math
            self.flicker_t += dt * 50.0
            flicker_val = 0.7 + 0.3 * math.sin(self.flicker_t) * math.cos(self.flicker_t * 1.6)
            # High intensity cyan-blue electric welding glow
            self.weld_light.set_color(Vec4(0.35 * flicker_val, 0.82 * flicker_val, 1.0 * flicker_val, 1.0))
            
            # 3. Procedural Multi-Tier Spark Generator
            # Spawn Bursts (Flashes)
            if random.random() < 0.7:
                self.sparks.append(WeldSpark(self.render, torch_tip_pos, Vec3(0,0,0), "BURST"))
                
            # Spawn Spatters (Heavy drops spraying and bouncing)
            for _ in range(random.randint(2, 4)):
                velocity = Vec3(
                    random.uniform(-2.2, 2.2),
                    random.uniform(-2.2, 2.2),
                    random.uniform(0.5, 4.0) # Burst upward
                )
                self.sparks.append(WeldSpark(self.render, torch_tip_pos, velocity, "SPATTER"))
                
            # Spawn Embers (Fine rising embers)
            if random.random() < 0.5:
                for _ in range(random.randint(1, 2)):
                    velocity = Vec3(
                        random.uniform(-0.6, 0.6),
                        random.uniform(-0.6, 0.6),
                        random.uniform(0.2, 1.0)
                    )
                    self.sparks.append(WeldSpark(self.render, torch_tip_pos, velocity, "EMBER"))
                
        # 4. Update active spark physics
        alive_sparks = []
        for spark in self.sparks:
            if spark.update(dt):
                alive_sparks.append(spark)
        self.sparks = alive_sparks
        
        # 5. Update seam cooling
        if self.active_seam:
            self.active_seam.update(dt)
