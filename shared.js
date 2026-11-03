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
  if(authSession.role==="employee"){
    $("employee-select").innerHTML="<option>"+esc(authSession.employee.name)+"</option>";
    $("employee-select").disabled=true;
  } else {
    const prev=$("employee-select").value;
    $("employee-select").innerHTML=state.members.map(n=>"<option>"+esc(n)+"</option>").join("");
    if(state.members.includes(prev))$("employee-select").value=prev;
    $("employee-select").disabled=false;
  }
  renderManage(); renderProjectSelect(); loadWeek();
  $("save-status").textContent="Connected to shared team database";
}
showTimesheet = function(session) {
  authSession=session;
  $("login-screen").hidden=true; $("app-shell").hidden=false;
  const admin=session.role==="admin";
  $("mode-select").value=admin?"admin":"user"; $("mode-select").disabled=true;
  $("mode-pill").textContent=admin?"Admin":"Employee";
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
  const employeeId=authSession.role==="employee"?authSession.employee.id:employee?.id;
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
  const employeeId=authSession.role==="employee"?authSession.employee.id:employee?.id;
  if(!employeeId){toast("Select an employee.");return;}
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
$("member-form").onsubmit=async e=>{
  e.preventDefault();
  const name=$("member-name").value.trim(),pin=$("member-pin").value;
  if(!name||!/^\d{6,12}$/.test(pin)){toast("Enter a name and a 6–12 digit PIN.");return;}
  try{
    await sharedCall("create_employee",{name,pin});
    $("member-name").value="";$("member-pin").value="";
    await refreshSharedData();await loadLoginEmployees();
    toast("Employee created. Share their PIN privately.");
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
$("member-form").insertAdjacentHTML("beforeend",'<div class="field"><label for="member-pin">EMPLOYEE PIN (6–12 DIGITS)</label><input id="member-pin" type="password" inputmode="numeric" minlength="6" maxlength="12" required placeholder="Set employee PIN"></div>');
// Reorder PIN field before the submit button for a natural form layout.
const pinInput=$("member-pin");$("member-form").insertBefore(pinInput.parentElement,$("member-form").querySelector('button[type="submit"]'));
