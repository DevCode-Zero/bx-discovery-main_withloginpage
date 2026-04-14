/* ─── STATE ─────────────────────────────────────────────────────────────────── */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, CURRENT_SESSION_ID } from './config.js';

let supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let questions = [];
let currentQ = 0;
let recognition = null;
let profile = {name:'',email:'',company:'',industry:'',stage:'',role:''};
let geoData = null;
let userId = getUserId();
let presenceInterval = null;
let pushedQuestion = null;

const MIC_SVG = `<svg class="mic-svg" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/* ─── USER ID ───────────────────────────────────────────────────────────────── */
function getUserId() {
  let id = localStorage.getItem('bx_user_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('bx_user_id', id);
  }
  return id;
}

/* ─── PRESENCE TRACKING ─────────────────────────────────────────────────────── */
async function updatePresence() {
  await supabase.from('participants').upsert({
    user_id: userId,
    session_id: CURRENT_SESSION_ID,
    last_seen: new Date().toISOString()
  }, { onConflict: 'user_id,session_id' });
}

async function trackPresence() {
  await updatePresence();
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = setInterval(updatePresence, 15000);
}

async function getParticipantCount() {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('participants')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', CURRENT_SESSION_ID)
    .gte('last_seen', fiveMinAgo);
  return count || 0;
}

/* ─── GEO LOOKUP ─────────────────────────────────────────────────────────────── */
(async function tryGeo() {
  const cached = sessionStorage.getItem('geoData');
  if (cached) {
    geoData = JSON.parse(cached);
    document.getElementById('geoText').textContent = `${geoData.city}, ${geoData.country}`;
    document.getElementById('geoBadge').classList.add('visible');
    return;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch('https://ipapi.co/json/', {signal: ctrl.signal});
    clearTimeout(timer);
    if (!r.ok) return;
    const d = await r.json();
    if (d.city && d.country_name) {
      geoData = {city: d.city, region: d.region, country: d.country_name, timezone: d.timezone};
      sessionStorage.setItem('geoData', JSON.stringify(geoData));
      document.getElementById('geoText').textContent = `${d.city}, ${d.country_name}`;
      document.getElementById('geoBadge').classList.add('visible');
    }
  } catch(e) { /* silently skip */ }
})();

/* ─── PROFILE ────────────────────────────────────────────────────────────────── */
function onProfileSelect() {
  const hasSelection = document.getElementById('pIndustry').value || document.getElementById('pStage').value;
  ['nameReq','emailReq','companyReq','industryReq','stageReq'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = hasSelection ? 'inline' : 'none';
  });
  ['nameOpt','emailOpt','companyOpt'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = hasSelection ? 'none' : 'inline';
  });
  const noteEl = document.getElementById('profileNote');
  const noteReqEl = document.getElementById('profileNoteRequired');
  if (noteEl) noteEl.style.display = hasSelection ? 'none' : 'block';
  if (noteReqEl) noteReqEl.style.display = hasSelection ? 'block' : 'none';
}

function toggleProfile() {
  const panel = document.getElementById('profilePanel');
  if (panel) panel.classList.toggle('open');
}

function saveProfile() {
  const industry = document.getElementById('pIndustry')?.value || '';
  const stage = document.getElementById('pStage')?.value || '';
  const hasSelection = industry || stage;
  const name = document.getElementById('pName')?.value.trim() || '';
  const email = document.getElementById('pEmail')?.value.trim() || '';
  const company = document.getElementById('pCompany')?.value.trim() || '';
  if (hasSelection && (!name || !email || !company)) {
    alert('Please fill in your name, work email, and company name to apply personalisation.');
    return;
  }
  profile = { name, email, company, industry, stage, role: document.getElementById('pRole')?.value || '' };
  const badge = document.getElementById('profileSavedBadge');
  if (badge) {
    badge.style.display = 'inline';
    setTimeout(() => { badge.style.display = 'none'; }, 2500);
  }
  if (hasSelection) {
    const teaser = document.getElementById('profileTeaser');
    if (teaser) teaser.style.display = 'none';
  }
}

/* ─── NAVIGATION ─────────────────────────────────────────────────────────────── */
function hideAllScreens() {
  const ws = document.getElementById('workshopScreen');
  if (ws) { ws.style.display = 'none'; ws.classList.remove('active'); }
  const summary = document.getElementById('summaryScreen');
  if (summary) summary.classList.remove('active');
  const lead = document.getElementById('leadScreen');
  if (lead) lead.classList.remove('active');
  const live = document.getElementById('liveQuestionScreen');
  if (live) live.classList.remove('active');
}

function showCard(idx) {
  hideAllScreens();
  const qArea = document.getElementById('questionArea');
  if (qArea) qArea.style.display = '';
  document.querySelectorAll('.question-card').forEach(c => c.classList.remove('active'));
  const card = document.querySelector(`.question-card[data-q="${idx}"]`);
  if (card) { void card.offsetWidth; card.classList.add('active'); }
  currentQ = idx;
  updateProgress(idx);
  window.scrollTo({top:0, behavior:'smooth'});
}

window.nextQ = function(idx) { if (idx < questions.length - 1) showCard(idx+1); else showSummary(); };
window.prevQ = function(idx) { if (idx > 0) showCard(idx-1); };

/* ─── PROGRESS ───────────────────────────────────────────────────────────────── */
function updateProgress(q) {
  document.querySelectorAll('.step-dot').forEach((d,i) => {
    d.classList.remove('done','active');
    if (i < q) d.classList.add('done');
    else if (i === q) d.classList.add('active');
  });
  const label = document.getElementById('progressLabel');
  if (label) {
    label.textContent = q < questions.length
      ? `Question ${q+1} of ${questions.length}`
      : 'Complete';
  }
}

/* ─── OPTIONS / PILLS ─────────────────────────────────────────────────────────── */
function attachOptionListeners() {
  document.querySelectorAll('.options-grid').forEach(grid => {
    const isMulti = grid.dataset.multi === 'true';
    const max = parseInt(grid.dataset.max) || 99;
    const qIdx = parseInt(grid.dataset.q);
    
    grid.querySelectorAll('.option-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const val = pill.dataset.value;
        if (!isMulti) {
          grid.querySelectorAll('.option-pill').forEach(p => p.classList.remove('selected'));
          pill.classList.add('selected');
          saveResponseByIndex(qIdx, [val]);
        } else {
          if (pill.classList.contains('selected')) {
            pill.classList.remove('selected');
          } else if (grid.querySelectorAll('.option-pill.selected').length < max) {
            pill.classList.add('selected');
          }
          const selections = Array.from(grid.querySelectorAll('.option-pill.selected')).map(p => p.dataset.value);
          saveResponseByIndex(qIdx, selections);
        }
      });
    });
  });
  
  document.querySelectorAll('.response-input').forEach((ta, i) => {
    ta.addEventListener('input', () => {
      saveResponseByIndex(i, [], ta.value);
    });
  });
}

function saveResponseByIndex(qIdx, selections, text = '') {
  const q = questions[qIdx];
  console.log('saveResponseByIndex:', qIdx, q, selections, text);
  if (!q || !q.id) {
    console.log('Question not found or no ID:', q);
    return;
  }
  const answer = { selections, text };
  console.log('Saving response:', q.id, answer);
  saveResponse(q.id, answer);
}

/* ─── SAVE RESPONSE ──────────────────────────────────────────────────────────── */
async function saveResponse(questionId, answerObj) {
  try {
    await supabase.from('responses').delete()
      .eq('session_id', CURRENT_SESSION_ID)
      .eq('question_id', questionId)
      .eq('user_id', userId);
    
    const { error } = await supabase.from('responses').insert({
      session_id: CURRENT_SESSION_ID,
      question_id: questionId,
      user_id: userId,
      answer: answerObj,
      created_at: new Date().toISOString()
    });
    
    if (error) console.error('Failed to save response:', error);
  } catch (err) {
    console.error('Save response error:', err);
  }
}

/* ─── LOAD QUESTIONS FROM DOM ─────────────────────────────────────────────────── */
function loadQuestionsFromDOM() {
  const cards = document.querySelectorAll('.question-card');
  questions = [];
  cards.forEach((card, i) => {
    const qText = card.querySelector('.q-text')?.textContent || '';
    const qTheme = card.querySelector('.q-theme')?.textContent || '';
    const grid = card.querySelector('.options-grid');
    const textarea = card.querySelector('.response-input');
    
    questions.push({
      id: null,
      text: qText,
      theme: qTheme,
      type: grid ? 'mcq' : 'text',
      index: i
    });
  });
}

/* ─── LOAD FROM DB ──────────────────────────────────────────────────────────── */
async function loadQuestionsFromDB() {
  const { data, error } = await supabase
    .from('questions')
    .select('id,question_text,short,type,options,is_active,created_at')
    .eq('session_id', CURRENT_SESSION_ID)
    .eq('is_active', true)
    .order('created_at');
  
  if (error) {
    console.warn('DB load failed, using static questions:', error);
    return;
  }
  
  if (data && data.length > 0) {
    questions = data.map((q, i) => ({
      id: q.id,
      text: q.short,
      theme: q.question_text,
      type: q.type,
      options: q.options,
      createdAt: q.created_at,
      index: i
    }));
  }
}

function closeQuestionPrompt() {
  const modal = document.getElementById('questionPromptModal');
  if (modal) modal.classList.remove('show');
}

function showQuestionPrompt(q) {
  if (!q) return;
  const modal = document.getElementById('questionPromptModal');
  const title = document.getElementById('promptQuestionTitle');
  const options = document.getElementById('promptQuestionOptions');
  if (!modal || !title || !options) return;
  title.textContent = q.short || q.question_text || 'New question';

  const opts = Array.isArray(q.options) ? q.options : [];
  options.innerHTML = opts.length > 0
    ? opts.slice(0, 2).map(opt => `<div class="prompt-option">${escapeHtml(opt)}</div>`).join('') + (opts.length > 2 ? `<div class="prompt-more">+${opts.length - 2} more options</div>` : '')
    : '<div class="prompt-option">Open text response</div>';

  modal.classList.add('show');
}

function renderLiveQuestionPage(q) {
  const live = document.getElementById('liveQuestionScreen');
  if (!live) return;

  const options = Array.isArray(q.options) ? q.options : [];
  const isMcq = q.type === 'mcq' && options.length > 0;

  live.innerHTML = `
    <div class="live-question-wrap">
      <div class="live-question-head">
        <button class="live-back-btn" onclick="backToDiscoveryFromLive()">← Live Q&A</button>
      </div>
      <div class="live-tag">New Question</div>
      <h2 class="live-title">${escapeHtml(q.short || q.question_text || 'Question')}</h2>
      <p class="live-sub">Select one option below</p>
      <form id="liveQuestionForm" class="live-form">
        ${isMcq ? options.map((opt, idx) => `
          <label class="live-option">
            <span>${escapeHtml(opt)}</span>
            <input type="radio" name="live_option" value="${escapeHtml(opt)}" ${idx === 0 ? '' : ''}>
          </label>
        `).join('') : `
          <textarea id="liveTextAnswer" class="live-text" placeholder="Type your response..."></textarea>
        `}
        <button type="submit" id="liveSubmitBtn" class="live-submit" disabled>Submit Response</button>
      </form>
      <div id="liveSubmitStatus" class="live-status"></div>
    </div>
  `;

  const form = document.getElementById('liveQuestionForm');
  const submit = document.getElementById('liveSubmitBtn');
  if (!form || !submit) return;

  const updateSubmitState = () => {
    const selected = form.querySelector('input[name="live_option"]:checked');
    const text = document.getElementById('liveTextAnswer')?.value.trim();
    submit.disabled = !(selected || text);
  };

  form.addEventListener('change', updateSubmitState);
  form.addEventListener('input', updateSubmitState);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    const selected = form.querySelector('input[name="live_option"]:checked');
    const text = document.getElementById('liveTextAnswer')?.value.trim() || '';
    const answer = selected
      ? { selections: [selected.value], text: '' }
      : { selections: [], text };
    await saveResponse(q.id, answer);
    const status = document.getElementById('liveSubmitStatus');
    if (status) status.textContent = '✓ Response submitted';
    setTimeout(() => {
      backToDiscoveryFromLive();
    }, 600);
  });
}

window.backToDiscoveryFromLive = function() {
  const live = document.getElementById('liveQuestionScreen');
  if (live) live.classList.remove('active');
  const qArea = document.getElementById('questionArea');
  if (qArea) qArea.style.display = '';
};

window.answerNowLiveQuestion = function() {
  closeQuestionPrompt();
  const qArea = document.getElementById('questionArea');
  if (qArea) qArea.style.display = 'none';
  hideAllScreens();
  const live = document.getElementById('liveQuestionScreen');
  if (!live || !pushedQuestion) return;
  renderLiveQuestionPage(pushedQuestion);
  live.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.answerLaterLiveQuestion = function() {
  closeQuestionPrompt();
};

window.dismissQuestionPrompt = function() {
  closeQuestionPrompt();
};

async function hasAnswered(questionId) {
  const { data } = await supabase
    .from('responses')
    .select('question_id')
    .eq('session_id', CURRENT_SESSION_ID)
    .eq('question_id', questionId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

async function handleQuestionPush(questionRow) {
  if (!questionRow || !questionRow.is_active) return;
  if (await hasAnswered(questionRow.id)) return;
  pushedQuestion = questionRow;
  showQuestionPrompt(questionRow);
}

/* ─── SUMMARY ────────────────────────────────────────────────────────────────── */
window.showSummary = async function() {
  hideAllScreens();
  const qArea = document.getElementById('questionArea');
  if (qArea) qArea.style.display = 'none';
  updateProgress(questions.length);
  
  const { data: responses } = await supabase
    .from('responses')
    .select('*')
    .eq('session_id', CURRENT_SESSION_ID)
    .eq('user_id', userId);
  
  const cards = document.getElementById('summaryCards');
  if (!cards) return;
  cards.innerHTML = '';
  
  questions.forEach((q, i) => {
    let answer = { selections: [], text: '' };
    
    if (q.id) {
      const resp = responses?.find(r => r.question_id === q.id);
      if (resp) answer = resp.answer || {};
    } else {
      const selected = document.querySelectorAll(`.question-card[data-q="${i}"] .option-pill.selected`);
      const textarea = document.querySelectorAll('.response-input')[i];
      if (selected.length > 0) {
        answer.selections = Array.from(selected).map(p => p.dataset.value);
      }
      if (textarea) {
        answer.text = textarea.value;
      }
    }
    
    const combined = [...answer.selections, ...(answer.text ? [answer.text] : [])];
    const content = combined.length
      ? combined.map(v => `<span class="sc-tag">${v}</span>`).join('')
      : '<span class="sc-empty">No response recorded</span>';
    
    cards.innerHTML += `<div class="summary-card"><div class="sc-label">${q.text || q.theme || 'Question ' + (i+1)}</div><div class="sc-answers">${content}</div></div>`;
  });
  
  const summaryScreen = document.getElementById('summaryScreen');
  if (summaryScreen) summaryScreen.classList.add('active');
  window.scrollTo({top:0, behavior:'smooth'});
}

window.editAnswers = function() {
  hideAllScreens();
  const qArea = document.getElementById('questionArea');
  if (qArea) qArea.style.display = '';
  const notice = document.getElementById('updateNotice');
  if (notice) notice.style.display = 'none';
  showCard(0);
};

/* ─── WORKSHOP GENERATION ────────────────────────────────────────────────────── */
window.generateWorkshop = async function() {
  hideAllScreens();
  const wsScreen = document.getElementById('workshopScreen');
  if (wsScreen) { wsScreen.style.display = ''; wsScreen.classList.add('active'); }
  window.scrollTo({top:0, behavior:'smooth'});
  
  const { data: responses } = await supabase
    .from('responses')
    .select('*')
    .eq('session_id', CURRENT_SESSION_ID);
  
  const profileCtx = (profile.industry || profile.stage || profile.role)
    ? `\nEXECUTIVE PROFILE: Industry: ${profile.industry||'not specified'} | Stage: ${profile.stage||'not specified'} | Role: ${profile.role||'not specified'}${profile.name ? ' | Name: '+profile.name : ''}`
    : '';
  const geoCtx = geoData ? `\nLOCATION CONTEXT: ${geoData.city}, ${geoData.country}` : '';
  
  const brief = questions.map((q, i) => {
    let answer = { selections: [], text: '' };
    
    if (q.id) {
      const resp = responses?.find(r => r.question_id === q.id);
      if (resp) answer = resp.answer || {};
    } else {
      const selected = document.querySelectorAll(`.question-card[data-q="${i}"] .option-pill.selected`);
      const textarea = document.querySelectorAll('.response-input')[i];
      if (selected.length > 0) answer.selections = Array.from(selected).map(p => p.dataset.value);
      if (textarea) answer.text = textarea.value;
    }
    
    const combined = [...answer.selections, ...(answer.text ? [answer.text] : [])].join('; ');
    return `${q.text || q.theme || 'Question ' + (i+1)}:\n${combined || 'Not specified'}`;
  }).join('\n\n');
  
  const prompt = `You are a world-class business strategy facilitator and executive coach at BX Consulting — a firm that uses responsible AI to deliver exceptional consulting outcomes. Based on this executive pre-discovery interview, design a detailed, executive-calibre half-day discovery workshop.
