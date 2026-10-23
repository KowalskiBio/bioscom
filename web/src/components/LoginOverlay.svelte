<script lang="ts">
  import { api, ApiError } from "../lib/api";
  import { login, enterApp } from "../lib/app";
  import { session, loadSession, setUser, clearSession } from "../lib/stores/session.svelte";
  import { groupList, fetchPublicGroups } from "../lib/stores/groups.svelte";
  import { showToast } from "../lib/stores/toast.svelte";

  type Panel = "welcome" | "login" | "register-user" | "register-group" | "reset";

  let panel = $state<Panel>("welcome");
  let shake = $state<Panel | null>(null);
  let loginError = $state("");
  let loginErrorVisible = $state(false);
  let regUserError = $state("");
  let regUserErrorVisible = $state(false);
  let regGroupError = $state("");
  let regGroupErrorVisible = $state(false);
  let resetError = $state("");
  let resetErrorVisible = $state(false);
  let loginSubtitle = $state("Sign In");
  let loginBusy = $state(false);
  let regUserBusy = $state(false);
  let regGroupBusy = $state(false);
  let resetBusy = $state(false);
  let forgotBusy = $state(false);

  let selectedLabId = $state("");
  let loginEmail = $state("");
  let loginPassword = $state("");
  let regUserName = $state("");
  let regUserEmail = $state("");
  let regUserPassword = $state("");
  let regUserCode = $state("");
  let regGroupLabname = $state("");
  let regGroupName = $state("");
  let regGroupEmail = $state("");
  let regGroupPassword = $state("");
  let resetToken = $state("");
  let resetPassword = $state("");

  function initialPanel(): Panel {
    return window.location.hash.startsWith("#/reset-password") ? "reset" : "welcome";
  }

  function readResetToken(): void {
    const query = window.location.hash.split("?")[1] ?? "";
    resetToken = new URLSearchParams(query).get("token") ?? "";
  }

  $effect(() => {
    panel = initialPanel();
    readResetToken();
    void fetchPublicGroups().catch(() => {
      return;
    });
  });

  window.addEventListener("hashchange", () => {
    if (window.location.hash.startsWith("#/reset-password")) {
      showPanel("reset");
      readResetToken();
    }
  });

  function showPanel(next: Panel): void {
    panel = next;
    loginErrorVisible = false;
    regUserErrorVisible = false;
    regGroupErrorVisible = false;
    resetErrorVisible = false;
  }

  function shakeCard(which: Panel): void {
    shake = which;
    setTimeout(() => {
      shake = null;
    }, 400);
  }

  function showLoginError(message: string): void {
    loginError = message;
    loginErrorVisible = true;
    shakeCard("login");
  }

  function authErrorText(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status >= 500) {
        return "Connection error. Check your internet and try again.";
      }
      return error.message;
    }
    return "Connection error. Check your internet and try again.";
  }

  function toLogin(): void {
    const selected = groupList.items.find((g) => g.id === selectedLabId);
    loginSubtitle = selected !== undefined ? `Sign In to ${selected.name}` : "Sign In to BioSCom";
    showPanel("login");
  }

  async function handleLoginSubmit(): Promise<void> {
    const email = loginEmail.trim();
    const password = loginPassword.trim();
    if (email === "" || password === "") {
      showLoginError("Please fill in all fields");
      return;
    }
    loginBusy = true;
    try {
      await login(email, password);
      loginPassword = "";
      loginErrorVisible = false;
    } catch (error) {
      showLoginError(authErrorText(error));
    } finally {
      loginBusy = false;
    }
  }

  async function handleForgotPassword(): Promise<void> {
    const email = loginEmail.trim();
    if (email === "") {
      showToast("Please enter your email address in the Email field first.", "error");
      return;
    }
    forgotBusy = true;
    try {
      await api.post("/api/forgot-password", { email });
      showToast("Password reset email sent! Please check your inbox.", "success");
    } catch (error) {
      showToast(authErrorText(error), "error");
    } finally {
      forgotBusy = false;
    }
  }

  async function handleRegUserSubmit(): Promise<void> {
    const name = regUserName.trim();
    const email = regUserEmail.trim();
    const password = regUserPassword.trim();
    const joinCode = regUserCode.trim();

    if (session.user !== null) {
      if (name === "" || joinCode === "") {
        regUserError = "Please fill in all fields";
        regUserErrorVisible = true;
        return;
      }
    } else {
      if (name === "" || email === "" || password === "" || joinCode === "") {
        regUserError = "Please fill in all fields";
        regUserErrorVisible = true;
        return;
      }
      if (password.length < 6) {
        regUserError = "Password must be at least 6 characters";
        regUserErrorVisible = true;
        return;
      }
    }

    regUserBusy = true;
    try {
      if (session.user === null) {
        try {
          await api.post("/api/register", { email, password, name });
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            await loadSession();
            if (session.user === null) {
              throw error;
            }
          } else {
            throw error;
          }
        }
      }
      await api.post("/api/groups/join", { code: joinCode });
      await loadSession();
      if (session.user === null) {
        throw new ApiError(401, "Not authenticated");
      }
      regUserName = "";
      regUserEmail = "";
      regUserPassword = "";
      regUserCode = "";
      showToast("Account registered and joined lab successfully!", "success");
      await enterApp();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        regUserError = "Invalid laboratory join code";
      } else if (error instanceof ApiError && error.status === 409) {
        regUserError = error.message;
      } else if (error instanceof ApiError && error.status === 400) {
        regUserError = "Please fill in all fields";
      } else {
        regUserError = authErrorText(error);
      }
      regUserErrorVisible = true;
      shakeCard("register-user");
    } finally {
      regUserBusy = false;
    }
  }

  function countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  async function handleRegGroupSubmit(): Promise<void> {
    const labName = regGroupLabname.trim();
    const name = regGroupName.trim();
    const email = regGroupEmail.trim();
    const password = regGroupPassword.trim();

    if (session.user !== null) {
      if (labName === "" || name === "") {
        regGroupError = "Please fill in all fields";
        regGroupErrorVisible = true;
        return;
      }
    } else {
      if (labName === "" || name === "" || email === "" || password === "") {
        regGroupError = "Please fill in all fields";
        regGroupErrorVisible = true;
        return;
      }
      if (password.length < 6) {
        regGroupError = "Password must be at least 6 characters";
        regGroupErrorVisible = true;
        return;
      }
    }

    if (countWords(labName) > 300 || countWords(name) > 300) {
      regGroupError = "Laboratory or display name exceeds 300 words";
      regGroupErrorVisible = true;
      return;
    }

    regGroupBusy = true;
    try {
      if (session.user === null) {
        await api.post("/api/register", { email, password, name });
        await loadSession();
      }
      const created = await api.post<{ group: { id: string; name: string; joinCode: string } }>("/api/groups", {
        name: labName,
      });
      await loadSession();
      regGroupLabname = "";
      regGroupName = "";
      regGroupEmail = "";
      regGroupPassword = "";
      showToast("Laboratory group created successfully!", "success");
      showToast(`Your lab join code is ${created.group.joinCode}`, "info");
      await enterApp();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        regGroupError = "An account with this email already exists. Sign in instead.";
      } else if (error instanceof ApiError && error.status === 400) {
        regGroupError = "Please fill in all fields";
      } else {
        regGroupError = authErrorText(error);
      }
      regGroupErrorVisible = true;
      shakeCard("register-group");
    } finally {
      regGroupBusy = false;
    }
  }

  async function handleResetSubmit(): Promise<void> {
    const password = resetPassword.trim();
    if (resetToken === "" || password === "") {
      resetError = "Please fill in all fields";
      resetErrorVisible = true;
      return;
    }
    if (password.length < 6) {
      resetError = "Password must be at least 6 characters";
      resetErrorVisible = true;
      return;
    }
    resetBusy = true;
    try {
      await api.post("/api/reset-password", { token: resetToken, password });
      showToast("Password has been reset. You can now log in.", "success");
      window.location.hash = "";
      showPanel("login");
      loginSubtitle = "Sign In";
      loginEmail = "";
    } catch (error) {
      resetError = authErrorText(error);
      resetErrorVisible = true;
      shakeCard("reset");
    } finally {
      resetBusy = false;
    }
  }

  function onLoginKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      void handleLoginSubmit();
    }
  }

  function onRegUserCodeKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      void handleRegUserSubmit();
    }
  }

  function onRegGroupPasswordKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      void handleRegGroupSubmit();
    }
  }

  function onResetKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      void handleResetSubmit();
    }
  }

  const regUserAuthed = $derived(session.user !== null);
