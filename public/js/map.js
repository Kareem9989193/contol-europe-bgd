/**
 * map.js — Tactical Europe Map Renderer
 * Renders the authentic high-tech Europe Map (Image 2) on Canvas with:
 * - Real Europe tactical map background
 * - Glowing strategic nodes & pulse beacons
 * - Animated photon battle arcs connecting allied/adjacent territories
 * - 3D garrison strength badges
 * - Holographic tactical HUD elements & targeting reticles
 * - Zoom, pan, hover & click detection
 */

const EuropeMap = (() => {
  // Base dimensions of the user's tactical map image
  const BASE_WIDTH = 1024;
  const BASE_HEIGHT = 559;

  // Strategic Territory Coordinates on the 1024x559 Tactical Map
  const STRATEGIC_NODES = {
    'United Kingdom': { x: 338, y: 242, capital: 'London', color: '#ef4444' },
    'Ireland':        { x: 280, y: 232, capital: 'Dublin', color: '#10b981' },
    'France':         { x: 375, y: 312, capital: 'Paris', color: '#3b82f6' },
    'Spain':          { x: 265, y: 405, capital: 'Madrid', color: '#f59e0b' },
    'Portugal':       { x: 202, y: 425, capital: 'Lisbon', color: '#10b981' },
    'Germany':        { x: 472, y: 245, capital: 'Berlin', color: '#06b6d4' },
    'Italy':          { x: 475, y: 415, capital: 'Rome', color: '#84cc16' },
    'Poland':         { x: 555, y: 242, capital: 'Warsaw', color: '#ec4899' },
    'Ukraine':        { x: 670, y: 275, capital: 'Kyiv', color: '#00f0ff' },
    'Russia':         { x: 745, y: 165, capital: 'Moscow', color: '#10f070' },
    'Sweden':         { x: 515, y: 140, capital: 'Stockholm', color: '#38bdf8' },
    'Norway':         { x: 450, y: 145, capital: 'Oslo', color: '#f43f5e' },
    'Finland':        { x: 585, y: 125, capital: 'Helsinki', color: '#a855f7' },
    'Austria':        { x: 495, y: 315, capital: 'Vienna', color: '#e2e8f0' },
    'Switzerland':    { x: 425, y: 335, capital: 'Bern', color: '#f87171' },
    'Netherlands':    { x: 405, y: 238, capital: 'Amsterdam', color: '#fb923c' },
    'Belgium':        { x: 395, y: 262, capital: 'Brussels', color: '#fbbf24' },
    'Czechia':        { x: 500, y: 270, capital: 'Prague', color: '#a3e635' },
    'Slovakia':       { x: 535, y: 295, capital: 'Bratislava', color: '#2dd4bf' },
    'Hungary':        { x: 545, y: 325, capital: 'Budapest', color: '#facc15' },
    'Romania':        { x: 620, y: 345, capital: 'Bucharest', color: '#38bdf8' },
    'Bulgaria':       { x: 615, y: 390, capital: 'Sofia', color: '#c084fc' },
    'Greece':         { x: 610, y: 460, capital: 'Athens', color: '#38bdf8' },
    'Turkey':         { x: 710, y: 430, capital: 'Ankara', color: '#e11d48' },
    'Denmark':        { x: 460, y: 195, capital: 'Copenhagen', color: '#f472b6' },
    'Belarus':        { x: 625, y: 215, capital: 'Minsk', color: '#4ade80' },
    'Lithuania':      { x: 590, y: 195, capital: 'Vilnius', color: '#e879f9' },
    'Latvia':         { x: 585, y: 165, capital: 'Riga', color: '#67e8f9' },
    'Estonia':        { x: 580, y: 135, capital: 'Tallinn', color: '#93c5fd' },
    'Serbia':         { x: 575, y: 370, capital: 'Belgrade', color: '#f87171' },
    'Croatia':        { x: 515, y: 350, capital: 'Zagreb', color: '#fbbf24' },
    'Bosnia and Herzegovina': { x: 545, y: 375, capital: 'Sarajevo', color: '#a78bfa' },
    'Albania':        { x: 575, y: 425, capital: 'Tirana', color: '#f43f5e' },
    'Iceland':        { x: 255, y: 70,  capital: 'Reykjavik', color: '#e0e7ff' },
  };

  const FACTION_PALETTES = [
    { name: 'Cyan Legion',   primary: '#00f0ff', glow: 'rgba(0, 240, 255, 0.6)', fill: 'rgba(0, 240, 255, 0.25)' },
    { name: 'Crimson Order', primary: '#ef4444', glow: 'rgba(239, 68, 68, 0.6)', fill: 'rgba(239, 68, 68, 0.25)' },
    { name: 'Solar Empire',  primary: '#ffd700', glow: 'rgba(255, 215, 0, 0.6)', fill: 'rgba(255, 215, 0, 0.25)' },
    { name: 'Emerald Front', primary: '#10f070', glow: 'rgba(16, 240, 112, 0.6)', fill: 'rgba(16, 240, 112, 0.25)' },
    { name: 'Amber Coalition', primary: '#f59e0b', glow: 'rgba(245, 158, 11, 0.6)', fill: 'rgba(245, 158, 11, 0.25)' },
    { name: 'Amethyst Guard', primary: '#a855f7', glow: 'rgba(168, 85, 247, 0.6)', fill: 'rgba(168, 85, 247, 0.25)' },
  ];

  // ─── State ───────────────────────────────────────────────────────────
  let canvas, ctx;
  let mapImage = new Image();
  let isImageLoaded = false;

  let hoveredCountry = null;
  let selectedCountry = null;
  let targetCountry = null;

  // Viewport Transform
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let lastOffsetX = 0;
  let lastOffsetY = 0;

  // Animation ticks
  let animTick = 0;

  // Callbacks
  let onHoverCallback = null;
  let onClickCallback = null;

  // Game state reference
  let gameState = null;

  // ─── Coordinate Conversion ───────────────────────────────────────────
  function mapToScreen(mx, my) {
    return {
      x: mx * scale + offsetX,
      y: my * scale + offsetY,
    };
  }

  function screenToMap(sx, sy) {
    return {
      x: (sx - offsetX) / scale,
      y: (sy - offsetY) / scale,
    };
  }

  // ─── Strategic Connections (Arc lines between territories) ───────────
  function getStrategicConnections() {
    if (!gameState?.adjacency) return [];
    const drawnPairs = new Set();
    const arcs = [];

    for (const [from, neighbors] of Object.entries(gameState.adjacency)) {
      const fromNode = STRATEGIC_NODES[from];
      if (!fromNode) continue;

      for (const to of neighbors) {
        const toNode = STRATEGIC_NODES[to];
        if (!toNode) continue;

        const key = [from, to].sort().join('::');
        if (!drawnPairs.has(key)) {
          drawnPairs.add(key);
          arcs.push({ from, to, x1: fromNode.x, y1: fromNode.y, x2: toNode.x, y2: toNode.y });
        }
      }
    }
    return arcs;
  }

  // ─── Rendering Loop ──────────────────────────────────────────────────
  function render() {
    if (!canvas || !ctx) return;
    animTick += 0.025;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // 1. Draw Tactical Map Base Image
    if (isImageLoaded) {
      ctx.drawImage(mapImage, 0, 0, BASE_WIDTH, BASE_HEIGHT);
    } else {
      ctx.fillStyle = '#060b18';
      ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    }

    // 2. Draw High-Tech Grid & Scanlines
    drawTacticalGrid();

    // 3. Draw Connecting Battle & Supply Arcs
    drawSupplyArcs();

    // 4. Draw Attack Arrow if aiming
    if (selectedCountry && targetCountry) {
      drawAttackReticle(selectedCountry, targetCountry);
    }

    // 5. Draw Strategic Nodes & Army Counters
    drawStrategicNodes();

    ctx.restore();

    requestAnimationFrame(render);
  }

  // ─── Draw Elements ───────────────────────────────────────────────────
  function drawTacticalGrid() {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.04)';
    ctx.lineWidth = 1;

    // Grid lines
    for (let x = 0; x <= BASE_WIDTH; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, BASE_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= BASE_HEIGHT; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(BASE_WIDTH, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSupplyArcs() {
    const arcs = getStrategicConnections();
    ctx.save();

    arcs.forEach(arc => {
      const isSelectedArc = (arc.from === selectedCountry && arc.to === targetCountry) ||
                            (arc.to === selectedCountry && arc.from === targetCountry);

      // Arc curve control point
      const midX = (arc.x1 + arc.x2) / 2;
      const midY = (arc.y1 + arc.y2) / 2 - 20;

      // Base Arc Line
      ctx.beginPath();
      ctx.moveTo(arc.x1, arc.y1);
      ctx.quadraticCurveTo(midX, midY, arc.x2, arc.y2);

      if (isSelectedArc) {
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
      } else {
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.18)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
      }
      ctx.stroke();

      // Traveling Light Photon (Animated Dot)
      const t = (animTick + (arc.x1 * 0.01)) % 1;
      const qx = (1 - t) * (1 - t) * arc.x1 + 2 * (1 - t) * t * midX + t * t * arc.x2;
      const qy = (1 - t) * (1 - t) * arc.y1 + 2 * (1 - t) * t * midY + t * t * arc.y2;

      ctx.beginPath();
      ctx.arc(qx, qy, isSelectedArc ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fillStyle = isSelectedArc ? '#ef4444' : '#00f0ff';
      ctx.shadowColor = isSelectedArc ? '#ef4444' : '#00f0ff';
      ctx.shadowBlur = 8;
      ctx.fill();
    });

    ctx.restore();
  }

  function drawAttackReticle(fromName, toName) {
    const from = STRATEGIC_NODES[fromName];
    const to = STRATEGIC_NODES[toName];
    if (!from || !to) return;

    ctx.save();
    // Glowing Red Attack Beam
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 12;
    ctx.stroke();

    // Target Reticle on Destination
    const pulseRadius = 18 + Math.sin(animTick * 4) * 4;
    ctx.beginPath();
    ctx.arc(to.x, to.y, pulseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  function drawStrategicNodes() {
    for (const [name, node] of Object.entries(STRATEGIC_NODES)) {
      const territory = gameState?.territories?.[name];
      const owner = territory?.owner;
      const armies = territory?.armies || 2;
      const isHovered = hoveredCountry === name;
      const isSelected = selectedCountry === name;
      const isTarget = targetCountry === name;

      const colorIndex = owner ? getPlayerColorIndex(owner) : -1;
      const palette = colorIndex >= 0 ? FACTION_PALETTES[colorIndex % FACTION_PALETTES.length] : {
        primary: '#94a3b8',
        glow: 'rgba(148, 163, 184, 0.4)',
        fill: 'rgba(30, 41, 59, 0.7)',
      };

      ctx.save();

      // 1. Pulsing Outer Beacon
      const pulseSize = 14 + Math.sin(animTick * 2.5 + node.x) * 3;
      ctx.beginPath();
      ctx.arc(node.x, node.y, isSelected ? 22 : pulseSize, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? 'rgba(255, 215, 0, 0.3)' : palette.glow;
      ctx.shadowColor = isSelected ? '#ffd700' : palette.primary;
      ctx.shadowBlur = isSelected || isHovered ? 16 : 8;
      ctx.fill();

      // 2. Center Strategic Node Dot
      ctx.beginPath();
      ctx.arc(node.x, node.y, isHovered || isSelected ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#ffd700' : isTarget ? '#ef4444' : palette.primary;
      ctx.fill();
      ctx.strokeStyle = '#030712';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 3. Garrison Army Badge (Hexagonal / Circular 3D Counter)
      const badgeY = node.y - 18;
      ctx.beginPath();
      ctx.arc(node.x, badgeY, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 11, 25, 0.92)';
      ctx.shadowBlur = isSelected ? 12 : 6;
      ctx.fill();

      ctx.lineWidth = isSelected ? 2 : 1.2;
      ctx.strokeStyle = isSelected ? '#ffd700' : isTarget ? '#ef4444' : palette.primary;
      ctx.stroke();

      // Army Number Text
      ctx.fillStyle = isSelected ? '#ffd700' : '#f8fafc';
      ctx.font = '800 11px "Orbitron", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = 0;
      ctx.fillText(armies.toString(), node.x, badgeY + 0.5);

      // Country Label on Hover
      if (isHovered || isSelected) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 10px "Orbitron", sans-serif';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.fillText(name.toUpperCase(), node.x, node.y + 16);
      }

      ctx.restore();
    }
  }

  function getPlayerColorIndex(playerId) {
    if (!gameState?.players) return -1;
    const player = gameState.players[playerId];
    return player ? player.colorIndex : -1;
  }

  // ─── Hit Testing ─────────────────────────────────────────────────────
  function getCountryAtPoint(mapX, mapY) {
    let closestCountry = null;
    let closestDist = 28; // Hit radius

    for (const [name, node] of Object.entries(STRATEGIC_NODES)) {
      const dx = mapX - node.x;
      const dy = mapY - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < closestDist) {
        closestDist = dist;
        closestCountry = name;
      }
    }
    return closestCountry;
  }

  // ─── Mouse & Viewport Events ─────────────────────────────────────────
  function setupEvents() {
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const sy = (e.clientY - rect.top) * (canvas.height / rect.height);

      if (isDragging) {
        offsetX = lastOffsetX + (e.clientX - dragStartX);
        offsetY = lastOffsetY + (e.clientY - dragStartY);
        return;
      }

      const mapCoords = screenToMap(sx, sy);
      const country = getCountryAtPoint(mapCoords.x, mapCoords.y);

      if (country !== hoveredCountry) {
        hoveredCountry = country;
        canvas.style.cursor = country ? 'pointer' : 'crosshair';
        if (onHoverCallback) onHoverCallback(country, e.clientX, e.clientY);
      } else if (country && onHoverCallback) {
        onHoverCallback(country, e.clientX, e.clientY);
      }
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        lastOffsetX = offsetX;
        lastOffsetY = offsetY;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (isDragging) {
        isDragging = false;
        canvas.style.cursor = hoveredCountry ? 'pointer' : 'crosshair';
        return;
      }

      if (e.button === 0) {
        const rect = canvas.getBoundingClientRect();
        const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const mapCoords = screenToMap(sx, sy);
        const country = getCountryAtPoint(mapCoords.x, mapCoords.y);

        if (country && onClickCallback) {
          onClickCallback(country);
        }
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newScale = Math.max(0.6, Math.min(4.5, scale * zoomFactor));

      offsetX = mx - (mx - offsetX) * (newScale / scale);
      offsetY = my - (my - offsetY) * (newScale / scale);
      scale = newScale;
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ─── Mobile Touch Support (Pan, Tap, Pinch Zoom) ───────────────────
    let touchStartDist = 0;
    let touchMoved = false;
    let touchStartTime = 0;

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchStartTime = Date.now();
      touchMoved = false;

      if (e.touches.length === 1) {
        const t = e.touches[0];
        isDragging = true;
        dragStartX = t.clientX;
        dragStartY = t.clientY;
        lastOffsetX = offsetX;
        lastOffsetY = offsetY;
      } else if (e.touches.length === 2) {
        isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDist = Math.hypot(dx, dy);
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      touchMoved = true;

      if (e.touches.length === 1 && isDragging) {
        const t = e.touches[0];
        offsetX = lastOffsetX + (t.clientX - dragStartX);
        offsetY = lastOffsetY + (t.clientY - dragStartY);
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);

        if (touchStartDist > 0) {
          const factor = dist / touchStartDist;
          scale = Math.max(0.6, Math.min(4.5, scale * factor));
          touchStartDist = dist;
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      isDragging = false;

      // Detect Tap (short duration, minimal move)
      const touchDuration = Date.now() - touchStartTime;
      if (!touchMoved || touchDuration < 300) {
        const t = e.changedTouches[0];
        if (t) {
          const rect = canvas.getBoundingClientRect();
          const sx = (t.clientX - rect.left) * (canvas.width / rect.width);
          const sy = (t.clientY - rect.top) * (canvas.height / rect.height);
          const mapCoords = screenToMap(sx, sy);
          const country = getCountryAtPoint(mapCoords.x, mapCoords.y);

          if (country && onClickCallback) {
            onClickCallback(country);
          }
        }
      }
    }, { passive: false });

    window.addEventListener('resize', fitToScreen);
  }

  function fitToScreen() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';

    // Scale and center map perfectly to viewport
    const scaleX = (window.innerWidth * dpr) / BASE_WIDTH;
    const scaleY = (window.innerHeight * dpr) / BASE_HEIGHT;
    scale = Math.min(scaleX, scaleY) * 1.05;

    offsetX = ((window.innerWidth * dpr) - BASE_WIDTH * scale) / 2;
    offsetY = ((window.innerHeight * dpr) - BASE_HEIGHT * scale) / 2;
  }

  // ─── Public API ──────────────────────────────────────────────────────
  function init(canvasElement) {
    canvas = canvasElement;
    ctx = canvas.getContext('2d');
    fitToScreen();

    // Load Tactical Map Image
    mapImage.onload = () => {
      isImageLoaded = true;
    };
    mapImage.src = '/assets/europe_map.jpg';

    setupEvents();
    render();
  }

  function setGameState(state) {
    gameState = state;
  }

  function setSelected(country) {
    selectedCountry = country;
  }

  function setTarget(country) {
    targetCountry = country;
  }

  function clearSelection() {
    selectedCountry = null;
    targetCountry = null;
  }

  function onHover(cb) { onHoverCallback = cb; }
  function onClick(cb) { onClickCallback = cb; }

  function getNodes() { return STRATEGIC_NODES; }

  return {
    init,
    setGameState,
    setSelected,
    setTarget,
    clearSelection,
    onHover,
    onClick,
    getNodes,
  };
})();
