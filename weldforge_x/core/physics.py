import logging
from panda3d.core import Vec3

try:
    from panda3d.bullet import BulletWorld, BulletPlaneShape, BulletRigidBodyNode
    BULLET_AVAILABLE = True
except ImportError:
    BULLET_AVAILABLE = False
    logging.warning("Bullet Physics could not be loaded. Falling back to geometric collision detection.")

class WeldForgePhysics:
    def __init__(self, render_node=None):
        self.world = None
        self.render_node = render_node
        self.rigid_bodies = []
        
        if BULLET_AVAILABLE:
            self.setup_bullet_world()
            
    def setup_bullet_world(self):
        """
        Set up the Bullet Physics engine and standard gravity.
        """
        self.world = BulletWorld()
        self.world.set_gravity(Vec3(0, 0, -9.81))
        
        # Add a flat ground plane to prevent objects falling to infinity
        ground_shape = BulletPlaneShape(Vec3(0, 0, 1), 0) # Normal vector pointing up, 0 elevation
        ground_node = BulletRigidBodyNode('ground_plane')
        ground_node.add_shape(ground_shape)
        
        if self.render_node:
            ground_np = self.render_node.attach_new_node(ground_node)
            self.world.attach_rigid_body(ground_node)
            self.rigid_bodies.append(ground_np)
            
    def update(self, dt):
        """
        Advance the physics simulation world by one time step.
        """
        if self.world:
            # Step the simulation by the elapsed time
            self.world.do_physics(dt)
