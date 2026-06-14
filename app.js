'use strict';

const $ = (id) => document.getElementById(id);
const EXPECTED_KNOWLEDGE_FILENAME = 'チケット対応ナレッジ.json';
const BRIDGE_CREDENTIAL_NAME = 'Local Knowledge Cockpit Gemini Bridge';
let knowledge = null;
let activeFileHandle = null;
let activeFallbackFile = null;
let lastResult = null;
let generatedDraft = '';
let geminiReady = false;
let bridgeToken = '';
let bridgeWindow = null;
let bridgeChannel = '';
let bridgeRequestSequence = 0;
const bridgePending = new Map();
let bridgeLoadPending = null;

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

function supportsBridgeCredentialStorage() {
  return Boolean(
    window.isSecureContext
    && navigator.credentials
    && typeof navigator.credentials.get === 'function'
    && typeof navigator.credentials.store === 'function'
    && typeof window.PasswordCredential === 'function'
  );
}

async function storeBridgeCredential(url, token) {
  if (!supportsBridgeCredentialStorage()) return false;
  const credential = new PasswordCredential({
    id: url,
    password: token,
    name: BRIDGE_CREDENTIAL_NAME
  });
  await navigator.credentials.store(credential);
  return true;
}

async function restoreBridgeCredential() {
  if (!supportsBridgeCredentialStorage()) return;
  try {
    const credential = await navigator.credentials.get({
      password: true,
      mediation: 'optional'
    });
    if (!credential || credential.type !== 'password') return;
    const url = validateBridgeUrl(credential.id);
    const token = String(credential.password || '').trim();
    if (!url || token.length < 24) return;
    $('geminiBridgeUrl').value = url;
    $('geminiBridgeToken').value = token;
    $('geminiStatus').textContent = '保存済み設定でGeminiへ再接続しています。';
    await connectGeminiBridge({ storeCredential: false });
  } catch {
    $('geminiStatus').textContent =
      '保存済み設定を読み込めませんでした。Apps Script中継URLとトークンを入力してください。';
  }
}

function sendBridgeMessage(type, payload = {}, timeoutMs = 70000) {
  if (!bridgeWindow) return Promise.reject(new Error('Gemini中継を読み込めません。'));
  const requestId = `request-${Date.now()}-${++bridgeRequestSequence}`;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      bridgePending.delete(requestId);
      reject(new Error('Gemini中継が応答しません。ログイン状態とデプロイ設定を確認してください。'));
    }, timeoutMs);
    bridgePending.set(requestId, { resolve, reject, timeout });
    bridgeWindow.postMessage({ type, requestId, payload }, '*');
  });
}

function waitForBridgeLoad(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      bridgeLoadPending = null;
      reject(new Error('Gemini中継の内部画面が応答しません。GASを最新版で再デプロイしてください。'));
    }, timeoutMs);
    bridgeLoadPending = {
      resolve: () => {
        window.clearTimeout(timeout);
        bridgeLoadPending = null;
        resolve();
      }
    };
  });
}

