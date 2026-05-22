/* WELDFORGE-X: Autonomous AI Co-pilot Chat Controller & NLP Parser */

function sendChatMessage() {
  const inputEl = document.getElementById('chat-user-input');
  const chatHistory = document.getElementById('chat-history-log');
  if (!inputEl || !chatHistory) return;

  const query = inputEl.value.trim();
  if (query === '') return;

  // 1. Render User Message Bubble
  appendChatBubble(query, 'user');
  inputEl.value = '';

  // 2. Play subtle modern typing indicator bubble
  const typingBubble = appendChatBubble('AI Supervisor is calculating kinematics...', 'bot');
  typingBubble.id = 'ai-typing-indicator';
  chatHistory.scrollTop = chatHistory.scrollHeight;

  // 3. Process Command with NLP matching engine
  setTimeout(() => {
    // Remove typing bubble
    const indicator = document.getElementById('ai-typing-indicator');
    if (indicator) indicator.remove();

    const response = processNaturalLanguageCommand(query);
    appendChatBubble(response, 'bot');
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }, 600);
}

function appendChatBubble(text, sender) {
  const chatHistory = document.getElementById('chat-history-log');
  const bubble = document.createElement('div');
  bubble.className = `chat-msg ${sender}`;
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

function processNaturalLanguageCommand(query) {
  const cleanQuery = query.toLowerCase();

  // A. EMERGENCY STOP COMMANDS
  if (cleanQuery.includes('estop') || cleanQuery.includes('emergency') || cleanQuery.includes('stop') || cleanQuery.includes('shutdown')) {
    triggerEmergencyStop();
    return `🚨 <b>CRITICAL ALARM INSTANTLY ACTIVATED</b><br>
            Robot joints frozen. Flange power cut off. Active weld extinguished.<br>
            <i>E-STOP command registered successfully. Cell is locked.</i>`;
  }

  // B. RESET / CLEAR EMERGENCY COMMANDS
  if (cleanQuery.includes('reset') || cleanQuery.includes('resume') || cleanQuery.includes('clear') || cleanQuery.includes('unlock')) {
    clearEmergencyStop();
    return `✅ <b>CELL RESTORED TO STANDBY STATE</b><br>
            Interlocks cleared. Re-engaging servo actuators.<br>
            <i>Cell status updated: TELEMETRY READY (IDLE).</i>`;
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

      // Update local variables in Three.js cell environment
      if (typeof systemMode !== 'undefined') {
        systemMode = 'WELDING';
      }
      activeCustomConfig = customConfig;
      activeWorkpieceMaterial = material;
      activeWeldingMode = mode;
      activeFault = 'none';

      // Write to shared local storage cell state
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

      // Trigger actual Three.js dynamic spawning and automatic robotic cycle
      if (typeof spawnWorkpiece === 'function') {
        spawnWorkpiece(material, customConfig);
      }
      if (typeof startAutomationSequence === 'function') {
        startAutomationSequence(material, mode);
      }
      if (typeof syncSidebarSelection === 'function') {
        syncSidebarSelection(material, mode);
      }

      // Physics Thermal Solver
      let voltage = 24.0;
      let current = 220.0; 
      let travelSpeed = 4.8; // mm/s
      let eta = 0.8; // MIG efficiency
      
      if (mode === 'tig') { voltage = 14.5; current = 160.0; travelSpeed = 3.2; eta = 0.6; }
      else if (mode === 'laser') { voltage = 45.0; current = 100.0; travelSpeed = 8.5; eta = 0.7; }
      else if (mode === 'plasma') { voltage = 32.0; current = 260.0; travelSpeed = 5.5; eta = 0.85; }

      const heatInput = (eta * (voltage * current) / (travelSpeed * 1000)).toFixed(3);

      return `🔥 <b>AUTONOMOUS WELD COMPILER ENGAGED</b><br>
              • Task: Custom-sized joint construction<br>
              • Material: <b>${material.toUpperCase()}</b> plates (Qty: <b>${qty}</b>)<br>
              • Joint Configuration: <b>${jointType.toUpperCase()}</b> joint<br>
              • Size Compiled:<br>
                - Length: <b>${(length * 100).toFixed(1)} cm</b> (table boundaries checked)<br>
                - Breadth/Width: <b>${(width * 100).toFixed(1)} cm</b><br>
                - Height/Thickness: <b>${(thickness * 1000).toFixed(1)} mm</b><br>
              • Modality: <b>${mode.toUpperCase()} Pulse</b><br><br>
              
              🎓 <b>WELDING THERMAL EQUATION MODEL:</b><br>
              Welding Heat Input ($H$) calculated using physical parameters:<br>
              $$H = \\eta \\cdot \\frac{U \\cdot I}{v}$$
              - Voltage ($U$) = <b>${voltage} V</b> | Current ($I$) = <b>${current} A</b><br>
              - Travel Speed ($v$) = <b>${travelSpeed} mm/s</b><br>
              - Thermal Efficiency Factor ($\\eta$) = <b>${eta}</b><br>
              <b>Joint Heat Input ($H$): <span style="color:var(--cyan-glow);">${heatInput} kJ/mm</span></b><br><br>
              <i>Physical meshes dynamically generated in 3D. Clamping table locator pin adjusted!</i>`;
    } else {
      return `⚠️ <b>DIMENSIONS REQUIRED</b><br>
              I could not parse valid length, breadth, or thickness from your input.<br>
              Please enter the physical dimensions, e.g.:<br>
              • <i>"Length 50cm, width 10cm, height 15mm"</i><br>
              • <i>"50cm breadth 10cm height 12mm"</i><br><br>
              <i>Or type <b>'cancel'</b> to abort weld compilation.</i>`;
    }
  }

  // C. DYNAMIC CUSTOM WORKPIECE WELD COMMAND (e.g. "weld two pieces of iron square joint")
  if (cleanQuery.includes('weld') && (cleanQuery.includes('piece') || cleanQuery.includes('plate') || cleanQuery.includes('joint') || cleanQuery.includes('weld') || cleanQuery.includes('metal'))) {
    if (systemMode === 'ESTOP') {
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

    activeCustomConfig = customConfig;
    activeWorkpieceMaterial = material;
    activeWeldingMode = mode;
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

    spawnWorkpiece(material, customConfig);
    startAutomationSequence(material, mode);
    syncSidebarSelection(material, mode);

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

    // Joint Configuration Efficiency Factor
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
            • Preheating Command: <b>${preheatMsg}</b><br><br>

            <i>Physical shapes generated in WebGL! Table locators and clamp swing-arms locked! Robotic sweep starting...</i>`;
  }

  // D. INDUSTRIAL WPS RECIPES COMMANDS
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

  // E. DIAGNOSTIC FMEA ROOT-CAUSE COMMANDS
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

  // F. HOME STANDBY POSITION COMMAND
  if (cleanQuery.includes('home') || cleanQuery.includes('standby') || cleanQuery.includes('retract')) {
    if (isWeldingActive) {
      return `⚠️ <b>COMMAND REJECTED</b>: Cannot return to home while active welding arc is engaged. Cut the arc or invoke E-STOP first.`;
    }
    setTargetJointAngles([0, 15, -45, 0, 30, 0], 1.2);
    return `🤖 <b>HOMING ACTION INITIATED</b><br>
            Instructing 6-axis links to return to standby home coordinate position.<br>
            <i>Kinematics solve completed. Target reached.</i>`;
  }

  // G. TELEMETRY STATUS REPORTS
  if (cleanQuery.includes('status') || cleanQuery.includes('report') || cleanQuery.includes('telemetry')) {
    const faultText = (typeof activeFault !== 'undefined' && activeFault !== 'none') ? `<span style="color:var(--emergency-red); font-weight:bold;">🚨 ALARM ACTIVE: ${activeFault.toUpperCase()}</span>` : `<span style="color:var(--safe-green); font-weight:bold;">NOMINAL</span>`;
    return `📊 <b>WELDFORGE SYSTEM DIAGNOSTIC REPORT</b><br>
            • J1-J6 Actuator Status: ${faultText}<br>
            • Winding Temp: 35.8°C (Steady)<br>
            • Vibro-Acoustic Spectrum: ${activeFault === 'gear_slip' ? '1.92 mm/s² (HIGH CHATTER)' : '0.04 mm/s² (Clean)'}<br>
            • Shielding Gas Flow: ${activeFault === 'gas_leak' ? '3.2 L/min [LEAKING!]' : '15 L/min [Ar-CO2]'}<br>
            • Tool Center Point (TCP): [${currentTCPPosition.x.toFixed(2)}, ${currentTCPPosition.y.toFixed(2)}, ${currentTCPPosition.z.toFixed(2)}]<br>
            • Power Output: 22.4 kW`;
  }

  // F. FALLBACK CONVERSATIONAL RESPONSE
  return `🤖 <b>COMMAND NOT RECOGNIZED</b><br>
          I am a localized industrial coordinator. Try commands like:<br>
          • <i>"Weld aluminum with TIG mode"</i><br>
          • <i>"Emergency stop immediately"</i><br>
          • <i>"Get status report"</i><br>
          • <i>"Return robot to home standby"</i>`;
}

function syncSidebarSelection(material, mode) {
  // Sync workpiece segmented cards
  const workpieces = document.querySelectorAll('#workpiece-selector .segment-item');
  workpieces.forEach(el => {
    if (el.getAttribute('data-material') === material) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  // Sync welding modes cards
  const modes = document.querySelectorAll('#mode-selector .segment-item');
  modes.forEach(el => {
    if (el.getAttribute('data-mode') === mode) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}
