// ============================================================
// Personal Chat Manager — Phase 1 MVP frontend (API-backed)
// Talks to FastAPI at API_BASE. Only UI preferences live locally.
// ============================================================

const API_BASE = (() => {
  // Default to same-origin (backend serves static too). If running on
  // a separate dev server (python -m http.server / vite), point at 8787.
  if (location.port && location.port !== "8787") {
    return `${location.protocol}//${location.hostname}:8787`;
  }
  return "";
})();

const STORAGE_KEY = "pcm:ui:v2";

const FILTERS = [
  { id: "all", label: "全部" },
  { id: "auto", label: "自动" },
  { id: "manual", label: "手动" },
  { id: "attention", label: "关注" },
];

const FREQUENCIES = [
  { id: "manual", label: "手动" },
  { id: "hourly", label: "每小时" },
  { id: "every_6h", label: "每 6 小时" },
  { id: "every_12h", label: "每 12 小时" },
  { id: "daily", label: "每日" },
];

const LANGUAGES = [
  { id: "zh-CN", label: "简体中文" },
  { id: "en-US", label: "English" },
  { id: "ja-JP", label: "日本語" },
];

const FIRST_SUMMARY_MODES = [
  {
    id: "from_now",
    label: "从此刻开始",
    hint: "首次报告只包含点开「开启自动总结」之后到达的新消息；之前的全部忽略。仅对第一次生效，之后沿游标增量。",
  },
  {
    id: "last_24h",
    label: "回看 24 小时",
    hint: "首次报告把过去 24 小时的消息一并纳入；之后沿游标增量。仅对第一次生效。",
  },
  {
    id: "last_7d",
    label: "回看 7 天",
    hint: "首次报告把过去 7 天的消息一并纳入；之后沿游标增量。仅对第一次生效。",
  },
];

// Filled at init from GET /api/templates. Fallback shown if fetch fails.
let TEMPLATES = [
  { id: "default", label: "通用结构化", description: "", system_prompt: "" },
];

const CHAT_TYPE = {
  group: { label: "Group", icon: "users" },
  supergroup: { label: "Supergroup", icon: "users-round" },
  channel: { label: "Channel", icon: "megaphone" },
  private: { label: "Private", icon: "user" },
};

