from PyQt6.QtWidgets import QWidget
from PyQt6.QtCore import QTimer, Qt

class Panda3DViewport(QWidget):
    def __init__(self, engine, parent=None):
        super().__init__(parent)
        self.engine = engine
        self.initialized = False
        
        # Set focus policy so it receives keyboard and mouse events
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setMinimumSize(400, 300)
        
    def showEvent(self, event):
        """
        Invoked when the widget becomes visible. Passes the native winId handle to Panda3D.
        """
        super().showEvent(event)
        if not self.initialized:
            # Pass our QWidget winId handle to Panda3D to parent the window
            win_id = self.winId()
            self.engine.setup_viewport(win_id, self.width(), self.height())
            
            # Start the QTimer driving the Panda3D main loop
            self.timer = QTimer(self)
            self.timer.timeout.connect(self.engine.taskMgr.step)
            self.timer.start(16) # ~60 Frames Per Second
            
            self.initialized = True
            
    def resizeEvent(self, event):
        """
        Invoked when the viewport widget is resized. Rescales the Panda3D graphic window.
        """
        super().resizeEvent(event)
        if self.initialized:
            self.engine.handle_resize(self.width(), self.height())
            
    def closeEvent(self, event):
        """
        Graceful cleanup.
        """
        if self.initialized:
            self.timer.stop()
        super().closeEvent(event)
