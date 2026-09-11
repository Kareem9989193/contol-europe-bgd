/**
 * map.js — Grand Strategy Tactical Europe Map Renderer
 * Renders 78 European Cities, real-time supply corridors, moving marching armies,
 * combat clash animations, and supports touch/mouse pan and zoom.
 */

const EuropeMap = (() => {
  const BASE_WIDTH = 1024;
  const BASE_HEIGHT = 559;

  let canvas, ctx;
  let mapImage = new Image();
  let isImageLoaded = false;

  // Viewport state
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let hasMoved = false;

  // Touch gesture state
  let touchStartDist = 0;
  let initialScale = 1;

  // Selection & Interactions
  let selectedCity = null;
  let hoveredCity = null;
  let targetCity = null;

  // Animation & Particles
  let animTick = 0;
  let combatExplosions = []; // { x, y, radius, maxRadius, alpha, color }

  // Game data & state
  let gameState = null;
  let myPlayerId = null;

  // Callbacks
  let onCitySelectCallback = null;
  let onMarchCallback = null;

  function init(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    mapImage.src = '/assets/europe_tactical_map.jpg';
    mapImage.onload = () => {
      isImageLoaded = true;
    };
    mapImage.onerror = () => {
      console.warn('Map background image not found, using procedural grid.');
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    setupInteractions();
    requestAnimationFrame(render);
  }

  function resizeCanvas() {
    if (!canvas) return;
    const parent = canvas.parentElement || document.body;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;

    // Center map by default if first load
    if (scale === 1 && offsetX === 0 && offsetY === 0) {
      fitMapToScreen();
    }
  }

  function fitMapToScreen() {
    if (!canvas) return;
    const scaleX = canvas.width / BASE_WIDTH;
    const scaleY = canvas.height / BASE_HEIGHT;
    scale = Math.min(scaleX, scaleY) * 0.98;
    offsetX = (canvas.width - BASE_WIDTH * scale) / 2;
    offsetY = (canvas.height - BASE_HEIGHT * scale) / 2;
  }

  function setupInteractions() {
    // Mouse events
    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      hasMoved = false;
      dragStartX = e.clientX - offsetX;
      dragStartY = e.clientY - offsetY;
    });

    window.addEventListener('mousemove', (e) => {
      if (isDragging) {
        hasMoved = true;
        offsetX = e.clientX - dragStartX;
        offsetY = e.clientY - dragStartY;
        clampOffset();
      } else {
        checkHover(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (isDragging && !hasMoved) {
        handleCanvasClick(e.clientX, e.clientY);
      }
      isDragging = false;
    });

    // Mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      zoomAtPoint(e.clientX, e.clientY, zoomFactor);
    }, { passive: false });

    // Touch events for mobile
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDragging = true;
        hasMoved = false;
        dragStartX = e.touches[0].clientX - offsetX;
        dragStartY = e.touches[0].clientY - offsetY;
      } else if (e.touches.length === 2) {
        isDragging = false;
        touchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialScale = scale;
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && isDragging) {
        hasMoved = true;
        offsetX = e.touches[0].clientX - dragStartX;
        offsetY = e.touches[0].clientY - dragStartY;
        clampOffset();
      } else if (e.touches.length === 2 && touchStartDist > 0) {
        const currentDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = currentDist / touchStartDist;
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        zoomAtPoint(midX, midY, factor);
        touchStartDist = currentDist;
      }
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
      if (isDragging && !hasMoved && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        handleCanvasClick(t.clientX, t.clientY);
      }
      isDragging = false;
    });
  }

  function zoomAtPoint(screenX, screenY, factor) {
    const minScale = 0.5;
    const maxScale = 3.5;
    const newScale = Math.max(minScale, Math.min(maxScale, scale * factor));
    if (newScale === scale) return;

    const mapX = (screenX - offsetX) / scale;
    const mapY = (screenY - offsetY) / scale;

    scale = newScale;
    offsetX = screenX - mapX * scale;
    offsetY = screenY - mapY * scale;
    clampOffset();
  }

  function clampOffset() {
    const margin = 200 * scale;
    const minX = canvas.width - BASE_WIDTH * scale - margin;
    const maxX = margin;
    const minY = canvas.height - BASE_HEIGHT * scale - margin;
    const maxY = margin;

    offsetX = Math.max(minX, Math.min(maxX, offsetX));
    offsetY = Math.max(minY, Math.min(maxY, offsetY));
  }

  function screenToMap(sx, sy) {
    return {
      x: (sx - offsetX) / scale,
      y: (sy - offsetY) / scale
    };
  }

  function checkHover(clientX, clientY) {
    if (!gameState?.cities) return;
    const rect = canvas.getBoundingClientRect();
    const mapPt = screenToMap(clientX - rect.left, clientY - rect.top);

    let found = null;
    for (const city of Object.values(gameState.cities)) {
      const dist = Math.hypot(mapPt.x - city.x, mapPt.y - city.y);
      if (dist <= 18) {
        found = city.name;
        break;
      }
    }

    if (found !== hoveredCity) {
      hoveredCity = found;
      canvas.style.cursor = hoveredCity ? 'pointer' : 'default';
      updateTooltip(hoveredCity, clientX, clientY);
    }
  }

  function handleCanvasClick(clientX, clientY) {
    if (!gameState?.cities) return;
    const rect = canvas.getBoundingClientRect();
    const mapPt = screenToMap(clientX - rect.left, clientY - rect.top);

    let clickedCity = null;
    for (const city of Object.values(gameState.cities)) {
      const dist = Math.hypot(mapPt.x - city.x, mapPt.y - city.y);
      if (dist <= 22) {
        clickedCity = city.name;
        break;
      }
    }

    if (clickedCity) {
      if (selectedCity && selectedCity !== clickedCity) {
        // Check if clickedCity is connected to selectedCity
        const neighbors = gameState.connections?.[selectedCity] || [];
        if (neighbors.includes(clickedCity)) {
          // If selectedCity is owned by player -> trigger March / Attack intent!
          const fromCityObj = gameState.cities[selectedCity];
          if (fromCityObj && fromCityObj.owner === myPlayerId) {
            if (onMarchCallback) {
              onMarchCallback(selectedCity, clickedCity);
              return;
            }
          }
        }
      }

      selectedCity = clickedCity;
      if (onCitySelectCallback) {
        onCitySelectCallback(gameState.cities[selectedCity]);
      }
    } else {
      selectedCity = null;
      if (onCitySelectCallback) {
        onCitySelectCallback(null);
      }
    }
  }

  function updateTooltip(cityName, sx, sy) {
    const tipEl = document.getElementById('tactical-country-tooltip');
    if (!tipEl) return;

    if (!cityName || !gameState?.cities?.[cityName]) {
      tipEl.style.display = 'none';
      return;
    }

    const city = gameState.cities[cityName];
    const ownerPlayer = city.owner ? gameState.players?.[city.owner] : null;
    const ownerName = ownerPlayer ? `${ownerPlayer.name} (${ownerPlayer.country || 'Empire'})` : 'Neutral';
    const ownerColor = ownerPlayer ? ownerPlayer.color : '#94a3b8';

    document.getElementById('tip-country-name').textContent = `${city.name.toUpperCase()} ${city.isCapital ? '⭐' : ''}`;
    const ownerEl = document.getElementById('tip-country-owner');
    ownerEl.textContent = ownerName;
    ownerEl.style.color = ownerColor;

    const armEl = document.getElementById('tip-country-armies');
    armEl.textContent = `${city.armies} Troops | +$${Math.round(city.baseIncome * (1 + (city.levelMarket||0)*0.4))}/tick`;

    tipEl.style.display = 'block';
    tipEl.style.left = Math.min(window.innerWidth - 200, sx + 15) + 'px';
    tipEl.style.top = Math.min(window.innerHeight - 100, sy + 15) + 'px';
  }

  // ─── Render Loop ────────────────────────────────────────────────────────────
  function render() {
    if (!canvas || !ctx) return;
    animTick += 0.02;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // 1. Draw Map Background
    if (isImageLoaded) {
      ctx.drawImage(mapImage, 0, 0, BASE_WIDTH, BASE_HEIGHT);
    } else {
      ctx.fillStyle = '#060d1d';
      ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    }

    // 2. Draw Supply lines / routes between connected cities
    drawSupplyRoutes();

    // 3. Draw Marching Armies
    drawMarchingArmies();

    // 4. Draw Tactical Reticle on Selected / Target City
    if (selectedCity && gameState?.cities?.[selectedCity]) {
      drawSelectionReticle(gameState.cities[selectedCity]);
    }

    // 5. Draw Cities Nodes & Badges
    drawCities();

    // 6. Draw Combat Explosions
    drawExplosions();

    ctx.restore();

    requestAnimationFrame(render);
  }

  function drawSupplyRoutes() {
    if (!gameState?.connections || !gameState?.cities) return;
    ctx.save();

    const drawn = new Set();
    const connections = gameState.connections;

    for (const [c1, neighbors] of Object.entries(connections)) {
      const p1 = gameState.cities[c1];
      if (!p1) continue;

      for (const c2 of neighbors) {
        const p2 = gameState.cities[c2];
        if (!p2) continue;

        const key = [c1, c2].sort().join('::');
        if (drawn.has(key)) continue;
        drawn.add(key);

        const isFriendlyRoute = p1.owner && p2.owner && p1.owner === p2.owner;
        const isSelectedRoute = (c1 === selectedCity || c2 === selectedCity);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);

        if (isSelectedRoute) {
          ctx.strokeStyle = 'rgba(255, 215, 0, 0.65)';
          ctx.lineWidth = 2.2;
          ctx.setLineDash([5, 3]);
        } else if (isFriendlyRoute) {
          const owner = gameState.players?.[p1.owner];
          ctx.strokeStyle = owner ? `${owner.color}44` : 'rgba(59, 130, 246, 0.25)';
          ctx.lineWidth = 1.4;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
        }
        ctx.stroke();

        // Subtle traveling pulse along connected routes
        if (isSelectedRoute || isFriendlyRoute) {
          const t = (animTick + (p1.x * 0.005)) % 1;
          const px = p1.x + (p2.x - p1.x) * t;
          const py = p1.y + (p2.y - p1.y) * t;

          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = isSelectedRoute ? '#ffd700' : '#38bdf8';
          ctx.shadowColor = isSelectedRoute ? '#ffd700' : '#38bdf8';
          ctx.shadowBlur = 6;
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }

  function drawMarchingArmies() {
    if (!gameState?.marches || !gameState?.cities) return;
    const now = Date.now();
    ctx.save();

    gameState.marches.forEach(march => {
      const from = gameState.cities[march.fromCity];
      const to = gameState.cities[march.toCity];
      if (!from || !to) return;

      const elapsed = Math.max(0, now - march.startTime);
      const progress = Math.min(1, elapsed / march.duration);

      const curX = from.x + (to.x - from.x) * progress;
      const curY = from.y + (to.y - from.y) * progress;

      // March path arrow
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = `${march.ownerColor || '#ef4444'}bb`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();

      // Army Marker: Chevron / Badge moving
      ctx.save();
      ctx.translate(curX, curY);

      // Glow behind army badge
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fillStyle = march.ownerColor || '#ef4444';
      ctx.shadowColor = march.ownerColor || '#ef4444';
      ctx.shadowBlur = 10;
      ctx.fill();

      // Center Army Icon
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`⚔️${march.count}`, 0, -14);

      ctx.restore();
    });

    ctx.restore();
  }

  function drawSelectionReticle(city) {
    ctx.save();
    const r = 24 + Math.sin(animTick * 6) * 3;
    ctx.beginPath();
    ctx.arc(city.x, city.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 4]);
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 12;
    ctx.stroke();

    // Four corner targeting markers
    const d = r + 4;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    // Top
    ctx.beginPath(); ctx.moveTo(city.x, city.y - d - 4); ctx.lineTo(city.x, city.y - d + 2); ctx.stroke();
    // Bottom
    ctx.beginPath(); ctx.moveTo(city.x, city.y + d - 2); ctx.lineTo(city.x, city.y + d + 4); ctx.stroke();
    // Left
    ctx.beginPath(); ctx.moveTo(city.x - d - 4, city.y); ctx.lineTo(city.x - d + 2, city.y); ctx.stroke();
    // Right
    ctx.beginPath(); ctx.moveTo(city.x + d - 2, city.y); ctx.lineTo(city.x + d + 4, city.y); ctx.stroke();

    ctx.restore();
  }

  function drawCities() {
    if (!gameState?.cities) return;
    ctx.save();

    for (const city of Object.values(gameState.cities)) {
      const owner = city.owner ? gameState.players?.[city.owner] : null;
      const isMine = city.owner === myPlayerId;
      const isHovered = city.name === hoveredCity;
      const isSelected = city.name === selectedCity;

      const fillColor = owner ? owner.color : '#64748b';
      const radius = city.isCapital ? 10 : 8;

      // Outer glow for owned cities
      if (owner) {
        ctx.beginPath();
        ctx.arc(city.x, city.y, radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = `${fillColor}33`;
        ctx.fill();
      }

      // Base City Node
      ctx.beginPath();
      ctx.arc(city.x, city.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.shadowColor = isHovered ? '#ffffff' : fillColor;
      ctx.shadowBlur = isHovered ? 14 : 6;
      ctx.fill();

      // Border ring
      ctx.beginPath();
      ctx.arc(city.x, city.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = isMine ? '#ffffff' : (isHovered ? '#ffd700' : 'rgba(255,255,255,0.7)');
      ctx.lineWidth = isMine ? 2.5 : 1.5;
      ctx.stroke();

      // Capital Star / Crown Icon
      if (city.isCapital) {
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⭐', city.x, city.y - 1);
      }

      // Fortress indicator
      if (city.levelFort > 0) {
        ctx.font = '9px sans-serif';
        ctx.fillText('🏰', city.x + 10, city.y - 8);
      }

      // Troop count badge pill
      drawTroopBadge(city.x, city.y + radius + 7, city.armies, isMine);

      // City Name Label
      ctx.font = city.isCapital ? 'bold 10px Rajdhani, sans-serif' : '600 9px Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      // Text background for readability
      const labelText = city.name;
      const textWidth = ctx.measureText(labelText).width;
      ctx.fillStyle = 'rgba(5, 10, 20, 0.75)';
      ctx.fillRect(city.x - textWidth / 2 - 2, city.y + radius + 15, textWidth + 4, 11);

      ctx.fillStyle = isMine ? '#38bdf8' : '#ffffff';
      ctx.fillText(labelText, city.x, city.y + radius + 15);
    }

    ctx.restore();
  }

  function drawTroopBadge(bx, by, count, isMine) {
    const str = count >= 1000 ? (count / 1000).toFixed(1) + 'k' : count.toString();
    ctx.font = 'bold 9px Orbitron, sans-serif';
    const w = Math.max(18, ctx.measureText(str).width + 8);
    const h = 12;

    ctx.fillStyle = isMine ? '#0284c7' : '#0f172a';
    ctx.strokeStyle = isMine ? '#38bdf8' : '#475569';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.roundRect(bx - w / 2, by - h / 2, w, h, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, bx, by);
  }

  function drawExplosions() {
    for (let i = combatExplosions.length - 1; i >= 0; i--) {
      const exp = combatExplosions[i];
      exp.radius += 1.5;
      exp.alpha -= 0.04;

      if (exp.alpha <= 0) {
        combatExplosions.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, exp.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(239, 68, 68, ${exp.alpha})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 15;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(exp.x, exp.y, exp.radius * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 215, 0, ${exp.alpha * 0.7})`;
      ctx.fill();
      ctx.restore();
    }
  }

  function triggerCombatEffect(cityName) {
    if (!gameState?.cities?.[cityName]) return;
    const city = gameState.cities[cityName];
    combatExplosions.push({
      x: city.x,
      y: city.y,
      radius: 6,
      alpha: 1.0
    });
  }

  return {
    init,
    setGameState: (state, myId) => {
      gameState = state;
      if (myId) myPlayerId = myId;
    },
    onCitySelect: (cb) => { onCitySelectCallback = cb; },
    onMarch: (cb) => { onMarchCallback = cb; },
    triggerCombatEffect,
    selectCity: (cityName) => { selectedCity = cityName; },
    fitMapToScreen
  };
})();