const STATUS = {
  idle: { label: "待机", badge: "bg-zinc-500/10 text-zinc-400 border-zinc-700/50" },
  running: { label: "生成中", badge: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
  success: { label: "成功", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  failed: { label: "失败", badge: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
  skipped: { label: "无新消息", badge: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
};

const GRADIENTS = [
  "bg-gradient-to-br from-sky-500 to-indigo-500",
  "bg-gradient-to-br from-emerald-500 to-teal-500",
  "bg-gradient-to-br from-amber-500 to-rose-500",
  "bg-gradient-to-br from-violet-500 to-fuchsia-500",
  "bg-gradient-to-br from-rose-500 to-pink-500",
  "bg-gradient-to-br from-cyan-500 to-blue-500",
  "bg-gradient-to-br from-orange-500 to-red-500",
];

// ============================================================
// API client
// ============================================================

class ApiError extends Error {
  constructor(status, detail, raw) {
    super(`HTTP ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
    this.raw = raw;
  }
}

async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = data?.detail ?? res.statusText;
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail), data);
  }
  return data;
}

const apiGet = (path) => api("GET", path);
const apiPost = (path, body) => api("POST", path, body ?? {});
const apiPatch = (path, body) => api("PATCH", path, body);

// ============================================================
// State
// ============================================================

function defaultUi() {
  return {
    activeChatId: null,
    activeReportId: null,
    filter: "all",
    search: "",
    dataTab: "telegram_accounts",
    collapsedSections: {},
  };
}

function loadUi() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultUi();
    return { ...defaultUi(), ...JSON.parse(raw) };
  } catch {
    return defaultUi();
  }
}

function saveUi() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.ui));
}

const state = {
  account: null,
  chats: [],                 // array of {chat, binding}
  reportsByChat: {},         // chatId -> [ReportOut]
  reportsMetaByChat: {},     // chatId -> {hasMore, loadedCount} for pagination
  reportsLoadingMore: false, // spinner state for the "load more" button
  selectedReports: new Set(),// selected report ids for bulk-delete
  unreadCountsByChat: {},    // chatId -> number of unread reports (server truth)
  showUnreadOnly: false,     // ephemeral filter toggle on the report list
  runsByChat: {},            // chatId -> [RunOut]
  previewByChat: {},         // chatId -> {pending_count, cursor_at, cursor_message_id, next_run_at, ...}
  totalReportsCount: 0,      // account-wide report count from /api/reports/count
  runsExpanded: false,       // runs history panel open state
  refreshingPreview: null,   // chatId currently re-fetching preview, for spinner
  runningChats: new Set(),
  activeRuns: [],            // [{id, user_chat_binding_id, started_at, trigger_source, ...}]
  activePanelOpen: false,    // whether the topbar runs panel is shown
  activePollTimer: null,     // setInterval handle
  login: { id: null, phone: null, needs2fa: false },
  ui: loadUi(),
};

// ============================================================
// Helpers
// ============================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function icons() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatRelative(iso) {
  if (!iso) return "从未";
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diff < 1) return "刚刚";
  if (diff < 60) return `${diff} 分钟前`;
  if (diff < 60 * 24) return `${Math.round(diff / 60)} 小时前`;
  return `${Math.round(diff / 1440)} 天前`;
}

function formatAbsolute(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Browser-local "smart" formatter: today → "今天 HH:MM", yesterday → "昨天 HH:MM",
// older → "MM-DD HH:MM". All numbers reflect the user's machine timezone via
// Date's automatic ISO parsing.
function formatLocalSmart(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `今天 ${hm}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

function formatLocalFull(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function browserTimezoneLabel() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  } catch {
    return "local";
  }
}

function reportCoveredRange(r) {
  if (!r?.covered_from_at || !r?.covered_to_at) return null;
  return `${formatAbsolute(r.covered_from_at)} → ${formatAbsolute(r.covered_to_at)}`;
}

function gradientFor(seed) {
  let hash = 0;
  for (const c of String(seed ?? "")) hash = (hash + c.charCodeAt(0)) % GRADIENTS.length;
  return GRADIENTS[hash];
}

function avatarSeedFor(title) {
  const t = (title || "").trim();
  if (!t) return "??";
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return t.slice(0, 2).toUpperCase();
}

function chatTypeMeta(type) {
  return CHAT_TYPE[type] ?? { label: type, icon: "message-square" };
}

function statusMeta(key) {
  return STATUS[key] ?? STATUS.idle;
}

// Derive display status for a chat based on binding fields + local run state.
function deriveStatus(chatId, binding) {
  if (state.runningChats.has(chatId)) return "running";
  if (!binding) return "idle";
  const err = binding.last_error_at ? new Date(binding.last_error_at).getTime() : 0;
  const ok = binding.last_success_at ? new Date(binding.last_success_at).getTime() : 0;
  if (err && err > ok) return "failed";
  if (ok) return "success";
  return "idle";
}

function getChatEntry(chatId) {
  return state.chats.find((x) => x.chat.id === chatId) ?? null;
}

function getVisibleChats() {
  const query = (state.ui.search || "").trim().toLowerCase();
  const filter = state.ui.filter;
  return state.chats.filter(({ chat, binding }) => {
    if (filter === "auto" && !binding?.auto_summary_enabled) return false;
    if (filter === "manual" && binding?.auto_summary_enabled) return false;
    if (filter === "attention" && deriveStatus(chat.id, binding) !== "failed") return false;
    if (!query) return true;
    const hay = [chat.title, chat.description, chatTypeMeta(chat.chat_type).label].join(" ").toLowerCase();
    return hay.includes(query);
  });
}

function bindingFor(chatId) {
  return getChatEntry(chatId)?.binding ?? null;
}

// ============================================================
// View routing
// ============================================================

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#workspaceView").classList.add("hidden");
  resetLoginForm();
  icons();
}

function showWorkspace() {
  $("#loginView").classList.add("hidden");
  $("#workspaceView").classList.remove("hidden");
  renderWorkspace();
  startActiveRunsPolling();
}

// ============================================================
// Login
// ============================================================

function resetLoginForm() {
  $("#loginStep1").classList.remove("hidden");
  $("#loginStep2").classList.add("hidden");
  hideLoginError();
  setStepperActive(1);
  $("#phoneInput").value = "";
  $("#codeInput").value = "";
  if ($("#twofaInput")) $("#twofaInput").value = "";
  state.login = { id: null, phone: null, needs2fa: false };
}

function setStepperActive(step) {
  const s1 = $("#step1Indicator");
  const s2 = $("#step2Indicator");
  if (step === 1) {
    s1.classList.remove("opacity-50");
    s2.classList.add("opacity-50");
    s1.querySelector("div").className =
      "w-7 h-7 rounded-full bg-sky-500 text-white grid place-items-center text-xs font-semibold shadow-lg shadow-sky-500/30";
    s1.querySelector("div").textContent = "1";
    s1.querySelector("span").className = "text-xs font-medium text-zinc-200";
    s2.querySelector("div").className =
      "w-7 h-7 rounded-full bg-zinc-800 text-zinc-400 grid place-items-center text-xs font-semibold";
    s2.querySelector("div").textContent = "2";
    s2.querySelector("span").className = "text-xs font-medium text-zinc-400";
  } else {
    s1.classList.remove("opacity-50");
    s2.classList.remove("opacity-50");
    s1.querySelector("div").className =
      "w-7 h-7 rounded-full bg-emerald-500 text-white grid place-items-center shadow-lg shadow-emerald-500/20";
    s1.querySelector("div").innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i>';
    s2.querySelector("div").className =
      "w-7 h-7 rounded-full bg-sky-500 text-white grid place-items-center text-xs font-semibold shadow-lg shadow-sky-500/30";
    s2.querySelector("div").textContent = "2";
    s2.querySelector("span").className = "text-xs font-medium text-zinc-200";
    icons();
  }
}

function showLoginError(msg) {
  $("#loginErrorMsg").textContent = msg;
  const el = $("#loginError");
  el.classList.remove("hidden");
  el.classList.add("flex");
}

function hideLoginError() {
  const el = $("#loginError");
  el.classList.add("hidden");
  el.classList.remove("flex");
}

async function handleSendCode() {
  const phone = $("#phoneInput").value.trim();
  const country = $("#countryCode").value;
  if (!/^[\d\s-]{6,}$/.test(phone)) {
    showLoginError("请输入有效的手机号。");
    return;
  }
  hideLoginError();

  const fullPhone = `${country}${phone.replace(/[\s-]/g, "")}`;

  const btn = $("#sendCodeBtn");
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>正在发送…</span>';
  icons();

  try {
    const res = await apiPost("/api/auth/telegram/send-code", { phone: fullPhone });
    state.login.id = res.login_id;
    state.login.phone = res.phone;
    $("#codeHintPhone").textContent = res.phone;
    $("#loginStep1").classList.add("hidden");
    $("#loginStep2").classList.remove("hidden");
    $("#codeInput").focus();
    setStepperActive(2);
  } catch (err) {
    showLoginError(err.detail || err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>发送验证码</span><i data-lucide="arrow-right" class="w-4 h-4"></i>';
    icons();
  }
}

async function handleConfirmCode() {
  const code = $("#codeInput").value.trim();
  const password = ($("#twofaInput").value || "").trim() || null;
  if (!/^\d{4,6}$/.test(code)) {
    showLoginError("验证码通常为 5 位数字。");
    return;
  }
  if (!state.login.id) {
    showLoginError("登录会话丢失，请返回重发验证码。");
    return;
  }
  hideLoginError();

  const btn = $("#confirmCodeBtn");
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>验证中…</span>';
  icons();

  try {
    const acc = await apiPost("/api/auth/telegram/verify", {
      login_id: state.login.id,
      code,
      password,
    });
    state.account = acc;
    toast("Telegram 账号已绑定", "check-circle-2");
    showWorkspace();
    // first-time sync if empty
    await loadChats();
    if (state.chats.length === 0) {
      await handleSync({ silent: true });
    }
  } catch (err) {
    if (err.status === 409) {
      state.login.needs2fa = true;
      showLoginError("已开启两步验证，请在下方输入云密码后再点确认。");
      // auto-open the 2fa details
      document.querySelector("details.group")?.setAttribute("open", "");
      $("#twofaInput").focus();
    } else if (err.status === 400) {
      showLoginError("验证码不正确，请重新输入。");
    } else if (err.status === 410) {
      showLoginError("验证码已过期，请返回重发。");
    } else {
      showLoginError(err.detail || err.message);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>确认登录</span><i data-lucide="check" class="w-4 h-4"></i>';
    icons();
  }
}

// ============================================================
// Workspace data loading
// ============================================================

async function loadChats() {
  const rows = await apiGet("/api/chats");
  state.chats = rows;
  if (state.ui.activeChatId && !state.chats.some((e) => e.chat.id === state.ui.activeChatId)) {
    state.ui.activeChatId = state.chats[0]?.chat.id ?? null;
  }
  if (!state.ui.activeChatId && state.chats.length) {
    state.ui.activeChatId = state.chats[0].chat.id;
  }
  const jobs = [loadTotalReportsCount(), loadUnreadCounts()];
  if (state.ui.activeChatId) {
    jobs.push(loadReportsForChat(state.ui.activeChatId));
    jobs.push(loadPreviewForChat(state.ui.activeChatId));
  }
  await Promise.all(jobs);
  renderWorkspace();
}

const REPORTS_PAGE_SIZE = 20;

async function loadReportsForChat(chatId, { append = false } = {}) {
  try {
    const offset = append ? (state.reportsByChat[chatId]?.length ?? 0) : 0;
    const url = `/api/reports?chat_id=${encodeURIComponent(chatId)}`
      + `&limit=${REPORTS_PAGE_SIZE}&offset=${offset}`;
    const reports = await apiGet(url);
    if (append) {
      state.reportsByChat[chatId] = [
        ...(state.reportsByChat[chatId] ?? []),
        ...reports,
      ];
    } else {
      state.reportsByChat[chatId] = reports;
    }
    state.reportsMetaByChat[chatId] = {
      hasMore: reports.length === REPORTS_PAGE_SIZE,
      loadedCount: state.reportsByChat[chatId].length,
    };
    if (!state.reportsByChat[chatId].some((r) => r.id === state.ui.activeReportId)) {
      state.ui.activeReportId = state.reportsByChat[chatId][0]?.id ?? null;
    }
  } catch (err) {
    console.warn("loadReports failed", err);
    if (!append) state.reportsByChat[chatId] = [];
  }
}

async function loadMoreReports() {
  const chatId = state.ui.activeChatId;
  if (!chatId) return;
  if (state.reportsLoadingMore) return;
  state.reportsLoadingMore = true;
  renderReportList();
  icons();
  try {
    await loadReportsForChat(chatId, { append: true });
  } finally {
    state.reportsLoadingMore = false;
    renderReportList();
    icons();
  }
}

async function deleteReport(reportId) {
  if (!confirm("删除这份报告？原始消息和关联的运行记录保留，仅删除报告本身。")) return;
  try {
    const chatId = state.ui.activeChatId;
    const wasUnread = !(findReportEverywhere(reportId)?.read_at);
    await api("DELETE", `/api/reports/${reportId}`);
    if (chatId && state.reportsByChat[chatId]) {
      state.reportsByChat[chatId] = state.reportsByChat[chatId].filter((r) => r.id !== reportId);
    }
    state.selectedReports.delete(reportId);
    if (state.ui.activeReportId === reportId) state.ui.activeReportId = null;
    state.totalReportsCount = Math.max(0, state.totalReportsCount - 1);
    if (wasUnread) bumpUnread(chatId, -1);
    renderAccountCard();
    renderReportList();
    renderReportDetail();
    updateSingleChatItem(chatId);
    icons();
    toast("已删除", "trash-2");
  } catch (err) {
    toast(`删除失败：${err.detail || err.message}`, "alert-circle");
  }
}

async function bulkDeleteReports() {
  if (state.selectedReports.size === 0) return;
  const ids = Array.from(state.selectedReports);
  if (!confirm(`批量删除 ${ids.length} 份报告？关联的运行记录保留。`)) return;
  try {
    const chatId = state.ui.activeChatId;
    const unreadDecrement = ids.reduce(
      (n, id) => n + (findReportEverywhere(id)?.read_at ? 0 : 1),
      0
    );
    const res = await api("POST", "/api/reports/bulk-delete", { ids });
    const idSet = new Set(ids);
    if (chatId && state.reportsByChat[chatId]) {
      state.reportsByChat[chatId] = state.reportsByChat[chatId].filter((r) => !idSet.has(r.id));
    }
    state.selectedReports.clear();
    if (idSet.has(state.ui.activeReportId)) state.ui.activeReportId = null;
    state.totalReportsCount = Math.max(0, state.totalReportsCount - (res?.deleted ?? ids.length));
    if (unreadDecrement > 0) bumpUnread(chatId, -unreadDecrement);
    updateSingleChatItem(chatId);
    renderAccountCard();
    renderReportList();
    renderReportDetail();
    icons();
    toast(`已删除 ${res?.deleted ?? ids.length} 份`, "trash-2");
  } catch (err) {
    toast(`批量删除失败：${err.detail || err.message}`, "alert-circle");
  }
}

async function loadPreviewForChat(chatId) {
  try {
    const p = await apiGet(`/api/bindings/${chatId}/preview`);
    state.previewByChat[chatId] = p;
  } catch (err) {
    console.warn("loadPreview failed", err);
    state.previewByChat[chatId] = null;
  }
}

async function loadTotalReportsCount() {
  try {
    const res = await apiGet("/api/reports/count");
    state.totalReportsCount = res?.total ?? 0;
  } catch (err) {
    console.warn("loadTotalReportsCount failed", err);
  }
}

async function loadUnreadCounts() {
  try {
    const rows = await apiGet("/api/reports/unread-counts");
    const map = {};
    for (const { chat_id, count } of rows ?? []) map[chat_id] = count;
    state.unreadCountsByChat = map;
  } catch (err) {
    console.warn("loadUnreadCounts failed", err);
  }
}

function bumpUnread(chatId, delta) {
  if (!chatId) return;
  const cur = state.unreadCountsByChat[chatId] ?? 0;
  const next = Math.max(0, cur + delta);
  if (next === 0) delete state.unreadCountsByChat[chatId];
  else state.unreadCountsByChat[chatId] = next;
}

// ============================================================
// Active runs poller (top-bar chip + auto-refresh)
// ============================================================

const ACTIVE_POLL_MS = 5000;

function chatForBindingId(bindingId) {
  return state.chats.find((e) => e.binding?.id === bindingId)?.chat ?? null;
}

async function pollActiveRuns() {
  if (!state.account) return;
  let rows;
  try {
    rows = await apiGet("/api/reports/runs/recent?status=running&limit=50");
  } catch (err) {
    console.warn("pollActiveRuns failed", err);
    return;
  }
  const prevIds = new Set(state.activeRuns.map((r) => r.id));
  const nextIds = new Set(rows.map((r) => r.id));
  const completedRuns = state.activeRuns.filter((r) => !nextIds.has(r.id));
  state.activeRuns = rows;
  renderActiveRunsChip();

  // If a tracked run for the active chat just finished, refresh its preview /
  // reports so the UI reflects the new cursor and report count.
  const activeChatId = state.ui.activeChatId;
  const activeChatEntry = activeChatId ? getChatEntry(activeChatId) : null;
  const activeBindingId = activeChatEntry?.binding?.id;
  const completedAffectsActive = completedRuns.some(
    (r) => activeBindingId && r.user_chat_binding_id === activeBindingId,
  );
  if (completedRuns.length > 0) {
    // Account-wide totals likely changed.
    loadTotalReportsCount().then(renderAccountCard).catch(() => {});
    loadUnreadCounts().then(() => { renderChatList(); icons(); }).catch(() => {});
  }
  if (completedAffectsActive) {
    await Promise.all([
      loadPreviewForChat(activeChatId),
      loadReportsForChat(activeChatId),
    ]);
    renderHero();
    renderReportList();
    renderConfigPanel();
    icons();
  }

  // Bonus: if previous tick shows nothing was running but now something is for
  // the active chat, surface that so the hero shows "生成中".
  const newlyAddedForActive = rows.some(
    (r) =>
      activeBindingId &&
      r.user_chat_binding_id === activeBindingId &&
      !prevIds.has(r.id),
  );
  if (newlyAddedForActive) {
    state.runningChats.add(activeChatId);
    renderHero();
    icons();
  }
}

function startActiveRunsPolling() {
  if (state.activePollTimer) return;
  pollActiveRuns();
  state.activePollTimer = setInterval(pollActiveRuns, ACTIVE_POLL_MS);
}

function stopActiveRunsPolling() {
  if (state.activePollTimer) {
    clearInterval(state.activePollTimer);
    state.activePollTimer = null;
  }
  state.activeRuns = [];
  renderActiveRunsChip();
}

function renderActiveRunsChip() {
  const chip = $("#activeRunsChip");
  const text = $("#activeRunsChipText");
  const panel = $("#activeRunsPanel");
  if (!chip || !text || !panel) return;
  const n = state.activeRuns.length;
  if (n === 0) {
    chip.classList.add("hidden");
    chip.classList.remove("flex");
    panel.classList.add("hidden");
    state.activePanelOpen = false;
    return;
  }
  chip.classList.remove("hidden");
  chip.classList.add("flex");
  text.textContent = `${n} 个任务运行中`;
  if (state.activePanelOpen) renderActiveRunsPanel();
  icons();
}

function renderActiveRunsPanel() {
  const panel = $("#activeRunsPanel");
  if (!panel) return;
  if (!state.activeRuns.length) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  const rows = state.activeRuns
    .slice()
    .sort((a, b) => new Date(a.started_at || a.created_at) - new Date(b.started_at || b.created_at));
  panel.innerHTML = `
    <div class="px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between">
      <span class="text-xs font-semibold text-zinc-200">运行中的任务</span>
      <span class="text-[10px] text-zinc-500 font-mono">${rows.length}</span>
    </div>
    <div class="p-2 space-y-1">
      ${rows.map((r) => {
        const chat = chatForBindingId(r.user_chat_binding_id);
        const startedIso = r.started_at || r.created_at;
        const elapsed = startedIso
          ? Math.max(0, Math.round((Date.now() - new Date(startedIso).getTime()) / 1000))
          : null;
        const elapsedText = elapsed == null ? "—" : elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m${elapsed % 60}s`;
        const title = chat?.title ?? "(unknown chat)";
        const trigger = r.trigger_source || "manual";
        return `
          <button data-active-chat-id="${chat ? escapeHtml(chat.id) : ""}" class="w-full flex items-center gap-3 p-2 rounded-md hover:bg-zinc-800 text-left transition">
            <div class="w-7 h-7 rounded-md bg-sky-500/15 border border-sky-500/30 grid place-items-center text-sky-400 flex-shrink-0">
              <i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i>
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-xs font-medium text-zinc-100 truncate">${escapeHtml(title)}</div>
              <div class="text-[10px] text-zinc-500 font-mono truncate">${escapeHtml(trigger)} · ${escapeHtml(elapsedText)}</div>
            </div>
          </button>
        `;
      }).join("")}
    </div>
  `;
  panel.querySelectorAll("[data-active-chat-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cid = btn.dataset.activeChatId;
      if (cid && cid !== state.ui.activeChatId) selectChat(cid);
      closeActiveRunsPanel();
    });
  });
  icons();
}

function toggleActiveRunsPanel() {
  state.activePanelOpen = !state.activePanelOpen;
  if (state.activePanelOpen) renderActiveRunsPanel();
  else $("#activeRunsPanel")?.classList.add("hidden");
}

function closeActiveRunsPanel() {
  state.activePanelOpen = false;
  $("#activeRunsPanel")?.classList.add("hidden");
}

async function loadRunsForChat(chatId) {
  try {
    const rows = await apiGet(`/api/bindings/${chatId}/runs?limit=30`);
    state.runsByChat[chatId] = rows;
  } catch (err) {
    console.warn("loadRuns failed", err);
    state.runsByChat[chatId] = [];
  }
}

function reportsForActiveChat() {
  const id = state.ui.activeChatId;
  if (!id) return [];
  return state.reportsByChat[id] ?? [];
}

// ============================================================
// Workspace render
// ============================================================

function renderWorkspace() {
  if (!state.account) {
    showLogin();
    return;
  }
  renderTopBar();
  renderAccountCard();
  renderFilters();
  renderChatList();
  renderHero();
  renderConfigPanel();
  renderReportList();
  renderReportDetail();
  renderRunsPanel();
  icons();
}

function renderTopBar() {
  $("#sessionChipText").textContent = `已连接 · ${state.account.account_username ?? state.account.phone_e164 ?? "Telegram"}`;
  $("#accountAvatar").textContent = avatarSeedFor(state.account.account_display_name || state.account.account_username);
}

function renderAccountCard() {
  const seed = avatarSeedFor(state.account.account_display_name || state.account.account_username);
  $("#accountAvatarBig").textContent = seed;
  $("#accountName").textContent = state.account.account_display_name ?? state.account.account_username ?? "Telegram user";
  $("#accountMeta").textContent = `${state.account.account_username ?? ""} · ${state.account.phone_e164 ?? ""}`.replace(/^ · /, "");

  const total = state.chats.length;
  const auto = state.chats.filter((e) => e.binding?.auto_summary_enabled).length;
  $("#totalChats").textContent = total;
  $("#autoChats").textContent = auto;
  $("#totalReports").textContent = state.totalReportsCount;
}

function renderFilters() {
  const bar = $("#filterBar");
  bar.innerHTML = FILTERS.map((f) => {
    const active = state.ui.filter === f.id;
    return `
      <button data-filter="${f.id}" class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition ${
      active ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/60"
    }">${escapeHtml(f.label)}</button>
    `;
  }).join("");
  bar.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.ui.filter = btn.dataset.filter;
      saveUi();
      renderFilters();
      renderChatList();
    });
  });
}

function chatItemClasses(isActive) {
  const base = "w-full p-3 rounded-xl border transition text-left";
  return isActive
    ? `${base} border-sky-500/40 bg-sky-500/5 shadow-lg shadow-sky-500/5`
    : `${base} border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/70 hover:border-zinc-700`;
}

function unreadBadgeHtml(count) {
  if (!count || count <= 0) return "";
  const label = count > 99 ? "99+" : String(count);
  return `<span class="ml-auto flex-shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-500/90 text-white text-[10px] font-semibold grid place-items-center" title="未读报告">${label}</span>`;
}

function chatItemHtml(entry, isActive) {
  const { chat, binding } = entry;
  const status = deriveStatus(chat.id, binding);
  const sm = statusMeta(status);
  const typeMeta = chatTypeMeta(chat.chat_type);
  const autoEnabled = !!binding?.auto_summary_enabled;
  const pinned = !!binding?.pinned_at;
  const lastRun = binding?.last_run_at ?? null;
  const seed = avatarSeedFor(chat.title);
  return `
    <div class="relative group">
      <button data-chat-id="${escapeHtml(chat.id)}" class="${chatItemClasses(isActive)}">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-lg ${gradientFor(seed)} grid place-items-center text-xs font-semibold text-white shadow flex-shrink-0">
            ${escapeHtml(seed)}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 pr-6">
              <h3 class="text-sm font-medium truncate ${isActive ? "text-zinc-100" : "text-zinc-200"}">${escapeHtml(chat.title)}</h3>
              ${autoEnabled ? '<span class="w-1.5 h-1.5 rounded-full bg-sky-400 flex-shrink-0" title="已开自动"></span>' : ""}
              ${unreadBadgeHtml(state.unreadCountsByChat[chat.id] ?? 0)}
            </div>
            <p class="text-xs text-zinc-500 truncate mt-0.5 flex items-center gap-1">
              <i data-lucide="${typeMeta.icon}" class="w-3 h-3"></i>
              ${formatNumber(chat.member_count)} · ${escapeHtml(typeMeta.label)}
            </p>
            <div class="flex items-center gap-1.5 mt-2">
              <span class="px-1.5 py-0.5 text-[10px] font-medium rounded border ${sm.badge}">${escapeHtml(sm.label)}</span>
              <span class="text-[11px] text-zinc-600">${escapeHtml(formatRelative(lastRun))}</span>
            </div>
          </div>
        </div>
      </button>
      <button data-pin-chat="${escapeHtml(chat.id)}" type="button"
        title="${pinned ? "取消置顶" : "置顶"}"
        class="absolute top-2 right-2 w-6 h-6 grid place-items-center rounded-md transition z-10 ${
          pinned
            ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 opacity-100"
            : "text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-70"
        }">
        <i data-lucide="${pinned ? 'pin' : 'pin-off'}" class="w-3.5 h-3.5"></i>
      </button>
    </div>
  `;
}

function sectionHeaderHtml(key, icon, label, count, collapsed) {
  return `
    <button type="button" data-section-toggle="${key}" class="group w-full flex items-center gap-2 px-1 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition">
      <i data-lucide="chevron-down" class="w-3 h-3 transition-transform ${collapsed ? "-rotate-90" : ""}"></i>
      <i data-lucide="${icon}" class="w-3 h-3"></i>
      <span>${escapeHtml(label)}</span>
      <span class="ml-auto font-mono text-zinc-600 group-hover:text-zinc-400">${count}</span>
    </button>
  `;
}

function renderChatList() {
  const list = $("#sourceList");
  const visible = getVisibleChats();
  $("#sourceCount").textContent = visible.length;

  if (!visible.length) {
    list.innerHTML = `
      <div class="py-10 text-center">
        <div class="w-10 h-10 mx-auto rounded-lg bg-zinc-900 border border-zinc-800 grid place-items-center mb-3">
          <i data-lucide="search-x" class="w-4 h-4 text-zinc-500"></i>
        </div>
        <p class="text-xs text-zinc-500">${state.chats.length === 0 ? "还没有同步聊天" : "没有匹配的聊天"}</p>
        <p class="text-[11px] text-zinc-600 mt-1">${state.chats.length === 0 ? "点右上「重新同步」" : "试试切换筛选"}</p>
      </div>
    `;
    icons();
    return;
  }

  const pinned = visible.filter((e) => !!e.binding?.pinned_at);
  const pinnedIds = new Set(pinned.map((e) => e.chat.id));
  const rest = visible.filter((e) => !pinnedIds.has(e.chat.id));
  const groups = rest.filter((e) => e.chat.chat_type === "group" || e.chat.chat_type === "supergroup");
  const channels = rest.filter((e) => e.chat.chat_type === "channel");
  const others = rest.filter((e) => !["group", "supergroup", "channel"].includes(e.chat.chat_type));

  const section = (key, icon, label, entries) => {
    const collapsed = !!state.ui.collapsedSections?.[key];
    return `
      <div>
        ${sectionHeaderHtml(key, icon, label, entries.length, collapsed)}
        <div data-section-body="${key}" class="space-y-2 ${collapsed ? "hidden" : ""}">
          ${entries.map((e) => chatItemHtml(e, e.chat.id === state.ui.activeChatId)).join("")}
        </div>
      </div>
    `;
  };

  const chunks = [];
  if (pinned.length) chunks.push(section("pinned", "pin", "置顶", pinned));
  if (groups.length) chunks.push(section("groups", "users-round", "群聊", groups));
  if (channels.length) chunks.push(section("channels", "megaphone", "频道", channels));
  if (others.length) chunks.push(section("others", "message-square", "其他", others));

  list.innerHTML = chunks.join("");

  list.querySelectorAll("[data-chat-id]").forEach((btn) => {
    btn.addEventListener("click", () => selectChat(btn.dataset.chatId));
  });
  list.querySelectorAll("[data-pin-chat]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePin(btn.dataset.pinChat);
    });
  });
  list.querySelectorAll("[data-section-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sectionToggle;
      state.ui.collapsedSections = state.ui.collapsedSections || {};
      const collapsed = !state.ui.collapsedSections[key];
      state.ui.collapsedSections[key] = collapsed;
      saveUi();
      // toggle in place so the other section doesn't re-render / flicker
      const body = list.querySelector(`[data-section-body="${key}"]`);
      body?.classList.toggle("hidden", collapsed);
      btn.firstElementChild?.classList.toggle("-rotate-90", collapsed);
    });
  });

  icons();
}

function updateChatListActiveState() {
  $$("#sourceList [data-chat-id]").forEach((btn) => {
    const active = btn.dataset.chatId === state.ui.activeChatId;
    btn.className = chatItemClasses(active);
    const title = btn.querySelector("h3");
    if (title) title.className = `text-sm font-medium truncate ${active ? "text-zinc-100" : "text-zinc-200"}`;
  });
}

function updateSingleChatItem(chatId) {
  const existing = document.querySelector(`#sourceList [data-chat-id="${CSS.escape(chatId)}"]`);
  const entry = getChatEntry(chatId);
  if (!existing || !entry) return;
  const tmp = document.createElement("template");
  tmp.innerHTML = chatItemHtml(entry, chatId === state.ui.activeChatId).trim();
  const fresh = tmp.content.firstElementChild;
  fresh.addEventListener("click", () => selectChat(chatId));
  existing.replaceWith(fresh);
  icons();
}

async function selectChat(chatId) {
  if (state.ui.activeChatId === chatId) return;
  state.ui.activeChatId = chatId;
  state.ui.activeReportId = null;
  state.runsExpanded = false;
  state.selectedReports.clear();
  saveUi();
  closeSidebar();  // auto-close mobile drawer
  updateChatListActiveState();
  renderHero();
  renderConfigPanel();
  renderReportList();
  renderReportDetail();
  renderRunsPanel();
  icons();
  const jobs = [];
  if (!state.reportsByChat[chatId]) jobs.push(loadReportsForChat(chatId));
  if (!state.previewByChat[chatId]) jobs.push(loadPreviewForChat(chatId));
  await Promise.all(jobs);
  renderHero();
  renderReportList();
  renderReportDetail();
  icons();
}

function renderPendingStat(chatId) {
  const p = state.previewByChat[chatId];
  const refreshing = state.refreshingPreview === chatId;
  const refreshIcon = refreshing ? "loader-2" : "refresh-cw";
  const refreshClass = refreshing ? "animate-spin" : "";
  const refreshBtn = `
    <button type="button" id="refreshPreviewBtn" title="重新拉取最新待处理数量"
      class="ml-auto w-5 h-5 grid place-items-center rounded text-zinc-500 hover:text-sky-400 hover:bg-zinc-900 transition disabled:opacity-50"
      ${refreshing ? "disabled" : ""}>
      <i data-lucide="${refreshIcon}" class="w-3 h-3 ${refreshClass}"></i>
    </button>
  `;

  let valueHtml;
  let subHtml = "";
  let tone = "zinc";

  if (p == null) {
    valueHtml = `<span class="text-lg font-semibold text-zinc-100">…</span>`;
  } else {
    const text = p.pending_count ?? 0;
    const total = p.pending_total ?? text;
    const capped = !!p.pending_capped;
    const suffix = capped ? "+" : "";
    tone = text > 0 ? "sky" : "zinc";
    const valueColor = { sky: "text-sky-400", zinc: "text-zinc-100" }[tone];

    if (total === 0) {
      valueHtml = `<span class="text-lg font-semibold ${valueColor}">无新消息</span>`;
    } else {
      valueHtml = `<span class="text-lg font-semibold ${valueColor}">${formatNumber(text)}${suffix} 条</span>`;
      const skipped = total - text;
      if (skipped > 0) {
        subHtml = `<div class="text-[10px] text-zinc-500 mt-0.5">含媒体/系统 ${formatNumber(total)}${suffix} 条，文本 ${formatNumber(text)}${suffix} 进入总结</div>`;
      } else {
        subHtml = `<div class="text-[10px] text-zinc-500 mt-0.5">全部为文本</div>`;
      }
    }
  }

  return `
    <div class="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3">
      <div class="flex items-center gap-1.5 mb-1.5 text-zinc-500">
        <i data-lucide="inbox" class="w-3.5 h-3.5"></i>
        <span class="text-[10px] uppercase tracking-wider font-medium">待处理</span>
        ${refreshBtn}
      </div>
      ${valueHtml}
      ${subHtml}
    </div>
  `;
}

function renderCursorStat(chatId) {
  const p = state.previewByChat[chatId];
  if (!p || !p.cursor_at) {
    return `
      <div class="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3">
        <div class="flex items-center gap-1.5 mb-1.5 text-zinc-500">
          <i data-lucide="bookmark" class="w-3.5 h-3.5"></i>
          <span class="text-[10px] uppercase tracking-wider font-medium">游标位置</span>
        </div>
        <div class="text-lg font-semibold text-zinc-500">未设定</div>
        <div class="text-[10px] text-zinc-600 mt-0.5">尚未生成过报告</div>
      </div>
    `;
  }
  const tzLabel = browserTimezoneLabel();
  const tooltip = `${formatLocalFull(p.cursor_at)} (${tzLabel})`;
  const big = formatLocalSmart(p.cursor_at);
  const msgId = p.cursor_message_id ? `msg #${p.cursor_message_id}` : "";
  return `
    <div class="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3" title="${escapeHtml(tooltip)}">
      <div class="flex items-center gap-1.5 mb-1.5 text-zinc-500">
        <i data-lucide="bookmark" class="w-3.5 h-3.5"></i>
        <span class="text-[10px] uppercase tracking-wider font-medium">游标位置</span>
      </div>
      <div class="text-base font-semibold text-violet-400 leading-tight">${escapeHtml(big)}</div>
      ${msgId ? `<div class="text-[10px] text-zinc-500 font-mono mt-0.5">${escapeHtml(msgId)} · ${escapeHtml(formatRelative(p.cursor_at))}</div>` : ""}
    </div>
  `;
}

function nextRunSuffix(chatId) {
  const p = state.previewByChat[chatId];
  if (!p || !p.next_run_at) return "";
  const ts = new Date(p.next_run_at).getTime();
  const diff = Math.round((ts - Date.now()) / 60_000);
  if (diff <= 0) return " · 待触发";
  if (diff < 60) return ` · ${diff}m 后`;
  const hours = Math.floor(diff / 60);
  return ` · ${hours}h${diff % 60}m 后`;
}

function renderStat(icon, value, label, tone = "zinc") {
  const color = {
    sky: "text-sky-400",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    violet: "text-violet-400",
    zinc: "text-zinc-100",
  }[tone] ?? "text-zinc-100";
  return `
    <div class="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3">
      <div class="flex items-center gap-1.5 mb-1.5 text-zinc-500">
        <i data-lucide="${icon}" class="w-3.5 h-3.5"></i>
        <span class="text-[10px] uppercase tracking-wider font-medium">${escapeHtml(label)}</span>
      </div>
      <div class="text-lg font-semibold ${color}">${escapeHtml(String(value))}</div>
    </div>
  `;
}

function renderHero() {
  const entry = getChatEntry(state.ui.activeChatId);
  const card = $("#heroCard");

  if (!entry) {
    card.innerHTML = `
      <div class="py-10 text-center">
        <div class="w-14 h-14 mx-auto rounded-2xl bg-zinc-900 border border-zinc-800 grid place-items-center mb-4">
          <i data-lucide="message-square-off" class="w-5 h-5 text-zinc-500"></i>
        </div>
        <h2 class="text-base font-medium mb-1">${state.chats.length === 0 ? "还没有同步聊天" : "选一个聊天源"}</h2>
        <p class="text-sm text-zinc-500">${state.chats.length === 0 ? "点击顶部的「重新同步」从 Telegram 拉群与频道" : "从左侧列表点选"}</p>
      </div>
    `;
    return;
  }

  const { chat, binding } = entry;
  const status = deriveStatus(chat.id, binding);
  const reports = reportsForActiveChat();
  const latest = reports[0];
  const tm = chatTypeMeta(chat.chat_type);
  const running = status === "running";
  const cadenceLabel = binding?.auto_summary_enabled
    ? FREQUENCIES.find((f) => f.id === binding.frequency)?.label ?? "—"
    : "手动";
  const cadenceTone = binding?.auto_summary_enabled ? "sky" : "zinc";
  const seed = avatarSeedFor(chat.title);

  card.innerHTML = `
    <div class="flex items-start gap-4 mb-6">
      <div class="w-14 h-14 rounded-2xl ${gradientFor(seed)} grid place-items-center text-base font-semibold text-white shadow-lg flex-shrink-0">
        ${escapeHtml(seed)}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 mb-1 text-xs text-zinc-500">
          <i data-lucide="${tm.icon}" class="w-3.5 h-3.5"></i>
          <span>${escapeHtml(tm.label)} · ${formatNumber(chat.member_count)} 成员</span>
        </div>
        <h2 class="text-xl font-semibold tracking-tight truncate text-zinc-100">${escapeHtml(chat.title)}</h2>
        <p class="text-sm text-zinc-400 mt-1 line-clamp-2">${escapeHtml(chat.description ?? "")}</p>
      </div>
      <div class="flex flex-shrink-0 items-stretch gap-1.5">
        <button id="generateBtn" type="button" title="从游标位置到最新消息生成一份报告，并把游标推进到此刻" class="px-4 py-2.5 bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium rounded-lg transition flex items-center gap-2 disabled:opacity-60 disabled:cursor-progress shadow-lg shadow-sky-500/20" ${running ? "disabled" : ""}>
          ${running
            ? '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>生成中</span>'
            : '<i data-lucide="sparkles" class="w-4 h-4"></i><span>生成报告</span>'}
        </button>
        <button id="rangeOpenBtn" type="button" title="按时间范围生成（一次性，不动游标）" class="w-10 grid place-items-center bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-lg transition disabled:opacity-50" ${running ? "disabled" : ""}>
          <i data-lucide="calendar-range" class="w-4 h-4"></i>
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5">
      ${renderPendingStat(chat.id)}
      ${renderStat("zap", cadenceLabel + (nextRunSuffix(chat.id) || ""), "调度", cadenceTone)}
      ${renderCursorStat(chat.id)}
      ${renderStat("file-text", reports.length, "历史报告", "emerald")}
    </div>

    ${latest
      ? `
      <div class="p-4 bg-zinc-950/60 border border-zinc-800 rounded-xl">
        <div class="flex items-center gap-1.5 mb-2">
          <i data-lucide="sparkles" class="w-3.5 h-3.5 text-sky-400"></i>
          <span class="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">最新执行摘要</span>
          <span class="text-[11px] text-zinc-600 font-mono ml-auto">${escapeHtml(formatAbsolute(latest.generated_at))}</span>
        </div>
        <p class="text-sm text-zinc-300 leading-relaxed">${escapeHtml(latest.executive_summary ?? "")}</p>
      </div>
      `
      : `
      <div class="p-4 bg-sky-500/5 border border-sky-500/15 rounded-xl flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-sky-500/10 border border-sky-500/20 grid place-items-center flex-shrink-0">
          <i data-lucide="sparkles" class="w-4 h-4 text-sky-400"></i>
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-zinc-100">还没有报告</p>
          <p class="text-xs text-zinc-500 mt-0.5">点击右上角「生成报告」让 AI 整理最近的对话</p>
        </div>
      </div>
      `}
  `;

  $("#generateBtn").addEventListener("click", runSummaryNow);
  $("#rangeOpenBtn")?.addEventListener("click", openRangeModal);
  $("#refreshPreviewBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    refreshActivePreview();
  });
}

async function refreshActivePreview() {
  const chatId = state.ui.activeChatId;
  if (!chatId || state.refreshingPreview === chatId) return;
  state.refreshingPreview = chatId;
  renderHero();
  icons();
  try {
    await loadPreviewForChat(chatId);
  } finally {
    state.refreshingPreview = null;
    renderHero();
    icons();
  }
}

function renderConfigPanel() {
  const card = $("#configCard");
  const entry = getChatEntry(state.ui.activeChatId);
  if (!entry) {
    card.innerHTML = `<div class="text-sm text-zinc-500 text-center py-6">先在左侧选一个聊天，再调整自动化设置。</div>`;
    return;
  }

  const { chat, binding } = entry;
  const autoEnabled = !!binding?.auto_summary_enabled;
  const frequency = binding?.frequency ?? "manual";
  const language = binding?.preferred_language ?? "zh-CN";
  const firstMode = binding?.first_summary_mode ?? "from_now";
  const template = binding?.template_key ?? "default";
  const cursorLocked = !!state.previewByChat[chat.id]?.cursor_message_id;
  const hint = cursorLocked
    ? "已存在游标，「首次起点」对此聊天不再生效；后续运行从游标继续增量。"
    : (FIRST_SUMMARY_MODES.find((m) => m.id === firstMode)?.hint ?? "");
  state.ui.collapsedSections = state.ui.collapsedSections || {};
  const collapsed = !!state.ui.collapsedSections.config;

  // Compact summary visible when collapsed.
  const freqLabel = FREQUENCIES.find((f) => f.id === frequency)?.label ?? frequency;
  const langLabel = LANGUAGES.find((l) => l.id === language)?.label ?? language;
  const tplLabel = TEMPLATES.find((t) => t.id === template)?.label ?? template;
  const summaryBits = autoEnabled
    ? [`自动 · ${freqLabel}`, langLabel, tplLabel]
    : ["手动", langLabel, tplLabel];

  card.innerHTML = `
    <button type="button" id="configToggleBtn" class="w-full flex items-center justify-between gap-3 text-left hover:opacity-80 transition">
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold flex items-center gap-2">
          <i data-lucide="settings-2" class="w-4 h-4 text-zinc-500"></i>
          <span>自动化配置</span>
          <span class="px-1.5 py-0.5 text-[10px] font-medium rounded border ${autoEnabled ? "bg-sky-500/10 text-sky-400 border-sky-500/30" : "bg-zinc-800 text-zinc-400 border-zinc-700"}">
            ${autoEnabled ? "已开启" : "未开启"}
          </span>
        </h3>
        <p class="text-xs text-zinc-500 mt-1 truncate">${escapeHtml(summaryBits.join(" · "))}</p>
      </div>
      <i data-lucide="chevron-down" id="configChevron" class="w-4 h-4 text-zinc-500 transition-transform flex-shrink-0 ${collapsed ? "-rotate-90" : ""}"></i>
    </button>

    <div id="configBody" class="${collapsed ? "hidden" : ""} mt-5">
      <div class="flex items-center justify-between p-4 bg-zinc-950/60 border border-zinc-800 rounded-xl mb-4">
        <div>
          <h4 class="text-sm font-medium text-zinc-100">开启自动总结</h4>
          <p class="text-xs text-zinc-500 mt-0.5">由调度器按频率拉取新消息并生成报告</p>
        </div>
        <label class="relative inline-flex items-center cursor-pointer flex-shrink-0">
          <input type="checkbox" id="autoToggle" class="sr-only peer" ${autoEnabled ? "checked" : ""}>
          <div class="w-11 h-6 bg-zinc-800 border border-zinc-700 rounded-full peer-checked:bg-sky-500 peer-checked:border-sky-400 transition-colors"></div>
          <span class="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow"></span>
        </label>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="block">
          <span class="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">总结频率</span>
          <select id="frequencySelect" ${autoEnabled ? "" : "disabled"} class="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed">
            ${FREQUENCIES.map((f) => `<option value="${f.id}" ${f.id === frequency ? "selected" : ""}>${escapeHtml(f.label)}</option>`).join("")}
          </select>
        </label>

        <label class="block">
          <span class="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">总结语言</span>
          <select id="languageSelect" class="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition">
            ${LANGUAGES.map((l) => `<option value="${l.id}" ${l.id === language ? "selected" : ""}>${escapeHtml(l.label)}</option>`).join("")}
          </select>
        </label>

        <label class="block">
          <span class="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span>首次起点</span>
            ${cursorLocked ? '<span class="text-[10px] normal-case tracking-normal text-zinc-500 font-normal">游标已建立 · 已锁定</span>' : ""}
          </span>
          <select id="firstModeSelect" ${cursorLocked ? "disabled" : ""} class="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed">
            ${FIRST_SUMMARY_MODES.map((m) => `<option value="${m.id}" ${m.id === firstMode ? "selected" : ""}>${escapeHtml(m.label)}</option>`).join("")}
          </select>
        </label>

        <label class="block">
          <span class="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span>提示词模板</span>
            <button id="viewTemplateBtn" type="button" class="text-sky-400 hover:text-sky-300 normal-case tracking-normal text-[11px] flex items-center gap-1">
              <i data-lucide="eye" class="w-3 h-3"></i>
              <span>查看</span>
            </button>
          </span>
          <select id="templateSelect" class="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition">
            ${TEMPLATES.map((t) => `<option value="${t.id}" ${t.id === template ? "selected" : ""}>${escapeHtml(t.label)}</option>`).join("")}
          </select>
        </label>
      </div>

      <div class="mt-4 p-3 bg-zinc-950/50 border border-zinc-800 rounded-lg flex items-start gap-2">
        <i data-lucide="info" class="w-3.5 h-3.5 text-zinc-500 mt-0.5 flex-shrink-0"></i>
        <p class="text-xs text-zinc-400 leading-relaxed">${escapeHtml(hint)}</p>
      </div>
    </div>
  `;

  $("#configToggleBtn").addEventListener("click", () => {
    state.ui.collapsedSections = state.ui.collapsedSections || {};
    const next = !state.ui.collapsedSections.config;
    state.ui.collapsedSections.config = next;
    saveUi();
    $("#configBody")?.classList.toggle("hidden", next);
    $("#configChevron")?.classList.toggle("-rotate-90", next);
  });

  $("#autoToggle").addEventListener("change", (e) => {
    patchBinding(chat.id, { auto_summary_enabled: e.target.checked });
  });
  $("#frequencySelect").addEventListener("change", (e) => {
    patchBinding(chat.id, { frequency: e.target.value });
  });
  $("#languageSelect").addEventListener("change", (e) => {
    patchBinding(chat.id, { preferred_language: e.target.value });
  });
  $("#firstModeSelect").addEventListener("change", (e) => {
    patchBinding(chat.id, { first_summary_mode: e.target.value });
  });
  $("#templateSelect").addEventListener("change", (e) => {
    patchBinding(chat.id, { template_key: e.target.value });
  });
  $("#viewTemplateBtn")?.addEventListener("click", () => {
    openTemplateModal($("#templateSelect").value);
  });
}

// ============================================================
// Range-run modal
// ============================================================

function rangePresetBounds(id) {
  const now = new Date();
  const z = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  switch (id) {
    case "last_1h": return { from: new Date(+now - 3600e3), to: now };
    case "last_6h": return { from: new Date(+now - 6*3600e3), to: now };
    case "last_24h": return { from: new Date(+now - 24*3600e3), to: now };
    case "last_7d": return { from: new Date(+now - 7*24*3600e3), to: now };
    case "today": return { from: z(now), to: now };
    case "yesterday": {
      const y = z(now); y.setDate(y.getDate() - 1);
      const end = new Date(y); end.setHours(23,59,59,999);
      return { from: y, to: end };
    }
    default: return null;
  }
}

function openRangeModal() {
  $("#rangeModal").classList.remove("hidden");
  // seed the custom fields with "last 6h"
  const { from } = rangePresetBounds("last_6h");
  const toLocalInput = (d) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  $("#rangeFromInput").value = toLocalInput(from);
  $("#rangeToInput").value = "";
  icons();
}

function closeRangeModal() {
  $("#rangeModal").classList.add("hidden");
}

async function handleRangePreset(presetId) {
  const b = rangePresetBounds(presetId);
  if (!b) return;
  const chatId = state.ui.activeChatId;
  if (!chatId) return;
  closeRangeModal();
  await runSummaryRange(chatId, b.from.toISOString(), b.to.toISOString());
}

async function handleRangeCustom() {
  const fromRaw = $("#rangeFromInput").value;
  const toRaw = $("#rangeToInput").value;
  if (!fromRaw) {
    toast("请填写起始时间", "alert-circle");
    return;
  }
  const fromDate = new Date(fromRaw);
  const toDate = toRaw ? new Date(toRaw) : null;
  if (toDate && toDate <= fromDate) {
    toast("结束时间必须晚于起始时间", "alert-circle");
    return;
  }
  const chatId = state.ui.activeChatId;
  if (!chatId) return;
  closeRangeModal();
  await runSummaryRange(chatId, fromDate.toISOString(), toDate ? toDate.toISOString() : null);
}

// ============================================================
// Runs history panel
// ============================================================

async function toggleRunsPanel() {
  state.runsExpanded = !state.runsExpanded;
  const chatId = state.ui.activeChatId;
  if (state.runsExpanded && chatId && !state.runsByChat[chatId]) {
    await loadRunsForChat(chatId);
  }
  renderRunsPanel();
  icons();
}

function renderRunsPanel() {
  const list = $("#runsList");
  const hint = $("#runsHint");
  const chev = $("#runsChevron");
  const chatId = state.ui.activeChatId;

  chev.classList.toggle("-rotate-90", !state.runsExpanded);
  if (state.runsExpanded) list.classList.remove("hidden");
  else list.classList.add("hidden");

  if (!chatId) {
    hint.textContent = "选中聊天后可查看";
    list.innerHTML = "";
    return;
  }
  const rows = state.runsByChat[chatId] ?? null;
  if (!state.runsExpanded) {
    hint.textContent = rows ? `${rows.length} 次` : "点击展开";
    return;
  }
  if (rows == null) {
    hint.textContent = "加载中…";
    list.innerHTML = `<div class="py-6 text-center text-xs text-zinc-500">加载中…</div>`;
    return;
  }
  if (!rows.length) {
    hint.textContent = "尚无运行记录";
    list.innerHTML = `<div class="py-6 text-center text-xs text-zinc-500">还没跑过</div>`;
    return;
  }
  hint.textContent = `${rows.length} 次 · 含失败/跳过`;

  list.innerHTML = rows.map((r) => {
    const sm = statusMeta(r.status);
    const duration = (r.started_at && r.finished_at)
      ? `${Math.max(0, Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 100) / 10)}s`
      : "—";
    const trigger = r.trigger_source || "manual";
    const icon = r.status === "failed" ? "alert-triangle" : r.status === "skipped" ? "minus" : r.status === "running" ? "loader-2" : "check";
    return `
      <div class="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-900/40 border border-transparent">
        <div class="w-6 h-6 rounded grid place-items-center flex-shrink-0 border ${sm.badge}">
          <i data-lucide="${icon}" class="w-3 h-3 ${r.status === 'running' ? 'animate-spin' : ''}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 text-xs">
            <span class="font-mono text-zinc-400">${escapeHtml(formatAbsolute(r.created_at))}</span>
            <span class="px-1.5 py-0.5 text-[10px] font-medium rounded border ${sm.badge}">${escapeHtml(sm.label)}</span>
            <span class="text-[10px] text-zinc-600 font-mono">${escapeHtml(trigger)}</span>
          </div>
          ${r.error_message ? `<p class="text-[11px] text-rose-400 mt-0.5 truncate">${escapeHtml(r.error_message)}</p>` : ""}
        </div>
        <div class="text-[10px] text-zinc-500 font-mono text-right flex-shrink-0">
          <div>${r.fetched_message_count} msg</div>
          <div>${escapeHtml(duration)} · ${r.input_token_count != null ? `${r.input_token_count + (r.output_token_count ?? 0)} tok` : "—"}</div>
        </div>
      </div>
    `;
  }).join("");
}

function openTemplateModal(templateId) {
  const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  if (!tpl) return;
  $("#templateModalTitle").innerHTML = `<i data-lucide="sparkles" class="w-4 h-4 text-sky-400"></i><span>提示词模板 · ${escapeHtml(tpl.label)}</span>`;
  $("#templateModalDesc").textContent = tpl.description || "";
  $("#templatePromptView").textContent = tpl.system_prompt || "(此模板未设置提示词内容)";
  $("#templateModal").classList.remove("hidden");
  icons();
}

function closeTemplateModal() {
  $("#templateModal").classList.add("hidden");
}

// ============================================================
// Mobile: sidebar drawer + kebab menu
// ============================================================

function openSidebar() {
  const side = $("#sidebar");
  const bd = $("#sidebarBackdrop");
  if (!side) return;
  side.classList.remove("hidden");
  side.classList.add("is-open");
  bd?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeSidebar() {
  const side = $("#sidebar");
  const bd = $("#sidebarBackdrop");
  if (!side) return;
  side.classList.remove("is-open");
  // On <lg, after transition, hide with display:none via media-query-aware class.
  // Simple approach: always hide on mobile after a brief delay, leave alone on lg+.
  if (window.matchMedia("(max-width: 1023px)").matches) {
    setTimeout(() => {
      if (!side.classList.contains("is-open")) side.classList.add("hidden");
    }, 220);
  }
  bd?.classList.add("hidden");
  document.body.style.overflow = "";
}

function toggleSidebar() {
  const side = $("#sidebar");
  if (side?.classList.contains("is-open")) closeSidebar();
  else openSidebar();
}

function openMobileMenu() {
  $("#mobileMenu")?.classList.remove("hidden");
}

function closeMobileMenu() {
  $("#mobileMenu")?.classList.add("hidden");
}

function toggleMobileMenu() {
  if ($("#mobileMenu")?.classList.contains("hidden")) openMobileMenu();
  else closeMobileMenu();
}

function reportItemClasses(isActive) {
  const base = "w-full p-4 rounded-xl border transition";
  return isActive
    ? `${base} border-sky-500/40 bg-sky-500/5`
    : `${base} border-zinc-800 bg-zinc-950/40 hover:bg-zinc-900/60 hover:border-zinc-700`;
}

function reportItemHtml(r, isActive) {
  const sm = statusMeta("success"); // reports are always successful entries
  const selected = state.selectedReports.has(r.id);
  return `
    <div class="relative ${reportItemClasses(isActive)} ${selected ? "ring-1 ring-rose-500/40" : ""}">
      <div class="flex items-start gap-3">
        <label class="flex-shrink-0 mt-1 cursor-pointer" title="选中以批量操作">
          <input
            type="checkbox"
            data-select-report="${escapeHtml(r.id)}"
            ${selected ? "checked" : ""}
            class="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-rose-500 focus:ring-rose-500/30"
          >
        </label>
        <button type="button" data-report-id="${escapeHtml(r.id)}" class="flex-1 min-w-0 text-left flex items-start gap-3 group">
          <div class="w-9 h-9 rounded-lg border grid place-items-center flex-shrink-0 ${sm.badge}">
            <i data-lucide="file-check-2" class="w-4 h-4"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1.5">
              <span class="text-[11px] text-zinc-500 font-mono">${escapeHtml(formatAbsolute(r.generated_at))}</span>
              <span class="px-1.5 py-0.5 text-[10px] font-medium rounded border ${sm.badge}">报告</span>
              ${!r.read_at ? '<span class="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" title="未读"></span>' : ""}
            </div>
            <h4 class="text-sm ${!r.read_at ? "font-bold" : "font-semibold"} text-zinc-100 line-clamp-2 leading-snug">${escapeHtml(r.title)}</h4>
            <p class="text-xs text-zinc-500 line-clamp-2 mt-1">${escapeHtml(r.executive_summary ?? "")}</p>
            <div class="flex items-center gap-3 mt-2 text-[11px] text-zinc-600 flex-wrap">
              <span class="flex items-center gap-1"><i data-lucide="languages" class="w-3 h-3"></i>${escapeHtml(r.language ?? "zh-CN")}</span>
              ${reportCoveredRange(r) ? `<span class="flex items-center gap-1 font-mono"><i data-lucide="clock" class="w-3 h-3"></i>${escapeHtml(reportCoveredRange(r))}</span>` : ""}
            </div>
          </div>
        </button>
        <button type="button" data-delete-report="${escapeHtml(r.id)}" title="删除此报告"
          class="flex-shrink-0 w-7 h-7 grid place-items-center rounded-md text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition opacity-60 hover:opacity-100">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    </div>
  `;
}

function updateReportListActiveState() {
  $$("#reportList [data-report-id]").forEach((btn) => {
    const card = btn.closest(".relative");
    if (!card) return;
    const isActive = btn.dataset.reportId === state.ui.activeReportId;
    const selected = state.selectedReports.has(btn.dataset.reportId);
    card.className = `relative ${reportItemClasses(isActive)} ${selected ? "ring-1 ring-rose-500/40" : ""}`;
  });
}

function selectReport(reportId) {
  // click same report again → collapse
  if (state.ui.activeReportId === reportId) {
    state.ui.activeReportId = null;
    saveUi();
    updateReportListActiveState();
    renderReportDetail();
    return;
  }
  state.ui.activeReportId = reportId;
  saveUi();
  maybeAutoMarkRead(reportId);
  updateReportListActiveState();
  renderReportDetail();
  icons();
  $("#reportDetailCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function findReportEverywhere(reportId) {
  for (const list of Object.values(state.reportsByChat)) {
    const hit = list?.find((r) => r.id === reportId);
    if (hit) return hit;
  }
  return null;
}

async function maybeAutoMarkRead(reportId) {
  const r = findReportEverywhere(reportId);
  if (!r || r.read_at) return;
  const chatId = state.ui.activeChatId;
  r.read_at = new Date().toISOString();
  bumpUnread(chatId, -1);
  renderReportList();
  updateSingleChatItem(chatId);
  icons();
  try {
    await apiPost(`/api/reports/${reportId}/read`);
  } catch (err) {
    console.warn("markRead failed", err);
  }
}

async function markReportUnread(reportId) {
  const r = findReportEverywhere(reportId);
  if (!r || !r.read_at) return;
  const chatId = state.ui.activeChatId;
  r.read_at = null;
  bumpUnread(chatId, +1);
  renderReportList();
  renderReportDetail();
  updateSingleChatItem(chatId);
  icons();
  try {
    await apiPost(`/api/reports/${reportId}/unread`);
    toast("已标为未读", "mail");
  } catch (err) {
    // roll back optimistic change on failure
    r.read_at = new Date().toISOString();
    bumpUnread(chatId, -1);
    renderReportList();
    renderReportDetail();
    updateSingleChatItem(chatId);
    icons();
    toast(`标记失败：${err.detail || err.message}`, "alert-circle");
  }
}

async function markAllReadForActiveChat() {
  const chatId = state.ui.activeChatId;
  if (!chatId) return;
  const unread = (state.reportsByChat[chatId] ?? []).filter((r) => !r.read_at);
  if ((state.unreadCountsByChat[chatId] ?? 0) === 0 && unread.length === 0) {
    toast("已经全部已读", "check");
    return;
  }
  try {
    const res = await apiPost(`/api/reports/mark-all-read?chat_id=${encodeURIComponent(chatId)}`);
    const now = new Date().toISOString();
    for (const r of (state.reportsByChat[chatId] ?? [])) {
      if (!r.read_at) r.read_at = now;
    }
    delete state.unreadCountsByChat[chatId];
    renderReportList();
    renderReportDetail();
    updateSingleChatItem(chatId);
    icons();
    toast(`已标记 ${res?.updated ?? 0} 份为已读`, "check-check");
  } catch (err) {
    toast(`操作失败：${err.detail || err.message}`, "alert-circle");
  }
}

function closeReportDetail() {
  if (!state.ui.activeReportId) return;
  state.ui.activeReportId = null;
  saveUi();
  updateReportListActiveState();
  renderReportDetail();
}

function renderReportList() {
  const list = $("#reportList");
  const title = $("#reportsTitle");
  const hint = $("#reportsHint");
  const entry = getChatEntry(state.ui.activeChatId);
  if (!entry) {
    title.textContent = "历史报告";
    hint.textContent = "";
    list.innerHTML = `<div class="py-8 text-center text-sm text-zinc-500">先选一个聊天源再查看报告</div>`;
    return;
  }

  const allReports = reportsForActiveChat();
  const unreadServerCount = state.unreadCountsByChat[state.ui.activeChatId] ?? 0;
  const reports = state.showUnreadOnly
    ? allReports.filter((r) => !r.read_at)
    : allReports;
  const metaForHint = state.reportsMetaByChat[state.ui.activeChatId] ?? {};
  title.textContent = `${entry.chat.title} 的报告`;
  const baseHint = allReports.length
    ? (metaForHint.hasMore ? `已加载 ${allReports.length} 份（还有更多）` : `共 ${allReports.length} 份`)
    : "尚无报告";
  const unreadHint = unreadServerCount > 0 ? ` · 未读 ${unreadServerCount}` : "";
  hint.textContent = baseHint + unreadHint;

  if (!allReports.length) {
    list.innerHTML = `
      <div class="py-10 text-center">
        <div class="w-12 h-12 mx-auto rounded-xl bg-zinc-950 border border-zinc-800 grid place-items-center mb-3">
          <i data-lucide="file-plus" class="w-5 h-5 text-zinc-500"></i>
        </div>
        <p class="text-sm text-zinc-300 font-medium">还没有报告</p>
        <p class="text-xs text-zinc-500 mt-1">点击顶部「立即生成」创建第一份</p>
      </div>
    `;
    icons();
    return;
  }

  const meta = state.reportsMetaByChat[state.ui.activeChatId] ?? {};
  const selectedCount = state.selectedReports.size;

  const controlsBar = `
    <div class="flex items-center justify-between gap-3 px-1 py-1.5 mb-2 text-xs">
      <label class="flex items-center gap-1.5 text-zinc-400 cursor-pointer select-none" title="只显示未读报告">
        <input type="checkbox" id="reportUnreadOnlyToggle" ${state.showUnreadOnly ? "checked" : ""}
          class="w-3.5 h-3.5 rounded bg-zinc-900 border-zinc-700 text-rose-500 focus:ring-rose-500/30">
        <span>仅看未读${unreadServerCount > 0 ? ` <span class="text-rose-300 font-mono">(${unreadServerCount})</span>` : ""}</span>
      </label>
      <button id="reportMarkAllReadBtn" type="button" ${unreadServerCount === 0 ? "disabled" : ""}
        class="px-2 py-1 text-[11px] font-medium rounded-md border transition flex items-center gap-1
          ${unreadServerCount === 0
            ? "bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed"
            : "bg-zinc-900/60 hover:bg-zinc-800 border-zinc-800 text-zinc-300"}">
        <i data-lucide="check-check" class="w-3 h-3"></i>
        <span>全部已读</span>
      </button>
    </div>
  `;

  const emptyFilter = (state.showUnreadOnly && reports.length === 0)
    ? `
      <div class="py-10 text-center">
        <div class="w-12 h-12 mx-auto rounded-xl bg-zinc-950 border border-zinc-800 grid place-items-center mb-3">
          <i data-lucide="mail-check" class="w-5 h-5 text-zinc-500"></i>
        </div>
        <p class="text-sm text-zinc-300 font-medium">没有未读报告</p>
        <p class="text-xs text-zinc-500 mt-1">取消「仅看未读」查看全部</p>
      </div>`
    : "";

  const bulkBar = selectedCount > 0
    ? `
      <div class="sticky top-0 z-10 flex items-center justify-between gap-3 px-3 py-2 mb-2 rounded-lg bg-rose-500/10 border border-rose-500/30 backdrop-blur">
        <span class="text-xs text-rose-200 font-medium">已选 ${selectedCount} 份</span>
        <div class="flex items-center gap-2">
          <button id="reportClearSelBtn" type="button" class="text-[11px] text-zinc-300 hover:text-white">取消</button>
          <button id="reportBulkDeleteBtn" type="button" class="px-2.5 py-1 bg-rose-500 hover:bg-rose-400 text-white text-xs font-medium rounded-md transition flex items-center gap-1.5">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            <span>删除选中</span>
          </button>
        </div>
      </div>`
    : "";

  const loadMoreBar = meta.hasMore
    ? `
      <div class="pt-2">
        <button id="reportLoadMoreBtn" type="button" ${state.reportsLoadingMore ? "disabled" : ""}
          class="w-full py-2 text-xs font-medium text-zinc-300 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-60">
          ${state.reportsLoadingMore
            ? '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>加载中…</span>'
            : '<i data-lucide="chevron-down" class="w-3.5 h-3.5"></i><span>加载更多</span>'}
        </button>
      </div>`
    : "";

  list.innerHTML = controlsBar
    + bulkBar
    + emptyFilter
    + reports.map((r) => reportItemHtml(r, r.id === state.ui.activeReportId)).join("")
    + loadMoreBar;

  $("#reportUnreadOnlyToggle")?.addEventListener("change", (e) => {
    state.showUnreadOnly = e.target.checked;
    renderReportList();
    icons();
  });
  $("#reportMarkAllReadBtn")?.addEventListener("click", markAllReadForActiveChat);

  list.querySelectorAll("[data-report-id]").forEach((btn) => {
    btn.addEventListener("click", () => selectReport(btn.dataset.reportId));
  });
  list.querySelectorAll("[data-delete-report]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteReport(btn.dataset.deleteReport);
    });
  });
  list.querySelectorAll("[data-select-report]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = cb.dataset.selectReport;
      if (e.target.checked) state.selectedReports.add(id);
      else state.selectedReports.delete(id);
      renderReportList();
      icons();
    });
    cb.addEventListener("click", (e) => e.stopPropagation());
  });
  $("#reportLoadMoreBtn")?.addEventListener("click", loadMoreReports);
  $("#reportBulkDeleteBtn")?.addEventListener("click", bulkDeleteReports);
  $("#reportClearSelBtn")?.addEventListener("click", () => {
    state.selectedReports.clear();
    renderReportList();
    icons();
  });
  icons();
}

