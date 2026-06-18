(function(){
  "use strict";

  const CFG = Object.assign({
    mode:"pulse",
    title:"观察力游戏",
    displayTitle:"观 察 力 游 戏",
    subtitle:"黑白动态观察",
    welcomeSub:"观察动态黑白矩阵，完成关卡。"
  }, window.NEO_GAME || {});

  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const shuffle = arr => {
    for(let i=arr.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]]=[arr[j],arr[i]];
    }
    return arr;
  };
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const now = () => performance.now() / 1000;

  let game, canvas, ctx, stars, starsCtx, dpr = 1, layout = null, raf = 0;
  let audioCtx = null, starBits = [];

  function rng(seed){
    let t = seed >>> 0;
    return function(){
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ t >>> 15, 1 | t);
      r ^= r + Math.imul(r ^ r >>> 7, 61 | r);
      return ((r ^ r >>> 14) >>> 0) / 4294967296;
    };
  }

  function mount(){
    document.documentElement.style.setProperty("--accent", CFG.accent || "#8de8ff");
    document.documentElement.style.setProperty("--accent2", CFG.accent2 || "#f6d36b");
    document.body.innerHTML = `
      <canvas id="stars"></canvas>
      <div id="welcome">
        <div class="modal">
          <div id="welcome-logo">G-Game</div>
          <div id="welcome-title">${CFG.title}</div>
          <div id="welcome-sub">${CFG.welcomeSub}</div>
          <div id="welcome-demo"></div>
          <button id="welcome-start">开始游戏</button>
        </div>
      </div>
      <main id="app">
        <div id="title-wrap">
          <h1>${CFG.displayTitle || CFG.title}</h1>
          <div id="subtitle">${CFG.subtitle}</div>
        </div>
        <section id="level-card">
          <div id="level-top">
            <span id="level-kicker">第 1 关</span>
            <span id="level-size">5x5</span>
          </div>
          <div id="level-name"></div>
          <div id="level-note"></div>
          <div id="rail"></div>
        </section>
        <div id="hud">
          <span>命中 <b id="hit">0</b></span>
          <span>失误 <b id="miss">0</b></span>
          <span>时间 <b id="time">0</b>s</span>
          <span>进度 <b id="progress">0/1</b></span>
        </div>
        <div id="stage-wrap">
          <div id="stage-shell"><canvas id="game"></canvas></div>
        </div>
        <div id="meter"></div>
        <div id="buttons">
          <button class="btn" id="btn-new">重开本关</button>
          <button class="btn" id="btn-action">确认</button>
          <button class="btn" id="btn-sound">音效开</button>
        </div>
        <div id="msg"></div>
      </main>
      <div id="settle">
        <div class="modal">
          <div id="settle-title">关卡完成</div>
          <div id="settle-sub"></div>
          <div id="rank">S</div>
          <div id="stars-line">★★★</div>
          <div id="settle-rows"></div>
          <div class="total"><span>总分</span><span id="score">0</span></div>
          <div id="best"></div>
          <div id="settle-btns">
            <button class="btn" id="again">再玩</button>
            <button class="btn" id="next">下一关</button>
            <button class="btn" id="close">关闭</button>
          </div>
        </div>
      </div>
    `;
    const demo = $("welcome-demo");
    for(let i=0;i<25;i++) demo.appendChild(document.createElement("span"));
  }

  function init(){
    const mode = MODES[CFG.mode] || MODES.pulse;
    game = {
      mode,
      levels:mode.levels(),
      levelIndex:0,
      level:null,
      state:null,
      started:false,
      ended:false,
      hits:0,
      misses:0,
      taps:0,
      timeLeft:0,
      timer:null,
      timeouts:[],
      sound:true,
      pointer:{x:0,y:0,active:false,down:false},
      lastFlash:null,
      messageTimer:null
    };
    document.documentElement.style.setProperty("--levels", game.levels.length);
    canvas = $("game");
    if(CFG.canvasCursor) canvas.style.cursor = CFG.canvasCursor;
    ctx = canvas.getContext("2d");
    stars = $("stars");
    starsCtx = stars.getContext("2d");
    bind();
    setupStars();
    drawWelcomeDemo();
    loadLevel(0, false);
    raf = requestAnimationFrame(loop);
  }

  function bind(){
    $("welcome-start").addEventListener("click", () => {
      if(game.started) return;
      game.started = true;
      $("welcome").classList.add("hide");
      setTimeout(() => $("welcome").style.display = "none", 380);
      sound("start");
      newRound(false);
    });
    $("btn-new").addEventListener("click", () => newRound(true));
    $("btn-action").addEventListener("click", () => {
      if(game.ended || !game.state) return;
      game.mode.action(game);
    });
    $("btn-sound").addEventListener("click", () => {
      game.sound = !game.sound;
      $("btn-sound").textContent = game.sound ? "音效开" : "音效关";
      if(game.sound) sound("tap");
    });
    $("again").addEventListener("click", () => {
      $("settle").classList.remove("show");
      newRound(true);
    });
    $("next").addEventListener("click", () => {
      $("settle").classList.remove("show");
      loadLevel(game.levelIndex < game.levels.length - 1 ? game.levelIndex + 1 : 0, true);
    });
    $("close").addEventListener("click", () => $("settle").classList.remove("show"));
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    window.addEventListener("resize", resize);
    document.addEventListener("selectstart", e => e.preventDefault(), {passive:false});
    document.addEventListener("dragstart", e => e.preventDefault(), {passive:false});
    document.addEventListener("contextmenu", e => e.preventDefault(), {passive:false});
  }

  function loadLevel(index, start){
    game.levelIndex = clamp(index, 0, game.levels.length - 1);
    game.level = game.levels[game.levelIndex];
    $("level-kicker").textContent = "第 " + (game.levelIndex + 1) + " / " + game.levels.length + " 关";
    $("level-size").textContent = game.level.sizeLabel || (game.level.n + "x" + game.level.n);
    $("level-name").textContent = game.level.name;
    $("level-note").textContent = game.level.note;
    renderRail();
    if(start || game.started) newRound(false);
    else updateUI();
  }

  function newRound(playSound){
    clearRun();
    game.ended = false;
    game.hits = 0;
    game.misses = 0;
    game.taps = 0;
    game.timeLeft = game.level.time;
    game.lastFlash = null;
    game.pointer.active = false;
    game.state = game.mode.create(game.level, game.levelIndex);
    $("settle").classList.remove("show");
    updateUI();
    setMessage(game.level.note, 900);
    startTimer();
    resize();
    if(playSound) sound("start");
    if(game.mode.afterStart) game.mode.afterStart(game);
  }

  function clearRun(){
    if(game.timer) clearInterval(game.timer);
    game.timer = null;
    game.timeouts.forEach(id => clearTimeout(id));
    game.timeouts = [];
  }

  function later(fn, ms){
    const id = setTimeout(() => {
      game.timeouts = game.timeouts.filter(x => x !== id);
      fn();
    }, ms);
    game.timeouts.push(id);
    return id;
  }

  function startTimer(){
    $("time").textContent = game.timeLeft;
    $("time").classList.toggle("low", game.timeLeft <= 10);
    game.timer = setInterval(() => {
      game.timeLeft -= 1;
      $("time").textContent = game.timeLeft;
      $("time").classList.toggle("low", game.timeLeft <= 10);
      if(game.timeLeft <= 0) finish(false, "时间到");
    }, 1000);
  }

  function updateUI(){
    $("hit").textContent = game.hits;
    $("miss").textContent = game.misses;
    $("progress").textContent = game.state ? game.mode.progress(game) : "0/1";
    const action = game.state ? game.mode.actionText(game) : "";
    $("btn-action").style.display = action ? "inline-block" : "none";
    $("btn-action").textContent = action || "";
    $("btn-action").disabled = !!(game.state && game.mode.actionDisabled && game.mode.actionDisabled(game));
    renderMeter();
  }

  function renderRail(){
    const rail = $("rail");
    rail.innerHTML = "";
    for(let i=0;i<game.levels.length;i++){
      const d = document.createElement("span");
      d.className = "rail-dot " + (i < game.levelIndex ? "done" : i === game.levelIndex ? "now" : "");
      rail.appendChild(d);
    }
  }

  function renderMeter(){
    const meter = $("meter");
    const items = game.state && game.mode.meter ? game.mode.meter(game) : [];
    meter.style.display = items.length ? "grid" : "none";
    meter.style.setProperty("--meter", Math.max(1, items.length));
    meter.innerHTML = "";
    items.forEach(v => {
      const d = document.createElement("span");
      d.className = "meter-dot " + (v || "");
      meter.appendChild(d);
    });
  }

  function setMessage(text, ms){
    clearTimeout(game.messageTimer);
    $("msg").textContent = text || "";
    if(ms){
      game.messageTimer = setTimeout(() => {
        if($("msg").textContent === text) $("msg").textContent = "";
      }, ms);
    }
  }

  function resize(){
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
    resizeStars();
  }

  function loop(){
    drawStars();
    drawGame(now());
    raf = requestAnimationFrame(loop);
  }

  function drawGame(t){
    if(!ctx || !game.state){
      ctx && ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);
      return;
    }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0,0,w,h);
    ctx.save();
    ctx.fillStyle = "rgba(4,7,18,.72)";
    roundRect(ctx, 0, 0, w, h, 6);
    ctx.fill();
    game.mode.draw(game, ctx, t, w, h);
    ctx.restore();
  }

  function gridLayout(cols, rows, w, h, opts){
    const pad = opts && opts.pad != null ? opts.pad : 10;
    const baseGap = opts && opts.gap != null ? opts.gap : 7;
    const split = opts && opts.splitAt;
    const splitGap = split ? Math.max(baseGap + 12, 14) : 0;
    const fitW = (w - pad * 2 - baseGap * (cols - 1) - splitGap) / cols;
    const fitH = (h - pad * 2 - baseGap * (rows - 1)) / rows;
    const cell = Math.floor(Math.max(12, Math.min(fitW, fitH)));
    const totalW = cell * cols + baseGap * (cols - 1) + splitGap;
    const totalH = cell * rows + baseGap * (rows - 1);
    return {cols, rows, cell, gap:baseGap, splitAt:split || 0, splitGap, x:(w-totalW)/2, y:(h-totalH)/2, w:totalW, h:totalH};
  }

  function cellRect(lay, index){
    const r = Math.floor(index / lay.cols);
    const c = index % lay.cols;
    const extra = lay.splitAt && c >= lay.splitAt ? lay.splitGap : 0;
    return {
      x:lay.x + c * (lay.cell + lay.gap) + extra,
      y:lay.y + r * (lay.cell + lay.gap),
      w:lay.cell,
      h:lay.cell,
      r,
      c
    };
  }

  function cellAt(px, py){
    if(!layout) return -1;
    for(let i=0;i<layout.cols*layout.rows;i++){
      const r = cellRect(layout, i);
      if(px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
    }
    return -1;
  }

  function pointerXY(evt){
    const r = canvas.getBoundingClientRect();
    return {x:evt.clientX - r.left, y:evt.clientY - r.top};
  }

  function pointerDown(evt){
    if(game.ended || !game.state) return;
    canvas.setPointerCapture && canvas.setPointerCapture(evt.pointerId);
    const p = pointerXY(evt);
    game.pointer = {x:p.x,y:p.y,active:true,down:true};
    if(game.mode.pointerDown) game.mode.pointerDown(game, p);
  }

  function pointerMove(evt){
    if(!game.state) return;
    const p = pointerXY(evt);
    game.pointer.x = p.x;
    game.pointer.y = p.y;
    game.pointer.active = true;
    if(game.mode.pointerMove) game.mode.pointerMove(game, p);
  }

  function pointerUp(evt){
    if(game.ended || !game.state) return;
    const p = pointerXY(evt);
    game.pointer.x = p.x;
    game.pointer.y = p.y;
    game.pointer.down = false;
    const i = cellAt(p.x, p.y);
    if(i >= 0) game.mode.click(game, i, p);
  }

  function hitCell(message){
    game.hits += 1;
    game.taps += 1;
    sound("good");
    setMessage(message || "命中", 520);
    updateUI();
    later(() => finish(true, "完成"), 420);
  }

  function missCell(message){
    game.misses += 1;
    game.taps += 1;
    sound("bad");
    setMessage(message || "误判", 620);
    updateUI();
  }

  function finish(cleared, title){
    if(game.ended) return;
    game.ended = true;
    clearRun();
    updateUI();
    sound(cleared ? "win" : "fail");
    showSettle(cleared, title);
  }

  function showSettle(cleared, title){
    const lvl = game.level;
    const acc = game.taps ? Math.max(0, 1 - game.misses / game.taps) : 0;
    const clearScore = cleared ? lvl.base : 0;
    const focusScore = cleared ? Math.round(lvl.base * acc) : 0;
    const timeScore = cleared ? Math.round(game.timeLeft * lvl.rate) : 0;
    const score = clearScore + focusScore + timeScore;
    const rank = !cleared ? "C" : acc >= .98 && game.timeLeft > lvl.time * .32 ? "S" : acc >= .84 ? "A" : acc >= .62 ? "B" : "C";
    const stars = rank === "S" ? 3 : rank === "A" ? 3 : rank === "B" ? 2 : 1;
    const color = rank === "S" ? "var(--accent2)" : rank === "A" ? "var(--accent)" : rank === "B" ? "#a98cff" : "#aab4c6";
    $("settle-title").textContent = cleared ? "关卡完成" : (title || "未完成");
    $("settle-sub").textContent = "第 " + (game.levelIndex + 1) + " / " + game.levels.length + " 关 · " + lvl.name;
    $("rank").textContent = rank;
    $("rank").style.color = color;
    $("stars-line").textContent = "★★★".slice(0, stars) + "☆☆☆".slice(0, 3 - stars);
    $("stars-line").style.color = color;
    $("settle-rows").innerHTML = [
      ["通关奖励", clearScore],
      ["专注加成", focusScore],
      ["时间奖励", timeScore],
      ["命中 / 失误", game.hits + " / " + game.misses]
    ].map(row => `<div class="settle-row"><span>${row[0]}</span><span>${typeof row[1] === "number" ? "+" + row[1] : row[1]}</span></div>`).join("");
    $("score").textContent = score;
    const key = "neo_observe_best_" + CFG.mode + "_" + game.levelIndex;
    const prev = safeGet(key);
    if(cleared && score > prev) safeSet(key, score);
    $("best").textContent = cleared ? (score > prev ? "新纪录，之前最佳 " + prev : "本关最佳 " + Math.max(prev, score)) : "本关未完成";
    $("next").textContent = game.levelIndex < game.levels.length - 1 ? "下一关" : "从头开始";
    $("settle").classList.add("show");
    sparks(window.innerWidth/2, window.innerHeight*.42, cleared ? 16 : 6);
  }

  function safeGet(k){try{return +(localStorage.getItem(k) || 0)}catch(e){return 0}}
  function safeSet(k,v){try{localStorage.setItem(k, String(v))}catch(e){}}

  function levels(names, build){
    return names.map((name, i) => Object.assign({
      name,
      note:"",
      n:4,
      time:34,
      base:850 + i * 90,
      rate:8 + Math.floor(i / 4)
    }, build(i)));
  }

  function cellData(rand, i, levelIndex){
    return {
      tone:rand() > .5 ? 1 : 0,
      pattern:Math.floor(rand() * (levelIndex > 6 ? 9 : 7)),
      mark:levelIndex > 7 && rand() > .75 ? pick(["·","+","◇","×"]) : "",
      phase:rand() * TAU
    };
  }

  function drawCell(desc, rect, t, opt){
    opt = opt || {};
    const pulse = opt.pulse || 0;
    const alpha = opt.alpha == null ? 1 : opt.alpha;
    const glow = opt.glow || 0;
    const wrong = opt.wrong || 0;
    const size = rect.w * (1 + pulse * .07);
    const x = rect.x + (rect.w - size) / 2;
    const y = rect.y + (rect.h - size) / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    if(glow || wrong){
      ctx.shadowBlur = wrong ? 20 : 24 + glow * 16;
      ctx.shadowColor = wrong ? "rgba(255,116,116,.85)" : "rgba(141,232,255,.85)";
    }
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    if(desc.tone){
      g.addColorStop(0, opt.flash ? "#2b355c" : "#171e33");
      g.addColorStop(1, opt.flash ? "#070b19" : "#080b17");
      ctx.strokeStyle = "rgba(135,158,222,.42)";
    }else{
      g.addColorStop(0, opt.flash ? "#ffffff" : "#f3f7ff");
      g.addColorStop(1, opt.flash ? "#bfcee8" : "#d7e0ef");
      ctx.strokeStyle = "rgba(255,255,255,.54)";
    }
    roundRect(ctx, x, y, size, size, Math.max(5, size * .14));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * .035);
    ctx.stroke();
    ctx.save();
    roundRect(ctx, x, y, size, size, Math.max(5, size * .14));
    ctx.clip();
    ctx.globalAlpha *= desc.tone ? .28 : .36;
    ctx.strokeStyle = desc.tone ? "#eaf2ff" : "#0a1022";
    drawPattern(desc.pattern || 0, x, y, size);
    ctx.restore();
    if(desc.mark){
      ctx.fillStyle = desc.tone ? "#eaf2ff" : "#0a1022";
      ctx.globalAlpha = alpha * .55;
      ctx.font = "900 " + Math.round(size * .38) + "px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(desc.mark, x + size/2, y + size/2 + size*.015);
    }
    if(opt.signal){
      drawSignal(x, y, size, opt.signalAlpha == null ? .62 : opt.signalAlpha);
    }
    if(opt.label){
      ctx.fillStyle = opt.labelColor || "#f6d36b";
      ctx.globalAlpha = alpha;
      ctx.font = "950 " + Math.round(size * .42) + "px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(opt.label, x + size/2, y + size/2);
    }
    ctx.restore();
  }

  function drawPattern(kind, x, y, s){
    const c = x + s/2, m = y + s/2;
    ctx.lineWidth = Math.max(2, s * .055);
    if(kind === 0){
      ctx.beginPath(); ctx.arc(c,m,s*.18,0,TAU); ctx.stroke();
    }else if(kind === 1){
      ctx.beginPath(); ctx.moveTo(x+s*.2,m); ctx.lineTo(x+s*.8,m); ctx.stroke();
    }else if(kind === 2){
      ctx.beginPath(); ctx.moveTo(c,y+s*.2); ctx.lineTo(c,y+s*.8); ctx.stroke();
    }else if(kind === 3){
      ctx.beginPath(); ctx.moveTo(x+s*.22,y+s*.22); ctx.lineTo(x+s*.78,y+s*.78); ctx.stroke();
    }else if(kind === 4){
      ctx.beginPath(); ctx.moveTo(x+s*.78,y+s*.22); ctx.lineTo(x+s*.22,y+s*.78); ctx.stroke();
    }else if(kind === 5){
      ctx.strokeRect(x+s*.27,y+s*.27,s*.46,s*.46);
    }else if(kind === 6){
      ctx.beginPath(); ctx.moveTo(c,y+s*.19); ctx.lineTo(x+s*.81,m); ctx.lineTo(c,y+s*.81); ctx.lineTo(x+s*.19,m); ctx.closePath(); ctx.stroke();
    }else if(kind === 7){
      for(let k=-2;k<5;k++){ctx.beginPath();ctx.moveTo(x+k*s*.22,y);ctx.lineTo(x+(k+2)*s*.22,y+s);ctx.stroke();}
    }else{
      for(let k=1;k<4;k++){ctx.beginPath();ctx.moveTo(x+s*k/4,y+s*.18);ctx.lineTo(x+s*k/4,y+s*.82);ctx.stroke();}
    }
  }

  function drawSignal(x, y, s, a){
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.strokeStyle = CFG.accent2 || "#f6d36b";
    ctx.lineWidth = Math.max(2, s * .055);
    const c = x + s/2, m = y + s/2;
    ctx.beginPath(); ctx.arc(c,m,s*.18,0,TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c,y+s*.22); ctx.lineTo(c,y+s*.78); ctx.moveTo(x+s*.22,m); ctx.lineTo(x+s*.78,m); ctx.stroke();
    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r){
    r = Math.min(r, w/2, h/2);
    c.beginPath();
    c.moveTo(x+r,y);
    c.arcTo(x+w,y,x+w,y+h,r);
    c.arcTo(x+w,y+h,x,y+h,r);
    c.arcTo(x,y+h,x,y,r);
    c.arcTo(x,y,x+w,y,r);
    c.closePath();
  }

  function drawBoardFrame(lay){
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 2;
    roundRect(ctx, lay.x - 8, lay.y - 8, lay.w + 16, lay.h + 16, 8);
    ctx.stroke();
    if(lay.splitAt){
      const splitX = cellRect(lay, lay.splitAt).x - lay.gap/2 - lay.splitGap/2;
      ctx.strokeStyle = "rgba(141,232,255,.26)";
      ctx.setLineDash([6,6]);
      ctx.beginPath();
      ctx.moveTo(splitX, lay.y - 6);
      ctx.lineTo(splitX, lay.y + lay.h + 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  function setupStars(){
    resizeStars();
    const glyphs = CFG.glyphs || ["□","■","◇","◆","✦","+"];
    starBits = Array.from({length:36}, () => ({
      x:Math.random()*stars.clientWidth,
      y:Math.random()*stars.clientHeight,
      s:8+Math.random()*15,
      vx:(Math.random()-.5)*.25,
      vy:-.12-Math.random()*.25,
      a:.07+Math.random()*.22,
      r:Math.random()*TAU,
      rv:(Math.random()-.5)*.015,
      g:pick(glyphs)
    }));
  }

  function resizeStars(){
    if(!stars) return;
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    stars.width = Math.round(window.innerWidth * ratio);
    stars.height = Math.round(window.innerHeight * ratio);
    stars.style.width = window.innerWidth + "px";
    stars.style.height = window.innerHeight + "px";
    starsCtx.setTransform(ratio,0,0,ratio,0,0);
  }

  function drawStars(){
    if(!starsCtx) return;
    const w = window.innerWidth, h = window.innerHeight;
    starsCtx.clearRect(0,0,w,h);
    for(const f of starBits){
      f.x += f.vx; f.y += f.vy; f.r += f.rv;
      if(f.y < -24){f.y = h + 24; f.x = Math.random()*w;}
      if(f.x < -24) f.x = w + 24;
      if(f.x > w + 24) f.x = -24;
      starsCtx.save();
      starsCtx.globalAlpha = f.a;
      starsCtx.translate(f.x,f.y);
      starsCtx.rotate(f.r);
      starsCtx.fillStyle = f.g === "■" || f.g === "◆" ? "#11182a" : "#e6f0ff";
      starsCtx.font = "900 " + f.s + "px system-ui";
      starsCtx.textAlign = "center";
      starsCtx.textBaseline = "middle";
      starsCtx.fillText(f.g,0,0);
      starsCtx.restore();
    }
  }

  function drawWelcomeDemo(){
    let flip = false;
    const demo = $("welcome-demo");
    setInterval(() => {
      flip = !flip;
      [...demo.children].forEach((el, i) => {
        const on = (i + (flip ? 1 : 0)) % 5 === 0 || i === 12;
        el.style.background = on ? "linear-gradient(135deg,#171e33,#080b17)" : "linear-gradient(135deg,#f3f7ff,#d7e0ef)";
        el.style.boxShadow = on ? "0 0 12px rgba(141,232,255,.2)" : "";
      });
    }, 820);
  }

  function ensureAudio(){
    if(!game.sound) return null;
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, dur, vol, type, delay){
    const ac = ensureAudio();
    if(!ac) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || .05, t+.012);
    g.gain.exponentialRampToValueAtTime(.0001, t+dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t+dur+.02);
  }

  function sound(kind){
    if(!game || !game.sound) return;
    if(kind === "tap") tone(620,.06,.035,"triangle");
    if(kind === "start"){tone(520,.12,.05,"triangle");tone(900,.13,.04,"sine",.07);}
    if(kind === "good"){tone(760,.09,.055,"triangle");tone(1260,.13,.048,"sine",.055);}
    if(kind === "bad"){tone(230,.11,.055,"sawtooth");tone(160,.13,.04,"square",.06);}
    if(kind === "pulse") tone(1040,.07,.036,"sine");
    if(kind === "win") [523,659,784,1046].forEach((f,i)=>tone(f,.26,.052,"triangle",i*.06));
    if(kind === "fail"){tone(300,.18,.045,"sawtooth");tone(210,.22,.035,"triangle",.12);}
  }

  function sparks(cx, cy, count){
    const colors = [CFG.accent || "#8de8ff", CFG.accent2 || "#f6d36b", "#54e08f", "#a98cff", "#fff"];
    for(let i=0;i<count;i++){
      const el = document.createElement("span");
      el.className = "spark";
      const a = TAU * i/count + Math.random()*.5;
      const d = 34 + Math.random()*58;
      el.style.left = (cx-4)+"px";
      el.style.top = (cy-4)+"px";
      el.style.background = pick(colors);
      el.style.setProperty("--tx", Math.cos(a)*d+"px");
      el.style.setProperty("--ty", Math.sin(a)*d+"px");
      el.style.setProperty("--dur", (.48+Math.random()*.35)+"s");
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 920);
    }
  }

  const MODES = {
    pulse:{
      levels(){
        const names = ["慢拍异频","白场错拍","暗场错拍","双纹节奏","反相脉冲","六阶心跳","微弱延迟","边缘错拍","噪点异频","高密节奏","暗面慢半拍","终端错频"];
        return levels(names, i => {
          const n = i < 3 ? 4 : i < 6 ? 5 : i < 9 ? 6 : 7;
          return {
            n,
            speed:1.05 + i*.08,
            phaseDiff: i < 4 ? Math.PI*.68 : Math.PI*(.48 - Math.min(.2,i*.012)),
            time:28 + i*3,
            note:"所有格子都在跳，找出节奏不合群的那一格。",
            sizeLabel:n + "x" + n
          };
        });
      },
      create(level, li){
        const rand = rng(12000 + li*97 + Date.now());
        const cells = Array.from({length:level.n*level.n}, (_,i)=>cellData(rand,i,li));
        const target = Math.floor(rand()*cells.length);
        return {n:level.n, cells, target};
      },
      draw(g, c, t, w, h){
        const s = g.state, lvl = g.level;
        layout = gridLayout(s.n,s.n,w,h,{gap:7});
        drawBoardFrame(layout);
        for(let i=0;i<s.cells.length;i++){
          const phase = i === s.target ? lvl.phaseDiff : 0;
          const pulse = Math.sin(t * TAU * lvl.speed + phase) * .5 + .5;
          const rect = cellRect(layout,i);
          drawCell(s.cells[i], rect, t, {pulse:pulse*.95, glow:pulse*(i===s.target?.9:.18), flash:pulse>.72});
        }
      },
      click(g,i){
        if(i === g.state.target) hitCell("抓到异频");
        else missCell("这格跟着主节奏");
      },
      actionText(){return ""},
      action(){},
      progress(g){return g.ended ? "1/1" : "0/1";}
    },

    mirror:{
      levels(){
        const names = ["流动镜面","错位倒影","延迟裂缝","斜纹回声","右侧掉帧","五阶镜阵","微光镜缝","符号反射","高密波纹","黑场滞后","双图折返","终端裂隙"];
        return levels(names, i => {
          const n = i < 3 ? 4 : i < 7 ? 5 : i < 10 ? 6 : 7;
          return {
            n,
            time:34 + i*4,
            speed:.8 + i*.06,
            note:"右侧在动态镜像左侧，找出那块不按镜像流动的裂缝。",
            sizeLabel:n + " + " + n
          };
        });
      },
      create(level, li){
        const rand = rng(13200 + li*113 + Date.now());
        const left = Array.from({length:level.n*level.n}, (_,i)=>cellData(rand,i,li));
        const tr = Math.floor(rand()*level.n);
        const tc = Math.floor(rand()*level.n);
        return {n:level.n,left,tr,tc,target:tr*(level.n*2)+level.n+tc,defect:rand()>.5?"lag":"pattern"};
      },
      draw(g,c,t,w,h){
        const s = g.state, n=s.n;
        layout = gridLayout(n*2,n,w,h,{gap:6,splitAt:n});
        drawBoardFrame(layout);
        for(let r=0;r<n;r++){
          for(let c0=0;c0<n;c0++){
            const src = s.left[r*n+c0];
            const wave = Math.sin(t*TAU*g.level.speed + (r+c0)*.45) * .5 + .5;
            drawCell(src, cellRect(layout,r*layout.cols+c0), t, {pulse:wave*.35, glow:wave*.16});
          }
          for(let c0=0;c0<n;c0++){
            const srcIndex = r*n+(n-1-c0);
            const desc = Object.assign({}, s.left[srcIndex]);
            const isDefect = r===s.tr && c0===s.tc;
            let wave = Math.sin(t*TAU*g.level.speed + (r+(n-1-c0))*.45) * .5 + .5;
            if(isDefect){
              if(s.defect === "lag") wave = Math.sin(t*TAU*g.level.speed + (r+(n-1-c0))*.45 + 1.35) * .5 + .5;
              else desc.pattern = (desc.pattern + 1) % 9;
            }
            drawCell(desc, cellRect(layout,r*layout.cols+n+c0), t, {pulse:wave*.35, glow:wave*(isDefect?.52:.14), flash:isDefect && wave>.7});
          }
        }
      },
      click(g,i){
        const n = g.state.n;
        if(i === g.state.target) hitCell("镜缝定位");
        else if(i % (n*2) < n) missCell("裂缝只在右侧");
        else missCell("这块镜像成立");
      },
      actionText(){return ""},
      action(){},
      progress(g){return g.ended ? "1/1" : "0/1";}
    },

    route:{
      levels(){
        const names = ["金点三跳","蓝点干扰","折线穿越","四步潜航","边界返航","五步逆光","交叉欺骗","六步冷轨","延迟残影","长链巡航","暗场双扰","终端航线"];
        return levels(names, i => {
          const n = i < 4 ? 4 : i < 8 ? 5 : 6;
          return {
            n,
            len:3 + Math.floor(i*.62),
            decoys:Math.min(5,1+Math.floor(i*.45)),
            time:42 + i*4,
            note:"只记金色光点路线，蓝色干扰点不要点。",
            sizeLabel:n + "x" + n
          };
        });
      },
      create(level, li){
        const rand = rng(14300 + li*127 + Date.now());
        const total = level.n*level.n;
        const cells = Array.from({length:total}, (_,i)=>cellData(rand,i,li));
        const seq = [];
        let last = -1;
        for(let k=0;k<level.len;k++){
          let v = Math.floor(rand()*total), guard = 0;
          while(v === last && guard++ < 20) v = Math.floor(rand()*total);
          seq.push(v); last = v;
        }
        const decoys = shuffle(Array.from({length:total},(_,i)=>i).filter(i=>!seq.includes(i))).slice(0,level.decoys);
        return {n:level.n,cells,seq,decoys,input:0,phase:"watch",flash:null,replays:0};
      },
      afterStart(g){playRoute(g,false);},
      draw(g,c,t,w,h){
        const s = g.state;
        layout = gridLayout(s.n,s.n,w,h,{gap:7});
        drawBoardFrame(layout);
        for(let i=0;i<s.cells.length;i++){
          const isFlash = s.flash && s.flash.i === i;
          const kind = isFlash ? s.flash.kind : "";
          drawCell(s.cells[i], cellRect(layout,i), t, {
            alpha:s.phase==="watch" && !isFlash ? .42 : 1,
            glow:isFlash ? 1 : (CFG.answerCursorHint !== false && s.phase==="play" && i === s.seq[s.input] ? .12 : 0),
            pulse:isFlash ? 1 : 0,
            label:kind==="goal" ? "●" : kind==="decoy" ? "×" : "",
            labelColor:kind==="goal" ? (CFG.accent2 || "#f6d36b") : "#69b7ff"
          });
        }
      },
      click(g,i){
        const s = g.state;
        if(s.phase !== "play") return;
        if(i === s.seq[s.input]){
          g.hits += 1; g.taps += 1; s.input += 1; sound("good");
          setMessage(s.input >= s.seq.length ? "航线复现" : "继续", 420);
          if(s.input >= s.seq.length) later(()=>finish(true,"完成"),380);
        }else{
          g.misses += 1; g.taps += 1; sound("bad"); setMessage("被干扰点骗到了，重播路线", 720);
          s.input = 0; updateUI(); later(()=>playRoute(g,false),520);
        }
        updateUI();
      },
      actionText(g){return g.state.phase === "watch" ? "播放中" : "重看路线";},
      actionDisabled(g){return g.state.phase === "watch";},
      action(g){g.misses += 1; g.taps += 1; g.state.input = 0; g.state.replays += 1; updateUI(); playRoute(g,true);},
      meter(g){return g.state.seq.map((_,i)=> i < g.state.input ? "good" : i === g.state.input ? "on" : "");},
      progress(g){return g.state.input + "/" + g.state.seq.length;}
    },

    shutter:{
      levels(){
        const names = ["一秒快门","斜光残影","三格负片","条纹遮挡","五阶快照","暗场快门","碎片残像","六格反相","窄缝记忆","高密残影","黑白胶片","终端快照"];
        return levels(names, i => {
          const n = i < 3 ? 4 : i < 8 ? 5 : 6;
          return {
            n,
            count:3 + Math.floor(i*.75),
            preview:2.1 - Math.min(.8,i*.055),
            time:46 + i*4,
            note:"目标只从移动快门里露出，隐藏后复原它。",
            sizeLabel:n + "x" + n
          };
        });
      },
      create(level, li){
        const rand = rng(15400 + li*149 + Date.now());
        const total = level.n*level.n;
        const target = new Array(total).fill(0);
        shuffle(Array.from({length:total},(_,i)=>i)).slice(0,level.count).forEach(i=>target[i]=1);
        return {n:level.n,target,board:new Array(total).fill(0),phase:"preview",started:now(),revealWrong:false};
      },
      afterStart(g){
        later(() => hideShutter(g), Math.round(g.level.preview*1000));
      },
      draw(g,c,t,w,h){
        const s = g.state;
        layout = gridLayout(s.n,s.n,w,h,{gap:7});
        drawBoardFrame(layout);
        const p = clamp((t - s.started) / g.level.preview, 0, 1);
        for(let i=0;i<s.board.length;i++){
          const v = s.phase === "preview" ? s.target[i] : s.board[i];
          const desc = {tone:v,pattern:(i+s.n)%9,phase:0};
          let alpha = 1, pulse = 0, wrong = 0;
          if(s.phase === "preview"){
            const r = Math.floor(i/s.n), col = i%s.n;
            const windowPos = p*(s.n+2)-1;
            const revealed = Math.abs((r+col)*.5 - windowPos) < 1.15 || Math.abs(col - p*(s.n+1)) < .55;
            alpha = revealed ? 1 : .18;
            pulse = revealed && v ? .9 : 0;
          }else if(s.revealWrong && s.board[i] !== s.target[i]){
            wrong = 1;
          }
          drawCell(desc, cellRect(layout,i), t, {alpha,pulse,glow:pulse*.65,wrong});
        }
        if(s.phase === "preview"){
          ctx.save();
          ctx.globalAlpha = .5;
          ctx.fillStyle = "rgba(0,0,0,.32)";
          const sweepX = layout.x + (layout.w + 80) * p - 40;
          ctx.fillRect(sweepX - 18, layout.y - 10, 36, layout.h + 20);
          ctx.restore();
        }
      },
      click(g,i){
        const s = g.state;
        if(s.phase === "preview") return;
        s.board[i] ^= 1; g.taps += 1; sound("tap"); updateUI();
      },
      actionText(g){return g.state.phase === "preview" ? "跳过快门" : "确认图像";},
      action(g){
        const s = g.state;
        if(s.phase === "preview"){ hideShutter(g); return; }
        let ok = true;
        for(let i=0;i<s.target.length;i++) if(s.board[i] !== s.target[i]) ok = false;
        if(ok){
          g.hits += 1; g.taps += 1; updateUI(); sound("good"); setMessage("残影复原", 520); later(()=>finish(true,"完成"),380);
        }else{
          g.misses += 1; g.taps += 1; s.revealWrong = true; sound("bad"); setMessage("残影不吻合", 720); updateUI();
          later(()=>{if(s){s.revealWrong=false;}},720);
        }
      },
      meter(g){return g.state.target.map((_,i)=> g.state.board[i] ? "on" : "");},
      progress(g){
        let hit = 0, s = g.state;
        for(let i=0;i<s.target.length;i++) if(s.board[i] === s.target[i]) hit++;
        return hit + "/" + s.target.length;
      }
    },

    scanner:{
      levels(){
        const names = ["手电暗纹","噪场寻标","低亮圆环","边缘暗号","五阶扫描","微弱十字","六阶迷彩","假纹扰动","窄光寻踪","七阶噪海","深黑暗纹","终端潜标"];
        return levels(names, i => {
          const n = i < 3 ? 5 : i < 7 ? 6 : i < 10 ? 7 : 8;
          return {
            n,
            radius:.95 - Math.min(.32,i*.025),
            time:34 + i*4,
            note:"拖动扫描光，只有目标暗纹会在光圈里显形。",
            sizeLabel:n + "x" + n
          };
        });
      },
      create(level, li){
        const rand = rng(16500 + li*163 + Date.now());
        const total = level.n*level.n;
        const cells = Array.from({length:total},(_,i)=>cellData(rand,i,li));
        return {n:level.n,cells,target:Math.floor(rand()*total),sweep:0};
      },
      draw(g,c,t,w,h){
        const s = g.state;
        layout = gridLayout(s.n,s.n,w,h,{gap:6});
        drawBoardFrame(layout);
        const autoX = layout.x + (Math.sin(t*.75)+1)/2*layout.w;
        const autoY = layout.y + (Math.cos(t*.58)+1)/2*layout.h;
        const px = g.pointer.active ? g.pointer.x : autoX;
        const py = g.pointer.active ? g.pointer.y : autoY;
        const rad = layout.cell * g.level.radius * 1.75;
        for(let i=0;i<s.cells.length;i++){
          const r = cellRect(layout,i);
          const cx = r.x+r.w/2, cy = r.y+r.h/2;
          const d = Math.hypot(cx-px, cy-py);
          const inLens = d < rad;
          const isTarget = i === s.target;
          drawCell(s.cells[i], r, t, {
            alpha:inLens ? 1 : .48,
            glow:inLens ? .18 : 0,
            signal:isTarget && inLens,
            signalAlpha:clamp(1-d/rad,.18,.78)
          });
          if(inLens && !isTarget && (i + Math.floor(t*2)) % 11 === 0){
            ctx.save();
            ctx.globalAlpha = .12;
            drawSignal(r.x,r.y,r.w,.4);
            ctx.restore();
          }
        }
        ctx.save();
        const lg = ctx.createRadialGradient(px,py,rad*.18,px,py,rad);
        lg.addColorStop(0,"rgba(141,232,255,.22)");
        lg.addColorStop(.72,"rgba(141,232,255,.06)");
        lg.addColorStop(1,"rgba(141,232,255,0)");
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(px,py,rad,0,TAU); ctx.fill();
        ctx.strokeStyle = "rgba(141,232,255,.42)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px,py,rad*.72,0,TAU); ctx.stroke();
        ctx.restore();
      },
      click(g,i){
        if(i === g.state.target) hitCell("暗纹显形");
        else missCell("这是伪纹");
      },
      actionText(){return ""},
      action(){},
      progress(g){return g.ended ? "1/1" : "0/1";}
    }
  };

  function playRoute(g, manual){
    const s = g.state;
    g.timeouts.forEach(id => clearTimeout(id));
    g.timeouts = [];
    s.phase = "watch";
    s.flash = null;
    setMessage(manual ? "重看路线会扣专注" : "看金色点，不看蓝色干扰", 900);
    updateUI();
    const events = [];
    s.seq.forEach((idx, step) => {
      events.push({i:idx,kind:"goal"});
      if(s.decoys[step % s.decoys.length] != null && step < s.seq.length-1) events.push({i:s.decoys[step % s.decoys.length],kind:"decoy"});
    });
    let delay = 260;
    events.forEach((ev) => {
      later(() => { if(!g.ended){s.flash = ev; sound(ev.kind==="goal"?"pulse":"tap"); updateUI();} }, delay);
      later(() => { if(!g.ended && s.flash === ev){s.flash = null;} }, delay + (ev.kind==="goal" ? 320 : 210));
      delay += ev.kind === "goal" ? 520 : 280;
    });
    later(() => {
      if(g.ended) return;
      s.phase = "play";
      s.flash = null;
      setMessage("轮到你复现", 700);
      updateUI();
    }, delay + 160);
  }

  function hideShutter(g){
    const s = g.state;
    if(!s || s.phase !== "preview") return;
    s.phase = "play";
    setMessage("按残影复原图像", 700);
    sound("pulse");
    updateUI();
  }

  window.addEventListener("DOMContentLoaded", () => {
    mount();
    init();
  });
})();
