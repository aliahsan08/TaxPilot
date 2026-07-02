/* ==========================================================================
   TAX PILOT APPLICATION LOGIC (REVISED DESIGN)
   ========================================================================== */

// 1. Initial Profile State
let userProfile = JSON.parse(localStorage.getItem("taxpilot_profile")) || {
  name: "Rana Adeel",
  email: "adeel.rana@example.pk",
  ntn: "4892301-4",
  atlStatus: "Active",
  taxYear: "2026",
  jurisdiction: "RTO Lahore, Zone-I"
};

const welcomeGreetings = [
  "How can I help you today?",
  "What are we calculating today?",
  "Ask me a tax question.",
  "Let's calculate your tax."
];

// 2. Initial Mock Chat Data
const initialMockChats = [
  {
    id: "mock-chat-1",
    topic: "Calculate income tax for annual salary of Rs 1,800,000",
    taxYear: "2026",
    atlStatus: "Active",
    createdDate: "July 01, 2026, 02:30 PM",
    summary: "User requested a tax calculation for a salaried individual with an annual gross salary of PKR 1,800,000. The active taxpayer status is Filer (Active on ATL). The deterministic calculator computed a total tax liability of PKR 90,000 based on Slab 3 of the First Schedule.",
    messages: [
      { sender: "user", text: "Calculate income tax for annual salary of Rs 1,800,000.", timestamp: "02:30 PM" },
      { 
        sender: "ai", 
        text: `Based on the deterministic calculation for <strong>Tax Year 2026</strong>, here is the breakdown of your salary income tax liability.

<div class="audit-log-box">
[CALCULATOR NODE - AUDIT LOG]
User Input Salary: PKR 1,800,000
Taxpayer Status: Active ATL (Filer)
Slab Determined: Slab 3 (exceeding PKR 1,200,000 but not exceeding PKR 2,200,000)
Base Tax: PKR 15,000
Exceeding Amount: PKR 1,800,000 - PKR 1,200,000 = PKR 600,000
Variable Rate: 12.5%
Variable Tax: 12.5% of PKR 600,000 = PKR 75,000
Calculated Total Tax: PKR 15,000 + PKR 75,000 = PKR 90,000
No non-ATL surcharge applied.
</div>

<h3>Tax Computation Summary</h3>
<table class="tax-table">
  <thead>
    <tr>
      <th>Description</th>
      <th>Amount (PKR)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Gross Annual Salary</td>
      <td><strong>1,800,000</strong></td>
    </tr>
    <tr>
      <td>Taxable Income (Section 12)</td>
      <td>1,800,000</td>
    </tr>
    <tr>
      <td>Applicable Slab (First Schedule)</td>
      <td>Slab 3 (1.2M to 2.2M)</td>
    </tr>
    <tr>
      <td>Base Tax Rate</td>
      <td>Rs. 15,000 + 12.5% of amount > 1.2M <a class="cit-badge" data-cit-idx="0">1st Schedule</a></td>
    </tr>
    <tr>
      <td><strong>Total Tax Payable</strong></td>
      <td><strong>90,000</strong></td>
    </tr>
    <tr>
      <td>Effective Tax Rate</td>
      <td>5.0%</td>
    </tr>
  </tbody>
</table>

This calculation is strictly deterministic, referencing rates prescribed in the First Schedule, Part I, Division I of the Income Tax Ordinance 2001. <a class="cit-badge" data-cit-idx="0">1st Schedule</a>

<div class="disclaimer-box">
<strong>FBR Compliance Disclaimer:</strong> This is a simulation based on the approved specs for the current tax year. The results do not constitute professional tax advice. Please verify details before filing your return.
</div>`,
        timestamp: "02:31 PM"
      }
    ],
    calculation: {
      grossSalary: 1800000,
      taxableSalary: 1800000,
      taxOwed: 90000,
      rateText: "Rs. 15,000 + 12.5% of amount exceeding Rs. 1,200,000",
      effectiveRate: "5.0%"
    },
    citations: [
      {
        section: "First Schedule, Part I, Division I",
        text: "Provides progressive tax slabs and rate metrics for salaried individuals (where salary exceeds 75% of taxable income)."
      },
      {
        section: "Section 12 (Salary Income)",
        text: "Defines taxable salary components, including wages, allowances, and value of perquisites received in the employment context."
      }
    ]
  },
  {
    id: "mock-chat-2",
    topic: "What perks are taxable under Section 12?",
    taxYear: "2026",
    atlStatus: "Active",
    createdDate: "June 28, 2026, 11:15 AM",
    summary: "Conceptual query exploring the scope of taxable allowances, perquisites, utilities, and perks under Section 12 of Pakistan's Income Tax Ordinance 2001. Maintained that allowances are generally taxable unless specifically exempted.",
    messages: [
      { sender: "user", text: "What perks are taxable under Section 12?", timestamp: "11:15 AM" },
      {
        sender: "ai",
        text: `Under <strong>Section 12 of the Income Tax Ordinance 2001</strong>, salary is defined broadly and includes any perquisites (perks), allowances, or benefits provided by an employer. <a class="cit-badge" data-cit-idx="0">Section 12</a>

Key taxable perks include:
<ol>
  <li><strong>Perquisites (Section 13):</strong> Valuation rules for company-provided vehicles, housing, and utilities apply. For instance, car benefits are valued at 5% of cost (for personal/business mixed use) or 10% (purely personal use) added directly to taxable income.</li>
  <li><strong>Allowances:</strong> All allowances (medical, house rent, utilities, utility bills paid directly) are taxable, unless specifically exempted by the Second Schedule of the Ordinance.</li>
  <li><strong>Exemptions:</strong>
    <ul>
      <li>Medical allowance is exempt up to 10% of basic salary if medical facilities are not provided by employer.</li>
      <li>Travel allowance (TA/DA) is exempt if spent exclusively in performance of employment duties.</li>
    </ul>
  </li>
</ol>

<div class="disclaimer-box">
<strong>Disclaimer:</strong> Valuation rules are derived from Section 13. Ensure proper accounting of allowances to prevent audit discrepancies.
</div>`,
        timestamp: "11:17 AM"
      }
    ],
    calculation: null,
    citations: [
      {
        section: "Section 12 - Salary Income",
        text: "Declares all compensation, allowances, pensions, gratuities, and perquisites taxable as salary income."
      },
      {
        section: "Section 13 - Value of Perquisites",
        text: "Specifies mathematical rules for valuation of company assets (cars, housing, interest-free loans) provided to employee."
      }
    ]
  }
];