function renderDetailSection(icon, label, items, tone) {
  if (!items?.length) return "";
  const toneMap = {
    emerald: "text-emerald-400",
    sky: "text-sky-400",
    violet: "text-violet-400",
    rose: "text-rose-400",
  };
  return `
    <div class="p-4 bg-zinc-950/60 border border-zinc-800 rounded-xl">
      <div class="flex items-center gap-1.5 mb-3">
        <i data-lucide="${icon}" class="w-3.5 h-3.5 ${toneMap[tone] ?? "text-zinc-400"}"></i>
        <span class="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">${escapeHtml(label)}</span>
      </div>
      <ul class="space-y-2">
        ${items.map((it) => `
          <li class="text-sm text-zinc-300 leading-relaxed flex items-start gap-2">
            <span class="w-1 h-1 rounded-full bg-zinc-600 mt-2 flex-shrink-0"></span>
            <span>${escapeHtml(it)}</span>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

// Per-template overrides for report-section labels/icons. Reports don't carry
// the template they were generated under, so we look up the binding's CURRENT
// template — slightly inaccurate if the user has switched templates between
// generations, but good enough for "test the new prompt" iteration.
const REPORT_FIELD_LABELS = {
  signals: {
    decisions: { icon: "messages-square", label: "群内已答 (Q&A)", tone: "emerald" },
    action_items: { icon: "ticket", label: "新机会", tone: "violet" },
    risks: { icon: "door-closed", label: "关车门 / 已变差", tone: "rose" },
    mentions: { icon: "help-circle", label: "未解疑问", tone: "amber" },
  },
};

function fieldLabelFor(templateKey, field, fallback) {
  const tpl = REPORT_FIELD_LABELS[templateKey];
  return (tpl && tpl[field]) || fallback;
}

function renderMentionsAsBullets(items, label) {
  // For templates whose `mentions` holds substantive content (e.g. signals →
  // open questions). Render as a full bullet section.
  return renderDetailSection(label.icon, label.label, items, label.tone);
}

function renderMentionsAsPills(items, label) {
  // For default-style templates whose mentions = list of names.
  if (!items?.length) return "";
  const tone = { amber: "text-amber-400", zinc: "text-zinc-400", sky: "text-sky-400" }[label.tone] ?? "text-zinc-400";
  return `
    <div class="mt-3 p-4 bg-zinc-950/60 border border-zinc-800 rounded-xl">
      <div class="flex items-center gap-1.5 mb-3">
        <i data-lucide="${label.icon}" class="w-3.5 h-3.5 ${tone}"></i>
        <span class="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">${escapeHtml(label.label)}</span>
      </div>
      <div class="flex flex-wrap gap-2">
        ${items.map((m) => `
          <span class="px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-300">
            ${escapeHtml(String(m))}
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderLinksBlock(links) {
  if (!links?.length) return "";
  // Each link entry may be either a bare URL or "<descriptor> — <URL>".
  // Detect URL substring and make it clickable.
  return `
    <div class="mt-3 p-4 bg-zinc-950/60 border border-zinc-800 rounded-xl">
      <div class="flex items-center gap-1.5 mb-3">
        <i data-lucide="link" class="w-3.5 h-3.5 text-zinc-500"></i>
        <span class="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">链接</span>
      </div>
      <ul class="space-y-1.5">
        ${links.map((entry) => {
          const text = String(entry);
          const m = text.match(/(https?:\/\/\S+)/);
          if (!m) return `<li class="text-xs text-zinc-300 break-all">${escapeHtml(text)}</li>`;
          const url = m[1];
          const before = text.slice(0, m.index).replace(/[—\s-]+$/, "").trim();
          const desc = before || url;
          return `
            <li class="text-xs text-zinc-300 leading-relaxed">
              <span>${escapeHtml(desc)}</span>
              ${before ? `<span class="text-zinc-600 mx-1.5">·</span>` : ""}
              <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="text-sky-400 hover:text-sky-300 break-all">${escapeHtml(url)}</a>
            </li>
          `;
        }).join("")}
      </ul>
    </div>
  `;
}

function renderReportDetail() {
  const card = $("#reportDetailCard");
  const reports = reportsForActiveChat();
  const r = reports.find((x) => x.id === state.ui.activeReportId);
  const entry = getChatEntry(state.ui.activeChatId);
  if (!r || !entry) {
    card.innerHTML = "";
    return;
  }
  const tplKey = entry.binding?.template_key ?? "default";
  const labelDecisions = fieldLabelFor(tplKey, "decisions", { icon: "gavel", label: "Decisions", tone: "sky" });
  const labelActions = fieldLabelFor(tplKey, "action_items", { icon: "list-checks", label: "Action items", tone: "violet" });
  const labelRisks = fieldLabelFor(tplKey, "risks", { icon: "triangle-alert", label: "Risks", tone: "rose" });
  const labelMentions = fieldLabelFor(tplKey, "mentions", { icon: "at-sign", label: "Mentions", tone: "zinc" });

  card.innerHTML = `
    <div class="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-6 animate-slide-up">
      <div class="flex items-start justify-between gap-4 mb-5">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-2">
            <span class="px-2 py-0.5 text-[10px] font-medium rounded border ${statusMeta("success").badge} uppercase tracking-wider">报告</span>
            <span class="text-xs text-zinc-500 font-mono">${escapeHtml(formatAbsolute(r.generated_at))}</span>
          </div>
          <h3 class="text-lg font-semibold tracking-tight text-zinc-100">${escapeHtml(r.title)}</h3>
          <p class="text-xs text-zinc-500 mt-1 flex items-center gap-2 flex-wrap">
            <span class="flex items-center gap-1"><i data-lucide="${chatTypeMeta(entry.chat.chat_type).icon}" class="w-3 h-3"></i>${escapeHtml(entry.chat.title)}</span>
            <span class="text-zinc-700">·</span>
            <span>${escapeHtml(r.language ?? "zh-CN")}</span>
            ${reportCoveredRange(r) ? `<span class="text-zinc-700">·</span><span class="flex items-center gap-1 font-mono text-zinc-400"><i data-lucide="clock" class="w-3 h-3"></i>${escapeHtml(reportCoveredRange(r))}</span>` : ""}
          </p>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          ${r.read_at ? `
          <button id="markUnreadBtn" data-report-id="${escapeHtml(r.id)}" title="标记为未读"
            class="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-medium rounded-md transition flex items-center gap-1.5">
            <i data-lucide="mail" class="w-3.5 h-3.5"></i>
            <span>标记未读</span>
          </button>` : ""}
          <button id="regenerateReportBtn" data-report-id="${escapeHtml(r.id)}" class="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-medium rounded-md transition flex items-center gap-1.5">
            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            <span>重新生成</span>
          </button>
          <button id="copyReportBtn" class="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-medium rounded-md transition flex items-center gap-1.5">
            <i data-lucide="copy" class="w-3.5 h-3.5"></i>
            <span>复制</span>
          </button>
          <button id="closeReportBtn" type="button" title="折叠" class="w-8 h-8 grid place-items-center rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 transition">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
      </div>

      <div class="p-4 bg-gradient-to-br from-sky-500/10 to-indigo-500/5 border border-sky-500/20 rounded-xl mb-4">
        <div class="flex items-center gap-1.5 mb-2">
          <i data-lucide="sparkles" class="w-3.5 h-3.5 text-sky-400"></i>
          <span class="text-[11px] font-semibold uppercase tracking-wider text-sky-300">Executive Summary</span>
        </div>
        <p class="text-sm text-zinc-100 leading-relaxed">${escapeHtml(r.executive_summary ?? "")}</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        ${renderDetailSection("key", "Key points", r.key_points, "emerald")}
        ${renderDetailSection(labelDecisions.icon, labelDecisions.label, r.decisions, labelDecisions.tone)}
        ${renderDetailSection(labelActions.icon, labelActions.label, r.action_items, labelActions.tone)}
        ${renderDetailSection(labelRisks.icon, labelRisks.label, r.risks, labelRisks.tone)}
      </div>

      ${tplKey === "signals"
        ? renderMentionsAsBullets(r.mentions, labelMentions)
        : renderMentionsAsPills(r.mentions, labelMentions)}

      ${renderLinksBlock(r.links)}
    </div>
  `;

  $("#copyReportBtn")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(r.content_markdown ?? "").then(
      () => toast("报告已复制", "copy"),
      () => toast("复制失败", "alert-circle")
    );
  });
  $("#closeReportBtn")?.addEventListener("click", closeReportDetail);
  $("#regenerateReportBtn")?.addEventListener("click", (e) => {
    const rid = e.currentTarget.dataset.reportId;
    if (!rid) return;
    if (!confirm("对同一条消息窗口重新调一次 LLM，会产生一条新报告。原报告保留。继续？")) return;
    regenerateReport(rid);
  });
  $("#markUnreadBtn")?.addEventListener("click", (e) => {
    const rid = e.currentTarget.dataset.reportId;
    if (rid) markReportUnread(rid);
  });
}

