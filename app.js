const API_BASE_URL = window.location.origin && window.location.origin.startsWith("http") ? window.location.origin : "http://127.0.0.1:8000";

let supabaseClient;
const token = sessionStorage.getItem("taxpilot_token");

async function initSupabase() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/config`);
    const config = await res.json();
    supabaseClient = supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    if (token) {
      await supabaseClient.auth.setSession({
        access_token: token,
        refresh_token: ""
      });
    }
  } catch (err) {
    console.error("Failed to initialize Supabase:", err);
  }
}
initSupabase();

/**
 * Loads session credentials stored in sessionStorage.
 * If credentials are not present, redirects the browser context to the login view.
 * 
 * @returns {Object|null} The session credentials object or null if redirecting.
 */
function getSession() {
  const uid = sessionStorage.getItem("taxpilot_user_id");
  const tok = sessionStorage.getItem("taxpilot_token");
  if (!uid || !tok) {
    window.location.replace("login.html");
    return null;
  }
  return {
    user_id:    uid,
    email:      sessionStorage.getItem("taxpilot_user_email") || "",
    name:       sessionStorage.getItem("taxpilot_user_name")  || "User",
    jurisdiction: sessionStorage.getItem("taxpilot_user_jurisdiction") || "RTO Lahore",
    atlStatus:  sessionStorage.getItem("taxpilot_atl")        || "Active",
    taxYear:    sessionStorage.getItem("taxpilot_tax_year")   || "2026",
    residency:  sessionStorage.getItem("taxpilot_residency")  || "Resident",
    entity:     sessionStorage.getItem("taxpilot_entity")     || "Individual",
    specialStatus: sessionStorage.getItem("taxpilot_special_status") || "None",
  };
}

let session = getSession();
if (!session) throw new Error("No session — redirecting.");

let chats        = [];
let currentChatId = null;
let currentView  = "chat";
let detailsReferrerView = "chat";
let theme        = localStorage.getItem("taxpilot_theme") || "dark";

const welcomeGreetings = [
  "How can I help you today?",
  "What are we calculating today?",
  "Ask me anything about FBR tax law.",
  "Let's calculate your tax liability."
];

const bodyEl              = document.body;
const themeBtn            = document.getElementById("theme-toggle-btn");
const themeBtnText        = document.getElementById("theme-toggle-text");
const profileBtn          = document.getElementById("profile-btn");
const logoutBtn           = document.getElementById("logout-btn");
const newChatBtn          = document.getElementById("new-chat-btn");
const sidebarHistoryBtn   = document.getElementById("sidebar-history-btn");
const sidebarContainer    = document.getElementById("sidebar-chats-container");
const sidebarUserName     = document.getElementById("sidebar-user-name");
const sidebarUserRole     = document.getElementById("sidebar-user-role");
const navYearVal          = document.getElementById("nav-year-val");
const navAtlVal           = document.getElementById("nav-atl-val");
const mobileMenuBtn       = document.getElementById("mobile-menu-btn");
const sidebarEl           = document.querySelector(".sidebar");
const sidebarOverlay      = document.getElementById("sidebar-overlay");

const chatPanel           = document.getElementById("chat-panel");
const chatWelcomeState    = document.getElementById("chat-welcome-state");
const chatMessagesFeed    = document.getElementById("chat-messages-feed");
const chatTextarea        = document.getElementById("chat-textarea");
const sendMsgBtn          = document.getElementById("send-msg-btn");
const aiThinkingIndicator = document.getElementById("ai-thinking-indicator");
const thinkingStepText    = document.getElementById("thinking-step");

const detailsPanel        = document.getElementById("details-panel");
const detailsBackBtn      = document.getElementById("details-back-btn");
const detailsTopic        = document.getElementById("details-topic");
const detailsTimestamp    = document.getElementById("details-timestamp");
const detailsSummaryText  = document.getElementById("details-summary-text");
const detailsMetaYear     = document.getElementById("details-meta-year");
const detailsMetaAtl      = document.getElementById("details-meta-atl");
const detailsMetaCategory = document.getElementById("details-meta-category");
const detailsCalcCard     = document.getElementById("details-calc-card");
const detailsCalcContent  = document.getElementById("details-calc-content");
const detailsCitationsList = document.getElementById("details-citations-list");
const resumeChatBtn       = document.getElementById("resume-chat-btn");

const historyPanel        = document.getElementById("history-panel");
const historyCardsGrid    = document.getElementById("history-cards-grid");

const profilePanel        = document.getElementById("profile-panel");
const profileEditForm     = document.getElementById("profile-edit-form");
const profileInputName    = document.getElementById("profile-input-name");
const profileInputEmail   = document.getElementById("profile-input-email");
const profileInputJurisdiction = document.getElementById("profile-input-jurisdiction");
const profileInputAtl     = document.getElementById("profile-input-atl");
const profileInputYear    = document.getElementById("profile-input-year");
const profileInputResidency = document.getElementById("profile-input-residency");
const profileInputEntity  = document.getElementById("profile-input-entity");
const profileInputSpecial = document.getElementById("profile-input-special");
const profileInputIncSalary = document.getElementById("profile-input-inc-salary");
const profileInputDedSalary = document.getElementById("profile-input-ded-salary");
const profileInputIncBusiness = document.getElementById("profile-input-inc-business");
const profileInputIncProperty = document.getElementById("profile-input-inc-property");
const profileCancelBtn    = document.getElementById("profile-cancel-btn");

const logoutModal         = document.getElementById("logout-modal");
const closeLogoutBtn      = document.getElementById("close-logout-btn");
const cancelLogoutBtn     = document.getElementById("cancel-logout-btn");
const confirmLogoutBtn    = document.getElementById("confirm-logout-btn");

const deleteChatModal       = document.getElementById("delete-chat-modal");
const closeDeleteChatBtn    = document.getElementById("close-delete-chat-btn");
const cancelDeleteChatBtn   = document.getElementById("cancel-delete-chat-btn");
const confirmDeleteChatBtn  = document.getElementById("confirm-delete-chat-btn");
let chatIdToDelete = null;

/**
 * Initializes the application state, theme, configurations, and triggers background data fetches.
 */
async function initApp() {
  applyTheme(theme);
  updateProfileUILabels();
  adjustTextareaHeight();
  applyRandomGreeting();
  switchView("chat");
  await loadChatsFromBackend();
}

/**
 * Cyclically updates the chat entry greet banner text block.
 */
function applyRandomGreeting() {
  const el = chatWelcomeState.querySelector(".welcome-greeting");
  if (el) el.textContent = welcomeGreetings[Math.floor(Math.random() * welcomeGreetings.length)];
}

/**
 * Requests list of historical chat consultations from backend database.
 */
async function loadChatsFromBackend() {
  sidebarContainer.innerHTML = `<div class="sidebar-skeleton-slab"></div>`;
  historyCardsGrid.innerHTML = `
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>`;

  try {
    const res = await fetch(`${API_BASE_URL}/api/chats/user/${session.user_id}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    chats = data.map(t => ({
      id:          t.thread_id,
      topic:       t.title,
      taxYear:     session.taxYear,
      atlStatus:   session.atlStatus,
      createdDate: t.created_at
        ? new Date(t.created_at).toLocaleString([], { month:"short", day:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" })
        : "—",
      summary:     t.summary || "",
      messages:    [],
      calculation: t.calculation_cache || null,
      citations:   t.citations_cache   || []
    }));
    renderSidebar();
    renderHistoryGrid();
  } catch (e) {
    console.error("Failed to load chats:", e);
  }
}

