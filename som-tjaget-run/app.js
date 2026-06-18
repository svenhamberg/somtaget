  // ============================================================
  //  KONFIGURATION
  //  Arket är "brett": en kolumn per spelare, en rad per match, och cellen
  //  innehåller spelarens löpande totalpoäng. Sidan tar det värde i varje
  //  spelares kolumn som varit NÄRMAST tjåget (20) genom hela historiken –
  //  bästa läget låses alltså in. Metadata-kolumner (Date, Time, Home/Away
  //  team …) hoppas över automatiskt.
  //  Byt fliken genom att ändra gid i URL:en. Lämnas csvUrl tom visas demodata.
  // ============================================================
  const CONFIG = {
    csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSjpI8qiPxM9CFpazKbHFIbjJA9S-re_PrlwMwdo7wFArAVgshedPHL63WYEY-RPd_nceB_9d-so93C/pub?gid=610468794&single=true&output=csv",            // <-- publicerad CSV-URL
    fetchTimeoutMs: 12000, // avbryt en hängande hämtning så knappen hamnar i "Försök igen" istället för att snurra för evigt
    target: 20,            // "ett tjåg"
    minStep: 1,            // ~minsta poäng en match ger; inom så här nära tjåget kan man inte längre finjustera sitt läge (mjuk regel)
    updatedMarker: "LAST_UPDATED=",   // cell-prefix som Apps Script skriver i arket (LAST_UPDATED=<ISO-tid>) → tiden i statuspillret

    // Kolumnrubriker som INTE är spelare (gemener, delmatchning):
    metaHeaders:   ["date","datum","time","tid","home","hemma","away","borta","team","match","resultat","plats","arena","grupp","group"],
    // Fallback om arket istället har en namn-kolumn + en poäng-kolumn:
    nameHeaders:   ["namn","spelare","name","deltagare","player"],
    pointsHeaders: ["poäng","poang","points","total","totalt","summa"],
    // Visningsnamn per arkkolumn (avatarfilen styrs fortf. av kolumnnamnet, t.ex. calle.png):
    displayNames: {
      "Marcus":"Lilla rycket",
      "Mats":"Julmast",
      "Andreas":"Risky Papa",
      "David":"Direktörley",
      "Ludde":"Lilla kryǯǯet@rt.ru",
      "Sven":"Alisson.",
      "Calle":"Polen",
      "Adrian":"Rektor Dajm",
      "Bjorn":"Lennart Sommer",
      "Erik":"Paul Kurakao-Advokaat"
    }
  };

  // Exempeldata (visas när ingen CSV-URL är angiven)
  const DEMO = [
    {name:"Ludde",   points:19.9},
    {name:"Sven",    points:20.2},
    {name:"Anna",    points:17.5},
    {name:"Mats",    points:23},
    {name:"Andreas", points:14},
    {name:"Adrian",  points:26.5}
  ];

  const $board  = document.getElementById("board");
  const $status = document.getElementById("status");
  const $statusText = document.getElementById("statusText");
  const $banner = document.getElementById("banner");
  const $gate = document.getElementById("gate");
  const $startBtn = document.getElementById("startBtn");
  const $startLabel = document.getElementById("startLabel");
  const $startSpinner = document.getElementById("startSpinner");
  const $gateHint = document.getElementById("gateHint");
  const $liveDot = $status.querySelector(".live-dot");
  const $badgeSpin = $status.querySelector(".badge-spin");
  const $badgeRefresh = $status.querySelector(".badge-refresh");
  const $statusWarn = document.getElementById("statusWarn");
  let lastGood = null;
  let refreshing = false;       // en manuell uppdatering pågår (ignorera nya klick under tiden)
  let lastDemo = false;
  let lastUpdated = null;        // tidsstämpel från arkets LAST_UPDATED-cell (null = okänd)
  let revealed = false;
  let buildGen = 0;             // räknare: varje render() ogiltigförklarar ett pågående bygg-animations-bygge

  // ---------- helpers ----------
  function fmt(n){
    return Number(n).toLocaleString("sv-SE",{maximumFractionDigits:2});
  }
  function parseNum(v){
    if(v==null) return NaN;
    let s=String(v).trim();
    if(!s) return NaN;
    s=s.replace(/\s/g,"");
    if(s.includes(",")&&s.includes(".")) s=s.replace(/,/g,"");   // 1,234.5 -> 1234.5
    else if(s.includes(",")) s=s.replace(",",".");               // 19,9 -> 19.9
    return parseFloat(s);
  }
  function parseCSV(text){
    const rows=[]; let row=[]; let field=""; let inQ=false; let i=0;
    text=text.replace(/\r\n/g,"\n").replace(/\r/g,"\n");
    while(i<text.length){
      const c=text[i];
      if(inQ){
        if(c==='"'){ if(text[i+1]==='"'){field+='"';i+=2;continue;} inQ=false;i++;continue; }
        field+=c;i++;continue;
      }
      if(c==='"'){inQ=true;i++;continue;}
      if(c===','){row.push(field);field="";i++;continue;}
      if(c==='\n'){row.push(field);rows.push(row);row=[];field="";i++;continue;}
      field+=c;i++;
    }
    row.push(field);rows.push(row);
    return rows.filter(r=>r.some(x=>x.trim()!==""));
  }
  function findCol(headers,keys){
    for(let i=0;i<headers.length;i++){
      const h=String(headers[i]||"").toLowerCase().trim();
      if(keys.some(k=>h.includes(k))) return i;
    }
    return -1;
  }

  // ---------- data ----------
  // Plockar ut [{name, points}] ur arket. Stödjer två upplägg:
  //  • Brett (Som Tjåget-arket): spelare = kolumner. Poäng = värdet som varit
  //    NÄRMAST tjåget genom historiken (bästa läget låses). Metadata-kolumner
  //    (Date, Time …) hoppas över.
  //  • Högt: en namn-kolumn + en poäng-kolumn, en rad per spelare.
  function extractPlayers(rows){
    const headers = rows[0].map(h=>String(h||"").trim());
    const mk=(CONFIG.updatedMarker||"LAST_UPDATED=").toLowerCase();
    const isMeta = h => { const l=h.toLowerCase(); return l==="" || l.indexOf(mk)===0 || CONFIG.metaHeaders.some(k=>l.includes(k)); };

    // Högt upplägg: explicit namn- + poängkolumn
    const ni=findCol(headers,CONFIG.nameHeaders), pi=findCol(headers,CONFIG.pointsHeaders);
    if(ni>=0 && pi>=0 && ni!==pi){
      const out=[];
      for(let r=1;r<rows.length;r++){
        const name=String(rows[r][ni]||"").trim();
        const pts=parseNum(rows[r][pi]);
        if(name && !isNaN(pts)) out.push({name,points:pts,locked:false,awaySpeed:0});
      }
      if(out.length) return out;
    }

    // Brett upplägg: varje icke-metadata-kolumn är en spelare.
    // Poäng = det värde i historiken som var NÄRMAST tjåget (lägsta |20 − värde|).
    // Eftersom totalen bara växer låses en spelares bästa läge in när de skjuter över 20.
    // locked = aktuella (sista) totalen ligger längre från tjåget än bästa läget,
    // dvs spelaren har passerat sitt närmaste läge och kan inte förbättra sig.
    const out=[];
    for(let c=0;c<headers.length;c++){
      if(isMeta(headers[c])) continue;
      // Kollapsa platåer (samma total upprepas tills nästa poäng) till distinkta steg,
      // annars blir "steget efter närmaste läget" samma värde och farten bort blir 0.
      const moves=[];
      for(let r=1;r<rows.length;r++){
        const v=parseNum(rows[r][c]);
        if(isNaN(v)) continue;
        if(!moves.length || moves[moves.length-1]!==v) moves.push(v);
      }
      if(!moves.length) continue;
      let ci=0;                                       // index för värdet närmast tjåget
      for(let i=1;i<moves.length;i++) if(Math.abs(CONFIG.target-moves[i]) < Math.abs(CONFIG.target-moves[ci])) ci=i;
      const bestV=moves[ci], bestD=Math.abs(CONFIG.target-bestV);
      const last=moves[moves.length-1];
      const locked = Math.abs(CONFIG.target-last) > bestD + 1e-9;
      // tiebreaker "snabbast bort från tjåg": avståndsökningen i steget direkt efter
      // närmaste läget. 0 = har inte lämnat tjåget än (eller rör sig i lås med andra).
      const awaySpeed = (ci+1 < moves.length) ? (Math.abs(CONFIG.target-moves[ci+1]) - bestD) : 0;
      out.push({name:headers[c], points:bestV, locked, awaySpeed});
    }
    return out;
  }

  // Läser tidsstämpeln som ett Apps Script skriver i arket (cellen "LAST_UPDATED=<ISO-tid>").
  // Då speglar pillret när DATAN senast ändrades – inte när sidan råkade hämta den. Saknas
  // cellen returneras null och pillret blir bara "Uppdatera ställningen" (ingen påhittad tid).
  function extractUpdatedAt(rows){
    const marker=CONFIG.updatedMarker||"LAST_UPDATED=";
    for(const row of rows) for(const cell of row){
      const s=String(cell==null?"":cell);
      const i=s.indexOf(marker);
      if(i>=0){
        const d=new Date(s.slice(i+marker.length).trim());
        if(!isNaN(d.getTime())) return d;
      }
    }
    return null;
  }

  async function fetchData(){
    if(!CONFIG.csvUrl){ return {players:DEMO.slice(), demo:true, updatedAt:null}; }
    const sep = CONFIG.csvUrl.includes("?") ? "&" : "?";
    const url = CONFIG.csvUrl + sep + "cb=" + Date.now();
    // Timeout: en stillastående hämtning (flaky mobilnät) får aldrig hänga sig – abortera
    // efter fetchTimeoutMs så fetch() kastar och knappen faller ner i "Försök igen"-läget.
    const ctrl = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), CONFIG.fetchTimeoutMs||12000);
    let res;
    try{ res = await fetch(url,{cache:"no-store",signal:ctrl.signal}); }
    finally{ clearTimeout(timer); }
    if(!res.ok) throw new Error("HTTP "+res.status);
    const rows = parseCSV(await res.text());
    if(rows.length<2) throw new Error("Arket verkar tomt");
    const players = extractPlayers(rows);
    if(!players.length) throw new Error("Hittade inga spelare");
    return {players,demo:false,updatedAt:extractUpdatedAt(rows)};
  }

  // ---------- render ----------
  const COUNT_MS=1200;     // hur länge varje spelares siffra + lok-inkörning tar
  const LEADER_COUNT_MS=2200; // ledaren får en långsammare, mer dramatisk inkörning + uppräkning
  const GAP_MS=500;        // liten paus mellan spelare i den sekventiella kön
  const LEADER_PAUSE_MS=2800; // dramatisk paus (med pulserande skelett) precis innan ledaren/ledarna kröns
  const reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const medalClass = r => r===1?"gold":r===2?"silver":r===3?"bronze":"";
  // filnamn för avatar: gemener, utan diakritik/specialtecken (Björn -> bjorn)
  const slug = s => String(s).trim().toLowerCase().replace(/å|ä/g,"a").replace(/ö/g,"o").replace(/[^a-z0-9]/g,"");
  // krymp namnets fontstorlek tills det ryms på en rad i sin kolumn (inget radbryt/avhugg)
  function fitName(el){
    if(!el) return;
    el.style.fontSize="";
    let guard=24;
    while(el.scrollWidth > el.clientWidth+1 && guard-- > 0){
      const cur=parseFloat(getComputedStyle(el).fontSize);
      if(cur<=11) break;
      el.style.fontSize=(cur-0.75)+"px";
    }
  }
  // platshållarkort som pulserar överst under den dramatiska pausen, där ledaren strax landar
  function makeSkeletonEl(){
    const li=document.createElement("li");
    li.className="row leader skeleton";
    li.setAttribute("aria-hidden","true");
    li.innerHTML=`
      <span class="sk-block sk-avatar"></span>
      <div class="who">
        <div class="sk-names">
          <span class="sk-block sk-name"></span>
          <span class="sk-block sk-pill"></span>
        </div>
        <div class="rail"><span class="sk-block sk-railline"></span></div>
      </div>
      <span class="sk-block sk-pts"></span>`;
    return li;
  }

  // gemensam rankning: score, delad rank, ledarantal, "settled" och tiebreak-flaggor.
  // Används av både bygg-render() och patch() så logiken aldrig glider isär.
  function rankPlayers(players){
    // score = avstånd till tjåget; minst vinner
    const ranked = players
      .map(p=>({...p, score:Math.abs(CONFIG.target-p.points), awaySpeed:p.awaySpeed||0}))
      .sort((a,b)=> a.score-b.score || b.awaySpeed-a.awaySpeed);   // närmast vinner; lika nära → snabbast bort vinner
    // dela rank ENBART vid genuint oavgjort: samma avstånd OCH samma fart bort från tjåget
    const sameRank=(a,b)=> Math.abs(a.score-b.score)<1e-9 && Math.abs(a.awaySpeed-b.awaySpeed)<1e-9;
    let rank=0;
    ranked.forEach((p,idx)=>{ if(idx===0 || !sameRank(p,ranked[idx-1])) rank=idx+1; p.rank=rank; });
    // "terminal" = kan inte längre sluta etta → utslagen. En spelares score (avstånd till tjåget)
    // kan bara krympa, aldrig växa. Den som är INOM en rundas minsta kliv från tjåget (~1 p =
    // CONFIG.minStep) sitter fast: nästa match skjuter garanterat förbi det egna läget, så scoren
    // är i praktiken låst. Är man då inte etta ligger någon redan närmare → ute. (locked = har
    // redan passerat tjåget och är låst på samma sätt.)
    ranked.forEach(p=>{ p.terminal = (p.locked || p.score < CONFIG.minStep) && p.rank!==1; });
    const leaderCount=ranked.filter(p=>p.rank===1).length;
    // ledaren krönt (🏆) först när alla andra är utslagna (terminal) – inte tidigare.
    const settled=ranked.every(p=>p.rank===1 || p.terminal);
    // tiebreak-hint: när flera spelare delar exakt samma score avgör awaySpeed ("snabbast bort
    // från tjåg"). Märk dem så korten visar exit-värdet (+x 💨🚂) – men bara när farten faktiskt
    // skiljer dem åt (annars är de genuint oavgjorda och delar redan rank).
    const byScore={};
    ranked.forEach(p=>{ const k=p.score.toFixed(6); (byScore[k]||(byScore[k]=[])).push(p); });
    Object.values(byScore).forEach(group=>{
      if(group.length<2) return;
      const speeds=group.map(p=>p.awaySpeed);
      if(Math.max(...speeds)-Math.min(...speeds) < 1e-9) return;   // ingen fart skiljer dem
      group.forEach(p=>{ p.tieBreak=true; });
    });
    return {ranked, leaderCount, settled};
  }

  // innehållet i ett kort (identiskt för bygg-render och patch). numText = poängtexten som visas.
  // delade ledare: kortet med idx===leaderCount-1 får titeln "🏆 Bäst i världen", övriga "Också".
  function rowInnerHTML(p, idx, leaderCount, settled, numText){
    const display=(CONFIG.displayNames&&CONFIG.displayNames[p.name])||p.name;
    let crown="";
    if(p.rank===1){
      const first = idx===leaderCount-1;
      const txt = settled
        ? (first ? "🏆 Bäst i världen" : "Också bäst i världen")
        : (first ? "Potentiellt bäst i världen" : "Potentiellt också bäst i världen");
      crown='<span class="pill">'+txt+'</span>';
    }
    const lock = p.locked ? '<span class="lock">🏁 Passerat tjåg</span>' : "";
    return `
        <div class="avatar">
          <span class="initial">${esc(display.trim().charAt(0).toUpperCase())}</span>
          <img class="face" src="images/${slug(p.name)}.png" alt="" loading="lazy" onerror="this.remove()">
          <span class="rank-badge ${medalClass(p.rank)}">${p.rank}</span>
        </div>
        <div class="who">
          <div class="name-row">
            <span class="name">${esc(display)}</span>
            ${crown}${lock}
          </div>
          <div class="rail">
            <span class="rail-line"></span>
            ${p.locked?'':'<span class="station"></span>'}
            <span class="train" role="img" aria-label="lok">🚂</span>
            ${p.locked?'<span class="buffer"></span>':''}
          </div>
        </div>
        <div class="metric">
          <div class="pts"><span class="num">${numText}</span></div>
          <div class="dist">${fmt(p.score)} från Tjåg</div>
          ${p.tieBreak?`<div class="exit" title="Lämnade tjåget med +${fmt(p.awaySpeed)} poäng matchen efter sitt bästa läge – avgör vid lika score">${p.awaySpeed>0?'+':''}${fmt(p.awaySpeed)}<span class="depart"><span class="puff">💨</span><span class="loco">🚂</span></span></div>`:''}
        </div>`;
  }

  // placera lok (+ stoppbock/rälsklipp för låsta spelare) på en given position i %
  function placeTrain(li, left){
    const train=li.querySelector(".train");
    const buffer=li.querySelector(".buffer");
    if(train) train.style.left=left+"%";
    if(buffer){
      buffer.style.left=left+"%";
      const rl=li.querySelector(".rail-line"); if(rl) rl.style.right="calc("+(100-left)+"% - 11px)";
    }
  }

  function render(players, animate){
    const myGen=++buildGen;     // ogiltigförklara ev. pågående bygge (t.ex. ett som frusit i bakgrundsflik)
    const {ranked, leaderCount, settled}=rankPlayers(players);

    if(!ranked.length){
      $board.innerHTML='<li class="empty">Inga spelare ännu. Snart drar tjåget igång.</li>';
      return;
    }

    // domän centrerad på tjåget; lokens läge mappas till 4–96 % så det syns
    const maxAbs=Math.max(4, ...ranked.map(p=>p.score));
    const lo=CONFIG.target-maxAbs, span=maxAbs*2;
    const posOf = pts => 4 + Math.max(0,Math.min(1,(pts-lo)/span))*92;

    $board.innerHTML="";
    const built=[];
    ranked.forEach((p,idx)=>{
      const left=posOf(p.points);
      const li=document.createElement("li");
      li.dataset.name=p.name;                          // stabil identitet → patch() matchar kort vid uppdatering
      // vid bygg-animation: rendera normalt och flippa till "terminal" först när sista kortet landat (se runNext)
      li.className="row"+(p.rank===1?" leader":"")+(!animate&&p.terminal?" terminal":"");
      li.innerHTML=rowInnerHTML(p, idx, leaderCount, settled, animate?fmt(0):fmt(p.points));
      const train=li.querySelector(".train");
      const buffer=li.querySelector(".buffer");
      if(buffer){
        buffer.style.left=left+"%";
        li.querySelector(".rail-line").style.right="calc("+(100-left)+"% - 11px)";  // klipp rälsen vid stoppbocken
      }
      if(animate){
        train.style.left="4%";
        li.style.opacity="0"; li.style.transform="translateY(-8px)";   // gömd tills spelaren kliver in på toppen
      } else {
        train.style.left=left+"%";
        $board.appendChild(li);
        fitName(li.querySelector(".name"));
      }
      built.push({li, train, left, num:li.querySelector(".num"), to:p.points, terminal:p.terminal});
    });

    if(animate){
      // bygg ställningen sist → först: varje spelare läggs ÖVERST och knuffar ner
      // de som redan ligger där (FLIP). Vinnaren dimper in överst allra sist.
      const queue=built.slice().reverse();
      let qi=0, skeleton=null;

      // gör en DOM-ändring och låt befintliga kort glida mjukt till sina nya lägen (FLIP)
      const flip=(mutate,onFrame)=>{
        const movers=Array.from($board.children);
        const before=movers.map(el=>el.getBoundingClientRect().top);
        mutate();
        const after=movers.map(el=>el.isConnected?el.getBoundingClientRect().top:null);
        movers.forEach((el,i)=>{ if(after[i]==null) return; el.style.transition="none"; el.style.transform="translateY("+(before[i]-after[i])+"px)"; });
        void $board.offsetHeight;                              // tvinga reflow
        requestAnimationFrame(()=>{
          if(myGen!==buildGen) return;                         // bygget avbrutet medan rAF låg och väntade (bakgrundsflik)
          movers.forEach((el,i)=>{ if(after[i]==null) return; el.style.transition="transform .45s cubic-bezier(.22,1,.36,1)"; el.style.transform=""; });
          if(onFrame) onFrame();
        });
      };

      // visa platshållaren överst (där ledaren strax landar)
      const showSkeleton=()=>{
        skeleton=makeSkeletonEl();
        skeleton.style.opacity="0"; skeleton.style.transform="translateY(-8px)";
        flip(()=>$board.insertBefore(skeleton,$board.firstChild), ()=>{
          skeleton.style.transition="opacity .3s ease, transform .3s ease";
          skeleton.style.opacity="1"; skeleton.style.transform="translateY(0)";
        });
      };

      // efter varje kort: dramatisk paus + skelett precis innan första ledaren kröns
      const scheduleNext=(curIsLeader)=>{
        if(myGen!==buildGen) return;          // avbrutet → schemalägg inget mer (inget skelett, inga fler kort)
        const next=queue[qi];
        const dramatic = next && next.li.classList.contains("leader") && !curIsLeader;
        if(dramatic){ showSkeleton(); setTimeout(runNext, LEADER_PAUSE_MS); }
        else setTimeout(runNext, GAP_MS);
      };

      function runNext(){
        if(myGen!==buildGen) return;          // en nyare render() har tagit över → avbryt detta bygge
        if(qi>=queue.length){
          if(skeleton){ skeleton.remove(); skeleton=null; }
          built.forEach(b=>{ if(b.terminal) b.li.classList.add("terminal"); });   // bygget klart → flippa de utslagna till "terminal"
          return;
        }
        const b=queue[qi++];
        const isLeader=b.li.classList.contains("leader");
        const startTrainAndCount=()=>{
          const dur = isLeader ? LEADER_COUNT_MS : COUNT_MS;   // ledaren rullar in och räknas upp långsammare
          b.train.style.transition="left "+(dur/1000)+"s cubic-bezier(.22,1,.36,1)";
          b.train.style.left=b.left+"%";
          countUp(b.num, b.to, dur, ()=>scheduleNext(isLeader));
        };

        if(isLeader && skeleton){
          // ledaren tar platshållarens plats i flödet; skelettet tonas ut ovanpå (crossfade) – inga hopp
          const sk=skeleton; skeleton=null;
          const skTop=sk.getBoundingClientRect().top-$board.getBoundingClientRect().top;
          const SK_FADE=400;
          flip(()=>{ $board.replaceChild(b.li, sk); fitName(b.li.querySelector(".name")); }, ()=>{
            b.li.style.transition="none"; b.li.style.opacity="1"; b.li.style.transform="translateY(0)";  // ligger klar under skelettet
            sk.style.position="absolute"; sk.style.left="0"; sk.style.right="0"; sk.style.top=skTop+"px"; sk.style.margin="0"; sk.style.pointerEvents="none";
            $board.appendChild(sk);
            requestAnimationFrame(()=>{ sk.style.transition="opacity "+(SK_FADE/1000)+"s ease"; sk.style.opacity="0"; });
            // loket rullar och poängen räknas upp först när skelettet tonat ut och kortet faktiskt syns
            setTimeout(()=>{ sk.remove(); startTrainAndCount(); }, SK_FADE);
          });
        } else {
          flip(()=>{ $board.insertBefore(b.li,$board.firstChild); fitName(b.li.querySelector(".name")); }, ()=>{
            b.li.style.transition="opacity .45s ease, transform .45s cubic-bezier(.22,1,.36,1)";
            b.li.style.opacity="1"; b.li.style.transform="translateY(0)";   // ny rad dimper in
            startTrainAndCount();
          });
        }
      }
      requestAnimationFrame(runNext);
    }
  }

  function countUp(el,to,ms,done){
    if(!el){ if(done) done(); return; }
    const start=performance.now();
    (function step(now){
      const t=Math.min(1,(now-start)/ms), e=1-Math.pow(1-t,3);
      el.textContent=fmt(Math.floor(to*e));               // räkna upp i hela poäng
      if(t<1) requestAnimationFrame(step);
      else { el.textContent=fmt(to); if(done) done(); }   // landa på exakt värde med decimaler
    })(performance.now());
  }
  function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

  // Pillrets tre lägen: "loading" (spinner), "idle" (grön prick) och "warn" (amber prick + varning under).
  // .live (= interaktiv knapp) sätts först när tavlan visats; då dyker ↻ upp och pillret går att klicka.
  function setBadge(mode, text){
    $status.className = "status" + (revealed?" live":"") + (mode==="warn"?" warn":"");
    const loading = (mode==="loading");
    $liveDot.style.display = loading ? "none" : "";
    $badgeSpin.style.display = loading ? "inline-block" : "none";
    $badgeRefresh.style.display = (revealed && !loading) ? "inline" : "none";
    if(text!=null) $statusText.textContent = text;
    $statusWarn.hidden = !(mode==="warn" && revealed);   // varningsraden hör bara hemma när pillret är retry-knappen
  }

  // ---------- data-status (banner + statuspill) ----------
  function fmtStamp(d){
    const time=d.toLocaleTimeString("sv-SE",{hour:"2-digit",minute:"2-digit"});
    if(d.toDateString()===new Date().toDateString()) return time;                       // idag → bara klockslag
    return d.toLocaleDateString("sv-SE",{day:"numeric",month:"short"})+" "+time;        // annars datum + tid
  }
  function showDataStatus(demo){
    $banner.classList.toggle("show",!!demo);
    if(demo){
      $banner.textContent="Visar exempeldata. Klistra in din publicerade CSV-URL i koden (CONFIG.csvUrl) så går det live.";
      const t=new Date().toLocaleTimeString("sv-SE",{hour:"2-digit",minute:"2-digit"});
      setBadge("idle","Demo • Ställningen uppdaterad "+t);
      return;
    }
    // Texten gäller DATAN (arkets LAST_UPDATED-cell), inte sidan. Saknas cellen visar vi ändå
    // pillret som en uppdatera-knapp – bara utan tidsstämpel.
    setBadge("idle", lastUpdated ? "Ställningen uppdaterad "+fmtStamp(lastUpdated) : "Uppdatera ställningen");
  }

  // ---------- förladda avatarer så de finns i cache (inget placeholder-hopp) ----------
  function preloadAvatars(players){
    return Promise.all(players.map(p=>new Promise(res=>{
      const img=new Image(); let done=false; const fin=()=>{ if(!done){done=true;res();} };
      img.onload=fin; img.onerror=fin; setTimeout(fin,6000);   // hängande bild blockerar inte knappen
      img.src="images/"+slug(p.name)+".png";
    })));
  }

  // ---------- knapp-states: loading | ready | retry ----------
  let btnMode="loading";
  function setBtn(mode){
    btnMode=mode;
    $startBtn.disabled = (mode==="loading");
    $startBtn.classList.toggle("ready", mode==="ready");
    $startSpinner.style.display = (mode==="loading") ? "" : "none";
    if(mode==="loading"){ $startLabel.textContent="Laddar Som Tjåget Run…"; $gateHint.style.display="none"; }
    else if(mode==="ready"){ $startLabel.textContent="Visa Leaderboarden!"; $gateHint.style.display="none"; }
    else { $startLabel.textContent="Försök igen"; $gateHint.textContent="Kunde inte hämta ställningen."; $gateHint.style.display=""; }
  }

  // ---------- förbered (hämta + förladda) → avslöja på klick → manuell uppdatering via pillret ----------
  async function prepare(){
    setBtn("loading"); setBadge("loading","Laddar…");
    try{
      const {players,demo,updatedAt}=await fetchData();
      lastGood=players; lastDemo=demo; lastUpdated=updatedAt;
      await preloadAvatars(players);
      setBtn("ready"); setBadge("idle","Redo att visa");
    }catch(err){ console.error(err); setBtn("retry"); setBadge("warn","Kunde inte ladda"); }
  }

  function reveal(){
    if(revealed) return;
    revealed=true;
    showDataStatus(lastDemo);                    // statuspillret blir uppdatera-knapp och visar "Ställningen uppdaterad …"
    const gh=$gate.offsetHeight;                 // mät gatens höjd innan den göms
    $gate.classList.add("hide");
    setTimeout(()=>{
      $board.style.minHeight=gh+"px";            // reservera utrymmet så inget hoppar när gaten försvinner
      $gate.style.display="none";
      render(lastGood, !reducedMotion);
      const buildMs=(COUNT_MS+GAP_MS)*(lastGood.length||0)+LEADER_PAUSE_MS+500;
      setTimeout(()=>{ $board.style.minHeight=""; }, reducedMotion?0:buildMs);
    }, 220);
  }

  // räkna en siffra från ett startvärde till ett slutvärde (poäng som ändrats vid uppdatering)
  function countUpFrom(el, from, to, ms){
    if(!el) return;
    const start=performance.now(), delta=to-from;
    (function step(now){
      const t=Math.min(1,(now-start)/ms), e=1-Math.pow(1-t,3);
      el.textContent=fmt(Math.round(from+delta*e));
      if(t<1) requestAnimationFrame(step);
      else el.textContent=fmt(to);
    })(performance.now());
  }

  // Uppdatera tavlan PÅ PLATS: samma kort återanvänds, innehållet byts, och om ordningen
  // ändrats glider korten till sina nya lägen (FLIP) i stället för att hela listan byggs om.
  function patch(players){
    ++buildGen;                                    // avbryt ev. pågående bygg-animation
    const {ranked, leaderCount, settled}=rankPlayers(players);
    if(!ranked.length){ render(players,false); return; }

    const existing={};
    Array.from($board.children).forEach(li=>{ if(li.dataset && li.dataset.name) existing[li.dataset.name]=li; });
    const sameSet = ranked.length===Object.keys(existing).length && ranked.every(p=>existing[p.name]);
    if(!sameSet){ render(players,false); return; }  // spelaruppsättningen ändrad (sällsynt) → bygg om helt

    // domän centrerad på tjåget; lokens läge mappas till 4–96 %
    const maxAbs=Math.max(4, ...ranked.map(p=>p.score));
    const lo=CONFIG.target-maxAbs, span=maxAbs*2;
    const posOf = pts => 4 + Math.max(0,Math.min(1,(pts-lo)/span))*92;

    // 1) mät nuvarande lägen + spara gamla värden FÖRE någon mutation
    const snap=ranked.map((p,idx)=>{
      const li=existing[p.name];
      const train=li.querySelector(".train");
      const ol=train?parseFloat(train.style.left):NaN;
      return { p, idx, li,
        beforeTop: li.getBoundingClientRect().top,
        oldLeft: isNaN(ol)?posOf(p.points):ol,
        oldPts: parseNum(li.querySelector(".num")?.textContent),
        newLeft: posOf(p.points) };
    });

    // 2) byt innehåll, sätt loket på GAMLA läget, ordna om korten i DOM (bäst först)
    snap.forEach(s=>{
      s.li.className="row"+(s.p.rank===1?" leader":"")+(s.p.terminal?" terminal":"");
      s.li.innerHTML=rowInnerHTML(s.p, s.idx, leaderCount, settled, fmt(isNaN(s.oldPts)?s.p.points:s.oldPts));
      placeTrain(s.li, s.oldLeft);
      fitName(s.li.querySelector(".name"));
      $board.appendChild(s.li);                     // flyttar kortet → slutordningen blir ranked-ordningen
    });

    // 3) mät nya lägen, kör FLIP (kort glider) + loks-glid + sifferuppräkning
    const afterTop=snap.map(s=>s.li.getBoundingClientRect().top);
    if(!reducedMotion){
      snap.forEach((s,i)=>{ s.li.style.transition="none"; s.li.style.transform="translateY("+(s.beforeTop-afterTop[i])+"px)"; });
      void $board.offsetHeight;                     // tvinga reflow innan vi släpper transformen
    }
    requestAnimationFrame(()=>{
      snap.forEach(s=>{
        const num=s.li.querySelector(".num"), train=s.li.querySelector(".train");
        if(!reducedMotion){
          s.li.style.transition="transform .55s cubic-bezier(.22,1,.36,1)";
          s.li.style.transform="";
          if(train) train.style.transition="left 1.2s cubic-bezier(.22,1,.36,1)";
        }
        placeTrain(s.li, s.newLeft);                // loket glider till nytt läge (stoppbock/klipp följer med)
        if(num){
          if(!reducedMotion && !isNaN(s.oldPts) && Math.abs(s.oldPts-s.p.points)>1e-9) countUpFrom(num, s.oldPts, s.p.points, 900);
          else num.textContent=fmt(s.p.points);
        }
      });
    });
  }

  // Klick på pillret → hämta på nytt. Tyst vid success (den nya tiden räcker som kvitto);
  // vid fail: amber prick, behåll senast kända tid, och en varningsrad under (klick = försök igen).
  async function manualRefresh(){
    if(!revealed || refreshing) return;
    refreshing=true;
    setBadge("loading","Uppdaterar…");
    try{
      const {players,demo,updatedAt}=await fetchData();
      lastGood=players; lastDemo=demo; lastUpdated=updatedAt;
      patch(players);
      showDataStatus(demo);                         // tillbaka till normalläge med ny tid
    }catch(err){
      console.error(err);
      setBadge("warn", lastUpdated ? "Ställningen uppdaterad "+fmtStamp(lastUpdated) : "Uppdatera ställningen");
    }finally{
      refreshing=false;
    }
  }

  (function(){ const y=document.getElementById("year"); if(y) y.textContent=new Date().getFullYear(); })();
  $startBtn.addEventListener("click",()=>{ if(btnMode==="ready") reveal(); else if(btnMode==="retry") prepare(); });
  $status.addEventListener("click", manualRefresh);   // pillret är uppdatera-knappen (no-op tills tavlan visats)
  window.addEventListener("resize",()=>$board.querySelectorAll(".name").forEach(fitName));
  prepare();
