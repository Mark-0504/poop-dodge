(() => {
  'use strict';
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const rand = (a,b)=>Math.random()*(b-a)+a;
  const now = ()=>performance.now();

  // Audio helper
  const Audio = (()=>{ let ctx=null, enabled=true; const ensure=()=>{ if(!ctx){ try{ ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } return ctx; }; const toggle=()=>{ enabled=!enabled; return enabled; }; const resume=()=>{ if(ctx && ctx.state==='suspended') ctx.resume(); }; const beep=(freq=440, dur=0.08, type='sine', vol=0.1)=>{ if(!enabled) return; const c=ensure(); if(!c) return; const o=c.createOscillator(); const g=c.createGain(); o.type=type; o.frequency.value=freq; g.gain.value=vol; o.connect(g).connect(c.destination); const t=c.currentTime; o.start(t); o.stop(t+dur); g.gain.exponentialRampToValueAtTime(0.0001, t+dur); }; return { ensure, toggle, resume, beep, get enabled(){ return enabled; } }; })();

  // Local storage wrapper
  const Storage = {
    getName(){ return (localStorage.getItem('player_name')||'').trim(); },
    setName(n){ localStorage.setItem('player_name', n); },
    getBest(){ return Number(localStorage.getItem('best')||0); },
    setBest(v){ localStorage.setItem('best', String(v|0)); },
    getBoard(){ try { return JSON.parse(localStorage.getItem('leaderboard')||'[]'); } catch { return []; } },
    setBoard(arr){ localStorage.setItem('leaderboard', JSON.stringify(arr)); }
  };

  // Supabase client (global leaderboard)
  const SUPABASE_URL = 'https://jiubirptbmvrsazbeegp.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_umWrXM7Ife75i5E0HRo-gQ_E-DjGg9O';
  const sb = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    : null;

  async function fetchGlobalTop10(){
    if(!sb) return [];
    try {
      const { data, error } = await sb.from('scores')
        .select('name,score,created_at')
        .order('score', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(10);
      if(error) throw error;
      return Array.isArray(data) ? data : [];
    } catch(e){
      console.warn('[GlobalBoard] primary query failed, fallback without created_at', e?.message||e);
      try {
        const { data, error } = await sb.from('scores')
          .select('name,score')
          .order('score', { ascending: false })
          .limit(10);
        if(error) throw error;
        return Array.isArray(data) ? data : [];
      } catch (e2) {
        console.error('[GlobalBoard] fallback query failed', e2?.message||e2);
        return [];
      }
    }
  }

  async function submitGlobalScore(name, score){
    if(!sb) return { ok:false };
    const n = sanitizeName(name)||'Player';
    const s = Math.max(0, score|0);
    try {
      const { error } = await sb.from('scores').insert({ name: n, score: s });
      if(error) throw error;
      return { ok:true };
    } catch(e){
      console.error('[GlobalSubmit] failed', e);
      return { ok:false, error:e };
    }
  }

  const NAME_MAX = 12;
  const sanitizeName = (s)=>{
    return (s||'').toString().replace(/\s+/g,' ').trim().slice(0, NAME_MAX);
  };

  function submitScore(name, score){
    const n = sanitizeName(name)||'Player';
    const entry = { name: n, score: score|0, t: Date.now() };
    const board = Storage.getBoard();
    board.push(entry);
    board.sort((a,b)=> b.score - a.score || a.t - b.t);
    const TOP = 10;
    const trimmed = board.slice(0, TOP);
    Storage.setBoard(trimmed);
    const rank = trimmed.findIndex(e => e === entry) + 1;
    return { rank: rank>0?rank:null, board: trimmed };
  }

  function renderBoard(listEl, board){
    if(!listEl) return;
    listEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    board.forEach((e,i)=>{
      const li = document.createElement('li');
      const name = (e.name||'Player').toString().replace(/</g,'&lt;');
      const score = (e.score|0);
      li.innerHTML = `<span class="pos">${i+1}</span> <span class="nm">${name}</span> <span class="sc">${score}</span>`;
      frag.appendChild(li);
    });
    listEl.appendChild(frag);
  }

  class Pool { constructor(create){ this.create=create; this.items=[]; } get(){ return this.items.pop()||this.create(); } put(o){ this.items.push(o); } }
  class Entity { constructor(){ this.x=0; this.y=0; this.w=24; this.h=24; this.vx=0; this.vy=0; this.alive=false; } rect(){ return {x:this.x,y:this.y,w:this.w,h:this.h}; } }
  class Poop extends Entity {
    constructor(){ super(); this.kind='poop'; this.rot=0; this.speed=120; this.tone=0; }
    spawn(x,y,speed){ this.x=x; this.y=y; this.speed=speed; this.vx=rand(-40,40); this.vy=this.speed; this.alive=true; this.w=this.h=rand(20,36); this.tone=rand(-0.06,0.08); }
    step(dt){ this.vy += 220*dt*0.2; this.x += this.vx*dt; this.y += this.vy*dt; this.rot += this.vx*dt*0.02; }
    draw(g){
      const s = Math.max(this.w, this.h);
      g.save();
      const sq = clamp(this.vy/520, 0, 0.22);
      g.translate(this.x+this.w/2, this.y+this.h/2);
      g.rotate(this.rot);
      g.scale(1+sq*0.08, 1-sq*0.12);
      g.globalAlpha = 0.18; g.fillStyle = '#000'; g.beginPath(); g.ellipse(0, s*0.38, s*0.46, s*0.16, 0, 0, Math.PI*2); g.fill(); g.globalAlpha = 1;
      const top = `hsl(${28+this.tone*30}, 55%, ${48+this.tone*10}%)`;
      const mid = `hsl(${26+this.tone*30}, 58%, ${36+this.tone*6}%)`;
      const bot = `hsl(${24+this.tone*30}, 62%, ${22+this.tone*4}%)`;
      const grad = g.createLinearGradient(0, -s*0.45, 0, s*0.42);
      grad.addColorStop(0, top); grad.addColorStop(0.5, mid); grad.addColorStop(1, bot);
      g.fillStyle = grad;
      const drawLayer = (cx, cy, rx, ry) => { g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2); g.fill(); };
      drawLayer(0, s*0.14, s*0.44, s*0.22);
      drawLayer(0, -s*0.02, s*0.32, s*0.18);
      drawLayer(0, -s*0.18, s*0.22, s*0.14);
      g.beginPath(); g.arc(0, -s*0.30, s*0.10, 0, Math.PI*2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = Math.max(1, s*0.018);
      const rim = (cx, cy, rx, ry)=>{ g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, Math.PI*0.05, Math.PI*0.95); g.stroke(); };
      rim(0, s*0.02, s*0.34, s*0.19); rim(0, -s*0.14, s*0.24, s*0.15);
      g.globalAlpha = 0.22; g.fillStyle = '#fff'; g.beginPath(); g.ellipse(-s*0.10, -s*0.20, s*0.08, s*0.04, -0.6, 0, Math.PI*2); g.fill(); g.globalAlpha = 0.12; g.beginPath(); g.ellipse(-s*0.02, -s*0.05, s*0.12, s*0.06, -0.5, 0, Math.PI*2); g.fill(); g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.10)'; for(let i=0;i<3;i++){ const ax = rand(-s*0.18, s*0.18), ay = rand(-s*0.08, s*0.18); g.beginPath(); g.arc(ax, ay, s*0.012, 0, Math.PI*2); g.fill(); }
      g.restore();
    }
  }

  class PowerUp extends Entity { constructor(){ super(); this.kind='power'; this.type='shield'; } spawn(x,y,type){ this.x=x; this.y=y; this.type=type; this.vx=0; this.vy=90; this.alive=true; this.w=this.h=20; } step(dt){ this.y += this.vy*dt; } draw(g){ g.save(); g.translate(this.x+this.w/2, this.y+this.h/2); if(this.type==='shield'){ g.strokeStyle='#22c55e'; g.lineWidth=3; g.beginPath(); g.arc(0,0,this.w/2,0,Math.PI*2); g.stroke(); } else { g.fillStyle='#38bdf8'; g.fillRect(-this.w/2,-this.h/2,this.w,this.h); } g.restore(); } }
  class Player extends Entity { constructor(){ super(); this.w=34; this.h=18; this.speed=240; this.shield=0; } draw(g){ g.fillStyle=this.shield>0?'#22c55e':'#e5e7eb'; g.fillRect(this.x, this.y, this.w, this.h); if(this.shield>0){ g.strokeStyle='#22c55e'; g.lineWidth=2; g.strokeRect(this.x-4,this.y-4,this.w+8,this.h+8); } } }
  const hit=(a,b)=>!(a.x+a.w<b.x||b.x+b.w<a.x||a.y+a.h<b.y||b.y+b.h<a.y);

  class Game{
    constructor(canvas){
      this.c=canvas; this.g=canvas.getContext('2d'); this.w=canvas.width; this.h=canvas.height;
      this.player=new Player(); this.player.x=this.w/2-17; this.player.y=this.h-56;
      this.poopPool=new Pool(()=>new Poop()); this.powerPool=new Pool(()=>new PowerUp());
      this.poops=[]; this.powers=[];
      this.score=0; this.best=Storage.getBest();
      this.spawnTimer=0; this.spawnInterval=0.9; this.level=1;
      this.alive=false; this.paused=false; this.slowmo=0; this.playerName = Storage.getName();
      this.input={left:false,right:false,dragX:null};
      this.last=now(); this.onFrame=this.onFrame.bind(this);
      this.bindInput(); this.bindVisibility(); this.updateHUD();
      renderBoard(document.getElementById('leaderboard-list'), Storage.getBoard());
      const nameInput = document.getElementById('player-name'); if(nameInput){ nameInput.value = this.playerName; }
      this.loadGlobalBoards();
      this.lastTier = 0;
      const startEl = document.getElementById('start-screen');
      const overEl = document.getElementById('gameover-screen');
      if(startEl?.classList.contains('visible') || overEl?.classList.contains('visible')) this.c.style.pointerEvents = 'none';
    }

    getTier(){ return Math.floor((this.score|0) / 50); }
    getDifficulty(){
      const tier = this.getTier();
      // 기본 난이도 곡선(점수에 따라 점점 빨라지고 자주 떨어짐)
      const b = { interval: 0.9, speed: 140, duo: 0.16, power: 0.14 };
      const r = { interval: 0.82, speed: 1.16, duo: 1.22, power: 0.9 };
      const c = { intervalMin: 0.08, duoMax: 0.7, powerMin: 0.03 };

      let interval = Math.max(c.intervalMin, b.interval * Math.pow(r.interval, tier));
      let speed    = b.speed * Math.pow(r.speed, tier);
      let duoProb  = Math.min(c.duoMax, b.duo * Math.pow(r.duo, tier));
      let pwrProb  = Math.max(c.powerMin, b.power * Math.pow(r.power, tier));

      // 50점(1티어) 이상부터는 체감되게 한 번 더 확 올려준다.
      if(tier >= 1){
        interval *= 0.7;          // 더 자주 떨어지게
        speed *= 1.35;            // 낙하 속도 크게 증가
        duoProb = Math.min(c.duoMax, duoProb + 0.18); // 동시에 여러 개 나올 확률 증가
      }

      return { tier, interval, speed, duoProb, pwrProb };
    }

    async loadGlobalBoards(){
      const data = await fetchGlobalTop10();
      renderBoard(document.getElementById('leaderboard-global'), data);
      renderBoard(document.getElementById('leaderboard-global-final'), data);
    }

    bindInput(){
      window.addEventListener('keydown',e=>{ if(e.key==='ArrowLeft'||e.key==='a'||e.key==='A') this.input.left=true; if(e.key==='ArrowRight'||e.key==='d'||e.key==='D') this.input.right=true; if(e.key==='p'||e.key==='P') this.togglePause(); });
      window.addEventListener('keyup',e=>{ if(e.key==='ArrowLeft'||e.key==='a'||e.key==='A') this.input.left=false; if(e.key==='ArrowRight'||e.key==='d'||e.key==='D') this.input.right=false; });
      const left=document.getElementById('btn-left'); const right=document.getElementById('btn-right');
      const set=(b,v)=>{ if(!b) return; b.onpointerdown=()=>{ this.input[v]=true; Audio.ensure(); }; b.onpointerup=b.onpointercancel=()=>this.input[v]=false; };
      set(left,'left'); set(right,'right');
      this.c.addEventListener('pointerdown',e=>{ this.input.dragX=e.clientX; Audio.ensure(); Audio.resume(); });
      window.addEventListener('pointermove',e=>{ if(this.input.dragX!=null){ const dx=e.clientX-this.input.dragX; this.player.x=clamp(this.player.x+dx*0.8, 0, this.w-this.player.w); this.input.dragX=e.clientX; }});
      window.addEventListener('pointerup',()=>{ this.input.dragX=null; });

      const startBtn = document.getElementById('btn-start');
      const restartBtn = document.getElementById('btn-restart');
      const pauseBtn = document.getElementById('btn-pause');
      const resumeBtn = document.getElementById('btn-resume');
      const soundBtn = document.getElementById('btn-sound');
      const nameInput = document.getElementById('player-name');

      const doStart = ()=>{
        const name = sanitizeName(nameInput?.value||'');
        if(!name){ nameInput?.focus(); nameInput?.classList.add('error'); setTimeout(()=>nameInput?.classList.remove('error'), 600); return; }
        this.playerName = name; Storage.setName(name);
        this.start();
      };
      if(startBtn) startBtn.onclick=doStart;
      if(restartBtn) restartBtn.onclick=doStart;
      if(pauseBtn) pauseBtn.onclick=()=>this.togglePause();
      if(resumeBtn) resumeBtn.onclick=()=>this.togglePause(false);
      if(soundBtn) soundBtn.onclick=()=>{ const on=Audio.toggle(); soundBtn.textContent=on?'🔊':'🔇'; };
    }

    bindVisibility(){ document.addEventListener('visibilitychange',()=>{ if(document.hidden) this.setPause(true); }); }
    setPause(v){ this.paused=v; document.getElementById('pause-screen')?.classList.toggle('visible', this.alive && this.paused); }
    togglePause(force){ if(!this.alive) return; this.setPause(force==null? !this.paused : !!force); }
    updateHUD(){ document.getElementById('score').textContent=this.score|0; document.getElementById('best').textContent=this.best|0; }

    start(){
      this.reset(); this.alive=true;
      document.getElementById('start-screen')?.classList.remove('visible');
      document.getElementById('gameover-screen')?.classList.remove('visible');
      this.c.style.pointerEvents = 'auto';
      requestAnimationFrame(this.onFrame);
    }

    async gameover(){
      this.alive=false;
      document.getElementById('final-score').textContent=this.score|0;
      if(this.score>this.best){ this.best=this.score; Storage.setBest(this.best); this.updateHUD(); }
      const result = submitScore(this.playerName||'Player', this.score|0);
      const rankLine = document.getElementById('rank-line');
      rankLine.textContent = result.rank? `${this.playerName}님 랭킹 ${result.rank}위!` : `${this.playerName}님의 점수가 기록되었습니다.`;
      renderBoard(document.getElementById('leaderboard-list-final'), result.board);
      renderBoard(document.getElementById('leaderboard-list'), result.board);
      await submitGlobalScore(this.playerName||'Player', this.score|0);
      await this.loadGlobalBoards();
      document.getElementById('gameover-screen')?.classList.add('visible');
      this.c.style.pointerEvents = 'none';
    }

    reset(){
      this.score=0; this.level=1; this.spawnInterval=0.9; this.spawnTimer=0; this.slowmo=0;
      this.player.x=this.w/2-17; this.player.y=this.h-56; this.player.shield=0;
      for(const p of this.poops) this.poopPool.put(p); this.poops.length=0;
      for(const p of this.powers) this.powerPool.put(p); this.powers.length=0;
      this.last=now(); this.paused=false; this.updateHUD();
      this.lastTier = 0;
    }

    spawn(){
      const d = this.getDifficulty();
      this.spawnInterval = d.interval;
      const count = Math.random() < d.duoProb ? 2 : 1;
      for(let i=0;i<count;i++){
        const p=this.poopPool.get();
        p.spawn(rand(0,this.w-24), -rand(24,140), d.speed*rand(0.9,1.25));
        this.poops.push(p);
      }
      if(Math.random() < d.pwrProb){
        const t=Math.random()<0.6?'shield':'slow';
        const pu=this.powerPool.get();
        pu.spawn(rand(0,this.w-20), -40, t);
        this.powers.push(pu);
      }
      if(d.tier>this.lastTier){ this.lastTier=d.tier; Audio.beep(880,0.06,'triangle',0.12); }
    }

    step(dt){
      const move=(this.input.left?-1:0)+(this.input.right?1:0);
      const speedMod = (this.slowmo>0?0.6:1);
      this.player.x=clamp(this.player.x+move*this.player.speed*dt*speedMod,0,this.w-this.player.w);
      if(this.slowmo>0) this.slowmo -= dt;

      this.spawnTimer -= dt;
      if(this.spawnTimer<=0){ this.spawn(); this.spawnTimer = this.spawnInterval; }

      const floor=this.h;
      for(let i=this.poops.length-1;i>=0;i--){
        const p=this.poops[i];
        p.step(dt*(this.slowmo>0?0.5:1));
        if(p.y>floor+60){ this.poops.splice(i,1); this.poopPool.put(p); this.score += 5; this.updateHUD(); }
      }
      for(let i=this.powers.length-1;i>=0;i--){
        const p=this.powers[i];
        p.step(dt);
        if(p.y>floor+40){ this.powers.splice(i,1); this.powerPool.put(p); }
      }

      const pr=this.player.rect();
      for(let i=this.powers.length-1;i>=0;i--){
        const pu=this.powers[i];
        if(hit(pr, pu.rect())){ this.powers.splice(i,1); this.powerPool.put(pu); if(pu.type==='shield'){ this.player.shield = Math.min(3, this.player.shield+1); Audio.beep(700,0.08,'triangle',0.12); } else { this.slowmo=2.0; Audio.beep(520,0.12,'sine',0.12); } }
      }
      for(let i=this.poops.length-1;i>=0;i--){
        const p=this.poops[i];
        if(hit(pr, p.rect())){ if(this.player.shield>0){ this.player.shield--; this.poops.splice(i,1); this.poopPool.put(p); Audio.beep(300,0.06,'square',0.12); } else { this.gameover(); Audio.beep(120,0.25,'sawtooth',0.14); return; } }
      }
    }

    draw(){
      const g=this.g; g.clearRect(0,0,this.w,this.h);
      g.strokeStyle='rgba(255,255,255,0.05)';
      for(let y=0;y<this.h;y+=40){ g.beginPath(); g.moveTo(0,y); g.lineTo(this.w,y); g.stroke(); }
      for(const p of this.poops) p.draw(g);
      for(const p of this.powers) p.draw(g);
      this.player.draw(g);
    }

    onFrame(t){
      if(!this.alive) return;
      if(this.paused){ this.last=t; requestAnimationFrame(this.onFrame); return; }
      const dt = Math.min((t-this.last)/1000, 0.1);
      this.last = t;
      this.step(dt);
      this.draw();
      requestAnimationFrame(this.onFrame);
    }
  }

  const canvas = document.getElementById('game');
  if(canvas) new Game(canvas);
})();
