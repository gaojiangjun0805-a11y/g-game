(function(){
  'use strict';

  const cfg = window.CALC_ARCADE_CONFIG || {};
  const tools = {
    rng(seed){
      let t = seed >>> 0;
      return function(){
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    },
    int(rand,min,max){ return Math.floor(rand() * (max - min + 1)) + min; },
    choice(rand,arr){ return arr[Math.floor(rand() * arr.length)]; },
    shuffle(rand,arr){
      const a = arr.slice();
      for(let i=a.length-1;i>0;i--){
        const j = Math.floor(rand() * (i + 1));
        [a[i],a[j]] = [a[j],a[i]];
      }
      return a;
    },
    mod(n,m){ return ((n % m) + m) % m; },
    gcd(a,b){
      a = Math.abs(a); b = Math.abs(b);
      while(b){ const t = a % b; a = b; b = t; }
      return a || 1;
    }
  };

  document.documentElement.style.setProperty('--accent', cfg.accent || '#9de2ff');
  document.documentElement.style.setProperty('--accent2', cfg.accent2 || '#7df0a0');
  document.documentElement.style.setProperty('--warm', cfg.warm || '#ffe08a');
  document.title = cfg.title || '计算力游戏';
  document.body.classList.toggle('factory-skin', cfg.mode === 'factoryLine');

  document.body.innerHTML = `
    <canvas id="bg-canvas"></canvas>
    <div id="welcome-mask">
      <div class="modal">
        <div id="welcome-logo">G-Game</div>
        <div id="welcome-title"></div>
        <div id="welcome-sub"></div>
        <div id="welcome-demo"></div>
        <button id="welcome-start" type="button">开始游戏</button>
      </div>
    </div>
    <div id="app">
      <div id="title-wrap">
        <h1 id="game-title"></h1>
        <div id="subtitle"></div>
      </div>
      <section id="level-card">
        <div id="level-top"><span id="level-kicker"></span><span id="level-size"></span></div>
        <div id="level-name"></div>
        <div id="level-note"></div>
        <div id="progress-rail"></div>
      </section>
      <section id="hud">
        <div class="hud-item"><span>分数</span><b id="score">0</b></div>
        <div class="hud-item"><span>连击</span><b id="combo">0</b></div>
        <div class="hud-item"><span>时间</span><b id="timer">0s</b></div>
        <div class="hud-item"><span id="done-label">进度</span><b id="done">0/0</b></div>
      </section>
      <main id="play">
        <section id="target-card" class="glass">
          <div id="target-title"></div>
          <div id="target-value"></div>
          <div id="target-note"></div>
        </section>
        <section id="stage" class="glass"></section>
        <section id="readout" class="glass"></section>
      </main>
      <div id="msg"></div>
      <nav id="buttons">
        <button id="btn-new" type="button">↻ 重开</button>
        <button id="btn-hint" type="button">💡 提示</button>
        <button id="btn-music" type="button">🎵 音乐</button>
      </nav>
    </div>
    <div id="settle-mask">
      <div class="modal">
        <div id="settle-title"></div>
        <div id="settle-rank">S</div>
        <div id="settle-sub"></div>
        <div id="settle-rows"></div>
        <div class="settle-actions">
          <button id="settle-again" type="button">再来一局</button>
          <button id="settle-close" class="secondary" type="button">关闭</button>
        </div>
      </div>
    </div>
  `;

  const $ = id => document.getElementById(id);
  const el = {
    welcome:$('welcome-mask'), welcomeTitle:$('welcome-title'), welcomeSub:$('welcome-sub'), welcomeDemo:$('welcome-demo'),
    title:$('game-title'), subtitle:$('subtitle'), kicker:$('level-kicker'), size:$('level-size'), name:$('level-name'), note:$('level-note'), rail:$('progress-rail'),
    score:$('score'), combo:$('combo'), timer:$('timer'), done:$('done'), doneLabel:$('done-label'),
    targetTitle:$('target-title'), targetValue:$('target-value'), targetNote:$('target-note'),
    stage:$('stage'), readout:$('readout'), msg:$('msg'),
    btnNew:$('btn-new'), btnHint:$('btn-hint'), btnMusic:$('btn-music'),
    settle:$('settle-mask'), settleTitle:$('settle-title'), settleRank:$('settle-rank'), settleSub:$('settle-sub'), settleRows:$('settle-rows'),
    settleAgain:$('settle-again'), settleClose:$('settle-close'), welcomeStart:$('welcome-start')
  };

  el.title.textContent = cfg.spacedTitle || cfg.title || '计 算 力';
  el.subtitle.textContent = cfg.subtitle || '把计算藏进玩法里';
  el.welcomeTitle.textContent = cfg.title || '计算力游戏';
  el.welcomeSub.textContent = cfg.welcome || '不是选答案，而是在棋盘里把数算出来。';
  (cfg.demo || ['12','+','7','19','□','■','3','×','8','24']).forEach(txt => {
    const d = document.createElement('div');
    d.className = 'demo';
    d.textContent = txt;
    el.welcomeDemo.appendChild(d);
  });

  const state = {
    rand:tools.rng(Date.now() ^ Math.floor(Math.random() * 1e9)),
    active:false,
    score:0,
    combo:0,
    bestCombo:0,
    solved:0,
    mistakes:0,
    hints:0,
    locked:false,
    timeLeft:cfg.timeLimit || 180,
    timer:null,
    mode:null,
    data:null
  };
  function isEndless(){ return !!(cfg.endless || cfg.infinite); }
  function isRoundTimer(){ return !!cfg.perRoundTimer; }
  function isRoundOnly(){ return !!(cfg.roundOnly || cfg.hideProgressRail || isRoundTimer()); }
  function targetGoal(){ return cfg.goal || 8; }
  function railGoal(){ return isEndless() ? (cfg.progressWindow || 12) : targetGoal(); }
  function goalLabel(){ return isEndless() ? '∞' : targetGoal(); }
  document.documentElement.classList.toggle('hide-progress-rail', isRoundOnly());
  if(el.doneLabel) el.doneLabel.textContent = isRoundOnly() ? '局数' : '进度';
  const api = {
    tools,
    state,
    el,
    setTarget(title,value,note){
      el.targetTitle.textContent = title || '';
      el.targetValue.textContent = value || '';
      el.targetNote.textContent = note || '';
    },
    beginRound(seconds){
      if(!isRoundTimer()) return;
      const fallback = cfg.timeLimit || 30;
      state.timeLeft = Math.max(1, Math.round(seconds || fallback));
      updateHud();
    },
    setLevel(name,note,size){
      el.kicker.textContent = isRoundOnly() ? `第 ${state.solved + 1} 局` : isEndless() ? `第 ${state.solved + 1} 局 · 无限` : `第 ${state.solved + 1} / ${targetGoal()} 局`;
      el.size.textContent = size || cfg.badge || '计算力';
      el.name.textContent = name || cfg.title || '';
      el.note.textContent = note || '';
      renderRail();
    },
    setGrid(cols,rows){
      const gap = rows >= 6 || cols >= 6 ? 6 : 7;
      const applySize = () => {
        const stageW = Math.min(window.innerWidth,510) - 42;
        const rect = el.stage.getBoundingClientRect();
        const stageH = Math.max(160, rect.height || el.stage.clientHeight || 260) - 18;
        const maxSize = rows >= 6 || cols >= 6 ? 42 : rows >= 5 || cols >= 5 ? 50 : 58;
        const cell = Math.max(28, Math.min(
          maxSize,
          Math.floor((stageW - gap * (cols - 1)) / cols),
          Math.floor((stageH - gap * (rows - 1)) / rows)
        ));
        document.documentElement.style.setProperty('--cols', cols);
        document.documentElement.style.setProperty('--cell', cell + 'px');
        document.documentElement.style.setProperty('--gap', gap + 'px');
      };
      applySize();
      requestAnimationFrame(applySize);
    },
    tile(label, sub, className, onClick){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tile ' + (className || '');
      btn.innerHTML = `<b></b><small></small>`;
      btn.querySelector('b').textContent = label;
      btn.querySelector('small').textContent = sub || '';
      if(onClick) btn.addEventListener('click', onClick);
      return btn;
    },
    read(items, actions){
      el.readout.innerHTML = '';
      items.forEach(item => {
        const box = document.createElement('div');
        box.className = 'read-box';
        box.innerHTML = '<span></span><b></b>';
        box.querySelector('span').textContent = item[0];
        box.querySelector('b').textContent = item[1];
        el.readout.appendChild(box);
      });
      if(actions && actions.length){
        const wrap = document.createElement('div');
        wrap.id = 'mode-actions';
        actions.forEach(a => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'mini-btn ' + (a.primary ? 'primary' : '');
          b.textContent = a.label;
          b.addEventListener('click', a.onClick);
          wrap.appendChild(b);
        });
        el.readout.appendChild(wrap);
      }
    },
    message(text){ el.msg.textContent = text || ''; },
    award(points){
      state.combo++;
      state.bestCombo = Math.max(state.bestCombo,state.combo);
      const gain = Math.round(points * (1 + Math.min(5,state.combo - 1) * .18));
      state.score += gain;
      el.msg.textContent = `+${gain} · 连击 ${state.combo}`;
      goodSound();
      updateHud();
      return gain;
    },
    mistake(text){
      state.combo = 0;
      state.mistakes++;
      state.timeLeft = Math.max(0, state.timeLeft - (cfg.penalty || 4));
      el.msg.textContent = text || '算错一步，节奏断了';
      badSound();
      updateHud();
      if(state.timeLeft <= 0) finish(false);
    },
    complete(points, text){
      if(state.locked) return;
      state.locked = true;
      api.award(points || 160);
      state.solved++;
      let message = text || '完成一局';
      if(isEndless() && !isRoundTimer() && cfg.roundTimeBonus){
        const cap = cfg.maxTimeLimit || cfg.timeLimit || 180;
        const rampEvery = cfg.bonusRampEvery || 0;
        const ramp = rampEvery ? Math.floor(Math.max(0,state.solved - 1) / rampEvery) * (cfg.bonusRamp || 0) : 0;
        const reward = Math.max(0,Math.round((cfg.roundTimeBonus || 0) + ramp));
        const before = state.timeLeft;
        state.timeLeft = Math.min(cap,state.timeLeft + reward);
        const gained = state.timeLeft - before;
        if(gained > 0) message += ` · 回充 ${gained}s`;
      }
      el.msg.textContent = message;
      updateHud();
      if(!isEndless() && state.solved >= targetGoal()){
        setTimeout(() => finish(true), 520);
      }else{
        setTimeout(() => {
          state.locked = false;
          state.mode.next();
        }, 520);
      }
    }
  };

  function renderRail(){
    if(isRoundOnly()){
      el.rail.innerHTML = '';
      return;
    }
    const goal = railGoal();
    document.documentElement.style.setProperty('--goal', goal);
    let html = '';
    for(let i=0;i<goal;i++){
      const current = isEndless() ? state.solved % goal : state.solved;
      html += `<span class="rail-dot ${i < current ? 'done' : i === current ? 'current' : ''}"></span>`;
    }
    el.rail.innerHTML = html;
  }
  function updateHud(){
    el.score.textContent = String(Math.round(state.score));
    el.combo.textContent = String(state.combo);
    el.timer.textContent = `${state.timeLeft}s`;
    el.timer.classList.toggle('low', state.timeLeft <= 18);
    el.done.textContent = isRoundOnly() ? `第${state.solved + 1}` : `${state.solved}/${goalLabel()}`;
    renderRail();
  }
  function startGame(){
    clearInterval(state.timer);
    state.rand = tools.rng(Date.now() ^ Math.floor(Math.random() * 1e9));
    state.active = true;
    state.score = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.solved = 0;
    state.mistakes = 0;
    state.hints = 0;
    state.locked = false;
    state.timeLeft = cfg.timeLimit || 180;
    state.data = {};
    el.settle.classList.remove('show');
    state.mode = modes[cfg.mode](api);
    state.mode.next();
    updateHud();
    state.timer = setInterval(() => {
      if(!state.active || (isRoundTimer() && state.locked)) return;
      state.timeLeft--;
      updateHud();
      if(state.timeLeft <= 0) finish(false);
    },1000);
  }
  function finish(cleared){
    if(!state.active) return;
    state.active = false;
    clearInterval(state.timer);
    const timeBonus = cleared ? state.timeLeft * 5 : 0;
    state.score += timeBonus;
    const accuracy = state.solved / Math.max(1,state.solved + state.mistakes);
    let rank = 'C';
    if(isEndless()){
      if(state.solved >= 30 && accuracy >= .9 && state.hints <= 4) rank = 'S';
      else if(state.solved >= 18 && accuracy >= .78) rank = 'A';
      else if(state.solved >= 10) rank = 'B';
    }else if(cleared && accuracy >= .92 && state.hints <= 2) rank = 'S';
    else if(cleared && accuracy >= .82) rank = 'A';
    else if(state.solved >= Math.ceil(targetGoal() * .65)) rank = 'B';
    el.settleTitle.textContent = cleared ? '挑战完成' : (isRoundTimer() ? '本局超时' : isEndless() ? '脉冲中断' : '时间到');
    el.settleRank.textContent = rank;
    el.settleSub.textContent = isRoundOnly() ? `完成 ${state.solved} 局 · 失误 ${state.mistakes} · 提示 ${state.hints}` : `${state.solved}/${goalLabel()} 局 · 失误 ${state.mistakes} · 提示 ${state.hints}`;
    el.settleRows.innerHTML = [
      ['最终分数',Math.round(state.score)],
      ['时间奖励',timeBonus],
      ['最高连击',state.bestCombo],
      ['玩法',cfg.title || '计算力']
    ].map(([k,v]) => `<div class="settle-row"><span>${k}</span><b>${v}</b></div>`).join('');
    el.settle.classList.add('show');
    cleared ? winSound() : badSound();
    updateHud();
  }

  const dirs4 = [[1,0],[-1,0],[0,1],[0,-1]];
  const dirs8 = dirs4.concat([[1,1],[1,-1],[-1,1],[-1,-1]]);
  function idx(r,c,cols){ return r * cols + c; }
  function rc(i,cols){ return [Math.floor(i / cols), i % cols]; }
  function neighbors(i,cols,rows,diag){
    const [r,c] = rc(i,cols);
    const dirs = diag ? dirs8 : dirs4;
    return dirs.map(([dr,dc]) => [r + dr,c + dc]).filter(([rr,cc]) => rr >= 0 && rr < rows && cc >= 0 && cc < cols).map(([rr,cc]) => idx(rr,cc,cols));
  }
  function isAdjacent(a,b,cols,rows,diag){ return neighbors(a,cols,rows,diag).includes(b); }

  const modes = {
    sumChain(api){
      let C = 6, R = 6;
      const d = { board:[], selected:[], target:0, solution:[], profile:null };
      function profile(){
        const round = state.solved + 1;
        if(round === 1){
          return {
            name:'校准脉冲 I', note:'照着微光连 3 格，感受合计正好闭合。', badge:'教学',
            cols:5, rows:5, min:1, max:9, minLen:3, maxLen:3, diag:true, guide:'full', time:16
          };
        }
        if(round === 2){
          return {
            name:'校准脉冲 II', note:'斜向也能接，第二局只提示下一格。', badge:'教学',
            cols:5, rows:5, min:2, max:12, minLen:3, maxLen:3, diag:true, guide:'next', time:18
          };
        }
        if(round <= 5){
          return {
            name:'加速链路', note:'目标链开始变化，先看差值再决定下一步。', badge:'加速',
            cols:6, rows:5, min:2, max:14 + round, minLen:3, maxLen:4, diag:true, time:20 + round
          };
        }
        if(round <= 9){
          return {
            name:'多频脉冲', note:'链路更长，别让当前合计越过目标。', badge:'多频',
            cols:6, rows:6, min:3, max:18 + round, minLen:4, maxLen:5, diag:true, time:28 + Math.floor((round - 6) / 2) * 2
          };
        }
        if(round <= 14){
          return {
            name:'高压链路', note:'数值抬升，短链不一定够，留出回退空间。', badge:'高压',
            cols:6, rows:6, min:4, max:24 + round, minLen:4, maxLen:6, diag:true, time:34 + (round - 10) * 2
          };
        }
        const tier = Math.floor((round - 15) / 6);
        return {
          name:`无限脉冲 ${tier + 1}`, note:'无限轮继续推进，后面的链更长，单关时间也会更宽裕。', badge:'无限',
          cols:Math.min(7,6 + (tier >= 2 ? 1 : 0)), rows:6,
          min:5 + Math.min(7,tier), max:34 + round * 2,
          minLen:5, maxLen:Math.min(7,6 + Math.floor(tier / 2)), diag:true,
          time:Math.min(70,46 + tier * 4 + Math.floor((round - 15) / 2))
        };
      }
      function randNum(){ return tools.int(state.rand,d.profile.min,d.profile.max); }
      function fill(){
        C = d.profile.cols;
        R = d.profile.rows;
        d.board = Array.from({length:C*R}, randNum);
      }
      function makeTarget(){
        for(let t=0;t<120;t++){
          const len = tools.int(state.rand,d.profile.minLen,d.profile.maxLen);
          let cur = tools.int(state.rand,0,C*R-1);
          const path = [cur];
          while(path.length < len){
            const ns = tools.shuffle(state.rand, neighbors(cur,C,R,d.profile.diag).filter(n => !path.includes(n)));
            if(!ns.length) break;
            cur = ns[0];
            path.push(cur);
          }
          if(path.length >= d.profile.minLen){
            d.solution = path;
            d.target = path.reduce((s,i) => s + d.board[i],0);
            return;
          }
        }
      }
      function next(){
        d.profile = profile();
        api.beginRound(d.profile.time);
        fill();
        d.selected = [];
        makeTarget();
        render();
      }
      function sum(){ return d.selected.reduce((s,i) => s + d.board[i],0); }
      function clearSelection(){ d.selected = []; render(); }
      function clickTile(i){
        if(!state.active || state.locked) return;
        if(d.selected.includes(i)){
          if(d.selected[d.selected.length - 1] === i) d.selected.pop();
          render();
          return;
        }
        const last = d.selected[d.selected.length - 1];
        if(last != null && !isAdjacent(last,i,C,R,d.profile.diag)){
          api.mistake('只能接相邻脉冲');
          flash(i);
          return;
        }
        d.selected.push(i);
        const s = sum();
        if(s === d.target && d.selected.length >= d.profile.minLen){
          d.selected.forEach(k => d.board[k] = randNum());
          api.complete(150 + d.selected.length * 30 + Math.min(120,state.solved * 6), '脉冲闭合');
        }else if(s === d.target){
          api.message(`脉冲链至少需要 ${d.profile.minLen} 格`);
          render();
        }else if(s > d.target){
          api.mistake('能量超载');
          d.selected = [];
        }else{
          clickSound();
          render();
        }
      }
      function flash(i){
        const tile = el.stage.querySelector(`[data-i="${i}"]`);
        if(tile){ tile.classList.add('bad'); setTimeout(() => tile.classList.remove('bad'),280); }
      }
      function render(){
        api.setGrid(C,R);
        api.setLevel(d.profile.name,d.profile.note,d.profile.badge || '凑和');
        api.setTarget('目标能量',d.target,`当前链路 ${sum()} / ${d.target} · 需要 ${d.profile.minLen}-${d.profile.maxLen} 格 · 限时 ${d.profile.time}s`);
        el.stage.innerHTML = '<div class="grid"></div>';
        const grid = el.stage.querySelector('.grid');
        d.board.forEach((n,i) => {
          const tile = api.tile(n,'脉冲',(i + Math.floor(i / C)) % 2 ? 'dark' : '',() => clickTile(i));
          tile.dataset.i = i;
          if(d.selected.includes(i)) tile.classList.add('selected');
          if(d.profile.guide === 'full' && d.solution.includes(i)) tile.classList.add('guide');
          if(d.profile.guide === 'next' && d.solution[d.selected.length] === i) tile.classList.add('guide');
          grid.appendChild(tile);
        });
        api.read([
          ['已选',d.selected.length],
          ['合计',sum()],
          ['差值',Math.max(0,d.target - sum())]
        ],[
          {label:'↺ 清链',onClick:clearSelection,primary:true},
          {label:'邻接',onClick:() => api.message(d.profile.diag ? '斜向也算相邻' : '只接上下左右')},
          {label:'目标',onClick:() => api.message(`凑出 ${d.target}`)}
        ]);
      }
      function hint(){
        state.hints++;
        d.solution.forEach(i => {
          const tile = el.stage.querySelector(`[data-i="${i}"]`);
          if(tile) tile.classList.add('hint');
        });
        api.message('亮起的是一条可行脉冲链');
        hintSound();
      }
      return {next,hint,render};
    },

    balance(api){
      const C = 5, R = 4;
      const d = { weights:[], selected:[], target:0, solution:[] };
      function randWeight(){ return tools.int(state.rand,4,Math.min(42,18 + state.solved * 4)); }
      function fill(){ d.weights = Array.from({length:C*R}, randWeight); }
      function makeTarget(){
        const len = Math.min(4,2 + Math.floor(state.solved / 3));
        d.solution = tools.shuffle(state.rand, Array.from({length:C*R},(_,i)=>i)).slice(0,len);
        d.target = d.solution.reduce((s,i) => s + d.weights[i],0);
      }
      function next(){ fill(); d.selected = []; makeTarget(); render(); }
      function sum(){ return d.selected.reduce((s,i) => s + d.weights[i],0); }
      function toggle(i){
        if(!state.active || state.locked) return;
        if(d.selected.includes(i)) d.selected = d.selected.filter(x => x !== i);
        else d.selected.push(i);
        const s = sum();
        if(s === d.target){
          d.selected.forEach(k => d.weights[k] = randWeight());
          api.complete(170 + d.selected.length * 34, '天平归零');
        }else{
          if(s > d.target) api.message('右盘偏重，可以取下一块');
          else clickSound();
          render();
        }
      }
      function clear(){ d.selected = []; render(); }
      function render(){
        const s = sum();
        const tilt = Math.max(-18,Math.min(18,(s - d.target) / Math.max(1,d.target) * 42));
        api.setGrid(C,R);
        api.setLevel('天平配重','从货架挑几块砝码，让右盘和左盘一样重。','配重');
        api.setTarget('左盘重量',d.target,`右盘 ${s}，相差 ${Math.abs(d.target - s)}`);
        el.stage.innerHTML = `<div class="scale-wrap"><div class="scale-beam" style="--tilt:${tilt}deg"><div class="pan"><span>左盘</span><b>${d.target}</b></div><div class="needle"></div><div class="pan"><span>右盘</span><b>${s}</b></div></div><div class="grid"></div></div>`;
        const grid = el.stage.querySelector('.grid');
        d.weights.forEach((n,i) => {
          const tile = api.tile(n,'砝码',(i + Math.floor(i / C)) % 2 ? 'dark' : '',() => toggle(i));
          tile.dataset.i = i;
          if(d.selected.includes(i)) tile.classList.add('selected');
          grid.appendChild(tile);
        });
        api.read([
          ['已放',d.selected.length],
          ['右盘',s],
          ['差值',d.target - s]
        ],[
          {label:'↺ 清盘',onClick:clear,primary:true},
          {label:'+块数',onClick:() => api.message(`本局答案用了 ${d.solution.length} 块`)},
          {label:'平衡',onClick:() => api.message('右盘等于左盘即可过关')}
        ]);
      }
      function hint(){
        state.hints++;
        const next = d.solution.find(i => !d.selected.includes(i));
        if(next != null){
          const tile = el.stage.querySelector(`[data-i="${next}"]`);
          if(tile) tile.classList.add('hint');
          api.message('先试这块砝码');
          hintSound();
        }
      }
      return {next,hint,render};
    },

    remainderMaze(api){
      const C = 6, R = 6, start = 0, exit = C * R - 1;
      const d = { nums:[], mod:5, rem:0, path:[], current:start, visited:[] };
      function validNum(){ const q = tools.int(state.rand,3,22); return q * d.mod + d.rem; }
      function invalidNum(){
        let n = tools.int(state.rand,10,160);
        for(let tries=0; tries<20 && tools.mod(n,d.mod) === d.rem; tries++) n = tools.int(state.rand,10,160);
        return n;
      }
      function makePath(){
        const steps = Array(5).fill('R').concat(Array(5).fill('D'));
        const seq = tools.shuffle(state.rand,steps);
        let r = 0, c = 0;
        const path = [start];
        seq.forEach(s => {
          if(s === 'R') c++;
          else r++;
          path.push(idx(r,c,C));
        });
        return path;
      }
      function next(){
        d.mod = tools.choice(state.rand,[3,4,5,6,7,8,9]);
        d.rem = tools.int(state.rand,0,d.mod - 1);
        d.path = makePath();
        d.current = start;
        d.visited = [start];
        d.nums = Array.from({length:C*R}, invalidNum);
        d.path.forEach(i => d.nums[i] = validNum());
        d.nums[start] = 0;
        d.nums[exit] = validNum();
        for(let k=0;k<5;k++){
          const i = tools.int(state.rand,1,C*R-2);
          if(!d.path.includes(i)) d.nums[i] = validNum();
        }
        render();
      }
      function move(i){
        if(!state.active || state.locked || i === d.current) return;
        const prev = d.visited[d.visited.length - 2];
        if(i === prev){
          d.visited.pop();
          d.current = i;
          render();
          return;
        }
        if(!isAdjacent(d.current,i,C,R,false)){
          api.mistake('只能走相邻星格');
          flash(i); return;
        }
        if(tools.mod(d.nums[i],d.mod) !== d.rem){
          api.mistake(`这颗星余数不是 ${d.rem}`);
          flash(i); return;
        }
        d.current = i;
        d.visited.push(i);
        clickSound();
        if(i === exit) api.complete(230 + d.visited.length * 7, '穿过余数星门');
        else render();
      }
      function flash(i){
        const tile = el.stage.querySelector(`[data-i="${i}"]`);
        if(tile){ tile.classList.add('bad'); setTimeout(() => tile.classList.remove('bad'),280); }
      }
      function reset(){ d.current = start; d.visited = [start]; render(); }
      function render(){
        api.setGrid(C,R);
        api.setLevel('余数星路','只走除以后余数正确的星格，抵达右下星门。',`mod ${d.mod}`);
        api.setTarget('星门口令',`余 ${d.rem} / 除 ${d.mod}`,`当前位置到出口还有 ${Math.abs(rc(d.current,C)[0] - 5) + Math.abs(rc(d.current,C)[1] - 5)} 格`);
        el.stage.innerHTML = '<div class="grid"></div>';
        const grid = el.stage.querySelector('.grid');
        d.nums.forEach((n,i) => {
          let label = i === start ? '起' : i === exit ? n : n;
          let sub = i === start ? '起点' : i === exit ? '星门' : `余 ${tools.mod(n,d.mod)}`;
          let cls = (i + Math.floor(i / C)) % 2 ? 'dark' : '';
          if(i === start) cls += ' maze-start';
          if(i === exit) cls += ' maze-exit';
          const tile = api.tile(label,sub,cls,() => move(i));
          tile.dataset.i = i;
          if(i === d.current) tile.classList.add('current');
          if(d.visited.includes(i) && i !== d.current) tile.classList.add('visited');
          grid.appendChild(tile);
        });
        api.read([
          ['除数',d.mod],
          ['余数',d.rem],
          ['步数',d.visited.length - 1]
        ],[
          {label:'↺ 回起点',onClick:reset,primary:true},
          {label:'退路',onClick:() => api.message('点上一个亮格可以后退')},
          {label:'星门',onClick:() => api.message('走到右下角过关')}
        ]);
      }
      function hint(){
        state.hints++;
        const pos = d.path.indexOf(d.current);
        const next = pos >= 0 ? d.path[pos + 1] : null;
        if(next != null){
          const tile = el.stage.querySelector(`[data-i="${next}"]`);
          if(tile) tile.classList.add('hint');
          api.message('下一步可走这颗星');
        }else api.message('先退回亮线上的星格');
        hintSound();
      }
      return {next,hint,render};
    },

    factorLaser(api){
      const C = 4, R = 4;
      const primes = [2,3,5,7,11,13];
      const d = { vals:[], selected:2, sector:0 };
      function makeVal(){
        const depth = Math.min(5,2 + Math.floor((state.solved + d.sector) / 2));
        let v = 1;
        for(let i=0;i<depth;i++) v *= tools.choice(state.rand, primes.slice(0,Math.min(primes.length,4 + Math.floor(state.solved / 2))));
        return v;
      }
      function next(){
        d.sector++;
        d.selected = 2;
        d.vals = Array.from({length:C*R}, makeVal);
        render();
      }
      function remaining(){ return d.vals.filter(v => v > 1).length; }
      function shoot(i){
        if(!state.active || state.locked || d.vals[i] <= 1) return;
        const p = d.selected;
        if(d.vals[i] % p !== 0){
          api.mistake(`${d.vals[i]} 不能被 ${p} 整除`);
          flash(i); return;
        }
        d.vals[i] = d.vals[i] / p;
        api.award(d.vals[i] === 1 ? 70 : 36);
        if(d.vals[i] === 1) d.vals[i] = 0;
        render();
        if(remaining() === 0) api.complete(260,'整片陨石带清空');
      }
      function flash(i){
        const tile = el.stage.querySelector(`[data-i="${i}"]`);
        if(tile){ tile.classList.add('bad'); setTimeout(() => tile.classList.remove('bad'),280); }
      }
      function render(){
        api.setGrid(C,R);
        api.setLevel('质因数激光','先选质数激光，再击中能被它整除的陨石。','因数');
        api.setTarget('当前激光',`÷ ${d.selected}`,`剩余陨石 ${remaining()} 块`);
        el.stage.innerHTML = '<div style="width:100%"><div class="laser-rack"></div><div class="grid"></div></div>';
        const rack = el.stage.querySelector('.laser-rack');
        primes.forEach(p => {
          const b = document.createElement('button');
          b.className = 'laser' + (p === d.selected ? ' active' : '');
          b.type = 'button';
          b.textContent = `÷${p}`;
          b.addEventListener('click',() => { d.selected = p; clickSound(); render(); });
          rack.appendChild(b);
        });
        const grid = el.stage.querySelector('.grid');
        d.vals.forEach((v,i) => {
          const cls = (i + Math.floor(i / C)) % 2 ? 'dark' : '';
          const tile = api.tile(v || '✦',v ? '陨石' : '清除',cls + (v ? '' : ' empty'),() => shoot(i));
          tile.dataset.i = i;
          grid.appendChild(tile);
        });
        api.read([
          ['扇区',d.sector],
          ['激光',`÷${d.selected}`],
          ['剩余',remaining()]
        ],[
          {label:'换 2',onClick:() => {d.selected = 2; render();},primary:true},
          {label:'换 3',onClick:() => {d.selected = 3; render();}},
          {label:'换 5',onClick:() => {d.selected = 5; render();}}
        ]);
      }
      function hint(){
        state.hints++;
        const i = d.vals.findIndex(v => v > 1 && v % d.selected === 0);
        if(i >= 0){
          const tile = el.stage.querySelector(`[data-i="${i}"]`);
          if(tile) tile.classList.add('hint');
          api.message(`这块能被 ${d.selected} 击穿`);
        }else{
          const v = d.vals.find(x => x > 1);
          const p = primes.find(x => v % x === 0);
          d.selected = p || 2;
          render();
          api.message(`先换成 ÷${d.selected}`);
        }
        hintSound();
      }
      return {next,hint,render};
    },

    opCircuit(api){
      const C = 5, R = 5, start = 0, exit = C * R - 1;
      const d = { ops:[], path:[], solution:[], startVal:0, target:0, value:0, current:start, visited:[] };
      function applyOp(v,op){
        const n = +op.slice(1);
        if(op[0] === '+') return v + n;
        if(op[0] === '-') return v - n;
        if(op[0] === '×') return v * n;
        if(op[0] === '÷') return v % n === 0 ? v / n : NaN;
        return NaN;
      }
      function randomValidOp(v){
        const candidates = ['+3','+4','+5','+6','+8','-2','-3','-5','×2','×3','÷2','÷3']
          .filter(op => {
            const nv = applyOp(v,op);
            return Number.isInteger(nv) && nv > 0 && nv <= 220;
          });
        return tools.choice(state.rand,candidates);
      }
      function makePath(){
        const steps = tools.shuffle(state.rand,Array(4).fill('R').concat(Array(4).fill('D')));
        let r = 0, c = 0;
        const p = [start];
        steps.forEach(s => {
          if(s === 'R') c++;
          else r++;
          p.push(idx(r,c,C));
        });
        return p;
      }
      function next(){
        d.path = makePath();
        d.startVal = tools.int(state.rand,6,28);
        d.value = d.startVal;
        d.current = start;
        d.visited = [start];
        d.ops = Array.from({length:C*R},() => tools.choice(state.rand,['+2','+4','+7','-3','-6','×2','÷2','÷3']));
        d.solution = [];
        let v = d.startVal;
        for(let k=1;k<d.path.length;k++){
          const op = randomValidOp(v);
          d.solution.push(op);
          d.ops[d.path[k]] = op;
          v = applyOp(v,op);
        }
        d.target = v;
        render();
      }
      function step(i){
        if(!state.active || state.locked || i === d.current) return;
        const prev = d.visited[d.visited.length - 2];
        if(i === prev){
          d.visited.pop();
          d.current = i;
          recomputeValue();
          render();
          return;
        }
        if(!isAdjacent(d.current,i,C,R,false)){
          api.mistake('电流只能走相邻节点');
          flash(i); return;
        }
        if(d.visited.includes(i)){
          api.mistake('回路不能打结');
          flash(i); return;
        }
        const nv = applyOp(d.value,d.ops[i]);
        if(!Number.isInteger(nv) || nv <= 0 || nv > 300){
          api.mistake('这张运算片现在接不上');
          flash(i); return;
        }
        d.current = i;
        d.value = nv;
        d.visited.push(i);
        clickSound();
        if(i === exit){
          if(d.value === d.target) api.complete(260 + d.visited.length * 10,'回路闭合');
          else { api.mistake('到出口了，但电压不对'); reset(); }
        }else if(d.visited.length > d.path.length){
          api.mistake('线路太长，电压漂移');
          reset();
        }else render();
      }
      function recomputeValue(){
        let v = d.startVal;
        for(let k=1;k<d.visited.length;k++) v = applyOp(v,d.ops[d.visited[k]]);
        d.value = v;
      }
      function reset(){ d.current = start; d.visited = [start]; d.value = d.startVal; render(); }
      function flash(i){
        const tile = el.stage.querySelector(`[data-i="${i}"]`);
        if(tile){ tile.classList.add('bad'); setTimeout(() => tile.classList.remove('bad'),280); }
      }
      function render(){
        api.setGrid(C,R);
        api.setLevel('运算电路','沿相邻运算片布线，出口时电压必须等于目标。','电路');
        api.setTarget('目标电压',d.target,`当前 ${d.value}，步数 ${d.visited.length - 1}/${d.path.length - 1}`);
        el.stage.innerHTML = '<div class="grid"></div>';
        const grid = el.stage.querySelector('.grid');
        d.ops.forEach((op,i) => {
          let label = i === start ? d.startVal : op;
          let sub = i === start ? '起点' : i === exit ? '出口' : '运算片';
          let cls = (i + Math.floor(i / C)) % 2 ? 'dark' : '';
          if(i === start) cls += ' maze-start';
          if(i === exit) cls += ' maze-exit';
          const tile = api.tile(label,sub,cls,() => step(i));
          tile.dataset.i = i;
          if(i === d.current) tile.classList.add('current');
          if(d.visited.includes(i) && i !== d.current) tile.classList.add('visited');
          grid.appendChild(tile);
        });
        api.read([
          ['起点',d.startVal],
          ['当前',d.value],
          ['目标',d.target]
        ],[
          {label:'↺ 断开',onClick:reset,primary:true},
          {label:'退线',onClick:() => api.message('点上一个亮格可以退一步')},
          {label:'出口',onClick:() => api.message('到右下角时必须等于目标')}
        ]);
      }
      function hint(){
        state.hints++;
        const pos = d.path.indexOf(d.current);
        const next = pos >= 0 ? d.path[pos + 1] : null;
        if(next != null){
          const tile = el.stage.querySelector(`[data-i="${next}"]`);
          if(tile) tile.classList.add('hint');
          api.message(`下一片可以接 ${d.ops[next]}`);
        }else api.message('先退回亮线上的节点');
        hintSound();
      }
      return {next,hint,render};
    },

    factoryLine(api){
      const d = { start:0, value:0, target:0, stage:0, stages:[], solution:[], chosen:[] };
      const opDefs = [
        ['+3',v=>v+3],['+5',v=>v+5],['+7',v=>v+7],['+9',v=>v+9],['+12',v=>v+12],
        ['-4',v=>v-4],['-6',v=>v-6],['-8',v=>v-8],
        ['×2',v=>v*2],['×3',v=>v*3],
        ['÷2',v=>v%2===0?v/2:NaN],['÷3',v=>v%3===0?v/3:NaN]
      ].map(([label,fn]) => ({label,fn}));
      function apply(v,op){
        const n = op.fn(v);
        return Number.isInteger(n) && n > 0 && n <= 420 ? n : NaN;
      }
      function validOps(v){ return opDefs.filter(op => Number.isInteger(apply(v,op))); }
      function machineRole(label){
        const mark = label[0];
        if(mark === '+') return '加料机';
        if(mark === '-') return '切削机';
        if(mark === '×') return '倍增炉';
        if(mark === '÷') return '分装机';
        return '机器';
      }
      function machineKind(label){
        const mark = label[0];
        if(mark === '+') return 'operator-add';
        if(mark === '-') return 'operator-sub';
        if(mark === '×') return 'operator-mul';
        if(mark === '÷') return 'operator-div';
        return '';
      }
      function valueAfter(count){
        let v = d.start;
        for(let i=0;i<count;i++){
          const op = opDefs.find(item => item.label === d.chosen[i]);
          if(!op) return null;
          const nextValue = apply(v,op);
          if(!Number.isInteger(nextValue)) return null;
          v = nextValue;
        }
        return v;
      }
      function next(){
        d.stage = 0; d.chosen = [];
        d.start = tools.int(state.rand,6,32);
        d.value = d.start;
        d.solution = [];
        let v = d.start;
        const stageCount = 4;
        for(let i=0;i<stageCount;i++){
          const pool = validOps(v).filter(op => op.label[0] !== '-' || v > 14);
          const op = tools.choice(state.rand,pool.length ? pool : validOps(v));
          d.solution.push(op);
          v = apply(v,op);
        }
        d.target = v;
        d.stages = d.solution.map((sol,idxStage) => {
          const decoys = tools.shuffle(state.rand,opDefs.filter(op => op.label !== sol.label)).slice(0,2);
          return tools.shuffle(state.rand,[sol].concat(decoys));
        });
        render();
      }
      function reset(){ d.stage = 0; d.value = d.start; d.chosen = []; render(); }
      function choose(stageIndex,op){
        if(!state.active || state.locked || stageIndex !== d.stage) return;
        const nv = apply(d.value,op);
        if(!Number.isInteger(nv)){
          api.mistake('这台机器现在会卡料');
          return;
        }
        d.value = nv;
        d.chosen.push(op.label);
        clickSound();
        if(d.stage === d.stages.length - 1){
          if(d.value === d.target) api.complete(280,'流水线调试成功');
          else { api.mistake('出厂数值不合格'); reset(); }
        }else{
          d.stage++;
          render();
        }
      }
      function render(){
        api.setLevel('算符流水线','1-4 号工位依次加工，每个工位只选一台机器。','四步流水线');
        api.setTarget('订单出厂数',d.target,`当前原料 ${d.value} · 正在 ${Math.min(d.stage + 1,d.stages.length)} 号工位`);
        const progress = Math.min(100,(d.stage / Math.max(1,d.stages.length - 1)) * 100);
        const chosenText = d.chosen.length ? d.chosen.join(' → ') : '等待 1 号工位开机';
        el.stage.innerHTML = `
          <div class="factory-wrap">
            <div class="factory-roofline" aria-hidden="true">
              <span class="factory-stack tall"></span>
              <span class="factory-stack"></span>
              <span class="factory-window"></span>
              <span class="factory-window"></span>
              <span class="factory-window"></span>
            </div>
            <div class="factory-head">
              <div class="factory-crate">
                <span>原料箱</span>
                <b>${d.start}</b>
              </div>
              <div class="factory-belt-track" style="--progress:${progress}%">
                <div class="belt-rollers" aria-hidden="true">
                  ${d.stages.map((_,i) => `<span class="${i <= d.stage ? 'lit' : ''}"></span>`).join('')}
                </div>
                <div class="factory-box"><span>${d.value}</span></div>
              </div>
              <div class="factory-crate target">
                <span>订单箱</span>
                <b>${d.target}</b>
              </div>
            </div>
            <div class="factory-stations"></div>
          </div>
        `;
        const wrap = el.stage.querySelector('.factory-wrap');
        const stations = wrap.querySelector('.factory-stations');
        d.stages.forEach((ops,stageIndex) => {
          const row = document.createElement('div');
          const stageState = stageIndex < d.stage ? 'locked' : stageIndex === d.stage ? 'active' : 'pending';
          const processedValue = stageIndex < d.chosen.length ? valueAfter(stageIndex + 1) : null;
          row.className = 'factory-row ' + stageState;
          const label = document.createElement('div');
          label.className = 'factory-label';
          label.innerHTML = `<span>工位</span><b>${stageIndex + 1}</b>`;
          row.appendChild(label);
          const bank = document.createElement('div');
          bank.className = 'machine-bank';
          ops.forEach(op => {
            const tile = api.tile(op.label,machineRole(op.label),`machine-tile factory-machine ${machineKind(op.label)}`,() => choose(stageIndex,op));
            if(d.chosen[stageIndex] === op.label) tile.classList.add('selected');
            if(stageIndex !== d.stage) tile.disabled = true;
            bank.appendChild(tile);
          });
          row.appendChild(bank);
          const output = document.createElement('div');
          output.className = 'factory-output';
          output.innerHTML = stageIndex < d.chosen.length
            ? `<span>已加工</span><b>${processedValue}</b>`
            : stageIndex === d.stage
              ? '<span>当前</span><b>待选机</b>'
              : '<span>排队</span><b>待传送</b>';
          row.appendChild(output);
          stations.appendChild(row);
        });
        api.read([
          ['输入',d.start],
          ['当前',d.value],
          ['目标',d.target]
        ],[
          {label:'↺ 回炉',onClick:reset,primary:true},
          {label:'流程',onClick:() => api.message(chosenText)},
          {label:'规则',onClick:() => api.message('按 1 到 4 号工位依次选机器')}
        ]);
      }
      function hint(){
        state.hints++;
        const want = d.solution[d.stage]?.label;
        Array.from(el.stage.querySelectorAll('.factory-row.active .factory-machine')).forEach(tile => {
          if(tile.textContent.includes(want)) tile.classList.add('hint');
        });
        api.message(`${d.stage + 1} 号工位试试 ${want}`);
        hintSound();
      }
      return {next,hint,render};
    },

    alchemyPot(api){
      const C = 4, R = 4;
      const d = { nums:[], op:null, target:0, selected:[], solution:[] };
      const ops = [
        {name:'相加',sym:'+',calc:(a,b)=>a+b},
        {name:'相乘',sym:'×',calc:(a,b)=>a*b},
        {name:'相差',sym:'差',calc:(a,b)=>Math.abs(a-b)},
        {name:'公因',sym:'gcd',calc:(a,b)=>tools.gcd(a,b)},
        {name:'公倍',sym:'lcm',calc:(a,b)=>a/tools.gcd(a,b)*b}
      ];
      function randNum(){ return tools.int(state.rand,3,Math.min(36,18 + state.solved * 3)); }
      function next(){
        d.selected = [];
        d.nums = Array.from({length:C*R},randNum);
        const usableOps = ops.slice(0,Math.min(ops.length,3 + Math.floor(state.solved / 2)));
        for(let attempt=0;attempt<80;attempt++){
          d.op = tools.choice(state.rand,usableOps);
          d.solution = tools.shuffle(state.rand,Array.from({length:C*R},(_,i)=>i)).slice(0,2);
          const a = d.nums[d.solution[0]], b = d.nums[d.solution[1]];
          d.target = d.op.calc(a,b);
          if(d.target > 0 && d.target <= 260 && (d.op.sym !== '差' || d.target >= 2)) break;
        }
        render();
      }
      function choose(i){
        if(!state.active || state.locked) return;
        if(d.selected.includes(i)) d.selected = d.selected.filter(x => x !== i);
        else d.selected.push(i);
        if(d.selected.length < 2){ clickSound(); render(); return; }
        const a = d.nums[d.selected[0]], b = d.nums[d.selected[1]];
        const value = d.op.calc(a,b);
        if(value === d.target){
          api.complete(230,`${a} ${d.op.sym} ${b} 合成成功`);
        }else{
          api.mistake(`炼成了 ${value}，配方不对`);
          d.selected = [];
          render();
        }
      }
      function render(){
        api.setGrid(C,R);
        api.setLevel('双材料炼金','按配方从炉盘里挑两种材料，炼成目标晶体。','配方');
        api.setTarget('目标晶体',d.target,`配方：两数${d.op.name}`);
        el.stage.innerHTML = '<div class="alchemy-wrap"><div class="recipe-strip"></div><div class="alchemy-grid"></div></div>';
        const strip = el.stage.querySelector('.recipe-strip');
        [['配方',d.op.sym],['已选',d.selected.length + '/2'],['目标',d.target]].forEach(([k,v]) => {
          const pill = document.createElement('div');
          pill.className = 'recipe-pill';
          pill.innerHTML = `<span>${k}</span><b>${v}</b>`;
          strip.appendChild(pill);
        });
        const grid = el.stage.querySelector('.alchemy-grid');
        d.nums.forEach((n,i) => {
          const tile = api.tile(n,'材料',(i + Math.floor(i / C)) % 2 ? 'dark' : '',() => choose(i));
          if(d.selected.includes(i)) tile.classList.add('selected');
          grid.appendChild(tile);
        });
        api.read([
          ['配方',d.op.sym],
          ['目标',d.target],
          ['已选',d.selected.length]
        ],[
          {label:'↺ 清料',onClick:() => {d.selected = []; render();},primary:true},
          {label:'说明',onClick:() => api.message('选两块材料，按配方运算')},
          {label:'晶体',onClick:() => api.message(`要炼成 ${d.target}`)}
        ]);
      }
      function hint(){
        state.hints++;
        const i = d.solution.find(x => !d.selected.includes(x));
        const tile = el.stage.querySelectorAll('.alchemy-grid .tile')[i];
        if(tile) tile.classList.add('hint');
        api.message('先取这块材料');
        hintSound();
      }
      return {next,hint,render};
    },

    fractionMixer(api){
      const d = { cards:[], selected:[], target:{n:1,d:1}, solution:[] };
      const base = [[1,2],[1,3],[1,4],[1,5],[1,6],[2,3],[3,4],[2,5],[3,5],[5,6],[1,8],[3,8]];
      function reduce(f){
        const g = tools.gcd(f.n,f.d);
        return {n:f.n/g,d:f.d/g};
      }
      function add(a,b){ return reduce({n:a.n*b.d+b.n*a.d,d:a.d*b.d}); }
      function cmp(a,b){ return a.n*b.d - b.n*a.d; }
      function label(f){ return f.d === 1 ? String(f.n) : `${f.n}/${f.d}`; }
      function sumSelected(){ return d.selected.reduce((s,i) => add(s,d.cards[i]),{n:0,d:1}); }
      function next(){
        d.selected = [];
        const len = Math.min(3,2 + Math.floor(state.solved / 4));
        const pool = tools.shuffle(state.rand,base.map(([n,dd]) => ({n,d:dd})));
        d.solution = pool.slice(0,len);
        d.target = d.solution.reduce((s,f) => add(s,f),{n:0,d:1});
        const decoys = pool.slice(len).concat(tools.shuffle(state.rand,base.map(([n,dd]) => ({n,d:dd})))).slice(0,12-len);
        d.cards = tools.shuffle(state.rand,d.solution.concat(decoys)).slice(0,12);
        render();
      }
      function toggle(i){
        if(!state.active || state.locked) return;
        if(d.selected.includes(i)) d.selected = d.selected.filter(x => x !== i);
        else d.selected.push(i);
        const s = sumSelected();
        if(cmp(s,d.target) === 0) api.complete(240,'和声调准');
        else if(cmp(s,d.target) > 0){ api.message('音量过了，可以点已选音轨撤掉'); badSound(); }
        else clickSound();
        render();
      }
      function render(){
        const s = sumSelected();
        const pct = Math.max(0,Math.min(100,(s.n*d.target.d)/(Math.max(1,d.target.n)*s.d)*100));
        api.setLevel('分数和声调音','选择几条分数音轨，让当前和声等于目标和声。','分数');
        api.setTarget('目标和声',label(d.target),`当前 ${label(s)} · 目标 ${label(d.target)}`);
        el.stage.innerHTML = '<div class="fraction-wrap"><div class="fraction-meter"><div class="fraction-fill"></div></div><div class="fraction-rack"></div></div>';
        el.stage.querySelector('.fraction-fill').style.width = pct + '%';
        const rack = el.stage.querySelector('.fraction-rack');
        d.cards.forEach((f,i) => {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'fraction-card ' + (i % 2 ? 'dark' : '');
          if(d.selected.includes(i)) card.classList.add('selected');
          card.innerHTML = `<b>${label(f)}</b><small>音轨</small>`;
          card.addEventListener('click',() => toggle(i));
          rack.appendChild(card);
        });
        api.read([
          ['当前',label(s)],
          ['目标',label(d.target)],
          ['音轨',d.selected.length]
        ],[
          {label:'↺ 清音',onClick:() => {d.selected=[]; render();},primary:true},
          {label:'约分',onClick:() => api.message('等值分数也算调准')},
          {label:'目标',onClick:() => api.message(`凑成 ${label(d.target)}`)}
        ]);
      }
      function hint(){
        state.hints++;
        const need = d.solution.find(f => !d.selected.some(i => d.cards[i].n === f.n && d.cards[i].d === f.d));
        const idxCard = need ? d.cards.findIndex((f,i) => !d.selected.includes(i) && f.n === need.n && f.d === need.d) : -1;
        const card = el.stage.querySelectorAll('.fraction-card')[idxCard];
        if(card) card.classList.add('hint');
        api.message(need ? `加一条 ${label(need)}` : '已经接近目标了');
        hintSound();
      }
      return {next,hint,render};
    },

    auctionHouse(api){
      const d = { cards:[], selected:[], budget:0, solution:[] };
      function makeCard(){
        const base = tools.int(state.rand,12,Math.min(72,34 + state.solved * 5));
        const fee = tools.choice(state.rand,[2,3,4,5,6,8]);
        return {base,fee,cost:base+fee};
      }
      function sum(){ return d.selected.reduce((s,i) => s + d.cards[i].cost,0); }
      function next(){
        d.selected = [];
        d.cards = Array.from({length:12},makeCard);
        const len = Math.min(4,3 + Math.floor(state.solved / 4));
        d.solution = tools.shuffle(state.rand,Array.from({length:12},(_,i)=>i)).slice(0,len);
        d.budget = d.solution.reduce((s,i) => s + d.cards[i].cost,0);
        render();
      }
      function toggle(i){
        if(!state.active || state.locked) return;
        if(d.selected.includes(i)) d.selected = d.selected.filter(x => x !== i);
        else d.selected.push(i);
        const s = sum();
        if(s === d.budget) api.complete(250,'委托拍下');
        else if(s > d.budget){ api.message('超预算了，撤掉一张牌'); badSound(); }
        else clickSound();
        render();
      }
      function render(){
        api.setLevel('拍卖预算局','每张牌要算底价加手续费，选一组正好花完委托预算。','预算');
        api.setTarget('委托预算',d.budget,`当前出价 ${sum()} · 差额 ${d.budget - sum()}`);
        el.stage.innerHTML = '<div class="auction-wrap"><div class="auction-ledger"></div><div class="auction-grid"></div></div>';
        const ledger = el.stage.querySelector('.auction-ledger');
        [['预算',d.budget],['当前',sum()],['差额',d.budget - sum()]].forEach(([k,v]) => {
          const cell = document.createElement('div');
          cell.className = 'ledger-cell';
          cell.innerHTML = `<span>${k}</span><b>${v}</b>`;
          ledger.appendChild(cell);
        });
        const grid = el.stage.querySelector('.auction-grid');
        d.cards.forEach((card,i) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'auction-card ' + (i % 2 ? 'dark' : '');
          if(d.selected.includes(i)) btn.classList.add('selected');
          btn.innerHTML = `<b>${card.base}+${card.fee}</b><small>实际 ${card.cost}</small>`;
          btn.addEventListener('click',() => toggle(i));
          grid.appendChild(btn);
        });
        api.read([
          ['已选',d.selected.length],
          ['当前',sum()],
          ['预算',d.budget]
        ],[
          {label:'↺ 清单',onClick:() => {d.selected=[]; render();},primary:true},
          {label:'手续费',onClick:() => api.message('每张牌：底价 + 手续费')},
          {label:'委托',onClick:() => api.message(`正好花 ${d.budget}`)}
        ]);
      }
      function hint(){
        state.hints++;
        const i = d.solution.find(x => !d.selected.includes(x));
        const card = el.stage.querySelectorAll('.auction-card')[i];
        if(card) card.classList.add('hint');
        api.message('这张在委托清单里');
        hintSound();
      }
      return {next,hint,render};
    },

    clockGears(api){
      const d = { start:0, current:0, target:0, ops:[], solution:[], steps:0, maxSteps:3 };
      const opDefs = [
        ['+15m',v=>v+15],['+20m',v=>v+20],['+30m',v=>v+30],['+45m',v=>v+45],['+1h',v=>v+60],['+2h',v=>v+120],
        ['-15m',v=>v-15],['-30m',v=>v-30],['-45m',v=>v-45],['-1h',v=>v-60],
        ['×2',v=>v*2],['半圈',v=>v+360]
      ].map(([label,fn]) => ({label,fn}));
      function norm(v){ return tools.mod(v,720); }
      function fmt(v){
        v = norm(v);
        const h = Math.floor(v/60) || 12;
        const m = v % 60;
        return `${h}:${String(m).padStart(2,'0')}`;
      }
      function apply(v,op){ return norm(op.fn(v)); }
      function next(){
        d.steps = 0;
        d.maxSteps = 3 + Math.min(1,Math.floor(state.solved / 4));
        d.start = tools.int(state.rand,1,11) * 60 + tools.choice(state.rand,[0,15,30,45]);
        d.current = norm(d.start);
        d.solution = [];
        let v = d.current;
        for(let i=0;i<d.maxSteps;i++){
          const op = tools.choice(state.rand,opDefs);
          d.solution.push(op);
          v = apply(v,op);
        }
        d.target = v;
        d.ops = tools.shuffle(state.rand,d.solution.concat(tools.shuffle(state.rand,opDefs).slice(0,12 - d.solution.length))).slice(0,12);
        render();
      }
      function reset(){ d.current = d.start; d.steps = 0; render(); }
      function choose(op){
        if(!state.active || state.locked) return;
        d.current = apply(d.current,op);
        d.steps++;
        clickSound();
        if(d.steps === d.maxSteps){
          if(d.current === d.target) api.complete(260,'齿轮校准完成');
          else { api.mistake('钟面偏了'); reset(); }
        }else render();
      }
      function render(){
        api.setLevel('时间齿轮盘','按顺序打出齿轮卡，在限定步数内把钟面拨到目标时间。','时间');
        api.setTarget('目标时间',fmt(d.target),`当前 ${fmt(d.current)} · ${d.steps}/${d.maxSteps} 步`);
        el.stage.innerHTML = '<div class="clock-wrap"><div class="clock-face"></div><div class="clock-grid"></div></div>';
        const face = el.stage.querySelector('.clock-face');
        [['当前',fmt(d.current)],['目标',fmt(d.target)]].forEach(([k,v]) => {
          const cell = document.createElement('div');
          cell.className = 'clock-cell';
          cell.innerHTML = `<span>${k}</span><b>${v}</b>`;
          face.appendChild(cell);
        });
        const grid = el.stage.querySelector('.clock-grid');
        d.ops.forEach((op,i) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'clock-card ' + (i % 2 ? 'dark' : '');
          btn.innerHTML = `<b>${op.label}</b><small>齿轮卡</small>`;
          btn.addEventListener('click',() => choose(op));
          grid.appendChild(btn);
        });
        api.read([
          ['起点',fmt(d.start)],
          ['当前',fmt(d.current)],
          ['步数',`${d.steps}/${d.maxSteps}`]
        ],[
          {label:'↺ 复位',onClick:reset,primary:true},
          {label:'钟面',onClick:() => api.message('12小时制循环')},
          {label:'顺序',onClick:() => api.message('齿轮顺序会影响结果')}
        ]);
      }
      function hint(){
        state.hints++;
        const want = d.solution[d.steps]?.label;
        Array.from(el.stage.querySelectorAll('.clock-card')).forEach(card => {
          if(card.textContent.includes(want)) card.classList.add('hint');
        });
        api.message(`下一张可用 ${want}`);
        hintSound();
      }
      return {next,hint,render};
    }
  };

  let audioCtx = null, master = null, musicOn = false, musicTimer = null, musicStep = 0;
  function ac(){
    if(!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      master = audioCtx.createGain();
      master.gain.value = .72;
      const comp = audioCtx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .12;
      master.connect(comp); comp.connect(audioCtx.destination);
    }
    if(audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function tone(f,dur,vol,type,delay){
    const ctx = ac(), t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f,t);
    g.gain.setValueAtTime(.0001,t);
    g.gain.linearRampToValueAtTime(vol,t + .012);
    g.gain.exponentialRampToValueAtTime(.0001,t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + .02);
  }
  function clickSound(){ tone(520,.06,.035,'triangle'); }
  function goodSound(){ tone(660,.13,.06,'triangle'); tone(990,.18,.045,'sine',.055); }
  function badSound(){ tone(230,.12,.06,'sawtooth'); tone(170,.16,.035,'triangle',.04); }
  function hintSound(){ tone(880,.12,.045,'sine'); tone(1320,.16,.034,'triangle',.05); }
  function winSound(){ [523,659,784,1046].forEach((f,i) => tone(f,.28,.065,'triangle',i * .07)); }
  function startMusic(){
    musicOn = true;
    el.btnMusic.textContent = '🔇 音乐';
    clearInterval(musicTimer);
    const scale = cfg.music || [196,247,294,370,440,494];
    musicTimer = setInterval(() => {
      if(!musicOn || !state.active) return;
      const f = scale[musicStep % scale.length];
      tone(f,.34,.032,'sine');
      if(musicStep % 4 === 0) tone(f / 2,.66,.02,'triangle');
      musicStep++;
    },380);
    ac();
  }
  function stopMusic(){ musicOn = false; clearInterval(musicTimer); el.btnMusic.textContent = '🎵 音乐'; }
  function toggleMusic(){ musicOn ? stopMusic() : startMusic(); }

  function initBg(){
    const canvas = $('bg-canvas'), ctx = canvas.getContext('2d');
    let dots = [];
    const symbols = cfg.bg || ['+','-','×','÷','□','■','◇','◆'];
    function resize(){
      canvas.width = window.innerWidth; canvas.height = window.innerHeight;
      dots = Array.from({length:30},() => ({
        x:Math.random()*canvas.width,y:Math.random()*canvas.height,s:10+Math.random()*18,a:.08+Math.random()*.22,
        vx:(Math.random()-.5)*.25,vy:-.12-Math.random()*.3,text:symbols[Math.floor(Math.random()*symbols.length)]
      }));
      if(state.mode && state.mode.render) state.mode.render();
    }
    function frame(){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      dots.forEach(d => {
        d.x += d.vx; d.y += d.vy;
        if(d.y < -30){ d.y = canvas.height + 30; d.x = Math.random()*canvas.width; }
        ctx.globalAlpha = d.a; ctx.fillStyle = cfg.accent || '#9de2ff'; ctx.font = `900 ${d.s}px system-ui`; ctx.fillText(d.text,d.x,d.y);
      });
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }
    window.addEventListener('resize',resize);
    resize(); frame();
  }
  function mountHubReturn(){
    const link = document.createElement('a');
    link.id = 'hubReturnBtn';
    link.target = '_top';
    link.textContent = '返回大厅';
    try{
      const url = new URL(location.href);
      const parts = url.pathname.split('/');
      const decoded = parts.map(p => { try{return decodeURIComponent(p);}catch(e){return p;} });
      let pivot = -1;
      ['G-Game-发布版','写程序','g-game-hub'].forEach(m => { const i = decoded.lastIndexOf(m); if(i > pivot) pivot = i; });
      if(pivot >= 0){
        url.pathname = parts.slice(0,pivot + 1).join('/') + '/G-Game/index.html';
        url.search = '?v=return-hub';
        link.href = url.href;
      }else link.href = '../G-Game/index.html?v=return-hub';
    }catch(e){ link.href = '../G-Game/index.html?v=return-hub'; }
    document.body.appendChild(link);
  }
  function guardTouch(){
    ['selectstart','dragstart','contextmenu'].forEach(type => document.addEventListener(type,e => {
      const t = e.target && e.target.closest && e.target.closest('input,textarea,[contenteditable="true"]');
      if(!t) e.preventDefault();
    },{passive:false}));
  }

  el.welcomeStart.addEventListener('click',() => {
    el.welcome.classList.add('hide');
    setTimeout(() => { el.welcome.style.display = 'none'; },450);
    startGame();
    startMusic();
  });
  el.btnNew.addEventListener('click',startGame);
  el.btnHint.addEventListener('click',() => {
    if(state.active && !state.locked && state.mode && state.mode.hint) state.mode.hint();
  });
  el.btnMusic.addEventListener('click',toggleMusic);
  el.settleAgain.addEventListener('click',startGame);
  el.settleClose.addEventListener('click',() => el.settle.classList.remove('show'));

  if(!modes[cfg.mode]){
    el.msg.textContent = '缺少玩法模式';
  }
  initBg();
  mountHubReturn();
  guardTouch();
  updateHud();
})();
