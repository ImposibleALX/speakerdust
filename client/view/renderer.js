export function createPixelShipRenderer(ctx) {
  const shipCache = new Map();

  function getCachedShip(grid, pal, ps) {
    const key = grid.length + "_" + grid[0].length + "_" + (pal[1] || "") + "_" + ps;
    if (shipCache.has(key)) return shipCache.get(key);
    const rows = grid.length;
    const cols = grid[0].length;
    const oc = document.createElement("canvas");
    oc.width = cols * ps;
    oc.height = rows * ps;
    const octx = oc.getContext("2d");
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = grid[r][c];
        if (!v || !pal[v]) continue;
        octx.fillStyle = pal[v];
        octx.fillRect(c * ps, r * ps, ps, ps);
      }
    }
    const cached = { canvas: oc, cx: oc.width / 2, cy: oc.height / 2 };
    shipCache.set(key, cached);
    return cached;
  }

  function drawPixelShip(grid, cx, cy, angle, pal, ps) {
    const cached = getCachedShip(grid, pal, ps);
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(cy));
    ctx.rotate(angle + Math.PI / 2);
    ctx.drawImage(cached.canvas, -Math.floor(cached.cx), -Math.floor(cached.cy));
    ctx.restore();
  }

  return {
    drawPixelShip,
  };
}