${profileCtx}${geoCtx}

EXECUTIVE INTERVIEW RESULTS:
${brief}

Design the workshop with these exact sections — be specific, punchy, and connect everything directly to what this executive said. No generic filler. No consulting clichés.

## 1. WORKSHOP TITLE & PURPOSE
Give it a memorable, specific title. Write 2 sharp sentences on exactly what this session exists to accomplish.

## 2. PRE-WORK (Before the Room)
List 3–4 specific things participants must prepare and bring.

## 3. HALF-DAY AGENDA
Include precise timings with 4 focused modules tied to their answers.

## 4. KEY PROVOCATIONS
Write 5 sharp, uncomfortable questions the facilitator should ask.

## 5. WORKSHOP OUTPUTS
List exactly what outputs the room must produce.

## 6. FACILITATION WATCH-OUTS
3 specific dynamics to watch for based on what was revealed.

Use **bold** for key terms. Keep every section tight and actionable.`;
  
  const output = document.getElementById('workshopOutput');
  if (output) output.innerHTML = '<div class="loading-state">Building your workshop plan <div class="dots"><span></span><span></span><span></span></div></div>';
  
  try {
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ prompt })
    });
    
    if (!resp.ok) throw new Error('Server error');
    
    const data = await resp.json();
    const text = data.content?.map(b => b.text || '').join('') || 'No content returned.';
    renderWorkshop(text);
    const actions = document.getElementById('outputActions');
    if (actions) actions.style.display = 'flex';
  } catch (err) {
    if (output) output.innerHTML = `<p style="color:var(--danger);">Failed to generate workshop plan.<br><span style="font-size:12px;">${err.message}</span></p>`;
  }
}

function renderWorkshop(md) {
  const el = document.getElementById('workshopOutput');
  if (!el) return;
  let html = md
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n(?!<)/g, '<br>');
  el.innerHTML = '<p>' + html + '</p>';
}

window.copyWorkshop = function() {
  const el = document.getElementById('workshopOutput');
  if (!el) return;
  navigator.clipboard.writeText(el.innerText).then(() => {
    const btn = document.querySelector('.action-btn.primary');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Copied';
      setTimeout(() => btn.textContent = orig, 2500);
    }
  });
};

/* ─── LEAD CAPTURE ───────────────────────────────────────────────────────────── */
window.showLeadCapture = function() {
  const ws = document.getElementById('workshopScreen');
  if (ws) { ws.classList.remove('active'); ws.style.display = 'none'; }
  const lead = document.getElementById('leadScreen');
  if (lead) lead.classList.add('active');
  if (profile.name) {
    const first = document.getElementById('lFirst');
    if (first) first.value = profile.name;
  }
  if (profile.email) {
    const email = document.getElementById('lEmail');
    if (email) email.value = profile.email;
  }
  if (profile.company) {
    const company = document.getElementById('lCompany');
    if (company) company.value = profile.company;
  }
  window.scrollTo({top:0, behavior:'smooth'});
};

window.backToWorkshop = function() {
  const lead = document.getElementById('leadScreen');
  if (lead) lead.classList.remove('active');
  const ws = document.getElementById('workshopScreen');
  if (ws) { ws.style.display = ''; ws.classList.add('active'); }
  window.scrollTo({top:0, behavior:'smooth'});
};

window.submitLead = async function() {
  const first = document.getElementById('lFirst')?.value.trim() || '';
  const email = document.getElementById('lEmail')?.value.trim() || '';
  const company = document.getElementById('lCompany')?.value.trim() || '';
  
  if (!first || !email || !company) {
    alert('Please fill in your first name, work email, and company name to continue.');
    return;
  }
  
  const { data: responses } = await supabase
    .from('responses')
    .select('*')
    .eq('session_id', CURRENT_SESSION_ID)
    .eq('user_id', userId);
  
  const leadData = {
    timestamp: new Date().toISOString(),
    firstName: first,
    lastName: document.getElementById('lLast')?.value.trim() || '',
    email, company,
    website: document.getElementById('lUrl')?.value.trim() || '',
    note: document.getElementById('lNote')?.value.trim() || '',
    profile, geoData,
    answers: questions.map((q, i) => {
      let answer = { selections: [], text: '' };
      if (q.id) {
        const resp = responses?.find(r => r.question_id === q.id);
        if (resp) answer = resp.answer || {};
      } else {
        const selected = document.querySelectorAll(`.question-card[data-q="${i}"] .option-pill.selected`);
        const textarea = document.querySelectorAll('.response-input')[i];
        if (selected.length > 0) answer.selections = Array.from(selected).map(p => p.dataset.value);
        if (textarea) answer.text = textarea.value;
      }
      return {
        question: q.text || q.theme || 'Question ' + (i+1),
        selections: answer.selections,
        freeText: answer.text
      };
    })
  };
  
  console.log('Lead captured:', JSON.stringify(leadData, null, 2));
  const form = document.getElementById('leadForm');
  const success = document.getElementById('leadSuccess');
  if (form) form.style.display = 'none';
  if (success) success.style.display = 'block';
  const notice = document.getElementById('updateNotice');
  if (notice) notice.style.display = 'block';
};

window.restartInterview = function() {
  document.querySelectorAll('.option-pill').forEach(p => p.classList.remove('selected'));
  document.querySelectorAll('.response-input').forEach(ta => ta.value = '');
  const actions = document.getElementById('outputActions');
  if (actions) actions.style.display = 'none';
  const notice = document.getElementById('updateNotice');
  if (notice) notice.style.display = 'none';
  const form = document.getElementById('leadForm');
  const success = document.getElementById('leadSuccess');
  if (form) form.style.display = 'block';
  if (success) success.style.display = 'none';
  showCard(0);
};

/* ─── VOICE INPUT ────────────────────────────────────────────────────────────── */
window.toggleVoice = function(btn, qIdx) {
  if (!SR) { 
    const status = document.getElementById(`voiceStatus${qIdx}`);
    if (status) status.textContent = 'Voice not supported (try Chrome or Edge)';
    return;
  }
  if (btn.classList.contains('recording')) { recognition?.stop(); return; }
  recognition?.abort();
  
  const status = document.getElementById(`voiceStatus${qIdx}`);
  const textarea = document.querySelectorAll('.response-input')[qIdx];
  
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  
  let finalText = textarea?.value || '';
  
  recognition.onstart = () => {
    btn.classList.add('recording');
    btn.innerHTML = `${MIC_SVG} Stop recording`;
    if (status) status.textContent = '● Recording…';
  };
  
  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
      else interim = e.results[i][0].transcript;
    }
    if (textarea) textarea.value = finalText + interim;
    saveResponseByIndex(qIdx, [], finalText + interim);
  };
  
  recognition.onerror = (e) => {
    btn.classList.remove('recording');
    btn.innerHTML = `${MIC_SVG} Speak response`;
    if (status) status.textContent = e.error === 'not-allowed' ? 'Microphone access denied' : `Error: ${e.error}`;
  };
  
  recognition.onend = () => {
    btn.classList.remove('recording');
    btn.innerHTML = `${MIC_SVG} Speak response`;
    if (status) status.textContent = finalText.trim() ? '✓ Transcribed successfully' : '';
  };
  
  recognition.start();
};

/* ─── REALTIME SUBSCRIPTION ─────────────────────────────────────────────────── */
function subscribeToResponses() {
  supabase
    .channel('responses-channel')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'responses',
      filter: `session_id=eq.${CURRENT_SESSION_ID}`
    }, () => {
      const countEl = document.getElementById('participantCount');
      if (countEl) getParticipantCount().then(c => countEl.textContent = `${c} participant${c !== 1 ? 's' : ''} online`);
    })
    .subscribe();
}

function subscribeToQuestionPushes() {
  supabase
    .channel('question-push-channel')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'questions',
      filter: `session_id=eq.${CURRENT_SESSION_ID}`
    }, async (payload) => {
      await handleQuestionPush(payload.new);
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'questions',
      filter: `session_id=eq.${CURRENT_SESSION_ID}`
    }, async (payload) => {
      await handleQuestionPush(payload.new);
    })
    .subscribe();
}

/* ─── INIT ───────────────────────────────────────────────────────────────────── */
async function init() {
  console.log('App initializing...');
  await trackPresence();
  console.log('Loading questions from DB...');
  await loadQuestionsFromDB();
  console.log('Questions from DB:', questions.length);
  
  if (questions.length > 0) {
    console.log('Rendering questions from DB...');
    renderQuestionsFromDB();
  } else {
    console.log('Using DOM questions...');
    loadQuestionsFromDOM();
  }
  
  attachOptionListeners();
  subscribeToResponses();
  subscribeToQuestionPushes();
  updateProgress(0);
}

/* ─── RENDER QUESTIONS FROM DB ─────────────────────────────────────────────── */
function renderQuestionsFromDB() {
  const questionArea = document.getElementById('questionArea');
  if (!questionArea) return;
  
  questionArea.innerHTML = questions.map((q, i) => `
    <div class="question-card ${i === 0 ? 'active' : ''}" data-q="${i}">
      <div class="q-eyebrow">
        <span class="dot"></span>
        Question ${String(i + 1).padStart(2, '0')} &nbsp;·&nbsp;
        <span class="q-theme">${escapeHtml(q.theme)}</span>
      </div>
      <div class="q-text">${escapeHtml(q.text)}</div>
      ${q.type === 'mcq' && q.options && q.options.length > 0 ? `
        <div class="options-section">
          <div class="options-label">${q.options.length > 3 ? 'Select all that apply' : 'Choose one'}</div>
          <div class="options-grid" data-q="${i}" data-multi="${q.options.length > 1}" ${q.options.length > 3 ? `data-max="${Math.min(q.options.length, 3)}"` : ''}>
            ${q.options.map(opt => `
              <button class="option-pill" data-value="${escapeHtml(opt)}">${escapeHtml(opt)}</button>
            `).join('')}
          </div>
        </div>
      ` : `
        <div class="input-section">
          <textarea class="response-input" placeholder="Type your response..."></textarea>
          <div class="voice-row">
            <button class="voice-btn" onclick="toggleVoice(this, ${i})">
              <svg class="mic-svg" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              Speak response
            </button>
          </div>
        </div>
      `}
      <div class="action-row">
        ${i > 0 ? '<button class="btn-back" onclick="prevQ(' + i + ')">← Back</button>' : '<div></div>'}
        ${i < questions.length - 1 
          ? '<button class="btn-next" onclick="nextQ(' + i + ')">Continue →</button>' 
          : '<button class="btn-next" onclick="showSummary()">View Summary →</button>'}
      </div>
    </div>
  `).join('');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

init();

/* ─── ADMIN LOGIN ────────────────────────────────────────────────────────────── */
window.sendPrompt = function(message) {
  console.log('sendPrompt called with:', message);
  window.location.href = '/discovery';
};