// ============================================================
// Actions
// ============================================================

async function _runAndRefresh(chatId, apiCall, labelPending = "正在生成总结…") {
  if (state.runningChats.has(chatId)) return;

  state.runningChats.add(chatId);
  updateSingleChatItem(chatId);
  renderHero();
  icons();
  toast(labelPending, "loader-2");

  try {
    const res = await apiCall();
    await Promise.all([
      loadChats(),
      loadReportsForChat(chatId),
      loadPreviewForChat(chatId),
      loadTotalReportsCount(),
      loadUnreadCounts(),
      state.runsExpanded ? loadRunsForChat(chatId) : Promise.resolve(),
    ]);
    if (res.report) {
      state.ui.activeReportId = res.report.id;
      saveUi();
    }
    if (res.run.status === "skipped") {
      toast("没有新消息，本轮跳过", "minus");
    } else if (res.run.status === "failed") {
      toast(`生成失败：${res.run.error_message ?? "unknown"}`, "alert-circle");
    } else {
      toast("总结已生成", "check-circle-2");
    }
  } catch (err) {
    toast(`运行失败：${err.detail || err.message}`, "alert-circle");
  } finally {
    state.runningChats.delete(chatId);
    renderWorkspace();
  }
}

async function runSummaryNow() {
  const chatId = state.ui.activeChatId;
  if (!chatId) return;
  await _runAndRefresh(chatId, () => apiPost(`/api/bindings/${chatId}/run`));
}