/**
 * Toggles mobile menu drawer display state and blocks background scroll overlays.
 */
function toggleMobileSidebar(forceClose = false) {
  if (!sidebarEl || !sidebarOverlay) return;
  if (forceClose || sidebarEl.classList.contains("active")) {
    sidebarEl.classList.remove("active");
    sidebarOverlay.classList.remove("active");
    document.body.classList.remove("sidebar-open");
  } else {
    sidebarEl.classList.add("active");
    sidebarOverlay.classList.add("active");
    document.body.classList.add("sidebar-open");
  }
}

/**
 * Navigates system layouts and visual states between views.
 * 
 * @param {string} view The target view identifier ('chat', 'history', 'details', 'profile').
 */
function switchView(view) {
  toggleMobileSidebar(true);
  currentView = view;
  chatPanel.classList.remove("active");
  detailsPanel.classList.remove("active");
  historyPanel.classList.remove("active");
  profilePanel.classList.remove("active");
  sidebarHistoryBtn.classList.remove("active");
  profileBtn.classList.remove("active");

  if (view === "chat") {
    chatPanel.classList.add("active");
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
    renderHistoryGrid();
  } else if (view === "details") {
    detailsPanel.classList.add("active");
  } else if (view === "profile") {
    profilePanel.classList.add("active");
    profileBtn.classList.add("active");
    loadProfileFields();
  }
}

/**
 * Sets application dark or light mode configurations.
 * 
 * @param {string} t The theme variant string ('light', 'dark').
 */
function applyTheme(t) {
  theme = t;
  localStorage.setItem("taxpilot_theme", t);
  if (t === "light") {
    bodyEl.classList.remove("dark-mode");
    bodyEl.classList.add("light-mode");
    themeBtnText.textContent = "Dark Mode";
  } else {
    bodyEl.classList.remove("light-mode");
    bodyEl.classList.add("dark-mode");
    themeBtnText.textContent = "Light Mode";
  }
}

/**
 * Toggles active visual style modes.
 */
function toggleTheme() { 
  applyTheme(theme === "dark" ? "light" : "dark"); 
}

/**
 * Updates navbar credentials labels, badges, and avatar initials.
 */
