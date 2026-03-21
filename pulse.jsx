import { useState, useRef, useCallback, useMemo, Component } from "react";

// ─── Error Boundary ───────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("PULSE error:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{maxWidth:430,margin:"0 auto",minHeight:"100vh",background:"#0d0d0d",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,fontFamily:"system-ui,sans-serif"}}>
          <div style={{fontSize:"2.5rem",marginBottom:16}}>⚠️</div>
          <div style={{fontWeight:800,fontSize:"1.1rem",color:"#f5f5f5",marginBottom:8,textAlign:"center"}}>Something went wrong</div>
          <div style={{fontSize:"0.82rem",color:"#606060",marginBottom:24,textAlign:"center",lineHeight:1.6}}>Your data is safe. Tap below to reload PULSE.</div>
          <button
            onClick={()=>{ this.setState({hasError:false,error:null}); }}
            style={{background:"#c8f135",color:"#0d0d0d",border:"none",borderRadius:12,padding:"12px 28px",fontWeight:700,fontSize:"0.92rem",cursor:"pointer"}}>
            Reload app
          </button>
          {this.state.error&&<details style={{marginTop:24,fontSize:"0.7rem",color:"#444",maxWidth:"100%"}}>
            <summary style={{cursor:"pointer",color:"#606060"}}>Error details</summary>
            <pre style={{marginTop:8,overflow:"auto",maxHeight:120,fontSize:"0.65rem"}}>{this.state.error?.message}</pre>
          </details>}
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Constants ────────────────────────────────────────────
// TODAY computed fresh each render via hook — handles midnight rollover
const _getToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
// Static fallback for module-level code (imports, etc.)
const TODAY = _getToday();
const MEAL_SLOTS = [
  { id:"breakfast", icon:"🌤", label:"Breakfast" },
  { id:"lunch",     icon:"☀️",  label:"Lunch" },
  { id:"dinner",    icon:"🌙",  label:"Dinner" },
  { id:"pre",       icon:"⚡",  label:"Pre-Workout" },
  { id:"post",      icon:"💪",  label:"Post-Workout" },
  { id:"snack",     icon:"🍃",  label:"Snacks" },
];
const CAT_LABELS = { breakfast:"Breakfast", lunch:"Lunch", dinner:"Dinner", snack:"Snack", pre:"Pre-Workout", post:"Post-Workout" };
const WORKOUT_TYPES = ["🏃 Run","🚴 Ride","🏋️ Strength","🧘 Yoga","🥊 HIIT","🏊 Swim","🥾 Hike","💪 Nike Training","✦ Other"];

const INIT = {
  // Core tracking
  workouts:[], meals:{}, recipes:[], goals:[], water:{},
  macroGoals:{ cal:2200, pro:160, carb:250, fat:70 },
  waterGoal:64, waterInc:8, stravaConnected:false,

  // v3 additions
  bodyWeights:{},          // {[YYYY-MM-DD]: number}  daily weigh-ins in lbs
  steps:{},                // {[YYYY-MM-DD]: number}  daily step counts (from import)
  profile:{                // user context for coaching
    name:"", age:"", weightLbs:"", heightIn:"",
    fitnessLevel:"intermediate", // beginner|intermediate|advanced
    primaryGoal:"general",       // general|weight|performance|consistency
    weeklyTarget:4,              // intended sessions per week
  },
  onboarded:false,         // first-launch flow complete flag
  theme:"dark",            // dark|light
  macroGoalsByDayType:{    // different targets for training vs rest days
    training:{ cal:2400, pro:170, carb:280, fat:75 },
    rest:     { cal:1900, pro:150, carb:200, fat:65 },
    useDayType:false,      // toggle — off by default
  },
  injuryPeriods:[],        // [{id,label,start,end,note}]
  dayNotes:{},             // {[YYYY-MM-DD]: string}  rest day journal
  recentFoods:[],          // [{name,cal,pro,carb,fat,ts}] last 20 logged
  favFoods:[],             // [{name,cal,pro,carb,fat}] starred
  mealTemplates:[],        // [{id,name,slot,items:[{name,cal,pro,carb,fat}]}]
  challenges:[],           // [{id,name,metric,target,unit,start,end,type}]
  weeklyPlan:{},           // {[YYYY-Www]: {[dow]: [{type,name,notes}]}}
};

// Debounced localStorage save with quota error detection
let _saveTimer = null;
let _saveError = false;
const saveState = (state, onError) => {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      localStorage.setItem("pulseV1", JSON.stringify(state));
      _saveError = false;
    } catch(e) {
      _saveError = true;
      if (onError) onError(e);
    }
  }, 300);
};

const SCHEMA_VERSION = 3;

function migrateState(raw) {
  // Ensure all top-level keys from INIT exist with correct types
  const out = {...INIT};
  if (!raw || typeof raw !== "object") return out;

  // Merge known keys safely — core data
  if (Array.isArray(raw.workouts)) out.workouts = raw.workouts;
  if (raw.meals && typeof raw.meals === "object") out.meals = raw.meals;
  if (Array.isArray(raw.recipes)) out.recipes = raw.recipes;
  if (Array.isArray(raw.goals)) out.goals = raw.goals;
  if (raw.water && typeof raw.water === "object") out.water = raw.water;
  if (typeof raw.waterGoal === "number" && raw.waterGoal > 0) out.waterGoal = raw.waterGoal;
  if (typeof raw.waterInc === "number") out.waterInc = raw.waterInc;

  // Deep merge macroGoals
  if (raw.macroGoals && typeof raw.macroGoals === "object") {
    out.macroGoals = {...INIT.macroGoals, ...raw.macroGoals};
  }

  // v3 new keys — deep merge with defaults so new sub-fields survive future updates
  if (raw.bodyWeights && typeof raw.bodyWeights === "object") out.bodyWeights = raw.bodyWeights;
  if (raw.steps && typeof raw.steps === "object") out.steps = raw.steps;
  if (raw.profile && typeof raw.profile === "object") {
    out.profile = {...INIT.profile, ...raw.profile};
  }
  if (typeof raw.onboarded === "boolean") out.onboarded = raw.onboarded;
  if (raw.theme === "light" || raw.theme === "dark") out.theme = raw.theme;
  if (raw.macroGoalsByDayType && typeof raw.macroGoalsByDayType === "object") {
    out.macroGoalsByDayType = {
      ...INIT.macroGoalsByDayType,
      ...raw.macroGoalsByDayType,
      training: {...INIT.macroGoalsByDayType.training, ...(raw.macroGoalsByDayType.training||{})},
      rest:     {...INIT.macroGoalsByDayType.rest,     ...(raw.macroGoalsByDayType.rest||{})},
    };
  }
  if (Array.isArray(raw.injuryPeriods)) out.injuryPeriods = raw.injuryPeriods;
  if (raw.dayNotes && typeof raw.dayNotes === "object") out.dayNotes = raw.dayNotes;
  if (Array.isArray(raw.recentFoods)) out.recentFoods = raw.recentFoods;
  if (Array.isArray(raw.favFoods)) out.favFoods = raw.favFoods;
  if (Array.isArray(raw.mealTemplates)) out.mealTemplates = raw.mealTemplates;
  if (Array.isArray(raw.challenges)) out.challenges = raw.challenges;
  if (raw.weeklyPlan && typeof raw.weeklyPlan === "object") out.weeklyPlan = raw.weeklyPlan;

  // Schema migrations
  const version = raw._schemaVersion || 1;
  if (version < 2) {
    out.workouts = out.workouts.map(w => ({source:"manual",...w}));
    out.goals = out.goals.map(g => ({autoTrack:false,...g}));
  }
  // v2→v3: no data shape changes needed — all new keys are additive

  out._schemaVersion = SCHEMA_VERSION;

  // Prune water and meal entries older than 90 days to prevent unbounded growth
  const cutoff = (() => {
    const d = new Date(); d.setDate(d.getDate() - 90);
    const pad = n => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  })();
  const pruneByDate = obj => obj
    ? Object.fromEntries(Object.entries(obj).filter(([k]) => k >= cutoff))
    : {};
  out.water    = pruneByDate(out.water);
  out.meals    = pruneByDate(out.meals);
  out.dayNotes = pruneByDate(out.dayNotes);
  // bodyWeights and steps kept for 365 days (long-horizon charts need history)
  const longCutoff = (() => {
    const d = new Date(); d.setDate(d.getDate() - 365);
    const pad = n => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  })();
  out.bodyWeights = out.bodyWeights
    ? Object.fromEntries(Object.entries(out.bodyWeights).filter(([k]) => k >= longCutoff))
    : {};
  out.steps = out.steps
    ? Object.fromEntries(Object.entries(out.steps).filter(([k]) => k >= longCutoff))
    : {};

  return out;
}

function loadState() {
  try {
    const raw = localStorage.getItem("pulseV1");
    if (!raw) return {...INIT, _schemaVersion: SCHEMA_VERSION};
    return migrateState(JSON.parse(raw));
  } catch {
    return {...INIT, _schemaVersion: SCHEMA_VERSION};
  }
}

// ─── Tokens — Obsidian palette ────────────────────────────
const T = {
  bg:        "var(--bg)",
  paper:     "var(--paper)",
  paperAlt:  "var(--paper-alt)",
  line:      "var(--line)",
  lineSoft:  "var(--line-soft)",
  ink:       "var(--ink)",
  inkMid:    "var(--ink-mid)",
  inkLight:  "var(--ink-light)",
  // Primary accent — neon lime
  lime:      "#c8f135",   limeL:"#1e2a00",
  // Functional accents — all Obsidian-matched
  red:       "#ff4d4d",   redL:"#2a0a0a",
  green:     "#4cffb0",   greenL:"#002a1a",
  blue:      "#00e5ff",   blueL:"#001a2a",
  orange:    "#ffaa00",   orangeL:"#2a1a00",
  purple:    "#bf5af2",   purpleL:"#1a0a2a",
  // Aliases
  sage:      "#4cffb0",   sageL:"#002a1a",
  sky:       "#00e5ff",   skyL:"#001a2a",
  slate:     "#c8f135",   slateL:"#1e2a00",
  stone:     "#ffaa00",   stoneL:"#2a1a00",
  rose:      "#ff4d4d",   roseL:"#2a0a0a",
  cyan:      "#c8f135",   cyanL:"#1e2a00",
  navyMid:   "#1a1a1a",
};

// ─── Static style constants (extracted from render path) ────
const S = {
  flexRow:    {display:"flex",alignItems:"center"},
  flexBetween:{display:"flex",justifyContent:"space-between",alignItems:"center"},
  flexCol:    {display:"flex",flexDirection:"column"},
  grid2:      {display:"grid",gridTemplateColumns:"1fr 1fr",gap:10},
  grid3:      {display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8},
  mono:       {fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace"},
  barlow:     {fontFamily:"'Barlow Condensed',sans-serif"},
  // Card base (static parts only)
  cardBase:   {background:"var(--paper)",border:"1px solid var(--line)",borderRadius:16,padding:18,boxShadow:"0 2px 8px rgba(0,0,0,.4)"},
  // Input base (static parts)
  inpBase:    {width:"100%",background:"var(--paper)",border:"1.5px solid var(--line)",borderRadius:12,color:"var(--ink)",fontSize:"16px",padding:"13px 15px",outline:"none",WebkitAppearance:"none",transition:"border-color .15s"},
  // Empty state — raised contrast (WCAG AA: T.inkMid ~7:1 on dark bg)
  emptyIcon:  {fontSize:"2.2rem",opacity:.65,marginBottom:10},
  emptyText:  {fontSize:"0.88rem",fontWeight:500,color:"var(--ink-mid)"},
};

// ─── Helpers ──────────────────────────────────────────────
// Activity color map — used across all tabs
const ACTIVITY_COLORS = {
  "🏃 Run":        {bg:"#1e0a0a", accent:"#ff4d4d", light:"#2a0f0f"},
  "🚴 Ride":       {bg:"#001a2a", accent:"#00e5ff", light:"#00202e"},
  "🏋️ Strength":   {bg:"#1a0a2a", accent:"#bf5af2", light:"#220f30"},
  "🧘 Yoga":       {bg:"#002a1a", accent:"#4cffb0", light:"#003020"},
  "🥊 HIIT":       {bg:"#2a1500", accent:"#ffaa00", light:"#2e1800"},
  "🏊 Swim":       {bg:"#001a2a", accent:"#00e5ff", light:"#002030"},
  "🥾 Hike":       {bg:"#1a1200", accent:"#d4a017", light:"#201600"},
  "🚶 Walk":       {bg:"#0a1a0a", accent:"#4cffb0", light:"#0f1e0f"},
  "🧘 Pilates":    {bg:"#002a1a", accent:"#4cffb0", light:"#003020"},
  "🏂 Snow":       {bg:"#001020", accent:"#00e5ff", light:"#001828"},
  "⛷️ Ski":        {bg:"#001020", accent:"#00e5ff", light:"#001828"},
  "🚣 Row":        {bg:"#001a2a", accent:"#00e5ff", light:"#002030"},
  "🎾 Tennis":     {bg:"#1a2a00", accent:"#c8f135", light:"#202e00"},
  "⛳ Golf":       {bg:"#002a1a", accent:"#4cffb0", light:"#003020"},
  "🏊 Triathlon":  {bg:"#001a2a", accent:"#00e5ff", light:"#002030"},
  "✦ Other":       {bg:"#1a1a1a", accent:"#888888", light:"#222222"},
};
// O(1) emoji-prefix lookup — pre-built at module load
const _EMOJI_MAP = Object.fromEntries(
  Object.entries(ACTIVITY_COLORS).map(([k,v]) => [k.split(" ")[0], v])
);
const actColor = type => {
  if (!type) return ACTIVITY_COLORS["✦ Other"];
  const emoji = type.split(" ")[0];
  return _EMOJI_MAP[emoji] || ACTIVITY_COLORS["✦ Other"];
};

const fmtD = d => { if(!d||typeof d!=="string") return "—"; const dt=new Date(d+"T12:00"); return isNaN(dt)?"—":dt.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}); };
// Guard helpers — only show values that are genuinely meaningful
const hasHR   = v => !!v && v !== "0" && v !== "" && parseInt(v) > 30;
const hasPace = v => !!v && v.trim() !== "" && v.trim() !== "0" && v.trim() !== "—";
const hasDist = v => !!v && v !== "0" && parseFloat(v) > 0;
const hasDur  = v => !!v && v !== "—" && v !== "0" && parseInt(v) > 0;
const localDate = d => { const pad=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
let _wkCache = { key:"", val:[] };
const getWk = () => {
  const today = _getToday();
  if (_wkCache.key === today) return _wkCache.val;
  const val = Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(6-i)); return localDate(d); });
  _wkCache = { key: today, val };
  return val;
};

// Cached date-range generators — keyed by "n:today" to reset daily
const _daysCache = new Map();
const getDaysRange = n => {
  const key = `${n}:${_getToday()}`;
  if (_daysCache.has(key)) return _daysCache.get(key);
  const val = Array.from({length:n},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(n-1-i)); return localDate(d); });
  _daysCache.set(key, val);
  return val;
};
const sumM  = meals => { let c=0,p=0,cb=0,f=0; Object.values(meals||{}).forEach(s=>s.forEach(i=>{c+=i.cal||0;p+=i.pro||0;cb+=i.carb||0;f+=i.fat||0;})); return {cal:c,pro:p,carb:cb,fat:f}; };

// Nutrition streak — consecutive days hitting protein goal
const calcProStreak = (meals, macroGoals) => {
  if (!macroGoals?.pro || macroGoals.pro <= 0) return 0;
  const target = macroGoals.pro * 0.85; // 85% counts as "hit"
  let streak = 0;
  const d = new Date();
  // Start from yesterday if today not yet hit
  const todayPro = sumM(meals[_getToday()]||{}).pro;
  if (todayPro < target) d.setDate(d.getDate()-1);
  while (streak < 365) {
    const dk = localDate(d);
    const {pro} = sumM(meals[dk]||{});
    if (pro >= target) { streak++; d.setDate(d.getDate()-1); }
    else break;
  }
  return streak;
};

// ── AI feature flag — checks if Claude API is available ──
// Vite exposes env vars as import.meta.env.VITE_*
// Set VITE_CLAUDE_API_KEY in Vercel environment variables to activate AI features
const _envKey = typeof import.meta !== "undefined" ? import.meta.env?.VITE_CLAUDE_API_KEY : undefined;
const AI_AVAILABLE = !!(window.__PULSE_API_KEY__ || _envKey);
const getApiKey = () => window.__PULSE_API_KEY__ || _envKey || "";

// ── Streaming Claude call — returns async generator of text chunks ──
async function* streamClaude(systemPrompt, userPrompt, maxTokens=600) {
  const key = getApiKey();
  if (!key) { yield "[AI coaching available after deployment]"; return; }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-api-key":key,
        "anthropic-version":"2023-06-01",
        "anthropic-dangerous-direct-browser-access":"true",
      },
      body:JSON.stringify({
        model:"claude-haiku-4-5-20251001",
        max_tokens:maxTokens,
        stream:true,
        system:systemPrompt,
        messages:[{role:"user",content:userPrompt}],
      }),
    });
    if (!res.ok) { yield `[Error: ${res.status}]`; return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream:true});
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        try {
          const j = JSON.parse(data);
          const text = j?.delta?.text;
          if (text) yield text;
        } catch {}
      }
    }
  } catch(e) {
    yield `[Connection error: ${e.message}]`;
  }
}

// ── One-shot Claude call (for JSON responses) ──
async function callClaude(systemPrompt, userPrompt, maxTokens=400) {
  const key = getApiKey();
  if (!key) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-api-key":key,
      "anthropic-version":"2023-06-01",
      "anthropic-dangerous-direct-browser-access":"true",
    },
    body:JSON.stringify({
      model:"claude-haiku-4-5-20251001",
      max_tokens:maxTokens,
      system:systemPrompt,
      messages:[{role:"user",content:userPrompt}],
    }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j?.content?.[0]?.text || null;
}

// ── Trend line helper — least squares regression over an array of values ──
const trendLine = (data) => {
  const n = data.length;
  if (n < 2) return null;
  const xs = data.map((_,i)=>i);
  const ys = data;
  const sumX=xs.reduce((a,b)=>a+b,0), sumY=ys.reduce((a,b)=>a+b,0);
  const sumXY=xs.reduce((a,x,i)=>a+x*ys[i],0), sumX2=xs.reduce((a,x)=>a+x*x,0);
  const slope=(n*sumXY-sumX*sumY)/(n*sumX2-sumX*sumX);
  const intercept=(sumY-slope*sumX)/n;
  return { start:intercept, end:intercept+slope*(n-1), slope };
};

// ── SVG trend line overlay — used inside bar chart containers ──
const TrendOverlay = ({data, max, color="#c8f135", height=60}) => {
  const trend = trendLine(data.filter(v=>v>0));
  if (!trend || data.filter(v=>v>0).length < 3) return null;
  const w = 100, h = height;
  const scaleY = v => h - Math.max(0,Math.min(h,(v/Math.max(max,1))*h));
  const x1=0, y1=scaleY(trend.start), x2=w, y2=scaleY(trend.end);
  const rising = trend.slope >= 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none"}}>
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={rising?color:"#ff4d4d"} strokeWidth="1.5"
        strokeDasharray="3 2" opacity="0.7" strokeLinecap="round"/>
    </svg>
  );
};

// Haptic feedback — silently no-ops if not supported (desktop/browser)
const haptic = (type="light") => {
  if (!navigator.vibrate) return;
  const patterns = { light:10, medium:20, heavy:[30,10,30], success:[10,50,10], error:[50,20,50] };
  navigator.vibrate(patterns[type]||10);
};

// Streak grace-day helper — returns effective streak counting one grace rest day
const calcStreak = (workouts, graceDay=true) => {
  if (!workouts.length) return 0;
  const TODAY_D = _getToday();
  const datesWithW = new Set(workouts.map(w=>w.date));
  let count=0, graceUsed=false;
  const d = new Date();
  if (!datesWithW.has(TODAY_D)) d.setDate(d.getDate()-1);
  while (true) {
    const dk = localDate(d);
    if (datesWithW.has(dk)) { count++; }
    else if (graceDay && !graceUsed && count>0) { graceUsed=true; } // skip one gap
    else { break; }
    d.setDate(d.getDate()-1);
    if (count > 1000) break; // safety
  }
  return count;
};

// ─── Reducer ──────────────────────────────────────────────
function reduce(s, a) {
  switch(a.t) {
    case "ADD_W":  return {...s, workouts:[a.w,...s.workouts]};
    case "DEL_W":  return {...s, workouts:s.workouts.filter(w=>w.id!==a.id)};
    case "UPD_W":  return {...s, workouts:s.workouts.map(w=>w.id===a.w.id?{...w,...a.w}:w)};
    case "ADD_M":  {
      const m={...s.meals,[a.date]:{...s.meals[a.date]}};
      if(!m[a.date][a.slot])m[a.date][a.slot]=[];
      m[a.date][a.slot]=[...m[a.date][a.slot],a.item];
      // Auto-track recent foods (only for named items with nutrition data)
      const rf = a.item.cal>0
        ? [{...a.item,ts:Date.now()},...(s.recentFoods||[]).filter(f=>f.name!==a.item.name)].slice(0,20)
        : s.recentFoods||[];
      return {...s, meals:m, recentFoods:rf};
    }
    case "DEL_M":  { const m={...s.meals,[a.date]:{...s.meals[a.date]}}; m[a.date][a.slot]=m[a.date][a.slot].filter((_,i)=>i!==a.idx); return {...s,meals:m}; }
    case "SAVE_R": { const i=s.recipes.findIndex(r=>r.id===a.r.id); return {...s,recipes:i>=0?s.recipes.map((r,j)=>j===i?a.r:r):[a.r,...s.recipes]}; }
    case "DEL_R":  return {...s,recipes:s.recipes.filter(r=>r.id!==a.id)};
    case "ADD_G":  return {...s,goals:[a.g,...s.goals]};
    case "DEL_G":  return {...s,goals:s.goals.filter(g=>g.id!==a.id)};
    case "UPD_G":  return {...s,goals:s.goals.map(g=>g.id===a.id?{...g,curr:a.v}:g)};
    case "MACROS": return {...s,macroGoals:a.v};
    case "WATER":  return {...s,water:a.v};
    case "WGOAL":  return {...s,waterGoal:a.v};
    case "STRAVA": return {...s,stravaConnected:!s.stravaConnected};
    case "RESTORE": return {...INIT,...a.state};

    // ── v3 actions ──────────────────────────────────────────
    // Body weight: ADD_BW {date, lbs}  DEL_BW {date}
    case "ADD_BW":  return {...s, bodyWeights:{...s.bodyWeights, [a.date]:a.lbs}};
    case "DEL_BW":  { const bw={...s.bodyWeights}; delete bw[a.date]; return {...s,bodyWeights:bw}; }

    // Steps: SET_STEPS {steps: {[date]:count}}  — bulk set from import
    case "SET_STEPS": return {...s, steps:{...s.steps,...a.steps}};

    // Profile: UPD_PROFILE {profile: {...}}
    case "UPD_PROFILE": return {...s, profile:{...s.profile,...a.profile}};

    // Onboarding complete
    case "ONBOARDED": return {...s, onboarded:true};

    // Theme toggle
    case "THEME": return {...s, theme:a.theme};

    // Day-type macro goals
    case "DAY_MACROS": return {...s, macroGoalsByDayType:{...s.macroGoalsByDayType,...a.v}};

    // Injury periods
    case "ADD_INJ":  return {...s, injuryPeriods:[...s.injuryPeriods, a.inj]};
    case "DEL_INJ":  return {...s, injuryPeriods:s.injuryPeriods.filter(i=>i.id!==a.id)};
    case "UPD_INJ":  return {...s, injuryPeriods:s.injuryPeriods.map(i=>i.id===a.inj.id?a.inj:i)};

    // Rest day journal
    case "DAY_NOTE": return {...s, dayNotes:{...s.dayNotes, [a.date]:a.note}};
    case "DEL_NOTE": { const dn={...s.dayNotes}; delete dn[a.date]; return {...s,dayNotes:dn}; }

    // Food history — keep last 20 unique by name, newest first
    case "LOG_FOOD": {
      const existing = (s.recentFoods||[]).filter(f=>f.name!==a.food.name);
      return {...s, recentFoods:[a.food,...existing].slice(0,20)};
    }
    // Favourites
    case "FAV_FOOD":   return {...s, favFoods:[a.food,...(s.favFoods||[]).filter(f=>f.name!==a.food.name)]};
    case "UNFAV_FOOD": return {...s, favFoods:(s.favFoods||[]).filter(f=>f.name!==a.name)};

    // Meal templates
    case "SAVE_MT": {
      const i=(s.mealTemplates||[]).findIndex(t=>t.id===a.tpl.id);
      return {...s, mealTemplates:i>=0?s.mealTemplates.map((t,j)=>j===i?a.tpl:t):[a.tpl,...(s.mealTemplates||[])]};
    }
    case "DEL_MT": return {...s, mealTemplates:(s.mealTemplates||[]).filter(t=>t.id!==a.id)};

    // Challenges
    case "ADD_CH":  return {...s, challenges:[...(s.challenges||[]),a.ch]};
    case "DEL_CH":  return {...s, challenges:(s.challenges||[]).filter(c=>c.id!==a.id)};
    case "UPD_CH":  return {...s, challenges:(s.challenges||[]).map(c=>c.id===a.ch.id?a.ch:c)};

    // Weekly plan
    case "SET_PLAN": return {...s, weeklyPlan:{...(s.weeklyPlan||{}),[a.wk]:{...((s.weeklyPlan||{})[a.wk]||{}),[a.dow]:a.items}}};

    default: return s;
  }
}

// ─── Design primitives ────────────────────────────────────
const G_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');

  /* ── Obsidian — Dark mode (default) ── */
  :root {
    --bg:        #0d0d0d;
    --paper:     #1a1a1a;
    --paper-alt: #222222;
    --line:      #2e2e2e;
    --line-soft: #252525;
    --ink:       #f5f5f5;
    --ink-mid:   #a0a0a0;
    --ink-light: #606060;
    --navy:      #f5f5f5;
    --navy-mid:  #a0a0a0;
    --hero-grad: linear-gradient(160deg,#0d0d0d 0%,#1a1a1a 50%,#111111 100%);
    --accent:    #c8f135;
  }

  /* ── Light mode — activated by .light-mode class on root div ── */
  .light-mode {
    --bg:        #f4f4f0;
    --paper:     #ffffff;
    --paper-alt: #f0f0ec;
    --line:      #e0e0d8;
    --line-soft: #ebebE4;
    --ink:       #111111;
    --ink-mid:   #555555;
    --ink-light: #888888;
    --navy:      #111111;
    --navy-mid:  #555555;
    --hero-grad: linear-gradient(160deg,#1a1a1a 0%,#2a2a2a 50%,#111111 100%);
  }

  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  html,body{
    font-family:'DM Sans',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
    background:var(--bg);
    overscroll-behavior:none;
    color:var(--ink);
  }
  input,select,textarea{
    font-family:'DM Sans',-apple-system,sans-serif;
    font-size:16px!important;
    color:var(--ink);
  }
  .mono{font-family:ui-monospace,'SF Mono','Fira Code',monospace;}
  .display{font-family:'Barlow Condensed','DM Sans',sans-serif;}

  /* ── Animations ── */
  @keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  @keyframes pu{0%,100%{opacity:.25;transform:scale(.75)}50%{opacity:1;transform:scale(1)}}
  @keyframes ring-fill{from{stroke-dashoffset:251}to{stroke-dashoffset:var(--dash)}}
  @keyframes pulse-glow{0%,100%{box-shadow:0 0 0 0 rgba(200,241,53,.4)}50%{box-shadow:0 0 0 8px rgba(200,241,53,0)}}
  .fu{animation:fu .25s cubic-bezier(.22,.68,0,1.2) both}

  /* ── Press states ── */
  .pressable{transition:transform .12s cubic-bezier(.22,.68,0,1.2),box-shadow .12s ease;will-change:transform;}
  .pressable:active{transform:scale(0.97);box-shadow:0 1px 4px rgba(0,0,0,.08)!important;}

  /* ── Range inputs ── */
  input[type=date]::-webkit-calendar-picker-indicator{opacity:.4}
  input[type=range]{-webkit-appearance:none;appearance:none;width:100%;background:transparent;cursor:pointer;}
  input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:99px;background:var(--line);}
  input.water-slider::-webkit-slider-runnable-track{background:transparent;}
  input.water-slider{height:6px;border-radius:99px;}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:26px;height:26px;border-radius:50%;background:#c8f135;margin-top:-10px;box-shadow:0 2px 8px rgba(200,241,53,.4);}
  input[type=range]::-moz-range-track{height:6px;border-radius:99px;background:var(--line);}
  input[type=range]::-moz-range-thumb{width:26px;height:26px;border-radius:50%;background:#c8f135;border:none;box-shadow:0 2px 8px rgba(200,241,53,.4);}

  /* ── Focus states — keyboard and assistive tech ── */
  button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline:2px solid #c8f135 !important;
    outline-offset:2px;
  }
  /* Remove outline on mouse/touch (only show on keyboard nav) */
  button:focus:not(:focus-visible) { outline:none; }
`;

const Lbl = ({c,style}) => <div style={{fontSize:"0.6rem",fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:c||T.inkLight,marginBottom:5,...style}}>{c||style?.children}</div>;
const FL  = ({label,children}) => <div style={{marginBottom:12}}><div style={{fontSize:"0.6rem",fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:T.inkLight,marginBottom:5}}>{label}</div>{children}</div>;

const inp = {width:"100%",background:T.paper,border:`1.5px solid ${T.line}`,borderRadius:12,color:T.ink,fontSize:"16px",padding:"13px 15px",outline:"none",WebkitAppearance:"none",transition:"border-color .15s"};
const Inp  = p => <input  {...p} style={{...inp,...p.style}} onFocus={e=>e.target.style.borderColor="#c8f135"} onBlur={e=>e.target.style.borderColor=T.line}/>;
const Sel  = ({children,...p}) => <select {...p} style={{...inp,backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237a96b0' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 13px center",paddingRight:38,appearance:"none",...p.style}} onFocus={e=>e.target.style.borderColor="#c8f135"} onBlur={e=>e.target.style.borderColor=T.line}>{children}</select>;
const Area = p => <textarea {...p} style={{...inp,resize:"vertical",minHeight:72,...p.style}} onFocus={e=>e.target.style.borderColor="#c8f135"} onBlur={e=>e.target.style.borderColor=T.line}/>;

const Btn = ({children,v="primary",sm,full,style,...p}) => {
  const vs = {
    primary:{bg:"#c8f135",c:"#0d0d0d",b:"none",sh:"0 2px 12px rgba(200,241,53,.35)"},
    secondary:{bg:T.navyMid,c:"#fff",b:"none",sh:"none"},
    ghost:{bg:T.cyanL,c:T.cyan,b:"none",sh:"none"},
    outline:{bg:"transparent",c:T.inkMid,b:`1.5px solid ${T.line}`,sh:"none"},
    danger:{bg:T.roseL,c:T.rose,b:`1px solid #f0c0c8`,sh:"none"},
    sage:{bg:T.greenL,c:T.green,b:`1px solid #c0dfd0`,sh:"none"},
  };
  const s = vs[v]||vs.primary;
  return <button {...p} className="pressable" style={{background:s.bg,color:s.c,border:s.b,boxShadow:s.sh,borderRadius:12,fontFamily:"'DM Sans',-apple-system,sans-serif",fontWeight:700,fontSize:sm?"0.82rem":"0.92rem",letterSpacing:sm?"0":"0.01em",padding:sm?"8px 16px":"13px 22px",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6,width:full?"100%":undefined,justifyContent:full?"center":undefined,minHeight:sm?44:46,flexShrink:0,...style}}>{children}</button>;
};

const Card = ({children,style,press}) => <div className={press?"pressable":""} style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:16,padding:18,boxShadow:'0 2px 8px rgba(0,0,0,.4)',...style}}>{children}</div>;

// Sub-section label — subtle, used inside cards
const Sec = ({children}) => (
  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
    <span style={{fontSize:"0.62rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.inkLight,whiteSpace:"nowrap"}}>{children}</span>
    <div style={{flex:1,height:1,background:T.lineSoft}}/>
  </div>
);
// Primary section header — bold, full-width, used between page sections
const SecH = ({children,action}) => (
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,marginTop:8}}>
    <h2 style={{fontFamily:"'Barlow Condensed','DM Sans',sans-serif",fontSize:"1.1rem",fontWeight:900,color:T.ink,letterSpacing:"0.06em",textTransform:"uppercase"}}>{children}</h2>
    {action&&<div>{action}</div>}
  </div>
);

const Pill = ({children,color="slate"}) => {
  const m={
    slate:{bg:"rgba(200,241,53,.15)",c:"#c8f135"},
    sage: {bg:"rgba(76,255,176,.15)",c:"#4cffb0"},
    sky:  {bg:"rgba(0,229,255,.15)", c:"#00e5ff"},
    stone:{bg:"rgba(255,170,0,.15)", c:"#ffaa00"},
    rose: {bg:"rgba(255,77,77,.15)", c:"#ff4d4d"},
  };
  const s=m[color]||m.slate;
  return <span style={{fontSize:"0.65rem",fontWeight:700,padding:"3px 9px",borderRadius:20,background:s.bg,color:s.c,letterSpacing:"0.02em",flexShrink:0}}>{children}</span>;
};

const Bar = ({label,v,max,color="slate"}) => {
  const cols={slate:T.slate,sage:T.green,sky:T.blue,stone:T.orange,red:T.red,purple:T.purple};
  const pct = max ? Math.min(100,Math.round((parseFloat(v)/parseFloat(max))*100)) : 0;
  const fill = cols[color]||T.slate;
  return (
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
        <span style={{fontSize:"0.88rem",fontWeight:500,color:T.ink}}>{label}</span>
        <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"0.9rem",fontWeight:700,color:fill}}>{pct}%</span>
      </div>
      <div style={{height:6,background:T.lineSoft,borderRadius:99,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:fill,borderRadius:99,transition:"width .6s ease",boxShadow:`0 0 10px ${fill}66`}}/>
      </div>
    </div>
  );
};

const Modal = ({open,onClose,title,sub,children}) => {
  if(!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",backdropFilter:"blur(8px)",zIndex:600,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div className="fu" style={{background:T.paper,borderRadius:"22px 22px 0 0",padding:"20px 20px 44px",width:"100%",maxWidth:520,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 -12px 48px rgba(0,0,0,.18)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
          <div style={{width:40,height:5,background:T.line,borderRadius:3}}/>
          <button aria-label="Close" onClick={onClose} style={{background:"none",border:"none",color:T.inkLight,cursor:"pointer",fontSize:"1.1rem",padding:"4px 8px",minHeight:44,minWidth:44,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
        <div style={{fontSize:"1.2rem",fontWeight:700,color:T.ink,marginBottom:sub?4:18,letterSpacing:"-0.01em"}}>{title}</div>
        {sub&&<div style={{fontSize:"0.84rem",color:T.inkMid,marginBottom:18}}>{sub}</div>}
        {children}
      </div>
    </div>
  );
};

const Toast = ({msg,v,undo}) => (
  <div role="status" aria-live="polite" aria-atomic="true"
    style={{position:"fixed",bottom:90,left:"50%",transform:v?"translateX(-50%) translateY(0)":"translateX(-50%) translateY(20px)",
      background:T.ink,color:"#fafaf8",fontFamily:"'DM Sans',sans-serif",fontWeight:500,fontSize:"0.84rem",
      padding:undo?"10px 8px 10px 20px":"10px 20px",borderRadius:10,zIndex:999,opacity:v?1:0,
      transition:"all .3s",pointerEvents:v?"auto":"none",whiteSpace:"nowrap",
      display:"flex",alignItems:"center",gap:12}}>
    <span>{msg}</span>
    {undo&&v&&<button onClick={undo}
      style={{background:"#c8f135",color:"#0d0d0d",border:"none",borderRadius:7,
        fontWeight:800,fontSize:"0.78rem",padding:"5px 12px",cursor:"pointer",flexShrink:0}}>
      Undo
    </button>}
  </div>
);

const PH  = ({title,sub,action}) => (
  <div style={{padding:"4px 0 20px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
      <div style={{minWidth:0}}>
        <h1 style={{fontSize:"1.7rem",fontWeight:800,color:T.ink,lineHeight:1.15,letterSpacing:"-0.02em"}}>{title}</h1>
        {sub&&<p style={{fontSize:"0.84rem",color:T.inkLight,marginTop:4}}>{sub}</p>}
      </div>
      {action}
    </div>
  </div>
);

const Empty = ({icon,text,sub}) => (
  <div style={{textAlign:"center",padding:"40px 20px"}}>
    <div style={{fontSize:"2.2rem",opacity:.65,marginBottom:10}}>{icon}</div>
    <p style={{fontSize:"0.88rem",color:T.inkMid,fontWeight:500,lineHeight:1.5}}>{text}</p>
    {sub&&<p style={{fontSize:"0.76rem",color:T.inkLight,marginTop:6,lineHeight:1.5}}>{sub}</p>}
  </div>
);

const Divider = () => <div style={{height:1,background:T.lineSoft,margin:"16px 0"}}/>;

// Inline confirmation dialog — replaces window.confirm (blocked in sandboxes)
function ConfirmDialog({msg, onConfirm, onCancel}) {
  return (
    <div style={{
      background:T.roseL,border:`1px solid ${T.rose}33`,borderRadius:12,
      padding:"14px 16px",marginTop:8,
    }}>
      <div style={{fontSize:"0.82rem",color:T.inkMid,marginBottom:12,lineHeight:1.5}}>{msg}</div>
      <div style={{display:"flex",gap:8}}>
        <Btn full v="outline" sm onClick={onCancel}>Cancel</Btn>
        <Btn full v="danger" sm onClick={onConfirm}>Confirm</Btn>
      </div>
    </div>
  );
};

// ─── Food Lookup Database ─────────────────────────────────
const FOOD_DB = [
  // Proteins
  {n:"Chicken breast (100g)",cal:165,pro:31,carb:0,fat:4},
  {n:"Chicken breast (200g)",cal:330,pro:62,carb:0,fat:7},
  {n:"Chicken thigh (100g)",cal:209,pro:26,carb:0,fat:11},
  {n:"Ground beef 85% lean (100g)",cal:215,pro:26,carb:0,fat:13},
  {n:"Ground beef 85% lean (200g)",cal:430,pro:52,carb:0,fat:26},
  {n:"Salmon (100g)",cal:208,pro:20,carb:0,fat:13},
  {n:"Salmon (200g)",cal:416,pro:40,carb:0,fat:26},
  {n:"Tuna canned in water (100g)",cal:116,pro:26,carb:0,fat:1},
  {n:"Shrimp (100g)",cal:99,pro:24,carb:0,fat:0},
  {n:"Turkey breast (100g)",cal:135,pro:30,carb:0,fat:1},
  {n:"Egg (1 large)",cal:72,pro:6,carb:0,fat:5},
  {n:"Egg whites (100g)",cal:52,pro:11,carb:1,fat:0},
  {n:"Greek yogurt plain (170g)",cal:100,pro:17,carb:6,fat:0},
  {n:"Greek yogurt plain (200g)",cal:118,pro:20,carb:7,fat:0},
  {n:"Cottage cheese (100g)",cal:98,pro:11,carb:3,fat:4},
  {n:"Tofu firm (100g)",cal:76,pro:8,carb:2,fat:4},
  {n:"Steak sirloin (100g)",cal:207,pro:26,carb:0,fat:11},
  {n:"Whey protein scoop (30g)",cal:120,pro:25,carb:3,fat:2},
  {n:"Tilapia (100g)",cal:96,pro:20,carb:0,fat:2},
  {n:"Pork tenderloin (100g)",cal:143,pro:26,carb:0,fat:4},
  // Grains & Carbs
  {n:"White rice cooked (100g)",cal:130,pro:3,carb:28,fat:0},
  {n:"White rice cooked (200g)",cal:260,pro:5,carb:56,fat:0},
  {n:"Brown rice cooked (100g)",cal:112,pro:2,carb:23,fat:1},
  {n:"Brown rice cooked (200g)",cal:224,pro:5,carb:47,fat:2},
  {n:"Oats dry (100g)",cal:389,pro:17,carb:66,fat:7},
  {n:"Oats dry (50g)",cal:195,pro:8,carb:33,fat:3},
  {n:"Oatmeal cooked (240g)",cal:166,pro:6,carb:28,fat:4},
  {n:"Pasta cooked (100g)",cal:131,pro:5,carb:25,fat:1},
  {n:"Pasta cooked (200g)",cal:262,pro:9,carb:50,fat:2},
  {n:"Bread white (1 slice 30g)",cal:79,pro:3,carb:15,fat:1},
  {n:"Bread whole wheat (1 slice 30g)",cal:69,pro:4,carb:12,fat:1},
  {n:"Quinoa cooked (100g)",cal:120,pro:4,carb:21,fat:2},
  {n:"Sweet potato (100g)",cal:86,pro:2,carb:20,fat:0},
  {n:"Sweet potato medium (150g)",cal:130,pro:3,carb:30,fat:0},
  {n:"White potato (100g)",cal:77,pro:2,carb:17,fat:0},
  {n:"Tortilla flour (1 medium)",cal:146,pro:4,carb:25,fat:4},
  {n:"Bagel plain (105g)",cal:270,pro:11,carb:52,fat:2},
  {n:"Granola (100g)",cal:471,pro:10,carb:64,fat:20},
  // Vegetables
  {n:"Broccoli (100g)",cal:34,pro:3,carb:7,fat:0},
  {n:"Spinach (100g)",cal:23,pro:3,carb:4,fat:0},
  {n:"Mixed greens (100g)",cal:20,pro:2,carb:3,fat:0},
  {n:"Bell pepper (100g)",cal:31,pro:1,carb:6,fat:0},
  {n:"Avocado (100g)",cal:160,pro:2,carb:9,fat:15},
  {n:"Avocado half (75g)",cal:120,pro:2,carb:6,fat:11},
  {n:"Carrots (100g)",cal:41,pro:1,carb:10,fat:0},
  {n:"Cucumber (100g)",cal:15,pro:1,carb:4,fat:0},
  {n:"Tomato (100g)",cal:18,pro:1,carb:4,fat:0},
  {n:"Edamame (100g)",cal:122,pro:11,carb:10,fat:5},
  {n:"Corn (100g)",cal:96,pro:3,carb:21,fat:1},
  // Fruits
  {n:"Banana medium (120g)",cal:107,pro:1,carb:27,fat:0},
  {n:"Apple medium (182g)",cal:95,pro:0,carb:25,fat:0},
  {n:"Blueberries (100g)",cal:57,pro:1,carb:14,fat:0},
  {n:"Strawberries (100g)",cal:32,pro:1,carb:8,fat:0},
  {n:"Orange medium (131g)",cal:62,pro:1,carb:15,fat:0},
  {n:"Mango (100g)",cal:60,pro:1,carb:15,fat:0},
  // Dairy & Fats
  {n:"Whole milk (240ml)",cal:149,pro:8,carb:12,fat:8},
  {n:"Skim milk (240ml)",cal:83,pro:8,carb:12,fat:0},
  {n:"Almond milk unsweetened (240ml)",cal:30,pro:1,carb:1,fat:3},
  {n:"Cheddar cheese (30g)",cal:114,pro:7,carb:0,fat:9},
  {n:"Mozzarella (30g)",cal:85,pro:6,carb:1,fat:6},
  {n:"Olive oil (1 tbsp 14g)",cal:119,pro:0,carb:0,fat:14},
  {n:"Butter (1 tbsp 14g)",cal:102,pro:0,carb:0,fat:12},
  {n:"Peanut butter (2 tbsp 32g)",cal:190,pro:8,carb:6,fat:16},
  {n:"Almond butter (2 tbsp 32g)",cal:196,pro:7,carb:6,fat:18},
  {n:"Almonds (28g)",cal:164,pro:6,carb:6,fat:14},
  {n:"Walnuts (28g)",cal:185,pro:4,carb:4,fat:18},
  // Legumes
  {n:"Black beans cooked (100g)",cal:132,pro:9,carb:24,fat:1},
  {n:"Chickpeas cooked (100g)",cal:164,pro:9,carb:27,fat:3},
  {n:"Lentils cooked (100g)",cal:116,pro:9,carb:20,fat:0},
  // Common meals
  {n:"Scrambled eggs 2 eggs",cal:182,pro:12,carb:2,fat:14},
  {n:"Protein shake (typical)",cal:160,pro:30,carb:8,fat:3},
  {n:"Chicken & rice bowl",cal:520,pro:45,carb:55,fat:8},
  {n:"Caesar salad with chicken",cal:470,pro:38,carb:18,fat:28},
  {n:"Grilled salmon & veggies",cal:420,pro:42,carb:18,fat:18},
  {n:"Burrito bowl (chipotle style)",cal:650,pro:40,carb:72,fat:18},
  {n:"Overnight oats",cal:350,pro:15,carb:52,fat:8},
  {n:"Avocado toast 2 slices",cal:320,pro:9,carb:34,fat:18},
  {n:"Smoothie protein banana",cal:340,pro:28,carb:45,fat:5},
  {n:"Turkey sandwich",cal:380,pro:28,carb:38,fat:10},
  // Snacks
  {n:"Protein bar (typical)",cal:200,pro:20,carb:22,fat:7},
  {n:"Rice cakes (2 plain)",cal:70,pro:1,carb:15,fat:0},
  {n:"Hummus (2 tbsp 30g)",cal:70,pro:2,carb:6,fat:4},
  {n:"Dark chocolate (30g)",cal:170,pro:2,carb:13,fat:12},
];

// Fuzzy search — score by how many query words appear in food name
const searchFoods = (query) => {
  if (!query || query.trim().length < 2) return [];
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  return FOOD_DB
    .map(f => {
      const name = f.n.toLowerCase();
      const score = words.reduce((s, w) => s + (name.includes(w) ? 1 : 0), 0);
      return { ...f, score };
    })
    .filter(f => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
};

function EstimateBtn({name, ingr, servings, onResult, onIngredient}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // When ingredients exist, try to estimate by summing matched ingredients
  const estimateFromIngredients = () => {
    if (!ingr?.trim()) return;
    const lines = ingr.split("\n").filter(l => l.trim());
    let total = {cal:0, pro:0, carb:0, fat:0};
    let matched = 0;
    lines.forEach(line => {
      const results = searchFoods(line);
      if (results.length > 0) {
        total.cal += results[0].cal;
        total.pro += results[0].pro;
        total.carb += results[0].carb;
        total.fat += results[0].fat;
        matched++;
      }
    });
    if (matched > 0) {
      const srv = parseFloat(servings) || 1;
      onResult({
        cal: Math.round(total.cal / srv),
        pro: Math.round(total.pro / srv),
        carb: Math.round(total.carb / srv),
        fat: Math.round(total.fat / srv),
      });
    }
  };

  const results = searchFoods(query || name || "");

  return (
    <div style={{marginBottom:12}}>
      <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.inkLight,marginBottom:6}}>Look up food nutrition</div>
      <div style={{position:"relative"}}>
        <input
          value={query}
          onChange={e=>{setQuery(e.target.value);setOpen(true);}}
          onFocus={()=>setOpen(true)}
          onBlur={()=>setTimeout(()=>setOpen(false),200)}
          placeholder={name||"Search: chicken breast, oats, salmon…"}
          style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1px solid ${open?T.slate:T.line}`,fontSize:"1rem",color:T.ink,background:T.paper,outline:"none",boxSizing:"border-box",transition:"border-color .15s"}}
        />
        {open && results.length > 0 && (
          <div style={{position:"fixed",left:18,right:18,background:T.paper,border:`1px solid ${T.line}`,borderRadius:12,zIndex:200,boxShadow:"0 8px 32px rgba(0,0,0,.7)",marginTop:4,maxHeight:220,overflowY:"auto"}}>
            {results.map((f,i)=>(
              <div key={i} onClick={()=>{
                onResult({cal:f.cal,pro:f.pro,carb:f.carb,fat:f.fat});
                if(onIngredient) onIngredient(f.n);
                setQuery(""); setOpen(false);
              }} style={{padding:"10px 14px",borderBottom:`1px solid ${T.lineSoft}`,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:"0.84rem",color:T.ink,flex:1}}>{f.n}</span>
                <span style={{fontSize:"0.68rem",color:T.inkLight,marginLeft:8,whiteSpace:"nowrap"}}>{f.cal} cal · P{f.pro} C{f.carb} F{f.fat}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {ingr?.trim()&&<button onClick={estimateFromIngredients}
        style={{marginTop:8,width:"100%",padding:"8px",borderRadius:8,border:"1px solid #c8f13544",background:"#1e2a00",color:"#c8f135",fontSize:"0.78rem",fontWeight:600,cursor:"pointer"}}>
        ✦ Auto-estimate from ingredients list
      </button>}
    </div>
  );
}

// ─── InlineTip — unified coach banner used across all tabs ──────
// type: "focus" | "workouts" | "nutrition" | "recovery"
// Appears at TOP of page, below header. Collapsible. Premium dark treatment.
function InlineTip({s, type, insights: precomputed}) {
  const [collapsed, setCollapsed] = useState(false);

  // Use pre-computed insights if provided, otherwise compute (fallback)
  const pick = () => {
    const all = precomputed || buildInsights(s, "week");

    if (type === "focus") {
      const warns = all.filter(i=>i.sentiment==="warn");
      const goods = all.filter(i=>i.sentiment==="good"&&i.type==="focus");
      return (warns[0] || goods[0] || all[0]) || null;
    }

    const typed = all.filter(i=>i.type===type);
    const sorted = [...typed].sort((a,b)=>{
      const rank={warn:0,good:1,neutral:2};
      return (rank[a.sentiment]||2)-(rank[b.sentiment]||2);
    });
    return sorted[0] || null;
  };

  const ins = pick();
  if (!ins) return null;

  // Accent colors per sentiment
  const accentColor = ins.sentiment==="warn" ? "#ffaa00"
    : ins.sentiment==="good" ? "#4cffb0"
    : "#c8f135";

  return (
    <div style={{
      margin:"0 -18px",
      borderBottom:`1px solid ${accentColor}22`,
      background:`linear-gradient(135deg,${accentColor}12 0%,${accentColor}06 100%)`,
      marginBottom:14,
    }}>
      {/* Header row — always visible */}
      <div
        onClick={()=>setCollapsed(p=>!p)}
        style={{
          display:"flex",alignItems:"center",gap:10,
          padding:"9px 18px",
          cursor:"pointer",
        }}
      >
        {/* ✦ Coach badge */}
        <div style={{
          display:"flex",alignItems:"center",gap:5,
          background:accentColor+"20",
          border:`1px solid ${accentColor}44`,
          borderRadius:20,padding:"2px 9px",flexShrink:0,
        }}>
          <span style={{fontSize:"0.65rem",color:accentColor}}>✦</span>
          <span style={{fontSize:"0.58rem",fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:accentColor}}>Coach</span>
        </div>
        {/* Icon + title inline */}
        <span style={{fontSize:"0.85rem",flexShrink:0}}>{ins.icon}</span>
        <span style={{
          fontSize:"0.78rem",fontWeight:600,color:T.ink,
          flex:1,minWidth:0,
          overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",
        }}>{ins.title}</span>
        {/* Collapse chevron */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke={accentColor} strokeWidth="2.5" strokeLinecap="round"
          style={{flexShrink:0,transition:"transform .2s",transform:collapsed?"rotate(-90deg)":"rotate(0deg)"}}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {/* Body — collapsible */}
      {!collapsed&&(
        <div style={{padding:"0 18px 12px 46px"}}>
          <div style={{fontSize:"0.76rem",color:T.inkMid,lineHeight:1.6}}>{ins.text}</div>
        </div>
      )}
    </div>
  );
}

// ─── Onboarding ──────────────────────────────────────────
function Onboarding({D}) {
  const [step, setStep] = useState(0);
  const [f, sf] = useState({
    name:"", primaryGoal:"general", weeklyTarget:4,
    fitnessLevel:"intermediate", age:"", weightLbs:"", heightIn:"",
  });

  const goals = [
    {k:"general",    icon:"⚡", label:"General fitness",    sub:"Stay active and feel great"},
    {k:"weight",     icon:"⚖️", label:"Weight management",  sub:"Lose or maintain weight"},
    {k:"performance",icon:"🏆", label:"Performance",        sub:"Get faster, stronger, fitter"},
    {k:"consistency",icon:"🔥", label:"Build a habit",      sub:"Show up consistently"},
  ];
  const levels = [
    {k:"beginner",    label:"Just starting out"},
    {k:"intermediate",label:"Training regularly"},
    {k:"advanced",    label:"Competing or coaching"},
  ];

  const finish = () => {
    D({t:"UPD_PROFILE", profile:{
      name:f.name.trim(),
      primaryGoal:f.primaryGoal,
      weeklyTarget:f.weeklyTarget,
      fitnessLevel:f.fitnessLevel,
      age:f.age,
      weightLbs:f.weightLbs,
      heightIn:f.heightIn,
    }});
    D({t:"ONBOARDED"});
  };

  const screens = [
    // Screen 0 — Welcome + name
    <div key="s0" className="fu" style={{display:"flex",flexDirection:"column",height:"100%",padding:"0 24px"}}>
      <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",textAlign:"center"}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"3.5rem",fontWeight:900,
          color:"#c8f135",letterSpacing:"0.18em",marginBottom:8}}>PULSE</div>
        <div style={{fontSize:"1.1rem",fontWeight:600,color:"var(--ink)",marginBottom:8}}>
          Your personal fitness OS
        </div>
        <div style={{fontSize:"0.84rem",color:"var(--ink-mid)",lineHeight:1.6,maxWidth:280,marginBottom:40}}>
          Track workouts, nutrition, and health in one place. Smart coaching that learns your patterns.
        </div>
        <div style={{width:"100%",marginBottom:16}}>
          <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
            color:"var(--ink-light)",marginBottom:6,textAlign:"left"}}>Your name (optional)</div>
          <input value={f.name} onChange={e=>sf(p=>({...p,name:e.target.value}))}
            placeholder="How should we call you?"
            maxLength={30}
            style={{width:"100%",padding:"14px 16px",borderRadius:14,border:"1.5px solid var(--line)",
              background:"var(--paper)",color:"var(--ink)",fontSize:"16px",outline:"none",
              boxSizing:"border-box",transition:"border-color .15s"}}
            onFocus={e=>e.target.style.borderColor="#c8f135"}
            onBlur={e=>e.target.style.borderColor="var(--line)"}
          />
        </div>
      </div>
      <button onClick={()=>setStep(1)} style={{width:"100%",padding:"16px",borderRadius:14,
        background:"#c8f135",color:"#0d0d0d",fontWeight:800,fontSize:"1rem",border:"none",
        cursor:"pointer",marginBottom:40,letterSpacing:"0.02em"}}>
        Get started →
      </button>
    </div>,

    // Screen 1 — Primary goal
    <div key="s1" className="fu" style={{display:"flex",flexDirection:"column",height:"100%",padding:"0 24px"}}>
      <div style={{paddingTop:48,paddingBottom:24}}>
        <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
          color:"#c8f135",marginBottom:8}}>Step 2 of 3</div>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
          color:"var(--ink)",letterSpacing:"0.02em",textTransform:"uppercase",lineHeight:1.1,marginBottom:6}}>
          What's your main goal?
        </div>
        <div style={{fontSize:"0.84rem",color:"var(--ink-mid)"}}>
          This shapes your coaching tips. You can change it any time.
        </div>
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:10}}>
        {goals.map(g=>(
          <button key={g.k} onClick={()=>sf(p=>({...p,primaryGoal:g.k}))}
            style={{padding:"16px 18px",borderRadius:14,border:`1.5px solid ${f.primaryGoal===g.k?"#c8f135":"var(--line)"}`,
              background:f.primaryGoal===g.k?"#1e2a00":"var(--paper)",cursor:"pointer",
              display:"flex",alignItems:"center",gap:14,textAlign:"left",transition:"all .15s"}}>
            <span style={{fontSize:"1.6rem"}}>{g.icon}</span>
            <div>
              <div style={{fontWeight:700,fontSize:"0.92rem",color:"var(--ink)"}}>{g.label}</div>
              <div style={{fontSize:"0.76rem",color:"var(--ink-mid)",marginTop:2}}>{g.sub}</div>
            </div>
            {f.primaryGoal===g.k&&<div style={{marginLeft:"auto",color:"#c8f135",fontSize:"1.2rem"}}>✓</div>}
          </button>
        ))}
      </div>
      <div style={{display:"flex",gap:10,padding:"24px 0 40px"}}>
        <button onClick={()=>setStep(0)} style={{flex:1,padding:"14px",borderRadius:14,
          border:"1.5px solid var(--line)",background:"transparent",color:"var(--ink-mid)",
          fontWeight:600,fontSize:"0.92rem",cursor:"pointer"}}>← Back</button>
        <button onClick={()=>setStep(2)} style={{flex:2,padding:"14px",borderRadius:14,
          background:"#c8f135",color:"#0d0d0d",fontWeight:800,fontSize:"0.92rem",
          border:"none",cursor:"pointer"}}>Continue →</button>
      </div>
    </div>,

    // Screen 2 — Fitness level + weekly target + optional body stats
    <div key="s2" className="fu" style={{display:"flex",flexDirection:"column",height:"100%",padding:"0 24px",overflowY:"auto"}}>
      <div style={{paddingTop:48,paddingBottom:24}}>
        <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
          color:"#c8f135",marginBottom:8}}>Step 3 of 3</div>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
          color:"var(--ink)",letterSpacing:"0.02em",textTransform:"uppercase",lineHeight:1.1,marginBottom:6}}>
          A little about you
        </div>
        <div style={{fontSize:"0.84rem",color:"var(--ink-mid)"}}>
          Helps us personalise your insights. All optional.
        </div>
      </div>

      {/* Fitness level */}
      <div style={{marginBottom:20}}>
        <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
          color:"var(--ink-light)",marginBottom:8}}>Fitness level</div>
        <div style={{display:"flex",gap:8}}>
          {levels.map(l=>(
            <button key={l.k} onClick={()=>sf(p=>({...p,fitnessLevel:l.k}))}
              style={{flex:1,padding:"10px 8px",borderRadius:12,
                border:`1.5px solid ${f.fitnessLevel===l.k?"#c8f135":"var(--line)"}`,
                background:f.fitnessLevel===l.k?"#1e2a00":"var(--paper)",
                color:f.fitnessLevel===l.k?"#c8f135":"var(--ink-mid)",
                fontSize:"0.72rem",fontWeight:f.fitnessLevel===l.k?700:500,
                cursor:"pointer",transition:"all .15s",lineHeight:1.3}}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Weekly target */}
      <div style={{marginBottom:20}}>
        <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
          color:"var(--ink-light)",marginBottom:8}}>Sessions per week I aim for</div>
        <div style={{display:"flex",gap:8}}>
          {[2,3,4,5,6].map(n=>(
            <button key={n} onClick={()=>sf(p=>({...p,weeklyTarget:n}))}
              style={{flex:1,padding:"12px 4px",borderRadius:12,
                border:`1.5px solid ${f.weeklyTarget===n?"#c8f135":"var(--line)"}`,
                background:f.weeklyTarget===n?"#1e2a00":"var(--paper)",
                color:f.weeklyTarget===n?"#c8f135":"var(--ink-mid)",
                fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.2rem",fontWeight:800,
                cursor:"pointer",transition:"all .15s"}}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Optional stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>
        {[
          {k:"age",       label:"Age",       placeholder:"28",  type:"number"},
          {k:"weightLbs", label:"Weight lbs",placeholder:"165", type:"number"},
          {k:"heightIn",  label:"Height in", placeholder:"70",  type:"number"},
        ].map(({k,label,placeholder,type})=>(
          <div key={k}>
            <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
              color:"var(--ink-light)",marginBottom:5}}>{label}</div>
            <input type={type} value={f[k]} onChange={e=>sf(p=>({...p,[k]:e.target.value}))}
              placeholder={placeholder} maxLength={4}
              style={{width:"100%",padding:"12px 10px",borderRadius:12,border:"1.5px solid var(--line)",
                background:"var(--paper)",color:"var(--ink)",fontSize:"16px",outline:"none",
                textAlign:"center",boxSizing:"border-box"}}
              onFocus={e=>e.target.style.borderColor="#c8f135"}
              onBlur={e=>e.target.style.borderColor="var(--line)"}
            />
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:10,paddingBottom:40}}>
        <button onClick={()=>setStep(1)} style={{flex:1,padding:"14px",borderRadius:14,
          border:"1.5px solid var(--line)",background:"transparent",color:"var(--ink-mid)",
          fontWeight:600,fontSize:"0.92rem",cursor:"pointer"}}>← Back</button>
        <button onClick={finish} style={{flex:2,padding:"14px",borderRadius:14,
          background:"#c8f135",color:"#0d0d0d",fontWeight:800,fontSize:"0.92rem",
          border:"none",cursor:"pointer"}}>Let's go 🚀</button>
      </div>
    </div>,
  ];

  return (
    <div style={{maxWidth:430,margin:"0 auto",height:"100vh",background:"var(--bg)",
      display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{G_CSS}</style>
      {/* Progress dots */}
      <div style={{display:"flex",gap:6,justifyContent:"center",paddingTop:16,flexShrink:0}}>
        {[0,1,2].map(i=>(
          <div key={i} style={{width:i===step?24:6,height:6,borderRadius:3,
            background:i===step?"#c8f135":i<step?"#c8f13560":"var(--line)",
            transition:"all .3s"}}/>
        ))}
      </div>
      <div style={{flex:1,overflow:"hidden"}}>
        {screens[step]}
      </div>
    </div>
  );
}

// ─── Pages ────────────────────────────────────────────────

function Dashboard({s,D,toast,insights}) {
  const wk=getWk();
  const wkW=s.workouts.filter(w=>wk.includes(w.date));
  const todayBurn=s.workouts.filter(w=>w.date===TODAY).reduce((a,w)=>a+(w.cals||0),0);
  const todayEaten=useMemo(()=>{const{cal}=sumM(s.meals[TODAY]||{});return cal;},[s.meals]);
  const netCals = todayEaten>0||todayBurn>0 ? todayEaten - todayBurn : null;
  const ozToday=s.water[TODAY]||0;
  const ozGoal=s.waterGoal||64;
  const hr=new Date().getHours();
  const greet=hr<12?"Good morning":hr<17?"Good afternoon":"Good evening";
  const [wkExpanded,setWkExpanded]=useState(false);
  const [waterOpen,setWaterOpen]=useState(false);
  const [streakFilter,setStreakFilter]=useState("all");
  const [timeFilter,setTimeFilter]=useState("all"); // all | year | month | week | day

  // ── Streak calculation — uses grace day helper (1 rest day allowed) ──
  const streak = useMemo(()=>calcStreak(s.workouts, true), [s.workouts]);

  // ── Activity type counts — sorted by frequency, top 3 first then alpha ──
  const activityCounts=(()=>{
    const counts={};
    s.workouts.forEach(w=>{counts[w.type]=(counts[w.type]||0)+1;});
    const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    const top3=sorted.slice(0,3).map(([t])=>t);
    const rest=sorted.slice(3).map(([t])=>t).sort();
    return{top3,rest,all:[...top3,...rest],counts};
  })();

  // ── Totals for selected activity filter ──
  // Date cutoffs for time filter
  const timeCutoff=(()=>{
    const d=new Date();
    if(timeFilter==="day") { return localDate(d); }
    if(timeFilter==="week") { const w=new Date(d); w.setDate(d.getDate()-6); return localDate(w); }
    if(timeFilter==="month") { const m=new Date(d); m.setDate(d.getDate()-29); return localDate(m); }
    if(timeFilter==="year") { const y=new Date(d); y.setFullYear(d.getFullYear()-1); return localDate(y); }
    return null;
  })();
  const filteredW=s.workouts
    .filter(w=>streakFilter==="all"||w.type===streakFilter)
    .filter(w=>!timeCutoff||w.date>=timeCutoff);
  const totalSessions=filteredW.length;
  const totalMi=filteredW.reduce((a,w)=>a+(parseFloat(w.dist)||0),0);
  const totalMin=filteredW.reduce((a,w)=>a+(parseInt(w.dur)||0),0);
  const totalCalBurned=filteredW.reduce((a,w)=>a+(parseInt(w.cals)||0),0);

  // ── Personal records — memoized, only recomputes when workouts change ──
  const PRs = useMemo(()=>{
    const runs=[...s.workouts].filter(w=>w.type==="🏃 Run"&&parseFloat(w.dist)>0).sort((a,b)=>b.date.localeCompare(a.date));
    const rides=[...s.workouts].filter(w=>w.type==="🚴 Ride"&&parseFloat(w.dist)>0).sort((a,b)=>b.date.localeCompare(a.date));
    const allCals=[...s.workouts].filter(w=>w.cals>0).sort((a,b)=>b.cals-a.cals);
    const allDur=[...s.workouts].filter(w=>parseInt(w.dur)>0).sort((a,b)=>parseInt(b.dur)-parseInt(a.dur));
    const longestRunW=runs.length?runs.reduce((best,w)=>parseFloat(w.dist)>parseFloat(best.dist)?w:best):null;
    const longestRideW=rides.length?rides.reduce((best,w)=>parseFloat(w.dist)>parseFloat(best.dist)?w:best):null;
    return{
      longestRun:  longestRunW?parseFloat(longestRunW.dist):null,
      longestRunDate: longestRunW?.date||null,
      longestRide: longestRideW?parseFloat(longestRideW.dist):null,
      longestRideDate: longestRideW?.date||null,
      mostCals:    allCals.length?allCals[0].cals:null,
      mostCalsDate: allCals[0]?.date||null,
      longestSesh: allDur.length?parseInt(allDur[0].dur):null,
      longestSeshDate: allDur[0]?.date||null,
    };
  }, [s.workouts]);

  // Week activity grid
  const activityDays=wk.map(d=>{
    const ws=s.workouts.filter(w=>w.date===d);
    return{d,ws,lbl:["S","M","T","W","T","F","S"][new Date(d+"T12:00").getDay()],isToday:d===TODAY};
  });

  return (
    <div className="fu">
      <div style={{padding:"12px 0 10px",display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
        <h1 style={{fontFamily:"'Barlow Condensed','DM Sans',sans-serif",fontSize:"1.6rem",fontWeight:900,color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>{greet}</h1>
        <span style={{fontSize:"0.68rem",color:T.inkLight,letterSpacing:"0.06em",textTransform:"uppercase"}}>{new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}).toUpperCase()}</span>
      </div>

      {/* ── AI Coach tip — focus, top of page ── */}
      <InlineTip s={s} type="focus" insights={insights}/>

      {/* ── Streak banner ── */}
      <div style={{background:"var(--hero-grad)",borderRadius:18,marginBottom:10,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,.6)"}}>

        {/* TOP HALF — streak + activity filter */}
        <div style={{padding:"20px 20px 16px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(200,241,53,.6)"}}>Workout streak</div>
            {activityCounts.all.length>0&&(
              <select value={streakFilter} onChange={e=>setStreakFilter(e.target.value)}
                style={{background:"rgba(255,255,255,.1)",border:"1px solid rgba(160,210,240,.2)",borderRadius:8,color:"rgba(160,210,240,.9)",fontSize:"0.74rem",fontWeight:600,padding:"4px 10px",outline:"none",cursor:"pointer"}}>
                <option value="all">All activities</option>
                {activityCounts.top3.length>0&&<optgroup label="— Most frequent">
                  {activityCounts.top3.map(t=><option key={t} value={t}>{t} ({activityCounts.counts[t]})</option>)}
                </optgroup>}
                {activityCounts.rest.length>0&&<optgroup label="— Other">
                  {activityCounts.rest.map(t=><option key={t} value={t}>{t} ({activityCounts.counts[t]})</option>)}
                </optgroup>}
              </select>
            )}
          </div>
          <div style={{display:"flex",alignItems:"flex-end",gap:6,marginBottom:6}}>
            <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"4rem",fontWeight:900,lineHeight:1,letterSpacing:"-0.02em",color:streak>0?"#c8f135":"rgba(200,241,53,.2)"}}>{streak}</span>
            <span style={{fontSize:"1rem",color:"rgba(200,241,53,.5)",fontWeight:500,paddingBottom:8,letterSpacing:"0.02em"}}>{streak===1?"DAY":"DAYS"}</span>
          </div>
          <div style={{fontSize:"0.78rem",color:"rgba(200,241,53,.6)",letterSpacing:"0.02em"}}>
            {streak===0?"Log a workout to start your streak":streak<3?"Keep it going.":streak<7?"Great consistency.":streak<14?"On fire.":"Unstoppable."}
          </div>
        </div>

        {/* DIVIDER */}
        <div style={{height:1,background:"rgba(200,241,53,.1)"}}/>

        {/* BOTTOM HALF — time-filtered totals + time dropdown */}
        <div style={{padding:"14px 20px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(200,241,53,.5)"}}>Totals</div>
            <select value={timeFilter} onChange={e=>setTimeFilter(e.target.value)}
              style={{background:"rgba(255,255,255,.1)",border:"1px solid rgba(160,210,240,.2)",borderRadius:8,color:"rgba(160,210,240,.9)",fontSize:"0.74rem",fontWeight:600,padding:"4px 10px",outline:"none",cursor:"pointer"}}>
              <option value="all">All time</option>
              <option value="year">Past year</option>
              <option value="month">Past month</option>
              <option value="week">Past week</option>
              <option value="day">Today</option>
            </select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[
              {v:totalSessions,l:"sessions"},
              {v:totalMi>0?totalMi.toFixed(1):"—",l:"miles"},
              {v:totalMin>0?(totalMin>=60?`${Math.floor(totalMin/60)}h ${totalMin%60}m`:totalMin+"m"):"—",l:"time"},
              {v:totalCalBurned>0?totalCalBurned.toLocaleString():"—",l:"cal burned"},
            ].map(x=>(
              <div key={x.l}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.8rem",fontWeight:800,color:x.v==="—"?"rgba(200,241,53,.15)":"rgba(245,245,245,.95)",lineHeight:1,letterSpacing:"-0.01em"}}>{x.v}</div>
                <div style={{fontSize:"0.58rem",fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(200,241,53,.4)",marginTop:3}}>{x.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Workouts this week — circular arc badges ── */}
      <div onClick={()=>setWkExpanded(p=>!p)} className="pressable" style={{background:T.paper,border:`1px solid ${wkExpanded?"#c8f135":T.line}`,borderRadius:16,padding:"16px",marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,.4)",cursor:"pointer",transition:"border-color .2s"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div>
            <div style={{fontSize:"0.58rem",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"#c8f135",marginBottom:6}}>This week</div>
            <div style={{display:"flex",alignItems:"baseline",gap:8}}>
              <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2.8rem",fontWeight:900,color:T.ink,lineHeight:1,letterSpacing:"-0.01em"}}>{wkW.length}</span>
              <span style={{fontSize:"0.82rem",color:T.inkLight}}>sessions · {wkW.reduce((a,w)=>a+(parseInt(w.dur)||0),0)} min</span>
            </div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.inkLight} strokeWidth="2" strokeLinecap="round" style={{transition:"transform .2s",transform:wkExpanded?"rotate(180deg)":"none"}}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        {(()=>{
          const maxDur=Math.max(...activityDays.map(d=>d.ws.reduce((a,w)=>a+(parseInt(w.dur)||0),0)),1)||1;
          return (
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
              {activityDays.map((day,i)=>{
                const totalMin=day.ws.reduce((a,w)=>a+(parseInt(w.dur)||0),0);
                const pct=Math.round(totalMin/maxDur*100);
                const ac=day.ws.length>0?actColor(day.ws[0].type):null;
                const color=ac?ac.accent:T.lineSoft;
                const r=16,circ=2*Math.PI*r;
                const dash=circ*(1-pct/100);
                return (
                  <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                    <div style={{position:"relative",width:40,height:40,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <svg width="40" height="40" viewBox="0 0 40 40" style={{position:"absolute",top:0,left:0,transform:"rotate(-90deg)"}}>
                        <circle cx="20" cy="20" r={r} fill="none" stroke={T.lineSoft} strokeWidth="3"/>
                        {day.ws.length>0&&<circle cx="20" cy="20" r={r} fill="none" stroke={color}
                          strokeWidth="3" strokeDasharray={circ} strokeDashoffset={dash}
                          strokeLinecap="round" style={{transition:"stroke-dashoffset .6s ease"}}/>}
                      </svg>
                      <div style={{width:26,height:26,borderRadius:"50%",background:ac?ac.bg:T.paperAlt,
                        border:day.isToday?`1.5px solid ${ac?color:"#c8f135"}`:"none",
                        display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.8rem"}}>
                        {day.ws.length>0?day.ws[0].type.split(" ")[0]:""}
                      </div>
                    </div>
                    <span style={{fontSize:"0.5rem",fontWeight:day.isToday?800:500,
                      letterSpacing:"0.06em",textTransform:"uppercase",
                      color:day.isToday?"#c8f135":day.ws.length>0?color:T.inkLight}}>
                      {day.lbl}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}
        {wkExpanded&&<div style={{marginTop:14,borderTop:`1px solid ${T.lineSoft}`,paddingTop:12}}>
          {wkW.length>0?[...wkW].sort((a,b)=>b.date.localeCompare(a.date)).map((w,i,arr)=>(
            <div key={w.id} style={{padding:"10px 0",borderBottom:i<arr.length-1?`1px solid ${T.lineSoft}`:"none"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{fontWeight:600,fontSize:"0.9rem",color:T.ink}}>{w.type.split(" ")[0]} {w.name}</div>
                {w.cals>0&&<span style={{fontSize:"0.72rem",fontWeight:700,color:T.red}}>{w.cals} cal</span>}
              </div>
              <div style={{fontSize:"0.68rem",color:T.inkLight,marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                <span>{fmtD(w.date)}</span>
                {hasDur(w.dur)&&<span>⏱ {w.dur} min</span>}
                {hasDist(w.dist)&&<span>📍 {w.dist} mi</span>}
                {hasHR(w.hr)&&<span>❤️ {w.hr} bpm</span>}
              </div>
            </div>
          )):<div style={{fontSize:"0.84rem",color:T.inkMid,fontWeight:500,paddingTop:4}}>No workouts this week yet.</div>}
        </div>}
      </div>

      {/* ── Active cal + Water in oz ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <div className="pressable" style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:16,padding:"16px",boxShadow:"0 2px 8px rgba(0,0,0,.4)"}}>
          <div style={{fontSize:"0.58rem",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:T.red,marginBottom:8}}>
            {netCals!==null?"Net cal":"Active cal"}
          </div>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2.2rem",fontWeight:800,lineHeight:1,letterSpacing:"-0.01em",
            color:netCals!==null?(netCals<0?T.green:netCals>500?T.orange:T.ink):T.ink}}>
            {netCals!==null?(netCals>0?"+":"")+netCals.toLocaleString():todayBurn.toLocaleString()}
          </div>
          <div style={{fontSize:"0.7rem",color:T.inkLight,marginTop:5,letterSpacing:"0.02em"}}>
            {netCals!==null?`${todayEaten} eaten · ${todayBurn} burned`:"burned today"}
          </div>
        </div>
        <div onClick={()=>setWaterOpen(p=>!p)} className="pressable"
          style={{background:T.paper,border:`1px solid ${waterOpen?"#c8f135":T.line}`,borderRadius:16,padding:"16px",boxShadow:"0 2px 8px rgba(0,0,0,.4)",cursor:"pointer",transition:"border-color .15s"}}>
          <div style={{fontSize:"0.58rem",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"#c8f135",marginBottom:8}}>Water</div>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2.2rem",fontWeight:800,color:T.ink,lineHeight:1,letterSpacing:"-0.01em"}}>{ozToday}<span style={{fontSize:"1rem",color:T.inkLight,fontWeight:500,letterSpacing:"0"}}>oz</span></div>
          <div style={{fontSize:"0.7rem",color:T.inkLight,marginTop:5,letterSpacing:"0.02em"}}>of {ozGoal}oz goal</div>
          {waterOpen&&<div onClick={e=>e.stopPropagation()} style={{marginTop:12}}>
            <input
              type="range" min={0} max={ozGoal} step={1} value={ozToday}
              onChange={e=>D({t:"WATER",v:{...s.water,[TODAY]:parseInt(e.target.value)}})}
              style={{width:"100%",cursor:"pointer",height:6,borderRadius:99,background:`linear-gradient(to right,${T.blue} ${Math.round(ozToday/ozGoal*100)}%,#e5e5ea ${Math.round(ozToday/ozGoal*100)}%)`}}
            />
          </div>}
        </div>
      </div>

      {/* ── Personal Records ── */}
      {(PRs.longestRun||PRs.longestRide||PRs.mostCals||PRs.longestSesh)&&(
        <div style={{marginBottom:10}}>
          <SecH>Personal Records</SecH>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[
              PRs.longestRun  &&{label:"Longest Run",  val:`${PRs.longestRun} mi`,  icon:"🏃",color:T.green, date:PRs.longestRunDate},
              PRs.longestRide &&{label:"Longest Ride", val:`${PRs.longestRide} mi`, icon:"🚴",color:T.blue,  date:PRs.longestRideDate},
              PRs.mostCals    &&{label:"Most Cal Burn",val:`${PRs.mostCals} cal`,    icon:"🔥",color:T.red,   date:PRs.mostCalsDate},
              PRs.longestSesh &&{label:"Longest Session",val:`${PRs.longestSesh} min`,icon:"⏱",color:T.purple,date:PRs.longestSeshDate},
            ].filter(Boolean).map((pr,i)=>(
              <div key={i} className="pressable" style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:14,padding:"14px",boxShadow:"0 2px 8px rgba(0,0,0,.4)"}}>
                <div style={{fontSize:"1.2rem",marginBottom:6}}>{pr.icon}</div>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.5rem",fontWeight:800,color:pr.color,lineHeight:1,letterSpacing:"0"}}>{pr.val}</div>
                <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.inkLight,marginTop:4}}>{pr.label}</div>
                {pr.date&&<div style={{fontSize:"0.6rem",color:T.inkMid,marginTop:3}}>{new Date(pr.date+"T12:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"})}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Urgent Goals ── */}
      {(()=>{
        const urgentGoals=s.goals.filter(g=>{
          if(!g.date) return false;
          const daysLeft=Math.round((new Date(g.date+"T12:00")-new Date())/(1000*60*60*24));
          const pct=Math.min(100,Math.round((g.curr||0)/g.target*100));
          return daysLeft<=3&&pct<100;
        }).sort((a,b)=>a.date.localeCompare(b.date));
        if(!urgentGoals.length) return null;
        return (
          <div style={{background:T.orangeL,border:`1px solid ${T.orange}33`,borderRadius:14,padding:"14px 16px",marginBottom:10}}>
            <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.orange,marginBottom:10}}>⚡ Goals need attention</div>
            {urgentGoals.map(g=>{
              const daysLeft=Math.round((new Date(g.date+"T12:00")-new Date())/(1000*60*60*24));
              const pct=Math.min(100,Math.round((g.curr||0)/g.target*100));
              return (
                <div key={g.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${T.lineSoft}`}}>
                  <div>
                    <div style={{fontWeight:600,fontSize:"0.88rem",color:T.ink}}>{g.name}</div>
                    <div style={{fontSize:"0.7rem",color:daysLeft<0?T.red:T.orange,fontWeight:600,marginTop:2}}>{daysLeft<0?"Overdue":daysLeft===0?"Due today":`${daysLeft}d left`} · {pct}% complete</div>
                  </div>
                  <div style={{height:32,width:32,borderRadius:"50%",background:`conic-gradient(${daysLeft<0?T.red:T.orange} ${pct*3.6}deg,${T.lineSoft} 0deg)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <div style={{height:22,width:22,borderRadius:"50%",background:T.paper,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.52rem",fontWeight:800,color:T.inkMid}}>{pct}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}


    </div>
  );
}

// FocusBanner removed — replaced by InlineTip with type='focus'


// ── TodayWorkoutCard — extracted so useState is at component top level ──
function TodayWorkoutCard({w, isFirst, onLogAgain, onDelete, detail, setDetail}) {
  const [expanded, setExpanded] = useState(isFirst);
  const ac = actColor(w.type);
  const avgHR = hasHR(w.hr) ? parseInt(w.hr) : 0;
  const dur = parseInt(w.dur) || 0;
  const pts = avgHR>0&&dur>0 ? Array.from({length:16},(_,i)=>{
    const x=i/15;
    const bell=x<.15?x/.15:.85+Math.sin((x-.15)/.7*Math.PI)*.15;
    return Math.round(avgHR*(.82+bell*.18)+(Math.sin(i*7.3)*3));
  }) : [];
  const maxPt = pts.length ? Math.max(...pts) : 0;
  const minPt = pts.length ? Math.min(...pts) : 0;

  return (
    <div style={{
      background:`linear-gradient(135deg,${ac.bg} 0%,#161616 100%)`,
      border:`1.5px solid ${ac.accent}55`,
      borderRadius:18,overflow:"hidden",
      boxShadow:`0 4px 24px ${ac.accent}18`,
    }}>
      {/* Header */}
      <div onClick={()=>setExpanded(p=>!p)}
        style={{padding:"16px 18px",cursor:"pointer",display:"flex",gap:14,alignItems:"flex-start"}}>
        <div style={{width:48,height:48,borderRadius:14,flexShrink:0,
          background:ac.accent+"22",border:`1px solid ${ac.accent}44`,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.5rem"}}>
          {w.type.split(" ")[0]}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
            <div style={{fontWeight:700,fontSize:"1rem",color:T.ink,lineHeight:1.2}}>{w.name}</div>
            {w.cals>0&&<div style={{fontFamily:"'Barlow Condensed',sans-serif",
              fontSize:"1rem",fontWeight:800,color:ac.accent,flexShrink:0,lineHeight:1}}>
              {w.cals}<span style={{fontSize:"0.6rem",fontWeight:600,marginLeft:2}}>CAL</span>
            </div>}
          </div>
          <div style={{fontSize:"0.72rem",color:ac.accent,fontWeight:600,
            letterSpacing:"0.06em",textTransform:"uppercase",marginTop:4,opacity:.8}}>
            {w.type.split(" ").slice(1).join(" ")}
          </div>
          <div style={{display:"flex",gap:12,marginTop:8,flexWrap:"wrap"}}>
            {hasDur(w.dur)&&<div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:"0.65rem",color:T.inkLight}}>⏱</span>
              <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"0.95rem",fontWeight:700,color:T.ink}}>
                {w.dur}<span style={{fontSize:"0.6rem",color:T.inkLight,marginLeft:1}}>min</span>
              </span>
            </div>}
            {hasDist(w.dist)&&<div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:"0.65rem",color:T.inkLight}}>📍</span>
              <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"0.95rem",fontWeight:700,color:T.ink}}>
                {w.dist}<span style={{fontSize:"0.6rem",color:T.inkLight,marginLeft:1}}>mi</span>
              </span>
            </div>}
            {hasHR(w.hr)&&<div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:"0.65rem",color:T.red}}>❤️</span>
              <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"0.95rem",fontWeight:700,color:T.ink}}>
                {w.hr}<span style={{fontSize:"0.6rem",color:T.inkLight,marginLeft:1}}>bpm</span>
              </span>
            </div>}
            {hasPace(w.pace)&&<div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:"0.65rem",color:T.inkLight}}>🏃</span>
              <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"0.95rem",fontWeight:700,color:T.ink}}>{w.pace}</span>
            </div>}
          </div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke={T.inkLight} strokeWidth="2.5" strokeLinecap="round"
          style={{flexShrink:0,marginTop:4,transition:"transform .2s",transform:expanded?"rotate(180deg)":"none"}}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {/* Expanded detail */}
      {expanded&&<div style={{borderTop:`1px solid ${ac.accent}22`,padding:"14px 18px 18px"}}>
        {pts.length>0&&<div style={{marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{fontSize:"0.58rem",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.inkLight}}>Heart rate</span>
            <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1rem",fontWeight:800,color:ac.accent}}>
              {avgHR} <span style={{fontSize:"0.58rem",fontWeight:600,color:T.inkLight}}>BPM AVG</span>
            </span>
          </div>
          <div style={{position:"relative",height:52,background:T.paperAlt,borderRadius:10,overflow:"hidden"}}>
            <svg width="100%" height="100%" viewBox="0 0 100 52" preserveAspectRatio="none" style={{position:"absolute",inset:0}}>
              <defs>
                <linearGradient id={`hrg-t-${w.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ac.accent} stopOpacity="0.4"/>
                  <stop offset="100%" stopColor={ac.accent} stopOpacity="0.02"/>
                </linearGradient>
              </defs>
              <polygon
                points={["0,52",...pts.map((v,i)=>`${i/(pts.length-1)*100},${52-Math.round((v-minPt)/(maxPt-minPt+1)*42+4)}`),"100,52"].join(" ")}
                fill={`url(#hrg-t-${w.id})`}/>
              <polyline
                points={pts.map((v,i)=>`${i/(pts.length-1)*100},${52-Math.round((v-minPt)/(maxPt-minPt+1)*42+4)}`).join(" ")}
                fill="none" stroke={ac.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div style={{position:"absolute",top:4,right:8,fontSize:"0.5rem",color:ac.accent,fontWeight:700,fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace"}}>{maxPt}</div>
            <div style={{position:"absolute",bottom:4,right:8,fontSize:"0.5rem",color:T.inkLight,fontWeight:600,fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace"}}>{minPt}</div>
          </div>
        </div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
          {[
            {l:"Duration",v:hasDur(w.dur)?w.dur+" min":"—",hi:hasDur(w.dur)},
            {l:"Distance",v:hasDist(w.dist)?w.dist+" mi":"—",hi:hasDist(w.dist)},
            {l:"Calories",v:w.cals>0?w.cals+" cal":"—",hi:w.cals>0},
            {l:"Avg HR",v:hasHR(w.hr)?w.hr+" bpm":"—",hi:hasHR(w.hr)},
            {l:"Pace",v:hasPace(w.pace)?w.pace:"—",hi:hasPace(w.pace)},
            {l:"Source",v:w.source==="apple"?"Apple":w.source==="healthautoexport"?"Health App":"Manual",hi:false},
          ].map(x=>(
            <div key={x.l} style={{background:"#111",borderRadius:10,padding:"10px 8px",textAlign:"center",
              border:`1px solid ${x.hi&&x.v!=="—"?ac.accent+"44":T.line}`}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1rem",fontWeight:700,
                color:x.hi&&x.v!=="—"?ac.accent:T.inkLight,lineHeight:1}}>{x.v}</div>
              <div style={{fontSize:"0.55rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.07em",marginTop:3}}>{x.l}</div>
            </div>
          ))}
        </div>
        {w.notes&&<div style={{fontSize:"0.8rem",color:T.inkMid,fontStyle:"italic",marginBottom:12,
          padding:"10px 12px",background:"#111",borderRadius:8,borderLeft:`2px solid ${ac.accent}`}}>"{w.notes}"</div>}
        <div style={{display:"flex",gap:8}}>
          <Btn full v="ghost" sm onClick={()=>onLogAgain(w)}>↩ Log again</Btn>
          <button onClick={()=>onDelete(w)}
            style={{background:T.roseL,color:T.rose,border:`1px solid ${T.rose}33`,
              borderRadius:8,fontSize:"0.76rem",fontWeight:600,padding:"8px 14px",cursor:"pointer",flexShrink:0}}>
            Delete
          </button>
        </div>
        {detail?._pendingDelete&&detail?.id===w.id&&<ConfirmDialog
          msg="Delete this workout?"
          onCancel={()=>setDetail(null)}
          onConfirm={()=>{setDetail(null);onDelete(w,true);}}
        />}
      </div>}
    </div>
  );
}

function Workouts({s,D,toast,insights}) {
  const topType=[...s.workouts].reduce((acc,w)=>{acc[w.type]=(acc[w.type]||0)+1;return acc;},{});
  const mostUsedType=Object.entries(topType).sort((a,b)=>b[1]-a[1])[0]?.[0]||"🏃 Run";
  const [showLog,setShowLog]=useState(false);
  const [f,sf]=useState({name:"",type:mostUsedType,dur:"",dist:"",cals:"",hr:"",pace:"",notes:"",date:TODAY,sets:[]});
  const [showEffort,setShowEffort]=useState({show:false,workoutId:null,name:""});
  const [fRange,setFRange]=useState("month"); // week | month | 3mo | year | all
  const [fType,setFType]=useState("all");
  const [search,setSearch]=useState("");
  const [detail,setDetail]=useState(null);
  const [showDupes,setShowDupes]=useState(false);
  const [confirmAll,setConfirmAll]=useState(false);
  const [editW,setEditW]=useState(null);

  // Compute duplicate groups — workouts sharing the same date+dur
  const dupeGroups=(()=>{
    const groups={};
    s.workouts.forEach(w=>{
      const k=`${w.date}|${w.dur}`;
      if(!groups[k])groups[k]=[];
      groups[k].push(w);
    });
    return Object.values(groups).filter(g=>g.length>1);
  })();
  const totalDupes=dupeGroups.reduce((a,g)=>a+(g.length-1),0);

  // Sort all workouts newest first — memoized, recomputes only when workouts change
  const sorted = useMemo(()=>[...s.workouts].sort((a,b)=>b.date.localeCompare(a.date)), [s.workouts]);

  // Available filter options — also memoized
  const {years, typeOpts} = useMemo(()=>({
    years: [...new Set(sorted.map(w=>w.date.slice(0,4)))].sort().reverse(),
    typeOpts: [...new Set(sorted.map(w=>w.type))],
  }), [sorted]);


  const rangeCutoff = useMemo(()=>{
    if(fRange==="all") return null;
    const d=new Date();
    if(fRange==="week")  d.setDate(d.getDate()-6);
    if(fRange==="month") d.setMonth(d.getMonth()-1);
    if(fRange==="3mo")   d.setMonth(d.getMonth()-3);
    if(fRange==="year")  d.setFullYear(d.getFullYear()-1);
    return localDate(d);
  }, [fRange]);

  const filtered = useMemo(()=>sorted.filter(w=>{
    if(rangeCutoff&&w.date<rangeCutoff) return false;
    if(fType!=="all"&&w.type!==fType)  return false;
    if(search.trim()&&!w.name.toLowerCase().includes(search.toLowerCase())&&!w.type.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [sorted, rangeCutoff, fType, search]);

  const logWorkout=()=>{
    if(!f.name.trim()){toast("Enter a workout name");return;}
    D({t:"ADD_W",w:{...f,id:Date.now(),source:"manual"}});
    sf({name:"",type:"🏃 Run",dur:"",dist:"",cals:"",hr:"",pace:"",notes:"",date:TODAY,sets:[]});
    setShowLog(false);
    haptic("success");
    // Show effort prompt after save
    setShowEffort({show:true, workoutId:Date.now(), name:f.name});
    toast("Workout logged ✓");
  };

  // ── Today's workouts — memoized ──
  const todayWorkouts = useMemo(()=>s.workouts.filter(w=>w.date===TODAY), [s.workouts]);
  const ac0 = todayWorkouts.length ? actColor(todayWorkouts[0].type) : null;

  return (
    <div className="fu">
      {/* ── Header row ── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 12px"}}>
        <h1 style={{fontFamily:"'Barlow Condensed','DM Sans',sans-serif",fontSize:"2rem",fontWeight:900,color:T.ink,letterSpacing:"0.01em",textTransform:"uppercase"}}>Workouts</h1>
        <Btn sm onClick={()=>setShowLog(p=>!p)} v={showLog?"outline":"primary"}>
          {showLog?"✕ Cancel":"+ Log"}
        </Btn>
      </div>

      {/* ── AI Coach tip — training-specific ── */}
      <InlineTip s={s} type="workouts" insights={insights}/>

      {/* ══════════════════════════════════════════
          TODAY'S WORKOUT — hero section
          ══════════════════════════════════════════ */}
      <div style={{marginBottom:20}}>
        {/* Section label */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.1rem",fontWeight:900,color:todayWorkouts.length?"#c8f135":T.inkLight,letterSpacing:"0.08em",textTransform:"uppercase"}}>
            Today
          </div>
          <div style={{fontSize:"0.62rem",color:T.inkLight,fontWeight:500}}>
            {new Date().toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}
          </div>
          <div style={{flex:1,height:1,background:todayWorkouts.length?"#c8f13530":T.lineSoft}}/>
          {todayWorkouts.length>0&&<div style={{
            fontFamily:"'Barlow Condensed',sans-serif",
            fontSize:"0.85rem",fontWeight:700,
            color:"#c8f135",letterSpacing:"0.06em"
          }}>{todayWorkouts.length} {todayWorkouts.length===1?"SESSION":"SESSIONS"}</div>}
        </div>

        {todayWorkouts.length===0 ? (
          /* Empty state */
          <div style={{
            background:`linear-gradient(135deg,#1a1a1a,#141414)`,
            border:`1px dashed #3a3a3a`,
            borderRadius:16,padding:"22px 20px",
            display:"flex",flexDirection:"column",alignItems:"center",
            gap:10,textAlign:"center"
          }}>
            <div style={{fontSize:"2rem",opacity:.4}}>🏋️</div>
            <div style={{fontWeight:700,fontSize:"0.92rem",color:T.inkMid}}>No workout logged today</div>
            <div style={{fontSize:"0.78rem",color:T.inkLight,lineHeight:1.5,maxWidth:240}}>
              Tap <strong style={{color:"#c8f135"}}>+ Log</strong> to record a session, or browse your history below.
            </div>
          </div>
        ) : (
          /* Today's workout cards — stacked */
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {todayWorkouts.map((w,wi)=>(
              <TodayWorkoutCard
                key={w.id}
                w={w}
                isFirst={wi===0}
                detail={detail}
                setDetail={setDetail}
                onLogAgain={w=>{
                  sf({name:w.name,type:w.type,dur:w.dur||"",dist:w.dist||"",cals:w.cals||"",hr:w.hr||"",pace:w.pace||"",notes:"",date:TODAY});
                  setShowLog(true);
                  toast("Form pre-filled — adjust and save");
                }}
                onDelete={(w,confirmed)=>{
                  if(confirmed){
                    const saved={...w};
                    D({t:"DEL_W",id:w.id});
                    setDetail(null);
                    haptic("medium");
                    toast("Workout removed",()=>{D({t:"ADD_W",w:saved});toast("Undone ✓");});
                  }
                  else setDetail({...w,_pendingDelete:true});
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════
          ALL WORKOUTS — browse section below
          ══════════════════════════════════════════ */}

      {/* Section label */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.1rem",fontWeight:900,color:T.inkLight,letterSpacing:"0.08em",textTransform:"uppercase"}}>
          All Workouts
        </div>
        <div style={{flex:1,height:1,background:T.lineSoft}}/>
        {s.workouts.length>0&&<div style={{fontSize:"0.62rem",color:T.inkLight}}>{s.workouts.length} total</div>}
      </div>

      {/* Collapsible log form */}
      {showLog&&<Card style={{marginBottom:14}}>
        <Sec>Log a workout</Sec>
        <FL label="Name"><Inp value={f.name} onChange={e=>sf(p=>({...p,name:e.target.value}))} placeholder="Morning Run, Leg Day…" maxLength={100}/></FL>
        <FL label="Type"><Sel value={f.type} onChange={e=>sf(p=>({...p,type:e.target.value}))}>{WORKOUT_TYPES.map(t=><option key={t}>{t}</option>)}</Sel></FL>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Duration (min)"><Inp type="number" value={f.dur} onChange={e=>sf(p=>({...p,dur:e.target.value}))} placeholder="45"/></FL>
          <FL label="Distance (mi)"><Inp value={f.dist} onChange={e=>sf(p=>({...p,dist:e.target.value}))} placeholder="3.2"/></FL>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Calories burned"><Inp type="number" value={f.cals} onChange={e=>sf(p=>({...p,cals:e.target.value}))} placeholder="350"/></FL>
          <FL label="Date"><Inp type="date" value={f.date} onChange={e=>sf(p=>({...p,date:e.target.value}))}/></FL>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Avg HR (bpm)"><Inp type="number" value={f.hr} onChange={e=>sf(p=>({...p,hr:e.target.value}))} placeholder="145"/></FL>
          <FL label="Pace"><Inp value={f.pace} onChange={e=>sf(p=>({...p,pace:e.target.value}))} placeholder="8:30/mi"/></FL>
        </div>
        {/* Strength-specific fields */}
        {(f.type||"").includes("Strength")&&<Card style={{marginTop:0,marginBottom:12,background:T.paperAlt,border:`1px solid ${T.purple}33`}}>
          <Sec>Strength details (optional)</Sec>
          <div style={{fontSize:"0.76rem",color:T.inkMid,marginBottom:10}}>
            Log your working sets for progressive overload tracking.
          </div>
          {(f.sets||[{ex:"",weight:"",reps:"",sets:""}]).map((set,si)=>(
            <div key={si} style={{marginBottom:10}}>
              <div style={{fontSize:"0.6rem",fontWeight:700,color:T.purple,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:5}}>Exercise {si+1}</div>
              <FL label="Exercise"><Inp value={set.ex||""} onChange={e=>sf(p=>({...p,sets:((p.sets||[{ex:"",weight:"",reps:"",sets:""}])).map((s2,j)=>j===si?{...s2,ex:e.target.value}:s2)}))}/></FL>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                <FL label="Sets"><Inp type="number" value={set.sets||""} onChange={e=>sf(p=>({...p,sets:((p.sets||[])).map((s2,j)=>j===si?{...s2,sets:e.target.value}:s2)}))}/></FL>
                <FL label="Reps"><Inp type="number" value={set.reps||""} onChange={e=>sf(p=>({...p,sets:((p.sets||[])).map((s2,j)=>j===si?{...s2,reps:e.target.value}:s2)}))}/></FL>
                <FL label="Weight (lbs)"><Inp type="number" value={set.weight||""} onChange={e=>sf(p=>({...p,sets:((p.sets||[])).map((s2,j)=>j===si?{...s2,weight:e.target.value}:s2)}))}/></FL>
              </div>
            </div>
          ))}
          <Btn sm v="outline" onClick={()=>sf(p=>({...p,sets:[...(p.sets||[{ex:"",weight:"",reps:"",sets:""}]),{ex:"",weight:"",reps:"",sets:""}]}))}>+ Add exercise</Btn>
        </Card>}
        <FL label="Notes"><Area value={f.notes} onChange={e=>sf(p=>({...p,notes:e.target.value}))} placeholder="How did it feel?" maxLength={500}/></FL>
        <Btn full onClick={logWorkout}>Save workout</Btn>
      </Card>}

      {/* Time-range pill selector */}
      <div style={{display:"flex",gap:6,marginBottom:10,overflowX:"auto",WebkitOverflowScrolling:"touch",paddingBottom:2}}>
        {[
          {k:"week",  l:"Week"},
          {k:"month", l:"Month"},
          {k:"3mo",   l:"3 Mo"},
          {k:"year",  l:"Year"},
          {k:"all",   l:"All"},
        ].map(({k,l})=>{
          const active=fRange===k;
          return (
            <button key={k} onClick={()=>setFRange(k)} style={{
              flexShrink:0,padding:"7px 16px",borderRadius:20,border:"none",cursor:"pointer",
              fontFamily:"'DM Sans',sans-serif",fontSize:"0.78rem",fontWeight:active?700:500,
              letterSpacing:"0.02em",
              background:active?"#c8f135":T.paperAlt,
              color:active?"#0d0d0d":T.inkMid,
              transition:"background .15s,color .15s",
            }}>
              {l}
            </button>
          );
        })}
        {/* Type filter */}
        {typeOpts.length>1&&<select value={fType} onChange={e=>setFType(e.target.value)} style={{
          marginLeft:"auto",flexShrink:0,
          background:fType!=="all"?T.orangeL:T.paperAlt,
          border:`1px solid ${fType!=="all"?T.orange:T.line}`,
          borderRadius:20,color:fType!=="all"?T.orange:T.inkMid,
          fontSize:"0.78rem",padding:"7px 12px",outline:"none",
          fontWeight:fType!=="all"?700:500,cursor:"pointer",
        }}>
          <option value="all">All types</option>
          {typeOpts.map(t=><option key={t} value={t}>{t}</option>)}
        </select>}
      </div>

      {/* Search */}
      <div style={{position:"relative",marginBottom:10}}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search workouts…"
          style={{width:"100%",padding:"10px 36px 10px 14px",borderRadius:10,border:`1px solid ${search?T.orange:T.line}`,fontSize:"1rem",color:T.ink,background:T.paper,outline:"none",boxSizing:"border-box"}}
        />
        {search&&<button aria-label="Clear search" onClick={()=>setSearch("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:T.inkLight,cursor:"pointer",fontSize:"1rem",minWidth:44,minHeight:44,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>}
      </div>

      {/* Duplicate alert banner */}
      {totalDupes>0&&(
        <div style={{background:T.roseL,border:`1px solid #dac8c8`,borderRadius:12,padding:"12px 14px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <span style={{fontSize:"0.82rem",fontWeight:700,color:T.rose}}>⚠️ {totalDupes} duplicate{totalDupes!==1?"s":""} found</span>
              <span style={{fontSize:"0.76rem",color:T.rose,opacity:.8,marginLeft:6}}>{dupeGroups.length} workout{dupeGroups.length!==1?"s":""} affected</span>
            </div>
            <button onClick={()=>setShowDupes(p=>!p)}
              style={{background:"none",border:`1px solid #dac8c8`,borderRadius:8,color:T.rose,fontSize:"0.74rem",fontWeight:600,padding:"5px 10px",cursor:"pointer"}}>
              {showDupes?"Hide":"Review"}
            </button>
          </div>

          {showDupes&&<div style={{marginTop:12}}>
            {dupeGroups.map((group,gi)=>(
              <div key={gi} style={{background:"rgba(255,255,255,.6)",borderRadius:10,padding:"10px 12px",marginBottom:gi<dupeGroups.length-1?8:0}}>
                <div style={{fontSize:"0.7rem",fontWeight:700,color:T.rose,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>
                  {fmtD(group[0].date)} · {group[0].dur&&group[0].dur!=="—"?group[0].dur+" min":""} — {group.length} copies
                </div>
                {group.map((w,wi)=>(
                  <div key={w.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderTop:wi>0?`1px solid rgba(160,112,112,.15)`:"none"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:"0.85rem",fontWeight:500,color:T.ink}}>{w.type.split(" ")[0]} {w.name}</div>
                      <div style={{fontSize:"0.65rem",color:T.inkLight,marginTop:2,display:"flex",gap:8}}>
                        {w.dist&&parseFloat(w.dist)>0&&<span>{w.dist}mi</span>}
                        {w.cals>0&&<span>{w.cals}cal</span>}
                        {hasHR(w.hr)&&<span>{w.hr}bpm</span>}
                        <span style={{opacity:.6}}>src: {w.source==="apple"?"Apple Health":w.source==="healthautoexport"?"Health Export":w.source==="strava"?"Strava":"Manual"}</span>
                      </div>
                    </div>
                    <button onClick={()=>{D({t:"DEL_W",id:w.id});toast("Removed");}}
                      style={{background:"none",border:`1px solid #dac8c8`,borderRadius:7,color:T.rose,fontSize:"0.72rem",fontWeight:600,padding:"5px 10px",cursor:"pointer",flexShrink:0,marginLeft:8}}>
                      Remove
                    </button>
                  </div>
                ))}
                <button onClick={()=>{
                  // Keep the entry with the best type (not "✦ Other"), then remove rest
                  const sorted=[...group].sort((a,b)=>{
                    const aOther=a.type==="✦ Other"?1:0;
                    const bOther=b.type==="✦ Other"?1:0;
                    return aOther-bOther;
                  });
                  sorted.slice(1).forEach(w=>D({t:"DEL_W",id:w.id}));
                  toast(`Kept best, removed ${sorted.length-1}`);
                }} style={{marginTop:8,background:T.rose,color:"#fff",border:"none",borderRadius:8,fontSize:"0.74rem",fontWeight:600,padding:"7px 12px",cursor:"pointer",width:"100%"}}>
                  Auto-keep best, remove {group.length-1}
                </button>
              </div>
            ))}
            {showDupes&&(confirmAll ? (
              <ConfirmDialog
                msg={`Remove all ${totalDupes} duplicate${totalDupes!==1?"s":""}? This keeps the best version of each and cannot be undone.`}
                onCancel={()=>setConfirmAll(false)}
                onConfirm={()=>{
                  dupeGroups.forEach(group=>{
                    const sorted=[...group].sort((a,b)=>(a.type==="✦ Other"?1:0)-(b.type==="✦ Other"?1:0));
                    sorted.slice(1).forEach(w=>D({t:"DEL_W",id:w.id}));
                  });
                  setShowDupes(false);setConfirmAll(false);
                  toast(`✓ Cleaned up ${totalDupes} duplicate${totalDupes!==1?"s":""}`);
                }}
              />
            ) : (
              <button onClick={()=>setConfirmAll(true)} style={{marginTop:10,background:T.rose,color:"#fff",border:"none",borderRadius:10,fontSize:"0.82rem",fontWeight:700,padding:"11px",cursor:"pointer",width:"100%"}}>
                Remove all duplicates ({totalDupes})
              </button>
            ))}
          </div>}
        </div>
      )}

      {/* Result count */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <span style={{fontSize:"0.78rem",color:T.inkLight}}>{filtered.length} workout{filtered.length!==1?"s":""}</span>
        {fType!=="all"&&(
          <button onClick={()=>setFType("all")} style={{background:"none",border:"none",fontSize:"0.76rem",color:T.blue,cursor:"pointer",padding:"4px 0"}}>Clear type filter</button>
        )}
      </div>

      {/* Workout list — grouped by month, memoized on filtered changes */}
      {(()=>{
        if(!filtered.length) return <Empty icon="🏋️" text={s.workouts.length?"No workouts match these filters.":"No workouts yet. Import from Apple Health or tap + Log."}/>;

        // Group into months — already stable because filtered is memoized
        const groups={};
        filtered.forEach(w=>{
          const mk=w.date.slice(0,7);
          if(!groups[mk])groups[mk]=[];
          groups[mk].push(w);
        });
        const monthKeys=Object.keys(groups).sort().reverse();

        return monthKeys.map(mk=>{
          const mWorkouts=groups[mk];
          const mSessions=mWorkouts.length;
          const mMiles=mWorkouts.reduce((a,w)=>a+(parseFloat(w.dist)||0),0);
          const mMin=mWorkouts.reduce((a,w)=>a+(parseInt(w.dur)||0),0);
          const mCals=mWorkouts.reduce((a,w)=>a+(w.cals||0),0);
          const mLabel=new Date(mk+"-15").toLocaleDateString("en-US",{month:"long",year:"numeric"});

          // Build per-day bars for the month
          const daysInMonth=new Date(parseInt(mk.slice(0,4)),parseInt(mk.slice(5,7)),0).getDate();
          const dayBars=Array.from({length:daysInMonth},(_,i)=>{
            const d=`${mk}-${String(i+1).padStart(2,"0")}`;
            const ws=mWorkouts.filter(w=>w.date===d);
            // Pick primary type by most minutes, fallback to first
            const primaryType=ws.length?ws.reduce((best,w)=>(parseInt(w.dur)||0)>(parseInt(best.dur)||0)?w:best).type:null;
            return{count:ws.length, min:ws.reduce((a,w)=>a+(parseInt(w.dur)||0),0), label:i+1, type:primaryType};
          });
          const maxMin=Math.max(...dayBars.map(d=>d.min),1);
          // Type breakdown for this month
          const mTypeMap={};
          mWorkouts.forEach(w=>{mTypeMap[w.type]=(mTypeMap[w.type]||0)+1;});
          const mTypes=Object.entries(mTypeMap).sort((a,b)=>b[1]-a[1]);

          return (
            <div key={mk}>
              {/* Month summary card — acts as separator */}
              {(()=>{const topAc=mTypes[0]?actColor(mTypes[0][0]):{accent:T.orange,bg:T.orangeL,light:T.orangeL};return(
              <div style={{background:`linear-gradient(135deg,${topAc.bg},#1e1e1e)`,border:`1px solid ${topAc.accent}44`,borderRadius:14,padding:"14px 16px",marginBottom:10,marginTop:4}}>
                {null}{/* color guard */}
                {/* Month name + stats */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div style={{fontWeight:800,fontSize:"1rem",color:T.ink,letterSpacing:"-0.01em"}}>{mLabel}</div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:"1.3rem",fontWeight:800,color:mTypes[0]?actColor(mTypes[0][0]).accent:T.orange,lineHeight:1}}>{mSessions}</div>
                    <div style={{fontSize:"0.58rem",fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",color:T.inkLight,marginTop:1}}>sessions</div>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{display:"flex",gap:12,marginBottom:12,flexWrap:"wrap"}}>
                  {mMiles>0&&<div>
                    <div style={{fontSize:"0.88rem",fontWeight:700,color:T.ink}}>{mMiles.toFixed(1)} mi</div>
                    <div style={{fontSize:"0.58rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.06em"}}>distance</div>
                  </div>}
                  {mMin>0&&<div>
                    <div style={{fontSize:"0.88rem",fontWeight:700,color:T.ink}}>{mMin>=60?`${Math.floor(mMin/60)}h ${mMin%60}m`:mMin+"m"}</div>
                    <div style={{fontSize:"0.58rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.06em"}}>time</div>
                  </div>}
                  {mCals>0&&<div>
                    <div style={{fontSize:"0.88rem",fontWeight:700,color:T.ink}}>{mCals.toLocaleString()}</div>
                    <div style={{fontSize:"0.58rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.06em"}}>cal burned</div>
                  </div>}
                </div>

                {/* Activity type breakdown */}
                {mTypes.length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
                  {mTypes.map(([type,count])=>{const ac=actColor(type);return(
                    <div key={type} style={{display:"flex",alignItems:"center",gap:4,background:ac.light,borderRadius:20,padding:"3px 10px",fontSize:"0.72rem",fontWeight:600,color:ac.accent,border:`1px solid ${ac.accent}33`}}>
                      <span>{type.split(" ")[0]}</span>
                      <span>{type.split(" ").slice(1).join(" ")}</span>
                      <span style={{fontWeight:800,marginLeft:2}}>{count}</span>
                    </div>
                  );})}
                </div>}

                {/* Bar chart — active minutes per day, labelled by day number */}
                <div>
                  <div style={{fontSize:"0.58rem",fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",color:T.inkLight,marginBottom:5}}>Active minutes by day</div>
                  <div style={{display:"flex",alignItems:"flex-end",gap:1.5,height:36}}>
                    {dayBars.map((bar,i)=>(
                      <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                        <div style={{width:"100%",borderRadius:"2px 2px 0 0",height:bar.count>0?`${Math.max(12,Math.round(bar.min/maxMin*34))}px`:"3px",background:bar.count>0?actColor(bar.type||"").accent:"#e8e0d8",transition:"height .3s"}}/>
                      </div>
                    ))}
                  </div>
                  {/* Day number labels — only show 1, 8, 15, 22, last */}
                  <div style={{display:"flex",alignItems:"flex-end",gap:1.5,marginTop:3}}>
                    {dayBars.map((bar,i)=>{
                      const show=bar.label===1||bar.label===8||bar.label===15||bar.label===22||bar.label===daysInMonth;
                      return <div key={i} style={{flex:1,textAlign:"center",fontSize:"0.45rem",color:show?T.inkLight:"transparent",fontWeight:600}}>{bar.label}</div>;
                    })}
                  </div>
                </div>
              </div>);})()}

              {/* Month workouts */}
              {mWorkouts.map(w=>(
                <div key={w.id} role="button" tabIndex={0} aria-expanded={detail?.id===w.id} aria-label={w.name}
                  onClick={()=>setDetail(detail?.id===w.id?null:w)}
                  onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setDetail(detail?.id===w.id?null:w);}}}
                  onTouchStart={e=>{const t=e.touches[0];w._tx=t.clientX;w._ty=t.clientY;}}
                  onTouchEnd={e=>{
                    if(w._tx==null) return;
                    const dx=e.changedTouches[0].clientX-w._tx;
                    const dy=Math.abs(e.changedTouches[0].clientY-(w._ty||0));
                    w._tx=null; w._ty=null;
                    if(dy>40) return;
                    if(dx>60){sf({name:w.name,type:w.type,dur:w.dur||"",dist:w.dist||"",cals:w.cals||"",hr:w.hr||"",pace:w.pace||"",notes:"",date:TODAY,sets:[]});setShowLog(true);setDetail(null);haptic("medium");toast("Pre-filled — adjust and save");}
                    else if(dx<-60){setDetail({...w,_pendingDelete:true});haptic("medium");}
                  }}
                  style={{background:detail?.id===w.id?actColor(w.type).bg:T.paper,border:`1px solid ${detail?.id===w.id?actColor(w.type).accent:T.line}`,borderRadius:14,padding:"14px 16px",marginBottom:8,cursor:"pointer",transition:"all .15s"}}>
                  <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                    <div style={{width:38,height:38,borderRadius:10,background:actColor(w.type).light,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.3rem",flexShrink:0}}>{w.type.split(" ")[0]}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                        <div style={{fontWeight:600,fontSize:"0.92rem",color:T.ink,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{w.name}</div>
                        {w.cals>0&&<span style={{fontSize:"0.72rem",fontWeight:700,color:T.red,flexShrink:0}}>{w.cals} cal</span>}
                      </div>
                      <div style={{fontSize:"0.67rem",color:T.inkLight,marginTop:3,display:"flex",gap:8,flexWrap:"wrap"}}>
                        <span>{fmtD(w.date)}</span>
                        {hasDur(w.dur)&&<span>⏱ {w.dur}m</span>}
                        {hasDist(w.dist)&&<span>📍 {w.dist}mi</span>}
                        {hasHR(w.hr)&&<span>❤️ {w.hr}bpm</span>}
                        {hasPace(w.pace)&&<span>🏃 {w.pace}</span>}
                      </div>
                    </div>
                  </div>
                  {detail?.id===w.id&&(()=>{
                    const ac=actColor(w.type);
                    // Simulate HR curve from avg HR — creates realistic bell curve shape
                    const avgHR=hasHR(w.hr)?parseInt(w.hr):0;
                    const dur=parseInt(w.dur)||0;
                    const pts=avgHR>0&&dur>0?Array.from({length:20},(_,i)=>{
                      const x=i/19;
                      // Warmup → peak → cooldown curve
                      const bell=x<.15?x/.15:.85+Math.sin((x-.15)/.7*Math.PI)*.15;
                      const noise=(Math.sin(i*7.3)*4+Math.sin(i*13.1)*2);
                      return Math.round(avgHR*(.82+bell*.18)+noise);
                    }):[];
                    const maxPt=pts.length?Math.max(...pts):0;
                    const minPt=pts.length?Math.min(...pts):0;
                    return (
                    <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${T.lineSoft}`}} onClick={e=>e.stopPropagation()}>
                      {/* HR Graph */}
                      {pts.length>0&&<div style={{marginBottom:14}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <span style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.inkLight}}>Heart rate</span>
                          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1rem",fontWeight:800,color:ac.accent}}>{avgHR} <span style={{fontSize:"0.6rem",fontWeight:600,color:T.inkLight}}>BPM AVG</span></span>
                        </div>
                        <div style={{position:"relative",height:56,background:T.paperAlt,borderRadius:10,overflow:"hidden"}}>
                          {/* Fill gradient */}
                          <svg width="100%" height="100%" viewBox="0 0 100 56" preserveAspectRatio="none" style={{position:"absolute",inset:0}}>
                            <defs>
                              <linearGradient id={`hrg-${w.id}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={ac.accent} stopOpacity="0.4"/>
                                <stop offset="100%" stopColor={ac.accent} stopOpacity="0.02"/>
                              </linearGradient>
                            </defs>
                            <polygon
                              points={[
                                "0,56",
                                ...pts.map((v,i)=>`${pts.length>1?i/(pts.length-1)*100:50},${56-Math.round((v-minPt)/(maxPt-minPt+1)*46+4)}`),
                                "100,56"
                              ].join(" ")}
                              fill={`url(#hrg-${w.id})`}
                            />
                            <polyline
                              points={pts.map((v,i)=>`${pts.length>1?i/(pts.length-1)*100:50},${56-Math.round((v-minPt)/(maxPt-minPt+1)*46+4)}`).join(" ")}
                              fill="none" stroke={ac.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                            />
                          </svg>
                          {/* Min/max labels */}
                          <div style={{position:"absolute",top:4,right:8,fontSize:"0.52rem",color:ac.accent,fontWeight:700,fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace"}}>{maxPt}</div>
                          <div style={{position:"absolute",bottom:4,right:8,fontSize:"0.52rem",color:T.inkLight,fontWeight:600,fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace"}}>{minPt}</div>
                        </div>
                      </div>}
                      {/* Stats grid */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                        {[
                          {l:"Duration",v:hasDur(w.dur)?w.dur+" min":"—",hi:true},
                          {l:"Distance",v:hasDist(w.dist)?w.dist+" mi":"—",hi:hasDist(w.dist)},
                          {l:"Calories",v:w.cals>0?w.cals+" cal":"—",hi:w.cals>0},
                          {l:"Avg HR",v:hasHR(w.hr)?w.hr+" bpm":"—",hi:hasHR(w.hr)},
                          {l:"Pace",v:hasPace(w.pace)?w.pace:"—",hi:hasPace(w.pace)},
                          {l:"Source",v:w.source==="apple"?"Apple":w.source==="healthautoexport"?"Health App":w.source==="strava"?"Strava":"Manual",hi:false},
                        ].map(x=>(
                          <div key={x.l} style={{background:T.paperAlt,borderRadius:10,padding:"10px 8px",textAlign:"center",border:`1px solid ${x.hi&&x.v!=="—"?ac.accent+"33":T.line}`}}>
                            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1rem",fontWeight:700,color:x.hi&&x.v!=="—"?ac.accent:T.inkLight,lineHeight:1}}>{x.v}</div>
                            <div style={{fontSize:"0.55rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.07em",marginTop:3}}>{x.l}</div>
                          </div>
                        ))}
                      </div>
                      {/* Strength sets detail */}
                      {w.sets&&w.sets.length>0&&w.sets.some(s=>s.ex)&&<div style={{marginBottom:12}}>
                        <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.purple,marginBottom:6}}>Exercises</div>
                        {w.sets.filter(s=>s.ex).map((s,i)=>(
                          <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:T.paperAlt,borderRadius:8,marginBottom:4}}>
                            <span style={{fontSize:"0.82rem",fontWeight:600,color:T.ink}}>{s.ex}</span>
                            <span style={{fontFamily:"ui-monospace,monospace",fontSize:"0.72rem",color:T.purple}}>
                              {s.sets&&s.reps?`${s.sets}×${s.reps}`:""}{s.weight?` @ ${s.weight}lbs`:""}
                            </span>
                          </div>
                        ))}
                      </div>}
                      {w.notes&&<div style={{fontSize:"0.8rem",color:T.inkMid,fontStyle:"italic",marginBottom:12,padding:"10px 12px",background:T.paperAlt,borderRadius:8,borderLeft:`2px solid ${ac.accent}`}}>"{w.notes}"</div>}
                      {detail?._pendingDelete&&<ConfirmDialog
                        msg="Delete this workout? This cannot be undone."
                        onCancel={e=>{e?.stopPropagation?.();setDetail({...w});}}
                        onConfirm={e=>{e?.stopPropagation?.();const saved={...w};D({t:"DEL_W",id:w.id});setDetail(null);haptic("medium");toast("Workout removed",()=>{D({t:"ADD_W",w:saved});toast("Undone ✓");});}}
                      />}
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
                        <Btn sm v="outline" onClick={e=>{e.stopPropagation();setEditW({...w});}}>✏ Edit</Btn>
                        <Btn sm v="ghost" onClick={e=>{
                          e.stopPropagation();
                          sf({name:w.name,type:w.type,dur:w.dur||"",dist:w.dist||"",cals:w.cals||"",hr:w.hr||"",pace:w.pace||"",notes:"",date:TODAY});
                          setShowLog(true);
                          setDetail(null);
                          toast("Form pre-filled — adjust and save");
                        }}>↩ Log again</Btn>
                        <button onClick={e=>{e.stopPropagation();setDetail({...w,_pendingDelete:true});}}
                          style={{background:T.roseL,color:T.rose,border:`1px solid ${T.rose}33`,borderRadius:8,fontSize:"0.78rem",fontWeight:600,padding:"8px 16px",cursor:"pointer",minHeight:36}}>
                          Delete
                        </button>
                      </div>
                    </div>
                    );
                  })()}
                </div>
              ))}

              <div style={{marginBottom:6}}/>
            </div>
          );
        });
      })()}
      {/* ── Effort rating modal ── */}
      <Modal open={showEffort.show} onClose={()=>setShowEffort({show:false})} title="How did it feel?">
        <div style={{fontSize:"0.84rem",color:T.inkMid,marginBottom:16}}>{showEffort.name}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          {[
            {k:"easy",    label:"Easy",        icon:"😌", desc:"Could've gone longer"},
            {k:"moderate",label:"Moderate",    icon:"💪", desc:"Comfortable challenge"},
            {k:"hard",    label:"Hard",        icon:"🔥", desc:"Pushed myself"},
            {k:"crushed", label:"Crushed it",  icon:"⚡", desc:"Maximum effort"},
          ].map(e=>(
            <button key={e.k} onClick={()=>{
              // Update the most recently added workout with effort
              const lastW = s.workouts[0];
              if (lastW) D({t:"UPD_W",w:{...lastW,effort:e.k}});
              haptic("medium");
              setShowEffort({show:false});
              toast(`Logged as ${e.label}`);
            }}
              style={{padding:"14px 10px",borderRadius:14,border:`1.5px solid ${T.line}`,
                background:T.paperAlt,cursor:"pointer",textAlign:"center",
                display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
              <span style={{fontSize:"1.8rem"}}>{e.icon}</span>
              <span style={{fontWeight:700,fontSize:"0.82rem",color:T.ink}}>{e.label}</span>
              <span style={{fontSize:"0.68rem",color:T.inkLight,lineHeight:1.3}}>{e.desc}</span>
            </button>
          ))}
        </div>
        <Btn full v="outline" sm onClick={()=>setShowEffort({show:false})}>Skip</Btn>
      </Modal>

      {/* ── Edit workout modal ── */}
      <Modal open={!!editW} onClose={()=>setEditW(null)} title="Edit workout">
        {editW&&<>
          <FL label="Name"><Inp value={editW.name} onChange={e=>setEditW(p=>({...p,name:e.target.value}))} maxLength={100}/></FL>
          <FL label="Type"><Sel value={editW.type} onChange={e=>setEditW(p=>({...p,type:e.target.value}))}>{WORKOUT_TYPES.map(t=><option key={t}>{t}</option>)}</Sel></FL>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <FL label="Duration (min)"><Inp type="number" value={editW.dur||""} onChange={e=>setEditW(p=>({...p,dur:e.target.value}))}/></FL>
            <FL label="Distance (mi)"><Inp value={editW.dist||""} onChange={e=>setEditW(p=>({...p,dist:e.target.value}))}/></FL>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <FL label="Calories"><Inp type="number" value={editW.cals||""} onChange={e=>setEditW(p=>({...p,cals:e.target.value}))}/></FL>
            <FL label="Avg HR"><Inp type="number" value={editW.hr||""} onChange={e=>setEditW(p=>({...p,hr:e.target.value}))}/></FL>
          </div>
          <FL label="Date"><Inp type="date" value={editW.date||TODAY} onChange={e=>setEditW(p=>({...p,date:e.target.value}))}/></FL>
          <FL label="Notes"><Area value={editW.notes||""} onChange={e=>setEditW(p=>({...p,notes:e.target.value}))} maxLength={500}/></FL>
          <div style={{display:"flex",gap:10,marginTop:4}}>
            <Btn full v="outline" onClick={()=>setEditW(null)}>Cancel</Btn>
            <Btn full onClick={()=>{
              if(!editW.name.trim()){toast("Enter a name");return;}
              D({t:"UPD_W",w:editW});
              setEditW(null);
              haptic("success");
              toast("Updated ✓");
            }}>Save changes</Btn>
          </div>
        </>}
      </Modal>
    </div>
  );
}

function WaterTab({s, D, toast}) {
  const wkD = getWk();
  const oz = s.water[TODAY] || 0;
  const goal = s.waterGoal || 64;
  const [gv, sgv] = useState(goal);
  const pct = goal > 0 ? Math.round(oz / goal * 100) : 0;
  const wkData = wkD.map(d => {
    const dy = new Date(d + "T12:00");
    return { d, oz: s.water[d] || 0, l: ["S","M","T","W","T","F","S"][dy.getDay()] };
  });
  const maxOz = Math.max(...wkData.map(d => d.oz), goal, 1);
  return (
    <>
      <Card style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:18}}>
          <div>
            <div style={{display:"flex",alignItems:"baseline",gap:4}}>
              <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"3rem",fontWeight:900,color:T.sky,lineHeight:1}}>{oz}</span>
              <span style={{fontSize:"1rem",color:T.inkLight,fontWeight:500}}>oz</span>
            </div>
            <div style={{fontSize:"0.76rem",color:T.inkLight,marginTop:3}}>of {goal} oz goal</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.5rem",fontWeight:800,color:pct>=100?T.sage:T.sky,lineHeight:1}}>{pct}%</div>
            <div style={{fontSize:"0.6rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.06em",marginTop:2}}>of goal</div>
          </div>
        </div>
        <div style={{marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:"0.72rem",color:T.inkLight}}>0 oz</span>
            <span style={{fontSize:"0.72rem",fontWeight:700,color:T.sky}}>{oz} oz</span>
            <span style={{fontSize:"0.72rem",color:T.inkLight}}>{goal} oz</span>
          </div>
          <input type="range" min={0} max={goal} step={1} value={oz}
            onChange={e=>D({t:"WATER",v:{...s.water,[TODAY]:parseInt(e.target.value)}})}
            className="water-slider"
            style={{width:"100%",cursor:"pointer",willChange:"background",
              background:`linear-gradient(to right,${T.sky} ${pct}%,var(--line) ${pct}%)`}}/>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:10}}>
            {[0,Math.round(goal*0.25),Math.round(goal*0.5),Math.round(goal*0.75),goal].map(v=>(
              <div key={v} onClick={()=>D({t:"WATER",v:{...s.water,[TODAY]:v}})}
                style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"pointer",minWidth:32,minHeight:32,justifyContent:"center"}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:oz>=v&&v>0?T.sky:T.lineSoft,transition:"background .2s"}}/>
                <span style={{fontSize:"0.55rem",color:oz>=v&&v>0?T.sky:T.inkLight}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",paddingTop:14,borderTop:`1px solid ${T.lineSoft}`}}>
          <span style={{fontSize:"0.72rem",color:T.inkLight,flexShrink:0}}>Daily goal</span>
          <input type="number" value={gv} onChange={e=>sgv(e.target.value)}
            onBlur={e=>{const v=parseInt(e.target.value);if(v>0&&v<500){sgv(v);D({t:"WGOAL",v});toast("Goal updated ✓");}else sgv(goal);}}
            style={{width:72,padding:"8px 10px",borderRadius:10,border:`1px solid ${T.line}`,fontSize:"1rem",color:T.ink,background:T.paper,outline:"none",textAlign:"center"}}
            maxLength={3}/>
          <span style={{fontSize:"0.72rem",color:T.inkLight}}>oz</span>
          <Btn sm v="outline" onClick={()=>{D({t:"WATER",v:{...s.water,[TODAY]:0}});toast("Reset today");}} style={{marginLeft:"auto"}}>Reset</Btn>
        </div>
      </Card>
      <WaterWeekChart wkData={wkData} goal={goal} maxOz={maxOz}/>
    </>
  );
}

// ─── AI Nutrition Input [DEPLOY-REQUIRED] ────────────────
function NutritionAI({s, D, toast, date}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [clarify, setClarify] = useState(null); // {question, pendingFoods}
  const [photoMode, setPhotoMode] = useState(false);
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);

  if (!open) return (
    <div style={{background:T.paperAlt,border:`1px dashed ${T.line}`,borderRadius:14,
      padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",
      justifyContent:"space-between",cursor:"pointer"}} onClick={()=>setOpen(true)}>
      <div>
        <div style={{fontWeight:600,fontSize:"0.88rem",color:T.ink}}>✨ Log with AI</div>
        <div style={{fontSize:"0.7rem",color:T.inkLight,marginTop:2}}>
          {AI_AVAILABLE?"Describe your meal or take a photo":"Available after deployment"}
        </div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.inkLight} strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  );

  const parseAndLog = async (text, imageBase64=null) => {
    if (!AI_AVAILABLE) {
      toast("Set VITE_CLAUDE_API_KEY to enable AI logging");
      return;
    }
    setLoading(true);
    const systemPrompt = `You are a nutrition logging assistant. Parse the user's meal description and return JSON only — no markdown, no explanation.

Return exactly: {"foods":[{"name":"...","cal":N,"pro":N,"carb":N,"fat":N,"slot":"breakfast"}],"clarificationNeeded":null}
- slot must be one of: breakfast,lunch,dinner,pre,post,snack
- If you need clarification, set clarificationNeeded to a short question string and return empty foods array
- Estimate macros for common foods. Be concise with names.
- For photos: estimate visible portions realistically.`;

    const userMsg = imageBase64
      ? [
          {type:"image",source:{type:"base64",media_type:"image/jpeg",data:imageBase64}},
          {type:"text",text:"Estimate the nutrition content of this meal and which meal slot it belongs to."}
        ]
      : `Parse this meal for logging: "${text}"`;

    try {
      const raw = await callClaude(systemPrompt, typeof userMsg==="string"?userMsg:JSON.stringify(userMsg), 500);
      if (!raw) { toast("AI unavailable — try again"); setLoading(false); return; }
      const clean = raw.replace(/```json|```/g,"").trim();
      let parsed;
      try { parsed = JSON.parse(clean); }
      catch { toast("Couldn't parse AI response — try being more specific"); setLoading(false); return; }

      if (parsed.clarificationNeeded) {
        setClarify({question:parsed.clarificationNeeded, pendingInput:text});
        setLoading(false);
        return;
      }

      if (parsed.foods?.length) {
        parsed.foods.forEach(food=>{
          D({t:"ADD_M", date, slot:food.slot||"snack",
            item:{name:food.name,cal:food.cal||0,pro:food.pro||0,carb:food.carb||0,fat:food.fat||0}});
        });
        toast(`Logged ${parsed.foods.length} item${parsed.foods.length!==1?"s":""} ✓`);
        haptic("success");
        setInput("");
        setClarify(null);
        setOpen(false);
      } else {
        toast("Couldn't parse — try being more specific");
      }
    } catch(e) {
      toast("Parse error — try again");
      console.error(e);
    }
    setLoading(false);
  };

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(",")[1];
      await parseAndLog("", base64);
    };
    reader.readAsDataURL(file);
  };

  return (
    <Card style={{marginBottom:14,border:`1.5px solid #c8f13530`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:"0.9rem",color:T.ink}}>✨ Log with AI</div>
        <button onClick={()=>setOpen(false)}
          style={{background:"none",border:"none",color:T.inkLight,cursor:"pointer",
            padding:"4px 8px",fontSize:"0.9rem",minHeight:36}}>✕</button>
      </div>

      {!AI_AVAILABLE&&<div style={{background:T.orangeL,border:`1px solid ${T.orange}33`,borderRadius:10,
        padding:"10px 14px",marginBottom:12,fontSize:"0.78rem",color:T.inkMid,lineHeight:1.5}}>
        🚀 Set <code>VITE_CLAUDE_API_KEY</code> in Vercel environment variables to activate AI logging.
      </div>}

      {/* Clarification prompt */}
      {clarify&&<div style={{background:T.paperAlt,border:`1px solid ${T.blue}33`,borderRadius:10,
        padding:"12px 14px",marginBottom:12}}>
        <div style={{fontSize:"0.82rem",color:T.blue,fontWeight:600,marginBottom:8}}>💬 {clarify.question}</div>
        <div style={{display:"flex",gap:8}}>
          <input value={input} onChange={e=>setInput(e.target.value)}
            placeholder="Your answer…"
            style={{flex:1,padding:"9px 12px",borderRadius:10,border:`1px solid ${T.line}`,
              background:T.paper,color:T.ink,fontSize:"16px",outline:"none"}}/>
          <Btn sm onClick={()=>parseAndLog(`${clarify.pendingInput} — ${input}`)}>Send</Btn>
        </div>
      </div>}

      {!clarify&&<>
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <input value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")parseAndLog(input);}}
            placeholder="e.g. Chicken burrito bowl, no sour cream"
            disabled={loading}
            style={{flex:1,padding:"11px 14px",borderRadius:12,border:`1.5px solid ${T.line}`,
              background:T.paper,color:T.ink,fontSize:"16px",outline:"none",transition:"border-color .15s"}}
            onFocus={e=>e.target.style.borderColor="#c8f135"}
            onBlur={e=>e.target.style.borderColor=T.line}/>
          <Btn onClick={()=>parseAndLog(input)} disabled={loading||!input.trim()} style={{minWidth:52}}>
            {loading?"…":"→"}
          </Btn>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn full v="outline" sm onClick={()=>fileRef.current?.click()} disabled={loading}>
            📷 Photo
          </Btn>
          <input ref={fileRef} type="file" accept="image/*" capture="environment"
            style={{display:"none"}} onChange={handlePhoto}/>
          <div style={{fontSize:"0.68rem",color:T.inkLight,flex:1,display:"flex",alignItems:"center",lineHeight:1.4}}>
            {AI_AVAILABLE?"Describe your meal or take a photo":"Requires deployment"}
          </div>
        </div>
      </>}
    </Card>
  );
}

// ─── Nutrition Error Boundary — catches crashes in Eat tab without killing whole app ──
class NutritionBoundary extends Component {
  constructor(props) { super(props); this.state = {err:false}; }
  static getDerivedStateFromError() { return {err:true}; }
  componentDidCatch(e) { console.error("Nutrition tab error:", e); }
  render() {
    if (this.state.err) return (
      <div style={{padding:"20px",textAlign:"center"}}>
        <div style={{fontSize:"1.5rem",marginBottom:12}}>🥗</div>
        <div style={{fontWeight:700,color:T.ink,marginBottom:6}}>Nutrition tab had a hiccup</div>
        <div style={{fontSize:"0.82rem",color:T.inkMid,marginBottom:16}}>Your data is safe.</div>
        <button onClick={()=>this.setState({err:false})}
          style={{background:"#c8f135",color:"#0d0d0d",border:"none",borderRadius:10,
            padding:"10px 24px",fontWeight:700,cursor:"pointer"}}>
          Reload tab
        </button>
      </div>
    );
    return this.props.children;
  }
}

// ─── Recent Foods Picker — extracted from Nutrition render to fix hooks violation ──
function RecentFoodsPicker({s, onSelect}) {
  const [histTab, setHistTab] = useState("recent");
  const list = histTab === "fav" ? (s.favFoods||[]) : (s.recentFoods||[]);

  if ((s.recentFoods||[]).length === 0 && (s.favFoods||[]).length === 0) return null;

  return (
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",gap:6,marginBottom:8}}>
        {["recent","fav"].map(t=>(
          <button key={t} onClick={()=>setHistTab(t)}
            style={{padding:"4px 12px",borderRadius:20,
              border:`1px solid ${histTab===t?"#c8f135":T.line}`,
              background:histTab===t?"#1e2a00":"transparent",
              color:histTab===t?"#c8f135":T.inkMid,
              fontSize:"0.72rem",fontWeight:600,cursor:"pointer"}}>
            {t==="recent"?"🕐 Recent":"⭐ Favourites"}
          </button>
        ))}
      </div>
      {list.length===0
        ? <div style={{fontSize:"0.76rem",color:T.inkMid,fontStyle:"italic",paddingBottom:4}}>
            {histTab==="fav"?"Star foods below to save them here.":"No recent foods yet."}
          </div>
        : <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:6,WebkitOverflowScrolling:"touch"}}>
            {list.slice(0,10).map((fd,i)=>(
              <button key={i} onClick={()=>{onSelect(fd);haptic("light");}}
                style={{flexShrink:0,padding:"6px 12px",borderRadius:10,
                  border:`1px solid ${T.line}`,background:T.paperAlt,cursor:"pointer",
                  textAlign:"left",maxWidth:140,minHeight:44,display:"flex",flexDirection:"column",justifyContent:"center"}}>
                <div style={{fontSize:"0.76rem",fontWeight:600,color:T.ink,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:120}}>{fd.name}</div>
                <div style={{fontSize:"0.62rem",color:T.inkMid,marginTop:2}}>{fd.cal} cal · P{fd.pro}g</div>
              </button>
            ))}
          </div>
      }
    </div>
  );
}

// ─── Day-Type Macro Editor — extracted to fix hooks-in-render violation ──
function DayMacroEditor({s, D, toast}) {
  const dt = s.macroGoalsByDayType;
  const [dtf, setDtf] = useState({
    training:{...dt?.training},
    rest:{...dt?.rest}
  });

  // Sync when parent state changes (e.g. initial load)
  // Use key reset pattern via parent instead of effect
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {[
        {key:"training",label:"🏋️ Training days",color:T.orange},
        {key:"rest",    label:"😴 Rest days",   color:T.blue},
      ].map(({key,label,color})=>(
        <div key={key}>
          <div style={{fontSize:"0.7rem",fontWeight:700,letterSpacing:"0.06em",
            textTransform:"uppercase",color,marginBottom:8}}>{label}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[
              {k:"cal",  label:"Calories"},
              {k:"pro",  label:"Protein (g)"},
              {k:"carb", label:"Carbs (g)"},
              {k:"fat",  label:"Fat (g)"},
            ].map(({k,label})=>(
              <div key={k}>
                <div style={{fontSize:"0.55rem",fontWeight:600,letterSpacing:"0.06em",
                  textTransform:"uppercase",color:T.inkLight,marginBottom:4}}>{label}</div>
                <Inp type="number"
                  value={dtf[key]?.[k]||""}
                  onChange={e=>setDtf(prev=>({...prev,[key]:{...prev[key],[k]:parseInt(e.target.value)||0}}))}
                  style={{padding:"9px 12px",fontSize:"0.92rem"}}/>
              </div>
            ))}
          </div>
        </div>
      ))}
      <Btn full onClick={()=>{
        D({t:"DAY_MACROS",v:{training:dtf.training,rest:dtf.rest}});
        toast("Day targets saved ✓");
      }}>
        Save day targets
      </Btn>
    </div>
  );
}

function Nutrition({s,D,toast,nutDate,setNutDate,nutTab,setNutTab,insights}) {
  const tab=nutTab; const setTab=setNutTab;
  const date=nutDate; const setDate=setNutDate;
  const [f,sf]=useState({name:"",slot:"breakfast",cal:"",pro:"",carb:"",fat:""});
  const [open,setOpen]=useState({});
  const [picker,setPicker]=useState(false);
  const [showTemplates,setShowTemplates]=useState(false);
  const [savingTemplate,setSavingTemplate]=useState(null); // slot id being saved
  const [mf,smf]=useState(()=>({...s.macroGoals}));
  const meals=s.meals[date]||{};
  const {cal,pro,carb,fat}=sumM(meals);
  const g=s.macroGoals;
  const wkD=getWk();

  // 30-day date list — stable, recomputed only when TODAY changes (once per day)
  const last30Days = useMemo(()=>Array.from({length:30},(_,i)=>{const d=new Date();d.setDate(d.getDate()-i);return localDate(d);}), []);

  return (
    <div className="fu">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 18px",gap:10}}>
        <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>Nutrition</h1>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {(s.mealTemplates||[]).length>0&&<Btn sm v="ghost" onClick={()=>setShowTemplates(true)}>📋</Btn>}
          <Inp type="date" value={date} onChange={e=>setDate(e.target.value)} style={{width:"auto",fontSize:"0.82rem",padding:"8px 10px"}}/>
        </div>
      </div>

      <div style={{display:"flex",borderBottom:`1px solid ${T.line}`,marginBottom:14}}>
        {[{k:"today",l:"Today"},{k:"history",l:"History"},{k:"water",l:"💧 Water"},{k:"macros",l:"Goals"}].map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)} style={{flex:1,background:"none",border:"none",fontFamily:"'DM Sans',sans-serif",fontWeight:500,fontSize:"0.78rem",color:tab===t.k?T.ink:T.inkMid,padding:"10px 4px",cursor:"pointer",borderBottom:`2px solid ${tab===t.k?"#c8f135":"transparent"}`,marginBottom:-1}}>
            {t.l}
          </button>
        ))}
      </div>

      {/* ── AI Coach tip — nutrition-specific, shown on Today and Water tabs ── */}
      {(tab==="today"||tab==="water")&&<InlineTip s={s} type={tab==="water"?"recovery":"nutrition"} insights={insights}/>}

      {tab==="today"&&<>
        {/* ── AI Nutrition Input (uses NutritionAI component, already defined above) ── */}
        <NutritionAI s={s} D={D} toast={toast} date={date}/>

        {/* Macro summary — pinned at top */}
        <div style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:14,padding:"14px 16px",marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,.05)"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:10}}>
            {[{v:cal,goal:g.cal,l:"kcal",c:T.sage},{v:pro,goal:g.pro,l:"prot",c:T.slate},{v:carb,goal:g.carb,l:"carb",c:T.sky},{v:fat,goal:g.fat,l:"fat",c:T.stone}].map(x=>(
              <div key={x.l} style={{textAlign:"center"}}>
                <div style={{fontSize:"1.15rem",fontWeight:800,color:x.v>0?x.c:T.inkLight,lineHeight:1}}>{x.l==="kcal"?x.v:x.v+"g"}</div>
                <div style={{fontSize:"0.55rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.09em",marginTop:2}}>{x.l}</div>
                {x.goal>0&&<div style={{height:3,background:T.lineSoft,borderRadius:99,overflow:"hidden",marginTop:4}}>
                  <div style={{height:"100%",width:`${Math.min(100,Math.round(x.v/x.goal*100))}%`,background:x.c,borderRadius:99}}/>
                </div>}
              </div>
            ))}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:"0.68rem",color:T.inkLight}}>{g.cal>0?`${Math.max(0,g.cal-cal)} kcal remaining`:""}</span>
            <span style={{fontSize:"0.68rem",color:cal>g.cal&&g.cal>0?T.red:T.green,fontWeight:600}}>{g.cal>0?`${Math.round(cal/g.cal*100)}% of goal`:""}</span>
          </div>
        </div>

        {/* Meal slots */}
        {MEAL_SLOTS.map(slot=>{
          const items=(meals[slot.id]||[]);
          const slotCal=items.reduce((a,i)=>a+(i.cal||0),0);
          const isOpen=open[slot.id];
          return (
            <div key={slot.id} style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:12,marginBottom:8,overflow:"hidden"}}>
              <div onClick={()=>setOpen(p=>({...p,[slot.id]:!isOpen}))} style={{padding:"13px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",minHeight:52}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:"1.1rem"}}>{slot.icon}</span>
                  <span style={{fontWeight:500,fontSize:"0.9rem",color:T.ink}}>{slot.label}</span>
                  {items.length>0&&<Pill>{items.length}</Pill>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {slotCal>0&&<span style={{fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace",fontSize:"0.68rem",color:T.inkLight}}>{slotCal}</span>}
                  <span style={{color:T.inkLight,fontSize:"0.7rem"}}>{isOpen?"▲":"▼"}</span>
                </div>
              </div>
              {isOpen&&<div style={{borderTop:`1px solid ${T.lineSoft}`,padding:"12px 16px"}}>
                {items.map((item,idx)=>(
                  <div key={idx} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${T.lineSoft}`}}>
                    <div style={{minWidth:0,flex:1}}>
                      <div style={{fontWeight:500,fontSize:"0.88rem",color:T.ink,marginBottom:2}}>{item.name}</div>
                      <div style={{fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace",fontSize:"0.64rem",color:T.inkLight}}>{item.cal}cal · P{item.pro} C{item.carb} F{item.fat}</div>
                    </div>
                    <button onClick={()=>{
                      const saved={...item};
                      D({t:"DEL_M",date,slot:slot.id,idx});
                      haptic("light");
                      toast("Food removed",()=>{D({t:"ADD_M",date,slot:slot.id,item:saved});toast("Undone ✓");});
                    }} style={{background:"none",border:"none",color:T.inkLight,cursor:"pointer",padding:"6px 8px",fontSize:"0.9rem",minHeight:44,display:"flex",alignItems:"center",flexShrink:0}}>✕</button>
                  </div>
                ))}
                {!items.length&&<p style={{fontSize:"0.82rem",color:T.inkMid,fontWeight:500,paddingBottom:4}}>Nothing added yet.</p>}
                {items.length>0&&<button onClick={()=>{
                  const tpl={id:Date.now(),name:`${slot.label} template`,slot:slot.id,items:[...items]};
                  D({t:"SAVE_MT",tpl});
                  haptic("medium");
                  toast(`Template saved: ${slot.label}`);
                }}
                  style={{background:"none",border:"none",color:T.inkMid,cursor:"pointer",
                    fontSize:"0.72rem",fontWeight:500,padding:"8px 0",minHeight:36,
                    display:"flex",alignItems:"center",gap:4}}>
                  📋 Save as template
                </button>}
              </div>}
            </div>
          );
        })}

        {/* Macro breakdown by slot */}
        {Object.values(meals).some(items=>items.length>0)&&<Card style={{marginTop:12,marginBottom:0}}>
          <Sec>Macros by meal</Sec>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {MEAL_SLOTS.map(slot=>{
              const items=meals[slot.id]||[];
              if(!items.length) return null;
              const sc=items.reduce((a,i)=>a+(i.cal||0),0);
              const sp=items.reduce((a,i)=>a+(i.pro||0),0);
              const sb=items.reduce((a,i)=>a+(i.carb||0),0);
              const sf2=items.reduce((a,i)=>a+(i.fat||0),0);
              return (
                <div key={slot.id} style={{display:"flex",justifyContent:"space-between",
                  alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${T.lineSoft}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                    <span style={{fontSize:"0.9rem",flexShrink:0}}>{slot.icon}</span>
                    <span style={{fontSize:"0.8rem",color:T.inkMid,fontWeight:500}}>{slot.label}</span>
                  </div>
                  <div style={{display:"flex",gap:10,flexShrink:0}}>
                    <span style={{fontFamily:"ui-monospace,monospace",fontSize:"0.68rem",color:T.sage}}>{sp}g P</span>
                    <span style={{fontFamily:"ui-monospace,monospace",fontSize:"0.68rem",color:T.sky}}>{sb}g C</span>
                    <span style={{fontFamily:"ui-monospace,monospace",fontSize:"0.68rem",color:T.inkLight}}>{sc} cal</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>}

        {/* Quick add */}
        <Card style={{marginTop:12}}>
          <Sec>Quick add food</Sec>

          {/* Recent foods & favourites quick-pick — proper component, no hooks in render */}
          <RecentFoodsPicker s={s} onSelect={fd=>sf(p=>({...p,name:fd.name,cal:String(fd.cal),pro:String(fd.pro),carb:String(fd.carb),fat:String(fd.fat)}))}/>

          <FL label="Food name"><Inp value={f.name} onChange={e=>sf(p=>({...p,name:e.target.value}))} placeholder="Chicken, oatmeal…" maxLength={80}/></FL>
          <FL label="Meal slot"><Sel value={f.slot} onChange={e=>sf(p=>({...p,slot:e.target.value}))}>{MEAL_SLOTS.map(sl=><option key={sl.id} value={sl.id}>{sl.icon} {sl.label}</option>)}</Sel></FL>
          <EstimateBtn name={f.name} onResult={est=>{sf(p=>({...p,cal:String(est.cal),pro:String(est.pro),carb:String(est.carb),fat:String(est.fat)}));}}
            onIngredient={item=>{sf(p=>({...p,name:p.name||item}));}}
          />
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <FL label="Calories"><Inp type="number" value={f.cal} onChange={e=>sf(p=>({...p,cal:e.target.value}))} placeholder="300"/></FL>
            <FL label="Protein (g)"><Inp type="number" value={f.pro} onChange={e=>sf(p=>({...p,pro:e.target.value}))} placeholder="30"/></FL>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <FL label="Carbs (g)"><Inp type="number" value={f.carb} onChange={e=>sf(p=>({...p,carb:e.target.value}))} placeholder="40"/></FL>
            <FL label="Fat (g)"><Inp type="number" value={f.fat} onChange={e=>sf(p=>({...p,fat:e.target.value}))} placeholder="10"/></FL>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:4}}>
            <Btn full v="outline" sm onClick={()=>setPicker(true)}>📖 Recipe</Btn>
            <Btn full v="ghost" sm onClick={()=>{
              if(!f.name.trim()){toast("Enter a name first");return;}
              const fd={name:f.name,cal:parseInt(f.cal)||0,pro:parseInt(f.pro)||0,carb:parseInt(f.carb)||0,fat:parseInt(f.fat)||0};
              D({t:"FAV_FOOD",food:fd});haptic("medium");toast("⭐ Saved to favourites");
            }}>⭐ Fav</Btn>
            <Btn full sm onClick={()=>{
              if(!f.name.trim()){toast("Enter a name");return;}
              const item={name:f.name,cal:parseInt(f.cal)||0,pro:parseInt(f.pro)||0,carb:parseInt(f.carb)||0,fat:parseInt(f.fat)||0};
              D({t:"ADD_M",date,slot:f.slot,item});
              setOpen(p=>({...p,[f.slot]:true}));
              sf(p=>({...p,name:"",cal:"",pro:"",carb:"",fat:""}));
              haptic("success");
              toast("Added ✓");
            }}>+ Add</Btn>
          </div>
        </Card>
      </>}

      {tab==="history"&&<>
        {/* 30-day calorie trend chart */}
        {(()=>{
          const calData=last30Days.map(d=>sumM(s.meals[d]||{}).cal).reverse();
          const proData=last30Days.map(d=>sumM(s.meals[d]||{}).pro).reverse();
          const maxCal=Math.max(...calData,g.cal,1);
          const loggedDays=calData.filter(v=>v>0).length;
          const avgCal=loggedDays>0?Math.round(calData.filter(v=>v>0).reduce((a,b)=>a+b,0)/loggedDays):0;
          const proStreak=calcProStreak(s.meals,g);
          return (
            <Card style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
                <div>
                  <div style={{fontSize:"0.58rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.green,marginBottom:4}}>30-day avg</div>
                  <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.6rem",fontWeight:800,color:T.ink,lineHeight:1}}>{avgCal>0?avgCal:"—"} kcal/day</div>
                </div>
                {proStreak>0&&<div style={{textAlign:"right"}}>
                  <div style={{fontSize:"0.58rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.purple,marginBottom:4}}>Protein streak</div>
                  <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.6rem",fontWeight:800,color:T.purple,lineHeight:1}}>{proStreak}d</div>
                </div>}
              </div>
              {/* Calorie bars */}
              <div style={{display:"flex",alignItems:"flex-end",gap:2,height:48,marginBottom:6}}>
                {calData.map((v,i)=>{
                  const h=v>0?Math.max(4,Math.round(v/maxCal*48)):2;
                  const over=g.cal>0&&v>g.cal;
                  return <div key={i} style={{flex:1,height:h,borderRadius:"2px 2px 0 0",
                    background:v>0?(over?T.red:T.green):T.lineSoft,transition:"height .3s",opacity:v>0?1:.4}}/>;
                })}
              </div>
              {g.cal>0&&<div style={{fontSize:"0.6rem",color:T.inkLight}}>
                Goal: {g.cal} kcal/day · {loggedDays}/30 days logged
              </div>}
            </Card>
          );
        })()}
        <Card>
          <Sec>Daily log</Sec>
          {last30Days.map(d=>{
            const{cal:c,pro:p,carb:cb,fat:f}=sumM(s.meals[d]||{});
            const pct=g.cal>0?Math.min(100,Math.round(c/g.cal*100)):0;
            const proHit=g.pro>0&&p>=g.pro*0.85;
            return <div key={d} style={{padding:"10px 0",borderBottom:`1px solid ${T.lineSoft}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:c>0?5:0}}>
                <div>
                  <div style={{fontWeight:500,fontSize:"0.86rem",display:"flex",alignItems:"center",gap:6}}>
                    {d===TODAY?"Today":fmtD(d)}
                    {proHit&&<span style={{fontSize:"0.6rem",color:T.purple}}>💪</span>}
                  </div>
                  {c>0&&<div style={{fontSize:"0.64rem",color:T.inkLight,marginTop:1}}>{c} kcal · P{p}g C{cb}g F{f}g</div>}
                </div>
                <Pill color={c>g.cal&&g.cal>0?"rose":c>0?"sage":"stone"}>{c>0?`${pct}%`:"—"}</Pill>
              </div>
              {c>0&&g.cal>0&&<div style={{height:3,background:T.lineSoft,borderRadius:99,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${pct}%`,background:c>g.cal?T.red:T.green,borderRadius:99}}/>
              </div>}
            </div>;
          })}
        </Card>
      </>}

      {tab==="macros"&&<Card>
        <Sec>Daily macro goals</Sec>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Calories"><Inp type="number" value={mf.cal} onChange={e=>smf(p=>({...p,cal:parseInt(e.target.value)||0}))}/></FL>
          <FL label="Protein (g)"><Inp type="number" value={mf.pro} onChange={e=>smf(p=>({...p,pro:parseInt(e.target.value)||0}))}/></FL>
          <FL label="Carbs (g)"><Inp type="number" value={mf.carb} onChange={e=>smf(p=>({...p,carb:parseInt(e.target.value)||0}))}/></FL>
          <FL label="Fat (g)"><Inp type="number" value={mf.fat} onChange={e=>smf(p=>({...p,fat:parseInt(e.target.value)||0}))}/></FL>
        </div>
        <Btn full style={{marginTop:4}} onClick={()=>{D({t:"MACROS",v:mf});toast("Goals saved ✓");}}>Save goals</Btn>

        {/* Day-type macro targets */}
        <div style={{marginTop:20,paddingTop:16,borderTop:`1px solid ${T.lineSoft}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div>
              <div style={{fontWeight:600,fontSize:"0.88rem",color:T.ink}}>Different targets by day type</div>
              <div style={{fontSize:"0.72rem",color:T.inkLight,marginTop:2}}>
                Training days vs rest days
              </div>
            </div>
            <button onClick={()=>D({t:"DAY_MACROS",v:{useDayType:!(s.macroGoalsByDayType?.useDayType)}})}
              style={{
                width:48,height:28,borderRadius:14,cursor:"pointer",border:"none",
                background:s.macroGoalsByDayType?.useDayType?"#c8f135":"#333",
                position:"relative",transition:"background .2s",flexShrink:0,
              }}>
              <div style={{
                position:"absolute",top:3,
                left:s.macroGoalsByDayType?.useDayType?22:3,
                width:22,height:22,borderRadius:"50%",
                background:"#fff",transition:"left .2s",
                boxShadow:"0 1px 3px rgba(0,0,0,.3)",
              }}/>
            </button>
          </div>

          {s.macroGoalsByDayType?.useDayType&&
            <DayMacroEditor
              key={JSON.stringify(s.macroGoalsByDayType)}
              s={s} D={D} toast={toast}
            />
          }
        </div>
      </Card>}

      {/* InlineTip for nutrition already shown above tabs */}

      {tab==="water"&&<WaterTab s={s} D={D} toast={toast}/>}

      {/* Meal templates modal */}
      <Modal open={showTemplates} onClose={()=>setShowTemplates(false)} title="Meal templates">
        {(s.mealTemplates||[]).length===0
          ?<Empty icon="📋" text="No templates yet. Save a meal slot as a template to reuse it quickly."/>
          :(s.mealTemplates||[]).map(tpl=>(
            <div key={tpl.id} style={{background:T.paperAlt,borderRadius:12,padding:"12px 14px",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div>
                  <div style={{fontWeight:700,fontSize:"0.9rem",color:T.ink}}>{tpl.name}</div>
                  <div style={{fontSize:"0.68rem",color:T.inkLight,marginTop:2}}>
                    {tpl.items.length} items · {tpl.items.reduce((a,i)=>a+(i.cal||0),0)} cal
                  </div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <Btn sm onClick={()=>{
                    tpl.items.forEach(item=>D({t:"ADD_M",date,slot:tpl.slot,item}));
                    setOpen(p=>({...p,[tpl.slot]:true}));
                    setShowTemplates(false);
                    haptic("success");
                    toast(`${tpl.name} applied ✓`);
                  }}>Apply</Btn>
                  <button onClick={()=>{D({t:"DEL_MT",id:tpl.id});toast("Template removed");}}
                    style={{background:"none",border:"none",color:T.inkLight,cursor:"pointer",padding:"4px 8px",fontSize:"0.9rem"}}>✕</button>
                </div>
              </div>
              {tpl.items.map((item,i)=>(
                <div key={i} style={{fontSize:"0.74rem",color:T.inkMid,padding:"3px 0",
                  borderTop:i>0?`1px solid ${T.lineSoft}`:"none"}}>
                  {item.name} — {item.cal}cal P{item.pro}g
                </div>
              ))}
            </div>
          ))
        }
      </Modal>

      <Modal open={picker} onClose={()=>setPicker(false)} title="Add from recipe">
        {s.recipes.length ? s.recipes.map(r=>(
          <div key={r.id} onClick={()=>{D({t:"ADD_M",date,slot:f.slot,item:{name:r.name,cal:r.cal,pro:r.pro,carb:r.carb,fat:r.fat}});setPicker(false);toast(r.name+" added ✓");}}
            style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",background:T.paperAlt,borderRadius:10,marginBottom:8,cursor:"pointer"}}>
            <div>
              <div style={{fontWeight:500,fontSize:"0.9rem"}}>{r.name}</div>
              <div style={{fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace",fontSize:"0.64rem",color:T.inkLight,marginTop:2}}>{r.cal}cal · P{r.pro} C{r.carb} F{r.fat}</div>
            </div>
            <Pill color="slate">Add</Pill>
          </div>
        )) : <Empty icon="📖" text="No recipes saved yet."/>}
      </Modal>
    </div>
  );
}

function Recipes({s,D,toast}) {
  const [filter,setFilter]=useState("all");
  const [recipeSearch,setRecipeSearch]=useState("");
  const [modal,setModal]=useState(false);
  const [detail,setDetail]=useState(null);
  const [logSlot,setLS]=useState("breakfast");
  const [logSrv,setLSrv]=useState(1);
  const ef={name:"",cat:"breakfast",servings:1,cal:"",pro:"",carb:"",fat:"",ingr:"",notes:""};
  const [f,sf]=useState(ef);
  const [editing,setEditing]=useState(null);
  const cats=["all","breakfast","lunch","dinner","pre","post","snack"];
  const filtered=s.recipes
    .filter(r=>filter==="all"||r.cat===filter)
    .filter(r=>!recipeSearch||r.name.toLowerCase().includes(recipeSearch.toLowerCase())||r.ingr?.toLowerCase().includes(recipeSearch.toLowerCase()));

  const save=()=>{
    if(!f.name.trim()){toast("Enter a name");return;}
    const r={...f,id:editing?.id||Date.now(),cal:parseInt(f.cal)||0,pro:parseInt(f.pro)||0,carb:parseInt(f.carb)||0,fat:parseInt(f.fat)||0};
    D({t:"SAVE_R",r});setModal(false);setEditing(null);toast("Recipe saved ✓");
  };

  return (
    <div className="fu">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 18px"}}>
        <h1 style={{fontWeight:800,fontStyle:"normal",fontSize:"1.6rem",fontWeight:600,color:T.ink}}>Recipes</h1>
        {!modal&&<Btn sm onClick={()=>{sf(ef);setEditing(null);setModal(true);}}>+ New</Btn>}
      </div>

      {/* Recipe form — shown at top when adding/editing */}
      {modal&&<Card style={{marginBottom:14,border:`1.5px solid ${T.slate}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:"1rem",color:T.ink}}>{editing?"Edit recipe":"New recipe"}</div>
          <button onClick={()=>{setModal(false);setEditing(null);}} style={{background:"none",border:"none",fontSize:"1.2rem",color:T.inkLight,cursor:"pointer",padding:"4px 8px",lineHeight:1}}>✕</button>
        </div>
        <FL label="Recipe name"><Inp value={f.name} onChange={e=>sf(p=>({...p,name:e.target.value}))} placeholder="Grilled Chicken Bowl" maxLength={80}/></FL>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Category"><Sel value={f.cat} onChange={e=>sf(p=>({...p,cat:e.target.value}))}>{Object.entries(CAT_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</Sel></FL>
          <FL label="Servings"><Inp type="number" value={f.servings} onChange={e=>sf(p=>({...p,servings:e.target.value}))}/></FL>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Calories"><Inp type="number" value={f.cal} onChange={e=>sf(p=>({...p,cal:e.target.value}))} placeholder="450"/></FL>
          <FL label="Protein (g)"><Inp type="number" value={f.pro} onChange={e=>sf(p=>({...p,pro:e.target.value}))} placeholder="38"/></FL>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Carbs (g)"><Inp type="number" value={f.carb} onChange={e=>sf(p=>({...p,carb:e.target.value}))} placeholder="40"/></FL>
          <FL label="Fat (g)"><Inp type="number" value={f.fat} onChange={e=>sf(p=>({...p,fat:e.target.value}))} placeholder="12"/></FL>
        </div>
        <FL label="Ingredients"><Area value={f.ingr} onChange={e=>sf(p=>({...p,ingr:e.target.value}))} placeholder="Ingredients, one per line…"/></FL>
        <EstimateBtn name={f.name} ingr={f.ingr} servings={f.servings}
          onResult={est=>{sf(p=>({...p,cal:String(est.cal),pro:String(est.pro),carb:String(est.carb),fat:String(est.fat)}));}}
          onIngredient={item=>{sf(p=>({...p,ingr:(p.ingr?p.ingr+"\n":"")+item}));}}
        />
        <FL label="Notes"><Area value={f.notes} onChange={e=>sf(p=>({...p,notes:e.target.value}))} placeholder="Quick prep notes…"/></FL>
        <Btn full onClick={save} style={{marginTop:4}}>Save recipe</Btn>
        <Btn full v="outline" onClick={()=>{setModal(false);setEditing(null);}} style={{marginTop:8}}>Cancel</Btn>
      </Card>}

      {/* Recipe list — hidden while form is open */}
      {!modal&&<>
      {/* Filter pills */}
      <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4,marginBottom:16,WebkitOverflowScrolling:"touch"}}>
        {cats.map(c=>(
          <button key={c} onClick={()=>setFilter(c)} style={{background:filter===c?T.slate:"transparent",color:filter===c?"#fff":T.inkMid,border:`1px solid ${filter===c?T.slate:T.line}`,borderRadius:20,fontFamily:"'Inter',sans-serif",fontSize:"0.78rem",fontWeight:500,padding:"6px 14px",cursor:"pointer",textTransform:"capitalize",whiteSpace:"nowrap",flexShrink:0}}>{c}</button>
        ))}
      </div>

      {filtered.length ? filtered.map(r=>(
        <div key={r.id} style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:14,padding:"16px",marginBottom:10,cursor:"pointer"}} onClick={()=>{setDetail(r);setLS(r.cat||"breakfast");setLSrv(1);}}>
          <div style={{fontWeight:800,fontStyle:"normal",fontWeight:600,fontSize:"1rem",color:T.ink,marginBottom:3}}>{r.name}</div>
          <div style={{fontSize:"0.78rem",color:T.inkMid,marginBottom:10,fontStyle:"italic"}}>{CAT_LABELS[r.cat]||r.cat}</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
            <Pill color="sage">{r.cal} kcal</Pill><Pill color="slate">P {r.pro}g</Pill><Pill color="sky">C {r.carb}g</Pill><Pill color="stone">F {r.fat}g</Pill>
          </div>
          <div style={{display:"flex",gap:8}} onClick={e=>e.stopPropagation()}>
            <Btn sm v="ghost" onClick={()=>{sf({...r});setEditing(r);setModal(true);}}>Edit</Btn>
            <Btn sm v="danger" onClick={()=>{if(!window.__recipeConfirm){window.__recipeConfirm=r.id;setTimeout(()=>{window.__recipeConfirm=null;},3000);toast("Tap Delete again to confirm");}else if(window.__recipeConfirm===r.id){window.__recipeConfirm=null;D({t:"DEL_R",id:r.id});toast("Removed");}}}>Delete</Btn>
          </div>
        </div>
      )) : <Empty icon="📖" text="No recipes yet."/>}
      </>}


      <Modal open={!!detail} onClose={()=>setDetail(null)} title={detail?.name||""} sub={CAT_LABELS[detail?.cat]||""}>
        {detail&&<>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
            {[{v:detail.cal,l:"kcal",c:T.sage},{v:detail.pro+"g",l:"protein",c:T.slate},{v:detail.carb+"g",l:"carbs",c:T.sky},{v:detail.fat+"g",l:"fat",c:T.stone}].map(x=>(
              <div key={x.l} style={{background:T.paperAlt,borderRadius:10,padding:"12px",textAlign:"center"}}>
                <div style={{fontWeight:800,fontStyle:"normal",fontWeight:600,fontSize:"1.1rem",color:x.c}}>{x.v}</div>
                <div style={{fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace",fontSize:"0.58rem",color:T.inkLight,textTransform:"uppercase",marginTop:2}}>{x.l}</div>
              </div>
            ))}
          </div>
          {detail.ingr&&<><Sec>Ingredients</Sec>{detail.ingr.split("\n").filter(Boolean).map((ing,i)=><div key={i} style={{fontSize:"0.84rem",padding:"7px 0",borderBottom:`1px solid ${T.lineSoft}`,color:T.inkMid}}>{ing}</div>)}<Divider/></>}
          {detail.notes&&<><Sec>Notes</Sec><p style={{fontSize:"0.84rem",color:T.inkMid,fontStyle:"italic",marginBottom:16}}>{detail.notes}</p><Divider/></>}
          <Sec>Log this recipe</Sec>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
            <FL label="Meal slot"><Sel value={logSlot} onChange={e=>setLS(e.target.value)}>{MEAL_SLOTS.map(sl=><option key={sl.id} value={sl.id}>{sl.icon} {sl.label}</option>)}</Sel></FL>
            <FL label="Servings"><Inp type="number" value={logSrv} onChange={e=>setLSrv(parseFloat(e.target.value)||1)} min="0.5" step="0.5"/></FL>
          </div>
          <Btn full onClick={()=>{const item={name:detail.name+(logSrv!==1?` ×${logSrv}`:""),cal:Math.round(detail.cal*logSrv),pro:Math.round(detail.pro*logSrv),carb:Math.round(detail.carb*logSrv),fat:Math.round(detail.fat*logSrv)};D({t:"ADD_M",date:TODAY,slot:logSlot,item});setDetail(null);toast(detail.name+" logged ✓");}}
            style={{marginBottom:8}}>
            ✓ Log to {MEAL_SLOTS.find(sl=>sl.id===logSlot)?.label||logSlot}
          </Btn>
          <Btn full v="outline" onClick={()=>setDetail(null)}>Close</Btn>
        </>}
      </Modal>
    </div>
  );
}

function WaterWeekChart({wkData, goal, maxOz}) {
  const [selDay, setSelDay] = useState(null);
  return (
    <Card>
      <Sec>This week</Sec>
      <div style={{display:"flex",alignItems:"flex-end",gap:5,height:80,marginBottom:16}}>
        {wkData.map((d,i)=>(
          <div key={i} onClick={()=>setSelDay(selDay===d.d?null:d.d)}
            style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,flex:1,cursor:"pointer"}}>
            {selDay===d.d&&d.oz>0&&<span style={{fontSize:"0.5rem",color:T.sky,fontWeight:700,whiteSpace:"nowrap"}}>{d.oz}oz</span>}
            <div style={{width:"100%",borderRadius:"3px 3px 0 0",
              height:`${Math.max(2,Math.round(d.oz/maxOz*70))}px`,
              background:selDay===d.d?T.blue:d.oz>=goal?T.sky:T.slateL,
              transition:"all .2s",boxShadow:selDay===d.d?`0 0 8px ${T.blue}44`:"none"}}/>
            <span style={{fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace",fontSize:"0.52rem",
              color:selDay===d.d?T.blue:T.inkLight,fontWeight:selDay===d.d?700:400}}>{d.l}</span>
          </div>
        ))}
      </div>
      {selDay&&(()=>{
        const sd=wkData.find(d=>d.d===selDay);
        return sd?<div style={{background:T.blueL,border:`1px solid ${T.blue}33`,borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:600,fontSize:"0.88rem"}}>{selDay===TODAY?"Today":fmtD(selDay)}</div>
            <div style={{fontSize:"0.72rem",color:T.inkMid,marginTop:2}}>{sd.oz} oz of {goal} oz goal</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:"1.2rem",fontWeight:800,color:sd.oz>=goal?T.sky:T.inkMid}}>{Math.round(sd.oz/goal*100)}%</div>
            <Pill color={sd.oz>=goal?"sky":sd.oz>0?"slate":"stone"}>{sd.oz>=goal?"✓ Hit":"Not hit"}</Pill>
          </div>
        </div>:null;
      })()}
      {wkData.slice().reverse().map(d=>(
        <div key={d.d} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${T.lineSoft}`}}>
          <div>
            <div style={{fontWeight:500,fontSize:"0.88rem"}}>{d.d===TODAY?"Today":fmtD(d.d)}</div>
            <div style={{fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace",fontSize:"0.64rem",color:T.inkLight,marginTop:2}}>{d.oz} oz</div>
          </div>
          <Pill color={d.oz>=goal?"sky":d.oz>0?"slate":"stone"}>{d.oz>=goal?"✓":d.oz+"/"+goal+"oz"}</Pill>
        </div>
      ))}
    </Card>
  );
}

function Water({s,D,toast}) {
  const oz=s.water[TODAY]||0;
  const goal=s.waterGoal||64;
  const inc=s.waterInc||8;
  const [gv,sgv]=useState(goal);
  const pct=Math.min(100,Math.round(oz/goal*100));
  const wkD=getWk();
  const wkData=wkD.map(d=>({d,oz:s.water[d]||0,l:["S","M","T","W","T","F","S"][new Date(d+"T12:00").getDay()]}));
  const maxOz=Math.max(...wkData.map(d=>d.oz),goal,1);
  // Visual segments — each segment = one increment


  return (
    <div className="fu">
      <PH title="Water Tracker" sub="Track your daily hydration in oz."/>
      <Card style={{marginBottom:14}}>
        {/* Big oz display */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:18}}>
          <div>
            <div style={{display:"flex",alignItems:"baseline",gap:4}}>
              <span style={{fontSize:"3rem",fontWeight:800,color:T.sky,lineHeight:1,letterSpacing:"-0.03em"}}>{oz}</span>
              <span style={{fontSize:"1rem",color:T.inkLight,fontWeight:500}}>oz</span>
            </div>
            <div style={{fontSize:"0.76rem",color:T.inkLight,marginTop:3}}>of {goal} oz goal</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:"1.5rem",fontWeight:800,color:pct>=100?T.sage:T.sky,lineHeight:1}}>{pct}%</div>
            <div style={{fontSize:"0.6rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.06em",marginTop:2}}>of goal</div>
          </div>
        </div>

        {/* Slider */}
        <div style={{marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:"0.72rem",color:T.inkLight}}>0 oz</span>
            <span style={{fontSize:"0.72rem",fontWeight:700,color:T.sky}}>{oz} oz</span>
            <span style={{fontSize:"0.72rem",color:T.inkLight}}>{goal} oz</span>
          </div>
          <input
            type="range"
            min={0}
            max={goal}
            step={1}
            value={oz}
            onChange={e=>D({t:"WATER",v:{...s.water,[TODAY]:parseInt(e.target.value)}})}
            style={{width:"100%",cursor:"pointer","--pct":`${Math.round(oz/goal*100)}%`,
              background:`linear-gradient(to right,${T.sky} ${Math.round(oz/goal*100)}%,var(--line) ${Math.round(oz/goal*100)}%)`}}
            className="water-slider" style={{willChange:"background"}}
          />
          <div style={{display:"flex",justifyContent:"space-between",marginTop:10}}>
            {[0,Math.round(goal*0.25),Math.round(goal*0.5),Math.round(goal*0.75),goal].map(v=>(
              <div key={v} onClick={()=>D({t:"WATER",v:{...s.water,[TODAY]:v}})}
                style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"pointer"}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:oz>=v&&v>0?T.sky:T.lineSoft,transition:"background .2s"}}/>
                <span style={{fontSize:"0.55rem",color:oz>=v&&v>0?T.sky:T.inkLight,fontWeight:Math.abs(oz-v)<4?700:400}}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Settings */}
        <div style={{display:"flex",gap:8,alignItems:"center",paddingTop:14,borderTop:`1px solid ${T.lineSoft}`}}>
          <span style={{fontSize:"0.72rem",color:T.inkLight,flexShrink:0}}>Daily goal</span>
          <input
            type="number"
            value={gv}
            onChange={e=>sgv(e.target.value)}
            onBlur={e=>{const v=parseInt(e.target.value);if(v>0){sgv(v);D({t:"WGOAL",v});toast("Goal updated ✓");}else sgv(goal);}}
            style={{width:72,padding:"8px 10px",borderRadius:10,border:`1px solid ${T.line}`,fontSize:"1rem",color:T.ink,background:T.paper,outline:"none",textAlign:"center"}}
          />
          <span style={{fontSize:"0.72rem",color:T.inkLight}}>oz</span>
          <Btn sm v="outline" onClick={()=>{D({t:"WATER",v:{...s.water,[TODAY]:0}});toast("Reset today");}} style={{marginLeft:"auto"}}>Reset</Btn>
        </div>
      </Card>

      <WaterWeekChart wkData={wkData} goal={goal} maxOz={maxOz}/>
    </div>
  );
}

// Animated progress ring
const Ring = ({pct, color, size=52, stroke=4}) => {
  const r = (size - stroke*2) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * (1 - Math.min(pct,100)/100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{transform:"rotate(-90deg)"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.lineSoft} strokeWidth={stroke}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={dash} strokeLinecap="round"
        style={{transition:"stroke-dashoffset .8s cubic-bezier(.22,.68,0,1.2)"}}/>
    </svg>
  );
};

function Goals({s,D,toast}) {
  const [open,setOpen]=useState(false);
  const ef={name:"",cat:"🏃 Running",date:"",curr:"",target:"",unit:"",autoTrack:false};
  const [f,sf]=useState(ef);

  // Auto-populate progress from workout data
  const autoProgress=(g)=>{
    if(!g.autoTrack) return null;
    const cat=g.cat||"";
    if(cat.includes("Run")||cat.includes("Miles")){
      const cutoff=g.createdAt||"2000-01-01";
      return s.workouts.filter(w=>w.type==="🏃 Run"&&w.date>=cutoff).reduce((a,w)=>a+(parseFloat(w.dist)||0),0).toFixed(1);
    }
    if(cat.includes("Ride")||cat.includes("Cycling")){
      const cutoff=g.createdAt||"2000-01-01";
      return s.workouts.filter(w=>w.type==="🚴 Ride"&&w.date>=cutoff).reduce((a,w)=>a+(parseFloat(w.dist)||0),0).toFixed(1);
    }
    if(cat.includes("Session")||cat.includes("Workout")){
      const cutoff=g.createdAt||"2000-01-01";
      return s.workouts.filter(w=>w.date>=cutoff).length;
    }
    return null;
  };

  return (
    <div className="fu">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 18px"}}>
        <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>Goals</h1>
        <div style={{display:"flex",gap:8}}>
          <Btn sm v="outline" onClick={()=>setShowTpl(true)}>Templates</Btn>
          <Btn sm onClick={()=>{sf(ef);setOpen(true);}}>+ New</Btn>
        </div>
      </div>

      {s.goals.length ? s.goals.map(g=>{
        const autoCurr=autoProgress(g);
        const displayCurr=autoCurr!==null?parseFloat(autoCurr):g.curr;
        const pct=Math.min(100,Math.round(displayCurr/g.target*100));
        const col=pct>=100?T.sage:pct>=60?T.sky:T.stone;
        return (
          <Card key={g.id} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <div style={{flex:1,minWidth:0,paddingRight:10}}>
                <div style={{fontWeight:500,fontSize:"0.92rem",color:T.ink}}>{g.name}</div>
                <div style={{fontSize:"0.76rem",color:T.inkLight,marginTop:2}}>{g.cat}{g.date?" · "+fmtD(g.date):""}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                <div style={{position:"relative",width:52,height:52,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <Ring pct={pct} color={col} size={52} stroke={4}/>
                  <span style={{position:"absolute",fontFamily:"'Barlow Condensed',sans-serif",fontSize:"0.95rem",fontWeight:800,color:col,letterSpacing:"-0.01em"}}>{pct}%</span>
                </div>
                <button onClick={()=>{D({t:"DEL_G",id:g.id});toast("Removed");}} style={{background:"none",border:"none",color:T.inkLight,cursor:"pointer",padding:"4px 6px",minHeight:44,display:"flex",alignItems:"center"}}>✕</button>
              </div>
            </div>
            <div style={{height:4,background:T.lineSoft,borderRadius:99,overflow:"hidden",marginBottom:12}}>
              <div style={{height:"100%",width:`${pct}%`,background:col,borderRadius:99,transition:"width .8s cubic-bezier(.22,.68,0,1.2)"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace",fontSize:"0.65rem",color:T.inkLight}}>{g.curr} / {g.target} {g.unit}</span>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <Inp type="number" defaultValue={g.curr} onBlur={e=>{const v=parseFloat(e.target.value)||0;D({t:"UPD_G",id:g.id,v});if(v>=g.target)haptic("success");}} style={{width:72,padding:"7px 10px",fontSize:"0.84rem"}}/>
                <span style={{fontSize:"0.76rem",color:T.inkLight}}>{g.unit}</span>
              </div>
            </div>
          </Card>
        );
      }) : <Empty icon="🎯" text="No goals set yet."/>}

      {/* Goal templates modal */}
      <Modal open={showTpl} onClose={()=>setShowTpl(false)} title="Goal templates">
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {GOAL_TEMPLATES.map((tpl,i)=>(
            <button key={i} onClick={()=>{
              sf({...ef,name:tpl.name,cat:tpl.cat,target:tpl.target,unit:tpl.unit});
              setShowTpl(false);
              setOpen(true);
            }} style={{padding:"12px 14px",borderRadius:12,border:`1px solid ${T.line}`,
              background:T.paperAlt,cursor:"pointer",textAlign:"left",
              display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:"1.4rem"}}>{tpl.icon}</span>
              <div>
                <div style={{fontWeight:600,fontSize:"0.88rem",color:T.ink}}>{tpl.name}</div>
                <div style={{fontSize:"0.7rem",color:T.inkLight,marginTop:2}}>
                  Target: {tpl.target} {tpl.unit}
                </div>
              </div>
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={open} onClose={()=>setOpen(false)} title="New goal">
        {/* Goal templates quick-pick */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.inkLight,marginBottom:8}}>Quick templates</div>
          <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4}}>
            {GOAL_TEMPLATES.map(tpl=>(
              <button key={tpl.name} onClick={()=>sf(p=>({...p,name:tpl.name,cat:tpl.cat,target:tpl.target,unit:tpl.unit}))}
                style={{flexShrink:0,padding:"6px 12px",borderRadius:10,
                  border:`1px solid ${f.name===tpl.name?"#c8f135":T.line}`,
                  background:f.name===tpl.name?"#1e2a00":T.paperAlt,
                  color:f.name===tpl.name?"#c8f135":T.inkMid,
                  fontSize:"0.72rem",fontWeight:600,cursor:"pointer",
                  display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap"}}>
                <span>{tpl.icon}</span>{tpl.name}
              </button>
            ))}
          </div>
        </div>
        <FL label="Goal name"><Inp value={f.name} onChange={e=>sf(p=>({...p,name:e.target.value}))} placeholder="Run 20 miles this week" maxLength={80}/></FL>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Category"><Sel value={f.cat} onChange={e=>sf(p=>({...p,cat:e.target.value}))}>{["🏃 Running","🏋️ Strength","🥗 Nutrition","⚖️ Body comp","🧘 Recovery","✦ Other"].map(c=><option key={c}>{c}</option>)}</Sel></FL>
          <FL label="Target date"><Inp type="date" value={f.date} onChange={e=>sf(p=>({...p,date:e.target.value}))}/></FL>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Current value"><Inp type="number" value={f.curr} onChange={e=>sf(p=>({...p,curr:e.target.value}))} placeholder="0"/></FL>
          <FL label="Target value"><Inp type="number" value={f.target} onChange={e=>sf(p=>({...p,target:e.target.value}))} placeholder="20"/></FL>
        </div>
        <FL label="Unit (miles, lbs, sessions…)"><Inp value={f.unit} onChange={e=>sf(p=>({...p,unit:e.target.value}))} placeholder="miles"/></FL>
        <div style={{display:"flex",gap:10,marginTop:4}}>
          <Btn full v="outline" onClick={()=>setOpen(false)}>Cancel</Btn>
          <Btn full onClick={()=>{if(!f.name.trim()){toast("Enter a name");return;}D({t:"ADD_G",g:{...f,id:Date.now(),curr:parseFloat(f.curr)||0,target:parseFloat(f.target)||1,autoTrack:f.autoTrack||false,createdAt:_getToday()}});setOpen(false);sf(ef);toast("Goal set ✓");}}>Save</Btn>
        </div>
      </Modal>
    </div>
  );
}

function Weekly({s}) {
  const wkD=getWk();
  const prevWkD=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(13-i));return localDate(d);});

  const weekStats=(days)=>{
    let tBurn=0,aC=0,aP=0,logD=0;
    days.forEach(d=>{
      const{cal:c,pro:p}=sumM(s.meals[d]||{});
      aC+=c; aP+=p; if(c>0)logD++;
      tBurn+=s.workouts.filter(w=>w.date===d).reduce((a,w)=>a+(w.cals||0),0);
    });
    const wW=s.workouts.filter(w=>days.includes(w.date));
    const tDur=wW.reduce((a,w)=>a+(parseInt(w.dur)||0),0);
    const tDist=wW.reduce((a,w)=>a+(parseFloat(w.dist)||0),0);
    const avgOz=Math.round(days.reduce((a,d)=>a+(s.water[d]||0),0)/7);
    return{
      sessions:wW.length,
      tDur,tDist:tDist.toFixed(1),
      avgCal:logD>0?Math.round(aC/logD):0,
      avgPro:logD>0?Math.round(aP/logD):0,
      tBurn,logD,avgOz,
      calAdh:s.macroGoals.cal>0&&logD>0?Math.min(100,Math.round((aC/logD)/s.macroGoals.cal*100)):0,
    };
  };

  const cur=weekStats(wkD);
  const prev=weekStats(prevWkD);
  const g=s.macroGoals;
  const wW=s.workouts.filter(w=>wkD.includes(w.date));

  const delta=(a,b,higherBetter=true)=>{
    if(!b||b===0) return null;
    const d=Math.round((a-b)/b*100);
    const good=(higherBetter&&d>0)||(!higherBetter&&d<0);
    return {d, good, label:d>0?`+${d}%`:`${d}%`};
  };

  const Stat=({label,cur,prev,unit="",higherBetter=true,color})=>{
    const dt=prev>0?delta(cur,prev,higherBetter):null;
    return (
      <div style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:12,padding:"12px 14px",boxShadow:"0 2px 8px rgba(0,0,0,.5)"}}>
        <div style={{fontSize:"0.58rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:color||T.inkLight,marginBottom:4}}>{label}</div>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.4rem",fontWeight:800,color:T.ink,lineHeight:1}}>{cur}{unit}</div>
        {dt&&<div style={{fontSize:"0.68rem",fontWeight:600,color:dt.good?T.green:T.red,marginTop:4}}>{dt.label} vs last week</div>}
      </div>
    );
  };

  // Bar chart + trend line overlay
  const WeekBar=({data,max,color,labels,showTrend=true})=>{
    const H=60,N=data.length;
    // Simple linear regression for trend line
    const valid=data.map((v,i)=>({x:i,y:v})).filter(p=>p.y>0);
    let trendPts=null;
    if(showTrend&&valid.length>=3){
      const n=valid.length;
      const sumX=valid.reduce((a,p)=>a+p.x,0);
      const sumY=valid.reduce((a,p)=>a+p.y,0);
      const sumXY=valid.reduce((a,p)=>a+p.x*p.y,0);
      const sumX2=valid.reduce((a,p)=>a+p.x*p.x,0);
      const slope=(n*sumXY-sumX*sumY)/(n*sumX2-sumX*sumX)||0;
      const intercept=(sumY-slope*sumX)/n;
      // Points at x=0 and x=N-1
      const y0=intercept, y1=slope*(N-1)+intercept;
      const toH=y=>max>0?H-Math.max(2,Math.round(y/max*H)):H;
      trendPts={x1:0,y1:toH(y0),x2:"100%",y2:toH(y1)};
    }
    return (
      <div style={{position:"relative"}}>
        <div style={{display:"flex",alignItems:"flex-end",gap:4,height:H}}>
          {data.map((v,i)=>{
            const h=max>0?Math.max(v>0?8:2,Math.round(v/max*H)):2;
            return (
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                <div style={{width:"100%",height:h,borderRadius:"3px 3px 0 0",background:v>0?color:T.lineSoft,transition:"height .4s"}}/>
                {labels&&<span style={{fontSize:"0.48rem",color:T.inkLight}}>{labels[i]}</span>}
              </div>
            );
          })}
        </div>
        {trendPts&&<svg style={{position:"absolute",top:0,left:0,width:"100%",height:H,pointerEvents:"none"}} preserveAspectRatio="none">
          <line x1={trendPts.x1} y1={trendPts.y1} x2={trendPts.x2} y2={trendPts.y2}
            stroke={color} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.6" strokeLinecap="round"/>
        </svg>}
      </div>
    );
  };

  const dayLabels=wkD.map(d=>["S","M","T","W","T","F","S"][new Date(d+"T12:00").getDay()]);
  const wkCalData=wkD.map(d=>{const{cal}=sumM(s.meals[d]||{});return cal;});
  const wkWData=wkD.map(d=>s.workouts.filter(w=>w.date===d).reduce((a,w)=>a+(parseInt(w.dur)||0),0));
  const wkOzData=wkD.map(d=>s.water[d]||0);
  const ozGoal=s.waterGoal||64;

  const hl=[];
  if(wW.length>=4) hl.push({i:"✦",t:`Strong week — ${wW.length} training sessions.`});
  else hl.push({i:"→",t:`${wW.length} workout${wW.length!==1?"s":""} logged. Aim for 3–5 next week.`});
  if(cur.avgCal>0&&cur.calAdh>=90) hl.push({i:"✓",t:`Calorie adherence ${cur.calAdh}% — on target.`});
  else if(cur.avgCal>0) hl.push({i:"→",t:`Avg ${cur.avgCal} kcal/day (${cur.calAdh}% of ${g.cal} goal).`});
  if(cur.avgPro>0&&g.pro>0&&cur.avgPro/g.pro>=.85) hl.push({i:"✓",t:`Protein on track — avg ${cur.avgPro}g/day.`});
  else if(cur.avgPro>0&&g.pro>0) hl.push({i:"→",t:`Protein avg ${cur.avgPro}g/day vs ${g.pro}g goal.`});
  if(cur.avgOz>0) hl.push({i:cur.avgOz>=ozGoal?"✓":"→",t:`Avg hydration ${cur.avgOz}oz/day (goal ${ozGoal}oz).`});

  const [exporting, setExporting] = useState(false);

  const exportHighlight = () => {
    setExporting(true);
    try {
    const canvas = document.createElement("canvas");
    canvas.width = 800; canvas.height = 420;
    const ctx = canvas.getContext("2d");
    // Background
    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(0,0,800,420);
    // Accent bar
    ctx.fillStyle = "#c8f135";
    ctx.fillRect(0,0,6,420);
    // PULSE logo
    ctx.fillStyle = "#c8f135";
    ctx.font = "bold 28px system-ui";
    ctx.fillText("PULSE", 36, 52);
    // Week label
    ctx.fillStyle = "#606060";
    ctx.font = "14px system-ui";
    ctx.fillText(`${fmtD(wkD[0])} – ${fmtD(wkD[6])}`, 36, 80);
    // Stats
    const stats=[
      {label:"WORKOUTS",value:String(cur.sessions),color:"#ffaa00"},
      {label:"ACTIVE MIN",value:String(cur.tDur)+"m",color:"#c8f135"},
      {label:"MILES",value:String(cur.tDist),color:"#00e5ff"},
      {label:"AVG PROTEIN",value:cur.avgPro+"g",color:"#bf5af2"},
    ];
    stats.forEach((st,i)=>{
      const x=36+i*185, y=150;
      ctx.fillStyle=st.color;
      ctx.font="bold 42px system-ui";
      ctx.fillText(st.value,x,y);
      ctx.fillStyle="#606060";
      ctx.font="bold 11px system-ui";
      ctx.fillText(st.label,x,y+22);
    });
    // Highlights
    ctx.fillStyle="#a0a0a0";
    ctx.font="14px system-ui";
    hl.slice(0,3).forEach((h,i)=>{ctx.fillText(`${h.i} ${h.t}`,36,230+i*28);});
    // Footer
    ctx.fillStyle="#333";
    ctx.fillRect(0,390,800,1);
    ctx.fillStyle="#444";
    ctx.font="12px system-ui";
    ctx.fillText("Made with PULSE · pulse.app",36,412);
    // Download
    const a=document.createElement("a");
    a.download=`pulse-week-${wkD[0]}.png`;
    a.href=canvas.toDataURL("image/png");
    a.click();
    } catch(e) { console.error("Export failed:", e); }
    setExporting(false);
  };

  return (
    <div className="fu">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 20px"}}>
        <div>
          <h1 style={{fontSize:"1.7rem",fontWeight:800,color:T.ink,lineHeight:1.15,letterSpacing:"-0.02em"}}>Weekly Report</h1>
          <p style={{fontSize:"0.84rem",color:T.inkLight,marginTop:4}}>{fmtD(wkD[0])} – {fmtD(wkD[6])}</p>
        </div>
        <Btn sm v="outline" onClick={exportHighlight} style={{opacity:exporting?.5:1}}>
          {exporting?"…":"↗ Share"}
        </Btn>
      </div>

      {/* Stats with week-over-week deltas */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        <Stat label="Workouts" cur={cur.sessions} prev={prev.sessions} color={T.orange}/>
        <Stat label="Active time" cur={cur.tDur+"m"} prev={prev.tDur} unit="" color={T.slate}/>
        <Stat label="Miles" cur={cur.tDist} prev={parseFloat(prev.tDist)} color={T.sky}/>
        <Stat label="Cal burned" cur={cur.tBurn} prev={prev.tBurn} color={T.red}/>
        <Stat label="Avg calories" cur={cur.avgCal} prev={prev.avgCal} color={T.green} higherBetter={false}/>
        <Stat label="Avg protein" cur={cur.avgPro+"g"} prev={prev.avgPro} color={T.purple}/>
        <Stat label="Days logged" cur={`${cur.logD}/7`} prev={prev.logD} color={T.slate}/>
        <Stat label="Avg water" cur={cur.avgOz+"oz"} prev={prev.avgOz} color={T.blue}/>
      </div>

      {/* Activity chart */}
      <Card style={{marginBottom:12}}>
        <Sec>Active minutes per day</Sec>
        <WeekBar data={wkWData} max={Math.max(...wkWData,1)} color={T.orange} labels={dayLabels}/>
      </Card>

      {/* Calorie chart */}
      <Card style={{marginBottom:12}}>
        <Sec>Calories per day</Sec>
        <WeekBar data={wkCalData} max={Math.max(...wkCalData,g.cal,1)} color={T.green} labels={dayLabels}/>
        {g.cal>0&&<div style={{marginTop:6,fontSize:"0.7rem",color:T.inkLight}}>Goal line: {g.cal} kcal</div>}
      </Card>

      {/* Hydration chart */}
      <Card style={{marginBottom:12}}>
        <Sec>Hydration per day (oz)</Sec>
        <WeekBar data={wkOzData} max={Math.max(...wkOzData,ozGoal)} color={T.blue} labels={dayLabels}/>
        <div style={{marginTop:6,fontSize:"0.7rem",color:T.inkLight}}>Goal: {ozGoal}oz/day</div>
      </Card>

      {/* Highlights */}
      <Card style={{marginBottom:12}}>
        <Sec>Highlights</Sec>
        {hl.map((h,i)=>(
          <div key={i} style={{display:"flex",gap:10,padding:"9px 0",borderBottom:`1px solid ${T.lineSoft}`}}>
            <span style={{color:T.slate,fontWeight:600,fontSize:"0.75rem",flexShrink:0,paddingTop:1}}>{h.i}</span>
            <span style={{fontSize:"0.84rem",color:T.inkMid,lineHeight:1.55}}>{h.t}</span>
          </div>
        ))}
      </Card>

      {/* Workouts this week */}
      {wW.length>0&&<Card>
        <Sec>Workouts this week</Sec>
        {[...wW].sort((a,b)=>b.date.localeCompare(a.date)).map(w=>(
          <div key={w.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${T.lineSoft}`}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontWeight:500,fontSize:"0.88rem"}}>{w.type.split(" ")[0]} {w.name}</div>
              <div style={{fontFamily:"ui-monospace,'SF Mono','Fira Code',monospace",fontSize:"0.64rem",color:T.inkLight,marginTop:2}}>
                {fmtD(w.date)}{hasDur(w.dur)?" · "+w.dur+"m":""}{hasDist(w.dist)?" · "+w.dist+"mi":""}
              </div>
            </div>
            {w.cals>0&&<span style={{fontSize:"0.72rem",fontWeight:700,color:T.red,flexShrink:0}}>{w.cals} cal</span>}
          </div>
        ))}
      </Card>}
    </div>
  );
}

// ─── Shared insight engine (used by all tabs + AICoach page) ─
// Returns flat array of insight objects (backward compat)
// Also attaches .signals and .userContext for Claude API use
// ── Structured signals extractor — used by Claude API context ──
function extractSignals(s) {
  const wkD = getWk();
  const TODAY_D = _getToday();
  const g = s.macroGoals;
  const ozToday = s.water[TODAY_D]||0;
  const ozGoal  = s.waterGoal||64;

  // Streak
  const streak = calcStreak(s.workouts, true);

  // This week
  const wkW = s.workouts.filter(w=>wkD.includes(w.date));
  const wkSessions = new Set(wkW.map(w=>w.date)).size;

  // Nutrition last 7 days
  let tC=0,tP=0,logD=0;
  wkD.forEach(d=>{const{cal:c,pro:p}=sumM(s.meals[d]||{});tC+=c;tP+=p;if(c>0)logD++;});
  const avgCal=logD>0?Math.round(tC/logD):0;
  const avgPro=logD>0?Math.round(tP/logD):0;

  // Month volume
  const monthD=getDaysRange(30);
  const last30=s.workouts.filter(w=>monthD.includes(w.date)).length;
  const prev30=s.workouts.filter(w=>getDaysRange(60).slice(0,30).includes(w.date)).length;

  const signals=[];

  if(g.pro>0&&avgPro>0&&avgPro/g.pro<0.8)
    signals.push({type:"protein_deficit",severity:"medium",value:avgPro-g.pro,unit:"g",context:`avg ${avgPro}g vs ${g.pro}g goal`});
  if(ozToday<ozGoal*0.4&&new Date().getHours()>10)
    signals.push({type:"hydration_low",severity:"high",value:ozToday,unit:"oz",context:`${ozToday}oz of ${ozGoal}oz goal`});
  if(streak>0&&wkSessions===0)
    signals.push({type:"streak_risk",severity:"high",daysUntilBreak:1,context:`${streak}-day streak at risk`});
  if(streak>=7)
    signals.push({type:"streak_milestone",severity:"low",value:streak,unit:"days",context:`${streak}-day streak`});
  if(last30>0&&prev30>0&&last30/prev30>=1.5)
    signals.push({type:"volume_increase",severity:"low",value:Math.round((last30/prev30-1)*100),unit:"%",context:`${last30} vs ${prev30} sessions`});

  return {
    signals,
    userContext:{
      currentStreak:streak,
      weeklyWorkouts:wkSessions,
      weeklyTarget:s.profile?.weeklyTarget||4,
      avgCaloriesThisWeek:avgCal,
      avgProteinThisWeek:avgPro,
      recentWorkoutTypes:[...new Set(wkW.map(w=>w.type))].slice(0,3),
      fitnessLevel:s.profile?.fitnessLevel||"intermediate",
      primaryGoal:s.profile?.primaryGoal||"general",
      name:s.profile?.name||"",
    }
  };
}

function buildInsights(s, timePeriod="week") {
  const wkD = getWk();
  const monthD = getDaysRange(30);
  const allD = timePeriod==="week" ? wkD : timePeriod==="month" ? monthD : null;
  const periodW = allD ? s.workouts.filter(w=>allD.includes(w.date)) : s.workouts;
  const allW = [...s.workouts].sort((a,b)=>b.date.localeCompare(a.date));
  const g = s.macroGoals;
  const nutDays = allD||wkD;
  let tC=0,tP=0,logD=0;
  nutDays.forEach(d=>{const{cal:c,pro:p}=sumM(s.meals[d]||{});tC+=c;tP+=p;if(c>0)logD++;});
  const avgCal = logD>0?Math.round(tC/logD):0;
  const avgPro = logD>0?Math.round(tP/logD):0;
  const ozToday = s.water[TODAY]||0;
  const ozGoal = s.waterGoal||64;
  const datesWithW = new Set(allW.map(w=>w.date));
  let streak=0; const sd=new Date();
  if(!datesWithW.has(TODAY)) sd.setDate(sd.getDate()-1);
  while(true){const dk=localDate(sd);if(!datesWithW.has(dk))break;streak++;sd.setDate(sd.getDate()-1);}
  const wkWorkouts = wkD.map(d=>s.workouts.filter(w=>w.date===d).length);
  const wkCals = wkD.map(d=>{ const{cal:c}=sumM(s.meals[d]||{}); return c; });
  const wkOz = wkD.map(d=>s.water[d]||0);
  const prev30D = getDaysRange(60).slice(0,30);
  const last30W = s.workouts.filter(w=>monthD.includes(w.date));
  const prev30W = s.workouts.filter(w=>prev30D.includes(w.date));
  const typeMap={};
  periodW.forEach(w=>{typeMap[w.type]=(typeMap[w.type]||0)+1;});
  const typeTotals=Object.entries(typeMap).sort((a,b)=>b[1]-a[1]);
  const totalSessions=periodW.length;
  const runs=allW.filter(w=>w.type==="🏃 Run"&&parseFloat(w.dist)>0);
  const rides=allW.filter(w=>w.type==="🚴 Ride"&&parseFloat(w.dist)>0);
  const longestRun=runs.length?Math.max(...runs.map(w=>parseFloat(w.dist))):0;
  const longestRide=rides.length?Math.max(...rides.map(w=>parseFloat(w.dist))):0;
  const recentRun=runs[0]?parseFloat(runs[0].dist):0;
  const recentRide=rides[0]?parseFloat(rides[0].dist):0;

  const all=[];
  const restDays=wkD.filter(d=>!datesWithW.has(d)).length;
  const wkSessions=wkD.filter(d=>datesWithW.has(d)).length;
  {
    const all=[];
    const restDays=wkD.filter(d=>!datesWithW.has(d)).length;
    const wkSessions=wkD.filter(d=>datesWithW.has(d)).length;

    // FOCUS items — most actionable right now
    if(avgPro>0&&g.pro>0&&avgPro/g.pro<0.8)
      all.push({cat:"Focus",type:"focus",sentiment:"warn",icon:"💪",
        title:"Boost your protein intake",
        text:`You're averaging ${avgPro}g vs your ${g.pro}g goal (${g.pro>0?Math.round(avgPro/g.pro*100):0}%). Add a protein source to each meal — Greek yogurt, eggs, or a shake can close the gap quickly.`,
        spark:wkD.map(d=>{const{pro:p}=sumM(s.meals[d]||{});return p;}),
        sparkMax:g.pro,sparkColor:T.purple});

    if(ozToday<ozGoal*0.4&&new Date().getHours()>10)
      all.push({cat:"Focus",type:"focus",sentiment:"warn",icon:"💧",
        title:"Hydration behind schedule",
        text:`Only ${ozToday}oz so far today vs your ${ozGoal}oz goal. You're ${Math.round(ozToday/ozGoal*100)}% of the way there. Start sipping now to catch up.`,
        spark:wkOz,sparkMax:ozGoal,sparkColor:T.blue});

    if(wkSessions===0)
      all.push({cat:"Focus",type:"focus",sentiment:"warn",icon:"⚡",
        title:"No workouts logged yet this week",
        text:"Start the week with even a short session — 20 minutes is enough to maintain momentum and keep your streak alive.",
        spark:null});

    if(streak>=3)
      all.push({cat:"Focus",type:"focus",sentiment:"good",icon:streak>=7?"🏆":streak>=5?"🔥":"⚡",
        title:`${streak}-day streak — keep it going`,
        text:streak>=14?`You're on a ${streak}-day streak. That's exceptional consistency — your body is adapting and getting stronger every session.`:
             streak>=7?"A full week of consecutive training. You're building real momentum.":
             "Three days in a row. You're in a groove — don't break the chain.",
        spark:null});

    if(recentRun>0&&recentRun>=longestRun&&runs.length>1)
      all.push({cat:"Focus",type:"focus",sentiment:"good",icon:"🏅",
        title:`New running PR — ${recentRun} mi`,
        text:`Your most recent run was your longest ever. That's real progression. Give yourself a proper recovery day before the next hard effort.`,spark:null});

    if(recentRide>0&&recentRide>=longestRide&&rides.length>1)
      all.push({cat:"Focus",type:"focus",sentiment:"good",icon:"🏅",
        title:`New ride PR — ${recentRide} mi`,
        text:`Personal record on your latest ride at ${recentRide} miles. Consistent training is paying off.`,spark:null});

    // WORKOUTS
    all.push({cat:"Workouts",type:"workouts",
      sentiment:wkSessions>=4?"good":wkSessions>=2?"neutral":"warn",
      icon:"⚡",
      title:`${wkSessions} session${wkSessions!==1?"s":""} this week`,
      text:wkSessions>=5?`Strong week — ${wkSessions} sessions with ${restDays} rest day${restDays!==1?"s":""}. Make sure you're sleeping well to match the output.`:
           wkSessions>=3?`Good week at ${wkSessions} sessions. ${restDays} rest day${restDays!==1?"s":""} is solid recovery balance.`:
           wkSessions>=1?`You're at ${wkSessions} session${wkSessions!==1?"s":""} with ${7-wkSessions} days left this week. Aim for at least 3 total.`:
           "No sessions logged yet this week. Any movement counts — even a walk.",
      spark:wkWorkouts,sparkMax:Math.max(...wkWorkouts,1),sparkColor:T.orange});

    if(last30W.length>0&&prev30W.length>0){
      const pct=Math.round((last30W.length-prev30W.length)/prev30W.length*100);
      all.push({cat:"Workouts",type:"workouts",
        sentiment:pct>5?"good":pct<-10?"warn":"neutral",icon:"📈",
        title:`Volume ${pct>0?"+":""}${pct}% vs last month`,
        text:`${last30W.length} sessions this month vs ${prev30W.length} last month. ${pct>15?"Significant ramp-up — watch for overtraining signs.":pct>0?"Positive trend.":pct>-10?"Roughly consistent.":"Volume dipped — life happens, just get back on track."}`,
        spark:null});
    }

    if(typeTotals.length>0){
      const dominant=typeTotals[0];
      const pct=Math.round(dominant[1]/totalSessions*100);
      all.push({cat:"Workouts",type:"workouts",sentiment:"neutral",icon:"🔄",
        title:`Workout mix: ${dominant[0]} leads at ${pct}%`,
        text:typeTotals.length===1?`All sessions this period are ${dominant[0]}. Cross-training builds resilience — consider adding a complementary activity.`:
             `Your primary activity is ${dominant[0]} (${pct}%). ${typeTotals.slice(1).map(([t,c])=>`${t}: ${Math.round(c/totalSessions*100)}%`).join(", ")}.`,
        spark:null});
    }

    // NUTRITION
    if(logD>0){
      all.push({cat:"Nutrition",type:"nutrition",
        sentiment:avgCal>0&&g.cal>0?Math.abs(avgCal-g.cal)/g.cal<0.1?"good":avgCal>g.cal?"warn":"warn":"neutral",
        icon:"🍽",
        title:avgCal>0?`Avg ${avgCal} kcal/day`:"Calories not logged",
        text:avgCal>0&&g.cal>0?
          Math.abs(avgCal-g.cal)<g.cal*0.1?`Within 10% of your ${g.cal} goal — solid consistency.`:
          avgCal>g.cal?`${avgCal-g.cal} kcal over your ${g.cal} goal on average. Review portion sizes or reduce calorie-dense snacks.`:
          `${g.cal-avgCal} kcal under your goal. Undereating impacts recovery and energy. Fuel your training.`
          :"Log meals in the Eat tab to get nutrition insights.",
        spark:wkCals,sparkMax:Math.max(g.cal,1),sparkColor:T.green});

      all.push({cat:"Nutrition",type:"nutrition",
        sentiment:avgPro>0&&g.pro>0?avgPro/g.pro>=0.9?"good":"warn":"neutral",
        icon:"💪",
        title:avgPro>0?`Avg protein: ${avgPro}g/day`:"Protein not logged",
        text:avgPro>0&&g.pro>0?
          avgPro/g.pro>=1?`Hitting your ${g.pro}g protein goal. This is the key macro for recovery — keep it consistent.`:
          avgPro/g.pro>=0.8?`At ${g.pro>0?Math.round(avgPro/g.pro*100):0}% of your ${g.pro}g goal. Small adjustments — add a protein source to your weakest meal.`:
          `Only ${g.pro>0?Math.round(avgPro/g.pro*100):0}% of your ${g.pro}g target. Prioritise protein at every meal.`
          :"Log meals to track protein.",
        spark:wkD.map(d=>{const{pro:p}=sumM(s.meals[d]||{});return p;}),
        sparkMax:g.pro,sparkColor:T.purple});
    } else {
      all.push({cat:"Nutrition",type:"nutrition",sentiment:"warn",icon:"🍽",
        title:"No meals logged this period",
        text:"Head to the Eat tab to start tracking. Even rough logging gives you useful data over time.",spark:null});
    }

    // RECOVERY
    all.push({cat:"Hydration",type:"recovery",
      sentiment:ozToday>=ozGoal?"good":ozToday>=ozGoal*0.6?"neutral":"warn",
      icon:"💧",
      title:`Today: ${ozToday}oz of ${ozGoal}oz`,
      text:ozToday>=ozGoal?`Hydration goal hit. Stay consistent — especially on training days.`:
           ozToday>=ozGoal*0.6?`${Math.round(ozToday/ozGoal*100)}% of your daily goal. Keep sipping to finish strong.`:
           `Behind on hydration. Dehydration by even 2% impairs performance and recovery.`,
      spark:wkOz,sparkMax:ozGoal,sparkColor:T.blue});

    const avgHRs=wkD.map(d=>{ const ws=s.workouts.filter(w=>w.date===d&&hasHR(w.hr)); return ws.length?Math.round(ws.reduce((a,w)=>a+parseInt(w.hr),0)/ws.length):0; }).filter(v=>v>0);
    if(avgHRs.length>0){
      const avgHR=Math.round(avgHRs.reduce((a,b)=>a+b,0)/avgHRs.length);
      all.push({cat:"Recovery",type:"recovery",sentiment:"neutral",icon:"❤️",
        title:`Avg HR this week: ${avgHR} bpm`,
        text:avgHR>165?"High intensity week — ensure at least one full rest day and prioritise sleep.":
             avgHR>140?"Good mix of moderate to high effort. Balance with an easy session or rest day.":
             "Lower intensity week. Consider adding one higher-effort session if energy allows.",
        spark:avgHRs,sparkMax:200,sparkColor:T.red});
    }

    const restD=wkD.filter(d=>!datesWithW.has(d)).length;
    all.push({cat:"Recovery",type:"recovery",
      sentiment:restD===0?"warn":restD>=5?"warn":"good",icon:"😴",
      title:`${restD} rest day${restD!==1?"s":""} this week`,
      text:restD===0?"No rest days this week — rest is when adaptation happens. Schedule one before the week ends.":
           restD>=5?"Mostly rest this week — some light movement can actually aid recovery.":
           `Good balance. ${7-restD} training days, ${restD} rest days.`,spark:null});

    // ── PERSONALISED BASELINES ──────────────────────────────
    if (allW.length >= 4) {
      const wkCount = wkSessions;
      const allWeekCounts = [];
      for (let i=0; i<52; i++) {
        const wStart = getDaysRange(7+i*7).slice(0,7);
        const cnt = s.workouts.filter(w=>wStart.includes(w.date)).length;
        if (cnt>0) allWeekCounts.push(cnt);
      }
      if (allWeekCounts.length >= 3) {
        allWeekCounts.sort((a,b)=>b-a);
        const rank = allWeekCounts.indexOf(wkCount)+1;
        if (rank<=3 && wkCount>=3) {
          all.push({cat:"Milestones",type:"workouts",sentiment:"good",icon:"🏅",
            title:`Top ${rank===1?"week":""+rank+" of your best weeks"} — ${wkCount} sessions`,
            text:`This is one of your most active weeks. You're in the top tier of your own history.`,spark:null});
        }
      }
    }

    // ── ANOMALY DETECTION ───────────────────────────────────
    // Flag runs significantly longer than usual
    if (runs.length >= 5) {
      const avgDist = runs.slice(0,20).reduce((a,w)=>a+parseFloat(w.dist),0)/Math.min(runs.length,20);
      const latestDist = parseFloat(runs[0]?.dist||0);
      if (latestDist > avgDist*1.4) {
        all.push({cat:"Focus",type:"focus",sentiment:"good",icon:"📏",
          title:`Longest run in a while — ${latestDist.toFixed(1)} mi`,
          text:`Your last run was ${Math.round((latestDist/avgDist-1)*100)}% longer than your recent average (${avgDist.toFixed(1)} mi). Great progression — make sure to recover well.`,spark:null});
      }
    }

    // ── HISTORICAL COMPARISON (month over month) ─────────────
    if (last30W.length>0 && prev30W.length>0) {
      const ratio = last30W.length/prev30W.length;
      if (ratio>=2) {
        all.push({cat:"Milestones",type:"workouts",sentiment:"good",icon:"📈",
          title:`Twice as consistent as last month`,
          text:`${last30W.length} sessions this month vs ${prev30W.length} last month. Your training volume has doubled.`,spark:null});
      }
    }

    // ── MONTH/YEAR COMPARISON ────────────────────────────────
    const curMonth = new Date().getMonth();
    const curYear = new Date().getFullYear();
    const thisMonthW = s.workouts.filter(w=>{
      const d=new Date(w.date+"T12:00");
      return d.getMonth()===curMonth&&d.getFullYear()===curYear;
    }).length;
    const lastYearSameMonthW = s.workouts.filter(w=>{
      const d=new Date(w.date+"T12:00");
      return d.getMonth()===curMonth&&d.getFullYear()===curYear-1;
    }).length;
    if (thisMonthW>0&&lastYearSameMonthW>0) {
      const monthNames=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const diff=thisMonthW-lastYearSameMonthW;
      if (diff>0) {
        all.push({cat:"Milestones",type:"workouts",sentiment:"good",icon:"📅",
          title:`Most active ${monthNames[curMonth]} yet`,
          text:`${thisMonthW} sessions this ${monthNames[curMonth]} vs ${lastYearSameMonthW} last year. Year-over-year improvement.`,spark:null});
      }
    }

    // ── Structured signals for Claude API (Step 4 architecture) ──
    const signals = [];
    all.forEach(ins => {
      if (ins.sentiment === "warn" || ins.type === "focus") {
        signals.push({
          type: ins.title.toLowerCase().replace(/[^a-z0-9]+/g,"_").slice(0,40),
          severity: ins.sentiment === "warn" ? "high" : "medium",
          category: ins.cat,
          summary: ins.text.slice(0,120),
        });
      }
    });

    const userContext = {
      currentStreak: (() => {
        const dW = new Set(allW.map(w=>w.date));
        let st=0; const d2=new Date();
        if(!dW.has(TODAY)) d2.setDate(d2.getDate()-1);
        while(st<365){const dk=localDate(d2);if(!dW.has(dk))break;st++;d2.setDate(d2.getDate()-1);}
        return st;
      })(),
      weeklyWorkouts: (allD||wkD).filter(d=>s.workouts.some(w=>w.date===d)).length,
      avgCaloriesThisWeek: avgCal,
      avgProteinThisWeek: avgPro,
      proteinGoal: s.macroGoals?.pro || 0,
      calorieGoal: s.macroGoals?.cal || 0,
      recentWorkoutTypes: allW.slice(0,5).map(w=>w.type),
      fitnessLevel: s.profile?.fitnessLevel || "intermediate",
      primaryGoal: s.profile?.primaryGoal || "general",
    };

    // Attach to array for Claude API consumers
    all.signals = signals;
    all.userContext = userContext;

    return all;
  }
} // end buildInsights

function AICoach({s, insights}) {
  const [insightTab, setInsightTab] = useState("focus");
  const [timePeriod, setTimePeriod] = useState("week");

  const wkD = getWk();
  const monthD = getDaysRange(30);
  const allD = timePeriod==="week" ? wkD : timePeriod==="month" ? monthD : null;
  const periodW = allD ? s.workouts.filter(w=>allD.includes(w.date)) : s.workouts;
  const allW = [...s.workouts].sort((a,b)=>b.date.localeCompare(a.date));
  const g = s.macroGoals;
  let tC=0,tP=0,logD=0;
  (allD||wkD).forEach(d=>{const{cal:c,pro:p}=sumM(s.meals[d]||{});tC+=c;tP+=p;if(c>0)logD++;});
  const avgCal = logD>0?Math.round(tC/logD):0;
  const avgPro = logD>0?Math.round(tP/logD):0;
  const ozToday = s.water[TODAY]||0;
  const ozGoal = s.waterGoal||64;
  const datesWithW = new Set(allW.map(w=>w.date));
  let streak=0; const sd2=new Date();
  if(!datesWithW.has(TODAY)) sd2.setDate(sd2.getDate()-1);
  while(true){const dk=localDate(sd2);if(!datesWithW.has(dk))break;streak++;sd2.setDate(sd2.getDate()-1);}
  const cal30 = getDaysRange(35).map(d=>({d,hasW:datesWithW.has(d),isToday:d===TODAY,isFuture:d>TODAY}));
  const typeMap2={};
  periodW.forEach(w=>{typeMap2[w.type]=(typeMap2[w.type]||0)+1;});
  const typeTotals=Object.entries(typeMap2).sort((a,b)=>b[1]-a[1]);
  const totalSessions=periodW.length;
  const summaryStats = [
    {l:"Sessions",v:periodW.length,color:T.orange,sub:timePeriod==="week"?"this week":timePeriod==="month"?"this month":"all time"},
    {l:"Avg cal",v:avgCal>0?avgCal:"—",color:T.green,sub:`goal ${g.cal}`},
    {l:"Avg protein",v:avgPro>0?avgPro+"g":"—",color:T.purple,sub:`goal ${g.pro}g`},
    {l:"Water today",v:ozToday+"oz",color:T.blue,sub:`of ${ozGoal}oz`},
  ];

  const allInsights = useMemo(()=>buildInsights(s, timePeriod), [s.workouts, s.meals, s.water, s.macroGoals, timePeriod]);
  const focused = allInsights.filter(i=>i.type==="focus");
  const filtered = insightTab==="focus"?focused:insightTab==="all"?allInsights:allInsights.filter(i=>i.type===insightTab);

  // ── Real Claude coaching ──
  const [coachText, setCoachText] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachLoaded, setCoachLoaded] = useState(false);

  const getCoaching = async () => {
    if (coachLoading) return;
    setCoachLoading(true);
    setCoachText("");
    const ctx = allInsights.userContext || {};
    const sigs = (allInsights.signals || []).slice(0,6).map(s=>s.summary).join("\n");
    const systemPrompt = `You are PULSE, a personal fitness coach. Give a concise, actionable coaching summary based on the user's data. Reference specific numbers. Be warm but direct. 3-4 sentences max.`;
    const userMsg = `My fitness data this ${timePeriod}:
- Streak: ${ctx.currentStreak} days
- Sessions: ${ctx.weeklyWorkouts}
- Avg calories: ${ctx.avgCaloriesThisWeek} kcal (goal ${ctx.calorieGoal})
- Avg protein: ${ctx.avgProteinThisWeek}g (goal ${ctx.proteinGoal}g)
- Activities: ${(ctx.recentWorkoutTypes||[]).slice(0,3).join(", ")}
Key observations: ${sigs||"No major flags."}
Give me a coaching summary.`;

    let text = "";
    for await (const chunk of streamClaude(systemPrompt, userMsg, 300)) {
      text += chunk;
      setCoachText(text);
    }
    setCoachLoading(false);
    setCoachLoaded(true);
  };

  const sentimentStyle = s => ({
    good:  {bg:T.greenL,  border:`${T.green}33`},
    warn:  {bg:T.orangeL, border:`${T.orange}33`},
    neutral:{bg:T.paper,  border:T.line},
  }[s]||{bg:T.paper,border:T.line});

  // ── Mini sparkline ─────────────────────────────────────────
  const Spark = ({data,max,color,labels}) => {
    if(!data||!data.length) return null;
    const h=32,w=100/data.length;
    return (
      <div style={{display:"flex",alignItems:"flex-end",gap:2,height:h,marginTop:8}}>
        {data.map((v,i)=>{
          const pct=max>0?Math.min(1,v/max):0;
          const barH=Math.max(pct>0?3:1,Math.round(pct*h));
          return (
            <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <div style={{width:"100%",height:barH,borderRadius:"2px 2px 0 0",background:pct>0?color:"#e5e5ea",opacity:pct>0?1:0.4,transition:"height .3s"}}/>
              {labels&&<span style={{fontSize:"0.45rem",color:T.inkLight}}>{labels[i]}</span>}
            </div>
          );
        })}
      </div>
    );
  };

  const dayLabels=["S","M","T","W","T","F","S"];

  // ── Conversational coach state ──
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput("");
    const userMsg = {role:"user", text:msg};
    setChatMsgs(prev=>[...prev, userMsg]);
    setChatLoading(true);

    const aiMsg = {role:"ai", text:""};
    setChatMsgs(prev=>[...prev, aiMsg]);

    const signals = allInsights.signals || [];
    const ctx = allInsights.userContext || {};
    const systemPrompt = `You are PULSE, a personal fitness coach AI. You have access to the user's real fitness data.

User context:
- Current workout streak: ${ctx.currentStreak} days
- Sessions this week: ${ctx.weeklyWorkouts}
- Avg calories this week: ${ctx.avgCaloriesThisWeek} kcal (goal: ${ctx.calorieGoal})
- Avg protein this week: ${ctx.avgProteinThisWeek}g (goal: ${ctx.proteinGoal}g)
- Recent activities: ${(ctx.recentWorkoutTypes||[]).slice(0,3).join(", ")}
- Fitness level: ${ctx.fitnessLevel}, Primary goal: ${ctx.primaryGoal}

Active signals: ${signals.map(s=>s.summary).join(" | ")}

Be concise, specific, and reference their actual numbers. Max 3 short paragraphs.`;

    let fullText = "";
    for await (const chunk of streamClaude(systemPrompt, msg)) {
      fullText += chunk;
      setChatMsgs(prev=>[...prev.slice(0,-1), {...aiMsg, text:fullText}]);
    }
    setChatLoading(false);
    setTimeout(()=>chatEndRef.current?.scrollIntoView({behavior:"smooth"}), 50);
  };

  const [coachView, setCoachView] = useState("insights"); // insights | chat

  return (
    <div className="fu">
      {/* Coach hero */}
      <div style={{background:"var(--hero-grad)",borderRadius:18,padding:"20px",marginBottom:14,boxShadow:"0 8px 32px rgba(0,0,0,.6)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(200,241,53,.5)",marginBottom:6}}>AI Coach</div>
            <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,color:"rgba(245,245,245,.95)",letterSpacing:"0.01em",lineHeight:1}}>Your insights</h1>
            <p style={{fontSize:"0.76rem",color:"rgba(200,241,53,.5)",marginTop:6}}>Generated from your real data</p>
          </div>
          {/* Time period toggle — inside hero */}
          <div style={{display:"flex",background:"rgba(255,255,255,.1)",borderRadius:10,padding:3}}>
            {[{k:"week",l:"Wk"},{k:"month",l:"Mo"},{k:"all",l:"All"}].map(t=>(
              <button key={t.k} onClick={()=>setTimePeriod(t.k)}
                style={{padding:"5px 10px",borderRadius:8,border:"none",background:timePeriod===t.k?"rgba(200,241,53,.25)":"transparent",color:timePeriod===t.k?"#c8f135":"rgba(200,241,53,.5)",fontSize:"0.72rem",fontWeight:timePeriod===t.k?700:500,cursor:"pointer"}}>
                {t.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Inline recovery tip — the domain not covered by Train/Eat tabs ── */}
      <InlineTip s={s} type="recovery" insights={insights}/>

      {/* Deploy banner for API key setup */}
      <DeployBanner onKeySet={()=>{}}/>

      {/* Insights / Chat toggle */}
      <div style={{display:"flex",borderBottom:`1px solid ${T.line}`,marginBottom:14}}>
        {[{k:"insights",l:"Insights"},{k:"chat",l:"💬 Chat with Coach"}].map(t=>(
          <button key={t.k} onClick={()=>setCoachView(t.k)}
            style={{flex:1,background:"none",border:"none",fontFamily:"'DM Sans',sans-serif",
              fontWeight:500,fontSize:"0.82rem",
              color:coachView===t.k?T.ink:T.inkMid,padding:"10px 4px",cursor:"pointer",
              borderBottom:`2px solid ${coachView===t.k?"#c8f135":"transparent"}`,marginBottom:-1}}>
            {t.l}
          </button>
        ))}
      </div>

      {coachView==="chat"&&<div className="fu">
        {/* ── Chat messages ── */}
        <div style={{minHeight:120,maxHeight:400,overflowY:"auto",marginBottom:12,
          display:"flex",flexDirection:"column",gap:10,padding:"4px 0"}}>
          {chatMsgs.length===0&&<div style={{fontSize:"0.82rem",color:T.inkMid,fontStyle:"normal",fontWeight:500,
            padding:"16px 0",textAlign:"center"}}>
            Ask anything about your training, nutrition, or recovery…
          </div>}
          {chatMsgs.map((m,i)=>(
            <div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"85%"}}>
              <div style={{padding:"10px 14px",
                borderRadius:m.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",
                background:m.role==="user"?"#1e2a00":T.paperAlt,
                border:m.role==="user"?"1px solid #c8f13530":`1px solid ${T.line}`,
                fontSize:"0.84rem",color:T.ink,lineHeight:1.6,whiteSpace:"pre-wrap"}}>
                {m.text||<span style={{opacity:.4}}>…</span>}
              </div>
            </div>
          ))}
          <div ref={chatEndRef}/>
        </div>
        {/* Input */}
        <div style={{display:"flex",gap:8}}>
          <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat();}}}
            placeholder="Why was my energy low this week?"
            disabled={chatLoading}
            style={{flex:1,padding:"11px 14px",borderRadius:12,border:`1.5px solid ${T.line}`,
              background:T.paper,color:T.ink,fontSize:"16px",outline:"none",transition:"border-color .15s"}}
            onFocus={e=>e.target.style.borderColor="#c8f135"}
            onBlur={e=>e.target.style.borderColor=T.line}/>
          <Btn onClick={sendChat}
            style={{minWidth:52,opacity:chatLoading||!chatInput.trim()?0.4:1,transition:"opacity .15s"}}
            disabled={chatLoading||!chatInput.trim()}>
            {chatLoading?"…":"→"}
          </Btn>
        </div>
        {!AI_AVAILABLE&&<div style={{marginTop:10,background:T.orangeL,border:`1px solid ${T.orange}33`,
          borderRadius:10,padding:"10px 14px",fontSize:"0.76rem",color:T.inkMid,lineHeight:1.5}}>
          🚀 Set <code>VITE_CLAUDE_API_KEY</code> in Vercel to activate AI chat.
        </div>}
      </div>}

      {coachView==="insights"&&<>
        {/* ── AI Coaching summary card ── */}
        <div style={{background:T.paper,border:`1px solid ${coachLoaded?"#c8f13530":T.line}`,
          borderRadius:14,padding:"14px 16px",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            marginBottom:coachText?12:0}}>
            <div style={{fontWeight:700,fontSize:"0.9rem",color:T.ink}}>✦ AI Coaching</div>
            <Btn sm
              onClick={getCoaching}
              disabled={coachLoading||!AI_AVAILABLE}
              v={coachLoaded?"outline":"primary"}
              title={!AI_AVAILABLE?"Set VITE_CLAUDE_API_KEY to activate":undefined}>
              {coachLoading?"…":coachLoaded?"Refresh":AI_AVAILABLE?"Get coaching":"Locked 🔒"}
            </Btn>
          </div>
          {!AI_AVAILABLE&&!coachLoaded&&<div style={{fontSize:"0.76rem",color:T.inkMid,marginTop:8,lineHeight:1.5}}>
            Real AI coaching available after deployment. Rules-based insights below are active now.
          </div>}
          {coachText&&<div style={{fontSize:"0.88rem",color:T.ink,lineHeight:1.7,whiteSpace:"pre-wrap"}}>
            {coachText}
            {coachLoading&&<span style={{opacity:.4}}>▊</span>}
          </div>}
        </div>


      {/* Summary stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        {summaryStats.map((st,i)=>(
          <div key={i} className="pressable" style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:14,padding:"14px",boxShadow:"0 2px 8px rgba(0,0,0,.4)"}}>
            <div style={{fontSize:"0.56rem",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:st.color,marginBottom:6}}>{st.l}</div>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.7rem",fontWeight:800,color:T.ink,lineHeight:1}}>{st.v}</div>
            <div style={{fontSize:"0.62rem",color:T.inkLight,marginTop:4}}>{st.sub}</div>
          </div>
        ))}
      </div>

      {/* 35-day streak calendar */}
      <div style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:14,padding:"14px 16px",marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.inkLight}}>Activity — last 35 days</div>
          <div style={{fontSize:"0.72rem",fontWeight:700,color:T.orange}}>{streak} day streak</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
          {["S","M","T","W","T","F","S"].map((l,i)=>(
            <div key={i} style={{textAlign:"center",fontSize:"0.5rem",color:T.inkLight,fontWeight:600,paddingBottom:2}}>{l}</div>
          ))}
          {cal30.map((day,i)=>(
            <div key={i} style={{
              aspectRatio:"1",borderRadius:5,
              background:day.isFuture?T.paperAlt:day.hasW?T.orange:T.lineSoft,
              border:day.isToday?`2px solid ${T.orange}`:"2px solid transparent",
              opacity:day.isFuture?0.2:1,
              transition:"background .2s"
            }}/>
          ))}
        </div>
      </div>

      {/* Activity type breakdown */}
      {typeTotals.length>0&&<div style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:14,padding:"14px 16px",marginBottom:14}}>
        <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.inkLight,marginBottom:10}}>Workout mix</div>
        {typeTotals.slice(0,5).map(([type,count],i)=>{
          const pct=Math.round(count/totalSessions*100);
          const colors=[T.orange,T.blue,T.green,T.purple,T.red];
          return (
            <div key={i} style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{fontSize:"0.82rem",color:T.ink}}>{type}</span>
                <span style={{fontSize:"0.72rem",color:T.inkLight,fontWeight:600}}>{count} · {pct}%</span>
              </div>
              <div style={{height:5,background:T.lineSoft,borderRadius:99,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${pct}%`,background:colors[i],borderRadius:99,transition:"width .5s"}}/>
              </div>
            </div>
          );
        })}
      </div>}

      {/* Insight tabs */}
      <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto",WebkitOverflowScrolling:"touch",paddingBottom:2}}>
        {[{k:"focus",l:"⚡ Focus"},{k:"workouts",l:"💪 Workouts"},{k:"nutrition",l:"🍽 Nutrition"},{k:"recovery",l:"😴 Recovery"},{k:"all",l:"All"}].map(t=>(
          <button key={t.k} onClick={()=>setInsightTab(t.k)}
            style={{flexShrink:0,padding:"7px 14px",borderRadius:20,border:`1px solid ${insightTab===t.k?T.slate:T.line}`,background:insightTab===t.k?T.slate:"transparent",color:insightTab===t.k?"#fff":T.inkMid,fontSize:"0.74rem",fontWeight:insightTab===t.k?700:500,cursor:"pointer",whiteSpace:"nowrap",transition:"all .15s"}}>
            {t.l}
          </button>
        ))}
      </div>

      {/* Insight cards */}
      {filtered.length>0 ? filtered.map((ins,i)=>{
        const {bg,border} = sentimentStyle(ins.sentiment);
        return (
          <div key={i} style={{background:bg,border:`1px solid ${border}`,borderRadius:14,padding:"14px 16px",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
              <div style={{fontSize:"1.3rem",lineHeight:1,flexShrink:0,marginTop:2}}>{ins.icon}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                  <Pill color={ins.sentiment==="good"?"sage":ins.sentiment==="warn"?"stone":"slate"}>{ins.cat}</Pill>
                </div>
                <div style={{fontWeight:700,fontSize:"0.9rem",color:T.ink,marginBottom:5}}>{ins.title}</div>
                <div style={{fontSize:"0.82rem",color:T.inkMid,lineHeight:1.6}}>{ins.text}</div>
                {ins.spark&&<Spark data={ins.spark} max={ins.sparkMax} color={ins.sparkColor} labels={wkD.map(d=>dayLabels[new Date(d+"T12:00").getDay()])}/>}
              </div>
            </div>
          </div>
        );
      }) : <Empty icon="✦" text="No insights for this category yet. Log workouts and meals to get started."/>}

      <div style={{marginTop:8,padding:"12px 16px",background:T.paperAlt,borderRadius:12,border:`1px solid ${T.line}`}}>
        <div style={{fontSize:"0.74rem",color:T.inkLight,lineHeight:1.6}}>✦ <strong style={{color:T.ink}}>Smart insights</strong> — generated from your real data. Full conversational AI coaching available when hosted outside Claude.ai.</div>
      </div>
      </>}
    </div>
  );
}

// ─── Bottom tab bar ────────────────────────────────────────
// SVG tab icons — clean athletic line icons
const TAB_ICONS = {
  dashboard: (active,c) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={active?2.2:1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/>
    </svg>),
  workouts: (active,c) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={active?2.2:1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>),
  nutrition: (active,c) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={active?2.2:1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
    </svg>),

  more: (active,c) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={active?2.2:1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
    </svg>),
};

// Tab structure: Home | Train | Eat | More
// Goals → accessible from Home banner + More menu
// Water → merged into Eat tab as sub-tab
// Coach tips → embedded inline in Train and Eat tabs
const TABS = [
  { id:"dashboard", label:"Home" },
  { id:"workouts",  label:"Train" },
  { id:"nutrition", label:"Eat" },
  { id:"more",      label:"More" },
];

const MORE_PAGES = [
  { id:"ai",          label:"AI Coach",          icon:"✦"  },
  { id:"goals",       label:"Goals",             icon:"🎯" },
  { id:"challenges",  label:"Challenges",        icon:"🏆" },
  { id:"bodyweight",  label:"Body Weight",       icon:"⚖️" },
  { id:"heatmap",     label:"Activity Map",      icon:"📅" },
  { id:"search",      label:"Search",            icon:"🔍" },
  { id:"weekly",      label:"Weekly Report",     icon:"📊" },
  { id:"recipes",     label:"Recipe Vault",      icon:"📖" },
  { id:"injury",      label:"Health Flags",      icon:"🩹" },
  { id:"dayjournal",  label:"Day Notes",         icon:"📝" },
  { id:"weeklyplan",  label:"Weekly Plan",       icon:"📋" },
  { id:"highlight",   label:"Highlight Card",    icon:"✨" },
  { id:"connect",     label:"Import & Backup",   icon:"🍎" },
  { id:"profile",     label:"Profile & Settings",icon:"👤" },
];

const _TYPE_MAP = {
  HKWorkoutActivityTypeRunning:                      "🏃 Run",
  HKWorkoutActivityTypeCycling:                      "🚴 Ride",
  HKWorkoutActivityTypeWalking:                      "🚶 Walk",
  HKWorkoutActivityTypeFunctionalStrengthTraining:   "🏋️ Strength",
  HKWorkoutActivityTypeTraditionalStrengthTraining:  "🏋️ Strength",
  HKWorkoutActivityTypeSwimming:                     "🏊 Swim",
  HKWorkoutActivityTypeSwimmingPool:                 "🏊 Swim",
  HKWorkoutActivityTypeHighIntensityIntervalTraining:"🥊 HIIT",
  HKWorkoutActivityTypeMixedCardio:                  "🥊 HIIT",
  HKWorkoutActivityTypeHiking:                       "🥾 Hike",
  HKWorkoutActivityTypeYoga:                         "🧘 Yoga",
  HKWorkoutActivityTypePilates:                      "🧘 Yoga",
  HKWorkoutActivityTypeDance:                        "🧘 Yoga",
  HKWorkoutActivityTypeElliptical:                   "🥊 HIIT",
  HKWorkoutActivityTypeStairClimbing:                "🥊 HIIT",
  HKWorkoutActivityTypeCrossTraining:                "🏋️ Strength",
  HKWorkoutActivityTypeSnowboarding:                 "🏂 Snow",
  HKWorkoutActivityTypeGolf:                         "⛳ Golf",
  HKWorkoutActivityTypeSwimBikeRun:                  "🏊 Triathlon",
  HKWorkoutActivityTypeOther:                        "✦ Other",
};
const _mapType = t => _TYPE_MAP[t] || "✦ Other";
const _shortSrc = s => {
  if (!s) return "Apple Health";
  const l = s.toLowerCase();
  if (l.includes("apple watch") || l.includes("watch")) return "Apple Watch";
  if (l.includes("nike run"))   return "Nike Run Club";
  if (l.includes("nike train")) return "Nike Training";
  if (l.includes("bikemap"))    return "Bikemap";
  if (l.includes("gymkit"))     return "GymKit";
  return s.split(" ").slice(0,2).join(" ");
};
function _parseBlock(block) {
  const attr = name => { const m = block.match(new RegExp(`${name}="([^"]*)"`)); return m ? m[1] : ""; };
  const rawType  = attr("workoutActivityType");
  const startStr = attr("startDate");
  const durRaw   = parseFloat(attr("duration") || "0");
  const durUnit  = attr("durationUnit") || "min";
  const durMin   = durUnit === "min" ? Math.round(durRaw) : Math.round(durRaw / 60);
  const date     = startStr ? startStr.split(" ")[0] : null;
  if (!date) return null;
  const source = attr("sourceName");

  // Parse WorkoutStatistics — handles both sum-based and average-based stats
  // Apple Health XML uses:
  //   sum=  for energy, distance
  //   average= for heart rate (HKQuantityTypeIdentifierHeartRate)
  const wsRe = /<WorkoutStatistics[^>]*\/>/g;
  let m, cals=0, distMi=0, hrAvg="";
  while ((m = wsRe.exec(block)) !== null) {
    const el = m[0];
    const getAttr = a => { const r = el.match(new RegExp(`${a}="([^"]*)"`) ); return r?r[1]:""; };
    const sType = getAttr("type");
    const sum   = parseFloat(getAttr("sum")||"0");
    const avg   = parseFloat(getAttr("average")||"0");
    const unit  = getAttr("unit").toLowerCase();

    if (sType === "HKQuantityTypeIdentifierActiveEnergyBurned") {
      cals = Math.round(sum);
    }
    if (["HKQuantityTypeIdentifierDistanceWalkingRunning",
         "HKQuantityTypeIdentifierDistanceCycling",
         "HKQuantityTypeIdentifierDistanceSwimming"].includes(sType)) {
      distMi = unit==="km" ? Math.round(sum*0.621371*100)/100 : Math.round(sum*100)/100;
    }
    if (sType === "HKQuantityTypeIdentifierHeartRate" && avg > 0) {
      hrAvg = String(Math.round(avg));
    }
  }

  // Auto-calculate pace from distance + duration for runs/walks/hikes
  let pace = "";
  if (distMi > 0 && durMin > 0) {
    const minsPerMile = durMin / distMi;
    const paceMin = Math.floor(minsPerMile);
    const paceSec = Math.round((minsPerMile - paceMin) * 60);
    pace = `${paceMin}:${String(paceSec).padStart(2,"0")}/mi`;
  }

  const emoji    = _mapType(rawType);
  const typeName = emoji.split(" ").slice(1).join(" ") || "Workout";
  const dateLabel = new Date(date+"T12:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"});
  return {
    id:`${date}_${rawType}_${Math.round(durRaw*10)}`,
    name:`${typeName} · ${dateLabel} · ${_shortSrc(source)}`,
    type:emoji, dur:durMin>0?String(durMin):"", dist:distMi>0?String(distMi):"",
    cals, hr:hrAvg, pace, notes:`Imported from ${source||"Apple Health"}`,
    date, source:"apple", _rawType:rawType, _srcRaw:source,
  };
}
function _extractChunk(text) {
  const workouts=[]; let from=0;
  while (true) {
    const s=text.indexOf("<Workout ",from); if(s===-1)break;
    const e=text.indexOf("</Workout>",s); if(e===-1)return{workouts,remainder:text.slice(s)};
    const w=_parseBlock(text.slice(s,e+10)); if(w)workouts.push(w); from=e+10;
  }
  const lastOpen=text.lastIndexOf("<Workout ",from);
  return{workouts,remainder:lastOpen!==-1?text.slice(lastOpen):""};
}
function _streamXML(file, onProgress) {
  return new Promise((resolve,reject)=>{
    const CHUNK=1_048_576; let offset=0,remainder=""; const all=[]; let skipped=0;
    const reader=new FileReader();
    const next=()=>{ if(offset>=file.size){resolve({workouts:all,skipped});return;} reader.readAsText(file.slice(offset,offset+CHUNK),"utf-8"); };
    reader.onload=e=>{
      const chunk=remainder+(e.target.result||"");
      try{
        const{workouts,remainder:rem}=_extractChunk(chunk);
        all.push(...workouts); remainder=rem;
      }catch(err){skipped++;}
      offset+=CHUNK; onProgress(all.length); setTimeout(next,0);
    };
    reader.onerror=()=>reject(new Error("Could not read file.")); next();
  });
}
function _visibleWorkouts(parsed,fType,fYear,hideShort) {
  return parsed.filter(w=>{
    if(fType!=="all"&&w._rawType!==fType)return false;
    if(fYear!=="all"&&!w.date.startsWith(fYear))return false;
    if(hideShort&&w._rawType==="HKWorkoutActivityTypeWalking"){if((parseInt(w.dur)||0)<5&&(parseFloat(w.dist)||0)<0.1)return false;}
    return true;
  });
}

// ─── Body Weight Tracker ─────────────────────────────────
function BodyWeight({s, D, toast}) {
  const [entry, setEntry] = useState("");
  const [editDate, setEditDate] = useState(TODAY);

  // Build sorted array of entries newest-first
  const entries = useMemo(()=>
    Object.entries(s.bodyWeights||{})
      .map(([date,lbs])=>({date,lbs:parseFloat(lbs)}))
      .filter(e=>e.lbs>0)
      .sort((a,b)=>b.date.localeCompare(a.date))
  , [s.bodyWeights]);

  const latest = entries[0]?.lbs || null;
  const prev   = entries[1]?.lbs || null;
  const delta  = latest&&prev ? (latest-prev).toFixed(1) : null;

  // Chart: last 90 days
  const chartDays = useMemo(()=>getDaysRange(90), []);
  const chartData = chartDays
    .map(d=>({d, lbs:s.bodyWeights?.[d]||null}))
    .filter(p=>p.lbs!==null);

  const minW = chartData.length ? Math.min(...chartData.map(p=>p.lbs)) - 2 : 0;
  const maxW = chartData.length ? Math.max(...chartData.map(p=>p.lbs)) + 2 : 100;
  const range = maxW - minW || 1;

  const save = () => {
    const lbs = parseFloat(entry);
    if (!lbs || lbs < 50 || lbs > 700) { toast("Enter a valid weight (50–700 lbs)"); return; }
    D({t:"ADD_BW", date:editDate, lbs});
    setEntry("");
    toast("Weight logged ✓");
  };

  return (
    <div className="fu">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 18px"}}>
        <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
          color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>Body Weight</h1>
      </div>

      {/* Current weight hero */}
      <Card style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:20}}>
          <div>
            {latest ? <>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"3.5rem",fontWeight:900,
                color:T.ink,lineHeight:1,letterSpacing:"-0.02em"}}>{latest}</div>
              <div style={{fontSize:"0.76rem",color:T.inkLight,marginTop:4}}>lbs · {fmtD(entries[0].date)}</div>
            </> : <div style={{fontSize:"0.92rem",color:T.inkMid,fontWeight:500}}>No entries yet</div>}
          </div>
          {delta!==null&&<div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.4rem",fontWeight:800,
              color:parseFloat(delta)<0?T.green:parseFloat(delta)>0?T.red:T.inkLight,lineHeight:1}}>
              {parseFloat(delta)>0?"+":""}{delta}
            </div>
            <div style={{fontSize:"0.6rem",color:T.inkLight,textTransform:"uppercase",
              letterSpacing:"0.06em",marginTop:2}}>vs prev</div>
          </div>}
        </div>

        {/* Line chart */}
        {chartData.length >= 2 && (()=>{
          const W=300, H=80, PAD=8;
          const pts = chartData.map((p,i)=>{
            const x = chartData.length>1
              ? PAD + (i/(chartData.length-1))*(W-PAD*2)
              : W/2;
            const y = H - PAD - ((p.lbs-minW)/range)*(H-PAD*2);
            return {x,y,lbs:p.lbs,d:p.d};
          });
          const pathD = pts.map((p,i)=>`${i===0?"M":"L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
          const fillD = `${pathD} L${pts[pts.length-1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`;
          return (
            <div style={{marginBottom:8}}>
              <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
                color:T.inkLight,marginBottom:6}}>Last 90 days</div>
              <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:80,display:"block"}}>
                <defs>
                  <linearGradient id="bwg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c8f135" stopOpacity="0.3"/>
                    <stop offset="100%" stopColor="#c8f135" stopOpacity="0.02"/>
                  </linearGradient>
                </defs>
                <path d={fillD} fill="url(#bwg)"/>
                <path d={pathD} fill="none" stroke="#c8f135" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
                {/* Latest dot */}
                <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y}
                  r="3" fill="#c8f135"/>
              </svg>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.55rem",color:T.inkLight,marginTop:2}}>
                <span>{fmtD(chartData[0].d)}</span>
                <span>{fmtD(chartData[chartData.length-1].d)}</span>
              </div>
            </div>
          );
        })()}

        {/* Log today */}
        <div style={{borderTop:`1px solid ${T.lineSoft}`,paddingTop:14,display:"flex",gap:8,alignItems:"flex-end"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
              color:T.inkLight,marginBottom:5}}>Log weight</div>
            <div style={{display:"flex",gap:8}}>
              <Inp type="number" value={entry} onChange={e=>setEntry(e.target.value)}
                placeholder="165.4" style={{flex:1}}
                onKeyDown={e=>e.key==="Enter"&&save()}/>
              <Inp type="date" value={editDate} onChange={e=>setEditDate(e.target.value)}
                style={{width:"auto",fontSize:"0.82rem",padding:"8px 10px"}}/>
            </div>
          </div>
          <Btn onClick={save} style={{marginBottom:0}}>Log</Btn>
        </div>
      </Card>

      {/* History list */}
      {entries.length>0&&<Card>
        <Sec>History</Sec>
        {entries.slice(0,30).map((e,i)=>(
          <div key={e.date} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            padding:"9px 0",borderBottom:i<Math.min(entries.length-1,29)?`1px solid ${T.lineSoft}`:"none"}}>
            <div>
              <div style={{fontWeight:500,fontSize:"0.88rem",color:T.ink}}>
                {e.date===TODAY?"Today":fmtD(e.date)}
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.1rem",
                fontWeight:700,color:T.ink}}>{e.lbs} <span style={{fontSize:"0.7rem",color:T.inkLight}}>lbs</span></span>
              {i>0&&entries[i-1]&&(()=>{
                const d=(e.lbs-entries[i-1].lbs).toFixed(1);
                const col=parseFloat(d)<0?T.green:parseFloat(d)>0?T.red:T.inkLight;
                return <span style={{fontSize:"0.72rem",fontWeight:600,color:col,minWidth:40,textAlign:"right"}}>
                  {parseFloat(d)>0?"+":""}{d}
                </span>;
              })()}
              <button onClick={()=>{D({t:"DEL_BW",date:e.date});toast("Removed");}}
                style={{background:"none",border:"none",color:T.inkLight,cursor:"pointer",
                  padding:"4px 6px",fontSize:"0.9rem",minHeight:44,display:"flex",alignItems:"center"}}>✕</button>
            </div>
          </div>
        ))}
      </Card>}

      {entries.length===0&&<Empty icon="⚖️" text="No weight entries yet. Log your first one above."/>}
    </div>
  );
}

// ─── Injury / Illness Flags ──────────────────────────────
function InjuryFlags({s, D, toast}) {
  const ef = {label:"", start:TODAY, end:"", note:"", active:true};
  const [f, sf] = useState(ef);
  const [open, setOpen] = useState(false);

  const save = () => {
    if (!f.label.trim()) { toast("Enter a label"); return; }
    D({t:"ADD_INJ", inj:{...f, id:Date.now(), end:f.end||null}});
    sf(ef); setOpen(false); toast("Logged ✓");
  };

  const injuries = s.injuryPeriods || [];
  const active   = injuries.filter(i=>!i.end||i.end>=TODAY);
  const past     = injuries.filter(i=>i.end&&i.end<TODAY);

  // Helper — is today inside an injury period?
  const isInjuredToday = active.some(i=>i.start<=TODAY&&(!i.end||i.end>=TODAY));

  return (
    <div className="fu">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 18px"}}>
        <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
          color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>Health Flags</h1>
        <Btn sm onClick={()=>{sf(ef);setOpen(true);}}>+ Add</Btn>
      </div>

      {isInjuredToday&&<div style={{background:T.orangeL,border:`1px solid ${T.orange}44`,borderRadius:12,
        padding:"12px 14px",marginBottom:14,display:"flex",gap:10,alignItems:"center"}}>
        <span style={{fontSize:"1.1rem"}}>⚠️</span>
        <div style={{fontSize:"0.82rem",color:T.inkMid,lineHeight:1.5}}>
          You have an active flag today. The AI Coach won't penalise lower activity during this period.
        </div>
      </div>}

      {active.length>0&&<>
        <Sec>Active</Sec>
        {active.map(inj=>(
          <Card key={inj.id} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:"0.92rem",color:T.ink,marginBottom:4}}>{inj.label}</div>
                <div style={{fontSize:"0.72rem",color:T.inkLight}}>
                  From {fmtD(inj.start)}{inj.end?" → "+fmtD(inj.end):" · ongoing"}
                </div>
                {inj.note&&<div style={{fontSize:"0.78rem",color:T.inkMid,marginTop:6,fontStyle:"italic"}}>
                  {inj.note}
                </div>}
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0,marginLeft:8}}>
                <Btn sm v="outline" onClick={()=>{
                  D({t:"UPD_INJ",inj:{...inj,end:TODAY}});
                  toast("Marked as resolved ✓");
                }}>Resolve</Btn>
                <button onClick={()=>{D({t:"DEL_INJ",id:inj.id});toast("Removed");}}
                  style={{background:"none",border:"none",color:T.inkLight,cursor:"pointer",
                    padding:"4px 8px",fontSize:"0.9rem",minHeight:36}}>✕</button>
              </div>
            </div>
          </Card>
        ))}
      </>}

      {past.length>0&&<>
        <Sec>Past flags</Sec>
        {past.map(inj=>(
          <div key={inj.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            padding:"10px 0",borderBottom:`1px solid ${T.lineSoft}`,opacity:0.7}}>
            <div>
              <div style={{fontWeight:500,fontSize:"0.88rem",color:T.ink}}>{inj.label}</div>
              <div style={{fontSize:"0.7rem",color:T.inkLight,marginTop:2}}>
                {fmtD(inj.start)} → {fmtD(inj.end)}
              </div>
            </div>
            <button onClick={()=>{D({t:"DEL_INJ",id:inj.id});toast("Removed");}}
              style={{background:"none",border:"none",color:T.inkLight,cursor:"pointer",
                padding:"4px 8px",fontSize:"0.9rem",minHeight:44}}>✕</button>
          </div>
        ))}
      </>}

      {injuries.length===0&&<Empty icon="🩹" text="No flags logged. Use this to tell the Coach about injuries, illness, or life events that affected your training."/>}

      <Modal open={open} onClose={()=>setOpen(false)} title="Log health flag">
        <FL label="What is it?">
          <Inp value={f.label} onChange={e=>sf(p=>({...p,label:e.target.value}))}
            placeholder="Left knee injury, flu, travel week…" maxLength={80}/>
        </FL>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Start date"><Inp type="date" value={f.start} onChange={e=>sf(p=>({...p,start:e.target.value}))}/></FL>
          <FL label="End date (leave blank if ongoing)">
            <Inp type="date" value={f.end} onChange={e=>sf(p=>({...p,end:e.target.value}))}/>
          </FL>
        </div>
        <FL label="Notes (optional)">
          <Area value={f.note} onChange={e=>sf(p=>({...p,note:e.target.value}))}
            placeholder="How severe? Any restrictions?" maxLength={300}/>
        </FL>
        <div style={{display:"flex",gap:10,marginTop:4}}>
          <Btn full v="outline" onClick={()=>setOpen(false)}>Cancel</Btn>
          <Btn full onClick={save}>Save flag</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── Rest Day Journal ─────────────────────────────────────
function RestJournal({s, D, toast}) {
  const [note, setNote] = useState(s.dayNotes?.[TODAY]||"");
  const [editDate, setEditDate] = useState(TODAY);

  // Sync note field when date changes
  const handleDateChange = (d) => {
    setEditDate(d);
    setNote(s.dayNotes?.[d]||"");
  };

  const save = () => {
    if (!note.trim()) { D({t:"DEL_NOTE",date:editDate}); toast("Note cleared"); return; }
    D({t:"DAY_NOTE",date:editDate,note:note.trim()});
    toast("Note saved ✓");
  };

  const allNotes = Object.entries(s.dayNotes||{})
    .map(([date,note])=>({date,note}))
    .sort((a,b)=>b.date.localeCompare(a.date))
    .slice(0,30);

  return (
    <div className="fu">
      <div style={{padding:"4px 0 18px"}}>
        <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
          color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>Day Notes</h1>
        <p style={{fontSize:"0.78rem",color:T.inkLight,marginTop:4,lineHeight:1.5}}>
          Log context around rest days, travel, or anything that affected your training.
        </p>
      </div>

      <Card style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
            color:T.inkLight}}>Add note</div>
          <Inp type="date" value={editDate} onChange={e=>handleDateChange(e.target.value)}
            style={{width:"auto",fontSize:"0.82rem",padding:"6px 10px"}}/>
        </div>
        <Area value={note} onChange={e=>setNote(e.target.value)}
          placeholder="Rest day — legs feeling heavy from Tuesday. Travel day. Sick — skipped training."
          maxLength={500} style={{minHeight:88}}/>
        <div style={{display:"flex",gap:8,marginTop:10}}>
          <Btn full onClick={save}>{note.trim()?"Save note":"Clear note"}</Btn>
        </div>
      </Card>

      {allNotes.length>0&&<Card>
        <Sec>Recent notes</Sec>
        {allNotes.map((n,i)=>(
          <div key={n.date} style={{padding:"10px 0",
            borderBottom:i<allNotes.length-1?`1px solid ${T.lineSoft}`:"none"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:"0.82rem",color:T.inkLight,marginBottom:4}}>
                  {n.date===TODAY?"Today":fmtD(n.date)}
                </div>
                <div style={{fontSize:"0.84rem",color:T.inkMid,lineHeight:1.55}}>{n.note}</div>
              </div>
              <button onClick={()=>{D({t:"DEL_NOTE",date:n.date});toast("Removed");}}
                style={{background:"none",border:"none",color:T.inkLight,cursor:"pointer",
                  padding:"4px 6px",minHeight:44,display:"flex",alignItems:"center",flexShrink:0}}>✕</button>
            </div>
          </div>
        ))}
      </Card>}

      {allNotes.length===0&&<Empty icon="📝" text="No notes yet. Add context about rest days or anything that affected your training."/>}
    </div>
  );
}

// ─── Profile & Settings ──────────────────────────────────
function ProfilePage({s, D, toast}) {
  const p = s.profile || {};
  const [f, sf] = useState({...({
    name:"", age:"", weightLbs:"", heightIn:"",
    fitnessLevel:"intermediate", primaryGoal:"general", weeklyTarget:4
  }), ...p});
  const [dirty, setDirty] = useState(false);

  const upd = (k,v) => { sf(prev=>({...prev,[k]:v})); setDirty(true); };

  const save = () => {
    D({t:"UPD_PROFILE", profile:f});
    setDirty(false);
    toast("Profile saved ✓");
  };

  const goals = [
    {k:"general",    label:"General fitness"},
    {k:"weight",     label:"Weight management"},
    {k:"performance",label:"Performance"},
    {k:"consistency",label:"Build a habit"},
  ];
  const levels = [
    {k:"beginner",    label:"Beginner"},
    {k:"intermediate",label:"Intermediate"},
    {k:"advanced",    label:"Advanced"},
  ];

  return (
    <div className="fu">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 18px"}}>
        <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
          color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>Profile</h1>
        {dirty&&<Btn sm onClick={save}>Save</Btn>}
      </div>

      <Card style={{marginBottom:14}}>
        <Sec>Personal</Sec>
        <FL label="Name">
          <Inp value={f.name||""} onChange={e=>upd("name",e.target.value)}
            placeholder="Your name" maxLength={30}/>
        </FL>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          <FL label="Age"><Inp type="number" value={f.age||""} onChange={e=>upd("age",e.target.value)}
            placeholder="28" maxLength={3}/></FL>
          <FL label="Weight (lbs)"><Inp type="number" value={f.weightLbs||""} onChange={e=>upd("weightLbs",e.target.value)}
            placeholder="165" maxLength={4}/></FL>
          <FL label="Height (in)"><Inp type="number" value={f.heightIn||""} onChange={e=>upd("heightIn",e.target.value)}
            placeholder="70" maxLength={3}/></FL>
        </div>
      </Card>

      <Card style={{marginBottom:14}}>
        <Sec>Training focus</Sec>
        <FL label="Primary goal">
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {goals.map(g=>(
              <button key={g.k} onClick={()=>upd("primaryGoal",g.k)}
                style={{padding:"11px 14px",borderRadius:12,textAlign:"left",cursor:"pointer",
                  border:`1.5px solid ${f.primaryGoal===g.k?"#c8f135":T.line}`,
                  background:f.primaryGoal===g.k?"#1e2a00":T.paper,
                  color:f.primaryGoal===g.k?"#c8f135":T.ink,
                  fontSize:"0.88rem",fontWeight:f.primaryGoal===g.k?700:400,
                  transition:"all .15s",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                {g.label}
                {f.primaryGoal===g.k&&<span>✓</span>}
              </button>
            ))}
          </div>
        </FL>
        <FL label="Fitness level">
          <div style={{display:"flex",gap:8}}>
            {levels.map(l=>(
              <button key={l.k} onClick={()=>upd("fitnessLevel",l.k)}
                style={{flex:1,padding:"10px 6px",borderRadius:12,cursor:"pointer",
                  border:`1.5px solid ${f.fitnessLevel===l.k?"#c8f135":T.line}`,
                  background:f.fitnessLevel===l.k?"#1e2a00":T.paper,
                  color:f.fitnessLevel===l.k?"#c8f135":T.inkMid,
                  fontSize:"0.74rem",fontWeight:f.fitnessLevel===l.k?700:500,transition:"all .15s"}}>
                {l.label}
              </button>
            ))}
          </div>
        </FL>
        <FL label="Weekly target (sessions)">
          <div style={{display:"flex",gap:8}}>
            {[2,3,4,5,6].map(n=>(
              <button key={n} onClick={()=>upd("weeklyTarget",n)}
                style={{flex:1,padding:"12px 4px",borderRadius:12,cursor:"pointer",
                  border:`1.5px solid ${f.weeklyTarget===n?"#c8f135":T.line}`,
                  background:f.weeklyTarget===n?"#1e2a00":T.paper,
                  color:f.weeklyTarget===n?"#c8f135":T.inkMid,
                  fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.2rem",fontWeight:800,
                  transition:"all .15s"}}>
                {n}
              </button>
            ))}
          </div>
        </FL>
      </Card>

      <Card style={{marginBottom:14}}>
        <Sec>Appearance</Sec>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0"}}>
          <div>
            <div style={{fontWeight:600,fontSize:"0.88rem",color:T.ink}}>Theme</div>
            <div style={{fontSize:"0.72rem",color:T.inkLight,marginTop:2}}>
              {s.theme==="light"?"Light mode":"Dark mode (Obsidian)"}
            </div>
          </div>
          <button onClick={()=>D({t:"THEME",theme:s.theme==="light"?"dark":"light"})}
            style={{
              width:52,height:30,borderRadius:15,cursor:"pointer",border:"none",
              background:s.theme==="light"?"#c8f135":T.line,
              position:"relative",transition:"background .2s",flexShrink:0,
            }}>
            <div style={{
              position:"absolute",top:3,
              left:s.theme==="light"?24:3,
              width:24,height:24,borderRadius:"50%",
              background:"#fff",transition:"left .2s",
              boxShadow:"0 1px 4px rgba(0,0,0,.3)",
            }}/>
          </button>
        </div>
      </Card>

      {dirty&&<Btn full onClick={save} style={{marginTop:4}}>Save profile</Btn>}
    </div>
  );
}

// ─── Global Search ───────────────────────────────────────
function GlobalSearch({s, D, toast, goPage}) {
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const inputRef = useRef(null);

  const results = useMemo(()=>{
    const term = q.trim().toLowerCase();
    if (term.length < 2) return {workouts:[],foods:[],recipes:[]};

    const workouts = s.workouts
      .filter(w=>w.name.toLowerCase().includes(term)||w.type.toLowerCase().includes(term))
      .slice(0,8);

    const foods = [];
    Object.entries(s.meals).forEach(([date,slots])=>{
      Object.entries(slots||{}).forEach(([slot,items])=>{
        (items||[]).forEach(item=>{
          if (item.name.toLowerCase().includes(term)) {
            foods.push({...item, date, slot});
          }
        });
      });
    });
    const uniqueFoods = foods.filter((f,i)=>foods.findIndex(x=>x.name===f.name)===i).slice(0,8);

    const recipes = (s.recipes||[])
      .filter(r=>r.name.toLowerCase().includes(term)||(r.ingr||"").toLowerCase().includes(term))
      .slice(0,6);

    return {workouts, foods:uniqueFoods, recipes};
  }, [q, s.workouts, s.meals, s.recipes]);

  const total = results.workouts.length + results.foods.length + results.recipes.length;

  return (
    <div className="fu">
      <div style={{padding:"4px 0 16px"}}>
        <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
          color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>Search</h1>
      </div>

      {/* Search input */}
      <div style={{position:"relative",marginBottom:20}}>
        <input ref={inputRef}
          value={q} onChange={e=>setQ(e.target.value)}
          onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
          placeholder="Search workouts, foods, recipes…"
          autoFocus
          style={{width:"100%",padding:"14px 44px 14px 16px",borderRadius:14,
            border:`1.5px solid ${focus?"#c8f135":T.line}`,
            background:T.paper,color:T.ink,fontSize:"16px",outline:"none",
            boxSizing:"border-box",transition:"border-color .15s"}}/>
        {q&&<button onClick={()=>setQ("")}
          style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",
            background:"none",border:"none",color:T.inkLight,cursor:"pointer",
            fontSize:"1.1rem",minWidth:44,minHeight:44,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>}
      </div>

      {q.length<2&&<Empty icon="🔍" text="Type at least 2 characters to search across your workouts, food log, and recipes."/>}

      {q.length>=2&&total===0&&<Empty icon="∅" text={`No results for "${q}"`}/>}

      {results.workouts.length>0&&<>
        <Sec>Workouts ({results.workouts.length})</Sec>
        {results.workouts.map(w=>{
          const ac=actColor(w.type);
          return (
            <div key={w.id} style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:12,
              padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:10,background:ac.bg,
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:"1.1rem",flexShrink:0}}>{w.type.split(" ")[0]}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:"0.9rem",color:T.ink,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{w.name}</div>
                <div style={{fontSize:"0.68rem",color:T.inkLight,marginTop:2,display:"flex",gap:8}}>
                  <span>{fmtD(w.date)}</span>
                  {hasDur(w.dur)&&<span>{w.dur}m</span>}
                  {w.cals>0&&<span>{w.cals} cal</span>}
                </div>
              </div>
              {w.effort&&<Pill color={w.effort==="crushed"?"slate":w.effort==="hard"?"stone":"sage"}>{w.effort}</Pill>}
            </div>
          );
        })}
      </>}

      {results.foods.length>0&&<>
        <Sec>Foods logged ({results.foods.length})</Sec>
        {results.foods.map((f,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            padding:"10px 0",borderBottom:`1px solid ${T.lineSoft}`}}>
            <div>
              <div style={{fontWeight:500,fontSize:"0.88rem",color:T.ink}}>{f.name}</div>
              <div style={{fontSize:"0.66rem",color:T.inkLight,marginTop:2}}>
                {fmtD(f.date)} · {CAT_LABELS[f.slot]||f.slot}
              </div>
            </div>
            <div style={{fontFamily:"ui-monospace,monospace",fontSize:"0.72rem",color:T.inkLight}}>
              {f.cal}cal P{f.pro}g
            </div>
          </div>
        ))}
      </>}

      {results.recipes.length>0&&<>
        <Sec>Recipes ({results.recipes.length})</Sec>
        {results.recipes.map(r=>(
          <div key={r.id} style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:12,
            padding:"12px 14px",marginBottom:8}}>
            <div style={{fontWeight:600,fontSize:"0.9rem",color:T.ink,marginBottom:3}}>{r.name}</div>
            <div style={{fontFamily:"ui-monospace,monospace",fontSize:"0.68rem",color:T.inkLight}}>
              {r.cal} cal · P{r.pro}g C{r.carb}g F{r.fat}g
            </div>
          </div>
        ))}
      </>}
    </div>
  );
}

// ─── Activity Heatmap ────────────────────────────────────
function ActivityHeatmap({s}) {
  const today = _getToday();
  // Build 53 weeks × 7 days grid (364+today)
  const days = useMemo(()=>{
    const arr=[];
    const d=new Date();
    // Go back to last Sunday
    d.setDate(d.getDate()-d.getDay());
    d.setDate(d.getDate()-(52*7));
    while (localDate(d)<=today) {
      arr.push(localDate(d));
      d.setDate(d.getDate()+1);
    }
    return arr;
  },[]);

  const workoutMap = useMemo(()=>{
    const m={};
    s.workouts.forEach(w=>{
      if(!m[w.date]) m[w.date]={count:0,types:[],totalMin:0};
      m[w.date].count++;
      m[w.date].types.push(w.type);
      m[w.date].totalMin+=parseInt(w.dur)||0;
    });
    return m;
  },[s.workouts]);

  const maxCount=Math.max(...Object.values(workoutMap).map(d=>d.count),1);
  const [hovered,setHovered]=useState(null);

  // Group by week
  const weeks=[];
  for(let i=0;i<days.length;i+=7) weeks.push(days.slice(i,i+7));

  const intensity=(date)=>{
    const d=workoutMap[date];
    if(!d||d.count===0) return 0;
    return Math.min(4,Math.ceil(d.count/maxCount*4));
  };

  const colors=["#252525","#1e2a00","#4a6600","#8a9f00","#c8f135"];
  const yearTotal=days.filter(d=>workoutMap[d]).length;

  return (
    <div className="fu">
      <div style={{padding:"4px 0 18px"}}>
        <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
          color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>Activity</h1>
        <p style={{fontSize:"0.78rem",color:T.inkLight,marginTop:4}}>{yearTotal} active days in the last year</p>
      </div>

      {/* Month labels */}
      <div style={{overflowX:"auto",paddingBottom:8}}>
        <div style={{minWidth:weeks.length*13+4}}>
          {/* Day labels */}
          <div style={{display:"flex",gap:2,marginBottom:4}}>
            <div style={{width:14}}/>
            {["S","M","T","W","T","F","S"].map((l,i)=>(
              <div key={i} style={{width:10,fontSize:"0.45rem",color:T.inkLight,textAlign:"center"}}>{i%2===1?l:""}</div>
            ))}
          </div>
          {/* Grid */}
          <div style={{display:"flex",gap:2}}>
            {weeks.map((week,wi)=>(
              <div key={wi} style={{display:"flex",flexDirection:"column",gap:2}}>
                {week.map(d=>{
                  const lvl=intensity(d);
                  const wd=workoutMap[d];
                  const isFuture=d>today;
                  return (
                    <div key={d}
                      onMouseEnter={()=>setHovered(d)}
                      onMouseLeave={()=>setHovered(null)}
                      onClick={()=>setHovered(hovered===d?null:d)}
                      style={{width:10,height:10,borderRadius:2,
                        background:isFuture?"transparent":colors[lvl],
                        border:d===today?`1px solid #c8f135`:"none",
                        cursor:wd?"pointer":"default",
                        opacity:isFuture?0.1:1,
                        transition:"transform .1s",
                        transform:hovered===d?"scale(1.4)":"scale(1)",
                        willChange:"transform",
                      }}/>
                  );
                })}
              </div>
            ))}
          </div>
          {/* Legend */}
          <div style={{display:"flex",alignItems:"center",gap:4,marginTop:8,justifyContent:"flex-end"}}>
            <span style={{fontSize:"0.52rem",color:T.inkLight}}>Less</span>
            {colors.map((c,i)=><div key={i} style={{width:10,height:10,borderRadius:2,background:c}}/>)}
            <span style={{fontSize:"0.52rem",color:T.inkLight}}>More</span>
          </div>
        </div>
      </div>

      {/* Hovered day detail */}
      {hovered&&workoutMap[hovered]&&(()=>{
        const wd=workoutMap[hovered];
        return (
          <div style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:12,
            padding:"12px 14px",marginTop:8,animation:"fu .2s both"}}>
            <div style={{fontWeight:700,fontSize:"0.9rem",color:T.ink,marginBottom:4}}>{fmtD(hovered)}</div>
            <div style={{fontSize:"0.78rem",color:T.inkMid}}>
              {wd.count} session{wd.count!==1?"s":""} · {wd.totalMin} min
            </div>
            <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
              {[...new Set(wd.types)].map(t=>{
                const ac=actColor(t);
                return <span key={t} style={{fontSize:"0.7rem",padding:"2px 8px",borderRadius:8,
                  background:ac.bg,color:ac.accent}}>{t.split(" ")[0]} {t.split(" ").slice(1).join(" ")}</span>;
              })}
            </div>
          </div>
        );
      })()}

      {/* Monthly summary */}
      <Card style={{marginTop:16}}>
        <Sec>Monthly summary</Sec>
        {(()=>{
          const months={};
          s.workouts.forEach(w=>{
            const mk=w.date.slice(0,7);
            if(!months[mk])months[mk]=0;
            months[mk]++;
          });
          const sorted=Object.entries(months).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12);
          const maxM=Math.max(...sorted.map(([,c])=>c),1);
          return sorted.map(([mk,count])=>{
            const label=new Date(mk+"-15").toLocaleDateString("en-US",{month:"short",year:"2-digit"});
            const pct=Math.round(count/maxM*100);
            return (
              <div key={mk} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:`1px solid ${T.lineSoft}`}}>
                <span style={{fontSize:"0.72rem",color:T.inkLight,width:52,flexShrink:0}}>{label}</span>
                <div style={{flex:1,height:6,background:T.lineSoft,borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct}%`,background:"#c8f135",borderRadius:3}}/>
                </div>
                <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"0.92rem",fontWeight:700,color:T.ink,width:20,textAlign:"right"}}>{count}</span>
              </div>
            );
          });
        })()}
      </Card>
    </div>
  );
}

// ─── Goal Templates ──────────────────────────────────────
const GOAL_TEMPLATES = [
  {name:"Run a 5K",           cat:"🏃 Running",  target:3.1,  unit:"miles",    icon:"🏃"},
  {name:"Run 50 miles/month", cat:"🏃 Running",  target:50,   unit:"miles",    icon:"🗓"},
  {name:"20 strength sessions",cat:"🏋️ Strength", target:20,  unit:"sessions", icon:"🏋️"},
  {name:"Lose 10 lbs",        cat:"⚖️ Body comp",target:10,   unit:"lbs",      icon:"⚖️"},
  {name:"Protein goal 5 days/week",cat:"🥗 Nutrition",target:20,unit:"days",  icon:"💪"},
  {name:"30 workouts/month",  cat:"✦ Other",    target:30,   unit:"sessions", icon:"⚡"},
  {name:"Ride 100 miles",     cat:"🏃 Running",  target:100,  unit:"miles",    icon:"🚴"},
  {name:"10K steps daily/month",cat:"✦ Other",  target:30,   unit:"days",     icon:"👣"},
];

// ─── Challenges ───────────────────────────────────────────
function ChallengesPage({s, D, toast}) {
  const [open, setOpen] = useState(false);
  const ef = {name:"", metric:"sessions", target:20, unit:"sessions",
    start:TODAY, end:"", type:"monthly"};
  const [f, sf] = useState(ef);

  const metrics = [
    {k:"sessions",label:"Total sessions"},
    {k:"miles",   label:"Miles run"},
    {k:"minutes", label:"Active minutes"},
    {k:"protein", label:"Protein goal days"},
  ];

  const calcProgress = (ch) => {
    const start = ch.start || TODAY;
    const end = ch.end || TODAY;
    const ws = s.workouts.filter(w=>w.date>=start&&w.date<=end);
    switch(ch.metric) {
      case "sessions": return ws.length;
      case "miles":    return parseFloat(ws.reduce((a,w)=>a+(parseFloat(w.dist)||0),0).toFixed(1));
      case "minutes":  return ws.reduce((a,w)=>a+(parseInt(w.dur)||0),0);
      case "protein": {
        const macroGoals=s.macroGoals;
        const target=macroGoals.pro*0.85;
        let days=0;
        const d=new Date(start+"T12:00");
        let iters=0;
        while(localDate(d)<=end && iters<400) {
          const dk=localDate(d);
          if(sumM(s.meals[dk]||{}).pro>=target) days++;
          d.setDate(d.getDate()+1);
          iters++;
        }
        return days;
      }
      default: return 0;
    }
  };

  const challenges = s.challenges || [];
  const active = challenges.filter(c=>!c.end||c.end>=TODAY);
  const past   = challenges.filter(c=>c.end&&c.end<TODAY);

  return (
    <div className="fu">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 18px"}}>
        <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
          color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>Challenges</h1>
        <div style={{display:"flex",gap:8}}>
          <Btn sm v="outline" onClick={()=>setShowTpl(true)}>Templates</Btn>
          <Btn sm onClick={()=>{sf(ef);setOpen(true);}}>+ New</Btn>
        </div>
      </div>

      {active.length===0&&past.length===0&&(
        <Empty icon="🏆" text="No challenges yet. Set a challenge to stay motivated — like 20 sessions this month or 50 miles before the end of the year."/>
      )}

      {active.map(ch=>{
        const curr=calcProgress(ch);
        const pct=ch.target>0?Math.min(100,Math.round(curr/ch.target*100)):0;
        const col=pct>=100?T.green:pct>=60?T.slate:T.orange;
        const daysLeft=ch.end?Math.max(0,Math.round((new Date(ch.end+"T12:00")-new Date())/(1000*60*60*24))):null;
        return (
          <Card key={ch.id} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
              <div style={{flex:1,paddingRight:10}}>
                <div style={{fontWeight:700,fontSize:"0.98rem",color:T.ink,marginBottom:4}}>{ch.name}</div>
                <div style={{fontSize:"0.72rem",color:T.inkLight}}>
                  {ch.metric} · {daysLeft!==null?`${daysLeft}d left`:"Ongoing"}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.6rem",fontWeight:900,
                  color:col,lineHeight:1}}>{curr}<span style={{fontSize:"0.9rem",color:T.inkLight}}>/{ch.target}</span></div>
                <div style={{fontSize:"0.6rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.06em"}}>{ch.unit}</div>
              </div>
            </div>
            <div style={{height:8,background:T.lineSoft,borderRadius:99,overflow:"hidden",marginBottom:8}}>
              <div style={{height:"100%",width:`${pct}%`,background:col,borderRadius:99,
                transition:"width .6s cubic-bezier(.22,.68,0,1.2)",
                boxShadow:pct>=100?`0 0 12px ${col}88`:"none"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:"0.72rem",color:col,fontWeight:700}}>{pct}% complete</span>
              <button onClick={()=>{D({t:"DEL_CH",id:ch.id});toast("Removed");}}
                style={{background:"none",border:"none",color:T.inkLight,cursor:"pointer",
                  padding:"4px 8px",fontSize:"0.88rem",minHeight:36}}>✕</button>
            </div>
            {pct>=100&&<div style={{marginTop:8,padding:"8px 12px",background:"#1e2a00",
              borderRadius:8,fontSize:"0.78rem",color:"#c8f135",fontWeight:700,textAlign:"center"}}>
              🏆 Challenge complete!
            </div>}
          </Card>
        );
      })}

      {past.length>0&&<>
        <Sec>Completed</Sec>
        {past.map(ch=>{
          const curr=calcProgress(ch);
          const pct=ch.target>0?Math.min(100,Math.round(curr/ch.target*100)):0;
          return (
            <div key={ch.id} style={{display:"flex",justifyContent:"space-between",
              alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${T.lineSoft}`,opacity:.7}}>
              <div>
                <div style={{fontWeight:500,fontSize:"0.88rem",color:T.ink}}>{ch.name}</div>
                <div style={{fontSize:"0.7rem",color:T.inkLight,marginTop:2}}>
                  {curr}/{ch.target} {ch.unit} · {pct}%
                </div>
              </div>
              <Pill color={pct>=100?"sage":"stone"}>{pct>=100?"✓ Done":`${pct}%`}</Pill>
            </div>
          );
        })}
      </>}

      <Modal open={open} onClose={()=>setOpen(false)} title="New challenge">
        <FL label="Name"><Inp value={f.name} onChange={e=>sf(p=>({...p,name:e.target.value}))} placeholder="20 sessions this month" maxLength={80}/></FL>
        <FL label="What to track">
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {metrics.map(m=>(
              <button key={m.k} onClick={()=>sf(p=>({...p,metric:m.k,unit:m.k==="sessions"?"sessions":m.k==="miles"?"miles":m.k==="minutes"?"min":"days"}))}
                style={{padding:"10px 14px",borderRadius:10,border:`1px solid ${f.metric===m.k?"#c8f135":T.line}`,
                  background:f.metric===m.k?"#1e2a00":T.paper,color:f.metric===m.k?"#c8f135":T.ink,
                  fontSize:"0.84rem",fontWeight:f.metric===m.k?700:400,cursor:"pointer",textAlign:"left",
                  transition:"all .15s"}}>
                {m.label}
              </button>
            ))}
          </div>
        </FL>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Target"><Inp type="number" value={f.target} onChange={e=>sf(p=>({...p,target:parseFloat(e.target.value)||0}))} placeholder="20"/></FL>
          <FL label="End date (optional)"><Inp type="date" value={f.end} onChange={e=>sf(p=>({...p,end:e.target.value}))}/></FL>
        </div>
        <div style={{display:"flex",gap:10,marginTop:4}}>
          <Btn full v="outline" onClick={()=>setOpen(false)}>Cancel</Btn>
          <Btn full onClick={()=>{
            if(!f.name.trim()||!f.target){toast("Enter name and target");return;}
            D({t:"ADD_CH",ch:{...f,id:Date.now()}});
            setOpen(false);sf(ef);
            haptic("success");
            toast("Challenge started 🏆");
          }}>Start challenge</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── Weekly Planning ─────────────────────────────────────
function WeeklyPlan({s, D, toast}) {
  const wkD = getWk();
  const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const wkKey = (()=>{
    const d=new Date(wkD[0]+"T12:00");
    const wk=Math.ceil(((d-new Date(d.getFullYear(),0,1))/86400000+1)/7);
    return `${d.getFullYear()}-W${String(wk).padStart(2,"0")}`;
  })();

  const plan = (s.weeklyPlan||{})[wkKey]||{};

  // Which days had actual workouts
  const actualByDay = {};
  wkD.forEach((date,i)=>{
    actualByDay[i]=s.workouts.filter(w=>w.date===date);
  });

  const [editDay,setEditDay]=useState(null);
  const [planItems,setPlanItems]=useState([]);

  const openEdit=(dow)=>{
    setEditDay(dow);
    setPlanItems(plan[dow]||[{type:"🏃 Run",name:"",notes:""}]);
  };

  const savePlan=()=>{
    D({t:"SET_PLAN",wk:wkKey,dow:editDay,items:planItems.filter(i=>i.type||i.name)});
    setEditDay(null);
    toast("Plan saved ✓");
  };

  return (
    <div className="fu">
      <div style={{padding:"4px 0 18px"}}>
        <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
          color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>Weekly Plan</h1>
        <p style={{fontSize:"0.78rem",color:T.inkLight,marginTop:4}}>
          Sketch your week. Tap a day to plan it.
        </p>
      </div>

      {/* Week grid */}
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        {wkD.map((date,i)=>{
          const dow=i;
          const planned=plan[dow]||[];
          const actual=actualByDay[dow]||[];
          const isToday=date===TODAY;
          const isPast=date<TODAY;
          return (
            <div key={date} style={{background:T.paper,border:`1px solid ${isToday?"#c8f135":T.line}`,
              borderRadius:14,padding:"12px 14px",
              opacity:isPast&&!actual.length&&!planned.length?.5:1}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1rem",
                      fontWeight:900,color:isToday?"#c8f135":T.ink,textTransform:"uppercase",
                      letterSpacing:"0.06em"}}>{DAY_LABELS[new Date(date+"T12:00").getDay()]}</span>
                    <span style={{fontSize:"0.7rem",color:T.inkLight}}>
                      {new Date(date+"T12:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                    </span>
                    {actual.length>0&&<Pill color="sage">{actual.length} done</Pill>}
                  </div>
                  {/* Planned sessions */}
                  {planned.length>0&&<div style={{display:"flex",flexDirection:"column",gap:4}}>
                    {planned.map((item,j)=>{
                      const ac=actColor(item.type);
                      const done=actual.some(w=>w.type===item.type);
                      return (
                        <div key={j} style={{display:"flex",alignItems:"center",gap:8,opacity:done?.5:1}}>
                          <span style={{fontSize:"0.85rem"}}>{item.type.split(" ")[0]}</span>
                          <span style={{fontSize:"0.78rem",color:T.inkMid,
                            textDecoration:done?"line-through":"none"}}>
                            {item.name||item.type.split(" ").slice(1).join(" ")}
                          </span>
                          {done&&<span style={{fontSize:"0.65rem",color:T.green}}>✓</span>}
                        </div>
                      );
                    })}
                  </div>}
                  {!planned.length&&!actual.length&&<span style={{fontSize:"0.76rem",color:T.inkMid,fontWeight:500}}>Rest day</span>}
                  {/* Actual workouts (if no planned) */}
                  {!planned.length&&actual.length>0&&actual.map((w,j)=>(
                    <div key={j} style={{fontSize:"0.78rem",color:T.inkMid,display:"flex",gap:6,alignItems:"center"}}>
                      <span>{w.type.split(" ")[0]}</span><span>{w.name}</span>
                    </div>
                  ))}
                </div>
                <button onClick={()=>openEdit(dow)}
                  style={{background:"none",border:`1px solid ${T.line}`,borderRadius:8,
                    color:T.inkLight,cursor:"pointer",padding:"5px 10px",fontSize:"0.72rem",
                    fontWeight:600,flexShrink:0,minHeight:36}}>
                  {planned.length?"Edit":"Plan"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Planned vs actual summary */}
      {(()=>{
        const totalPlanned=Object.values(plan).flat().length;
        const totalDone=wkD.reduce((a,d)=>a+s.workouts.filter(w=>w.date===d).length,0);
        if(!totalPlanned&&!totalDone) return null;
        return (
          <Card>
            <Sec>This week</Sec>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,color:T.slate,lineHeight:1}}>{totalPlanned}</div>
                <div style={{fontSize:"0.65rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.06em",marginTop:4}}>Planned</div>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,color:T.green,lineHeight:1}}>{totalDone}</div>
                <div style={{fontSize:"0.65rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.06em",marginTop:4}}>Completed</div>
              </div>
            </div>
          </Card>
        );
      })()}

      {/* Edit day modal */}
      <Modal open={editDay!==null} onClose={()=>setEditDay(null)} title={editDay!==null?`Plan ${DAY_LABELS[new Date(wkD[editDay]+"T12:00").getDay()]}`:""}>
        {planItems.map((item,i)=>(
          <div key={i} style={{marginBottom:12,padding:"10px 12px",background:T.paperAlt,borderRadius:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:"0.62rem",fontWeight:700,color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.06em"}}>Session {i+1}</div>
              {planItems.length>1&&<button onClick={()=>setPlanItems(p=>p.filter((_,j)=>j!==i))}
                style={{background:"none",border:"none",color:T.inkLight,cursor:"pointer",fontSize:"0.9rem"}}>✕</button>}
            </div>
            <FL label="Type"><Sel value={item.type} onChange={e=>setPlanItems(p=>p.map((it,j)=>j===i?{...it,type:e.target.value}:it))}>
              {WORKOUT_TYPES.map(t=><option key={t}>{t}</option>)}
            </Sel></FL>
            <FL label="Notes (optional)"><Inp value={item.name||""} onChange={e=>setPlanItems(p=>p.map((it,j)=>j===i?{...it,name:e.target.value}:it))} placeholder="Easy 5K, Heavy legs…"/></FL>
          </div>
        ))}
        <Btn full v="outline" sm onClick={()=>setPlanItems(p=>[...p,{type:"🏃 Run",name:""}])} style={{marginBottom:10}}>+ Add session</Btn>
        <div style={{display:"flex",gap:10}}>
          <Btn full v="outline" onClick={()=>{D({t:"SET_PLAN",wk:wkKey,dow:editDay,items:[]});setEditDay(null);toast("Cleared");}}>Clear day</Btn>
          <Btn full onClick={savePlan}>Save plan</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── Highlight Card Export ───────────────────────────────
function HighlightCard({s}) {
  const [period, setPeriod] = useState("month");
  const [generated, setGenerated] = useState(false);
  const canvasRef = useRef(null);

  const days = period==="month" ? getDaysRange(30) : period==="week" ? getWk() : getDaysRange(365);
  const ws = s.workouts.filter(w=>days.includes(w.date));
  const totalSessions = ws.length;
  const totalMiles = parseFloat(ws.reduce((a,w)=>a+(parseFloat(w.dist)||0),0).toFixed(1));
  const totalMin = ws.reduce((a,w)=>a+(parseInt(w.dur)||0),0);
  const totalCal = ws.reduce((a,w)=>a+(w.cals||0),0);
  const streak = calcStreak(s.workouts, true);

  const loggedDays = days.filter(d=>sumM(s.meals[d]||{}).cal>0).length;

  const generate = () => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ctx = canvas.getContext("2d");
    const W=800, H=420;
    canvas.width=W; canvas.height=H;

    // Background
    const grad = ctx.createLinearGradient(0,0,W,H);
    grad.addColorStop(0,"#0d0d0d");
    grad.addColorStop(0.5,"#1a1a1a");
    grad.addColorStop(1,"#111111");
    ctx.fillStyle=grad;
    ctx.fillRect(0,0,W,H);

    // Border
    ctx.strokeStyle="#c8f135";
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.roundRect(8,8,W-16,H-16,20);
    ctx.stroke();

    // PULSE wordmark
    ctx.fillStyle="#c8f135";
    ctx.font="bold 32px 'Arial Black',sans-serif";
    ctx.letterSpacing="8px";
    ctx.fillText("PULSE",40,60);

    // Period label
    ctx.fillStyle="rgba(200,241,53,0.5)";
    ctx.font="14px Arial,sans-serif";
    ctx.letterSpacing="3px";
    const label=period==="month"?"LAST 30 DAYS":period==="week"?"THIS WEEK":"THIS YEAR";
    ctx.fillText(label,40,90);

    // Stats grid
    const stats=[
      {v:String(totalSessions),l:"SESSIONS",col:"#c8f135"},
      {v:totalMiles>0?String(totalMiles):"—",l:"MILES",col:"#00e5ff"},
      {v:totalMin>60?`${Math.round(totalMin/60)}h`:totalMin+"m",l:"ACTIVE",col:"#4cffb0"},
      {v:streak>0?`${streak}d`:"—",l:"STREAK",col:"#bf5af2"},
    ];
    stats.forEach((st,i)=>{
      const x=40+(i%2)*360, y=155+Math.floor(i/2)*110;
      ctx.fillStyle=st.col;
      ctx.font="bold 56px 'Arial Black',sans-serif";
      ctx.letterSpacing="0px";
      ctx.fillText(st.v,x,y);
      ctx.fillStyle="rgba(200,241,53,0.4)";
      ctx.font="11px Arial,sans-serif";
      ctx.letterSpacing="3px";
      ctx.fillText(st.l,x,y+22);
    });

    // Watermark
    ctx.fillStyle="rgba(200,241,53,0.2)";
    ctx.font="11px Arial,sans-serif";
    ctx.letterSpacing="1px";
    ctx.fillText("Built with PULSE",W-170,H-20);

    setGenerated(true);
  };

  const download = () => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    const link = document.createElement("a");
    link.download=`pulse-${period}-${TODAY}.png`;
    link.href=canvas.toDataURL("image/png");
    link.click();
    toast("Saved to downloads ✓");
  };

  return (
    <div className="fu">
      <div style={{padding:"4px 0 18px"}}>
        <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
          color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>Highlight Card</h1>
        <p style={{fontSize:"0.78rem",color:T.inkLight,marginTop:4}}>
          Generate a shareable summary of your training.
        </p>
      </div>

      <Card style={{marginBottom:14}}>
        <Sec>Period</Sec>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {[{k:"week",l:"This week"},{k:"month",l:"Last 30 days"},{k:"year",l:"This year"}].map(p=>(
            <button key={p.k} onClick={()=>{setPeriod(p.k);setGenerated(false);}}
              style={{flex:1,padding:"10px 8px",borderRadius:10,cursor:"pointer",
                border:`1.5px solid ${period===p.k?"#c8f135":T.line}`,
                background:period===p.k?"#1e2a00":T.paper,
                color:period===p.k?"#c8f135":T.inkMid,
                fontSize:"0.78rem",fontWeight:period===p.k?700:400,transition:"all .15s"}}>
              {p.l}
            </button>
          ))}
        </div>

        {/* Stats preview */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          {[
            {v:totalSessions,l:"Sessions",c:T.slate},
            {v:totalMiles>0?`${totalMiles} mi`:"—",l:"Miles",c:T.blue},
            {v:totalMin>60?`${Math.round(totalMin/60)}h ${totalMin%60}m`:totalMin+"m",l:"Active time",c:T.green},
            {v:streak>0?`${streak} days`:"—",l:"Current streak",c:T.purple},
          ].map((st,i)=>(
            <div key={i} style={{background:T.paperAlt,borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1.6rem",fontWeight:800,color:st.c,lineHeight:1}}>{st.v}</div>
              <div style={{fontSize:"0.6rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.08em",marginTop:4}}>{st.l}</div>
            </div>
          ))}
        </div>

        <canvas ref={canvasRef} style={{display:"none"}}/>

        <div style={{display:"flex",gap:10}}>
          <Btn full v="outline" onClick={generate}>Preview</Btn>
          <Btn full onClick={download}>⬇ Download</Btn>
        </div>

        {generated&&<div style={{marginTop:12,borderRadius:10,overflow:"hidden",border:`1px solid ${T.line}`}}>
          <canvas ref={canvasRef} style={{width:"100%",height:"auto",display:"block"}}/>
        </div>}
      </Card>
    </div>
  );
}

// ─── Weekly Planning ─────────────────────────────────────
function WeeklyPlan({s, D, toast}) {
  const today = _getToday();
  const wkDays = getWk();

  // ISO week key e.g. "2025-W15"
  const wkKey = (()=>{
    const d=new Date();
    const jan4=new Date(d.getFullYear(),0,4);
    const wk=Math.ceil(((d-jan4)/86400000+jan4.getDay()+1)/7);
    return `${d.getFullYear()}-W${String(wk).padStart(2,"0")}`;
  })();

  const plan = (s.weeklyPlan||{})[wkKey] || {};
  const [editing, setEditing] = useState(null); // {dow, items}
  const [newItem, setNewItem] = useState({type:"🏃 Run",name:"",notes:""});

  const dayLabels=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  return (
    <div className="fu">
      <div style={{padding:"4px 0 18px"}}>
        <h1 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
          color:T.ink,letterSpacing:"0.04em",textTransform:"uppercase"}}>Week Plan</h1>
        <p style={{fontSize:"0.78rem",color:T.inkLight,marginTop:4}}>
          Sketch your intended week. Compare planned vs actual.
        </p>
      </div>

      {wkDays.map((date,i)=>{
        const dow = new Date(date+"T12:00").getDay();
        const dayPlan = plan[dow] || [];
        const actual  = s.workouts.filter(w=>w.date===date);
        const isToday = date===today;
        const isPast  = date<today;

        return (
          <Card key={date} style={{marginBottom:10,border:`1px solid ${isToday?"#c8f135":T.line}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div>
                <div style={{fontWeight:700,fontSize:"0.9rem",color:isToday?"#c8f135":T.ink,display:"flex",alignItems:"center",gap:8}}>
                  {dayLabels[dow]}
                  {isToday&&<span style={{fontSize:"0.6rem",color:"#c8f135",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>today</span>}
                </div>
                <div style={{fontSize:"0.68rem",color:T.inkLight}}>{fmtD(date)}</div>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                {actual.length>0&&<Pill color="sage">{actual.length} done</Pill>}
                <Btn sm v="outline" onClick={()=>setEditing({dow,items:[...dayPlan]})}>
                  {dayPlan.length>0?"Edit":"+ Plan"}
                </Btn>
              </div>
            </div>

            {/* Planned items */}
            {dayPlan.length>0&&<div style={{marginBottom:actual.length>0?8:0}}>
              {dayPlan.map((item,j)=>(
                <div key={j} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",
                  borderBottom:j<dayPlan.length-1?`1px solid ${T.lineSoft}`:"none"}}>
                  <span style={{fontSize:"0.9rem"}}>{item.type.split(" ")[0]}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:"0.82rem",color:T.inkMid,fontWeight:500}}>{item.name||item.type}</div>
                    {item.notes&&<div style={{fontSize:"0.7rem",color:T.inkLight}}>{item.notes}</div>}
                  </div>
                  {/* Check if actually done */}
                  {actual.some(w=>w.type===item.type)&&
                    <span style={{color:T.green,fontSize:"0.9rem"}}>✓</span>}
                </div>
              ))}
            </div>}

            {/* Actual sessions if different from plan */}
            {actual.length>0&&dayPlan.length===0&&<div>
              {actual.map(w=>(
                <div key={w.id} style={{fontSize:"0.78rem",color:T.inkMid,padding:"4px 0",
                  display:"flex",alignItems:"center",gap:6}}>
                  <span>{w.type.split(" ")[0]}</span>
                  <span style={{color:T.green}}>✓ {w.name}</span>
                  {hasDur(w.dur)&&<span style={{color:T.inkLight}}>{w.dur}m</span>}
                </div>
              ))}
            </div>}

            {dayPlan.length===0&&actual.length===0&&
              <div style={{fontSize:"0.76rem",color:T.inkMid,fontWeight:500}}>
                {isPast?"Rest day":"Nothing planned"}
              </div>}
          </Card>
        );
      })}

      {/* Week summary */}
      {(()=>{
        const plannedCount=Object.values(plan).flat().length;
        const actualCount=s.workouts.filter(w=>wkDays.includes(w.date)).length;
        if(!plannedCount&&!actualCount) return null;
        return (
          <Card style={{marginTop:4,background:`linear-gradient(135deg,${T.paperAlt},${T.paper})`}}>
            <Sec>Week summary</Sec>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,color:T.slate}}>{plannedCount}</div>
                <div style={{fontSize:"0.62rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.08em"}}>Planned</div>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"2rem",fontWeight:900,
                  color:actualCount>=plannedCount&&plannedCount>0?T.green:T.ink}}>{actualCount}</div>
                <div style={{fontSize:"0.62rem",color:T.inkLight,textTransform:"uppercase",letterSpacing:"0.08em"}}>Done</div>
              </div>
            </div>
          </Card>
        );
      })()}

      {/* Edit day modal */}
      <Modal open={!!editing} onClose={()=>setEditing(null)}
        title={editing?`${dayLabels[editing.dow]} — plan`:"Plan"}>
        {editing&&<>
          <div style={{marginBottom:12}}>
            {editing.items.map((item,j)=>(
              <div key={j} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",
                borderBottom:`1px solid ${T.lineSoft}`}}>
                <span style={{fontSize:"1rem"}}>{item.type.split(" ")[0]}</span>
                <div style={{flex:1,fontSize:"0.84rem",color:T.ink}}>{item.name||item.type}</div>
                <button onClick={()=>setEditing(p=>({...p,items:p.items.filter((_,k)=>k!==j)}))}
                  style={{background:"none",border:"none",color:T.inkLight,cursor:"pointer",padding:"4px 8px",fontSize:"0.9rem",minHeight:36}}>✕</button>
              </div>
            ))}
            {editing.items.length===0&&<p style={{fontSize:"0.8rem",color:T.inkMid,fontWeight:500}}>No sessions planned yet.</p>}
          </div>
          <Sec>Add session</Sec>
          <FL label="Type"><Sel value={newItem.type} onChange={e=>setNewItem(p=>({...p,type:e.target.value}))}>
            {WORKOUT_TYPES.map(t=><option key={t}>{t}</option>)}
          </Sel></FL>
          <FL label="Label (optional)"><Inp value={newItem.name} onChange={e=>setNewItem(p=>({...p,name:e.target.value}))} placeholder="Long run, Upper body…"/></FL>
          <div style={{display:"flex",gap:10,marginTop:4}}>
            <Btn full v="outline" onClick={()=>{
              setEditing(p=>({...p,items:[...p.items,{...newItem}]}));
              setNewItem(p=>({...p,name:"",notes:""}));
            }}>+ Add</Btn>
            <Btn full onClick={()=>{
              D({t:"SET_PLAN",wk:wkKey,dow:editing.dow,items:editing.items});
              setEditing(null);
              haptic("success");
              toast("Plan saved ✓");
            }}>Save plan</Btn>
          </div>
        </>}
      </Modal>
    </div>
  );
}

function Connect({s,D,toast}) {
  const [step,setStep]=useState("upload");
  const [parsed,setParsed]=useState([]);
  const [progress,setProgress]=useState(0);
  const [parseErr,setParseErr]=useState("");
  const [selected,setSelected]=useState({});
  const [fType,setFType]=useState("all");
  const [fYear,setFYear]=useState("all");
  const [hideShort,setHideShort]=useState(true);
  const [showCount,setShowCount]=useState(50);
  const [imp,setImp]=useState({name:"",type:"🏃 Run",dur:"",dist:"",cals:"",hr:""});
  const [jsonTab,setJsonTab]=useState(false);
  const [jsonErr,setJsonErr]=useState("");
  const [jsonPrev,setJsonPrev]=useState([]);
  const fileRef=useRef(null);
  const jsonRef=useRef(null);
  // Dedup on date+dur (type-agnostic) so a re-import with a corrected type replaces not duplicates
  const existingKeys=new Set((s.workouts||[]).map(w=>`${w.date}|${w.dur}`));
  // Full key for exact match (used as fallback)
  const existingFull=new Set((s.workouts||[]).map(w=>`${w.date}|${w.type}|${w.dur}`));
  const isDupe=w=>existingKeys.has(`${w.date}|${w.dur}`);

  // ── Health Auto Export + Shortcut JSON import ─────────────
  const _haeDate = v => {
    if (!v) return TODAY;
    const m = String(v).match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : TODAY;
  };
  const _haeDist = (obj, units) => {
    if (!obj) return "";
    const qty = parseFloat(obj.qty||obj||0); if (!qty) return "";
    const u = (units||obj.units||"mi").toLowerCase();
    return String(u==="km"?Math.round(qty*0.621371*100)/100:Math.round(qty*100)/100);
  };
  const _haeCals = obj => {
    if (!obj) return 0;
    const qty = parseFloat(obj.qty||obj||0); if (!qty) return 0;
    const u = (obj.units||"kcal").toLowerCase();
    // Convert kJ to kcal if needed
    return Math.round(u==="kj"?qty*0.239006:qty);
  };
  const _haeHR = obj => {
    if (!obj) return "";
    // v2: {avg:{qty,units}} or {qty,units}; v1: {qty,units}
    const avg = obj.avg||obj;
    const qty = parseFloat(avg.qty||avg||0);
    return qty>0?String(Math.round(qty)):"";
  };
  const _haeDurSec = v => {
    // HAE v2 gives duration in seconds
    const n = parseFloat(v||0); if (!n) return "";
    return n>300?String(Math.round(n/60)):String(Math.round(n));
  };

  // Normalise a single workout object from any supported format:
  // - Health Auto Export v2  (data.workouts[])
  // - Health Auto Export v1  (data.workouts[] legacy)
  // - Simple Shortcut JSON   (single object or array)
  const _normaliseWorkout = (raw, idx) => {
    if (!raw||typeof raw!=="object") return null;

    // ── Detect HAE v2 (has "start" ISO string + duration in seconds) ──
    const isHAEv2 = raw.start && typeof raw.duration === "number";
    // ── Detect HAE v1 (has "start" string, no numeric duration) ──
    const isHAEv1 = raw.start && !isHAEv2;

    let type, date, durMin, distMi, cals, hr, srcName;

    if (isHAEv2 || isHAEv1) {
      type    = _mapType(raw.name||""); // HAE uses plain English name like "Running"
      // If _mapType returns Other, try matching the name directly
      if (type==="✦ Other") {
        const nm=(raw.name||"").toLowerCase();
        const nameMap={"running":"🏃 Run","outdoor run":"🏃 Run","indoor run":"🏃 Run","cycling":"🚴 Ride","outdoor cycling":"🚴 Ride","indoor cycling":"🚴 Ride","outdoor bike ride":"🚴 Ride","bike ride":"🚴 Ride","walking":"🚶 Walk","outdoor walk":"🚶 Walk","hiking":"🥾 Hike","swimming":"🏊 Swim","open water swimming":"🏊 Swim","pool swimming":"🏊 Swim","yoga":"🧘 Yoga","hiit":"🥊 HIIT","strength training":"🏋️ Strength","functional strength training":"🏋️ Strength","traditional strength training":"🏋️ Strength","pilates":"🧘 Yoga","elliptical":"🥊 HIIT","stair climbing":"🥊 HIIT","cross training":"🏋️ Strength","snowboarding":"🏂 Snow","skiing":"⛷️ Ski","golf":"⛳ Golf","mixed cardio":"🥊 HIIT","rowing":"🚣 Row","tennis":"🎾 Tennis","basketball":"🏀 Ball","soccer":"⚽ Soccer","football":"🏈 Football"};
        type=nameMap[nm]||"✦ Other";
      }
      date    = _haeDate(raw.start);
      durMin  = isHAEv2 ? _haeDurSec(raw.duration) : (() => {
        // v1: compute from start/end
        if (raw.start&&raw.end){const s=new Date(raw.start),e=new Date(raw.end);const m=Math.round((e-s)/60000);return m>0?String(m):"";}
        return "";
      })();
      distMi  = _haeDist(raw.distance);
      cals    = _haeCals(raw.activeEnergyBurned||raw.activeEnergy||raw.totalEnergy);
      hr      = _haeHR(raw.avgHeartRate||raw.heartRate);
      srcName = "Health Auto Export";
    } else {
      // Simple Shortcut / generic JSON
      const normT = r => {
        if (!r) return "✦ Other";
        if (r.startsWith("HK")) return _mapType(r);
        const m={"running":"🏃 Run","cycling":"🚴 Ride","walking":"🚶 Walk","functional strength training":"🏋️ Strength","traditional strength training":"🏋️ Strength","strength training":"🏋️ Strength","hiit":"🥊 HIIT","high intensity interval training":"🥊 HIIT","mixed cardio":"🥊 HIIT","swimming":"🏊 Swim","hiking":"🥾 Hike","yoga":"🧘 Yoga","pilates":"🧘 Yoga","dance":"🧘 Yoga","elliptical":"🥊 HIIT","stair climbing":"🥊 HIIT","cross training":"🏋️ Strength","snowboarding":"🏂 Snow","golf":"⛳ Golf","other":"✦ Other"};
        return m[r.toLowerCase()]||"✦ Other";
      };
      type    = normT(raw.type||raw.workoutType||raw.activityType||"");
      date    = _haeDate(raw.date||raw.startDate||raw.start_date||raw.start||"");
      const rawDur = raw.dur||raw.duration||raw.durationMinutes||"";
      const durN = parseFloat(String(rawDur).replace(/[^\d.]/g,""));
      durMin  = isNaN(durN)||!durN?"":durN>300?String(Math.round(durN/60)):String(Math.round(durN));
      const rawDist = raw.dist||raw.distance||raw.distanceMiles||raw.distanceKm||"";
      const distN = parseFloat(String(rawDist).replace(/[^\d.]/g,""));
      const distKm = String(rawDist).toLowerCase().includes("km");
      distMi  = isNaN(distN)||!distN?"":distKm?String(Math.round(distN*0.621371*100)/100):String(Math.round(distN*100)/100);
      cals    = Math.round(parseFloat(raw.cals||raw.calories||raw.activeEnergyBurned||0))||0;
      hr      = String(Math.round(parseFloat(raw.hr||raw.heartRate||raw.avgHR||raw.averageHeartRate||0))||"");
      srcName = raw.source||raw.sourceName||"Shortcut";
    }

    // Auto-calculate pace for all import paths
    const _durN  = parseFloat(durMin||0);
    const _distN = parseFloat(distMi||0);
    let pace = raw.pace||"";
    if ((!pace||pace==="0") && _distN>0 && _durN>0) {
      const mpm = _durN/_distN;
      const pm=Math.floor(mpm), ps=Math.round((mpm-pm)*60);
      pace=`${pm}:${String(ps).padStart(2,"0")}/mi`;
    }

    const typeName = type.split(" ").slice(1).join(" ")||"Workout";
    const dateLabel = new Date(date+"T12:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"});

    return {
      id:`${date}_${type}_${durMin}_hae`,
      name:`${typeName} · ${dateLabel}`,
      type, dur:String(durMin||""), dist:String(distMi||""),
      cals, hr:String(hr||""), pace,
      notes:`Imported from ${srcName}`,
      date, source:"healthautoexport",
    };
  };

  const handleJsonFile = async e => {
    const file = e.target.files?.[0]; if (!file) return;
    setJsonErr("");
    try {
      const text = await file.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error("Invalid JSON file. Make sure you exported as JSON from Health Auto Export."); }

      // Unwrap Health Auto Export envelope: { data: { workouts: [...] } }
      let workouts = [];
      if (parsed?.data?.workouts?.length)      workouts = parsed.data.workouts;
      else if (Array.isArray(parsed?.workouts)) workouts = parsed.workouts;
      else if (Array.isArray(parsed))           workouts = parsed;
      else if (parsed?.data && Array.isArray(parsed.data)) workouts = parsed.data;
      else workouts = [parsed]; // single workout object

      if (!workouts.length) throw new Error("No workouts found. Make sure 'Export Workouts' is enabled in Health Auto Export.");

      const normalised = workouts.map((r,i) => _normaliseWorkout(r,i)).filter(Boolean);
      if (!normalised.length) throw new Error("Could not read any workouts from this file.");
      // Separate into new workouts and updates (same date+dur but type may have changed)
      const fresh   = normalised.filter(w => !isDupe(w));
      const updates = normalised.filter(w => isDupe(w) && !existingFull.has(`${w.date}|${w.type}|${w.dur}`));
      const all = [...fresh, ...updates];
      if (!all.length) { setJsonErr(`All ${normalised.length} workout${normalised.length!==1?"s":""} in this file are already in PULSE with the same type.`); return; }
      setJsonPrev(all);
      if(updates.length>0) setJsonErr(`ℹ️ ${updates.length} workout${updates.length!==1?"s":""} will be updated with a corrected type.`);
    } catch(err) { setJsonErr(err.message); }
    e.target.value = "";
  };

  const confirmJsonImport = () => {
    jsonPrev.forEach(w => {
      // If same date+dur exists with different type, remove old and add new
      if(isDupe(w) && !existingFull.has(`${w.date}|${w.type}|${w.dur}`)) {
        const old = s.workouts.find(x => x.date===w.date && x.dur===w.dur);
        if(old) D({t:"DEL_W", id:old.id});
      }
      D({t:"ADD_W", w});
    });
    const added   = jsonPrev.filter(w=>!isDupe(w)).length;
    const updated = jsonPrev.filter(w=>isDupe(w)).length;
    const msg = updated>0 ? `✓ ${added} added, ${updated} updated` : `✓ ${jsonPrev.length} imported!`;
    toast(msg);
    setJsonPrev([]);
    setJsonErr("");
  };

  const handleFile=async e=>{
    const file=e.target.files?.[0]; if(!file)return;
    if(!file.name.toLowerCase().endsWith(".xml")){setParseErr("Please select export.xml from your Apple Health zip.");return;}
    setParseErr("");setStep("parsing");setProgress(0);
    try {
      const {workouts:results,skipped}=await _streamXML(file,setProgress);
      if(!results.length)throw new Error("No workouts found. Make sure you're uploading export.xml.");
      const seen=new Set();
      const deduped=results.filter(w=>{if(seen.has(w.id))return false;seen.add(w.id);return true;}).sort((a,b)=>b.date.localeCompare(a.date));
      setParsed(deduped);
      const sel={};deduped.forEach(w=>{sel[w.id]=!isDupe(w);});
      setSelected(sel);setStep("review");
      if(skipped>0)setParseErr(`Note: ${skipped} workout${skipped!==1?"s":""} could not be parsed and were skipped.`);
    } catch(err){setParseErr(err.message||"Parsing failed.");setStep("upload");}
  };

  const importSelected=()=>{
    const toImport=parsed.filter(w=>selected[w.id]);
    if(!toImport.length){toast("Select at least one workout");return;}
    let added=0, updated=0;
    toImport.forEach(w=>{
      if(isDupe(w) && !existingFull.has(`${w.date}|${w.type}|${w.dur}`)){
        const old=s.workouts.find(x=>x.date===w.date&&x.dur===w.dur);
        if(old)D({t:"DEL_W",id:old.id});
        D({t:"ADD_W",w}); updated++;
      } else if(!isDupe(w)){
        D({t:"ADD_W",w}); added++;
      }
    });
    if(!added&&!updated){toast("All selected already imported");return;}
    setStep("done");
    toast(updated>0?`✓ ${added} added, ${updated} updated`:`✓ ${added} imported!`);
  };

  const vis=_visibleWorkouts(parsed,fType,fYear,hideShort);
  const visIds=vis.map(w=>w.id);
  const allVisSel=visIds.length>0&&visIds.every(id=>selected[id]);
  const toggleAll=()=>{const n={...selected};visIds.forEach(id=>n[id]=!allVisSel);setSelected(n);};
  const newCount=parsed.filter(w=>!isDupe(w)).length;
  const selCount=Object.values(selected).filter(Boolean).length;
  const years=[...new Set(parsed.map(w=>w.date.slice(0,4)))].sort().reverse();
  const tC={};parsed.forEach(w=>{tC[w._rawType]=(tC[w._rawType]||0)+1;});
  const fBtns=[
    {k:"all",l:`All (${parsed.length})`},
    {k:"HKWorkoutActivityTypeRunning",l:`🏃 Run (${tC["HKWorkoutActivityTypeRunning"]||0})`},
    {k:"HKWorkoutActivityTypeCycling",l:`🚴 Ride (${tC["HKWorkoutActivityTypeCycling"]||0})`},
    {k:"HKWorkoutActivityTypeWalking",l:`🚶 Walk (${tC["HKWorkoutActivityTypeWalking"]||0})`},
    {k:"HKWorkoutActivityTypeFunctionalStrengthTraining",l:`🏋️ Str (${(tC["HKWorkoutActivityTypeFunctionalStrengthTraining"]||0)+(tC["HKWorkoutActivityTypeTraditionalStrengthTraining"]||0)})`},
    {k:"HKWorkoutActivityTypeSwimming",l:`🏊 Swim (${tC["HKWorkoutActivityTypeSwimming"]||0})`},
    {k:"HKWorkoutActivityTypeHighIntensityIntervalTraining",l:`🥊 HIIT (${tC["HKWorkoutActivityTypeHighIntensityIntervalTraining"]||0})`},
  ];

  return (
    <div className="fu">
      <PH title="Import" sub="Upload workouts from Apple Health or Health Auto Export."/>
      {/* ── Health Auto Export JSON Import ── */}
      <Card style={{marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
          <div style={{width:42,height:42,borderRadius:12,background:"linear-gradient(135deg,#0a84ff,#bf5af2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.3rem",flexShrink:0}}>📤</div>
          <div>
            <div style={{fontWeight:700,fontSize:"0.95rem",color:T.ink}}>Health Auto Export</div>
            <div style={{fontSize:"0.78rem",color:T.inkLight,marginTop:2}}>Import workouts exported from the Health Auto Export app</div>
          </div>
        </div>

        <div style={{background:T.paperAlt,borderRadius:12,padding:14,marginBottom:14}}>
          <div style={{fontSize:"0.62rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.inkLight,marginBottom:10}}>How to export from Health Auto Export</div>
          {[
            "Open Health Auto Export on your iPhone",
            "Tap Export → select Workouts",
            "Set Format to JSON",
            "Tap Export and choose Share or Save to Files",
            "Come back here and tap Choose JSON file below",
          ].map((t,i)=>(
            <div key={i} style={{display:"flex",gap:10,marginBottom:8,alignItems:"flex-start"}}>
              <div style={{width:20,height:20,borderRadius:"50%",background:T.blue,color:"#fff",fontSize:"0.62rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{i+1}</div>
              <span style={{fontSize:"0.84rem",color:T.inkMid,lineHeight:1.5}}>{t}</span>
            </div>
          ))}
          <div style={{marginTop:10,padding:"10px 12px",background:T.blueL,borderRadius:10,fontSize:"0.76rem",color:T.blue,lineHeight:1.6}}>
            💡 <strong>Tip:</strong> For ongoing sync, set up an Automation in Health Auto Export to auto-export to iCloud Drive after each workout — then just upload here whenever you want to sync.
          </div>
        </div>

        <input ref={jsonRef} type="file" accept=".json" onChange={handleJsonFile} style={{display:"none"}}/>

        {jsonPrev.length===0 ? (
          <Btn full onClick={()=>jsonRef.current?.click()} style={{background:`linear-gradient(135deg,${T.blue},${T.purple})`,border:"none"}}>
            📂 Choose JSON file
          </Btn>
        ) : (
          <>
            <div style={{background:T.greenL,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
              <div style={{fontWeight:700,fontSize:"0.88rem",color:T.green,marginBottom:8}}>
                {jsonPrev.length} new workout{jsonPrev.length!==1?"s":""} ready to import
              </div>
              {jsonPrev.slice(0,5).map((w,i)=>(
                <div key={i} style={{fontSize:"0.78rem",color:T.inkMid,padding:"5px 0",borderBottom:i<Math.min(jsonPrev.length,5)-1?`1px solid ${T.lineSoft}`:"none"}}>
                  {w.type.split(" ")[0]} <strong>{w.name}</strong>
                  <span style={{color:T.inkLight,marginLeft:6}}>{w.dur&&w.dur!=="0"?w.dur+"m":""}{w.dist&&w.dist!=="0"?" · "+w.dist+"mi":""}{w.cals>0?" · "+w.cals+"cal":""}</span>
                </div>
              ))}
              {jsonPrev.length>5&&<div style={{fontSize:"0.72rem",color:T.inkLight,marginTop:6}}>+{jsonPrev.length-5} more…</div>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Btn full v="outline" onClick={()=>setJsonPrev([])}>Cancel</Btn>
              <Btn full onClick={confirmJsonImport} style={{background:`linear-gradient(135deg,${T.green},${T.blue})`,border:"none"}}>
                Import {jsonPrev.length}
              </Btn>
            </div>
          </>
        )}
        {jsonErr&&<div style={{marginTop:10,padding:"10px 14px",background:T.redL,borderRadius:10,fontSize:"0.82rem",color:T.red,lineHeight:1.5}}>{jsonErr}</div>}
      </Card>

      {/* ── Apple Health XML Import ── */}
      <Card style={{marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
          <div style={{width:42,height:42,borderRadius:12,background:"linear-gradient(135deg,#ff375f,#ff9f0a)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.3rem",flexShrink:0}}>🍎</div>
          <div>
            <div style={{fontWeight:700,fontSize:"0.95rem",color:T.ink}}>Apple Health Import</div>
            <div style={{fontSize:"0.78rem",color:T.inkLight,marginTop:2}}>Upload export.xml to import your full workout history</div>
          </div>
        </div>

        {step==="upload"&&<>
          <div style={{background:T.paperAlt,borderRadius:12,padding:14,marginBottom:16}}>
            <div style={{fontSize:"0.62rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.inkLight,marginBottom:10}}>How to export from Apple Health</div>
            {["Open the Health app on your iPhone","Tap your profile photo (top right)","Tap Export All Health Data","Tap Export — creates a .zip file","Unzip it and find export.xml inside","Upload that file below"].map((t,i)=>(
              <div key={i} style={{display:"flex",gap:10,marginBottom:8,alignItems:"flex-start"}}>
                <div style={{width:20,height:20,borderRadius:"50%",background:T.blue,color:"#fff",fontSize:"0.62rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{i+1}</div>
                <span style={{fontSize:"0.84rem",color:T.inkMid,lineHeight:1.5}}>{t}</span>
              </div>
            ))}
          </div>
          <input ref={fileRef} type="file" accept=".xml" onChange={handleFile} style={{display:"none"}}/>
          <Btn full onClick={()=>fileRef.current?.click()} style={{background:`linear-gradient(135deg,${T.blue},${T.purple})`,border:"none"}}>
            📁 Choose export.xml
          </Btn>
          {parseErr&&<div style={{marginTop:10,padding:"10px 14px",background:T.redL,borderRadius:10,fontSize:"0.82rem",color:T.red,lineHeight:1.5}}>{parseErr}</div>}
        </>}

        {step==="parsing"&&(
          <div style={{textAlign:"center",padding:"28px 0"}}>
            <div style={{fontSize:"2.4rem",marginBottom:12}}>⏳</div>
            <div style={{fontWeight:700,color:T.ink,marginBottom:6}}>Reading your health data…</div>
            <div style={{fontSize:"0.78rem",color:T.inkLight,marginBottom:18}}>
              Found <strong style={{color:T.blue}}>{progress}</strong> workouts so far
            </div>
            <div style={{height:6,background:T.lineSoft,borderRadius:99,overflow:"hidden",maxWidth:240,margin:"0 auto"}}>
              <div style={{height:"100%",width:"60%",background:`linear-gradient(90deg,${T.blue},${T.purple})`,borderRadius:99}}/>
            </div>
          </div>
        )}

        {step==="review"&&<>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
            {[{v:parsed.length,l:"found",c:T.blue},{v:newCount,l:"new",c:T.green},{v:selCount,l:"selected",c:T.purple}].map(x=>(
              <div key={x.l} style={{background:T.paperAlt,borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                <div style={{fontSize:"1.4rem",fontWeight:800,color:x.c,lineHeight:1}}>{x.v}</div>
                <div style={{fontSize:"0.56rem",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.inkLight,marginTop:4}}>{x.l}</div>
              </div>
            ))}
          </div>

          <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:6,marginBottom:10,WebkitOverflowScrolling:"touch"}}>
            {fBtns.map(f=>(
              <button key={f.k} onClick={()=>{setFType(f.k);setShowCount(50);}}
                style={{background:fType===f.k?T.blue:"transparent",color:fType===f.k?"#fff":T.inkMid,border:`1px solid ${fType===f.k?T.blue:T.line}`,borderRadius:20,fontSize:"0.73rem",fontWeight:500,padding:"6px 12px",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                {f.l}
              </button>
            ))}
          </div>

          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
            <select value={fYear} onChange={e=>setFYear(e.target.value)}
              style={{border:`1px solid ${T.line}`,borderRadius:8,padding:"6px 10px",fontSize:"0.78rem",color:T.inkMid,background:T.paper,outline:"none"}}>
              <option value="all">All years</option>
              {years.map(y=><option key={y} value={y}>{y}</option>)}
            </select>
            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:"0.76rem",color:T.inkMid,cursor:"pointer"}}>
              <input type="checkbox" checked={hideShort} onChange={e=>setHideShort(e.target.checked)} style={{width:"auto"}}/>
              Hide short walks
            </label>
            <span style={{marginLeft:"auto",fontSize:"0.72rem",color:T.inkLight}}>{vis.length} shown</span>
          </div>

          <div style={{display:"flex",gap:8,marginBottom:10}}>
            <Btn sm v="outline" onClick={toggleAll} style={{flex:1}}>{allVisSel?"Deselect visible":"Select visible"}</Btn>
            <Btn sm v="outline" onClick={()=>{setStep("upload");setParsed([]);setSelected({});}}>Cancel</Btn>
          </div>

          <div style={{maxHeight:380,overflowY:"auto",borderRadius:10,border:`1px solid ${T.line}`,marginBottom:14}}>
            {vis.slice(0,showCount).map((w,i,arr)=>{
              const isSel=!!selected[w.id];
              const already=isDupe(w);
              return (
                <div key={w.id} onClick={()=>!already&&setSelected(p=>({...p,[w.id]:!p[w.id]}))}
                  style={{display:"flex",alignItems:"center",gap:11,padding:"11px 13px",borderBottom:i<arr.length-1?`1px solid ${T.lineSoft}`:"none",cursor:already?"default":"pointer",background:already?T.paperAlt:isSel?T.blueL:T.paper,opacity:already?0.5:1,transition:"background .12s"}}>
                  <div style={{width:20,height:20,borderRadius:6,border:`2px solid ${already?T.line:isSel?T.blue:T.line}`,background:already?T.lineSoft:isSel?T.blue:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {(isSel||already)&&<span style={{color:already?T.inkLight:"#fff",fontSize:"0.65rem",fontWeight:800}}>{already?"●":"✓"}</span>}
                  </div>
                  <span style={{fontSize:"1.1rem",lineHeight:1,flexShrink:0}}>{w.type.split(" ")[0]}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:500,fontSize:"0.85rem",color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {w.name}{already&&<span style={{marginLeft:6,fontSize:"0.65rem",color:T.inkLight}}>(already imported)</span>}
                    </div>
                    <div style={{fontSize:"0.67rem",color:T.inkLight,marginTop:2,fontFamily:"monospace",display:"flex",gap:7}}>
                      {hasDur(w.dur)&&<span>{w.dur}m</span>}
                      {hasDist(w.dist)&&<span>{w.dist}mi</span>}
                      {w.cals>0&&<span>{w.cals}cal</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            {vis.length>showCount&&(
              <div onClick={()=>setShowCount(n=>n+100)}
                style={{padding:12,textAlign:"center",fontSize:"0.8rem",color:T.blue,cursor:"pointer",borderTop:`1px solid ${T.lineSoft}`,fontWeight:600}}>
                Show more ({vis.length-showCount} remaining)
              </div>
            )}
          </div>
          <Btn full onClick={importSelected} style={{background:`linear-gradient(135deg,${T.green},${T.blue})`,border:"none"}}>
            Import {selCount} workout{selCount!==1?"s":""}
          </Btn>
        </>}

        {step==="done"&&(
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:"3rem",marginBottom:10}}>✅</div>
            <div style={{fontWeight:700,fontSize:"1rem",color:T.ink,marginBottom:6}}>Import complete!</div>
            <div style={{fontSize:"0.84rem",color:T.inkLight,marginBottom:20}}>Your Apple Health workouts are now in PULSE.</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Btn full v="outline" onClick={()=>setStep("review")}>Back to list</Btn>
              <Btn full v="ghost" onClick={()=>{setStep("upload");setParsed([]);setSelected({});}}>Import more</Btn>
            </div>
          </div>
        )}
      </Card>



      <Card style={{marginBottom:14}}>
        <Sec>Backup & Restore</Sec>
        <div style={{fontSize:"0.82rem",color:T.inkMid,lineHeight:1.6,marginBottom:14}}>
          Export all your PULSE data (workouts, meals, recipes, goals, water) as a JSON backup file. Import it on any device to restore.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Btn full v="ghost" onClick={()=>{
            const data=JSON.stringify(s,null,2);
            const blob=new Blob([data],{type:"application/json"});
            const url=URL.createObjectURL(blob);
            const a=document.createElement("a");
            a.href=url;
            a.download=`pulse-backup-${TODAY}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast("Backup downloaded ✓");
          }}>⬇ Export backup</Btn>
          <Btn full v="outline" onClick={()=>document.getElementById("pulse-restore-input").click()}>⬆ Restore backup</Btn>
        </div>
        <input id="pulse-restore-input" type="file" accept=".json" style={{display:"none"}} onChange={async e=>{
          const file=e.target.files?.[0]; if(!file)return;
          try{
            const text=await file.text();
            const data=JSON.parse(text);
            if(!data.workouts||!data.meals)throw new Error("Invalid backup file");
            const restored={...INIT,...data};
            D({t:"RESTORE",state:restored});
            toast("Backup restored ✓");
          }catch(err){toast("Invalid backup file");}
          e.target.value="";
        }}/>
      </Card>

      <Card>
        <Sec>Add a single past workout</Sec>
        <FL label="Activity name"><Inp value={imp.name} onChange={e=>setImp(p=>({...p,name:e.target.value}))} placeholder="Morning Run"/></FL>
        <FL label="Sport"><Sel value={imp.type} onChange={e=>setImp(p=>({...p,type:e.target.value}))}>{WORKOUT_TYPES.map(t=><option key={t}>{t}</option>)}</Sel></FL>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Duration (min)"><Inp type="number" value={imp.dur} onChange={e=>setImp(p=>({...p,dur:e.target.value}))}/></FL>
          <FL label="Distance (mi)"><Inp value={imp.dist} onChange={e=>setImp(p=>({...p,dist:e.target.value}))}/></FL>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <FL label="Calories"><Inp type="number" value={imp.cals} onChange={e=>setImp(p=>({...p,cals:e.target.value}))}/></FL>
          <FL label="Avg HR"><Inp type="number" value={imp.hr} onChange={e=>setImp(p=>({...p,hr:e.target.value}))}/></FL>
        </div>
        <Btn full v="secondary" onClick={()=>{
          if(!imp.name.trim()){toast("Enter a name");return;}
          D({t:"ADD_W",w:{...imp,id:Date.now(),pace:"",notes:"Manually added",date:TODAY,source:"manual"}});
          setImp({name:"",type:"🏃 Run",dur:"",dist:"",cals:"",hr:""});
          toast("Added ✓");
        }}>Add workout</Btn>
      </Card>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────
function App() {
  const [state, DR] = useState(loadState);
  const [page, setPage] = useState("dashboard");
  const [showMore, setShowMore] = useState(false);
  const [ts, setTs] = useState({msg:"",v:false});
  const tRef = useRef(null);
  // Persistent nutrition state — survives tab switches
  const [nutDate, setNutDate] = useState(_getToday());
  const [nutTab, setNutTab] = useState("today");

  const [storageErr, setStorageErr] = useState(false);
  const D = useCallback(action => {
    DR(prev => {
      const next = reduce(prev, action);
      saveState(next, () => setStorageErr(true));
      return next;
    });
  }, []);

  const undoRef = useRef(null);
  const toast = (msg, undoFn=null) => {
    if (tRef.current) clearTimeout(tRef.current);
    if (undoRef.current) undoRef.current = null; // clear any pending undo
    setTs({msg, v:true, undo:undoFn});
    tRef.current = setTimeout(() => setTs(p => ({...p, v:false, undo:null})), undoFn?5000:2200);
    if (undoFn) undoRef.current = undoFn;
  };

  const goPage = id => { setPage(id); setShowMore(false); };

  // Compute insights once per render cycle — shared across all InlineTip instances
  const sharedInsights = useMemo(()=>buildInsights(state,"week"),
    [state.workouts, state.meals, state.water, state.macroGoals]);

  // Lazy render — only mount the active page, avoiding construction of all 9 components
  const activePage = useMemo(()=>{
    const p = showMore ? null : page;
    const si = sharedInsights;
    switch(p) {
      case "dashboard": return <Dashboard s={state} D={D} toast={toast} insights={si}/>;
      case "workouts":  return <Workouts  s={state} D={D} toast={toast} insights={si}/>;
      case "nutrition": return <NutritionBoundary><Nutrition s={state} D={D} toast={toast} nutDate={nutDate} setNutDate={setNutDate} nutTab={nutTab} setNutTab={setNutTab} insights={si}/></NutritionBoundary>;;
      case "recipes":    return <Recipes    s={state} D={D} toast={toast}/>;
      case "water":      return <Water      s={state} D={D} toast={toast}/>;
      case "goals":      return <Goals      s={state} D={D} toast={toast}/>;
      case "weekly":     return <Weekly     s={state}/>;
      case "ai":         return <AICoach    s={state} insights={si}/>;
      case "connect":    return <Connect    s={state} D={D} toast={toast}/>;
      case "bodyweight":  return <BodyWeight     s={state} D={D} toast={toast}/>;
      case "injury":      return <InjuryFlags    s={state} D={D} toast={toast}/>;
      case "dayjournal":  return <RestJournal    s={state} D={D} toast={toast}/>;
      case "profile":     return <ProfilePage    s={state} D={D} toast={toast}/>;
      case "search":      return <GlobalSearch   s={state} D={D} toast={toast} goPage={goPage}/>;
      case "heatmap":     return <ActivityHeatmap s={state}/>;
      case "challenges":  return <ChallengesPage s={state} D={D} toast={toast}/>;
      case "weeklyplan":  return <WeeklyPlan     s={state} D={D} toast={toast}/>;
      default:            return <Dashboard      s={state} D={D} toast={toast} insights={si}/>;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, showMore, state, sharedInsights, nutDate, nutTab]);

  const activeTab = ["dashboard","workouts","nutrition"].includes(page) ? page : "more";

  // Show onboarding on first launch
  if (!state.onboarded) {
    return <Onboarding D={D}/>;
  }

  return (
    <div className={state.theme==="light"?"light-mode":""} style={{maxWidth:430,margin:"0 auto",minHeight:"100vh",background:"var(--bg)",display:"flex",flexDirection:"column",position:"relative"}}>
      <style>{G_CSS}</style>

      {/* Storage error banner */}
      {storageErr&&<div style={{background:"#ff375f",color:"#fff",padding:"10px 18px",fontSize:"0.8rem",fontWeight:600,textAlign:"center",position:"sticky",top:0,zIndex:101}}>
        ⚠️ Storage full — data may not be saving. Export a backup in Import tab.
        <button onClick={()=>setStorageErr(false)} style={{background:"none",border:"none",color:"#fff",marginLeft:12,cursor:"pointer",fontSize:"1rem"}}>✕</button>
      </div>}

      {/* Top bar */}
      <div style={{background:T.paper,borderBottom:`1px solid ${T.line}`,padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,flexShrink:0,backdropFilter:"blur(20px)"}}>
        <div style={{fontFamily:"'Barlow Condensed','DM Sans',sans-serif",fontSize:"1.35rem",fontWeight:900,color:"#c8f135",letterSpacing:"0.18em",textTransform:"uppercase"}}>
          PULSE
        </div>
        <div style={{fontSize:"0.72rem",color:T.inkLight,fontWeight:500,letterSpacing:"0.04em"}}>
          {new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}).toUpperCase()}
        </div>
      </div>

      {/* Page content */}
      <div style={{flex:1,overflowY:"auto",padding:"0 18px",paddingBottom:90,contain:"layout style"}}>
        {showMore ? (
          <div className="fu">
            <div style={{padding:"20px 0 16px"}}>
              <h1 style={{fontFamily:"'Barlow Condensed','DM Sans',sans-serif",fontSize:"2rem",fontWeight:900,color:T.ink,letterSpacing:"0.01em",textTransform:"uppercase"}}>More</h1>
            </div>
            {MORE_PAGES.map((p,i)=>{
              const colors=[T.purple,T.blue,T.orange,T.green,T.red,T.orange];
              const ac=colors[i%colors.length];
              return (
              <div key={p.id} onClick={()=>goPage(p.id)} className="pressable" style={{background:T.paper,border:`1px solid ${T.line}`,borderRadius:14,padding:"14px 16px",marginBottom:8,display:"flex",alignItems:"center",gap:14,cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,.4)"}}>
                <div style={{width:42,height:42,borderRadius:13,background:ac+"18",border:`1px solid ${ac}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.2rem",flexShrink:0}}>{p.icon}</div>
                <div style={{fontWeight:600,fontSize:"0.92rem",color:T.ink,letterSpacing:"0.01em"}}>{p.label}</div>
                <svg style={{marginLeft:"auto"}} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.inkLight} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            );})}
          </div>
        ) : activePage}
      </div>

      {/* Bottom tab bar */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:T.paper,borderTop:`1px solid ${T.line}`,display:"flex",zIndex:100,paddingBottom:"env(safe-area-inset-bottom,0px)",backdropFilter:"blur(20px)"}}>
        {TABS.map(tab=>{
          const isActive = (showMore&&tab.id==="more") || (!showMore&&activeTab===tab.id);
          const accent = "#c8f135";
          return (
            <button key={tab.id} aria-label={tab.label} aria-current={isActive?"page":undefined} onClick={()=>{ if(tab.id==="more"){setShowMore(!showMore);}else{goPage(tab.id);}}}
              style={{flex:1,background:"none",border:"none",padding:"10px 4px 8px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,minHeight:54,position:"relative",transition:"opacity .12s"}}>
              {isActive&&<div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:28,height:2,borderRadius:"0 0 2px 2px",background:"#c8f135"}}/>}
              <div style={{opacity:isActive?1:.45,transition:"opacity .15s"}}>
                {TAB_ICONS[tab.id]?.(isActive, isActive?"#c8f135":T.inkLight)}
              </div>
              <span style={{fontSize:"0.58rem",fontWeight:isActive?700:500,letterSpacing:"0.04em",textTransform:"uppercase",color:isActive?"#c8f135":T.inkLight,transition:"color .15s"}}>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <Toast msg={ts.msg} v={ts.v} undo={ts.undo?()=>{ts.undo();setTs(p=>({...p,v:false,undo:null}));}:null}/>
    </div>
  );
}

export default function PulseApp() {
  return <ErrorBoundary><App/></ErrorBoundary>;
}