async function connectGeminiBridge(options = {}) {
  const url = validateBridgeUrl($('geminiBridgeUrl').value.trim());
  const token = $('geminiBridgeToken').value.trim();
  if (!url) {
    $('geminiStatus').textContent = 'Apps ScriptのウェブアプリURLを入力してください。';
    return;
  }
  if (token.length < 24) {
    $('geminiStatus').textContent = 'Script Propertiesと同じ24文字以上のBRIDGE_TOKENを入力してください。';
    return;
  }
  geminiReady = false;
  bridgeToken = '';
  bridgeWindow = null;
  bridgeChannel = (
    window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  ).replace(/[^A-Za-z0-9_-]/g, '');
  $('connectGeminiBtn').disabled = true;
  $('geminiStatus').textContent = '中継トークンを確認中です。';
  const frame = $('geminiBridgeFrame');
  frame.onload = null;
  const loaded = waitForBridgeLoad();
  const bridgeUrl = new URL(url);
  bridgeUrl.searchParams.set('channel', bridgeChannel);
  frame.src = bridgeUrl.href;
  try {
    await loaded;
    const message = await sendBridgeMessage(
      'ticket-cockpit-ping',
      { bridge_token: token },
      20000
    );
    const status = message.status || {};
    geminiReady = Boolean(status.configured);
    bridgeToken = geminiReady ? token : '';
    let saved = false;
    if (geminiReady && options.storeCredential !== false) {
      try {
        saved = await storeBridgeCredential(url, token);
      } catch {
        saved = false;
      }
    }
    $('geminiStatus').textContent = geminiReady
      ? `接続済み / ${status.model}${saved ? ' / ブラウザに保存済み' : ''}`
      : '中継には接続しましたが、GEMINI_API_KEYが未設定です。';
  } catch (error) {
    bridgeToken = '';
    bridgeWindow = null;
    bridgeChannel = '';
    $('geminiStatus').textContent = error.message;
  } finally {
    $('connectGeminiBtn').disabled = false;
  }
}