</script>

<!-- Login Overlay -->
<div id="login-overlay" class="login-overlay" class:hidden={session.user !== null}>
    <!-- Panel 1: Welcome Portal / Group Selection -->
    <div class="login-card" id="auth-panel-welcome" class:hidden={panel !== "welcome"}>
        <div class="login-logo">
            <svg viewBox="0 0 40 40" fill="none">
                <path d="M20 6 L32 13 L32 27 L20 34 L8 27 L8 13 Z" fill="none" stroke="url(#g_login)" stroke-width="2"/>
                <circle cx="20" cy="6" r="3" fill="url(#g_login)"/>
                <circle cx="32" cy="13" r="3" fill="url(#g_login)"/>
                <circle cx="32" cy="27" r="3" fill="url(#g_login)"/>
                <circle cx="20" cy="34" r="3" fill="url(#g_login)"/>
                <circle cx="8" cy="27" r="3" fill="url(#g_login)"/>
                <circle cx="8" cy="13" r="3" fill="url(#g_login)"/>
                <circle cx="20" cy="20" r="3" fill="url(#g_login)"/>
                <path d="M20 6 L20 20 M32 13 L20 20 M32 27 L20 20 M20 34 L20 20 M8 27 L20 20 M8 13 L20 20" stroke="url(#g_login)" stroke-width="1.5" opacity="0.5"/>
                <defs>
                    <linearGradient id="g_login" x1="8" y1="6" x2="32" y2="34">
                        <stop offset="0%" stop-color="#0ea5e9"/>
                        <stop offset="100%" stop-color="#c084fc"/>
                    </linearGradient>
                </defs>
            </svg>
            <span class="login-title">BioSCom</span>
            <span class="login-subtitle">Laboratory Portals</span>
        </div>

        <div class="auth-welcome-content" style="width: 100%; display: flex; flex-direction: column; gap: 1.25rem;">
            <div class="login-input-group">
                <label class="login-label" style="text-align:center;width:100%;">Select Your Laboratory Group</label>
                <select id="auth-lab-select" class="login-input" style="cursor: pointer; text-align-last: center;" bind:value={selectedLabId}>
                    <option value="" disabled selected>Choose a laboratory...</option>
                    {#each groupList.items as group (group.id)}
                        <option value={group.id}>{group.name}</option>
                    {/each}
                </select>
            </div>

            <button id="btn-to-login" class="login-btn" style="width:100%;" onclick={toLogin}>Sign In</button>

            <div style="display:flex;gap:1rem;width:100%;margin-top:0.5rem;">
                <button id="btn-to-register-user" class="login-btn" style="flex:1;font-size:0.8rem;padding:0.75rem;background:var(--border-light);border:1px solid var(--border-light);box-shadow:none;" onclick={() => showPanel("register-user")}>Join a Lab</button>
                <button id="btn-to-register-group" class="login-btn" style="flex:1;font-size:0.8rem;padding:0.75rem;background:var(--border-light);border:1px solid var(--border-light);box-shadow:none;" onclick={() => showPanel("register-group")}>Create a Lab</button>
            </div>
        </div>
    </div>

    <!-- Panel 2: Sign In -->
    <div class="login-card" id="auth-panel-login" class:hidden={panel !== "login"} class:shake={shake === "login"}>
        <div class="login-logo">
            <span class="login-title">BioSCom</span>
            <span class="login-subtitle" id="auth-login-subtitle">{loginSubtitle}</span>
        </div>
        <div class="login-form">
            <div class="login-input-group">
                <label for="login-email" class="login-label">Email Address</label>
                <input type="email" id="login-email" class="login-input" placeholder="name@muni.cz" bind:value={loginEmail}>
            </div>
            <div class="login-input-group">
                <label for="login-password-field" class="login-label">Password</label>
                <input type="password" id="login-password-field" class="login-input" placeholder="••••••••" bind:value={loginPassword} onkeydown={onLoginKeydown}>
            </div>
            <div style="display: flex; justify-content: flex-end; margin-top: -0.5rem; margin-bottom: 0.75rem;">
                <a href="#" id="btn-forgot-password" style="font-size: 0.75rem; color: var(--accent-blue); text-decoration: none; cursor: pointer;" onclick={(e) => { e.preventDefault(); void handleForgotPassword(); }}>{forgotBusy ? "Sending..." : "Forgot Password?"}</a>
            </div>
            <div id="auth-login-error" class="login-error" class:visible={loginErrorVisible}>{loginError}</div>
            <button id="btn-login-submit" class="login-btn" disabled={loginBusy} onclick={() => void handleLoginSubmit()}>{loginBusy ? "Signing in…" : "Log In"}</button>
            <button id="btn-login-back" class="login-btn" style="width:100%;background:var(--border-light);border:1px solid var(--border-light);box-shadow:none;" onclick={() => showPanel("welcome")}>← Back</button>
        </div>
    </div>

    <!-- Panel 3: Register Account & Join Lab -->
    <div class="login-card" id="auth-panel-register-user" class:hidden={panel !== "register-user"} class:shake={shake === "register-user"}>
        <div class="login-logo">
            <span class="login-title">BioSCom</span>
            <span class="login-subtitle">Join a Laboratory</span>
        </div>
        <div class="login-form">
            <div class="login-input-group">
                <label for="reg-user-name" class="login-label">Full Name</label>
                <input type="text" id="reg-user-name" class="login-input" placeholder="e.g. Dr. Jane Doe" bind:value={regUserName}>
            </div>
            <div class="login-input-group">
                <label for="reg-user-email" class="login-label">Email Address</label>
                <input type="email" id="reg-user-email" class="login-input" placeholder="name@muni.cz" bind:value={regUserEmail} disabled={regUserAuthed}>
            </div>
            <div class="login-input-group">
                <label for="reg-user-password" class="login-label">Password (min 6 chars)</label>
                <input type="password" id="reg-user-password" class="login-input" placeholder="••••••••" bind:value={regUserPassword} disabled={regUserAuthed}>
            </div>
            <div class="login-input-group">
                <label for="reg-user-code" class="login-label">Lab Group Join Code</label>
                <input type="text" id="reg-user-code" class="login-input" placeholder="e.g. CHEM-ORG-842" bind:value={regUserCode} onkeydown={onRegUserCodeKeydown}>
            </div>
            <div id="auth-reg-user-error" class="login-error" class:visible={regUserErrorVisible}>{regUserError}</div>
            <button id="btn-reg-user-submit" class="login-btn" disabled={regUserBusy} onclick={() => void handleRegUserSubmit()}>{regUserBusy ? "Joining Lab…" : "Register & Join"}</button>
            <button id="btn-reg-user-back" class="login-btn" style="width:100%;background:var(--border-light);border:1px solid var(--border-light);box-shadow:none;" onclick={() => showPanel("welcome")}>← Back</button>
        </div>
    </div>

    <!-- Panel 4: Create a New Lab Group -->
    <div class="login-card" id="auth-panel-register-group" class:hidden={panel !== "register-group"} class:shake={shake === "register-group"}>
        <div class="login-logo">
            <span class="login-title">BioSCom</span>
            <span class="login-subtitle">Create a New Laboratory</span>
        </div>
        <div class="login-form">
            <div class="login-input-group">
                <label for="reg-group-labname" class="login-label">Laboratory Group Name</label>
                <input type="text" id="reg-group-labname" class="login-input" placeholder="e.g. Organic Chemistry Lab" bind:value={regGroupLabname}>
            </div>
            <div class="login-input-group">
                <label for="reg-group-name" class="login-label">Admin Full Name</label>
                <input type="text" id="reg-group-name" class="login-input" placeholder="e.g. Dr. Jane Doe" bind:value={regGroupName}>
            </div>
            <div class="login-input-group">
                <label for="reg-group-email" class="login-label">Admin Email Address</label>
                <input type="email" id="reg-group-email" class="login-input" placeholder="name@muni.cz" bind:value={regGroupEmail} disabled={regUserAuthed}>
            </div>
            <div class="login-input-group">
                <label for="reg-group-password" class="login-label">Admin Password (min 6 chars)</label>
                <input type="password" id="reg-group-password" class="login-input" placeholder="••••••••" bind:value={regGroupPassword} onkeydown={onRegGroupPasswordKeydown} disabled={regUserAuthed}>
            </div>
            <div id="auth-reg-group-error" class="login-error" class:visible={regGroupErrorVisible}>{regGroupError}</div>
            <button id="btn-reg-group-submit" class="login-btn" disabled={regGroupBusy} onclick={() => void handleRegGroupSubmit()}>{regGroupBusy ? "Creating Lab…" : "Create & Register"}</button>
            <button id="btn-reg-group-back" class="login-btn" style="width:100%;background:var(--border-light);border:1px solid var(--border-light);box-shadow:none;" onclick={() => showPanel("welcome")}>← Back</button>
        </div>
    </div>

    <!-- Panel 5: Reset Password -->
    <div class="login-card" id="auth-panel-reset" class:hidden={panel !== "reset"} class:shake={shake === "reset"}>
        <div class="login-logo">
            <span class="login-title">BioSCom</span>
            <span class="login-subtitle">Reset Password</span>
        </div>
        <div class="login-form">
            <div class="login-input-group">
                <label for="reset-password-field" class="login-label">New Password (min 6 chars)</label>
                <input type="password" id="reset-password-field" class="login-input" placeholder="••••••••" bind:value={resetPassword} onkeydown={onResetKeydown}>
            </div>
            <div id="auth-reset-error" class="login-error" class:visible={resetErrorVisible}>{resetError}</div>
            <button id="btn-reset-submit" class="login-btn" disabled={resetBusy} onclick={() => void handleResetSubmit()}>{resetBusy ? "Resetting…" : "Reset Password"}</button>
            <button id="btn-reset-back" class="login-btn" style="width:100%;background:var(--border-light);border:1px solid var(--border-light);box-shadow:none;" onclick={() => { window.location.hash = ""; showPanel("login"); loginSubtitle = "Sign In"; }}>← Back to Sign In</button>
        </div>
    </div>
</div>
