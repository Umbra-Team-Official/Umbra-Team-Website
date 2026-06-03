(function () {
  const canvas = document.getElementById('rain-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  const CONFIG = {
    dropCount: 180,
    spawnRate: 4,
    minSpeed: 5,
    maxSpeed: 11,
    minLength: 10,
    maxLength: 22,
    splashCount: 5,
    dropColor: 'rgba(210, 215, 225, 0.75)',
    splashColor: 'rgba(235, 238, 245, 0.85)',
    alphaThreshold: 24,
    collisionSampleStep: 2,
    maxMaskSize: 384,
    maskNoiseNeighborRadius: 1,
    maskNoiseMinNeighbors: 2,
  };

  let width = 0;
  let height = 0;
  let drops = [];
  let splashes = [];
  const collisionMaskCache = new WeakMap();
  let collisionTargets = [];
  let running = false;
  let rafId = 0;

  function isReducedMotion() {
    return motionQuery.matches;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function buildMaskForImage(img) {
    if (!img.currentSrc || !img.naturalWidth || !img.naturalHeight) return null;

    const cacheKey = [img.currentSrc, img.naturalWidth, img.naturalHeight].join('|');
    const cached = collisionMaskCache.get(img);
    if (cached && cached.key === cacheKey) return cached.mask;

    const scale = Math.min(
      1,
      CONFIG.maxMaskSize / Math.max(img.naturalWidth, img.naturalHeight)
    );
    const maskWidth = Math.max(1, Math.round(img.naturalWidth * scale));
    const maskHeight = Math.max(1, Math.round(img.naturalHeight * scale));
    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskCtx) return null;

    maskCanvas.width = maskWidth;
    maskCanvas.height = maskHeight;
    maskCtx.clearRect(0, 0, maskWidth, maskHeight);

    try {
      maskCtx.drawImage(img, 0, 0, maskWidth, maskHeight);
      const alpha = maskCtx.getImageData(0, 0, maskWidth, maskHeight).data;
      const solid = new Uint8Array(maskWidth * maskHeight);

      for (let index = 0; index < solid.length; index += 1) {
        solid[index] = alpha[index * 4 + 3] >= CONFIG.alphaThreshold ? 1 : 0;
      }

      const filtered = new Uint8Array(maskWidth * maskHeight);
      for (let y = 0; y < maskHeight; y += 1) {
        for (let x = 0; x < maskWidth; x += 1) {
          const index = y * maskWidth + x;
          if (!solid[index]) continue;

          let neighborCount = 0;
          for (
            let offsetY = -CONFIG.maskNoiseNeighborRadius;
            offsetY <= CONFIG.maskNoiseNeighborRadius;
            offsetY += 1
          ) {
            const sampleY = y + offsetY;
            if (sampleY < 0 || sampleY >= maskHeight) continue;

            for (
              let offsetX = -CONFIG.maskNoiseNeighborRadius;
              offsetX <= CONFIG.maskNoiseNeighborRadius;
              offsetX += 1
            ) {
              const sampleX = x + offsetX;
              if (sampleX < 0 || sampleX >= maskWidth) continue;

              neighborCount += solid[sampleY * maskWidth + sampleX];
            }
          }

          if (neighborCount >= CONFIG.maskNoiseMinNeighbors) {
            filtered[index] = 1;
          }
        }
      }

      const mask = { width: maskWidth, height: maskHeight, solid: filtered };
      collisionMaskCache.set(img, { key: cacheKey, mask });
      return mask;
    } catch {
      return null;
    }
  }

  function updateCollisionTargets() {
    collisionTargets = [];
    document.querySelectorAll('[data-rain-collision]').forEach((el) => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;

      const pad = 6;
      const target = {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        hitLeft: rect.left - pad,
        hitRight: rect.right + pad,
        hitTop: rect.top - pad,
        hitBottom: rect.bottom + pad,
        mask: el instanceof HTMLImageElement ? buildMaskForImage(el) : null,
        collisionTop: Math.max(0, Math.min(1, Number(el.dataset.rainCollisionTop) || 0)),
        collisionBottom: Math.max(0, Math.min(1, Number(el.dataset.rainCollisionBottom) || 1)),
      };

      collisionTargets.push(target);

      if (el instanceof HTMLImageElement && !el.complete) {
        el.addEventListener('load', updateCollisionTargets, { once: true });
      }
    });
  }

  function pointHitsTarget(target, x, y) {
    if (!target.mask) return true;

    const localX = (x - target.left) / (target.right - target.left);
    const localY = (y - target.top) / (target.bottom - target.top);
    if (localX < 0 || localX > 1 || localY < 0 || localY > 1) return false;
    if (localY < target.collisionTop || localY > target.collisionBottom) return false;

    const pixelX = Math.max(
      0,
      Math.min(target.mask.width - 1, Math.floor(localX * target.mask.width))
    );
    const pixelY = Math.max(
      0,
      Math.min(target.mask.height - 1, Math.floor(localY * target.mask.height))
    );

    return target.mask.solid[pixelY * target.mask.width + pixelX] === 1;
  }

  function hitCollision(x, y1, y2) {
    const ya = Math.min(y1, y2);
    const yb = Math.max(y1, y2);
    for (const target of collisionTargets) {
      if (x < target.hitLeft || x > target.hitRight) continue;
      if (yb < target.hitTop || ya > target.hitBottom) continue;

      const sampleStart = Math.max(ya, target.hitTop);
      const sampleEnd = Math.min(yb, target.hitBottom);
      for (
        let sampleY = sampleStart;
        sampleY <= sampleEnd;
        sampleY += CONFIG.collisionSampleStep
      ) {
        if (pointHitsTarget(target, x, sampleY)) return true;
      }

      if (pointHitsTarget(target, x, sampleEnd)) return true;
    }
    return false;
  }

  function spawnDrop() {
    drops.push({
      x: Math.random() * width,
      y: -30,
      prevY: -30,
      speed: CONFIG.minSpeed + Math.random() * (CONFIG.maxSpeed - CONFIG.minSpeed),
      length: CONFIG.minLength + Math.random() * (CONFIG.maxLength - CONFIG.minLength),
    });
  }

  function spawnSplash(x, y) {
    for (let i = 0; i < CONFIG.splashCount; i++) {
      const angle = Math.PI + Math.random() * Math.PI;
      const speed = 1.2 + Math.random() * 3;
      splashes.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        life: 14 + Math.random() * 10,
        maxLife: 24,
      });
    }
  }

  function update() {
    updateCollisionTargets();

    const maxDrops = isReducedMotion() ? 40 : CONFIG.dropCount;
    const rate = isReducedMotion() ? 1 : CONFIG.spawnRate;

    for (let i = 0; i < rate; i++) {
      if (drops.length < maxDrops) spawnDrop();
    }

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.prevY = d.y;
      d.y += d.speed;
      const tipY = d.y;

      if (hitCollision(d.x, d.prevY - d.length, tipY)) {
        spawnSplash(d.x, Math.min(tipY, height));
        drops.splice(i, 1);
        continue;
      }

      if (d.y - d.length > height) {
        drops.splice(i, 1);
      }
    }

    splashes.forEach((s) => {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.18;
      s.life -= 1;
    });
    splashes = splashes.filter((s) => s.life > 0);
    if (splashes.length > 250) splashes.length = 250;
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = CONFIG.dropColor;
    ctx.lineWidth = 1.25;
    ctx.lineCap = 'round';

    for (const d of drops) {
      ctx.beginPath();
      ctx.moveTo(d.x, d.y - d.length);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }

    ctx.fillStyle = CONFIG.splashColor;
    for (const s of splashes) {
      ctx.globalAlpha = (s.life / s.maxLife) * 0.9;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function loop() {
    if (!running) return;
    update();
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    resize();
    updateCollisionTargets();
    loop();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    ctx.clearRect(0, 0, width, height);
    drops = [];
    splashes = [];
  }

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', updateCollisionTargets, { passive: true });
  window.addEventListener('load', updateCollisionTargets);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  motionQuery.addEventListener('change', () => {
    if (isReducedMotion()) {
    }
  });
})();
