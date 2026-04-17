const chats = [
  {
    id: 1,
    name: "Design Notes",
    label: "Work",
    time: "09:20",
    unread: 2,
    summary: "Collected layout references and noted three follow-up ideas.",
    body:
      "A lightweight workspace for saving visual references, writing reply drafts, and keeping project context visible before sending the next message.",
    lastAction: "Review mockup comments",
    priority: "Medium",
    retention: "14 days",
  },
  {
    id: 2,
    name: "Family Group",
    label: "Personal",
    time: "08:10",
    unread: 0,
    summary: "Weekend dinner plan confirmed and grocery list updated.",
    body:
      "A personal thread that benefits from quick context scanning, shared reminders, and clear visibility into the latest coordination details.",
    lastAction: "Reply tonight",
    priority: "Low",
    retention: "30 days",
  },
  {
    id: 3,
    name: "Reading Circle",
    label: "Reading",
    time: "Yesterday",
    unread: 1,
    summary: "Shared article highlights and next chapter discussion points.",
    body:
      "A conversation view built for collecting notes, surfacing recent links, and preserving key context from longer message threads.",
    lastAction: "Save article excerpts",
    priority: "Low",
    retention: "21 days",
  },
  {
    id: 4,
    name: "Launch Checklist",
    label: "Follow-up",
    time: "Yesterday",
    unread: 4,
    summary: "Pending tasks remain for assets, copy edits, and screenshots.",
    body:
      "This sample thread shows how a personal communication tool can keep pending items grouped by follow-up intent and visible at a glance.",
    lastAction: "Send updated checklist",
    priority: "High",
    retention: "7 days",
  },
  {
    id: 5,
    name: "Travel Ideas",
    label: "Personal",
    time: "Tuesday",
    unread: 0,
    summary: "Saved route suggestions, dates, and places worth revisiting.",
    body:
      "A simple archival chat for preserving travel notes, checking context later, and grouping trip planning messages without losing details.",
    lastAction: "Compare schedules",
    priority: "Medium",
    retention: "60 days",
  },
];

const labels = ["All", ...new Set(chats.map((chat) => chat.label))];

const searchInput = document.querySelector("#searchInput");
const filterChips = document.querySelector("#filterChips");
const chatList = document.querySelector("#chatList");
const chatDetail = document.querySelector("#chatDetail");
const chatCount = document.querySelector("#chatCount");

let currentLabel = "All";
let selectedId = chats[0].id;

function renderFilters() {
  filterChips.innerHTML = "";

  labels.forEach((label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip${label === currentLabel ? " is-active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      currentLabel = label;
      const filtered = getFilteredChats();

      if (!filtered.some((chat) => chat.id === selectedId)) {
        selectedId = filtered[0]?.id ?? null;
      }

      renderFilters();
      renderList();
      renderDetail();
    });

    filterChips.appendChild(button);
  });
}

function getFilteredChats() {
  const query = searchInput.value.trim().toLowerCase();

  return chats.filter((chat) => {
    const matchesLabel = currentLabel === "All" || chat.label === currentLabel;
    const haystack = `${chat.name} ${chat.label} ${chat.summary} ${chat.body}`.toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    return matchesLabel && matchesSearch;
  });
}

function renderList() {
  const filtered = getFilteredChats();
  chatCount.textContent = `${filtered.length} item${filtered.length === 1 ? "" : "s"}`;
  chatList.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No chats matched this search. Try a different keyword or label.";
    chatList.appendChild(empty);
    return;
  }

  filtered.forEach((chat) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chat-row${chat.id === selectedId ? " is-selected" : ""}`;
    button.setAttribute("aria-pressed", chat.id === selectedId ? "true" : "false");
    button.innerHTML = `
      <div class="chat-meta">
        <p class="chat-title">${chat.name}</p>
        <span>${chat.time}</span>
      </div>
      <p class="chat-message">${chat.summary}</p>
      <div class="chat-meta">
        <span class="chat-tag">${chat.label}</span>
        <span>${chat.unread} unread</span>
      </div>
    `;

    button.addEventListener("click", () => {
      selectedId = chat.id;
      renderList();
      renderDetail();
    });

    chatList.appendChild(button);
  });
}

function renderDetail() {
  const filtered = getFilteredChats();
  const chat = filtered.find((item) => item.id === selectedId) ?? filtered[0];

  if (!chat) {
    chatDetail.innerHTML = `
      <div class="empty-state">
        Pick a different filter or search term to continue exploring the demo.
      </div>
    `;
    return;
  }

  selectedId = chat.id;
  chatDetail.innerHTML = `
    <div class="detail-shell">
      <div class="detail-header">
        <div>
          <h3>${chat.name}</h3>
          <div class="detail-meta">
            <span>${chat.label}</span>
            <span>${chat.time}</span>
            <span>${chat.unread} unread</span>
          </div>
        </div>
        <div class="detail-badges">
          <span class="chat-tag">Context ready</span>
          <span class="chat-tag">Personal use</span>
        </div>
      </div>

      <p class="detail-body">${chat.body}</p>

      <div class="detail-grid">
        <article class="detail-card">
          <strong>${chat.lastAction}</strong>
          <span>Next suggested action</span>
        </article>
        <article class="detail-card">
          <strong>${chat.priority}</strong>
          <span>Priority level</span>
        </article>
        <article class="detail-card">
          <strong>${chat.retention}</strong>
          <span>Context window</span>
        </article>
      </div>

      <p class="detail-note">
        This demo represents a personal communication dashboard for organizing conversations,
        reviewing recent context, and keeping message workflows tidy.
      </p>
    </div>
  `;
}

searchInput.addEventListener("input", () => {
  const filtered = getFilteredChats();

  if (!filtered.some((chat) => chat.id === selectedId)) {
    selectedId = filtered[0]?.id ?? null;
  }

  renderList();
  renderDetail();
});

renderFilters();
renderList();
renderDetail();
