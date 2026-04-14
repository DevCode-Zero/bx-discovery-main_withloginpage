import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, CURRENT_SESSION_ID } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let qType = 'mcq';
let reportContent = '';

/* ─── ROUTER ───────────────────────────────────────────────────────────────── */
const ROUTES = {
  '/admin/dashboard': 'dashboard',
  '/admin/questions': 'questions',
  '/admin/responses': 'responses',
  '/admin/generate': 'generate',
  '/admin': 'dashboard'
};

function getRouteFromPath(path) {
  return ROUTES[path] || ROUTES['/admin'];
}

function navigateTo(path) {
  history.pushState(null, '', path);
  handleRoute();
}

window.navigateTo = navigateTo;

function handleRoute() {
  const path = window.location.pathname;
  const tabName = getRouteFromPath(path);
  showTab(tabName);
}

window.addEventListener('popstate', handleRoute);

/* ─── INIT ─────────────────────────────────────────────────────────────────── */
async function init() {
  setupRouterLinks();
  handleRoute();
  try {
    await loadDashboard();
    subscribeToChanges();
  } catch (err) {
    console.error('Init error:', err);
  }
  hideLoading();
}

function setupRouterLinks() {
  document.querySelectorAll('[data-route]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(link.getAttribute('href'));
    });
  });
}

function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'success-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/* ─── TAB NAVIGATION ──────────────────────────────────────────────────────── */
window.showTab = function(tabName) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-nav-item').forEach(n => n.classList.remove('active'));
  
  const tabEl = document.getElementById(`tab-${tabName}`);
  if (tabEl) tabEl.classList.add('active');
  
  const navLink = document.querySelector(`[data-route="${tabName}"]`);
  if (navLink) navLink.classList.add('active');
  
  if (tabName === 'responses') loadResponses();
  if (tabName === 'questions') loadQuestions();
}

/* ─── DASHBOARD ────────────────────────────────────────────────────────────── */
async function loadDashboard() {
  await Promise.all([
    updateParticipantCount(),
    updateQuestionCount(),
    updateResponseCount()
  ]);
}

async function updateParticipantCount() {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('participants')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', CURRENT_SESSION_ID)
    .gte('last_seen', fiveMinAgo);
  document.getElementById('participantCount').textContent = count || 0;
}

async function updateQuestionCount() {
  const { count } = await supabase
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', CURRENT_SESSION_ID)
    .eq('is_active', true);
  document.getElementById('questionCount').textContent = count || 0;
}

async function updateResponseCount() {
  const { count } = await supabase
    .from('responses')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', CURRENT_SESSION_ID);
  document.getElementById('responseCount').textContent = count || 0;
}

/* ─── QUESTIONS ────────────────────────────────────────────────────────────── */
window.showAddQuestion = function() {
  document.getElementById('addQuestionForm').style.display = 'block';
}

window.hideAddQuestion = function() {
  document.getElementById('addQuestionForm').style.display = 'none';
  document.getElementById('qTheme').value = '';
  document.getElementById('qText').value = '';
  document.getElementById('qOptions').value = '';
}

window.setQType = function(type) {
  qType = type;
  document.getElementById('typeMcq').classList.toggle('active', type === 'mcq');
  document.getElementById('typeText').classList.toggle('active', type === 'text');
  document.getElementById('optionsInputs').classList.toggle('show', type === 'mcq');
}

window.submitQuestion = async function() {
  
  const theme = document.getElementById('qTheme').value.trim();
  const text = document.getElementById('qText').value.trim();
  const optionsText = document.getElementById('qOptions').value.trim();
  
  if (!theme || !text) {
    alert('Please fill in both Theme and Question Text.');
    return;
  }
  
  let options = null;
  if (qType === 'mcq' && optionsText) {
    options = optionsText.split('\n').map(o => o.trim()).filter(o => o);
  }
  
  try {
    const { error } = await supabase.from('questions').insert({
      session_id: CURRENT_SESSION_ID,
      question_text: theme,
      short: text,
      type: qType,
      options: options,
      is_active: false
    });
    
    if (error) {
      console.error('Supabase error:', error);
      alert('Error adding question: ' + (error.message || JSON.stringify(error)));
      return;
    }
    
    showToast('Question added as draft.');
    hideAddQuestion();
    loadQuestions();
    updateQuestionCount();
  } catch (err) {
    console.error('Catch error:', err);
    alert('Error: ' + err.message);
  }
}