async function runSummaryRange(chatId, fromIso, toIso) {
  await _runAndRefresh(
    chatId,
    () => apiPost(`/api/bindings/${chatId}/run-range`, { from_at: fromIso, to_at: toIso }),
    "按时间范围生成中…"
  );
}

async function regenerateReport(reportId) {
  const chatId = state.ui.activeChatId;
  if (!chatId) return;
  await _runAndRefresh(
    chatId,
    () => apiPost(`/api/reports/${reportId}/regenerate`),
    "重新生成中…"
  );
}

async function togglePin(chatId) {
  const entry = getChatEntry(chatId);
  const currentlyPinned = !!entry?.binding?.pinned_at;
  try {
    const binding = await apiPatch(`/api/bindings/${chatId}`, { pinned: !currentlyPinned });
    // Update local state then re-render the whole chat list (order changes).
    if (entry) entry.binding = binding;
    renderChatList();
    icons();
    toast(currentlyPinned ? "已取消置顶" : "已置顶", currentlyPinned ? "pin-off" : "pin");
  } catch (err) {
    toast(`置顶失败：${err.detail || err.message}`, "alert-circle");
  }
}

async function patchBinding(chatId, patch) {
  try {
    const binding = await apiPatch(`/api/bindings/${chatId}`, patch);
    const entry = getChatEntry(chatId);
    if (entry) entry.binding = binding;
    renderAccountCard();
    updateSingleChatItem(chatId);
    renderHero();
    renderConfigPanel();
    icons();
    if ("auto_summary_enabled" in patch) {
      toast(patch.auto_summary_enabled ? "已开启自动总结" : "已暂停自动总结", patch.auto_summary_enabled ? "zap" : "pause");
    }
  } catch (err) {
    toast(`保存失败：${err.detail || err.message}`, "alert-circle");
  }
}

