(function(){
  "use strict";

  const CONFIG = Object.assign({
    type:"odd",
    title:"观察力游戏",
    displayTitle:"观 察 力 游 戏",
    subtitle:"黑白观察训练",
    welcomeSub:"观察棋盘变化，完成当前关卡。"
  }, window.OBS_GAME || {});

  const $ = id => document.getElementById(id);
  const clamp = (v,min,max) => Math.max(min, Math.min(max, v));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = arr => {
    for(let i=arr.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]]=[arr[j],arr[i]];
    }
    return arr;
  };
  const sameCell = (a,b) => a && b && a.tone===b.tone && a.pattern===b.pattern && a.mark===b.mark;
  const cloneCell = c => Object.assign({}, c);
  const cellIndex = (r,c,cols) => r * cols + c;

  let app;
  let bgCanvas, bgCtx, floaters = [];
  let audioCtx = null;

  function rng(seed){
    let t = seed >>> 0;
    return function(){
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ t >>> 15, 1 | t);
      r ^= r + Math.imul(r ^ r >>> 7, 61 | r);
      return ((r ^ r >>> 14) >>> 0) / 4294967296;
    };
  }

  function mountShell(){
    document.documentElement.lang = "zh-CN";
    document.body.innerHTML = `
      <div id="welcome-mask">
        <div id="welcome-card">
          <div id="welcome-logo">G-Game</div>
          <div id="welcome-title">${CONFIG.title}</div>
          <div id="welcome-sub">${CONFIG.welcomeSub}</div>
          <div id="welcome-demo" aria-hidden="true"></div>
          <button id="welcome-start">开始游戏</button>
        </div>
      </div>
      <canvas id="bg-canvas"></canvas>
      <main id="app">
        <div id="title-wrap">
          <h1>${CONFIG.displayTitle || CONFIG.title}</h1>
          <div id="subtitle">${CONFIG.subtitle}</div>
        </div>
        <section id="level-card">
          <div id="level-top">
            <span id="level-kicker">第 1 关</span>
            <span id="level-size">5x5</span>
          </div>
          <div id="level-name"></div>
          <div id="level-note"></div>
          <div id="level-rail"></div>
        </section>
        <div id="hud">
          <span>点击 <b id="moves">0</b></span>
          <span>失误 <b id="mistakes">0</b></span>
          <span>时间 <b id="timer">0</b>s</span>
          <span>进度 <b id="progress">0/0</b></span>
        </div>
        <section id="play">
          <div class="panel">
            <div class="panel-label" id="board-label">观察区</div>
            <div id="board"></div>
          </div>
          <div class="panel">
            <div class="panel-label" id="target-label">目标</div>
            <div id="target"></div>
          </div>
        </section>
        <div id="buttons">
          <button class="btn" id="btn-new">重开本关</button>
          <button class="btn" id="btn-reset">重置</button>
          <button class="btn" id="btn-action">确认</button>
          <button class="btn" id="btn-sound">音效开</button>
        </div>
        <div id="msg"></div>
      </main>
      <div id="settle-mask">
        <div id="settle-card">
          <div id="settle-title">完成</div>
          <div id="settle-sub"></div>
          <div id="settle-rank">S</div>
          <div id="settle-stars">★★★</div>
          <div id="settle-rows"></div>
          <div class="settle-total"><span>总分</span><span id="settle-score">0</span></div>
          <div id="settle-best"></div>
          <div id="settle-btns">
            <button class="btn" id="sb-again">再玩</button>
            <button class="btn" id="sb-next">下一关</button>
            <button class="btn" id="sb-close">关闭</button>
          </div>
        </div>
      </div>
    `;

    const demo = $("welcome-demo");
    for(let i=0;i<25;i++){
      const s = document.createElement("span");
      demo.appendChild(s);
    }
  }

  function initApp(){
    const mode = MODES[CONFIG.type] || MODES.odd;
    app = {
      mode,
      levels: mode.levels(),
      levelIndex: 0,
      level: null,
      state: null,
      moves: 0,
      mistakes: 0,
      timeLeft: 0,
      timerID: null,
      ended: false,
      started: false,
      soundOn: true,
      lastBad: -1,
      lastGood: -1,
      msgTimer: null,
      timeouts: []
    };
    document.documentElement.style.setProperty("--level-total", app.levels.length);
    if(CONFIG.accent) document.documentElement.style.setProperty("--accent", CONFIG.accent);
    if(CONFIG.accent2) document.documentElement.style.setProperty("--accent-2", CONFIG.accent2);
    bindUI();
    setupBackground();
    drawWelcomeDemo();
    renderLevelRail();
    loadLevel(0, false);
  }

  function bindUI(){
    $("welcome-start").addEventListener("click", startFromWelcome);
    $("btn-new").addEventListener("click", () => newRound(true));
    $("btn-reset").addEventListener("click", () => {
      if(app.ended) return;
      app.mode.reset(app);
      render();
    });
    $("btn-action").addEventListener("click", () => {
      if(app.ended) return;
      app.mode.action(app);
    });
    $("btn-sound").addEventListener("click", () => {
      app.soundOn = !app.soundOn;
      $("btn-sound").textContent = app.soundOn ? "音效开" : "音效关";
      if(app.soundOn) sfx("tap");
    });
    $("sb-again").addEventListener("click", () => {
      $("settle-mask").classList.remove("show");
      newRound(true);
    });
    $("sb-next").addEventListener("click", () => {
      $("settle-mask").classList.remove("show");
      loadLevel(app.levelIndex < app.levels.length - 1 ? app.levelIndex + 1 : 0, true);
    });
    $("sb-close").addEventListener("click", () => $("settle-mask").classList.remove("show"));
    window.addEventListener("resize", () => render());
    document.addEventListener("selectstart", e => e.preventDefault(), {passive:false});
    document.addEventListener("dragstart", e => e.preventDefault(), {passive:false});
    document.addEventListener("contextmenu", e => e.preventDefault(), {passive:false});
  }

  function startFromWelcome(){
    if(app.started) return;
    app.started = true;
    $("welcome-mask").classList.add("hide");
    setTimeout(() => {
      const m = $("welcome-mask");
      if(m) m.style.display = "none";
    }, 390);
    sfx("start");
    newRound(false);
  }

  function loadLevel(index, autostart){
    app.levelIndex = clamp(index, 0, app.levels.length - 1);
    app.level = app.levels[app.levelIndex];
    $("level-name").textContent = app.level.name;
    $("level-note").textContent = app.level.note;
    $("level-kicker").textContent = "第 " + (app.levelIndex + 1) + " / " + app.levels.length + " 关";
    $("level-size").textContent = app.level.sizeLabel || (app.level.n + "x" + app.level.n);
    renderLevelRail();
    if(autostart || app.started) newRound(false);
    else renderShellOnly();
  }

  function newRound(playStartSound){
    clearTimerAndTimeouts();
    app.moves = 0;
    app.mistakes = 0;
    app.lastBad = -1;
    app.lastGood = -1;
    app.ended = false;
    app.timeLeft = app.level.time;
    app.state = app.mode.create(app.level, app.levelIndex);
    $("settle-mask").classList.remove("show");
    setMessage(app.level.note, 900);
    render();
    startTimer();
    if(playStartSound) sfx("start");
    if(app.mode.afterStart) app.mode.afterStart(app);
  }

  function clearTimerAndTimeouts(){
    if(app.timerID) clearInterval(app.timerID);
    app.timerID = null;
    app.timeouts.forEach(id => clearTimeout(id));
    app.timeouts = [];
  }

  function later(fn, ms){
    const id = setTimeout(() => {
      app.timeouts = app.timeouts.filter(x => x !== id);
      fn();
    }, ms);
    app.timeouts.push(id);
    return id;
  }

  function startTimer(){
    $("timer").textContent = app.timeLeft;
    $("timer").classList.toggle("low", app.timeLeft <= 10);
    app.timerID = setInterval(() => {
      app.timeLeft -= 1;
      $("timer").textContent = app.timeLeft;
      $("timer").classList.toggle("low", app.timeLeft <= 10);
      if(app.timeLeft <= 0) finish(false, "时间到");
    }, 1000);
  }

  function renderShellOnly(){
    $("moves").textContent = "0";
    $("mistakes").textContent = "0";
    $("timer").textContent = app.level.time;
    $("progress").textContent = "0/1";
    $("board-label").textContent = app.mode.boardLabel || "观察区";
    $("target-label").textContent = app.mode.targetLabel || "目标";
    $("board").innerHTML = "";
    $("target").innerHTML = "";
    $("msg").textContent = "";
    $("btn-action").style.display = "none";
    $("btn-reset").disabled = true;
  }

  function render(){
    if(!app.state) return renderShellOnly();
    const dims = app.mode.dims(app.state);
    const cellSize = computeCellSize(dims.cols, dims.rows);
    const targetCols = app.mode.targetCols ? app.mode.targetCols(app) : Math.max(1, Math.min(dims.cols, 8));
    document.documentElement.style.setProperty("--cols", dims.cols);
    document.documentElement.style.setProperty("--rows", dims.rows);
    document.documentElement.style.setProperty("--cell", cellSize + "px");
    document.documentElement.style.setProperty("--target-cols", targetCols);
    document.documentElement.style.setProperty("--target-cell", Math.max(13, Math.round(cellSize * .34)) + "px");

    $("moves").textContent = app.moves;
    $("mistakes").textContent = app.mistakes;
    $("progress").textContent = app.mode.progress(app);
    $("board-label").textContent = app.mode.boardLabelText ? app.mode.boardLabelText(app) : (app.mode.boardLabel || "观察区");
    $("target-label").textContent = app.mode.targetLabelText ? app.mode.targetLabelText(app) : (app.mode.targetLabel || "目标");
    $("btn-reset").disabled = false;

    const action = app.mode.actionText(app);
    $("btn-action").style.display = action ? "inline-block" : "none";
    $("btn-action").textContent = action || "";
    $("btn-action").disabled = !!(app.mode.actionDisabled && app.mode.actionDisabled(app));

    renderBoard();
    renderTarget();
  }

  function computeCellSize(cols, rows){
    const vw = Math.min(window.innerWidth || 520, 520);
    const vh = Math.max(560, window.innerHeight || 760);
    const gap = 7;
    const fixed = vh < 700 ? 258 : 292;
    const fitW = Math.floor((vw - 42 - 22 - gap * (cols - 1)) / cols);
    const fitH = Math.floor((vh - fixed - gap * (rows - 1) - 22) / Math.max(1, rows + .25));
    const max = cols >= 12 ? 34 : cols >= 10 ? 38 : cols >= 8 ? 44 : 58;
    return clamp(Math.min(fitW, fitH, max), 24, max);
  }

  function renderBoard(){
    const board = $("board");
    const dims = app.mode.dims(app.state);
    board.className = app.mode.boardClass ? app.mode.boardClass(app.state) : "";
    board.innerHTML = "";
    const cells = app.mode.cells(app);
    cells.forEach((desc, i) => {
      const el = document.createElement("button");
      el.type = "button";
      const classes = ["cell", desc.tone ? "on" : "off", "p" + (desc.pattern || 0)];
      if(desc.className) classes.push(desc.className);
      if(desc.locked) classes.push("locked");
      if(i === app.lastBad) classes.push("bad");
      if(i === app.lastGood) classes.push("good");
      if(desc.masked) classes.push("masked");
      el.className = classes.join(" ");
      el.dataset.i = i;
      el.setAttribute("aria-label", "格子 " + (i + 1));
      if(desc.mark){
        const mark = document.createElement("span");
        mark.className = "mark";
        mark.textContent = desc.mark;
        el.appendChild(mark);
      }
      if(desc.grain){
        const grain = document.createElement("span");
        grain.className = "grain";
        el.appendChild(grain);
      }
      if(desc.signal){
        const sig = document.createElement("span");
        sig.className = "sig";
        if(desc.signalOpacity != null) sig.style.opacity = desc.signalOpacity;
        el.appendChild(sig);
      }
      if(desc.style){
        Object.keys(desc.style).forEach(k => el.style[k] = desc.style[k]);
      }
      el.addEventListener("click", () => onCellClick(i, desc));
      board.appendChild(el);
    });
    if(cells.length !== dims.cols * dims.rows){
      board.style.gridTemplateRows = "repeat(" + Math.ceil(cells.length / dims.cols) + ", var(--cell))";
    }else{
      board.style.gridTemplateRows = "";
    }
  }

  function renderTarget(){
    const target = $("target");
    target.innerHTML = "";
    target.className = "";
    const items = app.mode.target(app);
    if(!items || !items.length){
      const el = document.createElement("div");
      el.className = "target-empty";
      el.textContent = app.mode.targetText ? app.mode.targetText(app) : "观察当前棋盘";
      target.appendChild(el);
      return;
    }
    items.forEach(desc => {
      if(desc.kind === "seq"){
        const dot = document.createElement("span");
        dot.className = "seq-dot " + (desc.state || "");
        target.appendChild(dot);
        return;
      }
      const el = document.createElement("span");
      const classes = ["tcell", desc.tone ? "on" : "off", "p" + (desc.pattern || 0)];
      if(desc.masked) classes.push("masked");
      el.className = classes.join(" ");
      if(desc.mark){
        const mark = document.createElement("span");
        mark.className = "mark";
        mark.textContent = desc.mark;
        el.appendChild(mark);
      }
      if(desc.signal){
        const sig = document.createElement("span");
        sig.className = "sig";
        sig.style.opacity = ".62";
        el.appendChild(sig);
      }
      target.appendChild(el);
    });
  }

  function onCellClick(i, desc){
    if(app.ended || !app.state || desc.locked) return;
    ensureAudio();
    app.mode.onCell(app, i, desc);
    render();
  }

  function successCell(i, message){
    app.lastGood = i;
    app.moves += 1;
    sfx("good");
    setMessage(message || "命中", 500);
    render();
    later(() => finish(true, "完成"), 420);
  }

  function badCell(i, message){
    app.lastBad = i;
    app.mistakes += 1;
    app.moves += 1;
    sfx("bad");
    setMessage(message || "再观察一次", 650);
    later(() => {
      if(app.lastBad === i){
        app.lastBad = -1;
        render();
      }
    }, 260);
  }

  function finish(cleared, title){
    if(app.ended) return;
    app.ended = true;
    clearTimerAndTimeouts();
    if(cleared) sfx("win");
    else sfx("fail");
    showSettle(cleared, title || (cleared ? "完成" : "未完成"));
  }

  function showSettle(cleared, title){
    const level = app.level;
    const accuracy = Math.max(0, 1 - app.mistakes / Math.max(1, app.moves));
    const clearScore = cleared ? level.base : 0;
    const timeScore = cleared ? Math.round(app.timeLeft * level.rate) : 0;
    const focusScore = cleared ? Math.round(level.base * accuracy) : 0;
    const score = clearScore + timeScore + focusScore;
    const rank = !cleared ? "C" : accuracy >= .98 && app.timeLeft >= level.time * .35 ? "S" : accuracy >= .86 ? "A" : accuracy >= .68 ? "B" : "C";
    const stars = rank === "S" ? 3 : rank === "A" ? 3 : rank === "B" ? 2 : 1;
    const color = rank === "S" ? "#f6d36b" : rank === "A" ? "#8de8ff" : rank === "B" ? "#a98cff" : "#aab4c6";
    $("settle-title").textContent = cleared ? "关卡完成" : title;
    $("settle-sub").textContent = "第 " + (app.levelIndex + 1) + " / " + app.levels.length + " 关 · " + level.name;
    $("settle-rank").textContent = rank;
    $("settle-rank").style.color = color;
    $("settle-stars").textContent = "★★★".slice(0, stars) + "☆☆☆".slice(0, 3 - stars);
    $("settle-stars").style.color = color;
    $("settle-rows").innerHTML = [
      ["通关奖励", clearScore],
      ["专注加成", focusScore],
      ["时间奖励", timeScore],
      ["点击 / 失误", app.moves + " / " + app.mistakes]
    ].map(row => `<div class="settle-row"><span>${row[0]}</span><span>${typeof row[1] === "number" ? "+" + row[1] : row[1]}</span></div>`).join("");
    $("settle-score").textContent = score;
    const key = "observe_best_" + CONFIG.type + "_" + app.levelIndex;
    const prev = safeGet(key);
    if(cleared && score > prev) safeSet(key, score);
    $("settle-best").textContent = cleared ? (score > prev ? "新纪录，之前最佳 " + prev : "本关最佳 " + Math.max(prev, score)) : "本关未完成";
    $("sb-next").textContent = app.levelIndex < app.levels.length - 1 ? "下一关" : "从头开始";
    $("settle-mask").classList.add("show");
    burstSparks(window.innerWidth / 2, window.innerHeight * .42, cleared ? 14 : 5);
  }

  function safeGet(key){
    try{return +(localStorage.getItem(key) || 0)}catch(e){return 0}
  }
  function safeSet(key, value){
    try{localStorage.setItem(key, String(value))}catch(e){}
  }

  function setMessage(text, ms){
    clearTimeout(app.msgTimer);
    $("msg").textContent = text || "";
    if(ms){
      app.msgTimer = setTimeout(() => {
        if($("msg").textContent === text) $("msg").textContent = "";
      }, ms);
    }
  }

  function renderLevelRail(){
    const rail = $("level-rail");
    if(!rail || !app) return;
    rail.innerHTML = "";
    for(let i=0;i<app.levels.length;i++){
      const dot = document.createElement("span");
      dot.className = "rail-dot " + (i < app.levelIndex ? "done" : i === app.levelIndex ? "current" : "");
      rail.appendChild(dot);
    }
  }

  function setupBackground(){
    bgCanvas = $("bg-canvas");
    bgCtx = bgCanvas.getContext("2d");
    initFloaters();
    requestAnimationFrame(drawBackground);
    window.addEventListener("resize", initFloaters);
  }

  function initFloaters(){
    if(!bgCanvas) return;
    bgCanvas.width = window.innerWidth || 800;
    bgCanvas.height = window.innerHeight || 800;
    const glyphs = CONFIG.glyphs || ["□","■","◇","◆","✦","✧","+"];
    floaters = Array.from({length:34}, () => ({
      x:Math.random() * bgCanvas.width,
      y:Math.random() * bgCanvas.height,
      size:8 + Math.random() * 15,
      vx:(Math.random() - .5) * .26,
      vy:-.12 - Math.random() * .28,
      a:.08 + Math.random() * .22,
      r:Math.random() * Math.PI * 2,
      rv:(Math.random() - .5) * .018,
      g:pick(glyphs)
    }));
  }

  function drawBackground(){
    const W = bgCanvas.width, H = bgCanvas.height;
    bgCtx.clearRect(0,0,W,H);
    for(const f of floaters){
      f.x += f.vx;
      f.y += f.vy;
      f.r += f.rv;
      if(f.y < -24){ f.y = H + 24; f.x = Math.random() * W; }
      if(f.x < -24) f.x = W + 24;
      if(f.x > W + 24) f.x = -24;
      bgCtx.save();
      bgCtx.globalAlpha = f.a;
      bgCtx.translate(f.x, f.y);
      bgCtx.rotate(f.r);
      bgCtx.font = "900 " + f.size + "px system-ui";
      bgCtx.textAlign = "center";
      bgCtx.textBaseline = "middle";
      bgCtx.fillStyle = f.g === "■" || f.g === "◆" ? "#11182a" : "#dfeaff";
      bgCtx.fillText(f.g, 0, 0);
      bgCtx.restore();
    }
    requestAnimationFrame(drawBackground);
  }

  function drawWelcomeDemo(){
    const demo = $("welcome-demo");
    if(!demo) return;
    let flip = false;
    setInterval(() => {
      flip = !flip;
      [...demo.children].forEach((el, i) => {
        const on = (i + (flip ? 1 : 0)) % 4 === 0 || i === 12;
        el.style.background = on ? "linear-gradient(135deg,#171e33,#080b17)" : "linear-gradient(135deg,#f3f7ff,#d7e0ef)";
        el.style.boxShadow = on ? "0 0 12px rgba(141,232,255,.18)" : "";
      });
    }, 850);
  }

  function ensureAudio(){
    if(!app.soundOn) return null;
    if(!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
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
    g.gain.exponentialRampToValueAtTime(vol || .07, t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t);
    o.stop(t + dur + .02);
  }

  function sfx(kind){
    if(!app || !app.soundOn) return;
    if(kind === "tap") tone(620,.07,.035,"triangle");
    if(kind === "start"){ tone(520,.12,.05,"triangle"); tone(860,.14,.045,"sine",.08); }
    if(kind === "good"){ tone(760,.09,.06,"triangle"); tone(1280,.12,.052,"sine",.06); }
    if(kind === "bad"){ tone(240,.1,.055,"sawtooth"); tone(170,.12,.04,"square",.06); }
    if(kind === "win"){ [523,659,784,1046].forEach((f,i)=>tone(f,.28,.055,"triangle",i*.06)); }
    if(kind === "fail"){ tone(300,.18,.045,"sawtooth"); tone(220,.22,.035,"triangle",.12); }
    if(kind === "pulse") tone(980,.08,.038,"sine");
  }

  function burstSparks(cx, cy, count){
    const colors = ["#8de8ff","#f6d36b","#54e08f","#a98cff","#ffffff"];
    for(let i=0;i<count;i++){
      const el = document.createElement("span");
      el.className = "spark";
      const a = Math.PI * 2 * (i / count) + Math.random() * .42;
      const d = 32 + Math.random() * 58;
      el.style.left = (cx - 4) + "px";
      el.style.top = (cy - 4) + "px";
      el.style.background = pick(colors);
      el.style.setProperty("--tx", Math.cos(a) * d + "px");
      el.style.setProperty("--ty", Math.sin(a) * d + "px");
      el.style.setProperty("--dur", (.48 + Math.random() * .35) + "s");
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 900);
    }
  }

  function baseLevels(prefix, names, build){
    return names.map((name, i) => Object.assign({
      name,
      note:"",
      n:4,
      time:35,
      base:800 + i * 80,
      rate:8 + Math.floor(i / 4)
    }, build(i)));
  }

  const marks = ["","•","×","+","◇","○"];
  function differentPattern(pattern, tight){
    if(tight){
      const pairs = [[1,2],[4,5],[6,3],[7,0],[8,1]];
      const pair = pairs.find(p => p[0] === pattern || p[1] === pattern);
      if(pair) return pair[0] === pattern ? pair[1] : pair[0];
    }
    let p = pattern;
    while(p === pattern) p = Math.floor(Math.random() * 9);
    return p;
  }
  function differentCell(base, subtle){
    const c = cloneCell(base);
    if(subtle){
      c.pattern = differentPattern(base.pattern, true);
    }else if(Math.random() < .45){
      c.tone = 1 - c.tone;
    }else if(Math.random() < .8){
      c.pattern = differentPattern(base.pattern, false);
    }else{
      c.mark = pick(marks.filter(m => m !== base.mark));
    }
    if(sameCell(c, base)) c.pattern = differentPattern(base.pattern, false);
    return c;
  }

  const MODES = {
    odd:{
      boardLabel:"观察区",
      targetLabel:"异格样式",
      levels(){
        const names = ["白场黑点","边角异纹","横竖误差","斜纹换向","微光圆心","暗场反色","九宫密集","双线偏移","冷白噪点","黑格窄纹","边界搜索","高密阵列"];
        return baseLevels("odd", names, i => {
          const n = i < 2 ? 4 : i < 5 ? 5 : i < 8 ? 6 : i < 10 ? 7 : 8;
          return {
            n,
            time:26 + i * 3,
            subtle:i >= 3,
            note:i < 3 ? "点出唯一不同的格子。" : "差异会越来越细，先扫轮廓再看纹理。",
            sizeLabel:n + "x" + n
          };
        });
      },
      create(level, levelIndex){
        const rand = rng(3100 + levelIndex * 97 + Date.now());
        const base = {tone: rand() > .5 ? 1 : 0, pattern: Math.floor(rand() * 9), mark: levelIndex > 6 && rand() > .6 ? pick(marks) : ""};
        const target = Math.floor(rand() * level.n * level.n);
        const odd = differentCell(base, level.subtle);
        return {n:level.n, target, base, odd};
      },
      dims(state){return {cols:state.n, rows:state.n}},
      cells(app){
        const total = app.state.n * app.state.n;
        return Array.from({length:total}, (_, i) => i === app.state.target ? app.state.odd : app.state.base);
      },
      target(app){return [app.state.odd]},
      progress(app){return app.ended ? "1/1" : "0/1"},
      actionText(){return ""},
      action(){},
      reset(app){newRound(true)},
      onCell(app, i){
        if(i === app.state.target) successCell(i, "找到异格");
        else badCell(i, "这一格和主体一致");
      }
    },

    mirror:{
      boardLabel:"左右镜像",
      targetLabel:"判定",
      levels(){
        const names = ["双列对照","白边裂纹","黑格倒影","斜线偏差","镜面微错","六阶双图","角落反射","符号漂移","窄纹错位","高密镜阵","暗面缺口","最终镜缝"];
        return baseLevels("mirror", names, i => {
          const n = i < 3 ? 4 : i < 6 ? 5 : i < 9 ? 6 : 7;
          return {
            n,
            time:34 + i * 4,
            subtle:i >= 4,
            note:"右侧应该是左侧的镜像，点出右侧错误格。",
            sizeLabel:n + " + " + n
          };
        });
      },
      create(level, levelIndex){
        const rand = rng(4400 + levelIndex * 131 + Date.now());
        const left = [];
        for(let i=0;i<level.n*level.n;i++){
          left.push({
            tone:rand() > .5 ? 1 : 0,
            pattern:Math.floor(rand() * (levelIndex > 6 ? 9 : 6)),
            mark:levelIndex > 7 && rand() > .72 ? pick(marks) : ""
          });
        }
        const tr = Math.floor(rand() * level.n);
        const tc = Math.floor(rand() * level.n);
        const mirrorCell = cloneCell(left[cellIndex(tr, level.n - 1 - tc, level.n)]);
        const wrong = differentCell(mirrorCell, level.subtle);
        return {n:level.n, left, tr, tc, wrong, correct:cellIndex(tr, level.n + tc, level.n * 2)};
      },
      dims(state){return {cols:state.n * 2, rows:state.n}},
      boardClass(){return "dual"},
      cells(app){
        const s = app.state, cells = [];
        for(let r=0;r<s.n;r++){
          for(let c=0;c<s.n;c++) cells.push(cloneCell(s.left[cellIndex(r,c,s.n)]));
          for(let c=0;c<s.n;c++){
            let desc = cloneCell(s.left[cellIndex(r, s.n - 1 - c, s.n)]);
            if(r === s.tr && c === s.tc) desc = cloneCell(s.wrong);
            if(c === 0) desc.className = "mirror-gap";
            cells.push(desc);
          }
        }
        return cells;
      },
      target(){return []},
      targetText(){return "右侧只有一格不符合镜像"},
      targetCols(){return 1},
      progress(app){return app.ended ? "1/1" : "0/1"},
      actionText(){return ""},
      action(){},
      reset(app){newRound(true)},
      onCell(app, i){
        if(i === app.state.correct) successCell(i, "镜面裂缝已定位");
        else badCell(i, i % (app.state.n * 2) < app.state.n ? "错误在右侧" : "这一格镜像正确");
      }
    },

    path:{
      boardLabel:"轨迹区",
      targetLabel:"序列进度",
      levels(){
        const names = ["三点巡航","折线回声","角点闪烁","短链追踪","五步冷光","交叉回路","六步漂移","边界折返","回环轨迹","错位连闪","暗场巡线","星核长链"];
        return baseLevels("path", names, i => {
          const n = i < 4 ? 4 : i < 8 ? 5 : 6;
          return {
            n,
            len:3 + Math.floor(i * .65),
            time:38 + i * 5,
            note:"先看光点顺序，再按同样顺序点击。",
            sizeLabel:n + "x" + n
          };
        });
      },
      create(level, levelIndex){
        const rand = rng(5600 + levelIndex * 167 + Date.now());
        const total = level.n * level.n;
        const seq = [];
        let last = -1;
        for(let i=0;i<level.len;i++){
          let v = Math.floor(rand() * total);
          let guard = 0;
          while(v === last && guard++ < 8) v = Math.floor(rand() * total);
          seq.push(v);
          last = v;
        }
        return {n:level.n, seq, input:0, lit:-1, phase:"watch", replayPenalty:0};
      },
      dims(state){return {cols:state.n, rows:state.n}},
      cells(app){
        const s = app.state;
        return Array.from({length:s.n*s.n}, (_, i) => ({
          tone:(i + Math.floor(i / s.n)) % 2,
          pattern:(i * 3 + s.n) % 9,
          locked:s.phase === "watch",
          className:i === s.lit ? "watch" : (s.phase === "watch" ? "dim" : "")
        }));
      },
      target(app){
        const s = app.state;
        return s.seq.map((_, i) => ({kind:"seq", state:i < s.input ? "done" : i === s.input ? "current" : ""}));
      },
      targetCols(app){return app.state.seq.length},
      progress(app){return app.state.input + "/" + app.state.seq.length},
      boardLabelText(app){return app.state.phase === "watch" ? "观察轨迹" : "复现轨迹"},
      actionText(app){return app.state.phase === "watch" ? "播放中" : "重看轨迹"},
      actionDisabled(app){return app.state.phase === "watch"},
      action(app){
        app.mistakes += 1;
        app.state.replayPenalty += 1;
        app.state.input = 0;
        runPathReplay(app, true);
      },
      reset(app){
        app.state.input = 0;
        runPathReplay(app, false);
      },
      afterStart(app){runPathReplay(app, false)},
      onCell(app, i){
        const s = app.state;
        if(s.phase !== "play") return;
        app.moves += 1;
        if(i === s.seq[s.input]){
          app.lastGood = i;
          s.input += 1;
          sfx("good");
          if(s.input >= s.seq.length){
            setMessage("轨迹复现完成", 500);
            render();
            later(() => finish(true, "完成"), 360);
          }else{
            setMessage("继续", 280);
          }
        }else{
          app.lastBad = i;
          app.mistakes += 1;
          sfx("bad");
          setMessage("顺序断了，重新观察", 650);
          s.input = 0;
          render();
          later(() => runPathReplay(app, false), 560);
        }
      }
    },

    flash:{
      boardLabel:"复原区",
      targetLabel:"瞬闪目标",
      levels(){
        const names = ["三格残影","四格短照","黑白斑图","边界留像","五阶快照","斜线记忆","六格冷闪","暗场残片","密集一秒","七阶瞬照","反色残像","终端记忆"];
        return baseLevels("flash", names, i => {
          const n = i < 3 ? 4 : i < 7 ? 5 : 6;
          return {
            n,
            count:3 + Math.floor(i * .8),
            preview:Math.max(900, 1900 - i * 80),
            time:44 + i * 4,
            note:"目标只短暂出现，记住后在上方复原。",
            sizeLabel:n + "x" + n
          };
        });
      },
      create(level, levelIndex){
        const rand = rng(6800 + levelIndex * 191 + Date.now());
        const total = level.n * level.n;
        const target = new Array(total).fill(0);
        shuffle(Array.from({length:total}, (_,i)=>i)).slice(0, level.count).forEach(i => target[i] = 1);
        return {n:level.n, target, board:new Array(total).fill(0), phase:"preview", visible:true, revealWrong:false};
      },
      dims(state){return {cols:state.n, rows:state.n}},
      cells(app){
        const s = app.state;
        return s.board.map((v, i) => {
          let className = "";
          if(s.revealWrong && v !== s.target[i]) className = s.target[i] ? "missed" : "bad";
          return {tone:v, pattern:(i + s.n) % 9, locked:s.phase === "preview", className};
        });
      },
      target(app){
        const s = app.state;
        return s.target.map((v, i) => ({tone:v, pattern:(i + 2) % 9, masked:!s.visible}));
      },
      targetCols(app){return app.state.n},
      progress(app){
        const s = app.state;
        let hit = 0;
        for(let i=0;i<s.target.length;i++) if(s.board[i] === s.target[i]) hit++;
        return hit + "/" + s.target.length;
      },
      boardLabelText(app){return app.state.phase === "preview" ? "等待目标隐藏" : "复原区"},
      targetLabelText(app){return app.state.visible ? "瞬闪目标" : "目标已隐藏"},
      actionText(app){return app.state.phase === "preview" ? "跳过预览" : "确认图形"},
      action(app){
        const s = app.state;
        if(s.phase === "preview"){
          hideFlashTarget(app);
          return;
        }
        app.moves += 1;
        let ok = true;
        for(let i=0;i<s.target.length;i++) if(s.board[i] !== s.target[i]) ok = false;
        if(ok){
          sfx("good");
          setMessage("记忆复原完成", 500);
          render();
          later(() => finish(true, "完成"), 360);
        }else{
          app.mistakes += 1;
          app.lastBad = -1;
          s.revealWrong = true;
          sfx("bad");
          setMessage("还有格子不一致", 680);
          render();
          later(() => {s.revealWrong = false; render();}, 680);
        }
      },
      actionDisabled(){return false},
      reset(app){
        app.state.board.fill(0);
        app.state.revealWrong = false;
        setMessage("已清空复原区", 600);
      },
      afterStart(app){
        later(() => hideFlashTarget(app), app.level.preview);
      },
      onCell(app, i){
        const s = app.state;
        if(s.phase !== "play") return;
        s.board[i] ^= 1;
        app.moves += 1;
        app.lastGood = i;
        sfx("tap");
        later(() => {
          if(app.lastGood === i){ app.lastGood = -1; render(); }
        }, 180);
      }
    },

    texture:{
      boardLabel:"暗纹区",
      targetLabel:"目标暗纹",
      levels(){
        const names = ["浅层暗纹","白噪圆标","黑场细十","边角微印","五阶纹海","低亮搜索","六阶暗潮","符号伪装","窄光标记","七阶噪场","迷彩终局","黑白深层"];
        return baseLevels("texture", names, i => {
          const n = i < 3 ? 5 : i < 7 ? 6 : i < 10 ? 7 : 8;
          return {
            n,
            time:30 + i * 4,
            opacity:Math.max(.19, .48 - i * .024),
            note:"找出藏着细小十字圆环的格子。",
            sizeLabel:n + "x" + n
          };
        });
      },
      create(level, levelIndex){
        const rand = rng(7900 + levelIndex * 223 + Date.now());
        const total = level.n * level.n;
        const target = Math.floor(rand() * total);
        const cells = Array.from({length:total}, (_, i) => ({
          tone:rand() > .52 ? 1 : 0,
          pattern:Math.floor(rand() * 9),
          mark:levelIndex > 7 && rand() > .82 ? pick(["•","+","◇"]) : "",
          grain:true,
          signal:i === target,
          signalOpacity:level.opacity
        }));
        return {n:level.n, target, cells};
      },
      dims(state){return {cols:state.n, rows:state.n}},
      cells(app){return app.state.cells},
      target(){return [{tone:1, pattern:0, signal:true}]},
      targetCols(){return 1},
      progress(app){return app.ended ? "1/1" : "0/1"},
      actionText(){return ""},
      action(){},
      reset(app){newRound(true)},
      onCell(app, i){
        if(i === app.state.target) successCell(i, "暗纹锁定");
        else badCell(i, "没有暗纹标记");
      }
    }
  };

  function runPathReplay(app, byAction){
    const s = app.state;
    app.timeouts.forEach(id => clearTimeout(id));
    app.timeouts = [];
    s.phase = "watch";
    s.lit = -1;
    app.lastBad = -1;
    app.lastGood = -1;
    setMessage(byAction ? "重看会计一次失误" : "观察光点顺序", 900);
    render();
    let offset = 260;
    s.seq.forEach((idx, step) => {
      later(() => {
        if(app.ended) return;
        s.lit = idx;
        sfx("pulse");
        render();
      }, offset);
      later(() => {
        if(app.ended) return;
        if(s.lit === idx) s.lit = -1;
        render();
      }, offset + 310);
      offset += step < 4 ? 520 : 470;
    });
    later(() => {
      if(app.ended) return;
      s.phase = "play";
      s.lit = -1;
      setMessage("轮到你复现", 700);
      render();
    }, offset + 90);
  }

  function hideFlashTarget(app){
    const s = app.state;
    if(!s || s.phase !== "preview") return;
    s.phase = "play";
    s.visible = false;
    setMessage("按记忆点亮同样的格子", 800);
    sfx("pulse");
    render();
  }

  window.addEventListener("DOMContentLoaded", () => {
    mountShell();
    initApp();
  });
})();
