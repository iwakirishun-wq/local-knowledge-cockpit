'use strict';

const $ = (id) => document.getElementById(id);
const EXPECTED_KNOWLEDGE_FILENAME = 'チケット対応ナレッジ.json';
let knowledge = null;
let activeFileHandle = null;
let activeFallbackFile = null;
let geminiReady = false;
let bridgeRequestSequence = 0;
const bridgePending = new Map();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function safeExternalUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function validateBridgeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'script.google.com'
      && /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)
      ? url.href
      : '';
  } catch {
    return '';
  }
}

function sendBridgeMessage(type, payload = {}, timeoutMs = 70000) {
  const frame = $('geminiBridgeFrame');
  if (!frame.contentWindow) return Promise.reject(new Error('Gemini中継を読み込めません。'));
  const requestId = `request-${Date.now()}-${++bridgeRequestSequence}`;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      bridgePending.delete(requestId);
      reject(new Error('Gemini中継が応答しません。ログイン状態とデプロイ設定を確認してください。'));
    }, timeoutMs);
    bridgePending.set(requestId, { resolve, reject, timeout });
    frame.contentWindow.postMessage({ type, requestId, payload }, '*');
  });
}

async function connectGeminiBridge() {
  const url = validateBridgeUrl($('geminiBridgeUrl').value.trim());
  if (!url) {
    $('geminiStatus').textContent = 'Apps ScriptのウェブアプリURLを入力してください。';
    return;
  }
  geminiReady = false;
  $('connectGeminiBtn').disabled = true;
  $('geminiStatus').textContent = '接続中です。Googleログイン画面が出た場合はログインしてください。';
  const frame = $('geminiBridgeFrame');
  frame.onload = async () => {
    try {
      const message = await sendBridgeMessage('ticket-cockpit-ping', {}, 20000);
      const status = message.status || {};
      geminiReady = Boolean(status.configured);
      $('geminiStatus').textContent = geminiReady
        ? `接続済み / ${status.model}`
        : '中継には接続しましたが、GEMINI_API_KEYが未設定です。';
    } catch (error) {
      $('geminiStatus').textContent = error.message;
    } finally {
      $('connectGeminiBtn').disabled = false;
    }
  };
  frame.src = url;
}

window.addEventListener('message', (event) => {
  if (event.source !== $('geminiBridgeFrame').contentWindow) return;
  const message = event.data || {};
  const pending = bridgePending.get(message.requestId);
  if (!pending) return;
  window.clearTimeout(pending.timeout);
  bridgePending.delete(message.requestId);
  if (message.type === 'ticket-cockpit-error') {
    pending.reject(new Error(message.error || 'Gemini中継でエラーが発生しました。'));
  } else {
    pending.resolve(message);
  }
});

function validateKnowledge(data) {
  return Boolean(
    data
    && data.schema === 'ticket-support-knowledge-v1'
    && data.facilities
    && typeof data.facilities === 'object'
    && Array.isArray(data.categories)
    && data.general_category
    && Array.isArray(data.sources)
  );
}

function formatBuiltAt(value) {
  if (!value) return '更新日時不明';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ja-JP');
}

function populateFacilityOptions() {
  const select = $('facility');
  select.replaceChildren(new Option('自動判定', 'auto'));
  Object.entries(knowledge.facilities).forEach(([id, rule]) => {
    select.add(new Option(rule.label || id, id));
  });
  select.disabled = false;
}

function setConnectedStatus(file) {
  $('healthDot').className = 'dot ok';
  $('healthText').textContent = `ローカル参照 / 根拠 ${knowledge.sources.length}件`;
  $('knowledgeStatus').textContent =
    `Gドライブ選択ファイル: ${file.name} / ${knowledge.sources.length}件 / ${formatBuiltAt(knowledge.built_at)}`;
  $('analyzeBtn').disabled = false;
  $('analyzeBtn').textContent = '根拠検索と返信作成';
  $('reloadKnowledgeBtn').classList.remove('hidden');
  $('disconnectKnowledgeBtn').classList.remove('hidden');
  populateFacilityOptions();
}

