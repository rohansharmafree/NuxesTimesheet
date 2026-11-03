// Shared database integration. Runs after app.js and auth.js.
async function sharedCall(action, payload = {}) {
  const headers = { "Content-Type":"application/json", apikey:AUTH_KEY };
  if (authSession?.token) headers.Authorization = "Bearer " + authSession.token;
  const r = await fetch(AUTH_API, { method:"POST", headers, body:JSON.stringify({action,...payload}) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
window.sharedEmployees = [];
async function refreshSharedData() {
  const d = await sharedCall("bootstrap");
  window.sharedEmployees = d.employees || [];
  const byId = new Map(window.sharedEmployees.map(x=>[x.id,x]));
  state.members = window.sharedEmployees.filter(x=>x.is_active).map(x=>x.name);
  state.projects = (d.projects||[]).map(p=>({
    id:p.id,name:p.name,
    assignedTo:(d.assignments||[]).filter(a=>a.project_id===p.id).map(a=>byId.get(a.employee_id)?.name).filter(Boolean)
  }));
  state.tasks = (d.tasks||[]).map(t=>({id:t.id,projectId:t.project_id,employeeId:t.employee_id,title:t.title}));
  state.entries = (d.entries||[]).map(e=>({
    id:e.id,taskId:e.task_id,employeeId:e.employee_id,
    name:byId.get(e.employee_id)?.name||"",date:e.work_date,hours:Number(e.hours)
  }));
  refreshMembers();
  if(authSession.role==="admin" || authSession.role==="user"){
    const prev=$("employee-select").value;
    $("employee-select").innerHTML=state.members.map(n=>"<option>"+esc(n)+"</option>").join("");
    if(state.members.includes(prev))$("employee-select").value=prev;
    $("employee-select").disabled=false;
  }
  renderManage(); renderProjectSelect(); loadWeek(); refreshMonthlyEmployeeOptions();
  $("save-status").textContent="Connected to shared team database";
}
showTimesheet = function(session) {
  authSession=session;
  $("login-screen").hidden=true; $("app-shell").hidden=false;
  const admin=session.role==="admin";
  $("mode-select").value=admin?"admin":"user"; $("mode-select").disabled=true;
  $("mode-pill").textContent=admin?"Admin":"User access";
  $("manage-tab").hidden=!admin;
  refreshSharedData().catch(e=>toast("Database error: "+e.message));
};
renderProjectSelect = function() {
  const who=$("employee-select").value;
  const projects=state.projects.filter(p=>(p.assignedTo||[]).includes(who));
  $("task-project-select").innerHTML=projects.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join("");
  $("add-task").disabled=projects.length===0;
};
addTaskToWeek = async function(projectId,title) {
  const employee=window.sharedEmployees.find(e=>e.name===$("employee-select").value);
  const employeeId=employee?.id;
  if(!employeeId){toast("Select an employee first.");return;}
  try{
    const r=await sharedCall("create_task",{project_id:projectId,employee_id:employeeId,title});
    state.tasks.push({id:r.task.id,projectId,employeeId,title});
    selected.add(r.task.id);renderGrid();
  }catch(e){toast(e.message);}
};
saveWeek = async function() {
  const who=$("employee-select").value;
  const employee=window.sharedEmployees.find(e=>e.name===who);
  const employeeId=employee?.id;
  if(!employeeId){toast("Select an employee.");return;}
  if(!confirm("You are saving this timesheet for "+who+". Continue?")) return;
  const taskIds=state.tasks.filter(t=>t.employeeId===employeeId).map(t=>t.id);
  const items=[];
  for(const taskId of taskIds)for(const day of dates()){
    const hours=Number(entries.get(key(taskId,iso(day),who)))||0;
    if(hours>0)items.push({task_id:taskId,work_date:iso(day),hours});
  }
  try{
    await sharedCall("save_entries",{employee_id:employeeId,week_start:iso(activeWeek),task_ids:taskIds,entries:items});
    await refreshSharedData();
    $("save-status").textContent="Saved to shared database";
    toast("Timesheet saved.");
  }catch(e){toast("Save failed: "+e.message);}
};

// app.js binds its original local-only save handler before this file loads.
// Rebind the button after replacing saveWeek so every save goes through Supabase.
$("save-week").onclick = saveWeek;

$("member-form").onsubmit=async e=>{
  e.preventDefault();
  const name=$("member-name").value.trim();
  if(!name){toast("Enter an employee name.");return;}
  try{
    await sharedCall("create_employee",{name});
    $("member-name").value="";
    await refreshSharedData();
    toast("Employee added.");
  }catch(err){toast(err.message);}
};
$("project-form").onsubmit=async e=>{
  e.preventDefault();
  const name=$("project-name").value.trim();
  const names=[...$("project-assignees").querySelectorAll("input:checked")].map(x=>x.value);
  const employee_ids=names.map(n=>window.sharedEmployees.find(x=>x.name===n)?.id).filter(Boolean);
  if(!name||!employee_ids.length){toast("Enter a project and assign at least one employee.");return;}
  try{
    await sharedCall("create_project",{name,employee_ids});
    $("project-name").value="";await refreshSharedData();toast("Project created and assigned.");
  }catch(err){toast(err.message);}
};


// Handle employee removal at document level so no later render handler can override it.
document.addEventListener("click", async event => {
  const button = event.target.closest("[data-del-member]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const name = button.dataset.delMember;
  const employee = (window.sharedEmployees || []).find(item => item.name === name);
  if (!employee) {
    toast("Employee record not found. Please refresh the page and try again.");
    return;
  }
  if (!confirm(`Remove ${name} from the active team? Historical timesheet records will be preserved.`)) return;
  button.disabled = true;
  try {
    const result = await sharedCall("remove_employee", { employee_id: employee.id });
    if (!result.ok) throw new Error(result.error || "Removal was not confirmed by the server.");
    await refreshSharedData();
    toast("Employee removed from the active team.");
  } catch (error) {
    button.disabled = false;
    toast("Could not remove employee: " + error.message);
  }
}, true);


// Monthly Excel export. Employees receive only their own rows from the scoped API;
// admins can export one employee or all active employees in one workbook.
function refreshMonthlyEmployeeOptions() {
  const select = $("monthly-report-employee");
  if (!select) return;
  const prior = select.value;
  if (authSession?.role === "admin") {
    select.innerHTML = '<option value="__all__">All employees</option>' +
      state.members.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
    if ([...select.options].some(o => o.value === prior)) select.value = prior;
  } else {
    select.innerHTML = state.members.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
    if ([...select.options].some(o => o.value === prior)) select.value = prior;
    select.disabled = false;
  }
}
function exportMonthlyExcel() {
  if (!window.XLSX) { toast("Excel export library did not load. Refresh and try again."); return; }
  const month = $("monthly-report-month").value;
  if (!/^\d{4}-\d{2}$/.test(month)) { toast("Choose a month first."); return; }
  const selectedEmployee = $("monthly-report-employee").value;
  const rows = state.entries.filter(e => e.date?.startsWith(month) &&
    (selectedEmployee === "__all__" || e.name === selectedEmployee));
  if (!rows.length) { toast("No saved effort found for this month."); return; }
  const byEmployee = new Map();
  for (const entry of rows) {
    const task = state.tasks.find(t => t.id === entry.taskId) || {};
    const project = state.projects.find(p => p.id === task.projectId) || {};
    const row = {
      Employee: entry.name,
      Project: project.name || "Project unavailable",
      Task: task.title || "Task unavailable",
      Date: entry.date,
      Hours: Number(entry.hours)
    };
    if (!byEmployee.has(entry.name)) byEmployee.set(entry.name, []);
    byEmployee.get(entry.name).push(row);
  }
  const workbook = XLSX.utils.book_new();
  const summary = [];
  for (const [employee, employeeRows] of [...byEmployee.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) {
    employeeRows.sort((a,b)=>a.Date.localeCompare(b.Date)||a.Project.localeCompare(b.Project)||a.Task.localeCompare(b.Task));
    const total = employeeRows.reduce((sum,row)=>sum+row.Hours,0);
    summary.push({Employee:employee, "Total hours":Number(total.toFixed(2)), "Entries":employeeRows.length});
    const sheet = XLSX.utils.json_to_sheet(employeeRows);
    sheet["!cols"] = [{wch:22},{wch:30},{wch:38},{wch:14},{wch:12}];
    const safeName = employee.replace(/[\\/?*\\[\\]:]/g," ").slice(0,31) || "Employee";
    let sheetName = safeName, suffix = 1;
    while (workbook.SheetNames.includes(sheetName)) sheetName = (safeName.slice(0,26)+"_"+suffix++);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  }
  const summarySheet = XLSX.utils.json_to_sheet(summary);
  summarySheet["!cols"] = [{wch:24},{wch:16},{wch:12}];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Monthly Summary");
  XLSX.writeFile(workbook, `Timesheet_${month}_${selectedEmployee === "__all__" ? "All_Employees" : selectedEmployee.replace(/[^a-z0-9_-]/gi,"_")}.xlsx`);
  toast("Monthly Excel report downloaded.");
}
$("monthly-report-month").value = new Date().toISOString().slice(0,7);
$("export-monthly-xlsx").onclick = exportMonthlyExcel;


$("user-pin-form").onsubmit=async e=>{
  e.preventDefault();
  const pin=$("user-pin").value;
  if(!/^\d{6,12}$/.test(pin)){toast("User PIN must contain 6–12 digits.");return;}
  try{
    await sharedCall("set_user_pin",{pin});
    $("user-pin").value="";
    $("user-pin-status").textContent="Shared User PIN saved. Previous User sessions have been signed out.";
    toast("Shared User PIN updated.");
  }catch(err){toast(err.message);}
};


// Admin can change the permanent Admin PIN from Manage Team.
$("admin-pin-form").onsubmit = async e => {
  e.preventDefault();
  const current_pin = $("current-admin-pin").value;
  const new_pin = $("new-admin-pin").value;
  const confirm_pin = $("confirm-admin-pin").value;
  const status = $("admin-pin-status");
  status.textContent = "";
  if (!/^\\d{6,12}$/.test(current_pin) || !/^\\d{6,12}$/.test(new_pin)) {
    status.textContent = "PINs must contain 6–12 digits.";
    return;
  }
  if (new_pin !== confirm_pin) {
    status.textContent = "The new PINs do not match.";
    return;
  }
  if (current_pin === new_pin) {
    status.textContent = "Choose a new PIN different from the current PIN.";
    return;
  }
  const submit = e.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await sharedCall("set_admin_pin", { current_pin, new_pin });
    $("current-admin-pin").value = "";
    $("new-admin-pin").value = "";
    $("confirm-admin-pin").value = "";
    status.textContent = "Admin PIN changed successfully. Keep your new PIN secure.";
    toast("Admin PIN changed.");
  } catch (error) {
    status.textContent = error.message;
    toast(error.message);
  } finally {
    submit.disabled = false;
  }
};
