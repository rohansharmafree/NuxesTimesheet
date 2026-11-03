# Team Timesheet

A lightweight browser-based weekly timesheet for a small team.

## Use
1. Open the GitHub Pages site in Chrome or Edge.
2. Select Admin mode, add employees, create projects, and assign projects to employees.
3. Switch to User mode, select an employee, add tasks, enter daily hours, and save the week.
4. Use Project Reports to review weekly effort and export CSV.

## Important data limitation
This version stores data in the browser's LocalStorage. Each browser/device has its own separate data. Publishing the site on GitHub Pages does not create shared team storage. To let an administrator see entries from every team member, connect a shared backend such as Supabase with authentication and database access policies.

The Admin/User selector is a prototype convenience, not security. Do not use this version for confidential data or treat it as access-controlled.

Use Download backup regularly. Browser data is not automatically synced between devices.