async function handleSync({ silent = false } = {}) {
  const btn = $("#syncBtn");
  btn.classList.add("pointer-events-none", "opacity-60");
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>';
  icons();
  try {
    const res = await apiPost("/api/chats/sync");
    await loadChats();
    if (!silent) toast(`同步完成（${res.synced} 个，${res.added} 个新增）`, "refresh-cw");
  } catch (err) {
    toast(`同步失败：${err.detail || err.message}`, "alert-circle");
  } finally {
    btn.classList.remove("pointer-events-none", "opacity-60");
    btn.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4"></i>';
    icons();
  }
}

// ============================================================
// Dialogs manager (bulk leave/delete)
// ============================================================

const DIALOG_TYPE_TABS = [
  { id: "all", label: "全部" },
  { id: "private", label: "私聊" },   // is_bot = false
  { id: "bot", label: "Bot" },        // is_bot = true
  { id: "group", label: "群聊" },     // group + supergroup
  { id: "channel", label: "频道" },
];

const dialogsState = {
  items: [],                      // DialogEntry[]
  selected: new Set(),            // set of external_chat_id
  typeFilter: "all",
  search: "",
  loading: false,
  busy: false,
};

function openDialogsModal() {
  $("#dialogsModal").classList.remove("hidden");
  renderDialogTypeFilter();
  renderDialogsList();
  icons();
  if (!dialogsState.items.length) fetchDialogs();
}