function clearResult(message) {
  $('placeholder').textContent = message;
  $('placeholder').classList.remove('hidden');
  $('result').classList.add('hidden');
  $('evidenceSection').classList.add('hidden');
  $('evidenceList').replaceChildren();
}

async function applyKnowledgeFile(file) {
  if (file.name !== EXPECTED_KNOWLEDGE_FILENAME) {
    throw new Error(`選択するファイルは「${EXPECTED_KNOWLEDGE_FILENAME}」です。`);
  }
  const parsed = JSON.parse(await file.text());
  if (!validateKnowledge(parsed)) {
    throw new Error('対応していないナレッジJSONです。');
  }
  knowledge = parsed;
  setConnectedStatus(file);
  clearResult('ナレッジを接続しました。個人を特定できる情報を除いて問い合わせを入力してください。');
}

async function chooseKnowledgeFile() {
  if (typeof window.showOpenFilePicker !== 'function') {
    $('knowledgeFileInput').click();
    return;
  }
  try {
    const handles = await window.showOpenFilePicker({
      id: 'local-knowledge-file',
      multiple: false,
      types: [{
        description: 'ナレッジJSON',
        accept: { 'application/json': ['.json'] }
      }]
    });
    activeFileHandle = handles[0];
    activeFallbackFile = null;
    await applyKnowledgeFile(await activeFileHandle.getFile());
  } catch (error) {
    if (error.name !== 'AbortError') {
      $('knowledgeStatus').textContent = error.message;
    }
  }
}

async function reloadKnowledge() {
  try {
    if (activeFileHandle) {
      await applyKnowledgeFile(await activeFileHandle.getFile());
      return;
    }
    if (activeFallbackFile) {
      await applyKnowledgeFile(activeFallbackFile);
      $('knowledgeStatus').textContent += ' / 最新化するにはファイルを再選択してください';
      return;
    }
    await chooseKnowledgeFile();
  } catch (error) {
    $('knowledgeStatus').textContent = error.message;
  }
}

function disconnectKnowledge() {
  knowledge = null;
  activeFileHandle = null;
  activeFallbackFile = null;
  $('knowledgeFileInput').value = '';
  $('inquiry').value = '';
  $('draft').value = '';
  $('facility').replaceChildren(new Option('ナレッジ接続後に選択できます', 'auto'));
  $('facility').disabled = true;
  $('analyzeBtn').disabled = true;
  $('analyzeBtn').textContent = '先にナレッジを接続';
  $('reloadKnowledgeBtn').classList.add('hidden');
  $('disconnectKnowledgeBtn').classList.add('hidden');
  $('healthDot').className = 'dot';
  $('healthText').textContent = 'ナレッジ未接続';
  $('knowledgeStatus').textContent =
    `切断しました。Gドライブ上の「${EXPECTED_KNOWLEDGE_FILENAME}」を再選択してください。`;
  clearResult('この公開アプリにはナレッジを内蔵していません。');
}

function detectSensitive(text) {
  const types = [];
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) types.push('メールアドレス');
  if (/(?:^|\D)0\d{1,4}[-ー－ ]?\d{1,4}[-ー－ ]?\d{3,4}(?:\D|$)/.test(text)) types.push('電話番号');
  if (/(?:\d[ -]?){12,19}/.test(text)) types.push('カード番号などの長い番号');
  if (/(?:^|\D)\d{6,11}(?:\D|$)/.test(text)) types.push('注文番号などの連続番号');
  return [...new Set(types)];
}

