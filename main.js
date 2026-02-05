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
    const rank = trimmed.findIndex(e => e === entry) + 1; // 1-based if remained in top
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
  class Poop extends Entity { constructor(){ super(); this.kind='poop'; this.rot=0; this.speed=120; } spawn(x,y,speed){ this.x=x; this.y=y; this.speed=speed; this.vx=rand(-40,40); this.vy=this.speed; this.alive=true; this.w=this.h=rand(18,34); } step(dt){ this.vy += 220*dt*0.2; this.x += this.vx*dt; this.y += this.vy*dt; this.rot += this.vx*dt*0.02; } draw(g){ g.save(); g.translate(this.x+this.w/2, this.y+this.h/2); g.rotate(this.rot); g.fillStyle='#8b5a2b'; g.beginPath(); g.arc(0,0,this.w/2,0,Math.PI*2); g.fill(); g.fillStyle='#5b3a1b'; g.fillRect(-this.w*0.3, -this.h*0.1, this.w*0.6, this.h*0.6); g.restore(); } }
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
      this.spawnTimer=0; this.spawnInterval=0.9; this.level=1; // level is difficulty gauge
      this.alive=false; this.paused=false; this.slowmo=0; this.playerName = Storage.getName();
      this.input={left:false,right:false,dragX:null};
      this.last=now(); this.onFrame=this.onFrame.bind(this);
      this.bindInput(); this.bindVisibility(); this.updateHUD();
      // Initial renders
      renderBoard(document.getElementById('leaderboard-list'), Storage.getBoard());
      const nameInput = document.getElementById('player-name');
      if(nameInput){ nameInput.value = this.playerName; }
      this.loadGlobalBoards();
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

      if(startBtn) startBtn.onclick=()=>{
        const name = sanitizeName(nameInput?.value||'');
        if(!name){ nameInput?.focus(); nameInput?.classList.add('error'); setTimeout(()=>nameInput?.classList.remove('error'), 600); return; }
        this.playerName = name; Storage.setName(name);
        this.start();
      };
      if(restartBtn) restartBtn.onclick=()=>this.start();
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
      // Global submit + refresh (errors are logged in console)
      await submitGlobalScore(this.playerName||'Player', this.score|0);
      await this.loadGlobalBoards();
      document.getElementById('gameover-screen')?.classList.add('visible');
    }

    reset(){
      this.score=0; this.level=1; this.spawnInterval=0.9; this.spawnTimer=0; this.slowmo=0;
      this.player.x=this.w/2-17; this.player.y=this.h-56; this.player.shield=0;
      for(const p of this.poops) this.poopPool.put(p); this.poops.length=0;
      for(const p of this.powers) this.powerPool.put(p); this.powers.length=0;
      this.last=now(); this.paused=false; this.updateHUD();
    }

    // Progressive difficulty
    spawn(){
      this.level += 0.02;
      const spawnMin = 0.16;
      const spawnBase = 0.9;
      this.spawnInterval = Math.max(spawnMin, spawnBase - this.level*0.055);
      const speed = 120 + this.level*22;
      const duoProb = Math.min(0.35, 0.15 + this.level*0.03);
      const count = Math.random()<duoProb?2:1;
      for(let i=0;i<count;i++){
        const p=this.poopPool.get();
        p.spawn(rand(0,this.w-24), -rand(24,140), speed*rand(0.9,1.3));
        this.poops.push(p);
      }
      if(Math.random()<Math.max(0.06, 0.14 - this.level*0.01)){
        const t=Math.random()<0.6?'shield':'slow';
        const pu=this.powerPool.get();
        pu.spawn(rand(0,this.w-20), -40, t);
        this.powers.push(pu);
      }
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
        if(p.y>floor+60){ this.poops.splice(i,1); this.poopPool.put(p); this.score += 1; this.updateHUD(); }
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
      g.strokeStyle='rgba(255,255,255,0.05)'; g.lineWidth=1;
      for(let y=0;y<this.h;y+=24){ g.beginPath(); g.moveTo(0,y); g.lineTo(this.w,y); g.stroke(); }
      for(const p of this.poops) p.draw(g);
      for(const p of this.powers) p.draw(g);
      this.player.draw(g);
      if(this.slowmo>0){ g.fillStyle='rgba(56,189,248,0.08)'; g.fillRect(0,0,this.w,this.h); }
    }

    onFrame(){ if(!this.alive) return; const t=now(); let dt=(t-this.last)/1000; this.last=t; dt=Math.min(dt,0.033); if(!this.paused){ this.step(dt); this.draw(); } requestAnimationFrame(this.onFrame); }
  }

  const canvas=document.getElementById('game');
  const game=new Game(canvas);
  window.__game=game;
})();