function closeDialogsModal() {
  $("#dialogsModal").classList.add("hidden");
}

async function fetchDialogs() {
  dialogsState.loading = true;
  renderDialogsList();
  try {
    const rows = await apiGet("/api/chats/dialogs");
    dialogsState.items = rows;
    dialogsState.selected.clear();
  } catch (err) {
    toast(`拉取对话失败：${err.detail || err.message}`, "alert-circle");
    dialogsState.items = [];
  } finally {
    dialogsState.loading = false;
    renderDialogsList();
    updateDialogsFooter();
    icons();
  }
}

function renderDialogTypeFilter() {
  const host = $("#dialogTypeFilter");
  host.innerHTML = DIALOG_TYPE_TABS.map((t) => {
    const active = dialogsState.typeFilter === t.id;
    return `<button data-dialog-type="${t.id}" class="px-3 py-1 text-xs font-medium rounded-md transition ${
      active ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/60"
    }">${escapeHtml(t.label)}</button>`;
  }).join("");
  host.querySelectorAll("[data-dialog-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      dialogsState.typeFilter = btn.dataset.dialogType;
      renderDialogTypeFilter();
      renderDialogsList();
      updateDialogsFooter();
      icons();
    });
  });
}

function visibleDialogs() {
  const q = (dialogsState.search || "").trim().toLowerCase();
  return dialogsState.items.filter((d) => {
    const f = dialogsState.typeFilter;
    if (f === "private" && !(d.chat_type === "private" && !d.is_bot)) return false;
    if (f === "bot" && !(d.chat_type === "private" && d.is_bot)) return false;
    if (f === "group" && d.chat_type !== "group" && d.chat_type !== "supergroup") return false;
    if (f === "channel" && d.chat_type !== "channel") return false;
    if (!q) return true;
    return [d.title, d.username].join(" ").toLowerCase().includes(q);
  });
}

function dialogBadge(d) {
  const map = {
    private: { label: d.is_bot ? "Bot" : d.is_deleted ? "Deleted" : "Private", cls: d.is_deleted ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : "bg-zinc-500/10 text-zinc-400 border-zinc-700/50" },
    group: { label: "Group", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
    supergroup: { label: "Supergroup", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
    channel: { label: "Channel", cls: "bg-violet-500/10 text-violet-400 border-violet-500/30" },
  };
  return map[d.chat_type] ?? { label: d.chat_type, cls: "bg-zinc-500/10 text-zinc-400 border-zinc-700/50" };
}

function renderDialogsList() {
  const list = $("#dialogsList");
  $("#dialogsTotalCount").textContent = dialogsState.items.length;

  if (dialogsState.loading) {
    list.innerHTML = `
      <div class="py-14 text-center">
        <i data-lucide="loader-2" class="w-6 h-6 text-zinc-500 animate-spin mx-auto"></i>
        <p class="mt-3 text-sm text-zinc-500">正在从 Telegram 拉取全部对话…</p>
      </div>
    `;
    return;
  }

  const vis = visibleDialogs();
  if (!vis.length) {
    list.innerHTML = `<div class="py-14 text-center text-sm text-zinc-500">没有匹配的对话</div>`;
    return;
  }

  list.innerHTML = vis.map((d) => {
    const selected = dialogsState.selected.has(d.external_chat_id);
    const b = dialogBadge(d);
    const seed = avatarSeedFor(d.title);
    return `
      <label class="flex items-start gap-3 p-3 rounded-lg border transition cursor-pointer ${
        selected
          ? "border-rose-500/40 bg-rose-500/5"
          : "border-zinc-800 bg-zinc-950/40 hover:bg-zinc-900/60 hover:border-zinc-700"
      }">
        <input type="checkbox" data-dialog-ext="${d.external_chat_id}" ${selected ? "checked" : ""}
          class="mt-1.5 w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-rose-500 focus:ring-rose-500/30 flex-shrink-0">
        <div class="w-9 h-9 rounded-lg ${gradientFor(seed)} grid place-items-center text-[11px] font-semibold text-white shadow flex-shrink-0">
          ${escapeHtml(seed)}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-zinc-100 truncate">${escapeHtml(d.title)}</span>
            <span class="px-1.5 py-0.5 text-[10px] font-medium rounded border ${b.cls}">${escapeHtml(b.label)}</span>
            ${d.unread_count > 0 ? `<span class="px-1.5 py-0.5 text-[10px] font-medium rounded bg-sky-500/15 text-sky-400 border border-sky-500/30">${d.unread_count}</span>` : ""}
          </div>
          <p class="text-xs text-zinc-500 mt-0.5">
            ${d.username ? `@${escapeHtml(d.username)}` : ""}
            ${d.username && d.member_count ? ' · ' : ""}
            ${d.member_count != null ? `${formatNumber(d.member_count)} 成员` : ""}
            ${d.last_message_at ? (d.username || d.member_count ? ' · ' : '') + formatRelative(d.last_message_at) : ""}
          </p>
        </div>
      </label>
    `;
  }).join("");

  list.querySelectorAll("input[data-dialog-ext]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = Number(cb.dataset.dialogExt);
      if (e.target.checked) dialogsState.selected.add(id);
      else dialogsState.selected.delete(id);
      // toggle visual on the row without re-rendering everything
      const label = cb.closest("label");
      const active = e.target.checked;
      label.className = `flex items-start gap-3 p-3 rounded-lg border transition cursor-pointer ${
        active
          ? "border-rose-500/40 bg-rose-500/5"
          : "border-zinc-800 bg-zinc-950/40 hover:bg-zinc-900/60 hover:border-zinc-700"
      }`;
      updateDialogsFooter();
    });
  });
}

