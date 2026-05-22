/* WELDFORGE-X: Application State Coordinator & Event Hook Loader */

let systemMode = 'IDLE'; // IDLE, WELDING, ESTOP

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize the Three.js 3D Simulation
  init3DScene();

  // 2. Sidebar Workpiece click selectors hook
  const workpieceCards = document.querySelectorAll('#workpiece-selector .segment-item');
  workpieceCards.forEach(card => {
    card.addEventListener('click', () => {
      if (systemMode === 'WELDING') return; // freeze configurations during active welds
      
      workpieceCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      const material = card.getAttribute('data-material');
      activeWorkpieceMaterial = material;
      
      // Update workpiece model inside Three.js
      spawnWorkpiece(material);
    });
  });

  // 3. Sidebar Welding Mode click selectors hook
  const modeCards = document.querySelectorAll('#mode-selector .segment-item');
  modeCards.forEach(card => {
    card.addEventListener('click', () => {
      if (systemMode === 'WELDING') return;

      modeCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      const mode = card.getAttribute('data-mode');
      activeWeldingMode = mode;
      
      logSystemEvent(`Welding Modality switched: ${mode.toUpperCase()} pulse selected.`);
    });
  });

  // 4. Chat Input key trigger (Enter key send)
  const chatInput = document.getElementById('chat-user-input');
  if (chatInput) {
    chatInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        sendChatMessage();
      }
    });
  }

  // 5. Emergency Stop Button hook
  const btnEstop = document.getElementById('btn-toggle-estop');
  if (btnEstop) {
    btnEstop.addEventListener('click', () => {
      if (systemMode !== 'ESTOP') {
        triggerEmergencyStop();
        appendChatBubble("🚨 <b>EMERGENCY STOP PRESSED</b>: Interlocks locked.", 'system');
      } else {
        clearEmergencyStop();
        appendChatBubble("✅ <b>EMERGENCY SYSTEM CLEARED</b>: Servo links active.", 'system');
      }
    });
  }

  // 6. Bidirectional Coordination Poller
  let lastTriggerWeldTrigger = 0;
  let lastHomingTrigger = 0;
  let lastCustomConfigTimestamp = 0;
  let lastFaultState = 'none';
  
  setInterval(() => {
    const savedStateStr = localStorage.getItem('weldforge_cell_state');
    if (!savedStateStr) return;
    
    try {
      const externalState = JSON.parse(savedStateStr);
      
      // A. Check E-STOP status
      if (externalState.systemMode === 'ESTOP' && systemMode !== 'ESTOP') {
        triggerEmergencyStop();
        appendChatBubble("🚨 <b>EMERGENCY STOP RECEIVED</b>: Dispatched from Dashboard AI supervisor.", 'system');
      } else if (externalState.systemMode === 'IDLE' && systemMode === 'ESTOP') {
        clearEmergencyStop();
        appendChatBubble("✅ <b>EMERGENCY CLEAR RECEIVED</b>: Dispatched from Dashboard AI supervisor.", 'system');
      }
      
      // B. Check active faults from dashboard
      if (typeof externalState.activeFault !== 'undefined' && externalState.activeFault !== lastFaultState) {
        lastFaultState = externalState.activeFault;
        activeFault = externalState.activeFault; // sync to global Three.js simulation variable
        
        if (activeFault !== 'none') {
          logSystemEvent(`🚨 Fault injected via dashboard: ${activeFault.toUpperCase()}`);
          updateHUDStatus(`ALARM: ${activeFault.toUpperCase()}`, 'estop');
        } else {
          logSystemEvent(`✅ Alarm interlocks reset. Status nominal.`);
          updateHUDStatus(`CELL: READY (IDLE)`, 'idle');
        }
      }

      // C. Check dynamic parts configuration from AI supervisor
      if (externalState.customPartConfig && externalState.customPartConfig.timestamp !== lastCustomConfigTimestamp) {
        lastCustomConfigTimestamp = externalState.customPartConfig.timestamp;
        activeCustomConfig = externalState.customPartConfig; // sync globally
        activeWorkpieceMaterial = activeCustomConfig.material;
        
        // Spawn custom workpiece immediately in 3D viewport
        spawnWorkpiece(activeWorkpieceMaterial, activeCustomConfig);
        
        // Sync UI selectors
        syncSidebarSelection(activeWorkpieceMaterial, activeCustomConfig.qty === 2 ? 'mig' : activeWeldingMode);
        
        logSystemEvent(`🤖 Dynamic workpiece spawning compiled: Two ${(activeCustomConfig.length * 100).toFixed(0)}cm ${activeWorkpieceMaterial.toUpperCase()} plates.`);
        appendChatBubble(`🤖 <b>DYNAMIC PIECES COMPILED</b><br>
                         • Material: <b>${activeWorkpieceMaterial.toUpperCase()}</b><br>
                         • Qty: <b>${activeCustomConfig.qty} pieces</b><br>
                         • Dimensions: <b>${(activeCustomConfig.length * 100).toFixed(0)} cm x ${(activeCustomConfig.width * 100).toFixed(0)} cm</b>`, 'bot');
      }

      // D. Check Homing trigger
      if (externalState.requestHoming && externalState.homingTrigger !== lastHomingTrigger) {
        lastHomingTrigger = externalState.homingTrigger;
        
        // Reset flag in local copy
        externalState.requestHoming = false;
        localStorage.setItem('weldforge_cell_state', JSON.stringify(externalState));
        
        if (isWeldingActive) {
          logSystemEvent("⚠️ Homing request rejected: Welding active.");
        } else {
          setTargetJointAngles([0, 15, -45, 0, 30, 0], 1.2);
          logSystemEvent("🤖 External Homing command executed.");
          appendChatBubble("🤖 <b>HOMING INITIATED</b>: Dispatch command from Dashboard.", 'bot');
        }
      }
      
      // E. Check Weld Trigger
      if (externalState.isWeldingActive && externalState.triggerWeldTrigger !== lastTriggerWeldTrigger) {
        lastTriggerWeldTrigger = externalState.triggerWeldTrigger;
        
        if (!isWeldingActive && !isMovingToTarget && systemMode !== 'ESTOP') {
          // Select correct variables globally
          activeWorkpieceMaterial = externalState.activeWorkpieceMaterial;
          activeWeldingMode = externalState.activeWeldingMode;
          
          // Sync UI selections on index.html
          syncSidebarSelection(activeWorkpieceMaterial, activeWeldingMode);
          
          // Sync custom configs
          if (externalState.customPartConfig) {
            activeCustomConfig = externalState.customPartConfig;
            spawnWorkpiece(activeWorkpieceMaterial, activeCustomConfig);
          } else {
            activeCustomConfig = null;
            spawnWorkpiece(activeWorkpieceMaterial);
          }

          // Trigger automated weld sequence
          startAutomationSequence(activeWorkpieceMaterial, activeWeldingMode);
          
          appendChatBubble(`🔥 <b>EXTERNAL SEQUENCE TRIGGERED</b><br>
                           • Workpiece: <b>${activeWorkpieceMaterial.toUpperCase()}</b><br>
                           • Modality: <b>${activeWeldingMode.toUpperCase()}</b>`, 'bot');
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }, 200);
});

function logSystemEvent(msg) {
  const consoleLog = document.getElementById('dashboard-console-log');
  const now = new Date();
  const timeStr = `[${now.toTimeString().split(' ')[0]}]`;

  // Create active console line
  const line = document.createElement('div');
  line.className = 'diag-log-line';
  
  let txtClass = '';
  if (msg.includes('🚨') || msg.includes('CRITICAL') || msg.includes('E-STOP')) txtClass = 'danger';
  else if (msg.includes('⚠️') || msg.includes('REJECTED')) txtClass = 'warn';
  else if (msg.includes('✅') || msg.includes('complete')) txtClass = 'success';

  line.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-txt ${txtClass}">${msg}</span>`;

  // Insert at top of diagnostics console log
  if (consoleLog) {
    consoleLog.insertBefore(line, consoleLog.firstChild);
  }
  
  // Also store inside a local diagnostic database array in window namespace for dashboard sync
  if (!window.systemLogCache) {
    const cached = localStorage.getItem('weldforge_log_cache');
    try {
      window.systemLogCache = cached ? JSON.parse(cached) : [];
    } catch (e) {
      window.systemLogCache = [];
    }
  }
  window.systemLogCache.unshift({ time: timeStr, text: msg, level: txtClass });
  
  // Limit cache length to 50
  if (window.systemLogCache.length > 50) window.systemLogCache.pop();
  localStorage.setItem('weldforge_log_cache', JSON.stringify(window.systemLogCache));
}

function triggerEmergencyStop() {
  systemMode = 'ESTOP';
  isWeldingActive = false;
  isMovingToTarget = false;

  // Flash UI status red
  updateHUDStatus("EMERGENCY STOP (LOCKED)", 'estop');
  
  // Turn off dynamic lights
  if (scene && scene.arcLightRef) {
    scene.arcLightRef.intensity = 0;
  }

  // Highlight button
  const btn = document.getElementById('btn-toggle-estop');
  if (btn) {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      UNLOCK CELL
    `;
    btn.style.background = 'rgba(0, 230, 118, 0.15)';
    btn.style.borderColor = 'rgba(0, 230, 118, 0.3)';
  }

  logSystemEvent("🚨 E-STOP INTERLOCK ACTIVATED: Robot links and arc power frozen.");
}

function clearEmergencyStop() {
  systemMode = 'IDLE';
  updateHUDStatus("CELL: READY (IDLE)", 'idle');

  // Restore button
  const btn = document.getElementById('btn-toggle-estop');
  if (btn) {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      E-STOP
    `;
    btn.style.background = 'rgba(255,23,68,0.15)';
    btn.style.borderColor = 'rgba(255,23,68,0.3)';
  }

  logSystemEvent("✅ Interlock loop reset. Power channels restored.");
}
