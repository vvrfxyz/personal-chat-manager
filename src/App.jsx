import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AvatarFallback,
  AvatarRoot,
  Button as HeroButton,
  CardContent,
  CardHeader,
  CardRoot,
  CheckboxContent,
  CheckboxControl,
  CheckboxIndicator,
  CheckboxRoot,
  Chip,
  Input as HeroInput,
  ListBox,
  ListBoxItem,
  SelectIndicator,
  SelectPopover,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  Spinner,
  SwitchContent,
  SwitchControl,
  SwitchRoot,
  SwitchThumb,
  Tab as HeroTab,
  TabList,
  TabsRoot,
} from "@heroui/react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  CirclePause,
  Clipboard,
  Copy,
  Database,
  Eye,
  FastForward,
  FileText,
  History,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MailOpen,
  Menu,
  MessageSquareText,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  X,
  Zap,
} from "lucide-react";

function Button({
  children,
  className,
  color,
  endContent,
  isDisabled,
  isIconOnly,
  isLoading,
  startContent,
  ...props
}) {
  const content = isLoading ? (
    <Loader2 size={16} className="animate-spin" />
  ) : isIconOnly ? (
    startContent || children
  ) : (
    <>
      {startContent}
      {children}
      {endContent}
    </>
  );

  return (
    <HeroButton
      {...props}
      className={cx(
        "rounded-lg",
        color === "danger" && "text-rose-200 hover:text-rose-100",
        className,
      )}
      isDisabled={isDisabled || isLoading}
      isIconOnly={isIconOnly}
    >
      {content}
    </HeroButton>
  );
}

function Card({ children, className, shadow, ...props }) {
  return (
    <CardRoot {...props} className={className}>
      {children}
    </CardRoot>
  );
}

function CardBody({ children, className, ...props }) {
  return (
    <CardContent {...props} className={className}>
      {children}
    </CardContent>
  );
}

function Divider({ className = "" }) {
  return <div className={cx("h-px w-full bg-white/10", className)} />;
}

function Avatar({ name, className }) {
  return (
    <AvatarRoot className={className}>
      <AvatarFallback>{name}</AvatarFallback>
    </AvatarRoot>
  );
}

function Input({
  className,
  classNames,
  label,
  onValueChange,
  placeholder,
  startContent,
  value,
  ...props
}) {
  return (
    <label className={cx("grid gap-1.5 text-xs text-muted", className)}>
      {label ? <span>{label}</span> : null}
      <span className="flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 focus-within:border-teal-300/50">
        {startContent}
        <HeroInput
          {...props}
          className={cx("min-w-0 flex-1 bg-transparent text-sm text-default-100 outline-none placeholder:text-muted", classNames?.input)}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onValueChange?.(event.target.value)}
        />
      </span>
    </label>
  );
}

function Select({ children, className, isDisabled, label, onSelectionChange, selectedKeys, ...props }) {
  const options = React.Children.toArray(children)
    .filter(Boolean)
    .map((child) => ({
      key: String(child.key || "").replace(/^\.\$/, "").replace(/^\$/, ""),
      label: child.props?.children,
    }));
  const selectedKey = Array.from(selectedKeys || [options[0]?.key]).filter(Boolean)[0] || "";
  const selectedLabel = options.find((item) => item.key === selectedKey)?.label || selectedKey;

  return (
    <label className={cx("grid gap-1.5 text-xs text-muted", className)}>
      {label ? <span>{label}</span> : null}
      <SelectRoot
        {...props}
        className="w-full"
        isDisabled={isDisabled}
        selectedKey={selectedKey}
        onSelectionChange={(key) => onSelectionChange?.(new Set([String(key)]))}
      >
        <SelectTrigger className="min-h-10 rounded-lg border border-white/10 bg-white/[0.035] px-3 text-left text-sm text-default-100 disabled:opacity-50">
          <span className="flex flex-1 items-center justify-between gap-3">
            <SelectValue>{selectedLabel}</SelectValue>
            <SelectIndicator className="h-4 w-4 text-muted" />
          </span>
        </SelectTrigger>
        <SelectPopover className="z-[90] rounded-lg border border-white/10 bg-[#191816] p-1 shadow-2xl">
          <ListBox className="grid gap-1 outline-none">
            {options.map((item) => (
              <ListBoxItem
                key={item.key}
                id={item.key}
                className="cursor-pointer rounded-md px-3 py-2 text-sm text-default-100 outline-none hover:bg-white/10 data-[selected]:bg-teal-300/15"
              >
                {item.label}
              </ListBoxItem>
            ))}
          </ListBox>
        </SelectPopover>
      </SelectRoot>
    </label>
  );
}

function SelectItem() {
  return null;
}

function Checkbox({ children, isSelected, onValueChange, ...props }) {
  return (
    <CheckboxRoot {...props} isSelected={isSelected} onChange={onValueChange}>
      <CheckboxControl>
        <CheckboxIndicator />
      </CheckboxControl>
      {children ? <CheckboxContent>{children}</CheckboxContent> : null}
    </CheckboxRoot>
  );
}

function Switch({ children, isSelected, onValueChange, ...props }) {
  return (
    <SwitchRoot {...props} isSelected={isSelected} onChange={onValueChange}>
      <SwitchControl>
        <SwitchThumb />
      </SwitchControl>
      {children ? <SwitchContent>{children}</SwitchContent> : null}
    </SwitchRoot>
  );
}

function Tabs({ children, classNames, onSelectionChange, selectedKey, ...props }) {
  const items = React.Children.toArray(children)
    .filter(Boolean)
    .map((child) => ({
      key: String(child.key || "").replace(/^\.\$/, "").replace(/^\$/, ""),
      title: child.props?.title || child.props?.children,
    }));
  return (
    <TabsRoot {...props} selectedKey={selectedKey} onSelectionChange={onSelectionChange}>
      <TabList className={classNames?.tabList}>
        {items.map((item) => (
          <HeroTab key={item.key} id={item.key} className={classNames?.tab}>
            {item.title}
          </HeroTab>
        ))}
      </TabList>
    </TabsRoot>
  );
}

function Tab() {
  return null;
}

function Modal({ children, isOpen, onOpenChange, placement, scrollBehavior, size }) {
  if (!isOpen) return null;
  return (
    <>
      {React.Children.map(children, (child) => (
        React.isValidElement(child)
          ? React.cloneElement(child, { modalProps: { placement, scrollBehavior, size, onClose: () => onOpenChange?.(false) } })
          : child
      ))}
    </>
  );
}

function ModalContent({ children, className, modalProps = {} }) {
  const maxWidth = modalProps.size === "5xl"
    ? "max-w-[min(96vw,1100px)]"
    : modalProps.size === "3xl"
      ? "max-w-[min(96vw,860px)]"
      : "max-w-[min(96vw,560px)]";
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/65 p-4 backdrop-blur-sm">
      <button aria-label="关闭弹窗" className="absolute inset-0" type="button" onClick={modalProps.onClose} />
      <div
        className={cx(
          "relative max-h-[calc(100vh-2rem)] w-full overflow-hidden rounded-lg border border-white/10 bg-[#191816] shadow-2xl",
          maxWidth,
          className,
        )}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ children, className }) {
  return <div className={cx("border-b border-white/10 p-5 text-base font-semibold", className)}>{children}</div>;
}

function ModalBody({ children, className }) {
  return <div className={cx("max-h-[calc(100vh-13rem)] overflow-auto p-5", className)}>{children}</div>;
}

function ModalFooter({ children, className }) {
  return <div className={cx("flex justify-end gap-2 border-t border-white/10 p-4", className)}>{children}</div>;
}

function Tooltip({ children, content }) {
  return (
    <span className="inline-flex" title={content}>
      {children}
    </span>
  );
}

const API_BASE = (() => {
  if (location.port && location.port !== "8787") {
    return `${location.protocol}//${location.hostname}:8787`;
  }
  return "";
})();

const UI_KEY = "pcm:hero-ui:v1";

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
  { id: "from_now", label: "从现在开始" },
  { id: "last_24h", label: "回看 24 小时" },
  { id: "last_7d", label: "回看 7 天" },
];

const CATCH_UP_BATCH_SIZES = [
  { id: "500", label: "500" },
  { id: "1000", label: "1000" },
  { id: "2000", label: "2000" },
];

const CATCH_UP_CADENCES = [
  { id: "continuous", label: "连续执行", minutes: 1 },
  { id: "every_2m", label: "每 2 分钟", minutes: 2 },
  { id: "slow_background", label: "低速后台", minutes: 15 },
];

const CATCH_UP_RESULT_TYPES = [
  { id: "archive_reports", label: "归档报告", hint: "每批生成一份" },
  { id: "daily_digest", label: "合并日报", hint: "追完合并一份" },
  { id: "latest_summary", label: "只生成最近总结", hint: "跳过旧历史" },
];

const CATCH_UP_FAILURE_POLICIES = [
  { id: "pause", label: "失败暂停", hint: "保留现场" },
  { id: "retry_once", label: "重试一次", hint: "再失败暂停" },
  { id: "skip_batch", label: "跳过失败批", hint: "继续追赶" },
];

const COUNTRY_CODES = [
  { id: "+86", label: "+86 中国大陆" },
  { id: "+852", label: "+852 香港" },
  { id: "+853", label: "+853 澳门" },
  { id: "+886", label: "+886 台湾" },
  { id: "+65", label: "+65 新加坡" },
  { id: "+81", label: "+81 日本" },
  { id: "+82", label: "+82 韩国" },
  { id: "+1", label: "+1 美国/加拿大" },
  { id: "+44", label: "+44 英国" },
  { id: "+91", label: "+91 印度" },
];

const CHAT_TYPE = {
  group: { label: "Group", icon: UsersRound },
  supergroup: { label: "Supergroup", icon: UsersRound },
  channel: { label: "Channel", icon: Send },
  private: { label: "Private", icon: UserRound },
};

const RUN_STATUS = {
  pending: { label: "排队", color: "default" },
  running: { label: "生成中", color: "primary" },
  success: { label: "成功", color: "success" },
  failed: { label: "失败", color: "danger" },
  skipped: { label: "无新消息", color: "warning" },
  cancelled: { label: "已取消", color: "default" },
};

const TEMPLATE_FALLBACK = [
  { id: "default", label: "通用结构化", description: "", system_prompt: "" },
];

