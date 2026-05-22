import sys
import math
from direct.showbase.ShowBase import ShowBase
from panda3d.core import (
    WindowProperties,
    AmbientLight,
    DirectionalLight,
    Vec4,
    Vec3,
    PointLight,
    CardMaker,
    MouseButton,
    TextNode
)
from direct.gui.OnscreenText import OnscreenText

class WeldForgeEngine(ShowBase):
    def __init__(self):
        # Initialize ShowBase in 'none' mode to prevent default standalone window
        super().__init__(windowType='none')
        self.win_id = None
        self.lights = {}
        
        # Camera orbital parameters
        self.camera_target = Vec3(0, 0, 1.2)
        self.camera_dist = 11.0
        self.camera_heading = -35.0 # Degrees angle
        self.camera_pitch = 22.0     # Degrees angle
        
        # Set up lighting immediately so it's accessible before viewport embeds
        self.setup_lighting()
        
    def setup_viewport(self, parent_win_id, width, height):
        """
        Embed the Panda3D window into the PyQt6 parent window using winId.
        """
        self.win_id = parent_win_id
        
        # Configure window properties
        props = WindowProperties()
        props.set_parent_window(int(parent_win_id))
        props.set_origin(0, 0)
        props.set_size(width, height)
        
        # Initialize default graphic pipe and open the embedded window
        self.make_default_pipe()
        self.open_default_window(props=props)
        
        # Set background color to premium dark industrial slate
        self.win.set_clear_color(Vec4(0.08, 0.09, 0.11, 1.0))
        
        # Set up default scene assets
        self.setup_grid_floor()
        self.setup_cameras()
        
    def setup_lighting(self):
        """
        Set up premium industrial lighting layout.
        """
        # 1. Soft Ambient Light to prevent deep dark shadows
        alight = AmbientLight('ambient_light')
        alight.set_color(Vec4(0.25, 0.28, 0.35, 1.0))
        alight_np = self.render.attach_new_node(alight)
        self.render.set_light(alight_np)
        self.lights['ambient'] = alight_np

        # 2. Main Overhead Directional Light (simulates ceiling high-bays)
        dlight = DirectionalLight('overhead_light')
        dlight.set_color(Vec4(0.8, 0.82, 0.9, 1.0))
        dlight_np = self.render.attach_new_node(dlight)
        dlight_np.set_hpr(40, -55, 0)
        self.render.set_light(dlight_np)
        self.lights['directional'] = dlight_np

        # 3. Welding Flickering PointLight
        wlight = PointLight('weld_glow_light')
        wlight.set_color(Vec4(0.0, 0.0, 0.0, 1.0)) # Dark by default
        wlight.set_attenuation((1.0, 0.04, 0.008))
        wlight_np = self.render.attach_new_node(wlight)
        wlight_np.set_pos(0, 0, 0)
        self.render.set_light(wlight_np)
        self.lights['weld_glow'] = wlight_np

    def setup_grid_floor(self):
        """
        Create a clean, glowing, high-tech industrial grid floor.
        """
        floor_np = self.render.attach_new_node("factory_floor")
        cm = CardMaker("floor_card")
        cm.set_frame(-20, 20, -20, 20)
        card = floor_np.attach_new_node(cm.generate())
        card.look_at(0, 0, -1)
        card.set_color(Vec4(0.1, 0.11, 0.13, 1.0)) # Dark graphite
        
    def setup_cameras(self):
        """
        Configure custom interactive camera loops and sci-fi HUD binds.
        """
        self.disable_mouse()
        
        # Scroll wheel Zoom events
        self.accept("wheel_up", self.zoom_in)
        self.accept("wheel_down", self.zoom_out)
        
        # Activate central camera update task
        self.taskMgr.add(self.camera_control_task, "CameraControlTask")
        
        # Sleek, semi-transparent industrial HUD overlay inside viewport
        self.hud_text = OnscreenText(
            text="[WELDFORGE-X] DIGITAL TWIN CORE VIEWPORT ACTIVE\n"
                 "SYSTEM TELEMETRY LINK: STABLE // CCD KINEMATICS ACTIVE\n"
                 "MOUSE INPUTS: LEFT-DRAG = ORBIT | RIGHT-DRAG = PAN | SCROLL = ZOOM",
            pos=(-1.3, 0.88),
            scale=0.038,
            fg=(0.0, 0.9, 1.0, 0.85), # Cyan glow with opacity
            align=TextNode.ALeft,
            mayChange=True
        )

    def zoom_in(self):
        self.camera_dist = max(2.5, self.camera_dist - 0.4)

    def zoom_out(self):
        self.camera_dist = min(25.0, self.camera_dist + 0.4)

    def camera_control_task(self, task):
        """
        CAD-grade camera orbit, pitch, pan, and coordinate alignment based on mouse drag states.
        """
        if self.mouseWatcherNode.has_mouse():
            mpos = self.mouseWatcherNode.get_mouse()
            x, y = mpos.get_x(), mpos.get_y()
            
            if not hasattr(self, 'last_mouse_pos'):
                self.last_mouse_pos = (x, y)
                
            dx = x - self.last_mouse_pos[0]
            dy = y - self.last_mouse_pos[1]
            
            left_down = self.mouseWatcherNode.is_button_down(MouseButton.one())
            right_down = self.mouseWatcherNode.is_button_down(MouseButton.three())
            
            if left_down:
                # Left-drag: Orbit camera orientation
                self.camera_heading -= dx * 130.0
                self.camera_pitch = max(-80.0, min(80.0, self.camera_pitch + dy * 90.0))
            elif right_down:
                # Right-drag: Pan camera target offset
                rad_h = math.radians(self.camera_heading)
                side_vec = Vec3(math.cos(rad_h), math.sin(rad_h), 0)
                up_vec = Vec3(0, 0, 1)
                self.camera_target += side_vec * (-dx * 3.5) + up_vec * (dy * 3.5)
                
            self.last_mouse_pos = (x, y)
            
        # Spherical trigonometry to compute camera position surrounding target
        rad_h = math.radians(self.camera_heading)
        rad_p = math.radians(self.camera_pitch)
        
        c_x = self.camera_target.x + self.camera_dist * math.sin(rad_h) * math.cos(rad_p)
        c_y = self.camera_target.y - self.camera_dist * math.cos(rad_h) * math.cos(rad_p)
        c_z = self.camera_target.z + self.camera_dist * math.sin(rad_p)
        
        self.camera.set_pos(c_x, c_y, c_z)
        self.camera.look_at(self.camera_target)
        
        return task.cont

    def handle_resize(self, width, height):
        """
        Safely update window size and aspect ratio when the container QWidget resizes.
        """
        if self.win:
            props = WindowProperties()
            props.set_size(width, height)
            self.win.request_properties(props)