function updateDialogsFooter() {
  const count = dialogsState.selected.size;
  $("#dialogsSelectionCount").textContent = count ? `已选 ${count}` : "未选中";
  $("#dialogsBulkDeleteBtn").disabled = count === 0 || dialogsState.busy;
}

async function runBulkDelete() {
  if (dialogsState.selected.size === 0) return;
  const items = dialogsState.items
    .filter((d) => dialogsState.selected.has(d.external_chat_id))
    .map((d) => ({
      chat_type: d.chat_type,
      external_chat_id: d.external_chat_id,
      access_hash: d.access_hash,
    }));

  const typesSummary = items.reduce((acc, it) => {
    acc[it.chat_type] = (acc[it.chat_type] || 0) + 1;
    return acc;
  }, {});
  const summaryText = Object.entries(typesSummary)
    .map(([t, n]) => `${t}×${n}`)
    .join(", ");

  if (!confirm(`将退出 / 删除 ${items.length} 条对话（${summaryText}）。\n群与频道会直接退出，私聊会从对话列表移除。继续？`)) {
    return;
  }

  dialogsState.busy = true;
  const btn = $("#dialogsBulkDeleteBtn");
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>处理中…</span>';
  icons();

  try {
    const res = await apiPost("/api/chats/bulk-delete", { items });
    const failed = res.failed ? `，${res.failed} 失败` : "";
    toast(`已处理 ${res.removed} 条${failed}`, "trash-2");
    // refresh modal list + main sidebar
    await fetchDialogs();
    await loadChats();
  } catch (err) {
    toast(`批量删除失败：${err.detail || err.message}`, "alert-circle");
  } finally {
    dialogsState.busy = false;
    btn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i><span>退出 / 删除选中</span>';
    updateDialogsFooter();
    icons();
  }
}

async function cleanupDeleted() {
  if (!confirm("扫描并清理 Telegram 对话列表里所有的 Deleted Account（已被官方注销的账号）。\n\n这个操作只会把它们从你的对话列表移除，不会触碰群聊和频道。继续？")) return;
  const btn = $("#cleanupBtn");
  btn.classList.add("pointer-events-none", "opacity-60");
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>';
  icons();
  try {
    const res = await apiPost("/api/chats/cleanup-deleted");
    const extra = res.failed ? `（${res.failed} 个失败）` : "";
    if (res.removed === 0 && res.failed === 0) {
      toast("没有找到已删除账号", "trash-2");
    } else {
      toast(`已清理 ${res.removed} 个死号${extra}`, "trash-2");
    }
  } catch (err) {
    toast(`清理失败：${err.detail || err.message}`, "alert-circle");
  } finally {
    btn.classList.remove("pointer-events-none", "opacity-60");
    btn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
    icons();
  }
}

async function disconnect() {
  if (!confirm("断开 Telegram 账号？会话会被标记为 disconnected，但已生成的报告仍保留在数据库。")) return;
  try {
    await apiPost("/api/auth/logout");
    state.account = null;
    state.chats = [];
    state.reportsByChat = {};
    state.totalReportsCount = 0;
    stopActiveRunsPolling();
    toast("已断开", "log-out");
    showLogin();
  } catch (err) {
    toast(`断开失败：${err.detail || err.message}`, "alert-circle");
  }
}

// ============================================================
// Data inspector modal
// ============================================================

let _dbSnapshot = null;

async function openDataModal() {
  $("#dataModal").classList.remove("hidden");
  $("#dataView").textContent = "Loading…";
  renderDataTabs();
  try {
    _dbSnapshot = await apiGet("/api/admin/db");
    renderDataView();
  } catch (err) {
    $("#dataView").textContent = `Error: ${err.message}`;
  }
  icons();
}

function closeDataModal() {
  $("#dataModal").classList.add("hidden");
}

function dataTabKeys() {
  return _dbSnapshot ? Object.keys(_dbSnapshot) : [];
}

function renderDataTabs() {
  const host = $("#dataTabs");
  const keys = dataTabKeys();
  const tabs = keys.length ? [...keys, "__raw__"] : ["telegram_accounts", "telegram_chats", "__raw__"];
  host.innerHTML = tabs.map((tab) => {
    const active = state.ui.dataTab === tab;
    const label = tab === "__raw__" ? "全部 JSON" : tab;
    return `<button data-data-tab="${tab}" class="px-3 py-1.5 text-xs font-mono rounded-md transition whitespace-nowrap ${
      active ? "bg-sky-500 text-white" : "bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
    }">${escapeHtml(label)}</button>`;
  }).join("");
  host.querySelectorAll("[data-data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.ui.dataTab = btn.dataset.dataTab;
      saveUi();
      renderDataTabs();
      renderDataView();
    });
  });
}

function renderDataView() {
  if (!_dbSnapshot) return;
  let payload;
  if (state.ui.dataTab === "__raw__" || !(state.ui.dataTab in _dbSnapshot)) {
    payload = _dbSnapshot;
  } else {
    payload = _dbSnapshot[state.ui.dataTab];
  }
  $("#dataView").textContent = JSON.stringify(payload, null, 2);
}

function copyDatabaseJson() {
  if (!_dbSnapshot) return;
  navigator.clipboard?.writeText(JSON.stringify(_dbSnapshot, null, 2)).then(
    () => toast("已复制完整数据快照", "copy"),
    () => toast("复制失败", "alert-circle")
  );
}

// ============================================================
// Toast
// ============================================================

function toast(message, icon = "info") {
  const host = $("#toastHost");
  const el = document.createElement("div");
  el.className =
    "toast flex items-center gap-2.5 px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-full text-sm text-zinc-100 shadow-2xl shadow-black/40 backdrop-blur";
  el.innerHTML = `
    <i data-lucide="${icon}" class="w-4 h-4 text-sky-400 flex-shrink-0 ${icon === "loader-2" ? "animate-spin" : ""}"></i>
    <span>${escapeHtml(message)}</span>
  `;
  host.appendChild(el);
  icons();
  setTimeout(() => el.classList.add("is-leaving"), 2500);
  setTimeout(() => el.remove(), 2900);
}

// ============================================================
// Wire up
// ============================================================

function wireLogin() {
  $("#sendCodeBtn").addEventListener("click", handleSendCode);
  $("#confirmCodeBtn").addEventListener("click", handleConfirmCode);
  $("#backToPhoneBtn").addEventListener("click", () => {
    $("#loginStep2").classList.add("hidden");
    $("#loginStep1").classList.remove("hidden");
    setStepperActive(1);
    hideLoginError();
  });
  $("#resendBtn").addEventListener("click", async () => {
    // reuse current phone input and call send-code again
    await handleSendCode();
  });
  $("#phoneInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSendCode();
  });
  $("#codeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleConfirmCode();
  });
}

function wireWorkspace() {
  $("#searchInput").addEventListener("input", (e) => {
    state.ui.search = e.target.value;
    renderChatList();
  });
  $("#syncBtn").addEventListener("click", () => handleSync());
  $("#cleanupBtn").addEventListener("click", cleanupDeleted);
  $("#dialogsBtn").addEventListener("click", openDialogsModal);
  $$("[data-dialogs-close]").forEach((el) => el.addEventListener("click", closeDialogsModal));
  $("#dialogsReloadBtn").addEventListener("click", fetchDialogs);
  $("#dialogSearch").addEventListener("input", (e) => {
    dialogsState.search = e.target.value;
    renderDialogsList();
    icons();
  });
  $("#dialogsSelectAllBtn").addEventListener("click", () => {
    visibleDialogs().forEach((d) => dialogsState.selected.add(d.external_chat_id));
    renderDialogsList();
    updateDialogsFooter();
    icons();
  });
  $("#dialogsClearBtn").addEventListener("click", () => {
    dialogsState.selected.clear();
    renderDialogsList();
    updateDialogsFooter();
    icons();
  });
  $("#dialogsBulkDeleteBtn").addEventListener("click", runBulkDelete);

  $$("[data-template-close]").forEach((el) => el.addEventListener("click", closeTemplateModal));

  // Range modal
  $$("[data-range-close]").forEach((el) => el.addEventListener("click", closeRangeModal));
  $$("[data-range-preset]").forEach((el) => {
    el.addEventListener("click", () => handleRangePreset(el.dataset.rangePreset));
  });
  $("#rangeCustomBtn").addEventListener("click", handleRangeCustom);

  // Runs history panel
  $("#runsHeaderBtn").addEventListener("click", toggleRunsPanel);

  // Mobile: sidebar drawer + kebab menu
  $("#sidebarToggleBtn")?.addEventListener("click", toggleSidebar);
  $("#sidebarCloseBtn")?.addEventListener("click", closeSidebar);
  $("#sidebarBackdrop")?.addEventListener("click", closeSidebar);
  $("#mobileMenuBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMobileMenu();
  });
  $$("[data-mobile-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeMobileMenu();
      const action = btn.dataset.mobileAction;
      if (action === "sync") handleSync();
      else if (action === "dialogs") openDialogsModal();
      else if (action === "cleanup") cleanupDeleted();
      else if (action === "data") openDataModal();
      else if (action === "disconnect") disconnect();
    });
  });
  document.addEventListener("click", (e) => {
    const menu = $("#mobileMenu");
    const btn = $("#mobileMenuBtn");
    if (menu && !menu.classList.contains("hidden") && !menu.contains(e.target) && !btn?.contains(e.target)) {
      closeMobileMenu();
    }
  });

  $("#disconnectBtn").addEventListener("click", disconnect);
  $("#dataBtn").addEventListener("click", openDataModal);
  $$("[data-modal-close]").forEach((el) => el.addEventListener("click", closeDataModal));
  $("#copyDataBtn").addEventListener("click", copyDatabaseJson);

  // Active runs chip / panel
  $("#activeRunsChip")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleActiveRunsPanel();
  });
  document.addEventListener("click", (e) => {
    const panel = $("#activeRunsPanel");
    const chip = $("#activeRunsChip");
    if (
      state.activePanelOpen &&
      panel &&
      !panel.contains(e.target) &&
      !chip?.contains(e.target)
    ) {
      closeActiveRunsPanel();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDataModal();
      closeDialogsModal();
      closeTemplateModal();
      closeRangeModal();
      closeMobileMenu();
      closeSidebar();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      if (!$("#workspaceView").classList.contains("hidden")) $("#searchInput").focus();
    }
  });
}

async function loadTemplates() {
  try {
    const rows = await apiGet("/api/templates");
    if (Array.isArray(rows) && rows.length) TEMPLATES = rows;
  } catch (err) {
    console.warn("template fetch failed; using fallback", err);
  }
}

async function init() {
  wireLogin();
  wireWorkspace();
  icons();
  try {
    await loadTemplates();
    const me = await apiGet("/api/auth/me");
    if (me) {
      state.account = me;
      showWorkspace();
      await loadChats();
    } else {
      showLogin();
    }
  } catch (err) {
    console.warn("init failed", err);
    showLogin();
    toast(`后端不可达：${err.message}`, "alert-circle");
  }
}

init();