class ApiError extends Error {
  constructor(status, detail, raw) {
    super(detail || `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
    this.raw = raw;
  }
}

async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body == null ? {} : { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
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
const apiPost = (path, body = {}) => api("POST", path, body);
const apiPatch = (path, body = {}) => api("PATCH", path, body);
const apiDelete = (path) => api("DELETE", path);

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function firstKey(keys) {
  if (!keys || keys === "all") return null;
  return Array.from(keys)[0] ?? null;
}

function formatNumber(value) {
  if (value == null) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatAbsolute(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelative(iso) {
  if (!iso) return "从未";
  const d = new Date(iso);
  const diff = Math.round((Date.now() - d.getTime()) / 60_000);
  if (Number.isNaN(diff)) return "从未";
  if (diff < 1) return "刚刚";
  if (diff < 60) return `${diff} 分钟前`;
  if (diff < 60 * 24) return `${Math.round(diff / 60)} 小时前`;
  return `${Math.round(diff / 1440)} 天前`;
}

function formatDurationBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  if (Number.isNaN(minutes)) return null;
  if (minutes < 60) return `约 ${Math.max(minutes, 1)} 分钟`;
  if (minutes < 60 * 24) return `约 ${Math.round(minutes / 60)} 小时`;
  return `约 ${Math.round(minutes / 1440)} 天`;
}

function formatMinutesDuration(minutes) {
  if (minutes == null || Number.isNaN(minutes)) return "-";
  const safeMinutes = Math.max(1, Math.round(minutes));
  if (safeMinutes < 60) return `约 ${safeMinutes} 分钟`;
  if (safeMinutes < 60 * 24) {
    const hours = Math.floor(safeMinutes / 60);
    const rest = safeMinutes % 60;
    return rest ? `约 ${hours} 小时 ${rest} 分` : `约 ${hours} 小时`;
  }
  const days = Math.floor(safeMinutes / 1440);
  const hours = Math.round((safeMinutes % 1440) / 60);
  return hours ? `约 ${days} 天 ${hours} 小时` : `约 ${days} 天`;
}

function nullableNumber(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function catchUpStrategyFromPreview(preview) {
  return {
    batchSize: String(preview?.catch_up_batch_size || 500),
    cadence: preview?.catch_up_cadence || "every_2m",
    maxBatches: preview?.catch_up_max_batches ? String(preview.catch_up_max_batches) : "",
    maxTokens: preview?.catch_up_max_tokens ? String(preview.catch_up_max_tokens) : "",
    maxReports: preview?.catch_up_max_reports ? String(preview.catch_up_max_reports) : "",
    resultType: preview?.catch_up_result_type || "archive_reports",
    failurePolicy: preview?.catch_up_failure_policy || "pause",
  };
}

function hasActiveBindingError(binding) {
  if (!binding?.last_error_message || !binding.last_error_at) return false;
  if (!binding.last_success_at) return true;
  const errorAt = new Date(binding.last_error_at).getTime();
  const successAt = new Date(binding.last_success_at).getTime();
  if (Number.isNaN(errorAt)) return Boolean(binding.last_error_message);
  if (Number.isNaN(successAt)) return true;
  return errorAt > successAt;
}

function initials(value) {
  const text = (value || "PCM").trim();
  if (!text) return "P";
  const chars = Array.from(text.replace(/^@/, ""));
  return chars.slice(0, 2).join("").toUpperCase();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function itemText(item) {
  if (item == null) return "";
  if (typeof item === "string" || typeof item === "number") return String(item);
  if (typeof item === "object") {
    const owner = item.owner || item.assignee || item.name || item.who;
    const task = item.task || item.action || item.text || item.summary || item.title || item.url;
    const due = item.due || item.deadline || item.when;
    return [owner, task, due].filter(Boolean).join(" · ") || JSON.stringify(item);
  }
  return String(item);
}

function linkValue(item) {
  if (!item) return null;
  if (typeof item === "string") return item;
  return item.url || item.href || null;
}

function reportById(reportsByChat, reportId) {
  if (!reportId) return null;
  for (const reports of Object.values(reportsByChat)) {
    const found = reports.find((report) => report.id === reportId);
    if (found) return found;
  }
  return null;
}

function copyText(text) {
  return navigator.clipboard?.writeText(text);
}

function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...initialValue, ...JSON.parse(raw) } : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [account, setAccount] = useState(null);
  const [templates, setTemplates] = useState(TEMPLATE_FALLBACK);
  const [chats, setChats] = useState([]);
  const [reportsByChat, setReportsByChat] = useState({});
  const [reportsMetaByChat, setReportsMetaByChat] = useState({});
  const [selectedReports, setSelectedReports] = useState(new Set());
  const [unreadCountsByChat, setUnreadCountsByChat] = useState({});
  const [totalReports, setTotalReports] = useState(0);
  const [runsByChat, setRunsByChat] = useState({});
  const [previewByChat, setPreviewByChat] = useState({});
  const [previewLoadingByChat, setPreviewLoadingByChat] = useState({});
  const [activeRuns, setActiveRuns] = useState([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [runningChats, setRunningChats] = useState(new Set());
  const [backlogActionChats, setBacklogActionChats] = useState(new Set());
  const [rangeOpen, setRangeOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [dialogsOpen, setDialogsOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [dbSnapshot, setDbSnapshot] = useState(null);
  const [activeTemplateId, setActiveTemplateId] = useState("default");
  const [toasts, setToasts] = useState([]);
  const [ui, setUi] = usePersistentState(UI_KEY, {
    activeChatId: null,
    activeReportId: null,
    filter: "all",
    search: "",
    showUnreadOnly: false,
  });

  const pushToast = useCallback((message, tone = "default") => {
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    setToasts((items) => [...items, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const setUiValue = useCallback((patch) => {
    setUi((current) => ({ ...current, ...patch }));
  }, [setUi]);

  useEffect(() => {
    setUi((current) => (
      current.activeReportId ? { ...current, activeReportId: null } : current
    ));
  }, [setUi]);

  const selectedEntry = useMemo(
    () => chats.find((entry) => entry.chat.id === ui.activeChatId) || null,
    [chats, ui.activeChatId],
  );
  const activeChat = selectedEntry?.chat || null;
  const activeBinding = selectedEntry?.binding || null;
  const activePreview = activeChat ? previewByChat[activeChat.id] : null;
  const activePreviewLoading = activeChat ? Boolean(previewLoadingByChat[activeChat.id]) : false;
  const activeReports = activeChat ? reportsByChat[activeChat.id] || [] : [];
  const activeReport = reportById(reportsByChat, ui.activeReportId);

  const unreadTotal = useMemo(
    () => Object.values(unreadCountsByChat).reduce((sum, value) => sum + value, 0),
    [unreadCountsByChat],
  );

  const filteredChats = useMemo(() => {
    const query = ui.search.trim().toLowerCase();
    return chats.filter(({ chat, binding }) => {
      const title = `${chat.title || ""} ${chat.username || ""}`.toLowerCase();
      const unread = unreadCountsByChat[chat.id] || 0;
      if (query && !title.includes(query)) return false;
      if (ui.filter === "auto") return Boolean(binding?.auto_summary_enabled);
      if (ui.filter === "manual") return !binding?.auto_summary_enabled;
      if (ui.filter === "attention") return unread > 0 || hasActiveBindingError(binding);
      return true;
    });
  }, [chats, ui.filter, ui.search, unreadCountsByChat]);

  const refreshActiveRuns = useCallback(async () => {
    if (!account) return;
    try {
      const rows = await apiGet("/api/reports/runs/recent?status=running&limit=50");
      setActiveRuns(rows || []);
    } catch {
      setActiveRuns([]);
    }
  }, [account]);

  const reloadWorkspace = useCallback(async () => {
    setWorkspaceLoading(true);
    try {
      const [chatRows, reportCount, unreadRows, runningRows] = await Promise.all([
        apiGet("/api/chats"),
        apiGet("/api/reports/count"),
        apiGet("/api/reports/unread-counts"),
        apiGet("/api/reports/runs/recent?status=running&limit=50"),
      ]);
      setChats(chatRows || []);
      setTotalReports(reportCount?.total ?? 0);
      setUnreadCountsByChat(
        Object.fromEntries((unreadRows || []).map((row) => [row.chat_id, row.count])),
      );
      setActiveRuns(runningRows || []);
      setUi((current) => {
        if (!chatRows?.length) return { ...current, activeChatId: null, activeReportId: null };
        const stillExists = chatRows.some((entry) => entry.chat.id === current.activeChatId);
        return {
          ...current,
          activeChatId: stillExists ? current.activeChatId : chatRows[0].chat.id,
        };
      });
    } catch (err) {
      pushToast(`刷新失败：${err.detail || err.message}`, "danger");
    } finally {
      setWorkspaceLoading(false);
    }
  }, [pushToast, setUi]);

  const loadPreview = useCallback(async (chatId) => {
    if (!chatId) return;
    setPreviewLoadingByChat((current) => ({ ...current, [chatId]: true }));
    try {
      const preview = await apiGet(`/api/bindings/${chatId}/preview`);
      setPreviewByChat((current) => ({ ...current, [chatId]: preview }));
    } catch (err) {
      setPreviewByChat((current) => ({
        ...current,
        [chatId]: {
          ...(current[chatId] || {}),
          pending_count: null,
          pending_total: null,
          pending_capped: false,
          count_error: err.detail || err.message,
        },
      }));
    } finally {
      setPreviewLoadingByChat((current) => ({ ...current, [chatId]: false }));
    }
  }, []);

  const loadSelectedChat = useCallback(async (chatId) => {
    if (!chatId) return;
    setChatLoading(true);
    try {
      const [binding, reports, runs] = await Promise.all([
        apiGet(`/api/bindings/${chatId}`),
        apiGet(`/api/reports?chat_id=${encodeURIComponent(chatId)}&limit=50&offset=0`),
        apiGet(`/api/bindings/${chatId}/runs?limit=30`),
      ]);
      setChats((rows) =>
        rows.map((entry) => (
          entry.chat.id === chatId ? { ...entry, binding } : entry
        )),
      );
      setReportsByChat((current) => ({ ...current, [chatId]: reports || [] }));
      setReportsMetaByChat((current) => ({
        ...current,
        [chatId]: { loadedCount: reports?.length || 0, hasMore: (reports?.length || 0) === 50 },
      }));
      setRunsByChat((current) => ({ ...current, [chatId]: runs || [] }));
      setSelectedReports(new Set());
      setUi((current) => {
        const exists = reports?.some((report) => report.id === current.activeReportId);
        return { ...current, activeReportId: exists ? current.activeReportId : null };
      });
      loadPreview(chatId);
    } catch (err) {
      pushToast(`加载聊天失败：${err.detail || err.message}`, "danger");
    } finally {
      setChatLoading(false);
    }
  }, [loadPreview, pushToast, setUi]);

  const loadMoreReports = useCallback(async () => {
    if (!activeChat) return;
    const meta = reportsMetaByChat[activeChat.id] || { loadedCount: activeReports.length };
    try {
      const rows = await apiGet(
        `/api/reports?chat_id=${encodeURIComponent(activeChat.id)}&limit=50&offset=${meta.loadedCount}`,
      );
      setReportsByChat((current) => ({
        ...current,
        [activeChat.id]: [...(current[activeChat.id] || []), ...(rows || [])],
      }));
      setReportsMetaByChat((current) => ({
        ...current,
        [activeChat.id]: {
          loadedCount: meta.loadedCount + (rows?.length || 0),
          hasMore: (rows?.length || 0) === 50,
        },
      }));
    } catch (err) {
      pushToast(`加载更多失败：${err.detail || err.message}`, "danger");
    }
  }, [activeChat, activeReports.length, reportsMetaByChat, pushToast]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setBooting(true);
      try {
        const [tplRows, me] = await Promise.all([
          apiGet("/api/templates").catch(() => TEMPLATE_FALLBACK),
          apiGet("/api/auth/me"),
        ]);
        if (cancelled) return;
        setTemplates(tplRows?.length ? tplRows : TEMPLATE_FALLBACK);
        setAccount(me);
      } catch (err) {
        if (!cancelled) pushToast(`后端不可达：${err.detail || err.message}`, "danger");
      } finally {
        if (!cancelled) setBooting(false);
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [pushToast]);

  useEffect(() => {
    if (account) reloadWorkspace();
  }, [account, reloadWorkspace]);

  useEffect(() => {
    if (account && ui.activeChatId) loadSelectedChat(ui.activeChatId);
  }, [account, ui.activeChatId, loadSelectedChat]);

  useEffect(() => {
    if (!account) return undefined;
    const timer = window.setInterval(refreshActiveRuns, 9000);
    return () => window.clearInterval(timer);
  }, [account, refreshActiveRuns]);

  useEffect(() => {
    if (!account || !ui.activeChatId || !activePreview?.catch_up_active) return undefined;
    const chatId = ui.activeChatId;
    const timer = window.setInterval(() => {
      refreshActiveRuns();
      loadSelectedChat(chatId);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [account, activePreview?.catch_up_active, loadSelectedChat, refreshActiveRuns, ui.activeChatId]);

  async function handleSendCode({ phone, onSuccess }) {
    try {
      const res = await apiPost("/api/auth/telegram/send-code", { phone });
      pushToast("验证码已发送", "success");
      onSuccess(res);
    } catch (err) {
      pushToast(`发送失败：${err.detail || err.message}`, "danger");
      throw err;
    }
  }

  async function handleVerify(payload) {
    try {
      const acc = await apiPost("/api/auth/telegram/verify", payload);
      setAccount(acc);
      pushToast("Telegram 账号已绑定", "success");
    } catch (err) {
      throw err;
    }
  }

  async function handleLogout() {
    try {
      await apiPost("/api/auth/logout");
      setAccount(null);
      setChats([]);
      setReportsByChat({});
      setUiValue({ activeChatId: null, activeReportId: null });
      pushToast("已断开账号", "success");
    } catch (err) {
      pushToast(`断开失败：${err.detail || err.message}`, "danger");
    }
  }

  async function handleSync() {
    try {
      const res = await apiPost("/api/chats/sync");
      pushToast(`同步完成：${res.synced} 个，新增 ${res.added} 个`, "success");
      await reloadWorkspace();
    } catch (err) {
      pushToast(`同步失败：${err.detail || err.message}`, "danger");
    }
  }

  async function patchBinding(chatId, patch, toastText) {
    try {
      const binding = await apiPatch(`/api/bindings/${chatId}`, patch);
      setChats((rows) =>
        rows.map((entry) => (
          entry.chat.id === chatId ? { ...entry, binding } : entry
        )),
      );
      if (toastText) pushToast(toastText, "success");
      await loadSelectedChat(chatId);
    } catch (err) {
      pushToast(`保存失败：${err.detail || err.message}`, "danger");
    }
  }

  async function runChat(chatId, runner, pendingText = "正在生成报告") {
    setRunningChats((ids) => new Set(ids).add(chatId));
    pushToast(pendingText, "default");
    try {
      const res = await runner();
      if (res.report) {
        pushToast("报告已生成", "success");
      } else if (res.run?.status === "skipped") {
        pushToast("没有新消息", "warning");
      } else if (res.run?.status === "failed") {
        pushToast(`生成失败：${res.run.error_message || "unknown"}`, "danger");
      }
      await Promise.all([reloadWorkspace(), loadSelectedChat(chatId)]);
    } catch (err) {
      pushToast(`运行失败：${err.detail || err.message}`, "danger");
    } finally {
      setRunningChats((ids) => {
        const next = new Set(ids);
        next.delete(chatId);
        return next;
      });
    }
  }

  async function handleRunNow(chatId) {
    await runChat(chatId, () => apiPost(`/api/bindings/${chatId}/run`));
  }

  async function backlogAction(chatId, runner, successText) {
    setBacklogActionChats((ids) => new Set(ids).add(chatId));
    try {
      await runner();
      pushToast(successText, "success");
      await Promise.all([reloadWorkspace(), loadSelectedChat(chatId)]);
    } catch (err) {
      pushToast(`积压操作失败：${err.detail || err.message}`, "danger");
    } finally {
      setBacklogActionChats((ids) => {
        const next = new Set(ids);
        next.delete(chatId);
        return next;
      });
    }
  }

  async function handleStartCatchUp(chatId, payload) {
    await backlogAction(
      chatId,
      () => apiPost(`/api/bindings/${chatId}/catch-up/start`, payload || {}),
      "已进入智能追赶队列",
    );
  }

  async function handleStopCatchUp(chatId) {
    await backlogAction(
      chatId,
      () => apiPost(`/api/bindings/${chatId}/catch-up/stop`),
      "已停止追赶",
    );
  }

  async function handleSkipBacklog(chatId) {
    const ok = window.confirm("确认从最新消息开始？旧积压不会生成报告，之后按当前频率继续。");
    if (!ok) return;
    await backlogAction(
      chatId,
      () => apiPost(`/api/bindings/${chatId}/skip-backlog`),
      "已从最新消息开始",
    );
  }

  async function handleRangeRun(chatId, payload) {
    await runChat(
      chatId,
      () => apiPost(`/api/bindings/${chatId}/run-range`, payload),
      "正在生成历史快照",
    );
    setRangeOpen(false);
  }

  async function regenerateReport(report) {
    if (!activeChat || !report) return;
    await runChat(
      activeChat.id,
      () => apiPost(`/api/reports/${report.id}/regenerate`),
      "正在重新生成报告",
    );
  }

  async function deleteReport(reportId) {
    if (!activeChat) return;
    try {
      await apiDelete(`/api/reports/${reportId}`);
      setReportsByChat((current) => ({
        ...current,
        [activeChat.id]: (current[activeChat.id] || []).filter((report) => report.id !== reportId),
      }));
      setSelectedReports((current) => {
        const next = new Set(current);
        next.delete(reportId);
        return next;
      });
      setUiValue({
        activeReportId: activeReport?.id === reportId ? null : ui.activeReportId,
      });
      pushToast("已删除报告", "success");
      await reloadWorkspace();
    } catch (err) {
      pushToast(`删除失败：${err.detail || err.message}`, "danger");
    }
  }

  async function bulkDeleteReports() {
    if (!activeChat || selectedReports.size === 0) return;
    const ids = Array.from(selectedReports);
    try {
      const res = await apiPost("/api/reports/bulk-delete", { ids });
      setReportsByChat((current) => ({
        ...current,
        [activeChat.id]: (current[activeChat.id] || []).filter((report) => !selectedReports.has(report.id)),
      }));
      setSelectedReports(new Set());
      setUiValue({ activeReportId: null });
      pushToast(`已删除 ${res.deleted ?? ids.length} 份报告`, "success");
      await reloadWorkspace();
    } catch (err) {
      pushToast(`批量删除失败：${err.detail || err.message}`, "danger");
    }
  }

  function updateReportReadState(reportId, readAt) {
    setReportsByChat((current) => Object.fromEntries(
      Object.entries(current).map(([chatId, reports]) => [
        chatId,
        reports.map((report) => (
          report.id === reportId ? { ...report, read_at: readAt } : report
        )),
      ]),
    ));
  }

  function adjustUnreadCount(chatId, delta) {
    if (!chatId || !delta) return;
    setUnreadCountsByChat((current) => ({
      ...current,
      [chatId]: Math.max(0, (current[chatId] || 0) + delta),
    }));
  }

  async function openReport(reportId) {
    const report = reportById(reportsByChat, reportId);
    const chatId = activeChat?.id;
    setUiValue({ activeReportId: reportId });
    if (!report || report.read_at) return;

    const readAt = new Date().toISOString();
    updateReportReadState(reportId, readAt);
    adjustUnreadCount(chatId, -1);
    try {
      await apiPost(`/api/reports/${reportId}/read`);
      await reloadWorkspace();
    } catch (err) {
      updateReportReadState(reportId, null);
      adjustUnreadCount(chatId, 1);
      pushToast(`标记已读失败：${err.detail || err.message}`, "danger");
    }
  }

  async function markReport(reportId, read) {
    if (!activeChat) return;
    const report = reportById(reportsByChat, reportId);
    const wasUnread = Boolean(report && !report.read_at);
    try {
      await apiPost(`/api/reports/${reportId}/${read ? "read" : "unread"}`);
      updateReportReadState(reportId, read ? new Date().toISOString() : null);
      if (read && wasUnread) adjustUnreadCount(activeChat.id, -1);
      if (!read && !wasUnread) adjustUnreadCount(activeChat.id, 1);
      await reloadWorkspace();
    } catch (err) {
      pushToast(`标记失败：${err.detail || err.message}`, "danger");
    }
  }

  async function markAllRead() {
    if (!activeChat) return;
    try {
      const res = await apiPost(`/api/reports/mark-all-read?chat_id=${encodeURIComponent(activeChat.id)}`);
      pushToast(`已标记 ${res.updated ?? 0} 份为已读`, "success");
      await Promise.all([reloadWorkspace(), loadSelectedChat(activeChat.id)]);
    } catch (err) {
      pushToast(`操作失败：${err.detail || err.message}`, "danger");
    }
  }

  async function openDataInspector() {
    setDataOpen(true);
    try {
      setDbSnapshot(await apiGet("/api/admin/db"));
    } catch (err) {
      pushToast(`读取数据库失败：${err.detail || err.message}`, "danger");
    }
  }

  async function cleanupDeleted() {
    try {
      const res = await apiPost("/api/chats/cleanup-deleted");
      pushToast(`已清理 ${res.removed} 个账号`, "success");
      await reloadWorkspace();
    } catch (err) {
      pushToast(`清理失败：${err.detail || err.message}`, "danger");
    }
  }

  function openTemplate(templateId) {
    setActiveTemplateId(templateId || "default");
    setTemplateOpen(true);
  }

  if (booting) {
    return (
      <div className="app-shell grid min-h-screen place-items-center">
        <div className="flex items-center gap-3 text-sm text-muted">
          <Spinner color="primary" size="sm" />
          Signal Desk 正在启动
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {!account ? (
        <LoginScreen onSendCode={handleSendCode} onVerify={handleVerify} />
      ) : (
        <Dashboard
          account={account}
          chats={chats}
          filteredChats={filteredChats}
          activeChat={activeChat}
          activeBinding={activeBinding}
          activePreview={activePreview}
          activeReports={activeReports}
          activeReport={activeReport}
          activeRuns={activeRuns}
          runs={activeChat ? runsByChat[activeChat.id] || [] : []}
          templates={templates}
          ui={ui}
          unreadCountsByChat={unreadCountsByChat}
          unreadTotal={unreadTotal}
          totalReports={totalReports}
          workspaceLoading={workspaceLoading}
          chatLoading={chatLoading}
          previewLoading={activePreviewLoading}
          running={activeChat ? runningChats.has(activeChat.id) : false}
          backlogActioning={activeChat ? backlogActionChats.has(activeChat.id) : false}
          selectedReports={selectedReports}
          reportsMeta={activeChat ? reportsMetaByChat[activeChat.id] : null}
          mobileSidebarOpen={mobileSidebarOpen}
          onUi={setUiValue}
          onSelectChat={(chatId) => {
            setUiValue({ activeChatId: chatId, activeReportId: null });
            setMobileSidebarOpen(false);
          }}
          onSelectReport={openReport}
          onToggleSelected={(reportId, checked) => {
            setSelectedReports((current) => {
              const next = new Set(current);
              if (checked) next.add(reportId);
              else next.delete(reportId);
              return next;
            });
          }}
          onToggleAllSelected={(checked) => {
            setSelectedReports(checked ? new Set(activeReports.map((report) => report.id)) : new Set());
          }}
          onSync={handleSync}
          onLogout={handleLogout}
          onPatchBinding={patchBinding}
          onRunNow={handleRunNow}
          onStartCatchUp={handleStartCatchUp}
          onStopCatchUp={handleStopCatchUp}
          onSkipBacklog={handleSkipBacklog}
          onOpenRange={() => setRangeOpen(true)}
          onOpenTemplate={openTemplate}
          onOpenData={openDataInspector}
          onOpenDialogs={() => setDialogsOpen(true)}
          onCleanup={cleanupDeleted}
          onLoadMore={loadMoreReports}
          onDeleteReport={deleteReport}
          onBulkDeleteReports={bulkDeleteReports}
          onMarkReport={markReport}
          onMarkAllRead={markAllRead}
          onRegenerateReport={regenerateReport}
          onCopy={(text, label = "已复制") => {
            copyText(text)
              ?.then(() => pushToast(label, "success"))
              .catch(() => pushToast("复制失败", "danger"));
          }}
          onMobileMenu={() => setMobileSidebarOpen(true)}
          onCloseMobileMenu={() => setMobileSidebarOpen(false)}
        />
      )}

      <ReportReaderModal
        isOpen={Boolean(activeReport)}
        report={activeReport}
        onClose={() => setUiValue({ activeReportId: null })}
        onCopy={(text, label = "已复制") => {
          copyText(text)
            ?.then(() => pushToast(label, "success"))
            .catch(() => pushToast("复制失败", "danger"));
        }}
        onDelete={deleteReport}
        onMarkReport={markReport}
        onRegenerate={regenerateReport}
      />

      <RangeRunModal
        isOpen={rangeOpen}
        onClose={() => setRangeOpen(false)}
        chat={activeChat}
        onRun={handleRangeRun}
      />
      <TemplateModal
        isOpen={templateOpen}
        onClose={() => setTemplateOpen(false)}
        template={templates.find((item) => item.id === activeTemplateId) || templates[0]}
      />
      <DataModal
        isOpen={dataOpen}
        onClose={() => setDataOpen(false)}
        snapshot={dbSnapshot}
        onCopy={(text) => {
          copyText(text)
            ?.then(() => pushToast("数据快照已复制", "success"))
            .catch(() => pushToast("复制失败", "danger"));
        }}
      />
      <DialogsModal
        isOpen={dialogsOpen}
        onClose={() => setDialogsOpen(false)}
        onToast={pushToast}
        onReload={reloadWorkspace}
      />
      <ToastStack items={toasts} />
    </div>
  );
}

function LoginScreen({ onSendCode, onVerify }) {
  const [step, setStep] = useState("phone");
  const [country, setCountry] = useState("+86");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [login, setLogin] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function sendCode() {
    const cleanPhone = phone.replace(/[^\d]/g, "");
    const fullPhone = `${country}${cleanPhone}`;
    if (!cleanPhone || cleanPhone.length < 5) {
      setError("请输入有效手机号");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onSendCode({
        phone: fullPhone,
        onSuccess: (res) => {
          setLogin(res);
          setStep("code");
        },
      });
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (!/^\d{5}$/.test(code.trim())) {
      setError("验证码通常为 5 位数字");
      return;
    }
    if (!login?.login_id) {
      setError("登录会话丢失，请重新发送验证码");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onVerify({ login_id: login.login_id, code, password: password || undefined });
    } catch (err) {
      if (err.status === 409 || err.detail === "password_required") {
        setError("请输入 Telegram 两步验证密码");
      } else if (err.detail === "invalid_code") {
        setError("验证码不正确");
      } else if (err.detail === "code_expired") {
        setError("验证码已过期");
      } else {
        setError(err.detail || err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="panel w-full max-w-[460px] rounded-lg border-none fade-in" shadow="none">
        <CardHeader className="flex-col items-start gap-5 px-6 pt-6">
          <div className="brand-mark grid h-10 w-10 place-items-center rounded-lg text-[#11100f]">
            <MessageSquareText size={20} />
          </div>
          <div>
            <p className="mono mb-2 text-xs uppercase tracking-[0.18em] text-muted">Signal Desk</p>
            <h1 className="text-2xl font-semibold tracking-tight">连接 Telegram</h1>
          </div>
        </CardHeader>
        <CardBody className="gap-5 px-6 pb-6">
          <div className="grid grid-cols-2 gap-2">
            <Chip
              className={cx("h-8 justify-center rounded-lg", step === "phone" && "bg-teal-400 text-[#11100f]")}
              variant={step === "phone" ? "solid" : "flat"}
            >
              1 手机号
            </Chip>
            <Chip
              className={cx("h-8 justify-center rounded-lg", step === "code" && "bg-amber-300 text-[#11100f]")}
              variant={step === "code" ? "solid" : "flat"}
            >
              2 验证码
            </Chip>
          </div>

          {step === "phone" ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-[150px_1fr] gap-2 max-sm:grid-cols-1">
                <Select
                  aria-label="国家区号"
                  className="rounded-lg"
                  selectedKeys={[country]}
                  size="sm"
                  onSelectionChange={(keys) => setCountry(firstKey(keys) || "+86")}
                >
                  {COUNTRY_CODES.map((item) => (
                    <SelectItem key={item.id}>{item.label}</SelectItem>
                  ))}
                </Select>
                <Input
                  aria-label="手机号"
                  placeholder="138 0000 0000"
                  type="tel"
                  value={phone}
                  onValueChange={setPhone}
                  size="sm"
                  startContent={<UserRound size={16} className="text-muted" />}
                />
              </div>
              <Button
                className="rounded-lg bg-teal-400 font-semibold text-[#11100f]"
                isLoading={loading}
                endContent={!loading && <ArrowRight size={16} />}
                onPress={sendCode}
              >
                发送验证码
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              <Input
                aria-label="验证码"
                classNames={{ input: "mono text-center text-xl tracking-[0.45em]" }}
                maxLength={5}
                placeholder="00000"
                type="text"
                value={code}
                onValueChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 5))}
                size="sm"
              />
              <Input
                aria-label="两步验证密码"
                placeholder="两步验证密码"
                type="password"
                value={password}
                onValueChange={setPassword}
                size="sm"
                startContent={<Lock size={16} className="text-muted" />}
              />
              <div className="grid grid-cols-[104px_1fr] gap-2">
                <Button className="rounded-lg" variant="flat" onPress={() => setStep("phone")}>
                  返回
                </Button>
                <Button
                  className="rounded-lg bg-amber-300 font-semibold text-[#11100f]"
                  isLoading={loading}
                  endContent={!loading && <Check size={16} />}
                  onPress={verify}
                >
                  确认登录
                </Button>
              </div>
            </div>
          )}

          {error ? (
            <div className="flex items-center gap-2 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          ) : null}

          <Divider className="bg-white/10" />
          <div className="grid gap-2 text-xs text-muted">
            <span className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-teal-300" />
              凭据加密保存在本地数据库
            </span>
            <span className="flex items-center gap-2">
              <Sparkles size={14} className="text-amber-300" />
              报告由当前后端模板生成
            </span>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}

function Dashboard(props) {
  const {
    account,
    chats,
    filteredChats,
    activeChat,
    activeBinding,
    activePreview,
    activeReports,
    activeReport,
    activeRuns,
    runs,
    templates,
    ui,
    unreadCountsByChat,
    unreadTotal,
    totalReports,
    workspaceLoading,
    chatLoading,
    previewLoading,
    running,
    backlogActioning,
    selectedReports,
    reportsMeta,
    mobileSidebarOpen,
    onUi,
    onSelectChat,
    onSelectReport,
    onToggleSelected,
    onToggleAllSelected,
    onSync,
    onLogout,
    onPatchBinding,
    onRunNow,
    onStartCatchUp,
    onStopCatchUp,
    onSkipBacklog,
    onOpenRange,
    onOpenTemplate,
    onOpenData,
    onOpenDialogs,
    onCleanup,
    onLoadMore,
    onDeleteReport,
    onBulkDeleteReports,
    onMarkReport,
    onMarkAllRead,
    onRegenerateReport,
    onCopy,
    onMobileMenu,
    onCloseMobileMenu,
  } = props;

  return (
    <>
      <header className="glass-rail sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-3 px-4 md:px-6">
          <Button isIconOnly className="rounded-lg lg:hidden" variant="flat" onPress={onMobileMenu}>
            <Menu size={18} />
          </Button>
          <div className="flex min-w-0 items-center gap-3">
            <div className="brand-mark grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#11100f]">
              <LayoutDashboard size={18} />
            </div>
            <div className="hide-mobile">
              <h1 className="text-sm font-semibold leading-4">Signal Desk</h1>
              <p className="mono text-[10px] uppercase tracking-[0.18em] text-muted">Personal Chat Manager</p>
            </div>
          </div>
          <Input
            aria-label="搜索聊天"
            className="mx-auto max-w-xl"
            placeholder="搜索聊天"
            size="sm"
            value={ui.search}
            onValueChange={(search) => onUi({ search })}
            startContent={<Search size={16} className="text-muted" />}
          />
          <div className="flex items-center gap-1">
            {activeRuns.length ? (
              <Chip
                className="hide-mobile rounded-lg border-teal-300/30 bg-teal-300/10 text-teal-100"
                startContent={<Loader2 size={13} className="animate-spin" />}
                variant="bordered"
              >
                {activeRuns.length} 运行中
              </Chip>
            ) : null}
            <Tooltip content="重新同步">
              <Button isIconOnly className="rounded-lg" isLoading={workspaceLoading} variant="flat" onPress={onSync}>
                {!workspaceLoading && <RefreshCw size={17} />}
              </Button>
            </Tooltip>
            <Tooltip content="对话管理">
              <Button isIconOnly className="rounded-lg hide-mobile" variant="flat" onPress={onOpenDialogs}>
                <ListChecks size={17} />
              </Button>
            </Tooltip>
            <Tooltip content="清理已删除账号">
              <Button isIconOnly className="rounded-lg hide-mobile" variant="flat" onPress={onCleanup}>
                <Trash2 size={17} />
              </Button>
            </Tooltip>
            <Tooltip content="数据库快照">
              <Button isIconOnly className="rounded-lg hide-mobile" variant="flat" onPress={onOpenData}>
                <Database size={17} />
              </Button>
            </Tooltip>
            <Avatar className="ml-1 h-8 w-8 text-xs" name={initials(account.account_display_name || account.account_username)} />
            <Tooltip content="断开账号">
              <Button isIconOnly className="rounded-lg hide-mobile" color="danger" variant="light" onPress={onLogout}>
                <LogOut size={17} />
              </Button>
            </Tooltip>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1480px] px-4 py-5 md:px-6">
        <div className="workspace-grid">
          <aside className="hidden min-w-0 overflow-hidden lg:block">
            <Sidebar
              account={account}
              chats={chats}
              filteredChats={filteredChats}
              activeChat={activeChat}
              filter={ui.filter}
              unreadCountsByChat={unreadCountsByChat}
              unreadTotal={unreadTotal}
              totalReports={totalReports}
              onFilter={(filter) => onUi({ filter })}
              onSelectChat={onSelectChat}
            />
          </aside>

          <section className="relative z-0 grid min-w-0 gap-4">
            {!activeChat ? (
              <EmptyWorkspace onSync={onSync} loading={workspaceLoading} />
            ) : (
              <>
                <CommandPanel
                  chat={activeChat}
                  binding={activeBinding}
                  preview={activePreview}
                  loading={chatLoading}
                  previewLoading={previewLoading}
                  running={running}
                  backlogActioning={backlogActioning}
                  onRunNow={onRunNow}
                  onStartCatchUp={onStartCatchUp}
                  onStopCatchUp={onStopCatchUp}
                  onSkipBacklog={onSkipBacklog}
                  onOpenRange={onOpenRange}
                  onPatchBinding={onPatchBinding}
                />
                <AutomationPanel
                  chat={activeChat}
                  binding={activeBinding}
                  templates={templates}
                  onPatchBinding={onPatchBinding}
                  onOpenTemplate={onOpenTemplate}
                />
                <ReportFeed
                  reports={activeReports}
                  activeReport={activeReport}
                  selectedReports={selectedReports}
                  unreadCount={unreadCountsByChat[activeChat.id] || 0}
                  showUnreadOnly={ui.showUnreadOnly}
                  meta={reportsMeta}
                  onShowUnreadOnly={(showUnreadOnly) => onUi({ showUnreadOnly })}
                  onSelectReport={onSelectReport}
                  onToggleSelected={onToggleSelected}
                  onToggleAllSelected={onToggleAllSelected}
                  onMarkAllRead={onMarkAllRead}
                  onLoadMore={onLoadMore}
                  onBulkDelete={onBulkDeleteReports}
                />
                <RunsHistory runs={runs} />
              </>
            )}
          </section>
        </div>
      </main>

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="关闭聊天列表"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            type="button"
            onClick={onCloseMobileMenu}
          />
          <div className="panel relative h-full w-[88vw] max-w-[360px] overflow-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">聊天源</span>
              <Button isIconOnly className="rounded-lg" variant="flat" onPress={onCloseMobileMenu}>
                <X size={16} />
              </Button>
            </div>
            <Sidebar
              account={account}
              chats={chats}
              filteredChats={filteredChats}
              activeChat={activeChat}
              filter={ui.filter}
              unreadCountsByChat={unreadCountsByChat}
              unreadTotal={unreadTotal}
              totalReports={totalReports}
              onFilter={(filter) => onUi({ filter })}
              onSelectChat={onSelectChat}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function Sidebar(props) {
  const {
    account,
    chats,
    filteredChats,
    activeChat,
    filter,
    unreadCountsByChat,
    unreadTotal,
    totalReports,
    onFilter,
    onSelectChat,
  } = props;
  const autoCount = chats.filter((entry) => entry.binding?.auto_summary_enabled).length;

  return (
    <div className="grid min-w-0 gap-4 overflow-hidden">
      <Card className="panel rounded-lg border-none" shadow="none">
        <CardBody className="gap-4 p-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-11 w-11 text-sm" name={initials(account.account_display_name || account.account_username)} />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">
                {account.account_display_name || account.account_username || "Telegram"}
              </h2>
              <p className="mono truncate text-xs text-muted">
                @{account.account_username || account.phone_e164 || "connected"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MetricMini label="同步" value={chats.length} />
            <MetricMini label="自动" value={autoCount} tone="teal" />
            <MetricMini label="未读" value={unreadTotal} tone="amber" />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted">
            <span>报告总数</span>
            <span className="mono text-right text-default-200">{formatNumber(totalReports)}</span>
          </div>
        </CardBody>
      </Card>

      <Tabs
        aria-label="聊天过滤"
        className="w-full"
        classNames={{ tabList: "grid w-full grid-cols-4 rounded-lg bg-white/5 p-1", tab: "rounded-md" }}
        selectedKey={filter}
        size="sm"
        onSelectionChange={(key) => onFilter(String(key))}
      >
        {FILTERS.map((item) => (
          <Tab key={item.id} title={item.label} />
        ))}
      </Tabs>

      <div className="flex items-center justify-between px-1">
        <span className="mono text-xs uppercase tracking-[0.16em] text-muted">Sources</span>
        <span className="mono text-xs text-muted">{filteredChats.length}</span>
      </div>

      <div className="grid min-w-0 max-h-[calc(100vh-305px)] gap-2 overflow-x-hidden overflow-y-auto pr-1 max-lg:max-h-none">
        {filteredChats.length ? (
          filteredChats.map((entry) => (
            <ChatRow
              key={entry.chat.id}
              entry={entry}
              active={entry.chat.id === activeChat?.id}
              unread={unreadCountsByChat[entry.chat.id] || 0}
              onPress={() => onSelectChat(entry.chat.id)}
            />
          ))
        ) : (
          <div className="rounded-lg border border-white/10 p-5 text-center text-sm text-muted">没有匹配的聊天</div>
        )}
      </div>
    </div>
  );
}

function MetricMini({ label, value, tone = "default" }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-center">
      <div className={cx("text-base font-semibold", tone === "teal" && "text-teal-300", tone === "amber" && "text-amber-300")}>
        {formatNumber(value)}
      </div>
      <div className="mono mt-0.5 text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
    </div>
  );
}

function ChatRow({ entry, active, unread, onPress }) {
  const { chat, binding } = entry;
  const Icon = CHAT_TYPE[chat.chat_type]?.icon || MessageSquareText;
  return (
    <button
      className={cx("chat-row rounded-lg px-3.5 py-3 text-left", active && "is-active")}
      type="button"
      onClick={onPress}
    >
      <div className="flex w-full min-w-0 gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-teal-200">
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{chat.title}</h3>
            {binding?.pinned_at ? <Pin size={13} className="shrink-0 text-amber-300" /> : null}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <Chip className="h-5 rounded-md text-[10px]" size="sm" variant="flat">
              {CHAT_TYPE[chat.chat_type]?.label || chat.chat_type}
            </Chip>
            {binding?.auto_summary_enabled ? (
              <Chip className="h-5 rounded-md bg-teal-300/10 text-[10px] text-teal-100" size="sm" variant="flat">
                {FREQUENCIES.find((item) => item.id === binding.frequency)?.label || "自动"}
              </Chip>
            ) : null}
            {unread ? (
              <Chip className="h-5 rounded-md bg-amber-300 text-[10px] text-[#11100f]" size="sm">
                {unread}
              </Chip>
            ) : null}
          </div>
          <p className="mono mt-2.5 truncate pb-0.5 text-[11px] leading-4 text-muted">
            游标 {binding?.cursor_message_id || "-"} · {formatRelative(binding?.last_success_at)}
          </p>
        </div>
      </div>
    </button>
  );
}

function EmptyWorkspace({ onSync, loading }) {
  return (
    <Card className="panel rounded-lg border-none" shadow="none">
      <CardBody className="grid min-h-[420px] place-items-center p-8 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg bg-teal-300/10 text-teal-200">
            <MessageSquareText size={24} />
          </div>
          <h2 className="text-lg font-semibold">还没有聊天源</h2>
          <p className="mt-2 text-sm text-muted">同步 Telegram 后会在这里显示群组、频道和报告流。</p>
          <Button
            className="mt-5 rounded-lg bg-teal-400 font-semibold text-[#11100f]"
            isLoading={loading}
            startContent={!loading && <RefreshCw size={16} />}
            onPress={onSync}
          >
            重新同步
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function CommandPanel({
  chat,
  binding,
  preview,
  loading,
  previewLoading,
  running,
  backlogActioning,
  onRunNow,
  onStartCatchUp,
  onStopCatchUp,
  onSkipBacklog,
  onOpenRange,
  onPatchBinding,
}) {
  const type = CHAT_TYPE[chat.chat_type] || CHAT_TYPE.group;
  const Icon = type.icon;
  const isPinned = Boolean(binding?.pinned_at);
  const activeError = hasActiveBindingError(binding);
  const isCounting = previewLoading || (loading && !preview);
  const countFailed = Boolean(preview?.count_error);
  const pendingTextValue = isCounting
    ? "计算中"
    : countFailed
      ? "计算失败"
      : formatNumber(preview?.pending_count);
  const pendingTotalValue = isCounting
    ? "计算中"
    : countFailed
      ? "计算失败"
      : formatNumber(preview?.pending_total);
  const backlogSpanValue = isCounting
    ? "计算中"
    : countFailed
      ? "计算失败"
      : preview?.pending_id_span == null
        ? "-"
        : preview.pending_id_span > 0
          ? `≈${formatNumber(preview.pending_id_span)}`
          : "0";
  const pendingHint = countFailed
    ? "请稍后重试"
    : preview?.pending_capped
      ? "仍有后续积压"
      : "下一轮可处理";
  const totalHint = countFailed
    ? "Telegram 计数失败"
    : preview?.pending_capped
      ? "本轮窗口已满"
      : "含媒体与服务消息";
  const backlogHint = countFailed
    ? "无法读取最新消息"
    : preview?.latest_message_at
      ? `最新 ${formatAbsolute(preview.latest_message_at)}`
      : "按消息 ID 估算";
  const hasBacklog = !countFailed && !isCounting && (
    Boolean(preview?.pending_capped) || (preview?.pending_id_span || 0) > (preview?.scan_cap || 500)
  );

  return (
    <Card className="panel rounded-lg border-none fade-in" shadow="none">
      <CardBody className="gap-5 p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-teal-300/10 text-teal-100">
              <Icon size={23} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-semibold tracking-tight">{chat.title}</h2>
                <Chip className="rounded-md" size="sm" variant="flat">{type.label}</Chip>
                {activeError ? <Chip color="danger" size="sm" variant="flat">异常</Chip> : null}
              </div>
              <p className="mono mt-1 text-xs text-muted">
                {chat.username ? `@${chat.username}` : `external:${chat.external_chat_id}`} · {formatNumber(chat.member_count)} members
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tooltip content={isPinned ? "取消置顶" : "置顶"}>
              <Button
                isIconOnly
                className="rounded-lg"
                variant="flat"
                onPress={() => onPatchBinding(chat.id, { pinned: !isPinned }, isPinned ? "已取消置顶" : "已置顶")}
              >
                {isPinned ? <PinOff size={17} /> : <Pin size={17} />}
              </Button>
            </Tooltip>
            <Button
              className="rounded-lg"
              startContent={<CalendarRange size={16} />}
              variant="flat"
              onPress={onOpenRange}
              isDisabled={running}
            >
              历史快照
            </Button>
            <Button
              className="rounded-lg bg-teal-400 font-semibold text-[#11100f]"
              isLoading={running}
              startContent={!running && <Sparkles size={16} />}
              onPress={() => onRunNow(chat.id)}
            >
              生成报告
            </Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-5">
          <MetricCell label="本轮文本" value={pendingTextValue} hint={pendingHint} accent="teal" loading={isCounting} />
          <MetricCell label="本轮消息" value={pendingTotalValue} hint={totalHint} accent="amber" loading={isCounting} />
          <MetricCell label="积压跨度" value={backlogSpanValue} hint={backlogHint} accent="coral" loading={isCounting} />
          <MetricCell label="游标" value={binding?.cursor_message_id || "-"} hint={formatAbsolute(preview?.cursor_at || binding?.cursor_at)} />
          <MetricCell label="下次运行" value={formatAbsolute(preview?.next_run_at)} />
        </div>

        {activeError ? (
          <div className="rounded-lg border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">
            {binding.last_error_message}
          </div>
        ) : null}

        <BacklogPanel
          chat={chat}
          binding={binding}
          preview={preview}
          visible={hasBacklog || Boolean(preview?.catch_up_active)}
          running={running}
          actioning={backlogActioning}
          onStartCatchUp={onStartCatchUp}
          onStopCatchUp={onStopCatchUp}
          onSkipBacklog={onSkipBacklog}
          onOpenRange={onOpenRange}
        />
      </CardBody>
    </Card>
  );
}

function BacklogPanel({
  chat,
  binding,
  preview,
  visible,
  running,
  actioning,
  onStartCatchUp,
  onStopCatchUp,
  onSkipBacklog,
  onOpenRange,
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [strategy, setStrategy] = useState(() => catchUpStrategyFromPreview(preview));
  useEffect(() => {
    setStrategy(catchUpStrategyFromPreview(preview));
  }, [
    preview?.catch_up_active,
    preview?.catch_up_batch_size,
    preview?.catch_up_cadence,
    preview?.catch_up_max_batches,
    preview?.catch_up_max_reports,
    preview?.catch_up_max_tokens,
    preview?.catch_up_result_type,
    preview?.catch_up_failure_policy,
  ]);
  if (!visible || !preview) return null;
  const active = Boolean(preview.catch_up_active);
  const age = formatDurationBetween(preview.cursor_at, preview.latest_message_at);
  const span = preview.pending_id_span == null ? "-" : `≈${formatNumber(preview.pending_id_span)}`;
  const selectedBatchSize = Number(strategy.batchSize) || preview.catch_up_batch_size || 500;
  const cadence = CATCH_UP_CADENCES.find((item) => item.id === strategy.cadence) || CATCH_UP_CADENCES[1];
  const estimatedBatches = preview.pending_id_span
    ? Math.max(1, Math.ceil(preview.pending_id_span / selectedBatchSize))
    : preview.estimated_batches;
  const batches = estimatedBatches ? `约 ${formatNumber(estimatedBatches)} 批` : "-";
  const done = preview.catch_up_batches_completed || 0;
  const estimated = estimatedBatches || 0;
  const remaining = estimated ? Math.max(estimated - done, 0) : null;
  const estimatedDuration = remaining == null ? "-" : formatMinutesDuration(remaining * cadence.minutes);
  const normalCadence = FREQUENCIES.find((item) => item.id === binding?.frequency)?.label || binding?.frequency || "-";
  const strategyPayload = {
    batch_size: selectedBatchSize,
    cadence: strategy.cadence,
    max_batches: nullableNumber(strategy.maxBatches),
    max_tokens: nullableNumber(strategy.maxTokens),
    max_reports: nullableNumber(strategy.maxReports),
    result_type: strategy.resultType,
    failure_policy: strategy.failurePolicy,
  };
  const updateStrategy = (patch) => setStrategy((current) => ({ ...current, ...patch }));

  return (
    <div className={cx("backlog-panel", active && "is-active")}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Chip className={cx("rounded-md", active ? "bg-teal-300/10 text-teal-100" : "bg-rose-300/10 text-rose-100")} size="sm" variant="flat">
            {active ? "追赶中" : "发现积压"}
          </Chip>
          <span className="mono text-xs text-muted">
            {age ? `落后 ${age}` : "游标落后"}
            {" · "}
            {span} 消息跨度
          </span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <BacklogStat label="预计批次" value={batches} />
          <BacklogStat label="已完成" value={active ? `${formatNumber(done)} 批` : "-"} />
          <BacklogStat label="单批上限" value={`${formatNumber(selectedBatchSize)} 条`} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <Button
          className={cx("rounded-lg font-semibold", active ? "bg-white/10 text-default-100" : "bg-teal-400 text-[#11100f]")}
          isDisabled={active || running}
          isLoading={actioning && !active}
          startContent={!actioning && <FastForward size={16} />}
          onPress={() => onStartCatchUp(chat.id, strategyPayload)}
        >
          {active ? "智能追赶中" : "智能追赶"}
        </Button>
        {active ? (
          <Button
            className="rounded-lg"
            color="danger"
            isLoading={actioning}
            startContent={!actioning && <CirclePause size={16} />}
            variant="flat"
            onPress={() => onStopCatchUp(chat.id)}
          >
            停止追赶
          </Button>
        ) : null}
        <Button
          className={cx("rounded-lg", advancedOpen && "bg-white/10")}
          endContent={<ChevronDown size={15} className={cx("transition-transform", advancedOpen && "rotate-180")} />}
          startContent={<Settings2 size={16} />}
          variant="flat"
          onPress={() => setAdvancedOpen((open) => !open)}
        >
          高级处理
        </Button>
      </div>
      {advancedOpen ? (
        <div className="backlog-advanced">
          <div className="grid gap-2 md:grid-cols-4">
            <BacklogStat label="追赶节奏" value={cadence.label} />
            <BacklogStat label="剩余批次" value={remaining == null ? "-" : `约 ${formatNumber(remaining)} 批`} />
            <BacklogStat label="预计耗时" value={estimatedDuration} />
            <BacklogStat label="完成后" value={normalCadence} />
          </div>
          <div className="backlog-control-grid">
            <BacklogOptionGroup
              label="批大小"
              value={strategy.batchSize}
              options={CATCH_UP_BATCH_SIZES}
              disabled={active}
              onChange={(batchSize) => updateStrategy({ batchSize })}
            />
            <BacklogOptionGroup
              label="执行节奏"
              value={strategy.cadence}
              options={CATCH_UP_CADENCES}
              disabled={active}
              onChange={(cadence) => updateStrategy({ cadence })}
            />
            <BacklogOptionGroup
              label="结果类型"
              value={strategy.resultType}
              options={CATCH_UP_RESULT_TYPES}
              disabled={active}
              onChange={(resultType) => updateStrategy({ resultType })}
            />
            <BacklogOptionGroup
              label="失败处理"
              value={strategy.failurePolicy}
              options={CATCH_UP_FAILURE_POLICIES}
              disabled={active}
              onChange={(failurePolicy) => updateStrategy({ failurePolicy })}
            />
          </div>
          <div className="backlog-limit-grid">
            <BacklogNumberField
              label="最多运行 N 批"
              value={strategy.maxBatches}
              disabled={active}
              placeholder="不限制"
              onChange={(maxBatches) => updateStrategy({ maxBatches })}
            />
            <BacklogNumberField
              label="最多消耗 N tokens"
              value={strategy.maxTokens}
              disabled={active}
              placeholder="不限制"
              onChange={(maxTokens) => updateStrategy({ maxTokens })}
            />
            <BacklogNumberField
              label="最多生成 N 份报告"
              value={strategy.maxReports}
              disabled={active || strategy.resultType === "latest_summary"}
              placeholder={strategy.resultType === "latest_summary" ? "固定 1" : "不限制"}
              onChange={(maxReports) => updateStrategy({ maxReports })}
            />
          </div>
          {active ? (
            <div className="grid gap-2 md:grid-cols-4">
              <BacklogStat label="已用 tokens" value={formatNumber(preview.catch_up_tokens_used)} />
              <BacklogStat label="已生成报告" value={formatNumber(preview.catch_up_reports_generated)} />
              <BacklogStat label="失败批次" value={formatNumber(preview.catch_up_failed_batches)} />
              <BacklogStat label="停止原因" value={preview.catch_up_stop_reason || "-"} />
            </div>
          ) : null}
          <div className="backlog-advanced-actions">
            <div className="backlog-choice">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.055] text-teal-100">
                <SkipForward size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-default-100">跳过旧积压</div>
                <div className="mono mt-0.5 text-[11px] text-muted">游标 → 最新消息</div>
              </div>
              <Button
                className="rounded-lg"
                isDisabled={running || active}
                isLoading={actioning && !active}
                variant="flat"
                onPress={() => onSkipBacklog(chat.id)}
              >
                从现在开始
              </Button>
            </div>
            <div className="backlog-choice">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.055] text-amber-100">
                <CalendarRange size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-default-100">单独处理一段历史</div>
                <div className="mono mt-0.5 text-[11px] text-muted">不移动当前游标</div>
              </div>
              <Button
                className="rounded-lg"
                startContent={<CalendarRange size={16} />}
                variant="flat"
                onPress={onOpenRange}
              >
                历史区间
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BacklogStat({ label, value }) {
  return (
    <div className="backlog-stat">
      <div className="text-sm font-semibold text-default-100">{value}</div>
      <div className="mono mt-0.5 text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
    </div>
  );
}

function BacklogOptionGroup({ label, value, options, disabled, onChange }) {
  return (
    <div className="backlog-control">
      <div className="mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="backlog-segmented">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={cx("backlog-option", value === option.id && "is-selected")}
            disabled={disabled}
            onClick={() => onChange(option.id)}
          >
            <span>{option.label}</span>
            {option.hint ? <small>{option.hint}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function BacklogNumberField({ label, value, disabled, placeholder, onChange }) {
  return (
    <label className="backlog-number-field">
      <span className="mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</span>
      <input
        disabled={disabled}
        inputMode="numeric"
        min="1"
        placeholder={placeholder}
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function MetricCell({ label, value, hint, accent, loading }) {
  return (
    <div className={cx("metric-cell rounded-lg p-3", loading && "is-loading")}>
      <div className={cx(
        "metric-value text-lg font-semibold",
        accent === "teal" && "text-teal-200",
        accent === "amber" && "text-amber-200",
        accent === "coral" && "text-coral",
      )}>
        {value}
      </div>
      <div className="mono mt-1 text-[11px] uppercase tracking-[0.14em] text-muted">{label}</div>
      {hint ? <div className="metric-hint mt-1 text-[11px] leading-4 text-muted">{hint}</div> : null}
    </div>
  );
}

function AutomationPanel({ chat, binding, templates, onPatchBinding, onOpenTemplate }) {
  const autoEnabled = Boolean(binding?.auto_summary_enabled);
  const selectedTemplate = binding?.template_key || "default";
  const cursorLocked = Boolean(binding?.cursor_message_id);

  return (
    <Card className="panel rounded-lg border-none fade-in" shadow="none">
      <CardHeader className="flex items-center justify-between gap-3 px-5 pb-0 pt-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Settings2 size={16} className="text-teal-200" />
            自动化配置
          </h3>
          <p className="mt-1 text-xs text-muted">
            {autoEnabled ? "自动总结已开启" : "当前为手动运行"}
          </p>
        </div>
        <Switch
          color="success"
          isSelected={autoEnabled}
          size="sm"
          onValueChange={(enabled) => onPatchBinding(
            chat.id,
            { auto_summary_enabled: enabled },
            enabled ? "已开启自动总结" : "已暂停自动总结",
          )}
        >
          自动
        </Switch>
      </CardHeader>
      <CardBody className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Select
          aria-label="频率"
          label="频率"
          selectedKeys={[binding?.frequency || "manual"]}
          size="sm"
          isDisabled={!autoEnabled}
          onSelectionChange={(keys) => {
            const value = firstKey(keys);
            if (value) onPatchBinding(chat.id, { frequency: value }, "频率已更新");
          }}
        >
          {FREQUENCIES.map((item) => (
            <SelectItem key={item.id}>{item.label}</SelectItem>
          ))}
        </Select>
        <Select
          aria-label="语言"
          label="语言"
          selectedKeys={[binding?.preferred_language || "zh-CN"]}
          size="sm"
          onSelectionChange={(keys) => {
            const value = firstKey(keys);
            if (value) onPatchBinding(chat.id, { preferred_language: value }, "语言已更新");
          }}
        >
          {LANGUAGES.map((item) => (
            <SelectItem key={item.id}>{item.label}</SelectItem>
          ))}
        </Select>
        <Select
          aria-label="首次总结"
          label="首次总结"
          selectedKeys={[binding?.first_summary_mode || "from_now"]}
          size="sm"
          isDisabled={cursorLocked}
          onSelectionChange={(keys) => {
            const value = firstKey(keys);
            if (value) onPatchBinding(chat.id, { first_summary_mode: value }, "首次模式已更新");
          }}
        >
          {FIRST_SUMMARY_MODES.map((item) => (
            <SelectItem key={item.id}>{item.label}</SelectItem>
          ))}
        </Select>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Select
            aria-label="模板"
            label="模板"
            selectedKeys={[selectedTemplate]}
            size="sm"
            onSelectionChange={(keys) => {
              const value = firstKey(keys);
              if (value) onPatchBinding(chat.id, { template_key: value }, "模板已更新");
            }}
          >
            {templates.map((item) => (
              <SelectItem key={item.id}>{item.label}</SelectItem>
            ))}
          </Select>
          <Tooltip content="查看模板">
            <Button
              isIconOnly
              className="mt-6 rounded-lg"
              variant="flat"
              onPress={() => onOpenTemplate(selectedTemplate)}
            >
              <Eye size={16} />
            </Button>
          </Tooltip>
        </div>
      </CardBody>
    </Card>
  );
}

function ReportFeed(props) {
  const {
    reports,
    activeReport,
    selectedReports,
    unreadCount,
    showUnreadOnly,
    meta,
    onShowUnreadOnly,
    onSelectReport,
    onToggleSelected,
    onToggleAllSelected,
    onMarkAllRead,
    onLoadMore,
    onBulkDelete,
  } = props;
  const visibleReports = showUnreadOnly ? reports.filter((report) => !report.read_at) : reports;
  const allSelected = reports.length > 0 && reports.every((report) => selectedReports.has(report.id));

  return (
    <Card className="panel rounded-lg border-none fade-in" shadow="none">
      <CardHeader className="flex-col items-stretch gap-3 px-5 pt-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <FileText size={16} className="text-amber-200" />
            历史报告
          </h3>
          <p className="mt-1 text-xs text-muted">{reports.length} 份 · {unreadCount} 未读</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Switch size="sm" isSelected={showUnreadOnly} onValueChange={onShowUnreadOnly}>
            未读
          </Switch>
          <Button
            className="rounded-lg"
            size="sm"
            variant="flat"
            startContent={<CheckCircle2 size={15} />}
            isDisabled={!unreadCount}
            onPress={onMarkAllRead}
          >
            全部已读
          </Button>
          <Button
            className="rounded-lg"
            color="danger"
            size="sm"
            variant="flat"
            startContent={<Trash2 size={15} />}
            isDisabled={!selectedReports.size}
            onPress={onBulkDelete}
          >
            删除 {selectedReports.size || ""}
          </Button>
        </div>
      </CardHeader>
      <CardBody className="gap-2 p-5 pt-3">
        {reports.length ? (
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2">
            <Checkbox
              size="sm"
              isSelected={allSelected}
              onValueChange={onToggleAllSelected}
            >
              全选
            </Checkbox>
            <span className="mono text-xs text-muted">latest first</span>
          </div>
        ) : null}

        {visibleReports.length ? (
          visibleReports.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              active={report.id === activeReport?.id}
              selected={selectedReports.has(report.id)}
              onSelect={() => onSelectReport(report.id)}
              onToggle={(checked) => onToggleSelected(report.id, checked)}
            />
          ))
        ) : (
          <div className="rounded-lg border border-white/10 p-8 text-center text-sm text-muted">
            {showUnreadOnly ? "没有未读报告" : "还没有报告"}
          </div>
        )}

        {meta?.hasMore ? (
          <Button className="rounded-lg" variant="flat" onPress={onLoadMore}>
            加载更多
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ReportRow({ report, active, selected, onSelect, onToggle }) {
  return (
    <div className={cx("report-row rounded-lg p-3", active && "is-active")}>
      <div className="flex items-start gap-3">
        <Checkbox className="mt-1" isSelected={selected} size="sm" onValueChange={onToggle} />
        <button className="min-w-0 flex-1 text-left" type="button" onClick={onSelect}>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className={cx("truncate text-sm font-semibold", !report.read_at && "text-amber-100")}>
              {report.title || "Untitled report"}
            </h4>
            {!report.read_at ? <Chip className="h-5 rounded-md bg-amber-300 text-[10px] text-[#11100f]">未读</Chip> : null}
          </div>
          <p className="clamp-2 mt-1 text-sm text-muted">{report.executive_summary || report.content_markdown || "空报告"}</p>
          <p className="mono mt-2 text-xs text-muted">
            {formatAbsolute(report.generated_at)}
            {report.covered_from_at ? ` · ${formatAbsolute(report.covered_from_at)} - ${formatAbsolute(report.covered_to_at)}` : ""}
          </p>
        </button>
        <ChevronRightVisual active={active} />
      </div>
    </div>
  );
}

function ChevronRightVisual({ active }) {
  return <ArrowRight size={16} className={cx("mt-1 shrink-0 text-muted transition", active && "text-amber-200")} />;
}

function ReportReaderModal({ isOpen, report, onCopy, onDelete, onMarkReport, onRegenerate, onClose }) {
  if (!report) return null;
  const sections = [
    { key: "key_points", title: "重点", icon: Sparkles, items: asArray(report.key_points) },
    { key: "decisions", title: "决策", icon: CheckCircle2, items: asArray(report.decisions) },
    { key: "action_items", title: "待办", icon: Clipboard, items: asArray(report.action_items) },
    { key: "risks", title: "风险", icon: AlertCircle, items: asArray(report.risks) },
    { key: "mentions", title: "提及", icon: Mail, items: asArray(report.mentions) },
  ].filter((section) => section.items.length);

  return (
    <Modal isOpen={isOpen} placement="center" size="5xl" scrollBehavior="inside" onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="reader-modal">
        <ModalHeader className="reader-header">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-amber-300/12 text-amber-200">
              <FileText size={21} />
            </div>
            <div className="min-w-0">
              <p className="mono mb-2 text-xs uppercase tracking-[0.16em] text-muted">
                {formatAbsolute(report.generated_at)}
                {report.covered_from_at ? ` · ${formatAbsolute(report.covered_from_at)} - ${formatAbsolute(report.covered_to_at)}` : ""}
              </p>
              <h3 className="max-w-3xl text-xl font-semibold leading-tight tracking-tight">{report.title || "报告详情"}</h3>
              {report.executive_summary ? (
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{report.executive_summary}</p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Chip className={cx("rounded-md", report.read_at ? "bg-teal-300/10 text-teal-100" : "bg-amber-300 text-[#11100f]")} size="sm" variant="flat">
              {report.read_at ? "已读" : "未读"}
            </Chip>
            <Tooltip content={report.read_at ? "标为未读" : "标为已读"}>
              <Button isIconOnly className="rounded-lg" variant="flat" onPress={() => onMarkReport(report.id, !report.read_at)}>
                {report.read_at ? <MailOpen size={16} /> : <Mail size={16} />}
              </Button>
            </Tooltip>
            <Tooltip content="重新生成">
              <Button isIconOnly className="rounded-lg" variant="flat" onPress={() => onRegenerate(report)}>
                <RefreshCw size={16} />
              </Button>
            </Tooltip>
            <Tooltip content="复制报告">
              <Button isIconOnly className="rounded-lg" variant="flat" onPress={() => onCopy(report.content_markdown || report.executive_summary || "", "报告已复制")}>
                <Copy size={16} />
              </Button>
            </Tooltip>
            <Tooltip content="删除报告">
              <Button isIconOnly className="rounded-lg" color="danger" variant="flat" onPress={() => onDelete(report.id)}>
                <Trash2 size={16} />
              </Button>
            </Tooltip>
            <Tooltip content="关闭">
              <Button isIconOnly className="rounded-lg" variant="flat" onPress={onClose}>
                <X size={16} />
              </Button>
            </Tooltip>
          </div>
        </ModalHeader>
        <ModalBody className="reader-body">
          {sections.length ? (
            <div className="reader-section-grid">
              {sections.map((section) => {
                const Icon = section.icon;
                return (
                  <section key={section.key} className="reader-section">
                    <h4>
                      <Icon size={15} />
                      {section.title}
                    </h4>
                    <ul>
                      {section.items.map((item, index) => (
                        <li key={`${section.key}-${index}`}>{itemText(item)}</li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          ) : null}

          {asArray(report.links).length ? (
            <section className="reader-section">
              <h4>
                <Eye size={15} />
                链接
              </h4>
              <div className="grid gap-2">
                {asArray(report.links).map((item, index) => {
                  const href = linkValue(item);
                  return href ? (
                    <a key={index} className="truncate text-sm text-teal-200 hover:underline" href={href} rel="noreferrer" target="_blank">
                      {href}
                    </a>
                  ) : (
                    <span key={index} className="text-sm text-muted">{itemText(item)}</span>
                  );
                })}
              </div>
            </section>
          ) : null}

          {report.content_markdown ? (
            <article className="reader-markdown">
              <pre>{report.content_markdown}</pre>
            </article>
          ) : null}
        </ModalBody>
        <ModalFooter className="reader-footer">
          <span className="mono text-xs text-muted">{report.language || "report"}</span>
          <Button className="rounded-lg" variant="flat" onPress={onClose}>关闭</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function RunsHistory({ runs }) {
  return (
    <Card className="panel rounded-lg border-none fade-in" shadow="none">
      <CardHeader className="px-5 pt-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <History size={16} className="text-teal-200" />
            运行历史
          </h3>
          <p className="mt-1 text-xs text-muted">{runs.length ? `${runs.length} 条记录` : "暂无记录"}</p>
        </div>
      </CardHeader>
      <CardBody className="gap-2 p-5 pt-2">
        {runs.length ? runs.map((run) => (
          <div key={run.id} className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.025] p-3 md:grid-cols-[120px_1fr_auto] md:items-center">
            <Chip className="rounded-md" color={RUN_STATUS[run.status]?.color || "default"} size="sm" variant="flat">
              {RUN_STATUS[run.status]?.label || run.status}
            </Chip>
            <div className="min-w-0">
              <p className="truncate text-sm">{run.trigger_source}</p>
              <p className="mono mt-1 text-xs text-muted">
                {formatAbsolute(run.started_at || run.created_at)} · {formatNumber(run.fetched_message_count)} messages
              </p>
            </div>
            <span className="mono text-xs text-muted">{run.model_name || "-"}</span>
          </div>
        )) : (
          <div className="rounded-lg border border-white/10 p-6 text-center text-sm text-muted">还没跑过</div>
        )}
      </CardBody>
    </Card>
  );
}

function RangeRunModal({ isOpen, onClose, chat, onRun }) {
  const [fromAt, setFromAt] = useState("");
  const [toAt, setToAt] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setFromAt("");
      setToAt("");
      setLoading(false);
    }
  }, [isOpen]);

  function localInput(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function applyPreset(kind) {
    const now = new Date();
    const start = new Date(now);
    if (kind === "last_1h") start.setHours(now.getHours() - 1);
    if (kind === "last_6h") start.setHours(now.getHours() - 6);
    if (kind === "last_24h") start.setDate(now.getDate() - 1);
    if (kind === "last_7d") start.setDate(now.getDate() - 7);
    if (kind === "today") start.setHours(0, 0, 0, 0);
    if (kind === "yesterday") {
      start.setDate(now.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 0, 0);
      setToAt(localInput(end));
    } else {
      setToAt("");
    }
    setFromAt(localInput(start));
  }

  async function submit() {
    if (!chat || !fromAt) return;
    const from = new Date(fromAt);
    const to = toAt ? new Date(toAt) : null;
    if (to && to <= from) return;
    setLoading(true);
    try {
      await onRun(chat.id, { from_at: from.toISOString(), to_at: to ? to.toISOString() : null });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} placement="center" onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="rounded-lg">
        <ModalHeader className="flex-col items-start gap-1">
          <span className="flex items-center gap-2"><CalendarRange size={18} /> 历史快照</span>
          <span className="text-xs font-normal text-muted">{chat?.title || ""}</span>
        </ModalHeader>
        <ModalBody className="gap-4">
          <div className="grid grid-cols-2 gap-2">
            {[
              ["last_1h", "最近 1 小时"],
              ["last_6h", "最近 6 小时"],
              ["today", "今天"],
              ["yesterday", "昨天"],
              ["last_24h", "最近 24 小时"],
              ["last_7d", "最近 7 天"],
            ].map(([key, label]) => (
              <Button key={key} className="rounded-lg" size="sm" variant="flat" onPress={() => applyPreset(key)}>
                {label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input label="From" type="datetime-local" value={fromAt} onValueChange={setFromAt} />
            <Input label="To" type="datetime-local" value={toAt} onValueChange={setToAt} />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button className="rounded-lg" variant="flat" onPress={onClose}>取消</Button>
          <Button className="rounded-lg bg-teal-400 font-semibold text-[#11100f]" isLoading={loading} onPress={submit}>
            生成
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function TemplateModal({ isOpen, onClose, template }) {
  return (
    <Modal isOpen={isOpen} placement="center" size="3xl" scrollBehavior="inside" onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="rounded-lg">
        <ModalHeader className="flex-col items-start gap-1">
          <span className="flex items-center gap-2"><Sparkles size={18} /> 模板 · {template?.label || "default"}</span>
          <span className="text-xs font-normal text-muted">{template?.description || ""}</span>
        </ModalHeader>
        <ModalBody>
          <pre className="mono max-h-[60vh] overflow-auto rounded-lg border border-white/10 bg-black/20 p-4 text-xs leading-6 whitespace-pre-wrap">
            {template?.system_prompt || "(空)"}
          </pre>
        </ModalBody>
        <ModalFooter>
          <Button className="rounded-lg" variant="flat" onPress={onClose}>关闭</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function DataModal({ isOpen, onClose, snapshot, onCopy }) {
  const tables = snapshot ? Object.keys(snapshot) : [];
  const [active, setActive] = useState("");

  useEffect(() => {
    if (tables.length && !tables.includes(active)) setActive(tables[0]);
  }, [tables, active]);

  const text = snapshot ? JSON.stringify(active ? snapshot[active] : snapshot, null, 2) : "Loading...";

  return (
    <Modal isOpen={isOpen} placement="center" size="5xl" scrollBehavior="inside" onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="rounded-lg">
        <ModalHeader className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><Database size={18} /> 数据库快照</span>
        </ModalHeader>
        <ModalBody className="gap-3">
          {tables.length ? (
            <Tabs
              aria-label="数据库表"
              selectedKey={active}
              onSelectionChange={(key) => setActive(String(key))}
              classNames={{ tabList: "rounded-lg" }}
            >
              {tables.map((table) => <Tab key={table} title={table} />)}
            </Tabs>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted"><Spinner size="sm" /> Loading</div>
          )}
          <pre className="mono max-h-[58vh] overflow-auto rounded-lg border border-white/10 bg-black/20 p-4 text-xs leading-6 whitespace-pre-wrap">
            {text}
          </pre>
        </ModalBody>
        <ModalFooter>
          <Button className="rounded-lg" startContent={<Copy size={15} />} variant="flat" onPress={() => onCopy(JSON.stringify(snapshot, null, 2))}>
            复制 JSON
          </Button>
          <Button className="rounded-lg" variant="flat" onPress={onClose}>关闭</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function DialogsModal({ isOpen, onClose, onToast, onReload }) {
  const [dialogs, setDialogs] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dialogs.filter((dialog) => {
      if (filter !== "all" && dialog.chat_type !== filter) return false;
      if (q && !`${dialog.title} ${dialog.username || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [dialogs, filter, query]);

  const selectedItems = useMemo(
    () => dialogs.filter((dialog) => selected.has(`${dialog.chat_type}:${dialog.external_chat_id}`)),
    [dialogs, selected],
  );

  async function loadDialogs() {
    setLoading(true);
    try {
      setDialogs(await apiGet("/api/chats/dialogs"));
    } catch (err) {
      onToast(`拉取对话失败：${err.detail || err.message}`, "danger");
    } finally {
      setLoading(false);
    }
  }

  async function deleteSelected() {
    if (!selectedItems.length) return;
    setLoading(true);
    try {
      const res = await apiPost("/api/chats/bulk-delete", { items: selectedItems.map((item) => ({
        chat_type: item.chat_type,
        external_chat_id: item.external_chat_id,
        access_hash: item.access_hash,
      })) });
      onToast(`已处理 ${res.removed} 条`, "success");
      setSelected(new Set());
      await loadDialogs();
      await onReload();
    } catch (err) {
      onToast(`批量处理失败：${err.detail || err.message}`, "danger");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isOpen) loadDialogs();
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} placement="center" size="5xl" scrollBehavior="inside" onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="rounded-lg">
        <ModalHeader className="flex-col items-start gap-1">
          <span className="flex items-center gap-2"><ListChecks size={18} /> 对话管理</span>
          <span className="text-xs font-normal text-muted">{visible.length} / {dialogs.length}</span>
        </ModalHeader>
        <ModalBody className="gap-3">
          <div className="grid gap-2 md:grid-cols-[1fr_220px]">
            <Input
              aria-label="搜索对话"
              placeholder="搜索对话"
              value={query}
              onValueChange={setQuery}
              startContent={<Search size={15} className="text-muted" />}
            />
            <Select
              aria-label="类型"
              selectedKeys={[filter]}
              onSelectionChange={(keys) => setFilter(firstKey(keys) || "all")}
            >
              <SelectItem key="all">全部</SelectItem>
              <SelectItem key="private">Private</SelectItem>
              <SelectItem key="group">Group</SelectItem>
              <SelectItem key="supergroup">Supergroup</SelectItem>
              <SelectItem key="channel">Channel</SelectItem>
            </Select>
          </div>
          <div className="grid max-h-[56vh] gap-2 overflow-auto">
            {loading ? (
              <div className="grid place-items-center p-8"><Spinner /></div>
            ) : visible.length ? visible.map((dialog) => {
              const key = `${dialog.chat_type}:${dialog.external_chat_id}`;
              return (
                <div key={key} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3">
                  <Checkbox
                    isSelected={selected.has(key)}
                    onValueChange={(checked) => setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(key);
                      else next.delete(key);
                      return next;
                    })}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{dialog.title}</p>
                    <p className="mono mt-1 truncate text-xs text-muted">
                      {dialog.chat_type} · {dialog.username ? `@${dialog.username}` : dialog.external_chat_id}
                    </p>
                  </div>
                  {dialog.unread_count ? <Chip className="rounded-md bg-amber-300 text-[#11100f]" size="sm">{dialog.unread_count}</Chip> : null}
                </div>
              );
            }) : (
              <div className="rounded-lg border border-white/10 p-8 text-center text-sm text-muted">没有匹配的对话</div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button className="rounded-lg" isLoading={loading} startContent={!loading && <RefreshCw size={15} />} variant="flat" onPress={loadDialogs}>
            刷新
          </Button>
          <Button className="rounded-lg" color="danger" isDisabled={!selectedItems.length} isLoading={loading} startContent={!loading && <Trash2 size={15} />} variant="flat" onPress={deleteSelected}>
            退出 / 删除 {selectedItems.length || ""}
          </Button>
          <Button className="rounded-lg" variant="flat" onPress={onClose}>关闭</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ToastStack({ items }) {
  return (
    <div className="fixed bottom-4 right-4 z-[80] grid w-[min(360px,calc(100vw-2rem))] gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={cx(
            "fade-in flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-2xl backdrop-blur",
            item.tone === "danger"
              ? "border-rose-300/25 bg-rose-950/80 text-rose-100"
              : item.tone === "success"
                ? "border-teal-300/25 bg-teal-950/80 text-teal-100"
                : item.tone === "warning"
                  ? "border-amber-300/25 bg-amber-950/80 text-amber-100"
                  : "border-white/10 bg-[#191816]/90 text-default-100",
          )}
        >
          {item.tone === "danger" ? <AlertCircle size={16} /> : item.tone === "success" ? <CheckCircle2 size={16} /> : <Activity size={16} />}
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
