/* WELDFORGE-X: Siemens-Style Telemetry Analytics & Real-Time Visualization */

(function () {
  // 1. Color System (Neon harmony matching main workspace)
  const jointColors = [
    '#ff0055', // J1: Base - Crimson Red
    '#00ffcc', // J2: Shoulder - Neon Cyan
    '#ffea00', // J3: Elbow - Laser Yellow
    '#ff00ff', // J4: Wrist Roll - Hot Magenta
    '#0066ff', // J5: Wrist Pitch - Cobalt Blue
    '#a2ff00'  // J6: Flange - Acid Lime
  ];

  const jointNames = ['J1 Base', 'J2 Shldr', 'J3 Elbw', 'J4 W-Roll', 'J5 W-Ptch', 'J6 Flange'];

  // 2. Data Buffers for Scrolling Charts (120 data points capacity)
  const dataPointsCount = 120;
  const telemetryData = {
    torque: Array.from({ length: 6 }, () => Array(dataPointsCount).fill(0)),
    current: Array.from({ length: 6 }, () => Array(dataPointsCount).fill(0.5)),
    temp: Array.from({ length: 6 }, () => Array(dataPointsCount).fill(32))
  };

  // State caches
  let cellState = {
    systemMode: 'IDLE',
    activeWorkpieceMaterial: 'steel',
    activeWeldingMode: 'mig',
    isWeldingActive: false,
    currentWeldProgress: 0.0,
    jointAngles: [0, 15, -45, 0, 30, 0],
    activeFault: 'none'
  };
  let activeFault = 'none';
  let lastFaultState = 'none';
  let gasDashOffset = 0;

  // SVG Gauge target percentages
  const targetRULs = [98, 95, 97, 99, 96, 94];
  const currentRULs = [0, 0, 0, 0, 0, 0]; // for initial animated sweep

  // Canvases
  let canvasTorque, canvasCurrent, canvasTemp, canvasCamera, canvasVibeFFT;
  let ctxTorque, ctxCurrent, ctxTemp, ctxCamera, ctxVibeFFT;

  // Animation frame ticks
  let globalTime = 0;
  let simulatedTempRising = [32, 32, 32, 32, 32, 32];

  // 3. Document Loader Hook
  document.addEventListener('DOMContentLoaded', () => {
    initCanvases();
    initRULGauges();
    loadConsoleLogs();
    
    // Resize listener
    window.addEventListener('resize', handleResize);

    // Boot local updates
    requestAnimationFrame(renderLoop);

    // Read fast state updates from localStorage
    setInterval(pollSharedState, 100);
    // Append simulated telemetry noise messages
    setInterval(appendSimulatedTelemetryLog, 4500);

    // Bind chat enter key
    const chatInput = document.getElementById('chat-user-input');
    if (chatInput) {
      chatInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
          window.sendChatMessage();
        }
      });
    }
  });

  function initCanvases() {
    canvasTorque = document.getElementById('chart-torque');
    canvasCurrent = document.getElementById('chart-current');
    canvasTemp = document.getElementById('chart-temp');
    canvasCamera = document.getElementById('camera-feed-canvas');
    canvasVibeFFT = document.getElementById('chart-vibe-fft');

    if (canvasTorque) ctxTorque = canvasTorque.getContext('2d');
    if (canvasCurrent) ctxCurrent = canvasCurrent.getContext('2d');
    if (canvasTemp) ctxTemp = canvasTemp.getContext('2d');
    if (canvasCamera) ctxCamera = canvasCamera.getContext('2d');
    if (canvasVibeFFT) ctxVibeFFT = canvasVibeFFT.getContext('2d');

    handleResize();
  }

  function handleResize() {
    [canvasTorque, canvasCurrent, canvasTemp, canvasVibeFFT].forEach(canvas => {
      if (canvas) {
        const parent = canvas.parentElement;
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    });

    if (canvasCamera) {
      const parent = canvasCamera.parentElement;
      canvasCamera.width = parent.clientWidth;
      canvasCamera.height = 200; // Fixed style height or fit
    }
  }

  function initRULGauges() {
    // Initial spin animation for SVG rings
    const circumference = 2 * Math.PI * 30; // 188.5
    for (let i = 1; i <= 6; i++) {
      const ring = document.getElementById(`rul-ring-j${i}`);
      if (ring) {
        ring.style.strokeDasharray = `${circumference}`;
        ring.style.strokeDashoffset = `${circumference}`;
      }
    }
  }

  function pollSharedState() {
    // Read state from localStorage
    const savedStateStr = localStorage.getItem('weldforge_cell_state');
    if (savedStateStr) {
      try {
        cellState = JSON.parse(savedStateStr);
      } catch (e) {
        // Fallback
      }
    }

    if (typeof cellState.activeFault !== 'undefined') {
      activeFault = cellState.activeFault;
    } else {
      activeFault = 'none';
    }

    if (activeFault !== lastFaultState) {
      lastFaultState = activeFault;
      updateFaultButtonsUI(activeFault);
    }
    
    // Update dashboard lens headers depending on selections
    const camLensMode = document.getElementById('cam-lens-mode');
    if (camLensMode) {
      camLensMode.textContent = `COAXIAL - ${cellState.activeWeldingMode.toUpperCase()}`;
    }

    const vibeVal = document.getElementById('vibe-sensor-val');
    const gasVal = document.getElementById('gas-flow-val');
    const powerVal = document.getElementById('power-val');
    const vibeStat = document.getElementById('stat-vibe');

    if (cellState.systemMode === 'ESTOP') {
      if (vibeVal) vibeVal.textContent = '0.00 mm/s²';
      if (gasVal) {
        gasVal.textContent = 'INTERLOCK OPEN [0 L/min]';
        gasVal.style.color = 'var(--emergency-red)';
      }
      if (powerVal) powerVal.textContent = '0.0 kW';
      if (vibeStat) {
        vibeStat.textContent = 'SYSTEM ESTOP';
        vibeStat.style.color = 'var(--emergency-red)';
      }
      
      const badge = document.getElementById('ai-class-badge');
      if (badge) {
        badge.textContent = 'SYSTEM SHUTDOWN';
        badge.style.color = 'var(--emergency-red)';
      }
    } else {
      // 1. Vibration sensor updates
      let vibeText = '0.05 mm/s²';
      let vibeColor = 'var(--safe-green)';
      let vibeLabel = 'NOMINAL';

      if (activeFault === 'gear_slip') {
        const vibe = 1.8 + Math.random() * 0.25;
        vibeText = `${vibe.toFixed(2)} mm/s²`;
        vibeColor = 'var(--emergency-red)';
        vibeLabel = '180Hz CHATTER!';
      } else if (cellState.isWeldingActive) {
        const vibe = 1.6 + Math.sin(Date.now() / 50) * 0.4 + Math.random() * 0.15;
        vibeText = `${vibe.toFixed(2)} mm/s²`;
        vibeColor = 'var(--safe-green)';
        vibeLabel = 'WELD ACTIVE';
      } else {
        const vibe = 0.03 + Math.sin(Date.now() / 1000) * 0.01 + Math.random() * 0.005;
        vibeText = `${vibe.toFixed(2)} mm/s²`;
        vibeColor = 'var(--cyan-glow)';
        vibeLabel = 'NOMINAL';
      }

      if (vibeVal) vibeVal.textContent = vibeText;
      if (vibeStat) {
        vibeStat.textContent = vibeLabel;
        vibeStat.style.color = vibeColor;
      }

      // 2. Gas flow updates
      if (activeFault === 'gas_leak') {
        if (gasVal) {
          gasVal.textContent = 'LEAKING! [3.2 L/min]';
          gasVal.style.color = 'var(--emergency-red)';
        }
      } else if (cellState.isWeldingActive) {
        let flowText = 'Ar-CO2 [15 L/min]';
        if (cellState.activeWeldingMode === 'laser') flowText = 'N2 Shield [8 L/min]';
        if (cellState.activeWeldingMode === 'plasma') flowText = 'Argon Keyhole [18 L/min]';
        if (gasVal) {
          gasVal.textContent = flowText;
          gasVal.style.color = 'var(--safe-green)';
        }
      } else {
        if (gasVal) {
          gasVal.textContent = 'STANDBY [0 L/min]';
          gasVal.style.color = 'var(--text-muted)';
        }
      }

      // 3. Power updates
      let power = 0.2;
      if (cellState.isWeldingActive) {
        power = 22.4 + Math.random() * 1.5;
        if (cellState.activeWeldingMode === 'laser') power = 10.2 + Math.random() * 0.4;
        if (cellState.activeWeldingMode === 'plasma') power = 29.8 + Math.random() * 2.1;
        if (cellState.activeWeldingMode === 'tig') power = 14.5 + Math.random() * 0.8;
      }
      if (powerVal) powerVal.textContent = `${power.toFixed(1)} kW`;

      // 4. Camera HUD Badge updates
      const badge = document.getElementById('ai-class-badge');
      if (badge) {
        const accuracy = 97.5 + Math.random() * 2.0;
        if (activeFault === 'gas_leak') {
          badge.textContent = `GAS POROSITY (ASTM E390) (96.5%)`;
          badge.style.color = 'var(--emergency-red)';
        } else if (activeFault === 'gear_slip') {
          badge.textContent = `GEAR CHATTER DETECTION (97.2%)`;
          badge.style.color = 'var(--emergency-red)';
        } else if (activeFault === 'thermal_overload') {
          badge.textContent = `THERMAL CRITICAL RUNAWAY (99.4%)`;
          badge.style.color = 'var(--emergency-red)';
        } else if (activeFault === 'joint_drift') {
          badge.textContent = `SEAM TRACKING ERROR (98.1%)`;
          badge.style.color = 'var(--emergency-red)';
        } else if (cellState.isWeldingActive) {
          if (cellState.activeWorkpieceMaterial === 'copper' && Math.random() < 0.05) {
            badge.textContent = `THERMAL LOSS DETECTED (${accuracy.toFixed(1)}%)`;
            badge.style.color = 'var(--warn-yellow)';
          } else {
            badge.textContent = `GOOD BEAD (${accuracy.toFixed(1)}%)`;
            badge.style.color = 'var(--safe-green)';
          }
        } else {
          badge.textContent = 'NOMINAL SCANNER READY';
          badge.style.color = 'var(--cyan-glow)';
        }
      }
    }
  }

  function updateFaultButtonsUI(fault) {
    const btnGas = document.getElementById('btn-fault-gas');
    const btnGear = document.getElementById('btn-fault-gear');
    const btnTemp = document.getElementById('btn-fault-temp');
    const btnDrift = document.getElementById('btn-fault-drift');
    const btnPurge = document.getElementById('btn-purge-faults');

    // Reset styles
    if (btnGas) {
      btnGas.style.background = 'rgba(234, 88, 12, 0.05)';
      btnGas.style.borderColor = 'rgba(234, 88, 12, 0.15)';
      btnGas.style.boxShadow = 'none';
    }
    if (btnGear) {
      btnGear.style.background = 'rgba(217, 119, 6, 0.05)';
      btnGear.style.borderColor = 'rgba(217, 119, 6, 0.15)';
      btnGear.style.boxShadow = 'none';
    }
    if (btnTemp) {
      btnTemp.style.background = 'rgba(239, 68, 68, 0.05)';
      btnTemp.style.borderColor = 'rgba(239, 68, 68, 0.15)';
      btnTemp.style.boxShadow = 'none';
    }
    if (btnDrift) {
      btnDrift.style.background = 'rgba(37, 99, 235, 0.05)';
      btnDrift.style.borderColor = 'rgba(37, 99, 235, 0.15)';
      btnDrift.style.boxShadow = 'none';
    }
    if (btnPurge) {
      btnPurge.style.background = 'linear-gradient(135deg, var(--safe-green), #16a34a)';
      btnPurge.style.boxShadow = '0 4px 10px rgba(34, 197, 94, 0.15)';
    }

    // Apply active style
    if (fault === 'gas_leak' && btnGas) {
      btnGas.style.background = 'rgba(234, 88, 12, 0.25)';
      btnGas.style.borderColor = 'rgba(234, 88, 12, 0.8)';
      btnGas.style.boxShadow = '0 0 10px rgba(234, 88, 12, 0.3)';
    } else if (fault === 'gear_slip' && btnGear) {
      btnGear.style.background = 'rgba(217, 119, 6, 0.25)';
      btnGear.style.borderColor = 'rgba(217, 119, 6, 0.8)';
      btnGear.style.boxShadow = '0 0 10px rgba(217, 119, 6, 0.3)';
    } else if (fault === 'thermal_overload' && btnTemp) {
      btnTemp.style.background = 'rgba(239, 68, 68, 0.25)';
      btnTemp.style.borderColor = 'rgba(239, 68, 68, 0.8)';
      btnTemp.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.3)';
    } else if (fault === 'joint_drift' && btnDrift) {
      btnDrift.style.background = 'rgba(37, 99, 235, 0.25)';
      btnDrift.style.borderColor = 'rgba(37, 99, 235, 0.8)';
      btnDrift.style.boxShadow = '0 0 10px rgba(37, 99, 235, 0.3)';
    } else if (fault === 'none' && btnPurge) {
      btnPurge.style.background = 'linear-gradient(135deg, #22c55e, #15803d)';
      btnPurge.style.boxShadow = '0 0 15px rgba(34, 197, 94, 0.4)';
    }
  }

  window.injectFault = function (type) {
    activeFault = type;
    
    // Update local state and write to localStorage
    const savedStateStr = localStorage.getItem('weldforge_cell_state');
    let state = {};
    if (savedStateStr) {
      try { state = JSON.parse(savedStateStr); } catch(e) {}
    }
    state.activeFault = type;
    
    // If resetting, make sure system is not locked in ESTOP from overheat
    if (type === 'none') {
      if (state.systemMode === 'ESTOP') {
        state.systemMode = 'IDLE';
      }
      state.isWeldingActive = false;
      simulatedTempRising = [32, 32, 32, 32, 32, 32];
      logDashboardEvent("✅ Alarm interlocks cleared. Purging injected simulation faults.");
    } else {
      logDashboardEvent(`🚨 Fault injected via dashboard: ${type.toUpperCase()}`);
    }
    
    localStorage.setItem('weldforge_cell_state', JSON.stringify(state));
    updateFaultButtonsUI(type);
  };

  function loadConsoleLogs() {
    const consoleLog = document.getElementById('dashboard-console-log');
    if (!consoleLog) return;
    
    // Read log cache from localStorage
    const savedLogsStr = localStorage.getItem('weldforge_log_cache');
    if (savedLogsStr) {
      try {
        const logs = JSON.parse(savedLogsStr);
        consoleLog.innerHTML = ''; // clear
        
        // Append logs
        logs.forEach(log => {
          const line = document.createElement('div');
          line.className = 'diag-log-line';
          line.innerHTML = `<span class="log-time">${log.time}</span> <span class="log-txt ${log.level}">${log.text}</span>`;
          consoleLog.appendChild(line);
        });
      } catch (e) {
        // Error reading cache
      }
    }
  }

  function appendSimulatedTelemetryLog() {
    const consoleLog = document.getElementById('dashboard-console-log');
    if (!consoleLog) return;

    // List of highly authentic messages
    const reports = [
      "Servo motor encoders aligned at 120Hz solve frequency.",
      "Vibration spectrum scan: Zero bearing acoustic fatigue risk.",
      "Shielding gas purity rating verified: 99.98% clean flow.",
      "Busbar thermal index: cooling cycle steady.",
      "Coaxial defect neural pipeline active: 0 anomalies flagged.",
      "Actuator winding inductance normal. Grid load steady.",
      "Inverter power factor: 0.96. Nominal operational safety bounds."
    ];

    if (cellState.systemMode === 'ESTOP') return;

    const randomMsg = reports[Math.floor(Math.random() * reports.length)];
    const now = new Date();
    const timeStr = `[${now.toTimeString().split(' ')[0]}]`;

    // Create line
    const line = document.createElement('div');
    line.className = 'diag-log-line';
    line.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-txt success">${randomMsg}</span>`;

    consoleLog.insertBefore(line, consoleLog.firstChild);
    
    // Limit console length to 50 lines to prevent memory bloat
    while (consoleLog.children.length > 50) {
      consoleLog.removeChild(consoleLog.lastChild);
    }

    // Save back to localStorage log cache
    const savedLogsStr = localStorage.getItem('weldforge_log_cache');
    let logs = [];
    if (savedLogsStr) {
      try { logs = JSON.parse(savedLogsStr); } catch(e) {}
    }
    logs.unshift({ time: timeStr, text: randomMsg, level: 'success' });
    if (logs.length > 50) logs.pop();
    localStorage.setItem('weldforge_log_cache', JSON.stringify(logs));
  }

  // 4. Update SVG Remaining Useful Life Gauges
  function updateRULGauges(dt) {
    const circumference = 2 * Math.PI * 30; // 188.5

    for (let i = 0; i < 6; i++) {
      const target = targetRULs[i];
      // Smoothly approach target on initial loading
      if (currentRULs[i] < target) {
        currentRULs[i] += dt * 60.0;
        if (currentRULs[i] > target) currentRULs[i] = target;
      }

      // Add dynamic micro-fluctuations (±0.05%) when running to look alive
      let displayValue = currentRULs[i];
      if (cellState.systemMode !== 'ESTOP' && currentRULs[i] >= target) {
        displayValue += Math.sin(globalTime * 3.0 + i) * 0.05;
      }

      // Update text label
      const valEl = document.getElementById(`rul-val-j${i + 1}`);
      if (valEl) {
        valEl.textContent = `${displayValue.toFixed(1)}%`;
      }

      // Update SVG circle stroke-dashoffset
      const ring = document.getElementById(`rul-ring-j${i + 1}`);
      if (ring) {
        const offset = circumference * (1.0 - displayValue / 100);
        ring.style.strokeDashoffset = offset;

        // Change color based on values
        if (displayValue > 95) {
          ring.style.stroke = 'var(--safe-green)';
        } else if (displayValue > 90) {
          ring.style.stroke = 'var(--cyan-glow)';
        } else {
          ring.style.stroke = 'var(--warn-yellow)';
        }
      }
    }
  }

  // 5. Generate and shift telemetry trace points
  function updateTelemetryData(dt) {
    globalTime += dt;

    for (let j = 0; j < 6; j++) {
      let torqueVal = 0;
      let currentVal = 0.5;
      let tempTarget = 32.0;

      if (cellState.systemMode === 'ESTOP') {
        // Decay to zero/ambient
        torqueVal = 0;
        currentVal = 0;
        tempTarget = 26.0; // Ambient room temp
        
        // Cooldown
        if (simulatedTempRising[j] > tempTarget) {
          simulatedTempRising[j] -= dt * 1.5;
        }
      } else if (cellState.isWeldingActive) {
        // Active welding curves: Sinusoidal waveforms representing tracking joint path + noise
        const speedMultiplier = 6.0 + j * 0.8;
        const noise = (Math.random() - 0.5) * 8.0;
        
        torqueVal = 40.0 + Math.sin(globalTime * speedMultiplier) * 25.0 + noise;
        currentVal = 10.5 + Math.sin(globalTime * speedMultiplier * 0.9) * 4.0 + (Math.random() - 0.5) * 1.5;

        // Heating depending on active material and welding mode
        let powerFactor = 1.0;
        if (cellState.activeWeldingMode === 'plasma') powerFactor = 1.4;
        if (cellState.activeWeldingMode === 'laser') powerFactor = 0.7;

        tempTarget = 55.0 + j * 6.5 + Math.sin(globalTime * 0.1) * 3.0 * powerFactor;
        
        // Dynamic fault overrides
        if (activeFault === 'thermal_overload' && j === 2) {
          tempTarget = 115.0;
          simulatedTempRising[j] += dt * 12.0; // steep climb
          
          if (simulatedTempRising[j] > 95.0 && cellState.systemMode !== 'ESTOP') {
            // Trigger automatic E-STOP interlock shutdown
            cellState.systemMode = 'ESTOP';
            cellState.isWeldingActive = false;
            
            const savedStateStr = localStorage.getItem('weldforge_cell_state');
            let state = {};
            if (savedStateStr) {
              try { state = JSON.parse(savedStateStr); } catch(e) {}
            }
            state.systemMode = 'ESTOP';
            state.isWeldingActive = false;
            state.activeFault = 'thermal_overload';
            localStorage.setItem('weldforge_cell_state', JSON.stringify(state));
            
            logDashboardEvent("🚨 CRITICAL THERMAL INTERLOCK TRIP: Joint 3 motor winding exceeded 95°C limit!");
          }
        } else {
          // Ensure winding is hot
          if (simulatedTempRising[j] < tempTarget) {
            simulatedTempRising[j] += dt * 4.5;
          } else {
            simulatedTempRising[j] -= dt * 0.8;
          }
        }
      } else {
        // Idle state: minor idling vibration & standby metrics
        const idleNoise = (Math.random() - 0.5) * 1.5;
        torqueVal = Math.sin(globalTime * 0.5 + j) * 1.2 + idleNoise;
        currentVal = 0.45 + Math.sin(globalTime * 0.2 + j) * 0.04 + (Math.random() - 0.5) * 0.02;
        
        tempTarget = 32.0 + Math.sin(globalTime * 0.05 + j) * 0.5;

        if (activeFault === 'thermal_overload' && j === 2) {
          tempTarget = 115.0;
          simulatedTempRising[j] += dt * 12.0;
          
          if (simulatedTempRising[j] > 95.0 && cellState.systemMode !== 'ESTOP') {
            cellState.systemMode = 'ESTOP';
            cellState.isWeldingActive = false;
            
            const savedStateStr = localStorage.getItem('weldforge_cell_state');
            let state = {};
            if (savedStateStr) {
              try { state = JSON.parse(savedStateStr); } catch(e) {}
            }
            state.systemMode = 'ESTOP';
            state.isWeldingActive = false;
            state.activeFault = 'thermal_overload';
            localStorage.setItem('weldforge_cell_state', JSON.stringify(state));
            
            logDashboardEvent("🚨 CRITICAL THERMAL INTERLOCK TRIP: Joint 3 motor winding exceeded 95°C limit!");
          }
        } else {
          // Slowly cool down
          if (simulatedTempRising[j] > tempTarget) {
            simulatedTempRising[j] -= dt * 0.8; // cooling
          } else if (simulatedTempRising[j] < tempTarget) {
            simulatedTempRising[j] += dt * 0.2;
          }
        }
      }

      // Add dynamic mechanical chattering / fault surges to graphs
      if (cellState.systemMode !== 'ESTOP') {
        if (activeFault === 'gas_leak') {
          // Surge currents erratically on all joints
          currentVal += (Math.random() - 0.5) * 12.0;
          currentVal = Math.max(0.1, currentVal);
        }
        if (activeFault === 'gear_slip' && j === 2) {
          // Torque cosine chatter oscillation on J3
          torqueVal += Math.cos(globalTime * 30.0) * 35.0;
        }
        if (activeFault === 'joint_drift' && (j === 1 || j === 2)) {
          // Introduce tracking drift deviations
          torqueVal += Math.sin(globalTime * 0.5) * 15.0 + 10.0;
        }
      }

      // Feed arrays
      const torqArr = telemetryData.torque[j];
      torqArr.shift();
      torqArr.push(torqueVal);

      const currArr = telemetryData.current[j];
      currArr.shift();
      currArr.push(currentVal);

      const tempArr = telemetryData.temp[j];
      tempArr.shift();
      tempArr.push(simulatedTempRising[j] + (Math.random() - 0.5) * 0.1);
    }
  }

  // 6. Draw Scrolling Wave Lines on Canvas Elements
  function drawTelemetryChart(canvas, ctx, dataSet, unit, minVal, maxVal) {
    if (!canvas || !ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // A. Clear and paint backing grid
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, w, h);

    // subtle horizontal grids
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    const gridLines = 4;
    for (let i = 1; i < gridLines; i++) {
      const y = (h / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      // Draw values at grid boundaries
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '10px "Fira Code", monospace';
      const labelVal = maxVal - ((maxVal - minVal) / gridLines) * i;
      ctx.fillText(`${labelVal.toFixed(0)}${unit}`, 5, y - 3);
    }

    // vertical time grids
    const vGridLines = 10;
    for (let i = 1; i < vGridLines; i++) {
      const x = (w / vGridLines) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // B. Draw joint waves
    for (let j = 0; j < 6; j++) {
      const data = dataSet[j];
      ctx.strokeStyle = jointColors[j];
      ctx.lineWidth = 1.5;
      
      // Shadow glow effect
      ctx.shadowColor = jointColors[j];
      ctx.shadowBlur = 4;

      ctx.beginPath();
      for (let i = 0; i < dataPointsCount; i++) {
        const x = (w / (dataPointsCount - 1)) * i;
        // Normalize value between minVal & maxVal to fits canvas Y bounds
        let pct = (data[i] - minVal) / (maxVal - minVal);
        pct = Math.max(0.0, Math.min(1.0, pct));
        const y = h - pct * (h - 15) - 5;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Reset shadow values for next draw pass
    ctx.shadowBlur = 0;

    // C. Render legends in the top right corner
    ctx.font = '10px "Fira Code", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    
    // Draw current joint readouts horizontally
    let legendOffset = 10;
    for (let j = 0; j < 6; j++) {
      const lastVal = dataSet[j][dataPointsCount - 1];
      ctx.fillStyle = jointColors[j];
      
      const label = `J${j + 1}:${lastVal.toFixed(1)}${unit}`;
      ctx.fillText(label, legendOffset, 15);
      legendOffset += ctx.measureText(label).width + 12;
    }
  }

  // 7. Paint simulated Coaxial Camera Feed
  function drawSimulatedCamera(dt) {
    if (!canvasCamera || !ctxCamera) return;

    const w = canvasCamera.width;
    const h = canvasCamera.height;

    // A. Fill black
    ctxCamera.fillStyle = '#05070c';
    ctxCamera.fillRect(0, 0, w, h);

    // B. Draw scrolling metallic plate surface
    ctxCamera.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctxCamera.lineWidth = 1;
    
    // Metallic sheet patterns
    const metalScroll = (globalTime * 40) % 60;
    ctxCamera.fillStyle = '#0a0e17';
    ctxCamera.fillRect(0, 0, w, h);

    // Draw brushing grains
    ctxCamera.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    for (let y = -60; y < h; y += 4) {
      ctxCamera.beginPath();
      ctxCamera.moveTo(0, y + (metalScroll % 4));
      ctxCamera.lineTo(w, y + (metalScroll % 4));
      ctxCamera.stroke();
    }

    // Draw central V-Groove joint line
    ctxCamera.strokeStyle = '#1e293b';
    ctxCamera.lineWidth = 4;
    ctxCamera.beginPath();
    ctxCamera.moveTo(0, h / 2);
    ctxCamera.lineTo(w, h / 2);
    ctxCamera.stroke();

    // Inner bevel groove line
    ctxCamera.strokeStyle = '#0f172a';
    ctxCamera.lineWidth = 1.5;
    ctxCamera.beginPath();
    ctxCamera.moveTo(0, h / 2);
    ctxCamera.lineTo(w, h / 2);
    ctxCamera.stroke();

    let alarmActive = (activeFault !== 'none');
    let flashGlow = alarmActive && (Math.floor(Date.now() / 300) % 2 === 0);

    // Draw joint drift deviation path if active
    if (activeFault === 'joint_drift') {
      ctxCamera.strokeStyle = 'rgba(239, 68, 68, 0.7)';
      ctxCamera.lineWidth = 2;
      ctxCamera.setLineDash([4, 4]);
      ctxCamera.beginPath();
      ctxCamera.moveTo(0, h / 2 - 8);
      ctxCamera.lineTo(w, h / 2 + 10);
      ctxCamera.stroke();
      ctxCamera.setLineDash([]); // clear
    }

    // C. Weld Arc Light, flares, and sparks
    if (cellState.isWeldingActive && cellState.systemMode !== 'ESTOP') {
      // Weld spark travels across the horizontal seam based on progress
      const arcX = w * cellState.currentWeldProgress;
      const arcY = h / 2 + (activeFault === 'joint_drift' ? -8 + (18 * cellState.currentWeldProgress) : 0);

      // Draw previously laid cooling weld bead path
      let beadColor = cellState.activeWeldingMode === 'laser' ? '#d946ef' : (cellState.activeWeldingMode === 'plasma' ? '#06b6d4' : '#f97316');
      if (activeFault === 'gas_leak') {
        beadColor = '#475569'; // oxidized contaminated black bead
      }
      ctxCamera.strokeStyle = beadColor;
      ctxCamera.lineWidth = 3;
      ctxCamera.beginPath();
      ctxCamera.moveTo(0, h / 2);
      ctxCamera.lineTo(arcX, arcY);
      ctxCamera.stroke();

      // Flickering arc glow overlay
      const arcFlickerSize = 35 + Math.random() * 25;
      const gradient = ctxCamera.createRadialGradient(arcX, arcY, 2, arcX, arcY, arcFlickerSize);
      
      let arcColor = 'rgba(0, 240, 255, '; // MIG/TIG blue-white
      if (cellState.activeWeldingMode === 'laser') arcColor = 'rgba(255, 0, 255, ';
      if (cellState.activeWeldingMode === 'mig') arcColor = 'rgba(255, 110, 0, ';

      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.2, arcColor + '0.8)');
      gradient.addColorStop(0.5, arcColor + '0.3)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctxCamera.fillStyle = gradient;
      ctxCamera.beginPath();
      ctxCamera.arc(arcX, arcY, arcFlickerSize, 0, Math.PI * 2);
      ctxCamera.fill();

      // Blinding white arc core
      ctxCamera.fillStyle = '#ffffff';
      ctxCamera.beginPath();
      ctxCamera.arc(arcX, arcY, 4 + Math.random() * 3, 0, Math.PI * 2);
      ctxCamera.fill();

      // Lens flare lines
      ctxCamera.strokeStyle = '#ffffff';
      ctxCamera.lineWidth = 0.5;
      ctxCamera.beginPath();
      ctxCamera.moveTo(arcX - 100, arcY);
      ctxCamera.lineTo(arcX + 100, arcY);
      ctxCamera.moveTo(arcX, arcY - 40);
      ctxCamera.lineTo(arcX, arcY + 40);
      ctxCamera.stroke();

      // D. Bounding Box & HUD Label
      if (alarmActive) {
        if (Math.floor(Date.now() / 250) % 2 === 0) {
          ctxCamera.strokeStyle = 'var(--emergency-red)';
          ctxCamera.lineWidth = 1.5;
          ctxCamera.strokeRect(arcX - 35, arcY - 25, 70, 50);

          ctxCamera.font = '8px "Fira Code", monospace';
          ctxCamera.fillStyle = 'var(--emergency-red)';
          
          let alertLabel = "ANOMALY IDENTIFIED";
          let offsetLabelY = arcY - 30;
          
          if (activeFault === 'gas_leak') {
            alertLabel = "GAS POROSITY (ASTM E390)";
          } else if (activeFault === 'gear_slip') {
            alertLabel = "GEAR CHATTER DETECTED";
          } else if (activeFault === 'thermal_overload') {
            alertLabel = "THERMAL FLANGE EXCESSED";
          } else if (activeFault === 'joint_drift') {
            alertLabel = "TRACKING ERR > 2.5mm";
          }

          ctxCamera.fillText(alertLabel, arcX - 34, offsetLabelY);
        }
      } else {
        // Normal Box
        ctxCamera.strokeStyle = 'var(--safe-green)';
        ctxCamera.lineWidth = 1;
        ctxCamera.strokeRect(arcX - 25, arcY - 20, 50, 40);

        ctxCamera.font = '8px "Fira Code", monospace';
        ctxCamera.fillStyle = 'var(--safe-green)';
        ctxCamera.fillText("ARC ACTIVE: PASS", arcX - 24, arcY - 25);
      }
    } else {
      // Draw completed weld bead across the whole groove if completed, or nothing
      if (cellState.currentWeldProgress >= 1.0) {
        ctxCamera.strokeStyle = activeFault === 'gas_leak' ? '#475569' : '#334155'; // Cool slag steel color
        ctxCamera.lineWidth = 3;
        ctxCamera.beginPath();
        ctxCamera.moveTo(0, h / 2);
        ctxCamera.lineTo(w, h / 2);
        ctxCamera.stroke();
      }
    }

    // D. Static noise + rolling scanlines (High tech camera feel)
    ctxCamera.fillStyle = 'rgba(255, 255, 255, 0.012)';
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      ctxCamera.fillRect(x, y, 1, 1);
    }

    // Rolling scan line
    const scanlineY = (globalTime * 80) % h;
    ctxCamera.strokeStyle = alarmActive ? 'rgba(239, 68, 68, 0.08)' : 'rgba(0, 240, 255, 0.06)';
    ctxCamera.lineWidth = 2;
    ctxCamera.beginPath();
    ctxCamera.moveTo(0, scanlineY);
    ctxCamera.lineTo(w, scanlineY);
    ctxCamera.stroke();

    // E. Reticle HUD Overlay
    ctxCamera.strokeStyle = alarmActive ? 'rgba(239, 68, 68, 0.45)' : 'rgba(0, 240, 255, 0.25)';
    ctxCamera.lineWidth = 0.8;
    
    // Center reticle circle
    ctxCamera.beginPath();
    ctxCamera.arc(w / 2, h / 2, 20, 0, Math.PI * 2);
    ctxCamera.stroke();

    // Corner brackets
    const bracketSize = 10;
    ctxCamera.beginPath();
    // Top Left
    ctxCamera.moveTo(15, 15 + bracketSize); ctxCamera.lineTo(15, 15); ctxCamera.lineTo(15 + bracketSize, 15);
    // Top Right
    ctxCamera.moveTo(w - 15 - bracketSize, 15); ctxCamera.lineTo(w - 15, 15); ctxCamera.lineTo(w - 15, 15 + bracketSize);
    // Bottom Left
    ctxCamera.moveTo(15, h - 15 - bracketSize); ctxCamera.lineTo(15, h - 15); ctxCamera.lineTo(15 + bracketSize, h - 15);
    // Bottom Right
    ctxCamera.moveTo(w - 15 - bracketSize, h - 15); ctxCamera.lineTo(w - 15, h - 15); ctxCamera.lineTo(w - 15, h - 15 - bracketSize);
    ctxCamera.stroke();

    // Center Crosshairs
    ctxCamera.strokeStyle = alarmActive ? 'rgba(239, 68, 68, 0.25)' : 'rgba(0, 240, 255, 0.15)';
    ctxCamera.beginPath();
    ctxCamera.moveTo(w / 2 - 30, h / 2); ctxCamera.lineTo(w / 2 - 10, h / 2);
    ctxCamera.moveTo(w / 2 + 10, h / 2); ctxCamera.lineTo(w / 2 + 30, h / 2);
    ctxCamera.moveTo(w / 2, h / 2 - 30); ctxCamera.lineTo(w / 2, h / 2 - 10);
    ctxCamera.moveTo(w / 2, h / 2 + 10); ctxCamera.lineTo(w / 2, h / 2 + 30);
    ctxCamera.stroke();

    // Red outer frame flash if critical alarm
    if (flashGlow) {
      ctxCamera.strokeStyle = 'rgba(239, 68, 68, 0.5)';
      ctxCamera.lineWidth = 3;
      ctxCamera.strokeRect(0, 0, w, h);

      ctxCamera.fillStyle = 'rgba(239, 68, 68, 0.85)';
      ctxCamera.font = 'bold 9px "Inter", sans-serif';
      ctxCamera.fillText("⚠️ COAXIAL LENS ALARM FLAGGED", w / 2 - 75, 45);
    }

    // Text readouts on camera HUD
    ctxCamera.fillStyle = alarmActive ? 'rgba(239, 68, 68, 0.85)' : 'rgba(0, 240, 255, 0.7)';
    ctxCamera.font = '8px "Fira Code", monospace';
    ctxCamera.fillText("CAM LENS A // COAXIAL SEAM FEED", 20, 25);
    ctxCamera.fillText(`FPS: 60.0`, w - 70, 25);

    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').slice(0, 19);
    ctxCamera.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctxCamera.fillText(`TIME: ${timeStr}`, 20, h - 20);
    ctxCamera.fillText(`MODE: ${cellState.systemMode}`, w - 100, h - 20);
  }

  // 8. Main Render tick wrapper (Runs at 60 FPS)
  let lastTime = Date.now();
  function renderLoop() {
    requestAnimationFrame(renderLoop);

    const now = Date.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap dt at 100ms
    lastTime = now;

    // A. Update buffers and sensors
    updateRULGauges(dt);
    updateTelemetryData(dt);

    // B. Draw charts
    drawTelemetryChart(canvasTorque, ctxTorque, telemetryData.torque, 'Nm', -20, 120);
    drawTelemetryChart(canvasCurrent, ctxCurrent, telemetryData.current, 'A', 0, 30);
    drawTelemetryChart(canvasTemp, ctxTemp, telemetryData.temp, '°C', 20, 100);
    drawVibrationFFT();

    // C. Draw camera feed
    drawSimulatedCamera(dt);

    // D. Update SVG bindings and pneumatics
    updateSVGBindings();
    updateGasPneumatics(dt);
  }

  function drawVibrationFFT() {
    if (!canvasVibeFFT || !ctxVibeFFT) return;

    const w = canvasVibeFFT.width;
    const h = canvasVibeFFT.height;

    // Clear and paint backing grid
    ctxVibeFFT.fillStyle = '#05070a';
    ctxVibeFFT.fillRect(0, 0, w, h);

    // Subtle horizontal grid lines
    ctxVibeFFT.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctxVibeFFT.lineWidth = 1;
    const gridLines = 4;
    for (let i = 1; i < gridLines; i++) {
      const y = (h / gridLines) * i;
      ctxVibeFFT.beginPath();
      ctxVibeFFT.moveTo(0, y);
      ctxVibeFFT.lineTo(w, y);
      ctxVibeFFT.stroke();
    }

    const binsCount = 50;
    const barWidth = w / binsCount;

    // Render bars
    for (let i = 0; i < binsCount; i++) {
      let val = 0;

      if (cellState.systemMode === 'ESTOP') {
        // Complete flatline
        val = 0.5 + Math.random() * 0.5;
      } else {
        // Noise floor: 1px - 4px heights
        let noiseFloor = 1 + Math.random() * 3;
        
        // Minor peaks
        let peak50 = 0;
        // Peak at 50Hz (around bin 5)
        if (Math.abs(i - 5) < 2) {
          peak50 = (2 - Math.abs(i - 5)) * (8 + Math.random() * 4);
        }

        // Mechanical noise if welding is active
        let weldingNoise = 0;
        if (cellState.isWeldingActive) {
          weldingNoise = Math.random() * 5;
        }

        val = noiseFloor + peak50 + weldingNoise;

        // Injected fault chatter
        if (activeFault === 'gear_slip') {
          // Chaos across the spectrum
          val += Math.random() * 12;

          // Huge resonance spike at 180Hz (bin 18)
          if (Math.abs(i - 18) < 3) {
            val += (3 - Math.abs(i - 18)) * (22 + Math.random() * 15);
          }
          // Smaller harmonic at 360Hz (bin 36)
          if (Math.abs(i - 36) < 2) {
            val += (2 - Math.abs(i - 36)) * (8 + Math.random() * 8);
          }
        }
      }

      // Draw bar
      const barHeight = Math.min(h - 10, val * 2);
      const x = i * barWidth;
      const y = h - barHeight;

      // Color scheme matching
      let barColor = 'rgba(0, 136, 204, 0.65)'; // default nominal cyan
      if (cellState.isWeldingActive) {
        barColor = 'rgba(34, 197, 94, 0.7)'; // nominal green
      }
      if (activeFault === 'gear_slip') {
        if (Math.abs(i - 18) < 3) {
          barColor = 'rgba(239, 68, 68, 0.95)'; // massive red peak
        } else {
          barColor = 'rgba(217, 119, 6, 0.75)'; // gear slip warning orange
        }
      }

      ctxVibeFFT.fillStyle = barColor;
      ctxVibeFFT.fillRect(x, y, barWidth - 1.5, barHeight);
    }

    // Text labels
    ctxVibeFFT.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctxVibeFFT.font = '8px "Fira Code", monospace';
    ctxVibeFFT.fillText("0Hz", 5, h - 5);
    ctxVibeFFT.fillText("250Hz", w / 2 - 12, h - 5);
    ctxVibeFFT.fillText("500Hz", w - 30, h - 5);

    // Overlay warning text if chattering
    if (activeFault === 'gear_slip') {
      ctxVibeFFT.fillStyle = 'rgba(239, 68, 68, 0.85)';
      ctxVibeFFT.font = '10px "Fira Code", monospace';
      
      // Flash/blink logic based on Date.now()
      if (Math.floor(Date.now() / 400) % 2 === 0) {
        ctxVibeFFT.fillText("[ALARM] 180Hz Gear Backlash Resonance Spike!", 10, 20);
      }
    }
  }

  function updateSVGBindings() {
    const joints = cellState.jointAngles || [0, 15, -45, 0, 30, 0];
    const j2 = joints[1]; // J2 angle
    const j3 = joints[2]; // J3 angle

    // Convert degrees to radians for calculations
    const r2 = j2 * Math.PI / 180;
    const r3 = j3 * Math.PI / 180;

    // Calculate absolute coordinates
    const x3 = 23 + 32 * Math.cos(r2);
    const y3 = 24 - 32 * Math.sin(r2); // Joint 3 elbow center

    const x5 = x3 + 35 * Math.cos(r2 + r3);
    const y5 = y3 - 35 * Math.sin(r2 + r3); // Joint 5 wrist center

    const xTcp = x5 + 15 * Math.cos(r2 + r3 + Math.PI / 4);
    const yTcp = y5 - 15 * Math.sin(r2 + r3 + Math.PI / 4); // Slanted TCP tip

    // Update DOM attributes
    const link2 = document.getElementById('kin-link-2');
    const joint3 = document.getElementById('kin-joint-3');
    const link3 = document.getElementById('kin-link-3');
    const joint5 = document.getElementById('kin-joint-5');
    const link4 = document.getElementById('kin-link-4');

    if (link2) {
      link2.setAttribute('x2', x3.toFixed(1));
      link2.setAttribute('y2', y3.toFixed(1));
    }
    if (joint3) {
      joint3.setAttribute('cx', x3.toFixed(1));
      joint3.setAttribute('cy', y3.toFixed(1));
    }
    if (link3) {
      link3.setAttribute('x1', x3.toFixed(1));
      link3.setAttribute('y1', y3.toFixed(1));
      link3.setAttribute('x2', x5.toFixed(1));
      link3.setAttribute('y2', y5.toFixed(1));
    }
    if (joint5) {
      joint5.setAttribute('cx', x5.toFixed(1));
      joint5.setAttribute('cy', y5.toFixed(1));
    }
    if (link4) {
      link4.setAttribute('x1', x5.toFixed(1));
      link4.setAttribute('y1', y5.toFixed(1));
      link4.setAttribute('x2', xTcp.toFixed(1));
      link4.setAttribute('y2', yTcp.toFixed(1));
    }

    // Dynamic numeric coords overlay
    const coordsEl = document.getElementById('kin-tcp-coords');
    if (coordsEl) {
      const xMeters = (xTcp * 0.008).toFixed(2);
      const yMeters = (yTcp * 0.008).toFixed(2);
      const zMeters = (joints[0] * 0.005).toFixed(2); // use J1 angle as synthetic Z indicator
      coordsEl.textContent = `TCP: [${xMeters}, ${yMeters}, ${zMeters}]`;
    }

    const labelsEl = document.getElementById('kin-joint-lbls');
    if (labelsEl) {
      labelsEl.textContent = `J1:${Math.round(joints[0])}° J2:${Math.round(joints[1])}° J3:${Math.round(joints[2])}°`;
    }
  }

  function updateGasPneumatics(dt) {
    const gasLine = document.getElementById('gas-flow-line');
    const valveBox = document.getElementById('gas-valve-box');
    const valveText = document.getElementById('gas-valve-text');
    const flowText = document.getElementById('gas-flow-text');
    const pressureText = document.getElementById('gas-pressure-text');

    if (!gasLine) return;

    let flowRate = 0;
    let pressure = 0;
    let status = "SHUT";
    let color = 'rgba(100, 116, 139, 0.4)'; // muted gray
    let scrollSpeed = 0;

    if (cellState.systemMode === 'ESTOP') {
      flowRate = 0;
      pressure = 0.0;
      status = "ESTOP";
      color = 'var(--emergency-red)';
      scrollSpeed = 0;
    } else if (activeFault === 'gas_leak') {
      flowRate = 3.2;
      pressure = 1.2;
      status = "LEAK";
      color = 'var(--emergency-red)';
      scrollSpeed = 45; // scroll fast
    } else if (cellState.isWeldingActive) {
      status = "OPEN";
      color = 'var(--safe-green)';
      scrollSpeed = 25;
      
      if (cellState.activeWeldingMode === 'laser') {
        flowRate = 8;
        pressure = 3.5;
      } else if (cellState.activeWeldingMode === 'plasma') {
        flowRate = 18;
        pressure = 5.2;
      } else if (cellState.activeWeldingMode === 'tig') {
        flowRate = 12;
        pressure = 4.0;
      } else {
        flowRate = 15;
        pressure = 4.8;
      }
    } else {
      status = "STANDBY";
      color = 'var(--cyan-glow)';
      scrollSpeed = 5;
      flowRate = 0;
      pressure = 4.8;
    }

    // Scroll dashed lines
    if (scrollSpeed > 0) {
      gasDashOffset -= dt * scrollSpeed;
      gasLine.style.strokeDashoffset = gasDashOffset.toFixed(1);
    }

    // Set colors & text
    gasLine.style.stroke = color;
    
    if (valveBox) {
      valveBox.setAttribute('fill', color);
    }
    if (valveText) {
      valveText.textContent = status;
    }
    if (flowText) {
      flowText.textContent = `Flow: ${flowRate} L/min`;
      flowText.style.fill = color;
    }
    if (pressureText) {
      pressureText.textContent = `Press: ${pressure.toFixed(1)} Bar`;
    }
  }

  // 9. Dashboard AI Chat Co-pilot Controller & NLP Parser
  window.sendChatMessage = function() {
    const inputEl = document.getElementById('chat-user-input');
    const chatHistory = document.getElementById('chat-history-log');
    if (!inputEl || !chatHistory) return;

    const query = inputEl.value.trim();
    if (query === '') return;

    // Render User Message Bubble
    appendChatBubble(query, 'user');
    inputEl.value = '';

    // Play modern typing indicator bubble
    const typingBubble = appendChatBubble('AI Supervisor is calculating diagnostics...', 'bot');
    typingBubble.id = 'ai-typing-indicator';
    chatHistory.scrollTop = chatHistory.scrollHeight;

    // Process Command with NLP matching engine
    setTimeout(() => {
      // Remove typing bubble
      const indicator = document.getElementById('ai-typing-indicator');
      if (indicator) indicator.remove();

      const response = processDashboardAICommand(query);
      appendChatBubble(response, 'bot');
      chatHistory.scrollTop = chatHistory.scrollHeight;
    }, 600);
  };

  function appendChatBubble(text, sender) {
    const chatHistory = document.getElementById('chat-history-log');
    if (!chatHistory) return;
    const bubble = document.createElement('div');
    bubble.className = `chat-msg ${sender}`;
    
    // Inline styling overrides for beautiful bubble appearance
    if (sender === 'bot') {
      bubble.style.maxWidth = '85%';
      bubble.style.padding = '8px 10px';
      bubble.style.borderRadius = '8px';
      bubble.style.fontSize = '0.75rem';
      bubble.style.lineHeight = '1.35';
      bubble.style.background = 'rgba(15, 23, 42, 0.05)';
      bubble.style.border = '1px solid rgba(15, 23, 42, 0.03)';
      bubble.style.alignSelf = 'flex-start';
      bubble.style.color = 'var(--text-main)';
      bubble.style.marginBottom = '6px';
    } else {
      bubble.style.maxWidth = '85%';
      bubble.style.padding = '8px 10px';
      bubble.style.borderRadius = '8px';
      bubble.style.fontSize = '0.75rem';
      bubble.style.lineHeight = '1.35';
      bubble.style.background = 'linear-gradient(135deg, rgba(0, 136, 204, 0.08), rgba(0, 102, 204, 0.15))';
      bubble.style.border = '1px solid var(--border-glow)';
      bubble.style.alignSelf = 'flex-end';
      bubble.style.color = 'var(--text-main)';
      bubble.style.fontWeight = '600';
      bubble.style.marginBottom = '6px';
    }
    
    bubble.innerHTML = text;
    chatHistory.appendChild(bubble);
    return bubble;
  }

  function extractDimensions(query) {
    const clean = query.toLowerCase();
    let length = null;
    let width = null;
    let thickness = null;

    // Convert to meters helper
    function toMeters(val, unit) {
      if (!unit) {
        return val > 2 ? val / 100 : val; // default to cm for length/breadth, or mm if thickness > 2
      }
      if (unit.startsWith('cm') || unit.startsWith('centimeter')) return val / 100;
      if (unit.startsWith('mm') || unit.startsWith('millimeter')) return val / 1000;
      if (unit.startsWith('m') || unit.startsWith('meter')) return val;
      return val;
    }

    // Look for labeled matches e.g. "length 50cm" or "l=50cm" or "50 cm long"
    const lengthMatch = clean.match(/(?:length|len|l|long)\s*(?:of|is|:|=)?\s*(\d+(?:\.\d+)?)\s*(cm|mm|m|centimeter|millimeter|meter)?s?/);
    if (lengthMatch) {
      length = toMeters(parseFloat(lengthMatch[1]), lengthMatch[2]);
    }

    const widthMatch = clean.match(/(?:breadth|width|wide|w|b)\s*(?:of|is|:|=)?\s*(\d+(?:\.\d+)?)\s*(cm|mm|m|centimeter|millimeter|meter)?s?/);
    if (widthMatch) {
      width = toMeters(parseFloat(widthMatch[1]), widthMatch[2]);
    }

    const thickMatch = clean.match(/(?:height|thickness|thick|h|t)\s*(?:of|is|:|=)?\s*(\d+(?:\.\d+)?)\s*(cm|mm|m|centimeter|millimeter|meter)?s?/);
    if (thickMatch) {
      thickness = toMeters(parseFloat(thickMatch[1]), thickMatch[2]);
    }

    // Fallback to ordered scanner (Length, Width, Thickness) if any is still null
    const allMatches = [];
    let m;
    const regex = /(\d+(?:\.\d+)?)\s*(cm|mm|m|centimeter|millimeter|meter)?s?/g;
    while ((m = regex.exec(clean)) !== null) {
      const val = parseFloat(m[1]);
      const unit = m[2];
      
      // Skip numbers indicating quantities like "2 pieces"
      const startIdx = m.index;
      const preText = clean.substring(Math.max(0, startIdx - 15), startIdx);
      const postText = clean.substring(startIdx + m[0].length, Math.min(clean.length, startIdx + m[0].length + 15));
      if (postText.includes('piece') || postText.includes('plate') || postText.includes('qty') || preText.includes('qty')) {
        continue;
      }
      
      allMatches.push({ val, unit });
    }

    if (allMatches.length > 0) {
      if (length === null) {
        length = toMeters(allMatches[0].val, allMatches[0].unit || 'cm');
      }
      if (allMatches.length > 1 && width === null) {
        width = toMeters(allMatches[1].val, allMatches[1].unit || 'cm');
      }
      if (allMatches.length > 2 && thickness === null) {
        let unit = allMatches[2].unit;
        if (!unit && allMatches[2].val > 2) unit = 'mm';
        thickness = toMeters(allMatches[2].val, unit || 'mm');
      }
    }

    return { length, width, thickness };
  }

  function processDashboardAICommand(query) {
    const cleanQuery = query.toLowerCase();

    // A. EMERGENCY STOP
    if (cleanQuery.includes('estop') || cleanQuery.includes('emergency') || cleanQuery.includes('stop') || cleanQuery.includes('shutdown')) {
      activeFault = 'none';
      const savedStateStr = localStorage.getItem('weldforge_cell_state');
      let state = {};
      if (savedStateStr) {
        try { state = JSON.parse(savedStateStr); } catch(e) {}
      }
      state.systemMode = 'ESTOP';
      state.isWeldingActive = false;
      state.activeFault = 'none';
      localStorage.setItem('weldforge_cell_state', JSON.stringify(state));
      logDashboardEvent("🚨 E-STOP INTERLOCK ACTIVATED via Dashboard AI command.");
      return `🚨 <b>CRITICAL ALARM INSTANTLY ACTIVATED</b><br>
              Robot joints frozen. Flange power cut off. Active weld extinguished.<br>
              <i>E-STOP command registered successfully. Cell is locked.</i>`;
    }

    // B. RESET / CLEAR EMERGENCY
    if (cleanQuery.includes('reset') || cleanQuery.includes('resume') || cleanQuery.includes('clear') || cleanQuery.includes('unlock')) {
      activeFault = 'none';
      const savedStateStr = localStorage.getItem('weldforge_cell_state');
      let state = {};
      if (savedStateStr) {
        try { state = JSON.parse(savedStateStr); } catch(e) {}
      }
      state.systemMode = 'IDLE';
      state.isWeldingActive = false;
      state.activeFault = 'none';
      localStorage.setItem('weldforge_cell_state', JSON.stringify(state));
      
      // Clear temperature spikes too
      simulatedTempRising = [32, 32, 32, 32, 32, 32];
      logDashboardEvent("✅ Emergency interlock loop reset via Dashboard AI command.");
      return `✅ <b>CELL RESTORED TO STANDBY STATE</b><br>
              Interlocks cleared. Re-engaging servo actuators.<br>
              <i>Cell status updated: TELEMETRY READY (IDLE).</i>`;
    }

    // C. HOME / STANDBY
    if (cleanQuery.includes('home') || cleanQuery.includes('standby') || cleanQuery.includes('retract')) {
      if (cellState.isWeldingActive) {
        return `⚠️ <b>COMMAND REJECTED</b>: Cannot return to home while active welding arc is engaged. Cut the arc or invoke E-STOP first.`;
      }
      const savedStateStr = localStorage.getItem('weldforge_cell_state');
      let state = {};
      if (savedStateStr) {
        try { state = JSON.parse(savedStateStr); } catch(e) {}
      }
      state.requestHoming = true;
      state.homingTrigger = Date.now();
      localStorage.setItem('weldforge_cell_state', JSON.stringify(state));
      logDashboardEvent("🤖 Homing sequence requested via Dashboard AI.");
      return `🤖 <b>HOMING ACTION INITIATED</b><br>
              Instructing 6-axis links to return to standby home coordinate position.<br>
              <i>Command dispatched to WebGL scene.</i>`;
    }

    // INTERCEPT DIALOGUE STATE: Check if conversational dimensions request is pending
    const pendingConfigStr = localStorage.getItem('pending_weld_config');
    if (pendingConfigStr) {
      if (cleanQuery.includes('cancel') || cleanQuery.includes('exit') || cleanQuery.includes('abort')) {
        localStorage.removeItem('pending_weld_config');
        return `❌ <b>WELD COMPILATION CANCELED</b><br>
                Pending custom joint parameters purged. Cell has returned to nominal standby.<br>
                <i>Awaiting next command.</i>`;
      }

      const dims = extractDimensions(query);
      if (dims.length !== null || dims.width !== null || dims.thickness !== null) {
        let pending = JSON.parse(pendingConfigStr);
        
        // Merge dimensions, applying strict table safety limits
        const length = dims.length !== null ? Math.max(0.1, Math.min(0.68, dims.length)) : 0.36;
        const width = dims.width !== null ? Math.max(0.02, Math.min(0.2, dims.width)) : 0.08;
        const thickness = dims.thickness !== null ? Math.max(0.002, Math.min(0.05, dims.thickness)) : 0.015;
        
        const qty = pending.qty || 2;
        const material = pending.material || 'steel';
        const mode = pending.mode || 'mig';
        const jointType = pending.jointType || 'square';
        
        const customConfig = {
          material: material,
          length: length,
          width: width,
          thickness: thickness,
          qty: qty,
          jointType: jointType,
          timestamp: Date.now()
        };

        // Clear pending dialogue state
        localStorage.removeItem('pending_weld_config');

        // Write to state
        activeFault = 'none';
        const stateStr = localStorage.getItem('weldforge_cell_state');
        let state = {};
        if (stateStr) {
          try { state = JSON.parse(stateStr); } catch(e) {}
        }
        state.systemMode = 'WELDING';
        state.isWeldingActive = true;
        state.activeWorkpieceMaterial = material;
        state.activeWeldingMode = mode;
        state.currentWeldProgress = 0.0;
        state.triggerWeldTrigger = Date.now();
        state.customPartConfig = customConfig;
        state.activeFault = 'none';
        localStorage.setItem('weldforge_cell_state', JSON.stringify(state));

        logDashboardEvent(`🔥 Dynamic sequence triggered: Two ${(length * 100).toFixed(0)}cm ${material.toUpperCase()} plates via Dashboard AI.`);

        // Advanced Physics Calculator Engine
        let voltage = 24.0;
        let current = 220.0; 
        let travelSpeed = 4.8; // mm/s
        let eta = 0.8; // MIG efficiency
        let techName = mode.toUpperCase() + ' Pulse';

        const modeKey = mode.toLowerCase().replace(/[^a-z]/g, '');
        if (modeKey === 'tig') { voltage = 14.5; current = 160.0; travelSpeed = 3.2; eta = 0.6; techName = 'TIG Precision'; }
        else if (modeKey === 'laser') { voltage = 45.0; current = 100.0; travelSpeed = 8.5; eta = 0.7; techName = 'Laser Fusion'; }
        else if (modeKey === 'plasma') { voltage = 32.0; current = 260.0; travelSpeed = 5.5; eta = 0.85; techName = 'Plasma Keyhole'; }
        else if (modeKey === 'stick' || modeKey === 'mma') { voltage = 26.0; current = 180.0; travelSpeed = 3.5; eta = 0.75; techName = 'Stick/MMA Shielded'; }
        else if (modeKey === 'friction') { voltage = 0.0; current = 0.0; travelSpeed = 6.0; eta = 0.9; techName = 'Solid-State Friction'; }
        else if (modeKey === 'electronbeam') { voltage = 150000.0; current = 0.045; travelSpeed = 12.0; eta = 0.9; techName = 'Electron Beam'; }
        else if (modeKey === 'saw') { voltage = 32.0; current = 450.0; travelSpeed = 6.0; eta = 0.9; techName = 'Submerged Arc (SAW)'; }

        // Dynamic yield strength (MPa) database
        const yieldDB = {
          steel: 350, iron: 250, aluminum: 275, copper: 200, titanium: 830,
          gold: 100, silver: 140, bronze: 180, brass: 150, platinum: 120,
          nickel: 220, cobalt: 450, lead: 15, zinc: 120
        };
        const matLower = material.toLowerCase().trim();
        let yieldStrength = yieldDB[matLower];
        if (!yieldStrength) {
          let charSum = 0;
          for (let i = 0; i < matLower.length; i++) charSum += matLower.charCodeAt(i);
          yieldStrength = 100 + (charSum % 400); // 100 - 500 MPa range
        }

        // Joint Geometry Efficiency Factor
        let jointEff = 0.8;
        if (jointType === 'square') jointEff = 1.0;
        else if (jointType === 'lap') jointEff = 0.7;
        else if (jointType === 't-joint') jointEff = 0.8;
        else if (jointType === 'corner') jointEff = 0.85;
        else if (jointType === 'v-butt') jointEff = 0.95;

        // Calculations
        let heatInput = 0.0;
        let heatFormula = '';
        if (modeKey === 'friction') {
          const frictionPower = 3.6; // kW estimated mechanical friction power
          heatInput = (frictionPower / travelSpeed).toFixed(3);
          heatFormula = `$$H = \\frac{P_{\\text{friction}}}{v} = \\frac{${frictionPower} \\text{ kW}}{${travelSpeed} \\text{ mm/s}}$$`;
        } else if (modeKey === 'electronbeam') {
          const ebPower = voltage * current; // Watts
          heatInput = (eta * ebPower / (travelSpeed * 1000)).toFixed(3);
          heatFormula = `$$H = \\eta \\cdot \\frac{U \\cdot I}{v} = 0.9 \\cdot \\frac{150 \\text{ kV} \\cdot 45 \\text{ mA}}{${travelSpeed} \\text{ mm/s}}$$`;
        } else {
          heatInput = (eta * (voltage * current) / (travelSpeed * 1000)).toFixed(3);
          heatFormula = `$$H = \\eta \\cdot \\frac{U \\cdot I}{v} = ${eta} \\cdot \\frac{${voltage} \\text{ V} \\cdot ${current} \\text{ A}}{${travelSpeed} \\text{ mm/s}}$$`;
        }

        const seamArea = (length * 1000) * (thickness * 1000); // mm2
        const forceLimit = (yieldStrength * seamArea * jointEff / 1000).toFixed(1); // kN

        let preheatMsg = 'None';
        if (thickness > 0.02 || ['steel', 'iron'].includes(matLower)) {
          preheatMsg = '120°C Preheat Recommended to prevent cold cracking.';
        } else if (matLower === 'copper') {
          preheatMsg = '150°C Preheat Mandatory due to high thermal dissipation.';
        } else if (matLower === 'titanium') {
          preheatMsg = 'Chamber Backing Shielding Gas required. Do not preheat.';
        } else if (['gold', 'silver'].includes(matLower)) {
          preheatMsg = '50°C micro-tempering suggested to secure weld boundary.';
        }

        return `🔥 <b>AUTONOMOUS WELD COMPILER ENGAGED</b><br>
                • Task: Custom-sized joint construction<br>
                • Material: <b>${material.toUpperCase()}</b> plates (Qty: <b>${qty}</b>)<br>
                • Joint Configuration: <b>${jointType.toUpperCase()}</b> joint<br>
                • Size Compiled:<br>
                  - Length: <b>${(length * 100).toFixed(1)} cm</b> (table boundaries checked)<br>
                  - Breadth/Width: <b>${(width * 100).toFixed(1)} cm</b><br>
                  - Height/Thickness: <b>${(thickness * 1000).toFixed(1)} mm</b><br>
                • Technology: <b>${techName} Process</b><br><br>
                
                🎓 <b>SCADA THERMAL & STRENGTH EQUATION MODULES:</b><br>
                <b>1. Welding Heat Input ($H$):</b><br>
                ${heatFormula}
                Joint Heat Input ($H$): <span style="color:var(--cyan-glow); font-weight:bold;">${heatInput} kJ/mm</span><br><br>

                <b>2. Ultimate Joint Tensile Strength ($F_{\\text{limit}}$):</b><br>
                $$F_{\\text{limit}} = \\sigma_{\\text{yield}} \\cdot A_{\\text{seam}} \\cdot \\eta_{\\text{joint}}$$
                - Mat. Yield Strength ($\\sigma_{\\text{yield}}$) = <b>${yieldStrength} MPa</b><br>
                - Seam Cross-Sectional Area ($A_{\\text{seam}}$) = <b>${seamArea.toFixed(0)} mm²</b><br>
                - Joint Geometry Efficiency Factor ($\\eta_{\\text{joint}}$) = <b>${jointEff}</b><br>
                Ultimate Weld Load Limit ($F_{\\text{limit}}$): <span style="color:var(--cyan-glow); font-weight:bold;">${forceLimit} kN</span> (~${(forceLimit * 101.97).toFixed(0)} kg capacity)<br><br>

                ⚙️ <b>METALLURGICAL PROCEDURAL GUIDELINES:</b><br>
                • Preheating Command: <b>${preheatMsg}</b><br><br>

                <i>Physical meshes dynamically generated. Clamping table locator pin adjusted!</i>`;
      } else {
        return `⚠️ <b>DIMENSIONS REQUIRED</b><br>
                I could not parse valid length, breadth, or thickness from your input.<br>
                Please enter the physical dimensions, e.g.:<br>
                • <i>"Length 50cm, width 10cm, height 15mm"</i><br>
                • <i>"50cm breadth 10cm height 12mm"</i><br><br>
                <i>Or type <b>'cancel'</b> to abort weld compilation.</i>`;
      }
    }

    // D. DYNAMIC CUSTOM WORKPIECE WELD COMMAND (e.g. "weld two pieces of iron square joint")
    if (cleanQuery.includes('weld') && (cleanQuery.includes('piece') || cleanQuery.includes('plate') || cleanQuery.includes('joint') || cleanQuery.includes('weld') || cleanQuery.includes('metal'))) {
      if (cellState.systemMode === 'ESTOP') {
        return `🚨 <b>COMMAND REJECTED</b>: System is currently in E-STOP state. Clear the alarm and unlock the cell first.`;
      }

      // 1. STATEFUL DIMENSION SCANNING
      const dims = extractDimensions(query);

      // Dynamic Material Extractor (handles any material name!)
      let material = 'steel';
      const materialList = ['steel', 'iron', 'aluminum', 'copper', 'titanium', 'gold', 'silver', 'bronze', 'brass', 'platinum', 'nickel', 'cobalt', 'lead', 'zinc'];
      
      // Check direct matching first
      let matchedMat = false;
      for (const m of materialList) {
        if (cleanQuery.includes(m)) {
          material = m;
          matchedMat = true;
          break;
        }
      }
      
      // Fallback regex scan to extract raw name after "pieces of", "plates of", "weld some" or "weld [material]"
      if (!matchedMat) {
        const matchPatterns = [
          /pieces?\s+of\s+([a-z0-9\-]+)/,
          /plates?\s+of\s+([a-z0-9\-]+)/,
          /weld\s+some\s+([a-z0-9\-]+)/,
          /weld\s+two\s+([a-z0-9\-]+)/,
          /weld\s+([a-z0-9\-]+)\s+plates?/,
          /weld\s+([a-z0-9\-]+)\s+pieces?/
        ];
        for (const rx of matchPatterns) {
          const m = cleanQuery.match(rx);
          if (m && m[1] && !['two', 'three', 'single', 'lap', 'square', 'tee', 'joint', 'weld', 'some'].includes(m[1])) {
            material = m[1];
            matchedMat = true;
            break;
          }
        }
      }
      
      // Ultimate split filter fallback: extract first significant non-stopword after 'weld'
      if (!matchedMat) {
        const words = cleanQuery.split(/\s+/);
        const idx = words.indexOf('weld');
        if (idx !== -1 && idx < words.length - 1) {
          for (let i = idx + 1; i < words.length; i++) {
            const w = words[i].replace(/[^a-z]/g, '');
            if (w && !['two', 'pieces', 'plates', 'of', 'some', 'a', 'an', 'the', 'with', 'using', 'in', 'mode', 'joint', 'joints', 'flat', 'square', 'lap'].includes(w)) {
              material = w;
              break;
            }
          }
        }
      }

      // Dynamic Welding Technology Extractor (handles any tech/mode!)
      let mode = 'mig';
      const techList = ['mig', 'tig', 'laser', 'plasma', 'stick', 'mma', 'friction', 'electronbeam', 'saw'];
      let matchedTech = false;
      for (const t of techList) {
        if (cleanQuery.replace(/[^a-z]/g, '').includes(t)) {
          mode = t;
          matchedTech = true;
          break;
        }
      }
      // Check for suffix " welding", " process", " mode", e.g. "ultrasonic welding"
      if (!matchedTech) {
        const m = cleanQuery.match(/([a-z0-9\-]+)\s*(?:welding|mode|process|tech)/);
        if (m && m[1] && !['pulse', 'arc', 'joint', 'flat', 'custom'].includes(m[1])) {
          mode = m[1];
        }
      }

      // Joint Configuration Extractor
      let jointType = 'square';
      if (cleanQuery.includes('lap')) jointType = 'lap';
      else if (cleanQuery.includes('t-joint') || cleanQuery.includes('t joint') || cleanQuery.includes('tee') || cleanQuery.includes('fillet')) jointType = 't-joint';
      else if (cleanQuery.includes('corner')) jointType = 'corner';
      else if (cleanQuery.includes('v-butt') || cleanQuery.includes('v butt') || cleanQuery.includes('v-groove')) jointType = 'v-butt';
      else if (cleanQuery.includes('bevel')) jointType = 'bevel';
      else if (cleanQuery.includes('edge')) jointType = 'edge';

      // Quantity Parsing
      let qty = 2; 
      if (cleanQuery.includes('single') || cleanQuery.includes('one') || cleanQuery.includes(' 1 ') || cleanQuery.includes(' 1 piece')) {
        qty = 1;
      } else if (cleanQuery.includes('three') || cleanQuery.includes(' 3 ')) {
        qty = 3;
      }

      // If dimensions are missing, trigger stateful conversational dialog
      if (dims.length === null) {
        const pendingConfig = {
          material: material,
          mode: mode,
          jointType: jointType,
          qty: qty,
          timestamp: Date.now()
        };
        localStorage.setItem('pending_weld_config', JSON.stringify(pendingConfig));

        return `🤖 <b>WELDFORGE-X WELD AI FORGE COMPILER INITIALIZED</b><br>
                I detected your open-ended request to weld:<br>
                • Material: <b style="color:var(--cyan-glow);">${material.toUpperCase()}</b> plates (Qty: <b>${qty}</b>)<br>
                • Joint Geometry: <b style="color:var(--cyan-glow);">${jointType.toUpperCase()}</b> joint<br>
                • Weld Technology: <b style="color:var(--cyan-glow);">${mode.toUpperCase()} Welding</b><br><br>
                Before I can run KUKA's numerical path solver and spawn the 3D meshes, <b>please specify the physical parameters:</b><br>
                - What is the <b>Length</b>? (e.g. <i>50 cm</i>)<br>
                - What is the <b>Breadth / Width</b>? (e.g. <i>10 cm</i>)<br>
                - What is the <b>Height / Thickness</b>? (e.g. <i>15 mm</i>)<br><br>
                <i>Awaiting dimensions... (Type 'cancel' to abort)</i>`;
      }

      // Dimensions ARE present in original command! Compile immediately.
      let lengthRaw = dims.length;
      let widthRaw = dims.width !== null ? dims.width : 0.08;
      let thicknessRaw = dims.thickness !== null ? dims.thickness : 0.015;

      // Apply strict table boundaries and notify user of clamping
      let limitsMessage = '';
      let length = lengthRaw;
      if (lengthRaw < 0.1) { length = 0.1; limitsMessage += `• <i>Length increased to 10cm safety limit</i><br>`; }
      else if (lengthRaw > 0.68) { length = 0.68; limitsMessage += `• <i>Length restricted to 68cm table limit</i><br>`; }

      let width = widthRaw;
      if (widthRaw < 0.02) { width = 0.02; limitsMessage += `• <i>Width increased to 2cm safety limit</i><br>`; }
      else if (widthRaw > 0.2) { width = 0.2; limitsMessage += `• <i>Width restricted to 20cm table limit</i><br>`; }

      let thickness = thicknessRaw;
      if (thicknessRaw < 0.002) { thickness = 0.002; limitsMessage += `• <i>Thickness increased to 2mm safety limit</i><br>`; }
      else if (thicknessRaw > 0.05) { thickness = 0.05; limitsMessage += `• <i>Thickness restricted to 50mm heavy plate limit</i><br>`; }

      if (limitsMessage !== '') {
        limitsMessage = `⚠️ <b>SAFETY BOUNDARY CLAMPING LOGS:</b><br>${limitsMessage}<br>`;
      }

      const customConfig = {
        material: material,
        length: length,
        width: width,
        thickness: thickness,
        qty: qty,
        jointType: jointType,
        timestamp: Date.now()
      };

      activeFault = 'none';
      const stateStr = localStorage.getItem('weldforge_cell_state');
      let state = {};
      if (stateStr) {
        try { state = JSON.parse(stateStr); } catch(e) {}
      }
      state.systemMode = 'WELDING';
      state.isWeldingActive = true;
      state.activeWorkpieceMaterial = material;
      state.activeWeldingMode = mode;
      state.currentWeldProgress = 0.0;
      state.triggerWeldTrigger = Date.now();
      state.customPartConfig = customConfig;
      state.activeFault = 'none';
      localStorage.setItem('weldforge_cell_state', JSON.stringify(state));

      logDashboardEvent(`🔥 Dynamic sequence triggered: Two ${(length * 100).toFixed(0)}cm ${material.toUpperCase()} plates via Dashboard AI.`);

      // Advanced Physics Calculator Engine
      let voltage = 24.0;
      let current = 220.0; 
      let travelSpeed = 4.8; // mm/s
      let eta = 0.8; // MIG efficiency
      let techName = mode.toUpperCase() + ' Pulse';

      const modeKey = mode.toLowerCase().replace(/[^a-z]/g, '');
      if (modeKey === 'tig') { voltage = 14.5; current = 160.0; travelSpeed = 3.2; eta = 0.6; techName = 'TIG Precision'; }
      else if (modeKey === 'laser') { voltage = 45.0; current = 100.0; travelSpeed = 8.5; eta = 0.7; techName = 'Laser Fusion'; }
      else if (modeKey === 'plasma') { voltage = 32.0; current = 260.0; travelSpeed = 5.5; eta = 0.85; techName = 'Plasma Keyhole'; }
      else if (modeKey === 'stick' || modeKey === 'mma') { voltage = 26.0; current = 180.0; travelSpeed = 3.5; eta = 0.75; techName = 'Stick/MMA Shielded'; }
      else if (modeKey === 'friction') { voltage = 0.0; current = 0.0; travelSpeed = 6.0; eta = 0.9; techName = 'Solid-State Friction'; }
      else if (modeKey === 'electronbeam') { voltage = 150000.0; current = 0.045; travelSpeed = 12.0; eta = 0.9; techName = 'Electron Beam'; }
      else if (modeKey === 'saw') { voltage = 32.0; current = 450.0; travelSpeed = 6.0; eta = 0.9; techName = 'Submerged Arc (SAW)'; }

      // Dynamic yield strength (MPa) database
      const yieldDB = {
        steel: 350, iron: 250, aluminum: 275, copper: 200, titanium: 830,
        gold: 100, silver: 140, bronze: 180, brass: 150, platinum: 120,
        nickel: 220, cobalt: 450, lead: 15, zinc: 120
      };
      const matLower = material.toLowerCase().trim();
      let yieldStrength = yieldDB[matLower];
      if (!yieldStrength) {
        // Procedural hashing for exotic materials yield strength
        let charSum = 0;
        for (let i = 0; i < matLower.length; i++) charSum += matLower.charCodeAt(i);
        yieldStrength = 100 + (charSum % 400); // 100 - 500 MPa range
      }

      // Joint Geometry Efficiency Factor
      let jointEff = 0.8;
      if (jointType === 'square') jointEff = 1.0;
      else if (jointType === 'lap') jointEff = 0.7;
      else if (jointType === 't-joint') jointEff = 0.8;
      else if (jointType === 'corner') jointEff = 0.85;
      else if (jointType === 'v-butt') jointEff = 0.95;

      // Calculations
      let heatInput = 0.0;
      let heatFormula = '';
      if (modeKey === 'friction') {
        // Friction mechanical heat equation
        const frictionPower = 3.6; // kW estimated mechanical friction power
        heatInput = (frictionPower / travelSpeed).toFixed(3);
        heatFormula = `$$H = \\frac{P_{\\text{friction}}}{v} = \\frac{${frictionPower} \\text{ kW}}{${travelSpeed} \\text{ mm/s}}$$`;
      } else if (modeKey === 'electronbeam') {
        // Electron beam power: High voltage * beam current
        const ebPower = voltage * current; // Watts
        heatInput = (eta * ebPower / (travelSpeed * 1000)).toFixed(3);
        heatFormula = `$$H = \\eta \\cdot \\frac{U \\cdot I}{v} = 0.9 \\cdot \\frac{150 \\text{ kV} \\cdot 45 \\text{ mA}}{${travelSpeed} \\text{ mm/s}}$$`;
      } else {
        heatInput = (eta * (voltage * current) / (travelSpeed * 1000)).toFixed(3);
        heatFormula = `$$H = \\eta \\cdot \\frac{U \\cdot I}{v} = ${eta} \\cdot \\frac{${voltage} \\text{ V} \\cdot ${current} \\text{ A}}{${travelSpeed} \\text{ mm/s}}$$`;
      }

      const seamArea = (length * 1000) * (thickness * 1000); // mm2
      const forceLimit = (yieldStrength * seamArea * jointEff / 1000).toFixed(1); // kN

      let preheatMsg = 'None';
      if (thickness > 0.02 || ['steel', 'iron'].includes(matLower)) {
        preheatMsg = '120°C Preheat Recommended to prevent cold cracking.';
      } else if (matLower === 'copper') {
        preheatMsg = '150°C Preheat Mandatory due to high thermal dissipation.';
      } else if (matLower === 'titanium') {
        preheatMsg = 'Chamber Backing Shielding Gas required. Do not preheat.';
      } else if (['gold', 'silver'].includes(matLower)) {
        preheatMsg = '50°C micro-tempering suggested to secure weld boundary.';
      }

      return `🔥 <b>AUTONOMOUS WELD COMPILER ENGAGED</b><br>
              • Task: Open-ended Custom AI Forge Construction<br>
              • Material: <b style="color:var(--cyan-glow);">${material.toUpperCase()}</b> plates (Qty: <b>${qty}</b>)<br>
              • Joint Configuration: <b>${jointType.toUpperCase()}</b> joint<br>
              • Size Compiled:<br>
                - Length: <b>${(length * 100).toFixed(1)} cm</b><br>
                - Breadth/Width: <b>${(width * 100).toFixed(1)} cm</b><br>
                - Height/Thickness: <b>${(thickness * 1000).toFixed(1)} mm</b><br>
              • Technology: <b>${techName} Process</b><br><br>

              ${limitsMessage}

              🎓 <b>SCADA THERMAL & STRENGTH EQUATION MODULES:</b><br>
              <b>1. Welding Heat Input ($H$):</b><br>
              ${heatFormula}
              Joint Heat Input ($H$): <span style="color:var(--cyan-glow); font-weight:bold;">${heatInput} kJ/mm</span><br><br>

              <b>2. Ultimate Joint Tensile Strength ($F_{\\text{limit}}$):</b><br>
              $$F_{\\text{limit}} = \\sigma_{\\text{yield}} \\cdot A_{\\text{seam}} \\cdot \\eta_{\\text{joint}}$$
              - Mat. Yield Strength ($\\sigma_{\\text{yield}}$) = <b>${yieldStrength} MPa</b><br>
              - Seam Cross-Sectional Area ($A_{\\text{seam}}$) = <b>${seamArea.toFixed(0)} mm²</b><br>
              - Joint Geometry Efficiency Factor ($\\eta_{\\text{joint}}$) = <b>${jointEff}</b><br>
              Ultimate Weld Load Limit ($F_{\\text{limit}}$): <span style="color:var(--cyan-glow); font-weight:bold;">${forceLimit} kN</span> (~${(forceLimit * 101.97).toFixed(0)} kg capacity)<br><br>

              ⚙️ <b>METALLURGICAL PROCEDURAL GUIDELINES:</b><br>
              • Preheat Command: <b>${preheatMsg}</b><br><br>

              <i>Physical meshes dynamically generated and synchronized. Clamping table locator pin adjusted!</i>`;
    }

    // E. WELD SEQUENCE (Standard fallback)
    if (cleanQuery.includes('weld') || cleanQuery.includes('start') || cleanQuery.includes('execute') || cleanQuery.includes('run')) {
      if (cellState.systemMode === 'ESTOP') {
        return `🚨 <b>COMMAND REJECTED</b>: System is currently in E-STOP state. Clear the alarm and unlock the cell first.`;
      }

      let material = cellState.activeWorkpieceMaterial || 'steel';
      if (cleanQuery.includes('aluminum') || cleanQuery.includes('alum')) material = 'aluminum';
      if (cleanQuery.includes('copper') || cleanQuery.includes('copr')) material = 'copper';
      if (cleanQuery.includes('titanium') || cleanQuery.includes('titan')) material = 'titanium';
      if (cleanQuery.includes('iron')) material = 'iron';

      let mode = cellState.activeWeldingMode || 'mig';
      if (cleanQuery.includes('tig')) mode = 'tig';
      if (cleanQuery.includes('laser')) mode = 'laser';
      if (cleanQuery.includes('plasma')) mode = 'plasma';

      activeFault = 'none';
      const savedStateStr = localStorage.getItem('weldforge_cell_state');
      let state = {};
      if (savedStateStr) {
        try { state = JSON.parse(savedStateStr); } catch(e) {}
      }
      state.systemMode = 'WELDING';
      state.isWeldingActive = true;
      state.activeWorkpieceMaterial = material;
      state.activeWeldingMode = mode;
      state.currentWeldProgress = 0.0;
      state.triggerWeldTrigger = Date.now();
      state.activeFault = 'none';
      localStorage.setItem('weldforge_cell_state', JSON.stringify(state));

      logDashboardEvent(`🔥 Automated sequence started: ${material.toUpperCase()} plate in ${mode.toUpperCase()} mode.`);

      return `🔥 <b>AUTONOMOUS PRODUCTION SEQUENCE ENGAGED</b><br>
              • Workpiece Material: <b>${material.toUpperCase()}</b> Plate<br>
              • Welding Modality: <b>${mode.toUpperCase()} Pulse</b><br><br>
              Kinematics path solver calculates a smooth weld sweep across the joint. Clamping table holddowns now. Sparks flying!`;
    }

    // F. INDUSTRIAL WPS RECIPES COMMANDS
    if (cleanQuery.includes('wps') || cleanQuery.includes('recipe') || cleanQuery.includes('parameters') || cleanQuery.includes('settings')) {
      return `📋 <b>INDUSTRIAL WELDING PROCEDURE SPECIFICATION (WPS)</b><br>
              Validated engineering parameters for structural welding:<br><br>
              <table style="width:100%; border-collapse:collapse; font-size:0.65rem; text-align:left; border: 1px solid var(--glass-border);">
                <tr style="border-bottom:1px solid rgba(0,0,0,0.1); font-weight:bold; background:rgba(0,0,0,0.02);">
                  <th style="padding:4px;">Material</th>
                  <th style="padding:4px;">Process</th>
                  <th style="padding:4px;">Voltage</th>
                  <th style="padding:4px;">Gas Flow</th>
                  <th style="padding:4px;">Preheat</th>
                </tr>
                <tr style="border-bottom:1px dashed rgba(0,0,0,0.05);">
                  <td style="padding:4px;">Carbon Steel</td>
                  <td style="padding:4px;">MIG</td>
                  <td style="padding:4px;">24 - 28V</td>
                  <td style="padding:4px;">15 L/min (Ar-CO2)</td>
                  <td style="padding:4px;">None</td>
                </tr>
                <tr style="border-bottom:1px dashed rgba(0,0,0,0.05);">
                  <td style="padding:4px;">Aluminum 6061</td>
                  <td style="padding:4px;">TIG</td>
                  <td style="padding:4px;">14 - 16V</td>
                  <td style="padding:4px;">12 L/min (Pure Ar)</td>
                  <td style="padding:4px;">65°C</td>
                </tr>
                <tr style="border-bottom:1px dashed rgba(0,0,0,0.05);">
                  <td style="padding:4px;">Copper C110</td>
                  <td style="padding:4px;">Laser</td>
                  <td style="padding:4px;">45 - 50V</td>
                  <td style="padding:4px;">8 L/min (N2 Shield)</td>
                  <td style="padding:4px;">150°C</td>
                </tr>
                <tr>
                  <td style="padding:4px;">Titanium Ti-64</td>
                  <td style="padding:4px;">Plasma</td>
                  <td style="padding:4px;">30 - 34V</td>
                  <td style="padding:4px;">18 L/min (Ar Backing)</td>
                  <td style="padding:4px;">None</td>
                </tr>
              </table><br>
              <i>Type e.g., "weld 40 cm of copper with laser" to execute dynamic welding under these parameters.</i>`;
    }

    // G. DIAGNOSTIC FMEA ROOT-CAUSE COMMANDS
    if (cleanQuery.includes('fmea') || cleanQuery.includes('root-cause') || cleanQuery.includes('fix') || cleanQuery.includes('repair') || cleanQuery.includes('diagnose')) {
      return `🛠️ <b>FAILURE MODE & EFFECTS ANALYSIS (FMEA)</b><br>
              Failure root-cause analysis and corrective maintenance actions:<br><br>
              <b>[🚨 SHIELDING GAS LEAK]</b><br>
              • <i>Mechanism:</i> Joint oxidation / atmospheric N2/O2 blowholes.<br>
              • <i>S/O/D Severity:</i> 8 / 4 / 6 (RPN: 192). High risk of hydrogen cracking.<br>
              • <i>Repair Action:</i> Purge gas line, seal regulator seals, inspect flow nozzle.<br><br>
              <b>[⚙️ GEAR CHATTER]</b><br>
              • <i>Mechanism:</i> Harmonic drive flexspline chattering / chattering backlash.<br>
              • <i>S/O/D Severity:</i> 6 / 3 / 8 (RPN: 144). Causes chattering tracking offset.<br>
              • <i>Repair Action:</i> Lubricate spline teeth, recalibrate axis-3 torque encoders.<br><br>
              <b>[🔥 MOTOR OVERHEAT]</b><br>
              • <i>Mechanism:</i> Actuator winding insulation failure (Class H thermo-stress).<br>
              • <i>S/O/D Severity:</i> 9 / 2 / 5 (RPN: 90). Triggers auto ESTOP.<br>
              • <i>Repair Action:</i> Clear ventilation barriers, check active liquid lines, reduce duty cycles.`;
    }

    // H. LIVE TEMPERATURE READOUT
    if (cleanQuery.includes('temperature') || cleanQuery.includes('temp') || cleanQuery.includes('hot')) {
      const tempText = simulatedTempRising.map((t, idx) => `<b>J${idx + 1}</b>: ${t.toFixed(1)}°C`).join(', ');
      return `🌡️ <b>LIVE MOTOR TEMPERATURE DIAGNOSTICS</b><br>
              ${tempText}<br>
              <i>All motor thermal indices are operating within nominal bounds. Maximum temperature spike on J3 Elbow.</i>`;
    }

    // I. LIVE TORQUE READOUT
    if (cleanQuery.includes('torque') || cleanQuery.includes('force')) {
      const torqText = telemetryData.torque.map((t, idx) => `<b>J${idx + 1}</b>: ${t[dataPointsCount - 1].toFixed(1)} Nm`).join(', ');
      return `⚡ <b>LIVE ACTUATOR TRANSMITTED TORQUES</b><br>
              ${torqText}<br>
              <i>Dynamic gear load is stabilized. Waveforms display high frequency micro-harmonics inside normal parameters.</i>`;
    }

    // J. LIVE CURRENTS / POWER
    if (cleanQuery.includes('current') || cleanQuery.includes('amp') || cleanQuery.includes('power')) {
      const currText = telemetryData.current.map((c, idx) => `<b>J${idx + 1}</b>: ${c[dataPointsCount - 1].toFixed(1)} A`).join(', ');
      const totalPower = (telemetryData.current.reduce((acc, c) => acc + c[dataPointsCount - 1], 0) * 0.4).toFixed(2);
      return `🔋 <b>LIVE ACTUATOR DRIVE CURRENTS</b><br>
              ${currText}<br>
              <i>Calculated total busbar power draw: <b>${totalPower} kW</b>. Rectifier efficiency factor: 98.2%.</i>`;
    }

    // K. LIVE RUL / PREDICTIVE MAINTENANCE
    if (cleanQuery.includes('rul') || cleanQuery.includes('maintenance') || cleanQuery.includes('health') || cleanQuery.includes('stable')) {
      const rulText = currentRULs.map((r, idx) => `<b>J${idx + 1}</b>: ${r.toFixed(1)}%`).join(', ');
      return `📊 <b>PREDICTIVE MAINTENANCE REPORT (RUL)</b><br>
              Calculated Remaining Useful Life coefficients:<br>
              ${rulText}<br>
              <i>Status: <span style="color:var(--safe-green); font-weight:bold;">NOMINAL</span>. Gearbox harmonic drives demonstrate zero wear-profile slippage.</i>`;
    }

    // L. STATUS / REPORT
    if (cleanQuery.includes('status') || cleanQuery.includes('report') || cleanQuery.includes('telemetry')) {
      const faultText = (typeof activeFault !== 'undefined' && activeFault !== 'none') ? `<span style="color:var(--emergency-red); font-weight:bold;">🚨 ALARM ACTIVE: ${activeFault.toUpperCase()}</span>` : `<span style="color:var(--safe-green); font-weight:bold;">NOMINAL</span>`;
      const avgTemp = (simulatedTempRising.reduce((acc, t) => acc + t, 0) / 6).toFixed(1);
      const progressPct = (cellState.currentWeldProgress * 100).toFixed(1);
      return `📊 <b>WELDFORGE SYSTEM DIAGNOSTIC REPORT</b><br>
              • Mode: <span style="color:var(--cyan-glow); font-weight:bold;">${cellState.systemMode}</span><br>
              • Material: <b>${cellState.activeWorkpieceMaterial.toUpperCase()}</b><br>
              • Weld Modality: <b>${cellState.activeWeldingMode.toUpperCase()}</b><br>
              • Welding Progress: <b>${progressPct}%</b><br>
              • Actuator Health: ${faultText}<br>
              • Average Winding Temp: <b>${avgTemp}°C</b>`;
    }

    // M. FALLBACK
    return `🤖 <b>DASHBOARD SUPERVISOR CO-PILOT ACTIVE</b><br>
            I have direct telemetry access. Ask me questions like:<br>
            • <i>"What are the current joint temperatures?"</i><br>
            • <i>"Check the motor currents and power draw."</i><br>
            • <i>"Perform predictive maintenance health report."</i><br>
            • <i>"Start a titanium weld sequence."</i><br>
            • <i>"Weld two pieces of 50 cm of steel with laser"</i>`;
  }

  function logDashboardEvent(msg) {
    const consoleLog = document.getElementById('dashboard-console-log');
    const now = new Date();
    const timeStr = `[${now.toTimeString().split(' ')[0]}]`;

    const line = document.createElement('div');
    line.className = 'diag-log-line';
    
    let txtClass = '';
    if (msg.includes('🚨') || msg.includes('CRITICAL') || msg.includes('E-STOP')) txtClass = 'danger';
    else if (msg.includes('⚠️') || msg.includes('REJECTED')) txtClass = 'warn';
    else if (msg.includes('✅') || msg.includes('complete') || msg.includes('reset')) txtClass = 'success';

    line.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-txt ${txtClass}">${msg}</span>`;

    if (consoleLog) {
      consoleLog.insertBefore(line, consoleLog.firstChild);
    }

    // Save to localStorage
    const savedLogsStr = localStorage.getItem('weldforge_log_cache');
    let logs = [];
    if (savedLogsStr) {
      try { logs = JSON.parse(savedLogsStr); } catch(e) {}
    }
    logs.unshift({ time: timeStr, text: msg, level: txtClass });
    if (logs.length > 50) logs.pop();
    localStorage.setItem('weldforge_log_cache', JSON.stringify(logs));
  }
})();