// 3. Application State Variables
let chats = JSON.parse(localStorage.getItem("taxpilot_chats")) || initialMockChats;
let currentChatId = null;
let currentView = "chat"; // 'chat' | 'details' | 'history' | 'profile'
let theme = localStorage.getItem("taxpilot_theme") || "dark";

// DOM References
const bodyEl = document.body;
const themeBtn = document.getElementById("theme-toggle-btn");
const themeBtnText = document.getElementById("theme-toggle-text");
const profileBtn = document.getElementById("profile-btn");
const logoutBtn = document.getElementById("logout-btn");
const newChatBtn = document.getElementById("new-chat-btn");
const sidebarHistoryBtn = document.getElementById("sidebar-history-btn");

const sidebarContainer = document.getElementById("sidebar-chats-container");
const currentViewTitle = document.getElementById("current-view-title");
const sidebarUserName = document.getElementById("sidebar-user-name");
const sidebarUserRole = document.getElementById("sidebar-user-role");

const navYearVal = document.getElementById("nav-year-val");
const navAtlVal = document.getElementById("nav-atl-val");

const chatPanel = document.getElementById("chat-panel");
const chatWelcomeState = document.getElementById("chat-welcome-state");
const chatMessagesFeed = document.getElementById("chat-messages-feed");
const chatTextarea = document.getElementById("chat-textarea");
const sendMsgBtn = document.getElementById("send-msg-btn");
const aiThinkingIndicator = document.getElementById("ai-thinking-indicator");
const thinkingStepText = document.getElementById("thinking-step");

const detailsPanel = document.getElementById("details-panel");
const detailsBackBtn = document.getElementById("details-back-btn");
const detailsTopic = document.getElementById("details-topic");
const detailsTimestamp = document.getElementById("details-timestamp");
const detailsSummaryText = document.getElementById("details-summary-text");
const detailsMetaYear = document.getElementById("details-meta-year");
const detailsMetaAtl = document.getElementById("details-meta-atl");
const detailsMetaCategory = document.getElementById("details-meta-category");
const detailsCalcCard = document.getElementById("details-calc-card");
const detailsCalcContent = document.getElementById("details-calc-content");
const detailsCitationsList = document.getElementById("details-citations-list");
const resumeChatBtn = document.getElementById("resume-chat-btn");

const historyPanel = document.getElementById("history-panel");
const historyCardsGrid = document.getElementById("history-cards-grid");

// Profile view panel refs
const profilePanel = document.getElementById("profile-panel");
const profileEditForm = document.getElementById("profile-edit-form");
const profileInputName = document.getElementById("profile-input-name");
const profileInputEmail = document.getElementById("profile-input-email");
const profileInputNtn = document.getElementById("profile-input-ntn");
const profileInputAtl = document.getElementById("profile-input-atl");
const profileInputYear = document.getElementById("profile-input-year");
const profileCancelBtn = document.getElementById("profile-cancel-btn");