function updateProfileUILabels() {
  sidebarUserName.textContent = session.name;
  sidebarUserRole.textContent = `${session.entity} • ${session.atlStatus} ATL`;
  navYearVal.textContent = `TY ${session.taxYear}`;
  navAtlVal.textContent  = `${session.atlStatus} ATL`;
  navAtlVal.className    = session.atlStatus === "Inactive"
    ? "badge badge-atl non-filer" : "badge badge-atl";

  const avatarSpan = document.querySelector("#profile-btn .user-avatar span");
  if (avatarSpan && session.name) {
    const parts = session.name.trim().split(/\s+/);
    let initials = "";
    if (parts.length > 0) {
      if (parts.length === 1) {
        initials = parts[0].charAt(0).toUpperCase();
      } else {
        initials = (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
      }
    }
    avatarSpan.textContent = initials || "RA";
  }
}

/**
 * Fetches declarations and profile metadata from Postgres, loading them inside edit inputs.
 */
async function loadProfileFields() {
  profileInputName.value         = session.name;
  profileInputEmail.value        = session.email;
  profileInputJurisdiction.value = session.jurisdiction;
  profileInputAtl.value          = session.atlStatus;
  profileInputYear.value         = session.taxYear;
  profileInputResidency.value    = session.residency;
  profileInputEntity.value       = session.entity;
  profileInputSpecial.value      = session.specialStatus;

  if (!supabaseClient) {
    await initSupabase();
  }
  if (!supabaseClient) {
    console.error("Supabase client not initialized.");
    return;
  }

  try {
    // 1. Fetch user data (full_name) from 'users'
    const { data: dbUser, error: dbUserErr } = await supabaseClient
      .from("users")
      .select("full_name")
      .eq("user_id", session.user_id)
      .maybeSingle();

    if (dbUser) {
      profileInputName.value = dbUser.full_name || "";
    }

    // 2. Fetch active profile from 'tax_profiles' for current taxYear, including declarations
    const { data: dbProfile, error: dbProfileErr } = await supabaseClient
      .from("tax_profiles")
      .select("*, income_declarations(*)")
      .eq("user_id", session.user_id)
      .eq("tax_year", parseInt(session.taxYear))
      .maybeSingle();

    let profile = dbProfile;
    // If profile doesn't exist, create it (matching legacy backend default-on-demand)
    if (!profile) {
      const { data: newProfile, error: insError } = await supabaseClient
        .from("tax_profiles")
        .insert({
          user_id: session.user_id,
          tax_year: parseInt(session.taxYear),
          is_atl_active: session.atlStatus === "Active",
          residency: session.residency,
          entity: session.entity,
          special_status: session.specialStatus,
          jurisdiction: session.jurisdiction || "RTO Lahore"
        })
        .select()
        .single();
      
      profile = newProfile;
    }

    if (profile) {
      profileInputJurisdiction.value = profile.jurisdiction || "RTO Lahore";
      profileInputAtl.value = profile.is_atl_active ? "Active" : "Inactive";
      profileInputYear.value = String(profile.tax_year || 2026);
      profileInputResidency.value = profile.residency || "Resident";
      profileInputEntity.value = profile.entity || "Individual";
      profileInputSpecial.value = profile.special_status || "None";
    }

    // Map declarations list to a key-value dict (matching legacy structure)
    const decsList = (profile && profile.income_declarations) || [];
    const decs = {};
    decsList.forEach(d => {
      decs[d.income_head] = { gross: parseFloat(d.gross_amount), deductions: parseFloat(d.admissible_deductions) };
    });

    const checkAndPopulate = (head, inputEl, val) => {
      const chk = document.getElementById(`profile-chk-${head}`);
      const wrapper = document.getElementById(`profile-wrapper-${head}`);
      if (val > 0) {
        chk.checked = true;
        wrapper.style.display = "block";
        wrapper.classList.remove("hidden");
        inputEl.value = val;
      } else {
        chk.checked = false;
        wrapper.style.display = "none";
        wrapper.classList.add("hidden");
        inputEl.value = "";
      }
    };

    const salGross = decs.Salary ? decs.Salary.gross : 0;
    const salDeds = decs.Salary ? decs.Salary.deductions : 0;
    const chkSalary = document.getElementById("profile-chk-salary");
    const wrapSalary = document.getElementById("profile-wrapper-salary");
    if (salGross > 0 || salDeds > 0) {
      chkSalary.checked = true;
      wrapSalary.style.display = "block";
      wrapSalary.classList.remove("hidden");
      profileInputIncSalary.value = salGross || "";
      profileInputDedSalary.value = salDeds || "";
    } else {
      chkSalary.checked = false;
      wrapSalary.style.display = "none";
      wrapSalary.classList.add("hidden");
      profileInputIncSalary.value = "";
      profileInputDedSalary.value = "";
    }

    checkAndPopulate("business", profileInputIncBusiness, decs.Business ? decs.Business.gross : 0);
    checkAndPopulate("property", profileInputIncProperty, decs.Property ? decs.Property.gross : 0);

  } catch (err) {
    console.error("Failed to load profile details from Supabase:", err);
  }
}

/**
 * Toggles visibility wrappers dynamically when checking input heads.
 * 
 * @param {string} head The income head name.
 */
function toggleProfileIncomeWrapper(head) {
  const chk = document.getElementById(`profile-chk-${head}`);
  const wrapper = document.getElementById(`profile-wrapper-${head}`);
  if (chk.checked) {
    wrapper.style.display = "block";
    wrapper.classList.remove("hidden");
  } else {
    wrapper.style.display = "none";
    wrapper.classList.add("hidden");
    if (head === "salary") {
      profileInputIncSalary.value = "";
      profileInputDedSalary.value = "";
    } else {
      document.getElementById(`profile-input-inc-${head}`).value = "";
    }
  }
}

/**
 * Submits form data to profile and declaration updating endpoints.
 * 
 * @param {Event} e The form submit event.
 */
async function saveProfile(e) {
  e.preventDefault();
  const submitBtn = profileEditForm.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = "Saving...";
  submitBtn.disabled = true;
  submitBtn.style.backgroundColor = "#5a5a72";
  submitBtn.style.cursor = "not-allowed";

  session.name          = profileInputName.value.trim();
  session.jurisdiction  = profileInputJurisdiction.value.trim();
  session.atlStatus     = profileInputAtl.value;
  session.taxYear       = profileInputYear.value;
  session.residency     = profileInputResidency.value;
  session.entity        = profileInputEntity.value;
  session.specialStatus = profileInputSpecial.value;

  sessionStorage.setItem("taxpilot_user_name",         session.name);
  sessionStorage.setItem("taxpilot_user_jurisdiction", session.jurisdiction);
  sessionStorage.setItem("taxpilot_atl",               session.atlStatus);
  sessionStorage.setItem("taxpilot_tax_year",          session.taxYear);
  sessionStorage.setItem("taxpilot_residency",         session.residency);
  sessionStorage.setItem("taxpilot_entity",            session.entity);
  sessionStorage.setItem("taxpilot_special_status",    session.specialStatus);

  updateProfileUILabels();

  if (!supabaseClient) {
    await initSupabase();
  }
  if (!supabaseClient) {
    showCustomAlert("Error", "Auth config could not be loaded. Please verify connection.");
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
    submitBtn.style.backgroundColor = "";
    submitBtn.style.cursor = "";
    return;
  }

  try {
    // 1. Update name on 'users' table
    const { error: userUpdErr } = await supabaseClient
      .from("users")
      .update({ full_name: session.name })
      .eq("user_id", session.user_id);

    if (userUpdErr) console.error("Error updating user record:", userUpdErr);

    const taxYearInt = parseInt(session.taxYear);

    // 2. Fetch or create the target profile record in 'tax_profiles'
    let { data: profile, error: profFetchErr } = await supabaseClient
      .from("tax_profiles")
      .select("*")
      .eq("user_id", session.user_id)
      .eq("tax_year", taxYearInt)
      .maybeSingle();

    if (!profile) {
      // Create new profile record
      const { data: newProfile, error: profInsErr } = await supabaseClient
        .from("tax_profiles")
        .insert({
          user_id: session.user_id,
          tax_year: taxYearInt,
          is_atl_active: session.atlStatus === "Active",
          residency: session.residency,
          entity: session.entity,
          special_status: session.specialStatus,
          jurisdiction: session.jurisdiction
        })
        .select()
        .single();
      
      profile = newProfile;
    } else {
      // Update existing profile record
      const { data: updatedProfile, error: profUpdErr } = await supabaseClient
        .from("tax_profiles")
        .update({
          is_atl_active: session.atlStatus === "Active",
          residency: session.residency,
          entity: session.entity,
          special_status: session.specialStatus,
          jurisdiction: session.jurisdiction
        })
        .eq("profile_id", profile.profile_id)
        .select()
        .single();
      
      profile = updatedProfile;
    }

    if (profile) {
      // 3. Upsert income declarations
      const declarationsList = [
        {
          profile_id: profile.profile_id,
          user_id: session.user_id,
          income_head: "Salary",
          gross_amount: document.getElementById("profile-chk-salary").checked ? (parseFloat(profileInputIncSalary.value) || 0.0) : 0.0,
          admissible_deductions: document.getElementById("profile-chk-salary").checked ? (parseFloat(profileInputDedSalary.value) || 0.0) : 0.0
        },
        {
          profile_id: profile.profile_id,
          user_id: session.user_id,
          income_head: "Business",
          gross_amount: document.getElementById("profile-chk-business").checked ? (parseFloat(profileInputIncBusiness.value) || 0.0) : 0.0,
          admissible_deductions: 0.0
        },
        {
          profile_id: profile.profile_id,
          user_id: session.user_id,
          income_head: "Property",
          gross_amount: document.getElementById("profile-chk-property").checked ? (parseFloat(profileInputIncProperty.value) || 0.0) : 0.0,
          admissible_deductions: 0.0
        }
      ];

      // Perform updates or inserts
      for (const dec of declarationsList) {
        const { data: existingDec, error: existingDecErr } = await supabaseClient
          .from("income_declarations")
          .select("*")
          .eq("profile_id", profile.profile_id)
          .eq("income_head", dec.income_head)
          .maybeSingle();
        
        if (existingDec) {
          await supabaseClient
            .from("income_declarations")
            .update({
              gross_amount: dec.gross_amount,
              admissible_deductions: dec.admissible_deductions
            })
            .eq("declaration_id", existingDec.declaration_id);
        } else {
          await supabaseClient
            .from("income_declarations")
            .insert(dec);
        }
      }
    }

    showCustomAlert("Success", "Profile and income declarations saved successfully!");
  } catch (err) {
    console.error("Profile sync failed:", err);
    showCustomAlert("Error", "Failed to save profile changes. Please try again.");
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
    submitBtn.style.backgroundColor = "";
    submitBtn.style.cursor = "";
  }
}

/**
 * Builds the sidebar list view.
 */
function renderSidebar() {
  sidebarContainer.innerHTML = "";
  const sorted = chats;
  if (!sorted.length) {
    sidebarContainer.innerHTML = `<div class="sidebar-section-title" style="text-align:center;text-transform:none;margin-top:15px;">No chats yet.</div>`;
    return;
  }
  sorted.forEach(chat => {
    const item = document.createElement("button");
    item.className = `sidebar-chat-item ${chat.id === currentChatId && currentView === "chat" ? "active" : ""}`;
    item.setAttribute("data-id", chat.id);
    item.innerHTML = `
      <div class="sidebar-chat-content">
        <svg class="sidebar-chat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <span class="sidebar-chat-title">${chat.topic}</span>
      </div>
      <button class="sidebar-chat-delete-btn" title="Delete" data-id="${chat.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-small">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>`;
    item.addEventListener("click", e => {
      if (e.target.closest(".sidebar-chat-delete-btn")) return;
      openChatDetails(chat.id);
    });
    item.querySelector(".sidebar-chat-delete-btn").addEventListener("click", e => {
      e.stopPropagation();
      chatIdToDelete = chat.id;
      deleteChatModal.classList.remove("hidden");
    });
    sidebarContainer.appendChild(item);
  });
}

/**
 * Builds history panels with list view cards.
 */
function renderHistoryGrid() {
  historyCardsGrid.innerHTML = "";
  if (!chats.length) {
    historyCardsGrid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:60px 20px;" class="card-glass border-color">
        <p style="color:var(--text-secondary);font-size:14px;">No history yet. Start a new chat to create your first consultation.</p>
      </div>`;
    return;
  }
  chats.forEach(chat => {
    const taxLabel = chat.calculation
      ? `TY ${chat.taxYear} • Tax: PKR ${Number(chat.calculation.taxOwed || 0).toLocaleString()}`
      : `TY ${chat.taxYear} • Legal Ask`;
    const card = document.createElement("div");
    card.className = "history-card";
    card.innerHTML = `
      <div class="hist-header">
        <span class="hist-date">${chat.createdDate}</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="hist-tax-tag">${chat.atlStatus} Filer</span>
          <button class="hist-card-delete-btn" title="Delete Consultation" data-id="${chat.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-small">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;">
        <h4 class="hist-title">${chat.topic}</h4>
        <p class="hist-snippet">${chat.summary || "FBR tax consultation."}</p>
      </div>
      <div class="hist-footer">
        <span class="hist-date">${taxLabel}</span>
        <div class="hist-card-arrow">
          <span>Details</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="icon-small">
            <line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </div>
      </div>`;
    card.addEventListener("click", (e) => {
      if (e.target.closest(".hist-card-delete-btn")) return;
      openChatDetails(chat.id);
    });
    card.querySelector(".hist-card-delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      chatIdToDelete = chat.id;
      deleteChatModal.classList.remove("hidden");
    });
    historyCardsGrid.appendChild(card);
  });
}

/**
 * Loads metadata summaries and dynamic calculations of a specific thread, rendering them on details panels.
 * 
 * @param {string} chatId The chat session thread ID.
 */
function openChatDetails(chatId) {
  detailsReferrerView = currentView;
  currentChatId = chatId;
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  renderSidebar();

  detailsTopic.textContent     = chat.topic;
  detailsTimestamp.textContent = `Created on: ${chat.createdDate}`;
  detailsSummaryText.textContent = chat.summary || "No summary available for this session.";
  detailsMetaYear.textContent  = chat.taxYear;
  detailsMetaAtl.textContent   = chat.atlStatus;
  detailsMetaAtl.className     = chat.atlStatus === "Inactive"
    ? "meta-value badge badge-atl non-filer" : "meta-value badge badge-atl";

  let isSalaried = true;
  if (chat.calculation) {
    const hasSalary = (chat.calculation.salaryIncome && chat.calculation.salaryIncome > 0);
    const hasOthers = (chat.calculation.businessIncome > 0 || chat.calculation.rentalIncome > 0);
    if (!hasSalary && hasOthers) {
      isSalaried = false;
    }
  } else {
    const chkSalary = document.getElementById("profile-chk-salary");
    const chkBusiness = document.getElementById("profile-chk-business");
    const chkProperty = document.getElementById("profile-chk-property");
    if (chkSalary && !chkSalary.checked && ((chkBusiness && chkBusiness.checked) || (chkProperty && chkProperty.checked))) {
      isSalaried = false;
    }
  }

  if (detailsMetaCategory) {
    detailsMetaCategory.textContent = isSalaried 
      ? "Salaried Individual (Income Tax Ordinance)" 
      : "Non-Salaried / Business (Income Tax Ordinance)";
  }

  if (chat.calculation) {
    detailsCalcCard.classList.remove("hidden");
    let rowsHtml = "";
    
    if (chat.calculation.salaryIncome && chat.calculation.salaryIncome > 0) {
      rowsHtml += `<div class="calc-field-row"><span class="field-label">Salary Income</span><span class="field-value">PKR ${Number(chat.calculation.salaryIncome).toLocaleString()}</span></div>`;
    }
    if (chat.calculation.businessIncome && chat.calculation.businessIncome > 0) {
      rowsHtml += `<div class="calc-field-row"><span class="field-label">Business Income</span><span class="field-value">PKR ${Number(chat.calculation.businessIncome).toLocaleString()}</span></div>`;
    }
    if (chat.calculation.rentalIncome && chat.calculation.rentalIncome > 0) {
      rowsHtml += `<div class="calc-field-row"><span class="field-label">Property Rental Income</span><span class="field-value">PKR ${Number(chat.calculation.rentalIncome).toLocaleString()}</span></div>`;
    }
    
    rowsHtml += `
      <div class="calc-field-row" style="border-top: 1px solid var(--border-color); padding-top: 8px;"><span class="field-label">Total Taxable Income</span><span class="field-value">PKR ${Number(chat.calculation.taxableSalary||0).toLocaleString()}</span></div>
      <div class="calc-field-row"><span class="field-label">Slab Formulas</span><span class="field-value" style="font-size:11px;max-width:65%;text-align:right;">${chat.calculation.rateText||"—"}</span></div>
      <div class="calc-field-row"><span class="field-label">Effective Rate</span><span class="field-value">${chat.calculation.effectiveRate||"—"}</span></div>
      <div class="calc-field-row"><span class="field-label">Total Tax Payable</span><span class="field-value text-success font-semibold">PKR ${Number(chat.calculation.taxOwed||0).toLocaleString()}</span></div>`;
      
    detailsCalcContent.innerHTML = rowsHtml;
  } else {
    detailsCalcCard.classList.add("hidden");
  }

  detailsCitationsList.innerHTML = "";
  if (chat.citations && chat.citations.length) {
    chat.citations.forEach(cit => {
      const li = document.createElement("li");
      li.className = "citation-detail-item";
      li.style.cursor = "pointer";
      const cleanHeader = getCleanCitationHeader(cit.section || cit);
      li.innerHTML = `<div class="cit-title" style="color: var(--accent-glow-color); text-decoration: underline;">${cleanHeader}</div>`;
      li.addEventListener("click", (e) => {
        e.preventDefault();
        openCitationPdf(cit.section || cit);
      });
      detailsCitationsList.appendChild(li);
    });
  } else {
    detailsCitationsList.innerHTML = `<li class="details-subtitle">No citations for this conversation.</li>`;
  }

  switchView("details");
}

/**
 * Requests full message lists from backend for a specific thread, rendering them on feed layouts.
 * 
 * @param {string} chatId The chat session thread ID.
 */
async function loadActiveChat(chatId) {
  currentChatId = chatId;
  chatPanel.classList.remove("welcome-state-active");
  chatWelcomeState.classList.add("hidden");
  chatMessagesFeed.classList.remove("hidden");
  chatMessagesFeed.innerHTML = "";
  chatMessagesFeed.appendChild(aiThinkingIndicator);
  aiThinkingIndicator.classList.add("hidden");

  try {
    const res = await fetch(`${API_BASE_URL}/api/chats/${chatId}/messages`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (res.ok) {
      const msgs = await res.json();
      const chat = chats.find(c => c.id === chatId);
      if (chat) chat.messages = msgs;
      msgs.forEach(m => appendMessageHTML(m.sender, m.text, m.timestamp));
    }
  } catch (err) {
    console.error("Failed to load messages:", err);
  }

  chatMessagesFeed.scrollTop = chatMessagesFeed.scrollHeight;
  switchView("chat");
}

/**
 * Escapes HTML characters to prevent XSS.
 * 
 * @param {string} text The raw text value.
 * @returns {string} The escaped safe HTML string.
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Basic markdown parser for bold, headings, line breaks, lists, and tables.
 * 
 * @param {string} text The input markdown string.
 * @returns {string} The parsed HTML output.
 */
function parseMarkdown(text) {
  if (!text) return "";
  
  let tableHtml = "";
  let cleanText = text;
  
  // Extract and preserve the safe backend-generated tax calculation table to avoid escaping its markup
  if (text.includes('class="tax-table"')) {
    const tableRegex = /(<div class="audit-log-box">[\s\S]*?<\/table>)/;
    const match = text.match(tableRegex);
    if (match) {
      tableHtml = match[1];
      cleanText = text.replace(tableRegex, "{{TAX_COMPUTATION_TABLE}}");
    }
  }
  
  // Escape the clean text to prevent XSS injections
  let html = escapeHtml(cleanText);
  
  // Restore specific safe citation badges generated by the LLM
  html = html.replace(/&lt;a\s+class=&quot;cit-badge&quot;\s+data-cit-idx=&quot;(\d+)&quot;&gt;(.*?)&lt;\/a&gt;/g, '<a class="cit-badge" data-cit-idx="$1">$2</a>');
  html = html.replace(/&lt;a\s+class=&#039;cit-badge&#039;\s+data-cit-idx=&#039;(\d+)&#039;&gt;(.*?)&lt;\/a&gt;/g, '<a class="cit-badge" data-cit-idx="$1">$2</a>');
  
  // Apply standard markdown formatting
  html = html.replace(/^(?:---|___|\*\*\*)\s*$/gm, '<hr class="md-hr">');
  html = html.replace(/^### (.*?)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^#### (.*?)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^## (.*?)$/gm, '<h2 class="md-h2">$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1 class="md-h1">$1</h1>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^\*\s+(.*?)$/gm, '<li class="md-li">$1</li>');
  html = html.replace(/^-\s+(.*?)$/gm, '<li class="md-li">$1</li>');
  
  html = html.replace(/((?:<li class="md-li">.*?<\/li>\s*)+)/g, '<ul class="md-ul">$1</ul>');
  html = html.replace(/\n/g, '<br>');
  
  html = html.replace(/<ul class="md-ul"><br>/g, '<ul class="md-ul">');
  html = html.replace(/<\/ul><br>/g, '</ul>');
  html = html.replace(/<\/li><br>/g, '</li>');
  html = html.replace(/<hr class="md-hr"><br>/g, '<hr class="md-hr">');
  html = html.replace(/<\/h3><br>/g, '</h3>');
  html = html.replace(/<\/h4><br>/g, '</h4>');
  html = html.replace(/<\/h2><br>/g, '</h2>');
  html = html.replace(/<\/h1><br>/g, '</h1>');
  html = html.replace(/<\/table><br>/g, '</table>');
  html = html.replace(/<\/div><br>/g, '</div>');
  
  // Re-inject the safe calculation table HTML
  if (tableHtml) {
    if (html.includes("{{TAX_COMPUTATION_TABLE}}")) {
      html = html.replace("{{TAX_COMPUTATION_TABLE}}", tableHtml);
    } else {
      html = tableHtml + "<br>" + html;
    }
  }
  
  return html;
}

/**
 * Creates and appends message bubbles inside chat feed feeds.
 * 
 * @param {string} sender The message origin indicator ('user', 'ai').
 * @param {string} text The conversational text content.
 * @param {string} timestamp The time label string.
 */
function appendMessageHTML(sender, text, timestamp) {
  const row = document.createElement("div");
  row.className = `message-row ${sender}`;
  
  const contentHtml = sender === "ai" ? parseMarkdown(text) : escapeHtml(text);
  
  row.innerHTML = `
    <div class="message-bubble">
      <div class="message-text">${contentHtml}</div>
      <div style="font-size:9.5px;color:var(--text-muted);margin-top:6px;">${timestamp}</div>
    </div>`;
  if (chatMessagesFeed.contains(aiThinkingIndicator)) {
    chatMessagesFeed.insertBefore(row, aiThinkingIndicator);
  } else {
    chatMessagesFeed.appendChild(row);
  }
  row.querySelectorAll(".cit-badge").forEach(badge => {
    badge.addEventListener("click", e => {
      e.preventDefault();
      const idx = parseInt(badge.getAttribute("data-cit-idx"));
      const chat = chats.find(c => c.id === currentChatId);
      if (chat && chat.citations && chat.citations[idx]) {
        const c = chat.citations[idx];
        const cleanHeader = getCleanCitationHeader(c.section || "FBR Reference Citation");
        showCustomAlert("FBR Reference Citation", cleanHeader, c.section);
      }
    });
  });
}

/**
 * Triggers backend DELETE chat routing, splicing local cached elements.
 * 
 * @param {string} chatId The chat session thread ID.
 */
async function deleteChat(chatId) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/chats/${chatId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (res.ok) {
      chats = chats.filter(c => c.id !== chatId);
      if (currentChatId === chatId) { currentChatId = null; switchView("chat"); }
      renderSidebar();
      renderHistoryGrid();
    }
  } catch (err) {
    console.error("Delete failed:", err);
  }
}

/**
 * Clears parameters, input cards, and sets layouts to launch a fresh discussion thread.
 */
function handleNewChat() {
  currentChatId = null;
  chatPanel.classList.add("welcome-state-active");
  chatWelcomeState.classList.remove("hidden");
  chatMessagesFeed.classList.add("hidden");
  chatMessagesFeed.innerHTML = "";
  chatTextarea.value = "";
  adjustTextareaHeight();
  applyRandomGreeting();
  chatMessagesFeed.appendChild(aiThinkingIndicator);
  aiThinkingIndicator.classList.add("hidden");
  updateProfileUILabels();
  switchView("chat");
  renderSidebar();
}

/**
 * Manages conversation pipeline logic, updates chat state feeds, handles thinking logs and network results.
 */
async function handleSendMessage() {
  const text = chatTextarea.value.trim();
  if (!text) return;

  chatTextarea.value = "";
  adjustTextareaHeight();
  sendMsgBtn.disabled = true;

  const now     = new Date();
  const timeStr = now.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  const dateStr = now.toLocaleDateString([], { month:"short", day:"2-digit", year:"numeric" }) + ", " + timeStr;

  if (!currentChatId) {
    const newId   = crypto.randomUUID();
    const title   = text.length > 48 ? text.substring(0, 48) + "…" : text;

    fetch(`${API_BASE_URL}/api/chats`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ user_id: session.user_id, thread_id: newId, title })
    }).catch(err => {
      console.error("Thread creation failed:", err);
    });

    currentChatId = newId;
    chats.unshift({
      id: currentChatId, topic: title,
      taxYear: session.taxYear, atlStatus: session.atlStatus,
      createdDate: dateStr, summary: "", messages: [],
      calculation: null, citations: []
    });

    chatPanel.classList.remove("welcome-state-active");
    chatWelcomeState.classList.add("hidden");
    chatMessagesFeed.classList.remove("hidden");
  }

  const activeChat = chats.find(c => c.id === currentChatId);
  activeChat.messages.push({ sender:"user", text, timestamp: timeStr });
  appendMessageHTML("user", text, timeStr);

  chatMessagesFeed.appendChild(aiThinkingIndicator);
  aiThinkingIndicator.classList.remove("hidden");
  thinkingStepText.textContent = "Analyzing your query...";
  const steps = [
    "Retrieving relevant tax information...",
    "Computing calculation rules...",
    "Generating final response..."
  ];
  let si = 0;
  const cycleInterval = setInterval(() => {
    if (si < steps.length) thinkingStepText.textContent = steps[si++];
  }, 1400);

  chatMessagesFeed.scrollTop = chatMessagesFeed.scrollHeight;
  renderSidebar();

  try {
    const res = await fetch(`${API_BASE_URL}/api/chats/${currentChatId}/message`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body:    JSON.stringify({ message: text, user_id: session.user_id })
    });

    clearInterval(cycleInterval);
    aiThinkingIndicator.classList.add("hidden");

    if (res.ok) {
      const data = await res.json();

      activeChat.summary = typeof data.response === "string"
        ? data.response.substring(0, 180) + "…" : "";
      activeChat.topic   = data.topic || activeChat.topic;

      if (data.calculation) activeChat.calculation = data.calculation;
      if (data.citations)   activeChat.citations   = data.citations;

      activeChat.messages.push({ sender:"ai", text: data.response, timestamp: timeStr });
      appendMessageHTML("ai", data.response, timeStr);
    } else {
      const err = await res.json().catch(() => ({}));
      appendMessageHTML("ai",
        `<span style="color:var(--danger-red)">⚠ Error from agent: ${err.detail || "Unknown error"}</span>`,
        timeStr);
    }
  } catch (err) {
    clearInterval(cycleInterval);
    aiThinkingIndicator.classList.add("hidden");
    if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
      appendMessageHTML("ai",
        "I could not reach the TaxPilot backend. Please make sure the server is running on port 8000.",
        timeStr);
    } else {
      appendMessageHTML("ai",
        "Something went wrong while processing your request. Please try again.",
        timeStr);
    }
    console.error("Message send error:", err);
  } finally {
    sendMsgBtn.disabled = false;
    renderSidebar();
    renderHistoryGrid();
    chatMessagesFeed.scrollTop = chatMessagesFeed.scrollHeight;
  }
}

/**
 * Resizes the chat textarea input field automatically based on text volume.
 */
function adjustTextareaHeight() {
  chatTextarea.style.height = "auto";
  chatTextarea.style.height = chatTextarea.scrollHeight + "px";
  sendMsgBtn.disabled = chatTextarea.value.trim() === "";
}

/**
 * Maps handlers, keystrokes, modal buttons, and click listeners.
 */
function setupEventListeners() {
  themeBtn.addEventListener("click", toggleTheme);
  newChatBtn.addEventListener("click", handleNewChat);
  
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", () => toggleMobileSidebar());
  }
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener("click", () => toggleMobileSidebar(true));
  }
  sidebarHistoryBtn.addEventListener("click", () => switchView("history"));
  profileBtn.addEventListener("click", () => switchView("profile"));
  profileEditForm.addEventListener("submit", saveProfile);
  profileCancelBtn.addEventListener("click", () => switchView("chat"));

  chatTextarea.addEventListener("input", adjustTextareaHeight);
  chatTextarea.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  });
  sendMsgBtn.addEventListener("click", handleSendMessage);

  detailsBackBtn.addEventListener("click", () => switchView(detailsReferrerView));
  resumeChatBtn.addEventListener("click", () => {
    if (currentChatId) loadActiveChat(currentChatId);
  });

  logoutBtn.addEventListener("click",       () => logoutModal.classList.remove("hidden"));
  closeLogoutBtn.addEventListener("click",  () => logoutModal.classList.add("hidden"));
  cancelLogoutBtn.addEventListener("click", () => logoutModal.classList.add("hidden"));

  const hideDeleteChatModal = () => {
    deleteChatModal.classList.add("hidden");
    chatIdToDelete = null;
  };
  closeDeleteChatBtn.addEventListener("click",  hideDeleteChatModal);
  cancelDeleteChatBtn.addEventListener("click", hideDeleteChatModal);
  confirmDeleteChatBtn.addEventListener("click", async () => {
    if (chatIdToDelete) {
      const targetId = chatIdToDelete;
      hideDeleteChatModal();
      await deleteChat(targetId);
    }
  });

  confirmLogoutBtn.addEventListener("click", () => {
    logoutModal.classList.add("hidden");
    sessionStorage.clear();
    localStorage.removeItem("taxpilot_theme");
    window.location.replace("login.html");
  });

  window.addEventListener("click", e => {
    if (e.target === logoutModal) logoutModal.classList.add("hidden");
    if (e.target === deleteChatModal) hideDeleteChatModal();
    const customAlertModal = document.getElementById("custom-alert-modal");
    if (e.target === customAlertModal) customAlertModal.classList.add("hidden");
  });
}

/**
 * Translates structural file paths into clean, customer-facing titles.
 * 
 * @param {string} section The raw section path string.
 * @returns {string} The cleaned customer-facing title.
 */
function getCleanCitationHeader(section) {
  let text = section || "";
  text = text.replace(/ActiveTaxpayerList\.md\s*-\s*/gi, "Active Taxpayer List - ");
  text = text.replace(/RegisterForIncomeTax\.md\s*-\s*/gi, "Register for Income Tax - ");
  text = text.replace(/FileIncomeTax\.md\s*-\s*/gi, "File Income Tax Return - ");
  text = text.replace(/\.md/gi, "");
  return text.trim();
}

/**
 * Triggers modal alert blocks showing title, description, and source buttons.
 * 
 * @param {string} title Alert box title.
 * @param {string} message Description/Content.
 * @param {string|null} pdfSection The PDF citation target index.
 */
function showCustomAlert(title, message, pdfSection = null) {
  const modal = document.getElementById("custom-alert-modal");
  const titleEl = document.getElementById("custom-alert-title");
  const msgEl = document.getElementById("custom-alert-message");
  const pdfBtn = document.getElementById("custom-alert-pdf-btn");
  
  if (modal && titleEl && msgEl) {
    titleEl.textContent = title;
    msgEl.textContent = message;
    
    if (pdfSection) {
      pdfBtn.style.display = "inline-flex";
      
      const isWeb = pdfSection.toLowerCase().includes(".md") || 
                    pdfSection.toLowerCase().includes("active taxpayer") ||
                    pdfSection.toLowerCase().includes("register") ||
                    pdfSection.toLowerCase().includes("file");
      
      const btnSpan = pdfBtn.querySelector("span");
      if (btnSpan) {
        btnSpan.textContent = isWeb ? "View Website" : "View Source PDF";
      }
      
      pdfBtn.onclick = (e) => {
        e.preventDefault();
        openCitationPdf(pdfSection);
      };
    } else {
      pdfBtn.style.display = "none";
    }
    
    modal.classList.remove("hidden");
  }
}

/**
 * Dismisses active popup modal layouts.
 */
function closeCustomAlert() {
  const modal = document.getElementById("custom-alert-modal");
  if (modal) {
    modal.classList.add("hidden");
  }
}

/**
 * Maps citation tags to appropriate cloud FBR guide PDFs or portals, matching exact sections.
 * 
 * @param {string} section The FBR reference citation section text.
 */
function openCitationPdf(section) {
  const sectionText = section || "";
  
  if (sectionText.toLowerCase().includes("activetaxpayerlist") || 
      sectionText.toLowerCase().includes("active taxpayer")) {
    window.open("https://fbr.gov.pk/categ/active-taxpayer-list-income-tax/51147/30859/71168", "_blank");
    return;
  }
  if (sectionText.toLowerCase().includes("registerforincometax") || 
      sectionText.toLowerCase().includes("register for income")) {
    window.open("https://www.fbr.gov.pk/categ/income-tax/51148/30846/%2061149", "_blank");
    return;
  }
  if (sectionText.toLowerCase().includes("fileincometax") || 
      sectionText.toLowerCase().includes("file income")) {
    window.open("https://fbr.gov.pk/categ/file-income-tax-return/51147/80860/%2071158", "_blank");
    return;
  }

  let pdfUrl = "https://hqxxyiobvjizfvhosjch.supabase.co/storage/v1/object/public/taxpilot-docs/IncomeTaxOrdinance2001-Amended-20.02.2026.pdf";
  
  if (sectionText.toLowerCase().includes("rules") || sectionText.toLowerCase().includes("rule")) {
    pdfUrl = "https://hqxxyiobvjizfvhosjch.supabase.co/storage/v1/object/public/taxpilot-docs/IncomeTaxRules2002Amendedupto10.02.2017.pdf";
  } else if (sectionText.toLowerCase().includes("finance act") || sectionText.toLowerCase().includes("finance")) {
    pdfUrl = "https://hqxxyiobvjizfvhosjch.supabase.co/storage/v1/object/public/taxpilot-docs/FinanceAct2026.pdf";
  }

  let cleanSection = sectionText;
  if (sectionText.includes(" - ")) {
    cleanSection = sectionText.split(" - ").slice(1).join(" - ").trim();
  }
  cleanSection = cleanSection.replace(/\s*\(.*?\)\s*/g, " ").trim();

  const searchPhrase = encodeURIComponent(cleanSection.replace(/[()]/g, "").trim());
  const fullUrl = `${pdfUrl}#search=${searchPhrase}`;
  
  window.open(fullUrl, "_blank");
}

window.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  initApp();
});