async function loadQuestions() {
  const { data: responseRows } = await supabase
    .from('responses')
    .select('question_id')
    .eq('session_id', CURRENT_SESSION_ID);
  const responseCountByQuestion = (responseRows || []).reduce((acc, row) => {
    acc[row.question_id] = (acc[row.question_id] || 0) + 1;
    return acc;
  }, {});

  const { data: questions } = await supabase
    .from('questions')
    .select('*')
    .eq('session_id', CURRENT_SESSION_ID)
    .order('created_at', { ascending: false });
  
  const list = document.getElementById('questionList');
  
  if (!questions || questions.length === 0) {
    list.innerHTML = '<div class="no-responses">No questions yet. Add your first question!</div>';
    return;
  }
  
  list.innerHTML = questions.map(q => `
    <div class="question-item ${q.is_active ? '' : 'inactive'}">
      <div class="q-info">
        <div class="q-title">${escapeHtml(q.short)}</div>
        <div class="q-meta">${escapeHtml(q.question_text)} · ${q.type.toUpperCase()} · ${responseCountByQuestion[q.id] || 0} responses</div>
      </div>
      <span class="q-status ${q.is_active ? 'active' : 'inactive'}">${q.is_active ? 'Active' : 'Inactive'}</span>
      <div class="actions">
        <button class="btn btn-primary" onclick="pushQuestion('${q.id}')">Push</button>
        <button class="btn ${q.is_active ? 'btn-secondary' : 'btn-primary'}" onclick="toggleQuestion('${q.id}', ${!q.is_active})">
          ${q.is_active ? 'Deactivate' : 'Activate'}
        </button>
        <button class="btn btn-danger" onclick="deleteQuestion('${q.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

window.pushQuestion = async function(id) {
  await supabase
    .from('questions')
    .update({ is_active: false })
    .eq('session_id', CURRENT_SESSION_ID);

  const { error } = await supabase
    .from('questions')
    .update({ is_active: true })
    .eq('id', id);

  if (error) {
    alert('Failed to push question: ' + error.message);
    return;
  }
  showToast('Question pushed to attendees!');
  loadQuestions();
  updateQuestionCount();
}

window.toggleQuestion = async function(id, isActive) {
  await supabase.from('questions').update({ is_active: isActive }).eq('id', id);
  showToast(isActive ? 'Question activated!' : 'Question deactivated!');
  loadQuestions();
  updateQuestionCount();
}

window.deleteQuestion = async function(id) {
  if (!confirm('Delete this question? This cannot be undone.')) return;
  await supabase.from('questions').delete().eq('id', id);
  showToast('Question deleted!');
  loadQuestions();
  updateQuestionCount();
}

/* ─── RESPONSES ────────────────────────────────────────────────────────────── */
async function loadResponses() {
  const { data: responses } = await supabase
    .from('responses')
    .select('*, questions(question_text, short)')
    .eq('session_id', CURRENT_SESSION_ID)
    .order('created_at', { ascending: false });
  
  const { data: questions } = await supabase
    .from('questions')
    .select('id, short, question_text, type, options')
    .eq('session_id', CURRENT_SESSION_ID);
  
  const grid = document.getElementById('responsesGrid');
  
  if (!responses || responses.length === 0) {
    grid.innerHTML = '<div class="no-responses">No responses yet. Share the session link with participants!</div>';
    return;
  }
  
  const groupedResponses = {};
  responses.forEach(r => {
    const qId = r.question_id;
    if (!groupedResponses[qId]) {
      const q = questions?.find(q => q.id === qId);
      groupedResponses[qId] = {
        question: q?.short || 'Unknown',
        theme: q?.question_text || '',
        type: q?.type || 'text',
        responses: []
      };
    }
    groupedResponses[qId].responses.push(r);
  });
  
  grid.innerHTML = Object.values(groupedResponses).map(g => `
    <div class="response-card">
      <div class="user-id">${g.question}</div>
      ${g.theme ? `<div style="font-size:11px;color:var(--muted);margin-bottom:8px;">${escapeHtml(g.theme)}</div>` : ''}
      ${g.responses.map(r => {
        const ans = r.answer || {};
        if (ans.selections && ans.selections.length > 0) {
          return `<div class="answer-selections">
            ${ans.selections.map(s => `<span class="selection-tag">${escapeHtml(s)}</span>`).join('')}
          </div>`;
        } else if (ans.text) {
          return `<div class="answer-text">${escapeHtml(ans.text)}</div>`;
        } else {
          return `<div style="color:var(--muted);font-size:12px;">No answer</div>`;
        }
      }).join('<hr style="border:none;border-top:1px solid var(--border);margin:10px 0;">')}
    </div>
  `).join('');
}

/* ─── GENERATE REPORT ──────────────────────────────────────────────────────── */
window.generateReport = async function() {
  const output = document.getElementById('reportOutput');
  const content = document.getElementById('reportContent');
  
  output.style.display = 'block';
  content.innerHTML = '<div class="loading-state">Generating workshop plan <div class="dots"><span></span><span></span><span></span></div></div>';
  
  const { data: responses } = await supabase
    .from('responses')
    .select('*, questions(short, question_text)')
    .eq('session_id', CURRENT_SESSION_ID);
  
  const { data: questions } = await supabase
    .from('questions')
    .select('*')
    .eq('session_id', CURRENT_SESSION_ID);
  
  const groupedResponses = {};
  responses?.forEach(r => {
    const q = questions?.find(q => q.id === r.question_id);
    if (!groupedResponses[r.question_id]) {
      groupedResponses[r.question_id] = {
        question: q?.short || 'Unknown',
        theme: q?.question_text || '',
        answers: []
      };
    }
    if (r.answer) {
      groupedResponses[r.question_id].answers.push(r.answer);
    }
  });
  
  const brief = Object.values(groupedResponses).map(g => {
    const allAnswers = g.answers.flatMap(a => [...(a.selections || []), a.text || '']).filter(Boolean);
    return `${g.question}:\n${allAnswers.join('; ') || 'No responses'}`;
  }).join('\n\n');
  
  const prompt = `You are a world-class business strategy facilitator and executive coach at BX Consulting — a firm that uses responsible AI to deliver exceptional consulting outcomes. Based on participant responses from a discovery session, design a detailed, executive-calibre half-day discovery workshop.

PARTICIPANT RESPONSES:
${brief}

Design the workshop with these exact sections — be specific, punchy, and connect everything directly to what participants said. No generic filler. No consulting clichés.

## 1. WORKSHOP TITLE & PURPOSE
Give it a memorable, specific title. Write 2 sharp sentences on exactly what this session exists to accomplish.

## 2. PRE-WORK (Before the Room)
List 3–4 specific things participants must prepare and bring — make each item directly relevant to their stated constraints and goals.

## 3. HALF-DAY AGENDA
Include precise timings. Build 4 focused modules tied to their answers:
- 08:30 — Opening: Strategic Stakes & Context (30 min)
- Module 1: Winning Definition — Where We Play & How We Win
- Module 2: Growth Mechanics — Testing the Thesis Against Reality
- Module 3: Customer Value & Market Sequencing
- Module 4: Constraint Breakdown — The Honest Blockers Session
- Closing: Decisions, Owners, Committed Dates

## 4. KEY PROVOCATIONS
Write 5 sharp, uncomfortable questions the facilitator should ask in the room — each one specific to what participants shared. Make them confrontational in a constructive way.

## 5. WORKSHOP OUTPUTS
List exactly what physical or digital outputs the room must produce before everyone leaves.

## 6. FACILITATION WATCH-OUTS
3 specific dynamics to watch for, based on what participants revealed — name the risks, tensions, or avoidance patterns to manage.

Use **bold** for key terms. Keep every section tight and actionable. This goes to a C-suite audience.`;
  
  try {
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ prompt })
    });
    
    if (!resp.ok) throw new Error('Server error');
    
    const data = await resp.json();
    reportContent = data.content?.map(b => b.text || '').join('') || 'No content returned.';
    
    let html = reportContent
      .replace(/^## (.+)$/gm, '<h2 style="font-family:Syne;font-size:18px;margin:24px 0 12px;color:var(--accent);">$1</h2>')
      .replace(/^### (.+)$/gm, '<h3 style="font-family:Syne;font-size:15px;margin:20px 0 10px;">$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^[-•] (.+)$/gm, '<li style="margin-left:20px;margin-bottom:6px;">$1</li>')
      .replace(/\n\n+/g, '</p><p>')
      .replace(/\n(?!<)/g, '<br>');
    
    content.innerHTML = '<p>' + html + '</p>';
  } catch (err) {
    content.innerHTML = `<p style="color:var(--danger);">Failed to generate report. Make sure the API server is running.</p>`;
  }
}

window.copyReport = function() {
  navigator.clipboard.writeText(reportContent).then(() => {
    showToast('Report copied to clipboard!');
  });
}

/* ─── REALTIME SUBSCRIPTION ───────────────────────────────────────────────── */
function subscribeToChanges() {
  supabase
    .channel('admin-channel')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'participants',
      filter: `session_id=eq.${CURRENT_SESSION_ID}`
    }, () => updateParticipantCount())
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'questions',
      filter: `session_id=eq.${CURRENT_SESSION_ID}`
    }, () => {
      updateQuestionCount();
      if (document.getElementById('tab-questions').classList.contains('active')) {
        loadQuestions();
      }
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'responses',
      filter: `session_id=eq.${CURRENT_SESSION_ID}`
    }, () => {
      updateResponseCount();
      if (document.getElementById('tab-responses').classList.contains('active')) {
        loadResponses();
      }
    })
    .subscribe();
}

/* ─── UTILITIES ────────────────────────────────────────────────────────────── */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ─── START ────────────────────────────────────────────────────────────────── */
init();