// Modals
const logoutModal = document.getElementById("logout-modal");
const closeLogoutBtn = document.getElementById("close-logout-btn");
const cancelLogoutBtn = document.getElementById("cancel-logout-btn");
const confirmLogoutBtn = document.getElementById("confirm-logout-btn");

// 4. Setup App Initialization
function initApp() {
  applyTheme(theme);
  updateProfileUILabels();
  renderSidebar();
  renderHistoryGrid();
  setupEventListeners();
  adjustTextareaHeight();
  
  // Set random sleek greeting on start
  applyRandomGreeting();
  
  // Set default screen layout
  switchView("chat");
}

// Helper to select a random greeting variant
function applyRandomGreeting() {
  const welcomeTextEl = chatWelcomeState.querySelector(".welcome-greeting");
  if (welcomeTextEl) {
    const randomIdx = Math.floor(Math.random() * welcomeGreetings.length);
    welcomeTextEl.textContent = welcomeGreetings[randomIdx];
  }
}

// 5. UI View Switching & Layout Configurations
function switchView(view) {
  currentView = view;
  
  // Update view visibility classes
  chatPanel.classList.remove("active");
  detailsPanel.classList.remove("active");
  historyPanel.classList.remove("active");
  profilePanel.classList.remove("active");
  
  // Sidebar button selections
  sidebarHistoryBtn.classList.remove("active");
  profileBtn.classList.remove("active");
  
  if (view === "chat") {
    chatPanel.classList.add("active");
    currentViewTitle.textContent = ""; // Blank top left text as requested
    
    // Check if we should center input box
    if (currentChatId) {
      chatPanel.classList.remove("welcome-state-active");
      chatWelcomeState.classList.add("hidden");
      chatMessagesFeed.classList.remove("hidden");
    } else {
      chatPanel.classList.add("welcome-state-active");
      chatWelcomeState.classList.remove("hidden");
      chatMessagesFeed.classList.add("hidden");
    }
  } else if (view === "history") {
    historyPanel.classList.add("active");
    sidebarHistoryBtn.classList.add("active");
    currentViewTitle.textContent = "History"; // Changed to History
    renderHistoryGrid();
  } else if (view === "details") {
    detailsPanel.classList.add("active");
    currentViewTitle.textContent = "Details"; // Changed to Details
  } else if (view === "profile") {
    profilePanel.classList.add("active");
    profileBtn.classList.add("active");
    currentViewTitle.textContent = "Profile"; // Changed to Profile
    loadProfileFields();
  }
}

// 6. Theme Control
function applyTheme(newTheme) {
  theme = newTheme;
  localStorage.setItem("taxpilot_theme", theme);
  
  if (theme === "light") {
    bodyEl.classList.remove("dark-mode");
    bodyEl.classList.add("light-mode");
    themeBtnText.textContent = "Dark Mode";
  } else {
    bodyEl.classList.remove("light-mode");
    bodyEl.classList.add("dark-mode");
    themeBtnText.textContent = "Light Mode";
  }
}

function toggleTheme() {
  applyTheme(theme === "dark" ? "light" : "dark");
}

// 7. Profile Information Controllers
function updateProfileUILabels() {
  // Sidebar
  sidebarUserName.textContent = userProfile.name;
  sidebarUserRole.textContent = `Salaried • ${userProfile.atlStatus} ATL`;
  
  // Navigation Headers
  navYearVal.textContent = `TY ${userProfile.taxYear}`;
  navAtlVal.textContent = `${userProfile.atlStatus} ATL`;
  
  if (userProfile.atlStatus === "Inactive") {
    navAtlVal.className = "badge badge-atl non-filer";
  } else {
    navAtlVal.className = "badge badge-atl";
  }
}

function loadProfileFields() {
  profileInputName.value = userProfile.name;
  profileInputEmail.value = userProfile.email;
  profileInputNtn.value = userProfile.ntn;
  profileInputAtl.value = userProfile.atlStatus;
  profileInputYear.value = userProfile.taxYear;
}

function saveProfile(e) {
  e.preventDefault();
  
  userProfile.name = profileInputName.value.trim();
  userProfile.email = profileInputEmail.value.trim();
  userProfile.ntn = profileInputNtn.value.trim();
  userProfile.atlStatus = profileInputAtl.value;
  userProfile.taxYear = profileInputYear.value;
  
  localStorage.setItem("taxpilot_profile", JSON.stringify(userProfile));
  updateProfileUILabels();
  
  alert("Profile settings saved successfully!");
  switchView("chat");
}