function detectLanguage(text) {
  const japanese = (text.match(/[ぁ-んァ-ヶ一-龠]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return latin > Math.max(12, japanese * 2) ? 'en' : 'ja';
}

function classifyFacility(inquiry, override) {
  if (override !== 'auto' && knowledge.facilities[override]) {
    const rule = knowledge.facilities[override];
    return { id: override, label: rule.label || override, confidence: 'manual' };
  }
  const text = normalize(inquiry);
  const ranked = Object.entries(knowledge.facilities)
    .map(([id, rule]) => ({
      id,
      label: rule.label || id,
      score: (rule.keywords || []).reduce((sum, keyword) => {
        const term = normalize(keyword);
        return sum + (term && text.includes(term) ? (term.length >= 4 ? 3 : 2) : 0);
      }, 0)
    }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length || !ranked[0].score || (ranked[1] && ranked[0].score === ranked[1].score)) {
    return { id: 'unknown', label: '対象未判定', confidence: 'low' };
  }
  return {
    id: ranked[0].id,
    label: ranked[0].label,
    confidence: ranked[0].score >= 3 ? 'high' : 'medium'
  };
}

function classifyCategory(inquiry) {
  const text = normalize(inquiry);
  let best = knowledge.general_category;
  let bestScore = 0;
  knowledge.categories.forEach((rule) => {
    const score = (rule.keywords || []).reduce((sum, keyword) => {
      const term = normalize(keyword);
      return sum + (term && text.includes(term) ? (term.length >= 4 ? 4 : 2) : 0);
    }, 0);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  });
  return {
    ...best,
    source_ids: Array.isArray(best.source_ids) ? best.source_ids : [],
    confidence: bestScore >= 4 ? 'high' : bestScore ? 'medium' : 'low'
  };
}

function queryTerms(inquiry, category) {
  const text = normalize(inquiry);
  const terms = [];
  (category.keywords || []).forEach((term) => {
    const value = normalize(term);
    if (value && text.includes(value)) terms.push(value);
  });
  Object.values(knowledge.facilities).forEach((rule) => {
    (rule.keywords || []).forEach((term) => {
      const value = normalize(term);
      if (value && text.includes(value)) terms.push(value);
    });
  });
  (text.match(/[a-z0-9][a-z0-9+&._-]{1,30}/g) || []).forEach((term) => terms.push(term));
  text.split(/[\s、。！？,.!?「」『』（）()[\]\n\r]+/).forEach((term) => {
    const value = term.trim();
    if (value.length >= 2 && value.length <= 12) terms.push(value);
  });
  return [...new Set(terms)].slice(0, 80);
}

function scoreSource(source, facility, category, terms) {
  let score = 0;
  if (category.source_ids.includes(source.source_id)) score += 80;
  if (normalize(source.search_text).includes(normalize(category.label))) score += 20;
  if (facility.id !== 'unknown') {
    if (source.facility === facility.id) score += 18;
    else if (source.facility && source.facility !== 'common') score -= 25;
  }
  if (source.source_type === 'official') score += 8;
  terms.forEach((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const count = (normalize(source.search_text).match(new RegExp(escaped, 'g')) || []).length;
    if (count) score += Math.min(12, 3 + count * 2);
  });
  return score;
}

function sourcePoints(source, terms) {
  return (source.segments || [])
    .map((point, index) => ({
      point,
      index,
      score: terms.reduce((sum, term) => sum + (normalize(point).includes(term) ? 4 : 0), 0)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 4)
    .map((item) => item.point);
}

function searchSources(inquiry, facility, category) {
  const terms = queryTerms(inquiry, category);
  return knowledge.sources
    .map((source) => ({ ...source, score: scoreSource(source, facility, category, terms) }))
    .filter((source) => source.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((source) => ({ ...source, points: sourcePoints(source, terms) }));
}

function uniquePoints(evidence, limit = 5) {
  const result = [];
  const seen = new Set();
  evidence.forEach((source) => source.points.forEach((point) => {
    const key = normalize(point);
    if (key && !seen.has(key) && result.length < limit) {
      seen.add(key);
      result.push(point);
    }
  }));
  return result;
}

function createDraft(language, category, evidence, review) {
  const points = uniquePoints(evidence);
  if (language === 'en') {
    return review
      ? 'Thank you for contacting us.\n\nWe need to review the details before providing an answer.'
      : `Thank you for contacting us.\n\n${points.map((point) => `- ${point}`).join('\n')}\n\nPlease verify the latest conditions before sending this response.`;
  }
  if (review) {
    return 'お問い合わせありがとうございます。\n\n内容の確認が必要なため、担当者で確認のうえご案内いたします。';
  }
  return `お問い合わせありがとうございます。\n\n${category.label}について、以下のとおりご案内いたします。\n\n${points.map((point) => `・${point}`).join('\n')}\n\n送信前に最新の条件をご確認ください。`;
}

function analyzeLocal(inquiry, facilityOverride) {
  const facility = classifyFacility(inquiry, facilityOverride);
  const category = classifyCategory(inquiry);
  const evidence = searchSources(inquiry, facility, category);
  const stale = evidence.filter((item) => item.stale);
  const reasons = [];
  if (category.human_review) reasons.push(`${category.label}は担当者確認が必要なカテゴリです。`);
  if (!evidence.length) reasons.push('回答根拠が見つかりませんでした。');
  if (facility.id === 'unknown') reasons.push('対象を判定できませんでした。');
  if (stale.length) reasons.push(`取得から${knowledge.stale_warning_days || 30}日を超えた根拠があります。`);
  const requiresReview = Boolean(category.human_review || !evidence.length || facility.id === 'unknown' || stale.length);
  const language = detectLanguage(inquiry);
  return {
    analysis: {
      facility,
      category,
      language,
      requires_human_review: requiresReview,
      review_reasons: reasons
    },
    draft: {
      customer_reply: createDraft(language, category, evidence, requiresReview),
      internal_note: '選択したローカルJSONだけを参照した下書きです。送信前に根拠と最新情報を確認してください。'
    },
    evidence
  };
}

function renderAlerts(reasons, aiError = '') {
  const blocks = [];
  if (reasons.length) {
    blocks.push(`<div class="alert warn"><strong>確認事項</strong><ul>${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></div>`);
  }
  if (aiError) {
    blocks.push(`<div class="alert warn"><strong>Gemini API:</strong> ${escapeHtml(aiError)} 根拠検索による定型下書きを表示しています。</div>`);
  }
  $('alerts').innerHTML = blocks.join('');
}

function renderEvidence(items) {
  $('evidenceSection').classList.toggle('hidden', !items.length);
  $('evidenceList').innerHTML = items.map((item) => {
    const freshness = item.age_days == null ? '' : ` / 取得から${item.age_days}日`;
    const stale = item.stale ? '<span class="badge warn">要最新確認</span>' : '';
    const safeUrl = safeExternalUrl(item.url);
    const link = safeUrl
      ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">参照ページを開く</a>`
      : 'ローカルナレッジ';
    return `<article class="evidence">
      <div class="evidence-head">
        <div style="flex:1">
          <h3>${escapeHtml(item.title)}</h3>
          <div class="meta">${escapeHtml(item.source_type || 'source')}${freshness} / ${link}</div>
        </div>
        ${stale}
      </div>
      <ul>${item.points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>
    </article>`;
  }).join('');
}

function renderResult(data) {
  const analysis = data.analysis;
  $('placeholder').classList.add('hidden');
  $('result').classList.remove('hidden');
  $('badges').innerHTML = [
    `<span class="badge">${escapeHtml(analysis.facility.label)}</span>`,
    `<span class="badge">${escapeHtml(analysis.category.label)}</span>`,
    `<span class="badge">${analysis.language === 'en' ? '英語' : '日本語'}</span>`,
    `<span class="badge ${analysis.requires_human_review ? 'danger' : 'ok'}">${analysis.requires_human_review ? '人間確認が必要' : '通常確認'}</span>`,
    `<span class="badge ok">${escapeHtml(data.draft.mode || '根拠検索のみ')}</span>`
  ].join('');
  renderAlerts(analysis.review_reasons, data.ai_error || '');
  $('draft').value = data.draft.customer_reply;
  $('internalNote').textContent = [
    data.draft.internal_note,
    data.draft.usage?.total_tokens
      ? `API使用量: 入力 ${data.draft.usage.input_tokens} / 出力 ${data.draft.usage.output_tokens} tokens`
      : ''
  ].filter(Boolean).join('\n');
  renderEvidence(data.evidence);
}

function renderSensitiveBlock(types) {
  $('placeholder').classList.add('hidden');
  $('result').classList.remove('hidden');
  $('badges').innerHTML = '<span class="badge danger">分析停止</span>';
  $('alerts').innerHTML =
    `<div class="alert danger"><strong>個人情報の可能性がある値を検出しました。</strong><br>${escapeHtml(types.join('、'))}を削除してから再実行してください。</div>`;
  $('draft').value = '';
  $('internalNote').textContent = '入力は外部送信していません。該当箇所を削除するまでナレッジ検索も行いません。';
  $('evidenceSection').classList.add('hidden');
}

async function analyze() {
  if (!knowledge) return;
  const inquiry = $('inquiry').value.trim();
  if (!inquiry) {
    $('inquiry').focus();
    return;
  }
  const sensitive = detectSensitive(inquiry);
  if (sensitive.length) {
    renderSensitiveBlock(sensitive);
    return;
  }
  const result = analyzeLocal(inquiry, $('facility').value);
  result.draft.mode = '根拠検索のみ';
  renderResult(result);
  if (!geminiReady) {
    result.ai_error = 'Gemini中継が未接続です。';
    renderResult(result);
    return;
  }
  $('analyzeBtn').disabled = true;
  $('analyzeBtn').textContent = 'Geminiで返信作成中';
  try {
    const message = await sendBridgeMessage('ticket-cockpit-generate', {
      inquiry,
      facility: {
        id: result.analysis.facility.id,
        label: result.analysis.facility.label
      },
      category: {
        id: result.analysis.category.id,
        label: result.analysis.category.label
      },
      language: result.analysis.language,
      requires_human_review: result.analysis.requires_human_review,
      evidence: result.evidence.slice(0, 8).map((item) => ({
        source_id: item.source_id,
        title: item.title,
        url: item.url,
        fetched_at: item.fetched_at,
        points: item.points
      }))
    });
    result.draft = message.draft;
    result.ai_error = '';
  } catch (error) {
    result.ai_error = error.message;
  } finally {
    $('analyzeBtn').disabled = false;
    $('analyzeBtn').textContent = '根拠検索と返信作成';
  }
  renderResult(result);
}

async function copyDraft() {
  const draft = $('draft');
  try {
    await navigator.clipboard.writeText(draft.value);
  } catch {
    draft.focus();
    draft.select();
    document.execCommand('copy');
  }
  const original = $('copyBtn').textContent;
  $('copyBtn').textContent = 'コピーしました';
  window.setTimeout(() => { $('copyBtn').textContent = original; }, 1400);
}

$('selectKnowledgeBtn').addEventListener('click', chooseKnowledgeFile);
$('reloadKnowledgeBtn').addEventListener('click', reloadKnowledge);
$('disconnectKnowledgeBtn').addEventListener('click', disconnectKnowledge);
$('connectGeminiBtn').addEventListener('click', connectGeminiBridge);
$('knowledgeFileInput').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    activeFileHandle = null;
    activeFallbackFile = file;
    await applyKnowledgeFile(file);
  } catch (error) {
    $('knowledgeStatus').textContent = error.message;
  }
});
$('analyzeBtn').addEventListener('click', analyze);
$('copyBtn').addEventListener('click', copyDraft);
$('inquiry').addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') analyze();
});
window.addEventListener('pagehide', () => {
  knowledge = null;
  activeFileHandle = null;
  activeFallbackFile = null;
});
