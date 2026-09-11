/**
 * map.js — Europe Map Renderer
 * Loads GeoJSON, projects with Mercator, renders countries on Canvas
 */

const EuropeMap = (() => {
  // ─── Config ──────────────────────────────────────────────────────────
  const EUROPE_BOUNDS = {
    minLng: -25,
    maxLng: 50,
    minLat: 34,
    maxLat: 72,
  };

  const OCEAN_COLOR = '#0c1220';
  const BORDER_COLOR = 'rgba(255, 255, 255, 0.25)';
  const BORDER_WIDTH = 1.2;
  const HOVER_BORDER_COLOR = '#00e5ff';
  const HOVER_BORDER_WIDTH = 2.5;
  const SELECTED_BORDER_COLOR = '#ffd740';
  const SELECTED_BORDER_WIDTH = 3;
  const NEUTRAL_COLOR = 'rgba(40, 50, 70, 0.7)';
  const ARMY_FONT = '700 13px "Orbitron", sans-serif';
  const NAME_FONT = '500 9px "Inter", sans-serif';

  const PLAYER_COLORS = [
    { fill: 'rgba(0, 229, 255, 0.45)', stroke: '#00e5ff', text: '#00e5ff' },
    { fill: 'rgba(255, 64, 129, 0.45)', stroke: '#ff4081', text: '#ff4081' },
    { fill: 'rgba(255, 215, 64, 0.45)', stroke: '#ffd740', text: '#ffd740' },
    { fill: 'rgba(118, 255, 3, 0.45)', stroke: '#76ff03', text: '#76ff03' },
    { fill: 'rgba(255, 145, 0, 0.45)', stroke: '#ff9100', text: '#ff9100' },
    { fill: 'rgba(179, 136, 255, 0.45)', stroke: '#b388ff', text: '#b388ff' },
  ];

  // ─── State ───────────────────────────────────────────────────────────
  let canvas, ctx;
  let geoData = null;
  let countryPaths = []; // { name, path, centroid, feature }
  let hoveredCountry = null;
  let selectedCountry = null;
  let targetCountry = null;

  // Camera
  let offsetX = 0, offsetY = 0;
  let scale = 1;
  let isDragging = false;
  let dragStartX, dragStartY;
  let lastOffsetX, lastOffsetY;

  // Callbacks
  let onCountryHover = null;
  let onCountryClick = null;

  // Game state ref
  let gameState = null;

  // ─── Projection ──────────────────────────────────────────────────────
  function mercatorY(lat) {
    const latRad = (lat * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  }

  function project(lng, lat) {
    const { minLng, maxLng, minLat, maxLat } = EUROPE_BOUNDS;
    const w = canvas.width;
    const h = canvas.height;

    // Add padding
    const padding = 40;
    const drawW = w - padding * 2;
    const drawH = h - padding * 2;

    const x = ((lng - minLng) / (maxLng - minLng)) * drawW + padding;

    const yMin = mercatorY(minLat);
    const yMax = mercatorY(maxLat);
    const yMerc = mercatorY(lat);
    const y = (1 - (yMerc - yMin) / (yMax - yMin)) * drawH + padding;

    return [x, y];
  }

  // ─── GeoJSON Processing ──────────────────────────────────────────────
  function buildCountryPaths() {
    countryPaths = [];
    if (!geoData) return;

    geoData.features.forEach(feature => {
      const name = feature.properties.name;
      const polygons = [];

      if (feature.geometry.type === 'Polygon') {
        polygons.push(feature.geometry.coordinates);
      } else if (feature.geometry.type === 'MultiPolygon') {
        feature.geometry.coordinates.forEach(poly => polygons.push(poly));
      }

      // Build Path2D
      const path = new Path2D();
      let totalX = 0, totalY = 0, totalPoints = 0;

      polygons.forEach(polygon => {
        polygon.forEach(ring => {
          let firstPoint = true;
          ring.forEach(([lng, lat]) => {
            const [x, y] = project(lng, lat);
            if (firstPoint) {
              path.moveTo(x, y);
              firstPoint = false;
            } else {
              path.lineTo(x, y);
            }
            totalX += x;
            totalY += y;
            totalPoints++;
          });
          path.closePath();
        });
      });

      const centroid = totalPoints > 0
        ? [totalX / totalPoints, totalY / totalPoints]
        : [0, 0];

      countryPaths.push({ name, path, centroid, feature });
    });
  }

  // ─── Rendering ───────────────────────────────────────────────────────
  function render() {
    if (!canvas || !ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.fillStyle = OCEAN_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Draw grid
    drawGrid();

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Draw countries
    countryPaths.forEach(({ name, path, centroid }) => {
      const territory = gameState?.territories?.[name];
      const owner = territory?.owner;
      const armies = territory?.armies || 0;
      const colorIndex = owner ? getPlayerColorIndex(owner) : -1;
      const isHovered = hoveredCountry === name;
      const isSelected = selectedCountry === name;
      const isTarget = targetCountry === name;

      // Fill
      if (colorIndex >= 0) {
        ctx.fillStyle = PLAYER_COLORS[colorIndex].fill;
      } else {
        ctx.fillStyle = NEUTRAL_COLOR;
      }
      ctx.fill(path);

      // Hovered glow
      if (isHovered && !isSelected) {
        ctx.fillStyle = 'rgba(0, 229, 255, 0.1)';
        ctx.fill(path);
      }

      // Selected glow
      if (isSelected) {
        ctx.fillStyle = 'rgba(255, 215, 64, 0.15)';
        ctx.fill(path);
      }

      // Target glow
      if (isTarget) {
        ctx.fillStyle = 'rgba(255, 64, 129, 0.15)';
        ctx.fill(path);
      }

      // Border
      ctx.lineWidth = BORDER_WIDTH;
      ctx.strokeStyle = BORDER_COLOR;
      if (isSelected) {
        ctx.lineWidth = SELECTED_BORDER_WIDTH;
        ctx.strokeStyle = SELECTED_BORDER_COLOR;
      } else if (isTarget) {
        ctx.lineWidth = HOVER_BORDER_WIDTH;
        ctx.strokeStyle = '#ff4081';
      } else if (isHovered) {
        ctx.lineWidth = HOVER_BORDER_WIDTH;
        ctx.strokeStyle = HOVER_BORDER_COLOR;
      }
      ctx.stroke(path);

      // Army count badge
      if (territory && owner) {
        drawArmyBadge(centroid, armies, colorIndex, isSelected || isHovered);
      }
    });

    ctx.restore();

    requestAnimationFrame(render);
  }

  function drawArmyBadge(centroid, armies, colorIndex, highlight) {
    const [cx, cy] = centroid;
    const r = highlight ? 16 : 14;
    const colors = colorIndex >= 0 ? PLAYER_COLORS[colorIndex] : { stroke: '#fff', text: '#fff' };

    // Background circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 14, 23, 0.85)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.stroke;
    ctx.stroke();

    // Number
    ctx.fillStyle = colors.text;
    ctx.font = ARMY_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(armies.toString(), cx, cy + 1);
  }

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;

    // Longitude lines
    for (let lng = -20; lng <= 45; lng += 5) {
      ctx.beginPath();
      const [x1, y1] = project(lng, EUROPE_BOUNDS.minLat);
      const [x2, y2] = project(lng, EUROPE_BOUNDS.maxLat);
      ctx.moveTo(x1 * scale + offsetX, y1 * scale + offsetY);
      ctx.lineTo(x2 * scale + offsetX, y2 * scale + offsetY);
      ctx.stroke();
    }

    // Latitude lines
    for (let lat = 35; lat <= 70; lat += 5) {
      ctx.beginPath();
      const [x1, y1] = project(EUROPE_BOUNDS.minLng, lat);
      const [x2, y2] = project(EUROPE_BOUNDS.maxLng, lat);
      ctx.moveTo(x1 * scale + offsetX, y1 * scale + offsetY);
      ctx.lineTo(x2 * scale + offsetX, y2 * scale + offsetY);
      ctx.stroke();
    }
    ctx.restore();
  }

  function getPlayerColorIndex(playerId) {
    if (!gameState?.players) return -1;
    const player = gameState.players[playerId];
    return player ? player.colorIndex : -1;
  }

  // ─── Hit Testing ─────────────────────────────────────────────────────
  function getCountryAtPoint(mx, my) {
    // Transform mouse coords to map space
    const mapX = (mx - offsetX) / scale;
    const mapY = (my - offsetY) / scale;

    for (let i = countryPaths.length - 1; i >= 0; i--) {
      if (ctx.isPointInPath(countryPaths[i].path, mapX, mapY)) {
        return countryPaths[i].name;
      }
    }
    return null;
  }

  // ─── Mouse Events ───────────────────────────────────────────────────
  function setupEvents() {
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);

      if (isDragging) {
        offsetX = lastOffsetX + (e.clientX - dragStartX);
        offsetY = lastOffsetY + (e.clientY - dragStartY);
        return;
      }

      const country = getCountryAtPoint(mx, my);
      if (country !== hoveredCountry) {
        hoveredCountry = country;
        canvas.style.cursor = country ? 'pointer' : 'crosshair';
        if (onCountryHover) onCountryHover(country, e.clientX, e.clientY);
      } else if (country && onCountryHover) {
        onCountryHover(country, e.clientX, e.clientY);
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
        const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const my = (e.clientY - rect.top) * (canvas.height / rect.height);
        const country = getCountryAtPoint(mx, my);
        if (country && onCountryClick) onCountryClick(country);
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      const newScale = Math.max(0.5, Math.min(5, scale * zoomFactor));

      // Zoom towards mouse
      offsetX = mx - (mx - offsetX) * (newScale / scale);
      offsetY = my - (my - offsetY) * (newScale / scale);
      scale = newScale;
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Resize
    window.addEventListener('resize', handleResize);
  }

  function handleResize() {
    if (!canvas) return;
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    buildCountryPaths();
  }

  // ─── Public API ──────────────────────────────────────────────────────
  async function init(canvasElement) {
    canvas = canvasElement;
    ctx = canvas.getContext('2d');
    handleResize();

    // Load GeoJSON
    const res = await fetch('/data/europe.geo.json');
    geoData = await res.json();
    buildCountryPaths();
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

  function onHover(cb) { onCountryHover = cb; }
  function onClick(cb) { onCountryClick = cb; }

  function getCountryPaths() { return countryPaths; }

  return {
    init,
    setGameState,
    setSelected,
    setTarget,
    clearSelection,
    onHover,
    onClick,
    getCountryPaths,
  };
})();