// 8. Recent Chat Sidebar Renderer
function renderSidebar() {
  sidebarContainer.innerHTML = "";
  
  // Render chats list (reversed to show newest first)
  const sortedChats = [...chats].reverse();
  
  sortedChats.forEach(chat => {
    const item = document.createElement("button");
    item.className = `sidebar-chat-item ${chat.id === currentChatId && currentView === 'chat' ? 'active' : ''}`;
    item.setAttribute("data-id", chat.id);
    
    item.innerHTML = `
      <div class="sidebar-chat-content">
        <svg class="sidebar-chat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <span class="sidebar-chat-title">${chat.topic}</span>
      </div>
      <button class="sidebar-chat-delete-btn" title="Delete Chat" data-id="${chat.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-small">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    `;
    
    // Add Click listener to open chat details
    item.addEventListener("click", (e) => {
      if (e.target.closest(".sidebar-chat-delete-btn")) return;
      openChatDetails(chat.id);
    });
    
    // Delete event listener
    const deleteBtn = item.querySelector(".sidebar-chat-delete-btn");
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    });
    
    sidebarContainer.appendChild(item);
  });
  
  if (sortedChats.length === 0) {
    sidebarContainer.innerHTML = `<div class="sidebar-section-title" style="text-align: center; text-transform: none; margin-top: 15px;">No chats yet.</div>`;
  }
}

