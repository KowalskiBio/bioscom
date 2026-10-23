<script lang="ts">
  import { session } from "../lib/stores/session.svelte";
</script>

<!-- Login Overlay -->
<div id="login-overlay" class="login-overlay" class:hidden={session.user !== null}>
    <!-- Panel 1: Welcome Portal / Group Selection -->
    <div class="login-card" id="auth-panel-welcome">
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
                <select id="auth-lab-select" class="login-input" style="cursor: pointer; text-align-last: center;">
                    <option value="" disabled selected>Choose a laboratory...</option>
                </select>
            </div>

            <button id="btn-to-login" class="login-btn" style="width:100%;">Sign In</button>

            <div style="display:flex;gap:1rem;width:100%;margin-top:0.5rem;">
                <button id="btn-to-register-user" class="login-btn" style="flex:1;font-size:0.8rem;padding:0.75rem;background:var(--border-light);border:1px solid var(--border-light);box-shadow:none;">Join a Lab</button>
                <button id="btn-to-register-group" class="login-btn" style="flex:1;font-size:0.8rem;padding:0.75rem;background:var(--border-light);border:1px solid var(--border-light);box-shadow:none;">Create a Lab</button>
            </div>
        </div>
    </div>

    <!-- Panel 2: Sign In -->
    <div class="login-card hidden" id="auth-panel-login">
        <div class="login-logo">
            <span class="login-title">BioSCom</span>
            <span class="login-subtitle" id="auth-login-subtitle">Sign In</span>
        </div>
        <div class="login-form">
            <div class="login-input-group">
                <label for="login-email" class="login-label">Email Address</label>
                <input type="email" id="login-email" class="login-input" placeholder="name@muni.cz">
            </div>
            <div class="login-input-group">
                <label for="login-password-field" class="login-label">Password</label>
                <input type="password" id="login-password-field" class="login-input" placeholder="••••••••">
            </div>
            <div style="display: flex; justify-content: flex-end; margin-top: -0.5rem; margin-bottom: 0.75rem;">
                <a href="#" id="btn-forgot-password" style="font-size: 0.75rem; color: var(--accent-blue); text-decoration: none; cursor: pointer;">Forgot Password?</a>
            </div>
            <div id="auth-login-error" class="login-error">Incorrect credentials</div>
            <button id="btn-login-submit" class="login-btn">Log In</button>
            <button id="btn-login-back" class="login-btn" style="width:100%;background:var(--border-light);border:1px solid var(--border-light);box-shadow:none;">← Back</button>
        </div>
    </div>

    <!-- Panel 3: Register Account & Join Lab -->
    <div class="login-card hidden" id="auth-panel-register-user">
        <div class="login-logo">
            <span class="login-title">BioSCom</span>
            <span class="login-subtitle">Join a Laboratory</span>
        </div>
        <div class="login-form">
            <div class="login-input-group">
                <label for="reg-user-name" class="login-label">Full Name</label>
                <input type="text" id="reg-user-name" class="login-input" placeholder="e.g. Dr. Jane Doe">
            </div>
            <div class="login-input-group">
                <label for="reg-user-email" class="login-label">Email Address</label>
                <input type="email" id="reg-user-email" class="login-input" placeholder="name@muni.cz">
            </div>
            <div class="login-input-group">
                <label for="reg-user-password" class="login-label">Password (min 6 chars)</label>
                <input type="password" id="reg-user-password" class="login-input" placeholder="••••••••">
            </div>
            <div class="login-input-group">
                <label for="reg-user-code" class="login-label">Lab Group Join Code</label>
                <input type="text" id="reg-user-code" class="login-input" placeholder="e.g. CHEM-ORG-842">
            </div>
            <div id="auth-reg-user-error" class="login-error">Registration failed</div>
            <button id="btn-reg-user-submit" class="login-btn">Register &amp; Join</button>
            <button id="btn-reg-user-back" class="login-btn" style="width:100%;background:var(--border-light);border:1px solid var(--border-light);box-shadow:none;">← Back</button>
        </div>
    </div>

    <!-- Panel 4: Create a New Lab Group -->
    <div class="login-card hidden" id="auth-panel-register-group">
        <div class="login-logo">
            <span class="login-title">BioSCom</span>
            <span class="login-subtitle">Create a New Laboratory</span>
        </div>
        <div class="login-form">
            <div class="login-input-group">
                <label for="reg-group-labname" class="login-label">Laboratory Group Name</label>
                <input type="text" id="reg-group-labname" class="login-input" placeholder="e.g. Organic Chemistry Lab">
            </div>
            <div class="login-input-group">
                <label for="reg-group-name" class="login-label">Admin Full Name</label>
                <input type="text" id="reg-group-name" class="login-input" placeholder="e.g. Dr. Jane Doe">
            </div>
            <div class="login-input-group">
                <label for="reg-group-email" class="login-label">Admin Email Address</label>
                <input type="email" id="reg-group-email" class="login-input" placeholder="name@muni.cz">
            </div>
            <div class="login-input-group">
                <label for="reg-group-password" class="login-label">Admin Password (min 6 chars)</label>
                <input type="password" id="reg-group-password" class="login-input" placeholder="••••••••">
            </div>
            <div id="auth-reg-group-error" class="login-error">Creation failed</div>
            <button id="btn-reg-group-submit" class="login-btn">Create &amp; Register</button>
            <button id="btn-reg-group-back" class="login-btn" style="width:100%;background:var(--border-light);border:1px solid var(--border-light);box-shadow:none;">← Back</button>
        </div>
    </div>
</div>
