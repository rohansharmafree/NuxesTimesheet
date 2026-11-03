const AUTH_API = "https://fggvgvsdrhdbdfkczhfj.supabase.co/functions/v1/timesheet-api";
const AUTH_KEY = "sb_publishable_oQ0fxZbqkXbNjH_-xhZneQ_zpmTjb3U";
const AUTH_SESSION = "team-timesheet-session-v1";
let authSession = null;

async function authRequest(action, payload = {}, token = "") {
  const headers = { "Content-Type": "application/json", apikey: AUTH_KEY };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(AUTH_API, {
    method: "POST", headers, body: JSON.stringify({ action, ...payload })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}
function authMessage(id, message) {
  document.getElementById(id).textContent = message || "";
}
async function loadLoginEmployees() {
  const result = await authRequest("employee_options");
  const select = document.getElementById("login-employee");
  select.innerHTML = (result.employees || []).map(employee =>
    '<option value="' + employee.id + '">' + employee.name.replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c])) + '</option>'
  ).join("");
  document.getElementById("login-employee-field").hidden =
    document.getElementById("login-role").value === "admin";
}
function showTimesheet(session) {
  authSession = session;
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app-shell").hidden = false;
  const admin = session.role === "admin";
  document.getElementById("mode-select").value = admin ? "admin" : "user";
  document.getElementById("mode-select").disabled = true;
  document.getElementById("mode-pill").textContent = admin ? "Admin" : "Employee";
  document.getElementById("manage-tab").hidden = !admin;
  if (admin) {
    authRequest("list_employees", {}, session.token).then(result => {
      const select = document.getElementById("employee-select");
      select.disabled = false;
      select.innerHTML = (result.employees || []).filter(e => e.is_active)
        .map(e => '<option>' + e.name.replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c])) + '</option>').join("");
      loadWeek();
      renderProjectSelect();
    }).catch(error => alert(error.message));
  } else {
    const select = document.getElementById("employee-select");
    select.innerHTML = "<option>" + session.employee.name + "</option>";
    select.disabled = true;
    loadWeek();
    renderProjectSelect();
  }
}
document.getElementById("login-role").addEventListener("change", () => {
  document.getElementById("login-employee-field").hidden =
    document.getElementById("login-role").value === "admin";
});
document.getElementById("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  authMessage("login-error", "");
  const role = document.getElementById("login-role").value;
  const payload = { role, pin: document.getElementById("login-pin").value };
  if (role === "employee") payload.employee_id = document.getElementById("login-employee").value;
  const button = document.getElementById("login-submit");
  button.disabled = true;
  try {
    const result = await authRequest("login", payload);
    const session = { token: result.token, role: result.role, employee: result.employee };
    localStorage.setItem(AUTH_SESSION, JSON.stringify(session));
    document.getElementById("login-pin").value = "";
    showTimesheet(session);
  } catch (error) {
    authMessage("login-error", error.message);
  } finally {
    button.disabled = false;
  }
});
document.getElementById("admin-setup-form").addEventListener("submit", async event => {
  event.preventDefault();
  authMessage("setup-error", "");
  try {
    const secret = document.getElementById("setup-secret").value;
    const pin = document.getElementById("setup-pin").value;
    const response = await fetch(AUTH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: AUTH_KEY, "x-setup-secret": secret },
      body: JSON.stringify({ action: "setup_admin", admin_pin: pin })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Setup failed");
    document.getElementById("admin-setup-form").hidden = true;
    document.getElementById("login-form").hidden = false;
    document.getElementById("login-role").value = "admin";
    document.getElementById("login-employee-field").hidden = true;
    authMessage("login-error", "Admin PIN saved. Please sign in.");
  } catch (error) {
    authMessage("setup-error", error.message);
  }
});
document.getElementById("back-login").addEventListener("click", () => {
  document.getElementById("admin-setup-form").hidden = true;
  document.getElementById("login-form").hidden = false;
});
document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    if (authSession) await authRequest("logout", {}, authSession.token);
  } catch (_) {}
  localStorage.removeItem(AUTH_SESSION);
  location.reload();
});
(async function initializePinLogin() {
  document.getElementById("app-shell").hidden = true;
  document.getElementById("login-screen").hidden = false;
  try {
    await loadLoginEmployees();
    const status = await authRequest("auth_status");
    if (!status.setup_completed) {
      document.getElementById("login-form").hidden = true;
      document.getElementById("admin-setup-form").hidden = false;
    }
    const saved = localStorage.getItem(AUTH_SESSION);
    if (saved) {
      const session = JSON.parse(saved);
      const identity = await authRequest("me", {}, session.token);
      if (identity.role === "admin") showTimesheet(session);
      else if (identity.employee && identity.employee.is_active) {
        session.employee = identity.employee;
        showTimesheet(session);
      } else localStorage.removeItem(AUTH_SESSION);
    }
  } catch (error) {
    authMessage("login-error", error.message);
  }
})();