window.addEventListener('message', (event) => {
  const message = event.data || {};
  if (
    message.type === 'ticket-cockpit-bridge-loaded'
    && message.channel === bridgeChannel
    && /^https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com$/i.test(event.origin)
  ) {
    bridgeWindow = event.source;
    if (bridgeLoadPending) bridgeLoadPending.resolve();
    return;
  }
  if (!bridgeWindow || event.source !== bridgeWindow) return;
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
  $('healthText').textContent =
    `ローカル参照 / 根拠 ${knowledge.sources.length}件 / 学習 ${(knowledge.feedback || []).length}件`;
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
  if (!Array.isArray(parsed.feedback)) parsed.feedback = [];
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
  lastResult = null;
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
  const scored = knowledge.categories
    .map((rule, index) => {
      const score = (rule.keywords || []).reduce((sum, keyword) => {
        const term = normalize(keyword);
        return sum + (term && text.includes(term) ? (term.length >= 4 ? 4 : 2) : 0);
      }, 0);
      return { rule, score, index };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 4);
  const best = scored[0]?.rule || knowledge.general_category;
  const bestScore = scored[0]?.score || 0;
  const matchedRules = scored.length ? scored.map((item) => item.rule) : [best];
  return {
    ...best,
    keywords: [...new Set(matchedRules.flatMap((rule) => rule.keywords || []))],
    source_ids: [...new Set(matchedRules.flatMap((rule) => rule.source_ids || []))],
    human_review: matchedRules.some((rule) => Boolean(rule.human_review)),
    matched_categories: scored.map((item) => ({
      id: item.rule.id,
      label: item.rule.label,
      score: item.score,
      source_ids: item.rule.source_ids || []
    })),
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
  let relevant = category.source_ids.includes(source.source_id);
  if (relevant) score += 80;
  const labels = category.matched_categories?.length
    ? category.matched_categories.map((item) => item.label)
    : [category.label];
  labels.forEach((label, index) => {
    if (normalize(source.search_text).includes(normalize(label))) {
      relevant = true;
      score += index === 0 ? 20 : 10;
    }
  });
  let termScore = 0;
  terms.forEach((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const count = (normalize(source.search_text).match(new RegExp(escaped, 'g')) || []).length;
    if (count) {
      relevant = true;
      termScore += Math.min(12, 3 + count * 2);
    }
  });
  if (!relevant) return 0;
  if (facility.id !== 'unknown') {
    if (source.facility === facility.id) score += 18;
    else if (source.facility && source.facility !== 'common') score -= 25;
  }
  if (source.source_type === 'official') score += 8;
  if (source.source_type === 'feedback') score += 70;
  return score + termScore;
}

function feedbackSources() {
  return (knowledge.feedback || [])
    .filter((item) => item && item.active !== false && item.corrected_reply)
    .map((item) => {
      const segments = [
        item.correction_note
          ? `【過去の担当者修正・優先】${item.correction_note}`
          : '【過去の担当者修正・優先】承認済みの対応例です。',
        item.inquiry_pattern ? `類似問い合わせ: ${item.inquiry_pattern}` : '',
        `承認済み返信例:\n${item.corrected_reply}`
      ].filter(Boolean);
      return {
        source_id: `feedback:${item.feedback_id}`,
        title: `修正フィードバック / ${item.category_label || '一般問い合わせ'}`,
        source_type: 'feedback',
        facility: item.facility_id || 'common',
        category: item.category_id || '',
        url: '',
        fetched_at: item.created_at || '',
        age_days: null,
        stale: false,
        segments,
        search_text: normalize([
          item.inquiry_pattern,
          item.correction_note,
          item.corrected_reply,
          ...(item.match_terms || [])
        ].filter(Boolean).join('\n'))
      };
    });
}

function sourcePoints(source, terms, limit = 6) {
  const segments = source.segments || [];
  const ranked = segments
    .map((point, index) => ({
      point,
      index,
      score: terms.reduce((sum, term) => sum + (normalize(point).includes(term) ? 4 : 0), 0)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = new Set();
  for (const item of ranked) {
    for (const index of [item.index, item.index - 1, item.index + 1]) {
      if (index >= 0 && index < segments.length) selected.add(index);
      if (selected.size >= limit) break;
    }
    if (selected.size >= limit) break;
  }
  return [...selected].sort((a, b) => a - b).map((index) => segments[index]);
}

function searchSources(inquiry, facility, category) {
  const terms = queryTerms(inquiry, category);
  const ranked = [...feedbackSources(), ...knowledge.sources]
    .map((source) => ({ ...source, score: scoreSource(source, facility, category, terms) }))
    .filter((source) => source.score > 0)
    .sort((a, b) => b.score - a.score);
  const selected = [];
  const selectedIds = new Set();
  ranked.filter((source) => source.source_type === 'feedback').slice(0, 2).forEach((source) => {
    selected.push(source);
    selectedIds.add(source.source_id);
  });
  (category.matched_categories || []).forEach((matchedCategory) => {
    const requiredIds = new Set(matchedCategory.source_ids || []);
    const candidates = ranked.filter((source) => (
      requiredIds.has(source.source_id) && !selectedIds.has(source.source_id)
    ));
    const preferred = [
      ...candidates.filter((source) => source.source_type !== 'official').slice(0, 1),
      ...candidates.filter((source) => source.source_type === 'official').slice(0, 1),
      ...candidates
    ];
    let added = 0;
    preferred.forEach((source) => {
      if (
        selected.length < 10
        && added < 2
        && !selectedIds.has(source.source_id)
      ) {
        selected.push(source);
        selectedIds.add(source.source_id);
        added += 1;
      }
    });
  });
  ranked.forEach((source) => {
    if (selected.length < 10 && !selectedIds.has(source.source_id)) {
      selected.push(source);
      selectedIds.add(source.source_id);
    }
  });
  return selected
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
  lastResult = data;
  generatedDraft = data.draft.customer_reply;
  $('internalNote').textContent = [
    data.draft.internal_note,
    data.draft.usage?.total_tokens
      ? `API使用量: 入力 ${data.draft.usage.input_tokens} / 出力 ${data.draft.usage.output_tokens} tokens`
      : ''
  ].filter(Boolean).join('\n');
  renderEvidence(data.evidence);
}

function renderSensitiveBlock(types) {
  lastResult = null;
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
  $('feedbackNote').value = '';
  $('feedbackStatus').textContent = '修正した返信案と判断ルールを、選択中のナレッジJSONへ保存します。';
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
      bridge_token: bridgeToken,
      inquiry,
      facility: {
        id: result.analysis.facility.id,
        label: result.analysis.facility.label
      },
      category: {
        id: result.analysis.category.id,
        label: result.analysis.category.label,
        matched_categories: result.analysis.category.matched_categories || []
      },
      language: result.analysis.language,
      requires_human_review: result.analysis.requires_human_review,
      evidence: result.evidence.slice(0, 10).map((item) => ({
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

function feedbackId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function writeKnowledgeFile() {
  if (activeFileHandle && typeof activeFileHandle.createWritable === 'function') {
    let permission = 'granted';
    if (typeof activeFileHandle.queryPermission === 'function') {
      permission = await activeFileHandle.queryPermission({ mode: 'readwrite' });
    }
    if (permission !== 'granted' && typeof activeFileHandle.requestPermission === 'function') {
      permission = await activeFileHandle.requestPermission({ mode: 'readwrite' });
    }
    if (permission === 'granted') {
      const writable = await activeFileHandle.createWritable();
      await writable.write(JSON.stringify(knowledge, null, 2));
      await writable.close();
      return '選択中のナレッジJSONへ保存しました。';
    }
  }
  const blob = new Blob([JSON.stringify(knowledge, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = EXPECTED_KNOWLEDGE_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
  return '更新済みJSONをダウンロードしました。Gドライブ上の同名ファイルと置き換えてください。';
}

async function saveFeedback() {
  if (!knowledge || !lastResult) return;
  const inquiry = $('inquiry').value.trim();
  const correctedReply = $('draft').value.trim();
  const correctionNote = $('feedbackNote').value.trim();
  if (!correctionNote || !correctedReply) {
    $('feedbackStatus').textContent = '修正方針と返信案を入力してください。';
    return;
  }
  const sensitive = detectSensitive(`${inquiry}\n${correctionNote}\n${correctedReply}`);
  if (sensitive.length) {
    $('feedbackStatus').textContent = `保存を停止しました。個人情報らしき値を削除してください: ${sensitive.join('、')}`;
    return;
  }
  const category = lastResult.analysis.category;
  const record = {
    feedback_id: feedbackId(),
    created_at: new Date().toISOString(),
    active: true,
    facility_id: lastResult.analysis.facility.id,
    facility_label: lastResult.analysis.facility.label,
    category_id: category.id,
    category_label: category.label,
    inquiry_pattern: inquiry.slice(0, 1200),
    match_terms: queryTerms(inquiry, category).slice(0, 40),
    correction_note: correctionNote.slice(0, 1000),
    corrected_reply: correctedReply.slice(0, 5000),
    replaced_generated_reply: correctedReply !== generatedDraft,
    source_ids: (lastResult.evidence || []).map((item) => item.source_id).slice(0, 10)
  };
  const existing = (knowledge.feedback || []).filter((item) => !(
    normalize(item.inquiry_pattern) === normalize(record.inquiry_pattern)
    && item.category_id === record.category_id
  ));
  knowledge.feedback = [...existing, record].slice(-300);
  $('saveFeedbackBtn').disabled = true;
  try {
    const message = await writeKnowledgeFile();
    $('feedbackStatus').textContent =
      `${message} 学習データ: ${knowledge.feedback.length}件。次回の類似問い合わせから反映します。`;
  } catch (error) {
    $('feedbackStatus').textContent = `保存できませんでした: ${error.message}`;
  } finally {
    $('saveFeedbackBtn').disabled = false;
  }
}

$('selectKnowledgeBtn').addEventListener('click', chooseKnowledgeFile);
$('reloadKnowledgeBtn').addEventListener('click', reloadKnowledge);
$('disconnectKnowledgeBtn').addEventListener('click', disconnectKnowledge);
$('connectGeminiBtn').addEventListener('click', () => connectGeminiBridge());
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
$('saveFeedbackBtn').addEventListener('click', saveFeedback);
$('inquiry').addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') analyze();
});
window.addEventListener('pagehide', () => {
  knowledge = null;
  activeFileHandle = null;
  bridgeToken = '';
  bridgeWindow = null;
  bridgeChannel = '';
  $('geminiBridgeToken').value = '';
  activeFallbackFile = null;
});

restoreBridgeCredential();