// 9. History Cards Grid Renderer
function renderHistoryGrid() {
  historyCardsGrid.innerHTML = "";
  
  chats.forEach(chat => {
    const card = document.createElement("div");
    card.className = "history-card";
    
    const taxLabel = chat.calculation ? `TY ${chat.taxYear} • Tax: PKR ${chat.calculation.taxOwed.toLocaleString()}` : `TY ${chat.taxYear} • Legal Ask`;
    
    card.innerHTML = `
      <div class="hist-header">
        <span class="hist-date">${chat.createdDate}</span>
        <span class="hist-tax-tag">${chat.atlStatus} Filer</span>
      </div>
      <div style="flex: 1; display: flex; flex-direction: column;">
        <h4 class="hist-title">${chat.topic}</h4>
        <p class="hist-snippet">${chat.summary || "Conceptual tax consultation."}</p>
      </div>
      <div class="hist-footer">
        <span class="hist-date">${taxLabel}</span>
        <div class="hist-card-arrow">
          <span>Details</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="icon-small">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </div>
      </div>
    `;
    
    card.addEventListener("click", () => {
      openChatDetails(chat.id);
    });
    
    historyCardsGrid.appendChild(card);
  });
  
  if (chats.length === 0) {
    historyCardsGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px;" class="card-glass border-color">
        <p style="color: var(--text-secondary); font-size: 14px;">No chats in history. Start a new chat session to generate tax calculations.</p>
      </div>
    `;
  }
}

// 10. Open Chat Details Screen
function openChatDetails(chatId) {
  currentChatId = chatId;
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  
  // Highlight active sidebar item
  renderSidebar();
  
  // Populate Detail elements
  detailsTopic.textContent = chat.topic;
  detailsTimestamp.textContent = `Created on: ${chat.createdDate}`;
  detailsSummaryText.innerHTML = chat.summary || "No summary profile generated for this chat query.";
  
  detailsMetaYear.textContent = chat.taxYear;
  detailsMetaAtl.textContent = chat.atlStatus;
  
  if (chat.atlStatus === "Inactive") {
    detailsMetaAtl.className = "meta-value badge badge-atl non-filer";
  } else {
    detailsMetaAtl.className = "meta-value badge badge-atl";
  }

  // Populate calculations log
  if (chat.calculation) {
    detailsCalcCard.classList.remove("hidden");
    detailsCalcContent.innerHTML = `
      <div class="calc-field-row">
        <span class="field-label">Gross Salary</span>
        <span class="field-value">PKR ${chat.calculation.grossSalary.toLocaleString()}</span>
      </div>
      <div class="calc-field-row">
        <span class="field-label">Taxable Salary</span>
        <span class="field-value">PKR ${chat.calculation.taxableSalary.toLocaleString()}</span>
      </div>
      <div class="calc-field-row">
        <span class="field-label">Applied Slab Formula</span>
        <span class="field-value" style="font-size: 11px; max-width: 65%; text-align: right;">${chat.calculation.rateText}</span>
      </div>
      <div class="calc-field-row">
        <span class="field-label">Effective Rate</span>
        <span class="field-value">${chat.calculation.effectiveRate}</span>
      </div>
      <div class="calc-field-row">
        <span class="field-label">Total Salary Tax Payable</span>
        <span class="field-value text-success font-semibold">PKR ${chat.calculation.taxOwed.toLocaleString()}</span>
      </div>
    `;
  } else {
    detailsCalcCard.classList.add("hidden");
  }

  // Populate Citations
  detailsCitationsList.innerHTML = "";
  if (chat.citations && chat.citations.length > 0) {
    chat.citations.forEach(cit => {
      const li = document.createElement("li");
      li.className = "citation-detail-item";
      li.innerHTML = `
        <div class="cit-title">${cit.section}</div>
        <div class="cit-text">${cit.text}</div>
      `;
      detailsCitationsList.appendChild(li);
    });
  } else {
    detailsCitationsList.innerHTML = `<li class="details-subtitle">No statutory citations generated for this conversation.</li>`;
  }
  
  switchView("details");
}

// 11. Load Active Chat Panel
function loadActiveChat(chatId) {
  currentChatId = chatId;
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  
  // Sync state values to indicators
  navYearVal.textContent = `TY ${chat.taxYear}`;
  navAtlVal.textContent = `${chat.atlStatus} ATL`;
  
  if (chat.atlStatus === "Inactive") {
    navAtlVal.className = "badge badge-atl non-filer";
  } else {
    navAtlVal.className = "badge badge-atl";
  }
  
  // Render message logs
  chatPanel.classList.remove("welcome-state-active");
  chatWelcomeState.classList.add("hidden");
  chatMessagesFeed.classList.remove("hidden");
  chatMessagesFeed.innerHTML = "";
  
  chat.messages.forEach(msg => {
    appendMessageHTML(msg.sender, msg.text, msg.timestamp);
  });
  
  // Re-append the static thinking indicator to the end of the feed to keep DOM order
  chatMessagesFeed.appendChild(aiThinkingIndicator);
  
  // Smooth scroll to bottom
  chatMessagesFeed.scrollTop = chatMessagesFeed.scrollHeight;
  
  switchView("chat");
}

// Helper to append message bubble to UI (Free document-text style, no bubbles)
function appendMessageHTML(sender, text, timestamp) {
  const row = document.createElement("div");
  row.className = `message-row ${sender}`;
  
  row.innerHTML = `
    <div class="message-bubble">
      <div class="message-text">${text}</div>
      <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 6px;">Sent at ${timestamp}</div>
    </div>
  `;
  
  // Insert before thinking indicator if it is in the DOM feed, else append at end
  if (chatMessagesFeed.contains(aiThinkingIndicator) && !aiThinkingIndicator.classList.contains("hidden")) {
    chatMessagesFeed.insertBefore(row, aiThinkingIndicator);
  } else {
    // If indicator is hidden, make sure we append before the hidden indicator element
    chatMessagesFeed.insertBefore(row, aiThinkingIndicator);
  }
  
  // Attach tooltip hooks to citations if any
  row.querySelectorAll(".cit-badge").forEach((badge) => {
    badge.addEventListener("click", (e) => {
      e.preventDefault();
      const idx = parseInt(badge.getAttribute("data-cit-idx"));
      const chat = chats.find(c => c.id === currentChatId);
      if (chat && chat.citations && chat.citations[idx]) {
        alert(`Legal Reference details [${chat.citations[idx].section}]:\n\n"${chat.citations[idx].text}"`);
      }
    });
  });
}

// 12. Delete Chat Session
function deleteChat(chatId) {
  chats = chats.filter(c => c.id !== chatId);
  localStorage.setItem("taxpilot_chats", JSON.stringify(chats));
  
  if (currentChatId === chatId) {
    currentChatId = null;
    switchView("chat");
  }
  
  renderSidebar();
  renderHistoryGrid();
}

// 13. Create a Fresh New Chat
function handleNewChat() {
  currentChatId = null;
  chatPanel.classList.add("welcome-state-active");
  chatWelcomeState.classList.remove("hidden");
  chatMessagesFeed.classList.add("hidden");
  chatMessagesFeed.innerHTML = "";
  chatTextarea.value = "";
  adjustTextareaHeight();
  
  // Set random sleek greeting variant
  applyRandomGreeting();
  
  // Make sure thinking indicator is appended back inside the cleared messages feed
  chatMessagesFeed.appendChild(aiThinkingIndicator);
  aiThinkingIndicator.classList.add("hidden");
  
  // Sync view status badges to active userProfile settings
  updateProfileUILabels();
  
  switchView("chat");
  renderSidebar();
}

// 14. Send & Stream Message Logic (Simulated LangGraph pipeline)
function handleSendMessage() {
  const text = chatTextarea.value.trim();
  if (!text) return;
  
  chatTextarea.value = "";
  adjustTextareaHeight();
  sendMsgBtn.disabled = true;
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' }) + ", " + timeStr;
  
  let isFirstMessage = false;
  
  // Initialize chat if none active
  if (!currentChatId) {
    isFirstMessage = true;
    const newId = "chat-" + Date.now();
    const selectedYear = userProfile.taxYear;
    const selectedAtl = userProfile.atlStatus;
    
    const newChatObj = {
      id: newId,
      topic: text.length > 40 ? text.substring(0, 40) + "..." : text,
      taxYear: selectedYear,
      atlStatus: selectedAtl,
      createdDate: dateStr,
      summary: "",
      messages: [],
      calculation: null,
      citations: []
    };
    
    chats.push(newChatObj);
    currentChatId = newId;
    
    // UI layout shifts (remove centered welcome alignments)
    chatPanel.classList.remove("welcome-state-active");
    chatWelcomeState.classList.add("hidden");
    chatMessagesFeed.classList.remove("hidden");
    
    // Ensure the thinking indicator is in the feed DOM structure
    chatMessagesFeed.appendChild(aiThinkingIndicator);
  }
  
  const activeChat = chats.find(c => c.id === currentChatId);
  activeChat.messages.push({ sender: "user", text: text, timestamp: timeStr });
  
  // Append user message to thread
  appendMessageHTML("user", text, timeStr);
  
  // Move thinking indicator to the absolute bottom of scrollable feed container
  chatMessagesFeed.appendChild(aiThinkingIndicator);
  aiThinkingIndicator.classList.remove("hidden");
  
  // Scroll list to reveal the inline processing indicator
  chatMessagesFeed.scrollTop = chatMessagesFeed.scrollHeight;
  renderSidebar();
  
  // AI Progress pipeline simulator
  runSimulatedPipeline(text, activeChat);
}

// Simulated execution of graph nodes
function runSimulatedPipeline(promptText, chatObj) {
  const steps = [
    { text: "Planner Node: Analyzing query and loading slab configs from PostgreSQL...", delay: 800 },
    { text: "Retrieval Node: Performing semantic retrieval over Qdrant Vector DB for Section 12 & Schedules...", delay: 1800 },
    { text: "Calculator Node: Executing Python deterministic calculations for Salary Slabs...", delay: 2800 },
    { text: "Answer Node: Assembling final verified citations and generated FBR legal references...", delay: 3800 }
  ];
  
  steps.forEach(step => {
    setTimeout(() => {
      if (currentChatId === chatObj.id) {
        thinkingStepText.textContent = step.text;
      }
    }, step.delay);
  });
  
  // Complete response generations
  setTimeout(() => {
    if (currentChatId !== chatObj.id) return;
    
    aiThinkingIndicator.classList.add("hidden");
    
    // Parse salary values
    const salaryMatch = promptText.replace(/,/g, '').match(/\b\d{5,8}\b/);
    let salaryVal = null;
    if (salaryMatch) {
      salaryVal = parseInt(salaryMatch[0]);
    }
    
    let aiResponseText = "";
    let calcObj = null;
    let citeList = [];
    let summaryText = "";
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (salaryVal) {
      const gross = salaryVal;
      const isFiler = chatObj.atlStatus === "Active";
      let baseTax = 0;
      let variableRate = 0;
      let threshold = 0;
      let slabName = "";
      let rateDesc = "";
      
      if (gross <= 600000) {
        slabName = "Slab 1 (Up to PKR 600,000)";
        rateDesc = "Exempt (0% tax)";
      } else if (gross <= 1200000) {
        slabName = "Slab 2 (PKR 600,000 - 1,200,000)";
        threshold = 600000;
        variableRate = 0.025;
        rateDesc = "2.5% of amount exceeding Rs. 600,000";
      } else if (gross <= 2200000) {
        slabName = "Slab 3 (PKR 1,200,000 - 2,200,000)";
        baseTax = 15000;
        threshold = 1200000;
        variableRate = 0.125;
        rateDesc = "Rs. 15,000 + 12.5% of amount exceeding Rs. 1,200,000";
      } else if (gross <= 3200000) {
        slabName = "Slab 4 (PKR 2,200,000 - 3,200,000)";
        baseTax = 140000;
        threshold = 2200000;
        variableRate = 0.225;
        rateDesc = "Rs. 140,000 + 22.5% of amount exceeding Rs. 2,200,000";
      } else if (gross <= 4100000) {
        slabName = "Slab 5 (PKR 3,200,000 - 4,100,000)";
        baseTax = 365000;
        threshold = 3200000;
        variableRate = 0.275;
        rateDesc = "Rs. 365,000 + 27.5% of amount exceeding Rs. 3,200,000";
      } else {
        slabName = "Slab 6 (Exceeding PKR 4,100,000)";
        baseTax = 612500;
        threshold = 4100000;
        variableRate = 0.35;
        rateDesc = "Rs. 612,500 + 35% of amount exceeding Rs. 4,100,000";
      }
      
      const taxableExcess = Math.max(0, gross - threshold);
      const varTax = taxableExcess * variableRate;
      let totalTax = baseTax + varTax;
      let finalTax = totalTax;
      let nonFilerSurcharge = 0;
      
      if (!isFiler) {
        nonFilerSurcharge = totalTax;
        finalTax = totalTax * 2;
      }
      
      const effectivePct = ((finalTax / gross) * 100).toFixed(1) + "%";
      
      calcObj = {
        grossSalary: gross,
        taxableSalary: gross,
        taxOwed: finalTax,
        rateText: isFiler ? rateDesc : `${rateDesc} (Doubled due to Non-ATL Status)`,
        effectiveRate: effectivePct
      };
      
      citeList = [
        {
          section: "First Schedule, Part I, Division I",
          text: `Prescribes salary slabs for Tax Year ${chatObj.taxYear}. Minimum tax exemption is set at Rs 600,000.`
        }
      ];
      
      if (!isFiler) {
        citeList.push({
          section: "Tenth Schedule, Rule 1",
          text: "Requires a 100% tax surcharge penalty multiplier for individuals who fail to register active on the Active Taxpayers List."
        });
      }
      
      citeList.push({
        section: "Section 12 - Definition of Salary",
        text: "Declares all income received by an employee under employment (wages, bonus, salary) as taxable."
      });
      
      summaryText = `Calculated tax liability for a salaried individual earning PKR ${gross.toLocaleString()} for Tax Year ${chatObj.taxYear}. Filer status: ${chatObj.atlStatus}. Calculated tax is PKR ${finalTax.toLocaleString()}.`;
      
      aiResponseText = `Based on the deterministic calculation for <strong>Tax Year ${chatObj.taxYear}</strong>, here is the breakdown of your salary income tax liability.

<div class="audit-log-box">
[CALCULATOR NODE - AUDIT LOG]
User Input Salary: PKR ${gross.toLocaleString()}
Taxpayer Status: ${chatObj.atlStatus} ATL
Slab Determined: ${slabName}
Base Filer Tax: PKR ${baseTax.toLocaleString()}
Exceeding Amount: PKR ${gross.toLocaleString()} - PKR ${threshold.toLocaleString()} = PKR ${taxableExcess.toLocaleString()}
Variable Rate: ${(variableRate * 100).toFixed(1)}%
Variable Tax: PKR ${varTax.toLocaleString()}
Subtotal Base Tax: PKR ${totalTax.toLocaleString()}
${!isFiler ? `Tenth Schedule Surcharge (Non-ATL): 100% Penalty Multiplier (PKR ${nonFilerSurcharge.toLocaleString()})` : 'No Non-ATL surcharge applied.'}
Calculated Total Tax: PKR ${finalTax.toLocaleString()}
</div>

<h3>Tax Computation Summary</h3>
<table class="tax-table">
  <thead>
    <tr>
      <th>Description</th>
      <th>Amount (PKR)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Gross Annual Salary</td>
      <td><strong>${gross.toLocaleString()}</strong></td>
    </tr>
    <tr>
      <td>ATL Status</td>
      <td class="${isFiler ? 'text-success' : 'text-danger'} font-semibold">${chatObj.atlStatus} Filer</td>
    </tr>
    <tr>
      <td>Taxable Income (Section 12)</td>
      <td>${gross.toLocaleString()}</td>
    </tr>
    <tr>
      <td>Applicable Slab (First Schedule)</td>
      <td>${slabName}</td>
    </tr>
    <tr>
      <td>Base Tax Formula</td>
      <td>${rateDesc} <a class="cit-badge" data-cit-idx="0">1st Schedule</a></td>
    </tr>
    ${!isFiler ? `
    <tr>
      <td>Non-ATL Penalty Multiplier</td>
      <td>+100% Surcharge <a class="cit-badge" data-cit-idx="1">10th Schedule</a></td>
    </tr>` : ''}
    <tr>
      <td><strong>Total Tax Payable</strong></td>
      <td><strong class="${isFiler ? 'text-success' : 'text-danger'}">${finalTax.toLocaleString()}</strong></td>
    </tr>
    <tr>
      <td>Effective Tax Rate</td>
      <td><strong>${effectivePct}</strong></td>
    </tr>
  </tbody>
</table>

This computation is based strictly on Division I, Part I of the First Schedule of the Income Tax Ordinance 2001. <a class="cit-badge" data-cit-idx="0">1st Schedule</a>

<div class="disclaimer-box">
<strong>FBR Compliance Disclaimer:</strong> This is a simulation based on the approved specs for the current tax year. The results do not constitute professional tax advice. Please verify details before filing your return.
</div>`;
      
    } else {
      summaryText = `Addressed tax inquiry: "${promptText.substring(0, 40)}...". Explained Section 12 taxable components and ATL registration rules.`;
      
      citeList = [
        {
          section: "Section 12 (Salary Income)",
          text: "Defines taxable salary components, including wages, allowances, pensions, perquisites, and benefits."
        },
        {
          section: "Section 181A (Active Taxpayers List)",
          text: "Defines the Active Taxpayers List (ATL) and authorizes benefits and filers benefits."
        }
      ];
      
      aiResponseText = `I see you are inquiring about salary income rules under Pakistan's tax laws. 

Here are the key points regarding salary taxation as dictated by the <strong>Income Tax Ordinance 2001</strong>:
<ul>
  <li><strong>Taxable Salary (Section 12):</strong> Salary includes basic salary, wages, bonuses, gratuities, perquisites, and all allowances except those specifically exempted (e.g. medical allowance up to 10% of basic is exempt if medical treatment is not covered). <a class="cit-badge" data-cit-idx="0">Section 12</a></li>
  <li><strong>Active Taxpayer List (ATL):</strong> Appearing on the ATL (being an active filer) is essential. If your name is not on the ATL, rates on salary are increased by 100% under the Tenth Schedule, and high withholding taxes are applied to bank withdrawals and car registrations. <a class="cit-badge" data-cit-idx="1">Section 181A</a></li>
  <li><strong>Filing Threshold:</strong> A salaried individual with annual income exceeding PKR 600,000 is legally required to file an annual income tax return.</li>
</ul>

If you would like a tax liability calculation, please provide an annual or monthly income amount (e.g. "Calculate tax for 1.8M salary").

<div class="disclaimer-box">
<strong>Disclaimer:</strong> Tax laws are subject to modifications by annual Finance Acts. Verify with a certified Chartered Accountant or standard IRS portal.
</div>`;
    }
    
    chatObj.summary = summaryText;
    chatObj.calculation = calcObj;
    chatObj.citations = citeList;
    chatObj.messages.push({ sender: "ai", text: aiResponseText, timestamp: timeStr });
    
    localStorage.setItem("taxpilot_chats", JSON.stringify(chats));
    
    appendMessageHTML("ai", aiResponseText, timeStr);
    chatMessagesFeed.scrollTop = chatMessagesFeed.scrollHeight;
    
    renderSidebar();
    renderHistoryGrid();
  }, 4200);
}

// Auto-resizes the input text area
function adjustTextareaHeight() {
  chatTextarea.style.height = "auto";
  chatTextarea.style.height = (chatTextarea.scrollHeight) + "px";
  sendMsgBtn.disabled = chatTextarea.value.trim() === "";
}

// 15. Event Listeners Setup
function setupEventListeners() {
  themeBtn.addEventListener("click", toggleTheme);
  newChatBtn.addEventListener("click", handleNewChat);
  
  // History Button in Sidebar
  sidebarHistoryBtn.addEventListener("click", () => switchView("history"));
  
  // Profile settings trigger page view
  profileBtn.addEventListener("click", () => switchView("profile"));
  
  // Profile Form Submissions
  profileEditForm.addEventListener("submit", saveProfile);
  
  // Profile Form Cancel button
  profileCancelBtn.addEventListener("click", () => {
    switchView("chat");
  });
  
  // Textarea input listeners
  chatTextarea.addEventListener("input", adjustTextareaHeight);
  chatTextarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
  
  sendMsgBtn.addEventListener("click", handleSendMessage);
  
  // Details screen navigation
  detailsBackBtn.addEventListener("click", () => {
    switchView("chat");
  });
  
  resumeChatBtn.addEventListener("click", () => {
    if (currentChatId) {
      loadActiveChat(currentChatId);
    }
  });
  
  // Logout confirm events
  logoutBtn.addEventListener("click", () => {
    logoutModal.classList.remove("hidden");
  });
  
  closeLogoutBtn.addEventListener("click", () => {
    logoutModal.classList.add("hidden");
  });
  
  cancelLogoutBtn.addEventListener("click", () => {
    logoutModal.classList.add("hidden");
  });
  
  confirmLogoutBtn.addEventListener("click", () => {
    logoutModal.classList.add("hidden");
    
    chats = [...initialMockChats];
    localStorage.removeItem("taxpilot_chats");
    localStorage.removeItem("taxpilot_profile");
    
    userProfile = {
      name: "Rana Adeel",
      email: "adeel.rana@example.pk",
      ntn: "4892301-4",
      atlStatus: "Active",
      taxYear: "2026",
      jurisdiction: "RTO Lahore, Zone-I"
    };
    
    currentChatId = null;
    
    alert("You have logged out. Resetting session to baseline demo mock data.");
    
    initApp();
    switchView("chat");
  });
  
  window.addEventListener("click", (e) => {
    if (e.target === logoutModal) {
      logoutModal.classList.add("hidden");
    }
  });
}

// Start Application on Load
window.addEventListener("DOMContentLoaded", initApp);
